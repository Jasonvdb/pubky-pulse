import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { apiKeys, teams, teamMembers, users } from "@pubky-pulse/db";

import type { Db } from "@pubky-pulse/db";
import { API_KEY_PREFIX, isEmailDomainAllowed } from "@pubky-pulse/shared";
import type { AuthTeamMembership, Permission, ApiKeyType } from "@pubky-pulse/shared";
import type { AuthContext, UserJwtPayload, ApiKeyContext, UserContext } from "../types.js";
import { config } from "../config.js";
import { findSingletonTeam } from "../services/bootstrap-team.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/** Returns all team IDs the authenticated context has access to. */
export function getAuthTeamIds(auth: AuthContext): string[] {
  return auth.type === "api_key"
    ? [auth.team_id]
    : auth.team_memberships.map((m) => m.team_id);
}

/** Checks if the authenticated context has access to a specific team. */
export function hasTeamAccess(auth: AuthContext, teamId: string): boolean {
  return getAuthTeamIds(auth).includes(teamId);
}

/**
 * Fetches team memberships with full team details for a user, including that
 * user's own default agent key per team.
 *
 * The key lookup is scoped to `created_by = userId`. It previously took the
 * team's oldest agent key regardless of creator, which handed every member of a
 * team the same person's agent secret through `/v1/auth/me` and every login
 * response.
 */
export async function getUserTeamMemberships(db: Db, userId: string): Promise<AuthTeamMembership[]> {
  const rows = await db
    .select({
      team_id: teamMembers.team_id,
      role: teamMembers.role,
      team_name: teams.name,
      team_slug: teams.slug,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.team_id))
    .where(and(eq(teamMembers.user_id, userId), isNull(teams.deleted_at)));

  if (rows.length === 0) return [];

  // This user's own oldest agent key per team, for MCP setup docs.
  const teamIds = rows.map((r) => r.team_id);
  const agentKeys = await db
    .select({ team_id: apiKeys.team_id, secret: apiKeys.secret })
    .from(apiKeys)
    .where(and(
      inArray(apiKeys.team_id, teamIds),
      eq(apiKeys.key_type, "agent"),
      eq(apiKeys.created_by, userId),
      isNull(apiKeys.deleted_at),
    ))
    .orderBy(apiKeys.created_at);

  const keyMap = new Map<string, string>();
  for (const k of agentKeys) {
    if (!keyMap.has(k.team_id)) keyMap.set(k.team_id, k.secret);
  }

  return rows.map((m) => ({
    id: m.team_id,
    name: m.team_name,
    slug: m.team_slug,
    role: m.role,
    default_agent_key: keyMap.get(m.team_id),
  }));
}

/**
 * Revalidate a human identity against the database on this request.
 *
 * Nothing in the JWT is trusted beyond its signature and subject: the stored
 * email is re-checked against the current domain allowlist and the singleton
 * membership is re-read, so a user who is deleted, moved to a disallowed
 * domain, or removed from the team loses access on their very next request
 * rather than whenever their (deliberately never-expiring) session ends.
 *
 * The team is resolved by configured slug on each call rather than from a
 * bootstrap-time id, because the row can legitimately be recreated with a new
 * uuid and a cached id would reject every request afterwards.
 */
async function revalidateUserIdentity(
  db: Db,
  userId: string
): Promise<{ ok: true; context: UserContext } | { ok: false; error: string }> {
  // The user row and the singleton team are independent lookups, and this runs
  // on every authenticated request, so they are issued together instead of in
  // series. The checks below keep their original order and messages — this
  // changes when the queries are sent, never what is rejected.
  const [[user], team] = await Promise.all([
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    findSingletonTeam(db),
  ]);

  if (!user) return { ok: false, error: "Invalid or expired token" };

  // One message for every "identity is no longer valid" outcome: which of the
  // three checks failed is not the caller's business, and the email itself is
  // never echoed back.
  const rejected = { ok: false, error: "Session is no longer valid" } as const;

  if (!isEmailDomainAllowed(user.email, config.allowedEmailDomains)) return rejected;

  if (!team) return rejected;

  const [membership] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, team.id), eq(teamMembers.user_id, user.id)))
    .limit(1);

  if (!membership) return rejected;

  return {
    ok: true,
    context: {
      type: "user",
      user_id: user.id,
      email: user.email,
      team_id: team.id,
      is_team_owner: membership.role === "owner",
      team_memberships: [{ team_id: team.id, role: membership.role }],
    },
  };
}

