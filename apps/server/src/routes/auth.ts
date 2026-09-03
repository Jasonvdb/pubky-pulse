import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, or, gte, lt, sql } from "drizzle-orm";
import { users, teams, teamMembers, apiKeys, apps, emailVerificationCodes } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import { API_KEY_PREFIX, DEFAULT_API_KEY_PERMISSIONS, validatePermissionsForKeyType, generateApiKeySecret, generateVerificationCode, hashVerificationCode } from "@pubky-pulse/shared";
import type { ApiKeyType } from "@pubky-pulse/shared";
import type {
  SendCodeRequest,
  VerifyCodeRequest,
  AgentLoginRequest,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
  UpdateMeRequest,
  Permission,
  UserPreferences,
} from "@pubky-pulse/shared";
import { mergeUserPreferences, isEmailDomainAllowed, normalizeEmail, NOTIFICATION_TYPES, NOTIFICATION_CHANNELS, SPARKLINE_WINDOW_DAYS, MAGNITUDE_WINDOW_HOURS } from "@pubky-pulse/shared";
import type { NotificationChannel } from "@pubky-pulse/shared";
import { requireAuth, hasTeamAccess, getAuthTeamIds, getUserTeamMemberships } from "../middleware/auth.js";
import type { UserContext, UserJwtPayload } from "../types.js";
import { serializeApiKey } from "../utils/serialize.js";
import { applyProjectWrite, resolveAppInProject } from "../utils/project-access.js";
import { getOwnedProjectIds } from "../utils/project-owners.js";
import { logAuditEvent } from "../utils/audit.js";
import { config } from "../config.js";
import { deriveInitialDisplayName, findSingletonTeam } from "../services/bootstrap-team.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 10 * 365 * 24 * 60 * 60, // 10 years — sessions don't expire
  ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
};

function serializeUser(user: {
  id: string;
  email: string;
  name: string;
  preferences: UserPreferences | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    preferences: user.preferences ?? {},
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
  };
}

/**
 * Accept only known top-level keys under `preferences`. Anything else is
 * stripped so a compromised or buggy client can't write garbage into the
 * JSONB blob.
 */
function sanitizeUserPreferences(input: unknown): Partial<UserPreferences> {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: Partial<UserPreferences> = {};
  if (typeof src.version === "number") out.version = src.version as 1;
  if (src.ui && typeof src.ui === "object") {
    const ui = src.ui as Record<string, unknown>;
    const nextUi: NonNullable<UserPreferences["ui"]> = {};
    if (ui.columns && typeof ui.columns === "object") {
      const cols = ui.columns as Record<string, unknown>;
      const nextCols: NonNullable<NonNullable<UserPreferences["ui"]>["columns"]> = {};
      for (const key of ["events", "users"] as const) {
        const cfg = cols[key];
        if (cfg && typeof cfg === "object" && Array.isArray((cfg as { order?: unknown }).order)) {
          const order = ((cfg as { order: unknown[] }).order).filter((v): v is string => typeof v === "string");
          nextCols[key] = { order };
        }
      }
      if (Object.keys(nextCols).length > 0) nextUi.columns = nextCols;
    }
    if (ui.dashboard && typeof ui.dashboard === "object") {
      const dash = ui.dashboard as Record<string, unknown>;
      const nextDash: NonNullable<NonNullable<UserPreferences["ui"]>["dashboard"]> = {};
      const spark = dash.sparklineWindowDays;
      if (typeof spark === "number" && (SPARKLINE_WINDOW_DAYS as readonly number[]).includes(spark)) {
        nextDash.sparklineWindowDays = spark as (typeof SPARKLINE_WINDOW_DAYS)[number];
      }
      const mag = dash.magnitudeWindowHours;
      if (typeof mag === "number" && (MAGNITUDE_WINDOW_HOURS as readonly number[]).includes(mag)) {
        nextDash.magnitudeWindowHours = mag as (typeof MAGNITUDE_WINDOW_HOURS)[number];
      }
      if (Object.keys(nextDash).length > 0) nextUi.dashboard = nextDash;
    }
    if (Object.keys(nextUi).length > 0) out.ui = nextUi;
  }
  if (src.notifications && typeof src.notifications === "object") {
    const notif = src.notifications as Record<string, unknown>;
    const nextNotif: NonNullable<UserPreferences["notifications"]> = {};
    if (notif.types && typeof notif.types === "object") {
      const types = notif.types as Record<string, unknown>;
      const nextTypes: NonNullable<NonNullable<UserPreferences["notifications"]>["types"]> = {};
      for (const t of NOTIFICATION_TYPES) {
        const channelOverrides = types[t];
        if (!channelOverrides || typeof channelOverrides !== "object") continue;
        const channelMap = channelOverrides as Record<string, unknown>;
        const nextChannels: Partial<Record<NotificationChannel, boolean>> = {};
        for (const c of NOTIFICATION_CHANNELS) {
          const v = channelMap[c];
          if (typeof v === "boolean") nextChannels[c] = v;
        }
        if (Object.keys(nextChannels).length > 0) nextTypes[t] = nextChannels;
      }
      if (Object.keys(nextTypes).length > 0) nextNotif.types = nextTypes;
    }
    if (Object.keys(nextNotif).length > 0) out.notifications = nextNotif;
  }
  return out;
}

