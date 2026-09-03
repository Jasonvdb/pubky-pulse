import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  apps,
  eventAttachments,
  feedback,
  feedbackComments,
  issueComments,
  issues,
  jobRuns,
  projectOwners,
  projects,
  questionnaireResponseComments,
  questionnaireResponses,
  questionnaires,
} from "@pubky-pulse/db";
import type { Permission } from "@pubky-pulse/shared";
import { getAuthTeamIds } from "../middleware/auth.js";
import type { AuthContext } from "../types.js";

/**
 * Central project authorization.
 *
 * Team membership grants *reads* of every project in the singleton team.
 * Ordinary project-scoped *writes* require membership of `project_owners`, so
 * every mutation resolves three facts together:
 *
 *   - the project is active and inside a team the caller can reach;
 *   - who the effective *human* actor behind the request is;
 *   - whether that human currently owns the project.
 *
 * All three come from one query. `resolveProject` runs on roughly 45 handlers,
 * so a separate ownership round-trip per handler would roughly double the
 * request count of the whole management API.
 */

/** The ownership/recovery facts resolved alongside a project. */
export interface ProjectAccessFacts {
  /**
   * The human whose project access this request carries: a JWT user, or the
   * `created_by` of an agent key. Client and import keys are the SDK ingestion
   * data plane and have no project-management actor at all, so this is `null`
   * for them and every management check below fails closed.
   */
  actor_user_id: string | null;
  /** True when `actor_user_id` is currently in `project_owners` for this project. */
  is_project_owner: boolean;
  /**
   * True only for a JWT user who is the singleton team owner. Recovery
   * authority is deliberately human-only: an agent never inherits it, even
   * when its creator is the team owner.
   */
  is_team_owner: boolean;
}

/**
 * A project resolved with its access facts, flattened.
 *
 * `resolveProject` returns this shape so its ~45 existing call sites keep
 * reading `project.id` / `project.team_id` unchanged while gaining the
 * ownership facts.
 */
export interface ResolvedProject extends ProjectAccessFacts {
  id: string;
  team_id: string;
}

/** The nested form from the handoff, for callers that pass access around. */
export interface ProjectAccess extends ProjectAccessFacts {
  project: { id: string; team_id: string };
}

/** A nested resource resolved together with the project that contains it. */
export interface ProjectChildAccess<T> extends ProjectAccess {
  resource: T;
}

/** A refused check: the HTTP status to send and the message to send with it. */
export interface AccessDenial {
  status: 401 | 403;
  error: string;
}

export interface ProjectWriteOptions {
  /**
   * The explicit permission an API key must carry for this route. Checked here
   * as well as in `requirePermission` so the agent intersection — active key,
   * explicit permission, valid creator, current ownership, agent-supported
   * operation — holds in one place rather than across two layers.
   */
  permission?: Permission;
  /** The operation is human-only; agent principals are refused outright. */
  humanOnly?: boolean;
  /**
   * The singleton team owner's recovery authority satisfies this operation
   * even without project ownership. Owner-list management and deleting an
   * orphaned project are the only intended uses; ordinary writes must not set
   * it, or team ownership becomes a silent project-write bypass.
   */
  allowTeamOwnerRecovery?: boolean;
}

const NOT_FOUND = "Project not found";

/** The effective human actor behind a request, or null for client/import keys. */
export function resolveActorUserId(auth: AuthContext): string | null {
  if (auth.type === "user") return auth.user_id;
  return auth.key_type === "agent" ? auth.created_by : null;
}

/** Whether this request carries the singleton team owner's recovery authority. */
export function hasTeamOwnerAuthority(auth: AuthContext): boolean {
  return auth.type === "user" && auth.is_team_owner;
}

/**
 * `LEFT JOIN project_owners` restricted to the effective actor, so the joined
 * row exists exactly when that actor owns the project. The unique index on
 * (project_id, user_id) keeps it at most one row, so the join never multiplies
 * the result. With no actor (client/import key) the join is dead and ownership
 * resolves false without a second query.
 */
function ownerJoinCondition(actorUserId: string | null) {
  return actorUserId
    ? and(eq(projectOwners.project_id, projects.id), eq(projectOwners.user_id, actorUserId))
    : sql`false`;
}

/** The project predicate shared by every resolver: active, and inside a reachable team. */
function projectVisibleTo(auth: AuthContext) {
  return and(inArray(projects.team_id, getAuthTeamIds(auth)), isNull(projects.deleted_at));
}