/**
 * Revalidate an agent key's creator. An agent inherits its creator's access, so
 * the key must stop working the moment that person is gone, off-domain, or no
 * longer a member — checked on every request, not once at key creation.
 */
async function isAgentCreatorValid(db: Db, createdBy: string): Promise<boolean> {
  // Same reasoning as `revalidateUserIdentity`: two independent reads on the
  // hot path for every agent-key request, so they go out concurrently.
  const [[creator], team] = await Promise.all([
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, createdBy))
      .limit(1),
    findSingletonTeam(db),
  ]);

  if (!creator) return false;
  if (!isEmailDomainAllowed(creator.email, config.allowedEmailDomains)) return false;

  if (!team) return false;

  const [membership] = await db
    .select({ user_id: teamMembers.user_id })
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, team.id), eq(teamMembers.user_id, creator.id)))
    .limit(1);

  return Boolean(membership);
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const header = request.headers.authorization;
  let token: string;

  if (header) {
    const [scheme, headerToken] = header.split(" ");
    if (scheme !== "Bearer" || !headerToken) {
      return reply.code(401).send({ error: "Invalid authorization format" });
    }
    token = headerToken;
  } else if (request.cookies?.token) {
    token = request.cookies.token;
  } else {
    return reply.code(401).send({ error: "Missing authorization" });
  }

  // API key auth
  if (
    token.startsWith(API_KEY_PREFIX.client) ||
    token.startsWith(API_KEY_PREFIX.agent) ||
    token.startsWith(API_KEY_PREFIX.import)
  ) {
    const db = request.server.db;
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.secret, token), isNull(apiKeys.deleted_at)))
      .limit(1);

    if (!key) {
      return reply.code(401).send({ error: "Invalid API key" });
    }

    if (key.expires_at && key.expires_at < new Date()) {
      return reply.code(401).send({ error: "API key expired" });
    }

    // Agent keys act on their creator's behalf, so the creator is revalidated.
    // Client and import keys are the SDK ingestion data plane: they carry no
    // human authority and must keep ingesting on their own active/expiry/app
    // scope alone, so they are deliberately not coupled to membership.
    if (key.key_type === "agent" && !(await isAgentCreatorValid(db, key.created_by))) {
      return reply.code(401).send({ error: "API key creator is no longer authorized" });
    }

    // Update last_used_at (fire and forget)
    db.update(apiKeys)
      .set({ last_used_at: new Date() })
      .where(eq(apiKeys.id, key.id))
      .execute()
      .catch(() => {});

    request.auth = {
      type: "api_key",
      key_id: key.id,
      key_type: key.key_type as ApiKeyType,
      app_id: key.app_id,
      team_id: key.team_id,
      created_by: key.created_by,
      permissions: key.permissions as Permission[],
    } satisfies ApiKeyContext;
    return;
  }

  // JWT auth — the signature only establishes which user is being claimed; the
  // identity itself is re-read from the database below.
  let payload: UserJwtPayload;
  try {
    payload = request.server.jwt.verify<UserJwtPayload>(token);
  } catch {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }

  const result = await revalidateUserIdentity(request.server.db, payload.sub);
  if (!result.ok) {
    return reply.code(401).send({ error: result.error });
  }

  request.auth = result.context;
}

/** Auth + 403 if the caller is an API key. Use for user-only resources (notifications, devices, profile). */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.auth.type !== "user") {
    return reply.code(403).send({ error: "User authentication required" });
  }
}

/**
 * Read `request.auth` as a UserContext after `requireUser` has run. The
 * middleware narrows at runtime; this helper carries the narrowing through
 * the type system.
 */
export function userAuth(request: FastifyRequest): UserContext {
  return request.auth as UserContext;
}

export function requirePermission(...perms: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const auth = request.auth;
    if (auth.type === "user") return; // users have full access per role

    const missing = perms.filter(perm => !auth.permissions.includes(perm));
    if (missing.length > 0) {
      return reply.code(403).send({
        error: `Missing permission${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      });
    }
  };
}
