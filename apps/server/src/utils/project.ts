import type { FastifyInstance, FastifyReply } from "fastify";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { projects, apps } from "@pubky-pulse/db";
import { getAuthTeamIds } from "../middleware/auth.js";
import { loadProjectAccess } from "./project-access.js";
import type { ResolvedProject } from "./project-access.js";
import type { AuthContext } from "../types.js";

/**
 * Verify project exists and the authenticated user/key has team access.
 * Returns the project row or sends 404 and returns null.
 *
 * The returned row now also carries the caller's ownership facts
 * (`actor_user_id`, `is_project_owner`, `is_team_owner`), resolved in the same
 * query — see `utils/project-access.ts`. The contract is deliberately
 * unchanged: this still sends its own 404 and returns null, so the ~45
 * handlers that do `if (!project) return;` keep working while write
 * authorization is moved onto them one module at a time.
 */
export async function resolveProject(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ResolvedProject | null> {
  const project = await loadProjectAccess(fastify, projectId, auth);

  if (!project) {
    reply.code(404).send({ error: "Project not found" });
    return null;
  }
  return project;
}

/**
 * Look up the project_id for an app. Returns null if app not found.
 *
 * @deprecated Unpredicated: it resolves any app in any team, so a caller who
 * supplies an app id from another project gets that project's id back and can
 * then act against it. Use `resolveAccessibleProjectIdFromApp`, which
 * restricts the lookup to teams the caller can reach. Kept only until its last
 * call site is converted.
 */
export async function resolveProjectIdFromApp(
  fastify: FastifyInstance,
  appId: string,
): Promise<string | null> {
  const [row] = await fastify.db
    .select({ project_id: apps.project_id })
    .from(apps)
    .where(and(eq(apps.id, appId), isNull(apps.deleted_at)))
    .limit(1);
  return row?.project_id ?? null;
}

/**
 * Look up the project_id for an app, but only when the app and its project are
 * active and the project sits in a team this caller can reach. Returns null
 * otherwise, so an app id borrowed from another team is indistinguishable from
 * one that does not exist.
 *
 * This is the safe replacement for `resolveProjectIdFromApp`.
 */
export async function resolveAccessibleProjectIdFromApp(
  fastify: FastifyInstance,
  appId: string,
  auth: AuthContext,
): Promise<string | null> {
  const [row] = await fastify.db
    .select({ project_id: apps.project_id })
    .from(apps)
    .innerJoin(projects, eq(projects.id, apps.project_id))
    .where(
      and(
        eq(apps.id, appId),
        isNull(apps.deleted_at),
        inArray(projects.team_id, getAuthTeamIds(auth)),
        isNull(projects.deleted_at),
      ),
    )
    .limit(1);
  return row?.project_id ?? null;
}

/** Resolve project access and return app IDs for the project. */
export async function resolveProjectAppIds(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
): Promise<string[] | null> {
  const project = await resolveProject(fastify, projectId, auth, reply);
  if (!project) return null;

  const projectApps = await fastify.db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.project_id, projectId), isNull(apps.deleted_at)));

  return projectApps.map((a) => a.id);
}