/**
 * Normalize a submitted address and check it against the configured domain
 * allowlist.
 *
 * Every entry point into the login flow runs this independently, before it
 * touches rate-limit state, inserts a code, sends mail, or consumes a code — so
 * a code that was inserted while a domain was still allowed (or inserted by
 * hand) cannot be redeemed afterwards.
 */
type EmailPolicyResult =
  | { ok: true; email: string }
  | { ok: false; status: 400 | 403; error: string };

function checkEmailPolicy(raw: unknown): EmailPolicyResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, status: 400, error: "Valid email is required" };
  }
  const email = normalizeEmail(raw);
  if (!email) {
    return { ok: false, status: 400, error: "Valid email is required" };
  }
  if (!isEmailDomainAllowed(email, config.allowedEmailDomains)) {
    // The address itself is never echoed back into the response or the logs.
    return { ok: false, status: 403, error: "This email domain is not permitted to sign in" };
  }
  return { ok: true, email };
}

/** Consume a verification code: validates, marks used, returns true. Returns false if invalid/expired. */
async function consumeVerificationCode(db: Parameters<typeof getUserTeamMemberships>[0], email: string, code: string): Promise<boolean> {
  const codeHash = hashVerificationCode(code);

  const [match] = await db
    .select({ id: emailVerificationCodes.id })
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        eq(emailVerificationCodes.code_hash, codeHash),
        isNull(emailVerificationCodes.used_at),
        gte(emailVerificationCodes.expires_at, new Date()),
      )
    )
    .limit(1);

  if (!match) return false;

  await db
    .update(emailVerificationCodes)
    .set({ used_at: new Date() })
    .where(eq(emailVerificationCodes.id, match.id));

  return true;
}

type MembershipTeam = Awaited<ReturnType<typeof getUserTeamMemberships>>[0];

/**
 * Find or create the user for an already-normalized, already-allowed address,
 * then idempotently attach them to the configured singleton team.
 *
 * There are no per-user teams any more: every allowed person joins the one
 * configured team, as `owner` when their address is the configured team owner
 * and as `member` otherwise. An existing membership is left alone — the
 * bootstrap owns role reconciliation — so this only ever repairs a *missing*
 * membership, which is what makes an allowed user whose row predates the
 * lockdown usable again on their next sign-in.
 *
 * No credential is generated here. Personal default agent keys stay lazily
 * created by `POST /default-agent-key` once the person actually authenticates.
 */
