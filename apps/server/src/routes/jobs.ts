import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, desc, lt, or } from "drizzle-orm";
import { jobRuns } from "@pubky-pulse/db";
import { JOB_TYPES, JOB_TYPE_META, parseTimeParam } from "@pubky-pulse/shared";
import type { JobRunsQueryParams, JobType } from "@pubky-pulse/shared";
import { requirePermission, assertTeamRole, hasTeamAccess } from "../middleware/auth.js";
import { applyProjectWrite, enforceProjectWrite, resolveJobRunAccess } from "../utils/project-access.js";
import { logAuditEvent } from "../utils/audit.js";
import { serializeJobRun } from "../utils/serialize.js";
import { normalizeLimit } from "../utils/pagination.js";

export async function jobsRoutes(app: FastifyInstance) {
  // List team job runs
  app.get<{ Params: { teamId: string }; Querystring: JobRunsQueryParams }>(
    "/jobs",
    { preHandler: requirePermission("jobs:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;
      const { job_type, status, project_id, since, until, cursor, limit: limitStr } = request.query;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      if (auth.type === "user") {
        const roleError = assertTeamRole(auth, teamId, "admin");
        if (roleError) return reply.code(403).send({ error: roleError });
      }

      const limit = normalizeLimit(limitStr);
      const conditions = [eq(jobRuns.team_id, teamId)];

      if (job_type) conditions.push(eq(jobRuns.job_type, job_type));
      if (status) conditions.push(eq(jobRuns.status, status as any));
      if (project_id) conditions.push(eq(jobRuns.project_id, project_id));
      if (since) conditions.push(gte(jobRuns.created_at, parseTimeParam(since)));
      if (until) conditions.push(lte(jobRuns.created_at, parseTimeParam(until)));

      if (cursor) {
        const [cursorTs, cursorId] = cursor.split("|");
        if (cursorTs && cursorId) {
          const cursorDate = new Date(cursorTs);
          const cursorNextMs = new Date(cursorDate.getTime() + 1);
          conditions.push(
            or(
              lt(jobRuns.created_at, cursorDate),
              and(gte(jobRuns.created_at, cursorDate), lt(jobRuns.created_at, cursorNextMs), lt(jobRuns.id, cursorId)),
            )!,
          );
        }
      }

      const rows = await app.db
        .select()
        .from(jobRuns)
        .where(and(...conditions))
        .orderBy(desc(jobRuns.created_at), desc(jobRuns.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = pageRows[pageRows.length - 1];
      const nextCursor =
        hasMore && lastRow
          ? `${lastRow.created_at.toISOString()}|${lastRow.id}`
          : null;

      return {
        job_runs: pageRows.map(serializeJobRun),
        cursor: nextCursor,
        has_more: hasMore,
      };
    },
  );

  // Trigger a team job
  app.post<{
    Params: { teamId: string };
    Body: { job_type: string; project_id?: string; params?: Record<string, unknown>; notify?: boolean };
  }>(
    "/jobs/trigger",
    { preHandler: requirePermission("jobs:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { teamId } = request.params;
      const { job_type, project_id, params, notify } = request.body;

      if (!hasTeamAccess(auth, teamId)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      if (!job_type || !JOB_TYPES.includes(job_type as JobType)) {
        return reply.code(400).send({ error: `Invalid job_type. Must be one of: ${JOB_TYPES.join(", ")}` });
      }

      const meta = JOB_TYPE_META[job_type as JobType];
      if (meta.scope === "system") {
        return reply.code(400).send({ error: `Cannot trigger system job "${job_type}" via API` });
      }

      // `JOB_TYPE_META.scope` is only "system" | "project" and system jobs are
      // refused above, so every triggerable job is project-scoped and must name
      // its project. There is no team-wide maintenance trigger to special-case.
      if (!project_id) {
        return reply.code(400).send({ error: "project_id is required for project-scoped jobs" });
      }

      // Triggering a job writes to one project's data, so it is an ordinary
      // project write: the project's owner list decides, not team role. An
      // agent key additionally needs `jobs:write` and its creator's current
      // ownership.
      const access = await enforceProjectWrite(app, project_id, auth, reply, {
        permission: "jobs:write",
      });
      if (!access) return;

      // The run is recorded under the team from the URL, so the project must
      // actually belong to that team or the run would be filed against a team
      // that does not contain it.
      if (access.project.team_id !== teamId) {
        return reply.code(404).send({ error: "Project not found" });
      }

      // Check for duplicate running/pending job
      const duplicateConditions = [
        eq(jobRuns.job_type, job_type),
        eq(jobRuns.team_id, teamId),
        or(eq(jobRuns.status, "pending"), eq(jobRuns.status, "running"))!,
      ];
      if (project_id) {
        duplicateConditions.push(eq(jobRuns.project_id, project_id));
      }

      const [existing] = await app.db
        .select({ id: jobRuns.id, status: jobRuns.status })
        .from(jobRuns)
        .where(and(...duplicateConditions))
        .limit(1);

      if (existing) {
        return reply.code(409).send({
          error: "A job of this type is already running or pending",
          existing_run_id: existing.id,
        });
      }

      const triggeredBy =
        auth.type === "user"
          ? `manual:user:${auth.user_id}`
          : `manual:api_key:${auth.key_id}`;

      // Merge project_id into params so job handlers can access it uniformly
      const jobParams = {
        ...(project_id ? { project_id } : {}),
        ...params,
      };

      const run = await app.jobRunner.trigger(job_type, {
        triggeredBy,
        teamId,
        projectId: project_id,
        params: jobParams,
        notify: notify ?? false,
      });

      logAuditEvent(app.db, auth, {
        team_id: teamId,
        action: "create",
        resource_type: "job_run",
        resource_id: run.id,
        metadata: { job_type, project_id },
      });

      return reply.code(201).send({ job_run: serializeJobRun(run) });
    },
  );
}

export async function jobsByIdRoutes(app: FastifyInstance) {
  // Get single job run
  app.get<{ Params: { runId: string } }>(
    "/jobs/:runId",
    { preHandler: requirePermission("jobs:read") },
    async (request, reply) => {
      const { runId } = request.params;

      const [run] = await app.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.id, runId))
        .limit(1);

      if (!run) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      // Access check: team jobs require team access
      if (run.team_id && !hasTeamAccess(request.auth, run.team_id)) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      // System jobs (null team_id) are not accessible via this route
      if (!run.team_id) {
        return reply.code(404).send({ error: "Job run not found" });
      }

      return { job_run: serializeJobRun(run) };
    },
  );

  // Cancel a running job
  app.post<{ Params: { runId: string } }>(
    "/jobs/:runId/cancel",
    { preHandler: requirePermission("jobs:write") },
    async (request, reply) => {
      const { runId } = request.params;

      // Cancelling is a write on the run's own project, resolved through the
      // containment resolver so a run id from another project cannot be
      // cancelled by substituting it: an unreachable run, or one whose project
      // or team the caller cannot see, is a 404. Every run the trigger route
      // creates is project-scoped, so a run with no project (a scheduled
      // system run, or a team-scoped run) carries no project ownership and is
      // refused here.
      const access = await resolveJobRunAccess(app, { runId }, request.auth, reply);
      if (!access) return;
      if (!applyProjectWrite(access, request.auth, reply, { permission: "jobs:write" })) return;

      const run = access.resource;

      if (run.status !== "running") {
        return reply.code(400).send({ error: `Cannot cancel a job with status "${run.status}"` });
      }

      const cancelled = app.jobRunner.cancel(runId);
      if (!cancelled) {
        return reply.code(400).send({ error: "Job is not currently running on this server" });
      }

      return { cancelled: true };
    },
  );
}
