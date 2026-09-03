import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { teams, teamMembers, users, apiKeys } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import { requireAuth, hasTeamAccess } from "../middleware/auth.js";

/**
 * The singleton team is read-only over the API.
 *
 * The team row, its roster and its membership roles come from server
 * configuration and the startup bootstrap, so there is no create, rename,
 * delete, role-change, member-removal, leave or invitation endpoint here. What
 * remains is what the product still needs to read: `/auth/me`'s team block,
 * the roster page, and the project-owner picker, which needs the roster to
 * offer people to add.
 *
 * Every handler pins `teamId` to the caller's own membership via
 * `hasTeamAccess`, so a supplied team id must equal the configured singleton
 * team the request was revalidated against.
 */

/**
 * The roster, readable by every team member.
 *
 * Colleagues in a single-team deployment already see each other's name and
 * email throughout the product (comment authorship, audit actors, project
 * owner lists), so those plus the role and join date are the whole shape. No
 * credential, preference or activity field is exposed.
 */
async function getTeamMembers(db: Db, teamId: string) {
  const rows = await db
    .select({
      user_id: teamMembers.user_id,
      role: teamMembers.role,
      email: users.email,
      name: users.name,
      joined_at: teamMembers.joined_at,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.user_id))
    .where(eq(teamMembers.team_id, teamId));

  return rows.map((r) => ({
    user_id: r.user_id,
    email: r.email,
    name: r.name,
    role: r.role,
    joined_at: r.joined_at.toISOString(),
  }));
}

export async function teamsRoutes(app: FastifyInstance) {
  // Get team details with members
  app.get<{ Params: { teamId: string } }>(
    "/teams/:teamId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      const [teamRows, members] = await Promise.all([
        app.db.select().from(teams).where(and(eq(teams.id, teamId), isNull(teams.deleted_at))).limit(1),
        getTeamMembers(app.db, teamId),
      ]);

      const team = teamRows[0];
      if (!team) {
        return reply.code(404).send({ error: "Team not found" });
      }

      return {
        id: team.id,
        name: team.name,
        slug: team.slug,
        created_at: team.created_at.toISOString(),
        updated_at: team.updated_at.toISOString(),
        members,
      };
    }
  );

  // List team members
  app.get<{ Params: { teamId: string } }>(
    "/teams/:teamId/members",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      return { members: await getTeamMembers(app.db, teamId) };
    }
  );

  // List the caller's own agent keys for this team.
  //
  // The route keeps its `:userId` segment because the dashboard addresses it
  // that way, but it now serves only the caller's own keys: it returns raw
  // agent secrets, and an agent key carries its creator's full project access,
  // so handing one to anybody else — the team owner included — would hand over
  // that person's authority. Team-wide key *metadata* lives on
  // `/v1/auth/keys`, where secrets outside the caller's entitlement serialize
  // as null.
  app.get<{ Params: { teamId: string; userId: string } }>(
    "/teams/:teamId/members/:userId/agent-keys",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId, userId } = request.params;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can view member agent keys" });
      }

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      if (auth.user_id !== userId) {
        return reply.code(403).send({ error: "You can only view your own agent keys" });
      }

      const keys = await app.db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          secret: apiKeys.secret,
          permissions: apiKeys.permissions,
          created_at: apiKeys.created_at,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.team_id, teamId),
            eq(apiKeys.created_by, userId),
            eq(apiKeys.key_type, "agent"),
            isNull(apiKeys.deleted_at)
          )
        );

      return {
        keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          secret: k.secret,
          permissions: k.permissions,
          created_at: k.created_at.toISOString(),
        })),
      };
    }
  );
}