async function findOrCreateUser(db: Parameters<typeof getUserTeamMemberships>[0], email: string): Promise<{
  user: { id: string; email: string; name: string; preferences: UserPreferences | null; created_at: Date; updated_at: Date };
  isNewUser: boolean;
  membershipTeams: MembershipTeam[];
}> {
  const team = await findSingletonTeam(db);
  if (!team) {
    throw new Error(
      `Configured team "${config.defaultTeamSlug}" does not exist. Run the singleton-team bootstrap before serving traffic.`
    );
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user =
    existingUser ??
    (
      await db
        .insert(users)
        .values({ email, name: deriveInitialDisplayName(email) })
        .returning()
    )[0];

  await db
    .insert(teamMembers)
    .values({
      team_id: team.id,
      user_id: user.id,
      role: email === config.teamOwnerEmail ? "owner" : "member",
    })
    .onConflictDoNothing();

  return {
    user,
    isNewUser: !existingUser,
    membershipTeams: await getUserTeamMemberships(db, user.id),
  };
}

/* -------------------------------------------------------------------------
 * API key visibility
 *
 * Authorization decides what is *loaded*, not what is stripped out afterwards.
 * One predicate, `isKeyEntitled`, answers both "may this person read the
 * secret" and "may this person update or revoke this key as its owner",
 * because those are the same authority:
 *
 *   - agent keys you created yourself, and
 *   - client/import keys belonging to an app in a project you currently own.
 *
 * The singleton team owner is widened on exactly two axes and no others: they
 * may *see* every team key's metadata, and they may *revoke* any key as a
 * recovery action. They never gain a secret they are not otherwise entitled to
 * and never gain the update.
 * ---------------------------------------------------------------------- */

/** Everything the key predicates need about the caller, resolved once per request. */
interface KeyAccess {
  user_id: string;
  is_team_owner: boolean;
  /** Every project this person currently owns; a client/import key follows its app's project. */
  owned_project_ids: Set<string>;
}

/** Everything the key predicates need about a key row. */
interface KeyFacts {
  key_type: string;
  created_by: string | null;
  /** The project of the key's app, joined in. Null for team-scoped agent keys. */
  app_project_id: string | null;
}

async function resolveKeyAccess(db: Db, auth: UserContext): Promise<KeyAccess> {
  return {
    user_id: auth.user_id,
    is_team_owner: auth.is_team_owner,
    owned_project_ids: await getOwnedProjectIds(db, auth.user_id),
  };
}

/** Entitlement: own agent keys, plus client/import keys of owned projects. */
function isKeyEntitled(access: KeyAccess, key: KeyFacts): boolean {
  if (key.key_type === "agent") return key.created_by === access.user_id;
  if (key.key_type === "client" || key.key_type === "import") {
    return key.app_project_id !== null && access.owned_project_ids.has(key.app_project_id);
  }
  return false;
}

/** Metadata visibility: entitlement, widened by the team owner's recovery view. */
function isKeyVisible(access: KeyAccess, key: KeyFacts): boolean {
  return access.is_team_owner || isKeyEntitled(access, key);
}

/**
 * The SQL form of `isKeyEntitled`, so an ordinary member's list never selects
 * a row they are not entitled to. Requires `apps` to be joined for
 * `apps.project_id`.
 */
function entitledKeysFilter(access: KeyAccess) {
  const ownedProjectIds = [...access.owned_project_ids];
  return or(
    and(eq(apiKeys.key_type, "agent"), eq(apiKeys.created_by, access.user_id)),
    ownedProjectIds.length > 0
      ? and(
          inArray(apiKeys.key_type, ["client", "import"]),
          inArray(apps.project_id, ownedProjectIds),
        )
      : undefined,
  );
}

/**
 * The columns every key response needs, plus the two joined facts the
 * predicates above run on. Shared by list, single-get, update and revoke so
 * that all four decide visibility from exactly the same row shape — a single
 * route selecting less is how a stricter list ends up with a laxer detail.
 */
const KEY_COLUMNS = {
  id: apiKeys.id,
  secret: apiKeys.secret,
  key_type: apiKeys.key_type,
  app_id: apiKeys.app_id,
  team_id: apiKeys.team_id,
  name: apiKeys.name,
  created_by: apiKeys.created_by,
  permissions: apiKeys.permissions,
  created_at: apiKeys.created_at,
  updated_at: apiKeys.updated_at,
  last_used_at: apiKeys.last_used_at,
  expires_at: apiKeys.expires_at,
  app_name: apps.name,
  created_by_email: users.email,
  app_project_id: apps.project_id,
};

export async function authRoutes(app: FastifyInstance) {
  // Prevent browsers/CDNs from caching auth responses
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  // Send verification code
  app.post<{ Body: SendCodeRequest }>("/send-code", async (request, reply) => {
    // The domain check comes first, before the rate-limit read, the code
    // insert, and the send: a disallowed address must leave no verification
    // row, consume no rate-limit slot, and trigger no email.
    const policy = checkEmailPolicy(request.body?.email);
    if (!policy.ok) {
      return reply.code(policy.status).send({ error: policy.error });
    }
    const email = policy.email;

    // Rate limit: max 5 codes per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCodes = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          gte(emailVerificationCodes.created_at, oneHourAgo),
        )
      );

    if (recentCodes[0].count >= 5) {
      return reply.code(429).send({ error: "Too many verification codes requested. Try again later." });
    }

    const { code, codeHash } = generateVerificationCode();

    await app.db.insert(emailVerificationCodes).values({
      email,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    });

    try {
      await app.emailService.sendVerificationCode(email, code);
    } catch (err) {
      // Roll back the inserted code so it doesn't consume a rate-limit slot
      await app.db
        .delete(emailVerificationCodes)
        .where(and(eq(emailVerificationCodes.code_hash, codeHash), eq(emailVerificationCodes.email, email)));
      throw err;
    }

    // Lazily clean up expired codes for this email (fire-and-forget)
    app.db
      .delete(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          lt(emailVerificationCodes.expires_at, new Date()),
        )
      )
      .then(() => {}, () => {});

    return { message: "Verification code sent" };
  });

  // Verify code and authenticate (web dashboard flow — returns JWT)
  app.post<{ Body: VerifyCodeRequest }>("/verify-code", async (request, reply) => {
    const { email: rawEmail, code } = request.body;

    if (!rawEmail || !code) {
      return reply.code(400).send({ error: "email and code required" });
    }

    // Independent of the /send-code check on purpose: a code that predates a
    // policy change, or one inserted directly into the database, must not be
    // redeemable.
    const policy = checkEmailPolicy(rawEmail);
    if (!policy.ok) {
      return reply.code(policy.status).send({ error: policy.error });
    }
    const email = policy.email;

    const valid = await consumeVerificationCode(app.db, email, code);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid or expired code" });
    }

    const { user, isNewUser, membershipTeams } = await findOrCreateUser(app.db, email);

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
      } satisfies UserJwtPayload
    );

    reply.setCookie("token", token, COOKIE_OPTIONS);

    // No team is created on sign-in any more, so only the user and their
    // membership are audited — and the membership is what a reviewer needs to
    // see, since it is the moment a person gained access to the team.
    const singletonMembership = membershipTeams.find((t) => t.slug === config.defaultTeamSlug);
    if (isNewUser && singletonMembership) {
      const teamId = singletonMembership.id;
      const actor = {
        type: "user" as const,
        user_id: user.id,
        email: user.email,
        team_id: teamId,
        is_team_owner: singletonMembership.role === "owner",
        team_memberships: [{ team_id: teamId, role: singletonMembership.role }],
      };
      logAuditEvent(app.db, actor, { team_id: teamId, action: "create", resource_type: "user", resource_id: user.id });
      logAuditEvent(app.db, actor, { team_id: teamId, action: "create", resource_type: "team_member", resource_id: user.id, metadata: { role: singletonMembership.role } });
    }

    const statusCode = isNewUser ? 201 : 200;
    return reply.code(statusCode).send({
      token,
      user: serializeUser(user),
      teams: membershipTeams,
      is_new_user: isNewUser,
    });
  });

  // Logout
  app.post("/logout", async (_request, reply) => {
    reply.clearCookie("token", COOKIE_OPTIONS);
    return { success: true };
  });

  // List teams for authenticated user
  app.get(
    "/teams",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can list teams" });
      }

      return {
        teams: await getUserTeamMemberships(app.db, auth.user_id),
      };
    }
  );

  // Current user profile
  app.get(
    "/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can access this endpoint" });
      }

      const [user] = await app.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          preferences: users.preferences,
          created_at: users.created_at,
          updated_at: users.updated_at,
        })
        .from(users)
        .where(eq(users.id, auth.user_id))
        .limit(1);

      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }

      return {
        user: serializeUser(user),
        teams: await getUserTeamMemberships(app.db, auth.user_id),
      };
    }
  );

  // Update profile
  app.patch<{ Body: UpdateMeRequest }>(
    "/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can update their profile" });
      }

      const { name, preferences } = request.body;

      if (name === undefined && preferences === undefined) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const [current] = await app.db
        .select({ name: users.name, preferences: users.preferences })
        .from(users)
        .where(eq(users.id, auth.user_id))
        .limit(1);

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (preferences !== undefined) {
        updates.preferences = mergeUserPreferences(current?.preferences, sanitizeUserPreferences(preferences));
      }

      const [updated] = await app.db
        .update(users)
        .set(updates)
        .where(eq(users.id, auth.user_id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          preferences: users.preferences,
          created_at: users.created_at,
          updated_at: users.updated_at,
        });

      if (name !== undefined && auth.team_memberships.length > 0) {
        logAuditEvent(app.db, auth, {
          team_id: auth.team_memberships[0].team_id,
          action: "update",
          resource_type: "user",
          resource_id: auth.user_id,
          changes: { name: { before: current?.name, after: name } },
        });
      }

      return {
        user: serializeUser(updated),
      };
    }
  );

  // Lazy-create default agent key (for MCP setup docs)
  app.post<{ Body: { team_id: string } }>(
    "/default-agent-key",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can create default agent keys" });
      }

      const { team_id } = request.body;
      if (!team_id) {
        return reply.code(400).send({ error: "team_id is required" });
      }
      if (!hasTeamAccess(auth, team_id)) {
        return reply.code(403).send({ error: "No access to this team" });
      }

      // Scoped to `created_by = this user`. Without that predicate this
      // returned the team's oldest agent key, i.e. handed one colleague's
      // agent secret to every other member of the team.
      //
      // Find-or-create runs inside a transaction guarded by an advisory lock on
      // (team, user) so two concurrent calls — the dashboard opening MCP setup
      // in two tabs, say — cannot both miss and both insert a key.
      const lockKey = `default-agent-key:${team_id}:${auth.user_id}`;

      const result = await app.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

        const [existing] = await tx
          .select({ secret: apiKeys.secret })
          .from(apiKeys)
          .where(and(
            eq(apiKeys.team_id, team_id),
            eq(apiKeys.key_type, "agent"),
            eq(apiKeys.created_by, auth.user_id),
            isNull(apiKeys.deleted_at),
          ))
          .orderBy(apiKeys.created_at)
          .limit(1);

        if (existing) return { secret: existing.secret, created: false };

        const secret = generateApiKeySecret("agent");
        await tx.insert(apiKeys).values({
          secret,
          key_type: "agent",
          team_id,
          name: "Default Agent Key",
          created_by: auth.user_id,
          permissions: DEFAULT_API_KEY_PERMISSIONS.agent,
        });

        return { secret, created: true };
      });

      return reply.code(result.created ? 201 : 200).send(result);
    }
  );

  // List API keys
  app.get<{ Querystring: { team_id?: string } }>(
    "/keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can list API keys" });
      }

      const allTeamIds = getAuthTeamIds(auth);
      const { team_id } = request.query;

      // If team_id is specified, validate access and scope to that team
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { api_keys: [] };
      }

      const access = await resolveKeyAccess(app.db, auth);

      const rows = await app.db
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .leftJoin(apps, eq(apiKeys.app_id, apps.id))
        .leftJoin(users, eq(apiKeys.created_by, users.id))
        .where(
          and(
            inArray(apiKeys.team_id, teamIds),
            isNull(apiKeys.deleted_at),
            // The team owner's list carries every team key's metadata for
            // recovery; everyone else's query never even loads a row they are
            // not entitled to. Either way the secret is decided per row below.
            access.is_team_owner ? undefined : entitledKeysFilter(access),
          )
        );

      return {
        api_keys: rows.map((row) =>
          serializeApiKey(row, { canReadSecret: isKeyEntitled(access, row) })
        ),
      };
    }
  );

  // Get single API key
  app.get<{ Params: { id: string } }>(
    "/keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can view API keys" });
      }

      const access = await resolveKeyAccess(app.db, auth);

      const [key] = await app.db
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .leftJoin(apps, eq(apiKeys.app_id, apps.id))
        .leftJoin(users, eq(apiKeys.created_by, users.id))
        .where(
          and(eq(apiKeys.id, request.params.id), isNull(apiKeys.deleted_at))
        )
        .limit(1);

      // Single-key visibility is exactly the list's, so knowing a key's UUID
      // never reveals a secret. A key the caller may not see is reported as
      // one that does not exist — a 403 here would confirm it does.
      if (!key || !hasTeamAccess(auth, key.team_id) || !isKeyVisible(access, key)) {
        return reply.code(404).send({ error: "API key not found" });
      }

      return { api_key: serializeApiKey(key, { canReadSecret: isKeyEntitled(access, key) }) };
    }
  );

  // Update API key
  app.patch<{ Params: { id: string }; Body: UpdateApiKeyRequest }>(
    "/keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can update API keys" });
      }

      const { name, permissions } = request.body;

      if (!name && !permissions) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      const access = await resolveKeyAccess(app.db, auth);

      const [key] = await app.db
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .leftJoin(apps, eq(apiKeys.app_id, apps.id))
        .leftJoin(users, eq(apiKeys.created_by, users.id))
        .where(
          and(eq(apiKeys.id, request.params.id), isNull(apiKeys.deleted_at))
        )
        .limit(1);

      if (!key || !hasTeamAccess(auth, key.team_id) || !isKeyVisible(access, key)) {
        return reply.code(404).send({ error: "API key not found" });
      }

      // The team owner can see this key and can revoke it, but recovery
      // authority is not an ownership claim: it never edits a key as though it
      // were theirs.
      if (!isKeyEntitled(access, key)) {
        return reply.code(403).send({
          error: "Requires ownership of this key or of its app's project",
        });
      }

      if (permissions) {
        const permissionError = validatePermissionsForKeyType(key.key_type as import("@pubky-pulse/shared").ApiKeyType, permissions);
        if (permissionError) {
          return reply.code(400).send({ error: permissionError });
        }
      }

      const updates: Partial<{ name: string; permissions: Permission[] }> = {};
      if (name) updates.name = name;
      if (permissions) updates.permissions = permissions;

      const [updated] = await app.db
        .update(apiKeys)
        .set(updates)
        .where(eq(apiKeys.id, request.params.id))
        .returning();

      const changes: Record<string, { before?: unknown; after?: unknown }> = {};
      if (name && name !== key.name) changes.name = { before: key.name, after: name };
      if (permissions) changes.permissions = { before: key.permissions, after: permissions };
      if (Object.keys(changes).length > 0) {
        logAuditEvent(app.db, auth, {
          team_id: key.team_id,
          action: "update",
          resource_type: "api_key",
          resource_id: key.id,
          changes,
        });
      }

      // Only an entitled caller reaches this line, so the secret is theirs.
      return { api_key: serializeApiKey(updated, { canReadSecret: true }) };
    }
  );

  // Delete API key
  app.delete<{ Params: { id: string } }>(
    "/keys/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete API keys" });
      }

      const access = await resolveKeyAccess(app.db, auth);

      const [key] = await app.db
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .leftJoin(apps, eq(apiKeys.app_id, apps.id))
        .leftJoin(users, eq(apiKeys.created_by, users.id))
        .where(
          and(eq(apiKeys.id, request.params.id), isNull(apiKeys.deleted_at))
        )
        .limit(1);

      // Revocation is the one action the team owner's recovery authority
      // performs, so visibility is the whole check here: an entitled caller
      // revokes their own key, and the team owner may revoke any team key
      // without ever being able to read or edit it.
      if (!key || !hasTeamAccess(auth, key.team_id) || !isKeyVisible(access, key)) {
        return reply.code(404).send({ error: "API key not found" });
      }

      await app.db
        .update(apiKeys)
        .set({ deleted_at: new Date() })
        .where(eq(apiKeys.id, request.params.id));

      logAuditEvent(app.db, auth, {
        team_id: key.team_id,
        action: "delete",
        resource_type: "api_key",
        resource_id: key.id,
        metadata: { name: key.name },
      });

      return { deleted: true };
    }
  );

  // Create API key
  app.post<{ Body: CreateApiKeyRequest }>(
    "/keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;

      // Agent keys can create import keys; every other key type requires user
      // auth. A client or import key can therefore never enter this route —
      // nor any other key-management route, all of which are user-only.
      if (auth.type === "api_key") {
        if (auth.key_type !== "agent") {
          return reply.code(403).send({ error: "Only users or agent keys can create API keys" });
        }
        if (!auth.permissions.includes("apps:write")) {
          return reply.code(403).send({ error: "Missing permission: apps:write" });
        }
      }

      const { name, key_type, app_id, team_id, permissions: requestedPermissions, expires_in_days } = request.body;

      if (!name || !key_type) {
        return reply.code(400).send({ error: "name and key_type required" });
      }

      const validKeyTypes = Object.keys(API_KEY_PREFIX) as ApiKeyType[];
      if (!validKeyTypes.includes(key_type as ApiKeyType)) {
        return reply.code(400).send({ error: `key_type must be one of: ${validKeyTypes.join(", ")}` });
      }

      // Agent keys can only create import keys, not client or agent keys
      if (auth.type === "api_key" && key_type !== "import") {
        return reply.code(403).send({ error: "Agent keys can only create import keys" });
      }

      // Client and import keys must be scoped to an app
      if ((key_type === "client" || key_type === "import") && !app_id) {
        return reply.code(400).send({ error: `${key_type.charAt(0).toUpperCase() + key_type.slice(1)} keys require an app_id` });
      }

      // Agent keys without an app require a team_id
      if (key_type === "agent" && !app_id && !team_id) {
        return reply.code(400).send({ error: "Agent keys require a team_id or app_id" });
      }

      // Resolve the team from the app or the body. There is no team-role gate
      // on creation any more: an agent key belongs to the person who creates
      // it and carries only that person's access, so any member may mint their
      // own. What is gated is minting a credential *for a project* — see below.
      let resolvedTeamId: string;

      if (app_id) {
        // The app is resolved together with the project that contains it, so a
        // key can never be minted against an app the caller cannot reach; a
        // cross-team app id stays indistinguishable from a missing one.
        const contained = await resolveAppInProject(app, { appId: app_id }, auth, reply);
        if (!contained) return;

        // A client or import key is a credential for that app's project, so
        // minting one is an ordinary project write: the project's owner list
        // decides, and an agent additionally needs `apps:write` and its
        // creator's current ownership. An agent key scoped to an app is not a
        // project credential — it carries only its creator's own access — so
        // it needs nothing beyond the team membership proved above.
        if (key_type === "client" || key_type === "import") {
          if (!applyProjectWrite(contained, auth, reply, { permission: "apps:write" })) return;
        }

        resolvedTeamId = contained.project.team_id;
      } else {
        if (!hasTeamAccess(auth, team_id!)) {
          return reply.code(403).send({ error: "Not a member of this team" });
        }
        resolvedTeamId = team_id!;
      }

      const permissions = requestedPermissions ?? DEFAULT_API_KEY_PERMISSIONS[key_type];
      const permissionError = validatePermissionsForKeyType(key_type, permissions);
      if (permissionError) {
        return reply.code(400).send({ error: permissionError });
      }

      const secret = generateApiKeySecret(key_type);

      const expires_at = expires_in_days
        ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
        : null;

      const createdBy = auth.type === "user" ? auth.user_id : auth.created_by;

      const [apiKey] = await app.db
        .insert(apiKeys)
        .values({
          secret,
          key_type,
          app_id: app_id || null,
          team_id: resolvedTeamId,
          name,
          created_by: createdBy,
          permissions,
          expires_at,
        })
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: resolvedTeamId,
        action: "create",
        resource_type: "api_key",
        resource_id: apiKey.id,
        metadata: { key_type, name },
      });

      // The one response that carries a freshly minted secret. An agent that
      // created an import key sees it here and nowhere else: it cannot list,
      // read, update or revoke keys afterwards.
      return reply.code(201).send({
        api_key: serializeApiKey(apiKey, { canReadSecret: true }),
      });
    }
  );

  // Agent login — verify code + provision agent API key in one step (no JWT)
  app.post<{ Body: AgentLoginRequest }>("/agent-login", async (request, reply) => {
    const { email: rawEmail, code, team_id } = request.body;

    if (!rawEmail || !code) {
      return reply.code(400).send({ error: "email and code required" });
    }

    // This route consumes codes and creates users exactly like /verify-code, so
    // it enforces exactly the same domain policy. Skipping it here would leave
    // the entire lockdown bypassable through the agent bootstrap flow.
    const policy = checkEmailPolicy(rawEmail);
    if (!policy.ok) {
      return reply.code(policy.status).send({ error: policy.error });
    }
    const email = policy.email;

    const valid = await consumeVerificationCode(app.db, email, code);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid or expired code" });
    }

    const { user: agentUser, membershipTeams } = await findOrCreateUser(app.db, email);

    if (membershipTeams.length === 0) {
      return reply.code(500).send({ error: "User has no team membership" });
    }

    // Resolve target team
    let targetTeam: MembershipTeam;

    if (team_id) {
      const found = membershipTeams.find((t) => t.id === team_id);
      if (!found) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }
      targetTeam = found;
    } else if (membershipTeams.length === 1) {
      targetTeam = membershipTeams[0];
    } else {
      return reply.code(400).send({
        error: "Multiple teams found. Specify team_id.",
        teams: membershipTeams,
      });
    }

    // Build auth context for audit logging (only target team needed)
    const agentLoginAuth = {
      type: "user" as const,
      user_id: agentUser.id,
      email: agentUser.email,
      team_id: targetTeam.id,
      is_team_owner: targetTeam.role === "owner",
      team_memberships: [{ team_id: targetTeam.id, role: targetTeam.role }],
    };

    // Create agent API key
    const agentSecret = generateApiKeySecret("agent");
    const [agentApiKey] = await app.db.insert(apiKeys).values({
      secret: agentSecret,
      key_type: "agent",
      app_id: null,
      team_id: targetTeam.id,
      name: "Agent Key",
      created_by: agentUser.id,
      permissions: DEFAULT_API_KEY_PERMISSIONS.agent,
    }).returning({ id: apiKeys.id });

    logAuditEvent(app.db, agentLoginAuth, {
      team_id: targetTeam.id,
      action: "create",
      resource_type: "api_key",
      resource_id: agentApiKey.id,
      metadata: { key_type: "agent", name: "Agent Key" },
    });

    return reply.code(201).send({
      api_key: agentSecret,
      team: { id: targetTeam.id, name: targetTeam.name, slug: targetTeam.slug },
    });
  });

  // Whoami — verify auth and return identity info
  app.get("/whoami", { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth;

    if (auth.type === "api_key") {
      const [team] = await app.db
        .select({ id: teams.id, name: teams.name, slug: teams.slug })
        .from(teams)
        .where(eq(teams.id, auth.team_id))
        .limit(1);

      return reply.send({
        type: "api_key",
        key_type: auth.key_type,
        team: team ? { id: team.id, name: team.name, slug: team.slug } : null,
        permissions: auth.permissions,
      });
    }

    // User (JWT) auth
    const memberships = await getUserTeamMemberships(app.db, auth.user_id);

    return reply.send({
      type: "user",
      email: auth.email,
      teams: memberships.map((m) => ({ id: m.id, name: m.name, slug: m.slug, role: m.role })),
    });
  });
}