function factsFrom(
  auth: AuthContext,
  actorUserId: string | null,
  ownerUserId: string | null,
): ProjectAccessFacts {
  return {
    actor_user_id: actorUserId,
    is_project_owner: ownerUserId !== null,
    is_team_owner: hasTeamOwnerAuthority(auth),
  };
}

/** Widen a flat resolved project into the nested access shape. */
export function toProjectAccess(project: ResolvedProject): ProjectAccess {
  return {
    project: { id: project.id, team_id: project.team_id },
    actor_user_id: project.actor_user_id,
    is_project_owner: project.is_project_owner,
    is_team_owner: project.is_team_owner,
  };
}

/**
 * Load a project and the caller's access to it in a single query.
 *
 * Returns `null` when the project does not exist, is soft-deleted, or belongs
 * to another team — the three are deliberately indistinguishable so a caller
 * cannot probe for cross-team project ids.
 */
export async function loadProjectAccess(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
): Promise<ResolvedProject | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(projects)
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(and(eq(projects.id, projectId), projectVisibleTo(auth)))
    .limit(1);

  if (!row) return null;
  return { id: row.id, team_id: row.team_id, ...factsFrom(auth, actorUserId, row.owner_user_id) };
}

/** Resolve a project into the nested access shape, or send 404 and return null. */
export async function resolveProjectAccess(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectAccess | null> {
  const resolved = await loadProjectAccess(fastify, projectId, auth);
  if (!resolved) {
    reply.code(404).send({ error: NOT_FOUND });
    return null;
  }
  return toProjectAccess(resolved);
}

/**
 * Decide an ordinary project write against already-resolved access.
 *
 * Returns `null` when the write is allowed, mirroring `assertTeamRole`'s
 * "error or null" convention. Every refusal here is a `403`: the caller has
 * already proven a valid identity and can see the project, they simply lack
 * the authority for this operation. Absent or invalid credentials never reach
 * this function — those are `401`s from the auth middleware.
 *
 * For an agent the checks compose as an intersection, never a union:
 * valid creator (established by the middleware) AND the route's explicit
 * permission AND current ownership AND the operation being agent-supported.
 */
export function evaluateProjectWrite(
  auth: AuthContext,
  access: ProjectAccessFacts,
  options: ProjectWriteOptions = {},
): AccessDenial | null {
  if (access.actor_user_id === null) {
    return {
      status: 403,
      error: "This operation requires a user session or an agent key",
    };
  }

  if (options.humanOnly && auth.type !== "user") {
    return { status: 403, error: "This operation requires a user session" };
  }

  if (options.permission && auth.type === "api_key" && !auth.permissions.includes(options.permission)) {
    return { status: 403, error: `Missing permission: ${options.permission}` };
  }

  if (access.is_project_owner) return null;

  if (options.allowTeamOwnerRecovery && access.is_team_owner) return null;

  return { status: 403, error: "Requires project ownership" };
}

/**
 * Resolve a project and enforce an ordinary project write on it.
 *
 * Sends its own `404` (invisible project) or `403` (visible but unauthorized)
 * and returns `null`, so handlers keep the established `if (!x) return;` shape.
 */
export async function enforceProjectWrite(
  fastify: FastifyInstance,
  projectId: string,
  auth: AuthContext,
  reply: FastifyReply,
  options: ProjectWriteOptions = {},
): Promise<ProjectAccess | null> {
  const access = await resolveProjectAccess(fastify, projectId, auth, reply);
  if (!access) return null;
  return applyProjectWrite(access, auth, reply, options);
}

/**
 * Enforce an ordinary project write against access already resolved by one of
 * the containment resolvers, so a nested mutation authorizes against the
 * project that actually contains the child.
 */
export function applyProjectWrite<T extends ProjectAccessFacts>(
  access: T,
  auth: AuthContext,
  reply: FastifyReply,
  options: ProjectWriteOptions = {},
): T | null {
  const denial = evaluateProjectWrite(auth, access, options);
  if (denial) {
    reply.code(denial.status).send({ error: denial.error });
    return null;
  }
  return access;
}

/* -------------------------------------------------------------------------
 * Containment resolvers
 *
 * Each joins child -> (parent ->)* project in ONE query and returns the child
 * row together with the access facts for the project that actually contains
 * it. A caller therefore cannot authorize against Project A and then mutate a
 * child of Project B by substituting the child id: the mismatch removes the
 * row from the result and the resolver answers 404.
 *
 * The 404 message names the child resource and never varies with *which* part
 * of the chain failed, so a mismatched, cross-team, deleted and nonexistent id
 * are indistinguishable from outside.
 * ---------------------------------------------------------------------- */

function contained<T>(
  auth: AuthContext,
  actorUserId: string | null,
  row: { resource: T; project_id: string; team_id: string; owner_user_id: string | null },
): ProjectChildAccess<T> {
  return {
    resource: row.resource,
    project: { id: row.project_id, team_id: row.team_id },
    ...factsFrom(auth, actorUserId, row.owner_user_id),
  };
}

function notFound(reply: FastifyReply, message: string): null {
  reply.code(404).send({ error: message });
  return null;
}

/** app -> project */
export async function resolveAppInProject(
  fastify: FastifyInstance,
  params: { projectId: string; appId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof apps.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: apps,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(apps)
    .innerJoin(projects, eq(projects.id, apps.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(apps.id, params.appId),
        eq(apps.project_id, params.projectId),
        isNull(apps.deleted_at),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "App not found");
  return contained(auth, actorUserId, row);
}

/** issue -> project */
export async function resolveIssueInProject(
  fastify: FastifyInstance,
  params: { projectId: string; issueId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof issues.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: issues,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(issues.id, params.issueId),
        eq(issues.project_id, params.projectId),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Issue not found");
  return contained(auth, actorUserId, row);
}

/** issue comment -> issue -> project */
export async function resolveIssueCommentInProject(
  fastify: FastifyInstance,
  params: { projectId: string; issueId: string; commentId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof issueComments.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: issueComments,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(issueComments)
    .innerJoin(issues, eq(issues.id, issueComments.issue_id))
    .innerJoin(projects, eq(projects.id, issues.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(issueComments.id, params.commentId),
        eq(issueComments.issue_id, params.issueId),
        isNull(issueComments.deleted_at),
        eq(issues.project_id, params.projectId),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Comment not found");
  return contained(auth, actorUserId, row);
}

/** feedback -> project */
export async function resolveFeedbackInProject(
  fastify: FastifyInstance,
  params: { projectId: string; feedbackId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof feedback.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: feedback,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(feedback)
    .innerJoin(projects, eq(projects.id, feedback.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(feedback.id, params.feedbackId),
        eq(feedback.project_id, params.projectId),
        isNull(feedback.deleted_at),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Feedback not found");
  return contained(auth, actorUserId, row);
}

/** feedback comment -> feedback -> project */
export async function resolveFeedbackCommentInProject(
  fastify: FastifyInstance,
  params: { projectId: string; feedbackId: string; commentId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof feedbackComments.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: feedbackComments,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(feedbackComments)
    .innerJoin(feedback, eq(feedback.id, feedbackComments.feedback_id))
    .innerJoin(projects, eq(projects.id, feedback.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(feedbackComments.id, params.commentId),
        eq(feedbackComments.feedback_id, params.feedbackId),
        isNull(feedbackComments.deleted_at),
        eq(feedback.project_id, params.projectId),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Comment not found");
  return contained(auth, actorUserId, row);
}

/** questionnaire -> project */
export async function resolveQuestionnaireInProject(
  fastify: FastifyInstance,
  params: { projectId: string; questionnaireId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof questionnaires.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: questionnaires,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(questionnaires)
    .innerJoin(projects, eq(projects.id, questionnaires.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(questionnaires.id, params.questionnaireId),
        eq(questionnaires.project_id, params.projectId),
        isNull(questionnaires.deleted_at),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Questionnaire not found");
  return contained(auth, actorUserId, row);
}

/**
 * response -> questionnaire -> project
 *
 * The join runs through `questionnaires` rather than trusting the response's
 * own denormalized `project_id`, so the response is proven to sit under the
 * questionnaire named in the URL and that questionnaire under the project.
 */
export async function resolveQuestionnaireResponseInProject(
  fastify: FastifyInstance,
  params: { projectId: string; questionnaireId: string; responseId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof questionnaireResponses.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: questionnaireResponses,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(questionnaireResponses)
    .innerJoin(questionnaires, eq(questionnaires.id, questionnaireResponses.questionnaire_id))
    .innerJoin(projects, eq(projects.id, questionnaires.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(questionnaireResponses.id, params.responseId),
        eq(questionnaireResponses.questionnaire_id, params.questionnaireId),
        isNull(questionnaireResponses.deleted_at),
        eq(questionnaires.project_id, params.projectId),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Response not found");
  return contained(auth, actorUserId, row);
}

/** response comment -> response -> questionnaire -> project */
export async function resolveQuestionnaireResponseCommentInProject(
  fastify: FastifyInstance,
  params: { projectId: string; questionnaireId: string; responseId: string; commentId: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof questionnaireResponseComments.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: questionnaireResponseComments,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(questionnaireResponseComments)
    .innerJoin(
      questionnaireResponses,
      eq(questionnaireResponses.id, questionnaireResponseComments.questionnaire_response_id),
    )
    .innerJoin(questionnaires, eq(questionnaires.id, questionnaireResponses.questionnaire_id))
    .innerJoin(projects, eq(projects.id, questionnaires.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(questionnaireResponseComments.id, params.commentId),
        eq(questionnaireResponseComments.questionnaire_response_id, params.responseId),
        isNull(questionnaireResponseComments.deleted_at),
        eq(questionnaireResponses.questionnaire_id, params.questionnaireId),
        isNull(questionnaireResponses.deleted_at),
        eq(questionnaires.project_id, params.projectId),
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Comment not found");
  return contained(auth, actorUserId, row);
}

/**
 * attachment -> app -> project
 *
 * The attachment route addresses the row directly (`/attachments/:id`) with no
 * project in the URL, so containment here means proving the attachment's app
 * and its own `project_id` agree and that the project is reachable. Passing
 * `projectId` additionally pins it to a project named elsewhere in the URL.
 */
export async function resolveAttachmentAccess(
  fastify: FastifyInstance,
  params: { attachmentId: string; projectId?: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<ProjectChildAccess<typeof eventAttachments.$inferSelect> | null> {
  const actorUserId = resolveActorUserId(auth);
  const [row] = await fastify.db
    .select({
      resource: eventAttachments,
      project_id: projects.id,
      team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(eventAttachments)
    .innerJoin(apps, eq(apps.id, eventAttachments.app_id))
    .innerJoin(projects, eq(projects.id, eventAttachments.project_id))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(eventAttachments.id, params.attachmentId),
        isNull(eventAttachments.deleted_at),
        eq(apps.project_id, eventAttachments.project_id),
        params.projectId ? eq(eventAttachments.project_id, params.projectId) : undefined,
        projectVisibleTo(auth),
      ),
    )
    .limit(1);

  if (!row) return notFound(reply, "Attachment not found");
  return contained(auth, actorUserId, row);
}

/**
 * job run -> project / team
 *
 * A run is project-scoped or team-scoped. A project-scoped run resolves its
 * access from that project; a team-scoped run has no project, so it carries no
 * project ownership and only the team predicate applies — team-wide runs are
 * authorized by the caller's team authority, not by project ownership.
 */
export interface JobRunAccess extends ProjectAccessFacts {
  resource: typeof jobRuns.$inferSelect;
  project: { id: string; team_id: string } | null;
}

export async function resolveJobRunAccess(
  fastify: FastifyInstance,
  params: { runId: string; projectId?: string },
  auth: AuthContext,
  reply: FastifyReply,
): Promise<JobRunAccess | null> {
  const actorUserId = resolveActorUserId(auth);
  const teamIds = getAuthTeamIds(auth);
  const [row] = await fastify.db
    .select({
      resource: jobRuns,
      project_id: projects.id,
      project_team_id: projects.team_id,
      owner_user_id: projectOwners.user_id,
    })
    .from(jobRuns)
    .leftJoin(projects, and(eq(projects.id, jobRuns.project_id), isNull(projects.deleted_at)))
    .leftJoin(projectOwners, ownerJoinCondition(actorUserId))
    .where(
      and(
        eq(jobRuns.id, params.runId),
        params.projectId ? eq(jobRuns.project_id, params.projectId) : undefined,
      ),
    )
    .limit(1);

  const missing = () => notFound(reply, "Job run not found");
  if (!row) return missing();

  // A run naming a project the caller cannot reach, or a team they are not in,
  // is indistinguishable from one that does not exist.
  if (row.resource.project_id && !row.project_id) return missing();
  if (row.project_team_id && !teamIds.includes(row.project_team_id)) return missing();
  if (row.resource.team_id && !teamIds.includes(row.resource.team_id)) return missing();
  if (!row.resource.project_id && !row.resource.team_id) return missing();

  return {
    resource: row.resource,
    project:
      row.project_id && row.project_team_id
        ? { id: row.project_id, team_id: row.project_team_id }
        : null,
    ...factsFrom(auth, actorUserId, row.owner_user_id),
  };
}
