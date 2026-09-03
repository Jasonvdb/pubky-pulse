import type { FastifyInstance, FastifyReply } from "fastify";
import { requirePermission } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import {
  evaluateProjectWrite,
  resolveActorUserId,
  resolveProjectAccess,
} from "../utils/project-access.js";
import {
  addProjectOwner,
  getProjectOwners,
  isTeamMember,
  removeProjectOwner,
  resolveAccessLevel,
} from "../utils/project-owners.js";
import type { ProjectAccess } from "../utils/project-access.js";
import type { AuthContext } from "../types.js";

/**
 * The project owner list — `/v1/projects/:projectId/owners`.
 *
 * A project's owners are equal: any of them may add or remove any other,
 * including themselves, so long as one owner remains. Two rules sit on top:
 *
 *   - mutations are human-only. An agent inherits its creator's project access
 *     for ordinary writes, but never the ability to change who holds that
 *     access — otherwise a key could quietly widen its own creator's reach.
 *   - the singleton team owner has recovery authority here even without owning
 *     the project, so an ownerless project can be re-owned. That authority is
 *     scoped to this list; it confers no ordinary project write.
 */

/** Owner-list mutations share one authorization shape. */
const MANAGE_OWNERS = {
  permission: "projects:write",
  humanOnly: true,
  allowTeamOwnerRecovery: true,
} as const;

/** The owner list plus the caller's resulting access, the response every route returns. */
async function ownerListResponse(app: FastifyInstance, projectId: string, auth: AuthContext) {
  const owners = await getProjectOwners(app.db, projectId);
  return { owners, access_level: resolveAccessLevel(owners, resolveActorUserId(auth)) };
}

/** Routes nested under /v1/projects/:projectId */
export async function projectOwnersRoutes(app: FastifyInstance) {
  // List a project's owners. Readable by every member of the team: the owner
  // list is how a viewer discovers who can act on the project.
  app.get<{ Params: { projectId: string } }>(
    "/owners",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const { projectId } = request.params;
      const access = await resolveProjectAccess(app, projectId, request.auth, reply);
      if (!access) return;

      return ownerListResponse(app, projectId, request.auth);
    },
  );

  // Add an owner. Idempotent: re-adding an existing owner is a no-op success,
  // so a retried request never turns into an error the client has to interpret.
  app.put<{ Params: { projectId: string; userId: string } }>(
    "/owners/:userId",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const { projectId, userId } = request.params;
      const auth = request.auth;

      const access = await authorizeOwnerChange(app, projectId, auth, reply);
      if (!access) return;

      // There is no outside-user invitation path: an owner must already be on
      // this team's roster. A non-member reads as 404 rather than 403 so the
      // response cannot be used to probe for user ids.
      if (!(await isTeamMember(app.db, access.project.team_id, userId))) {
        return reply.code(404).send({ error: "User not found in this team" });
      }

      await addProjectOwner(app.db, projectId, userId);

      logAuditEvent(app.db, auth, {
        team_id: access.project.team_id,
        action: "create",
        resource_type: "project_owner",
        resource_id: userId,
        metadata: { project_id: projectId },
      });

      return ownerListResponse(app, projectId, auth);
    },
  );

  // Remove an owner, including oneself. The last owner can never be removed.
  app.delete<{ Params: { projectId: string; userId: string } }>(
    "/owners/:userId",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const { projectId, userId } = request.params;
      const auth = request.auth;

      const access = await authorizeOwnerChange(app, projectId, auth, reply);
      if (!access) return;

      // Counting and deleting happen together under a lock inside
      // `removeProjectOwner`, so the "one owner must remain" invariant is
      // decided by the database and not by a count this handler read earlier.
      const outcome = await removeProjectOwner(app.db, projectId, userId);

      if (outcome.status === "not_an_owner") {
        return reply.code(404).send({ error: "User is not an owner of this project" });
      }
      if (outcome.status === "last_owner") {
        return reply
          .code(409)
          .send({ error: "A project must keep at least one owner" });
      }

      logAuditEvent(app.db, auth, {
        team_id: access.project.team_id,
        action: "delete",
        resource_type: "project_owner",
        resource_id: userId,
        metadata: { project_id: projectId },
      });

      return ownerListResponse(app, projectId, auth);
    },
  );
}

/**
 * Resolve the project and clear the caller to change its owner list, or send
 * the refusal and return null. 404 for a project the caller cannot see, 403 for
 * one they can see but may not manage.
 */
async function authorizeOwnerChange(
  app: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectAccess | null> {
  const access = await resolveProjectAccess(app, projectId, auth, reply);
  if (!access) return null;

  const denial = evaluateProjectWrite(auth, access, MANAGE_OWNERS);
  if (denial) {
    reply.code(denial.status).send({ error: denial.error });
    return null;
  }
  return access;
}
