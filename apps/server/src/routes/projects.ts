import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, isNotNull, asc } from "drizzle-orm";
import { projects, apps, apiKeys, metricDefinitions, funnelDefinitions } from "@pubky-pulse/db";
import type {
  CreateProjectRequest,
  ProjectOwnerResponse,
  UpdateProjectRequest,
} from "@pubky-pulse/shared";
import {
  SLUG_REGEX,
  PG_UNIQUE_VIOLATION,
  DEFAULT_RETENTION_DAYS_EVENTS,
  DEFAULT_RETENTION_DAYS_METRICS,
  DEFAULT_RETENTION_DAYS_FUNNELS,
  DEFAULT_ATTACHMENT_USER_QUOTA_BYTES,
  DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_ATTACHMENT_USER_QUOTA_BYTES,
  MAX_ATTACHMENT_USER_QUOTA_BYTES,
  MIN_ATTACHMENT_PROJECT_QUOTA_BYTES,
  MAX_ATTACHMENT_PROJECT_QUOTA_BYTES,
  ISSUE_ALERT_FREQUENCIES,
  isValidProjectColor,
} from "@pubky-pulse/shared";
import { serializeApp, getClientSecretMap } from "../utils/serialize.js";
import { requirePermission, getAuthTeamIds, hasTeamAccess } from "../middleware/auth.js";
import { logAuditEvent } from "../utils/audit.js";
import { pickUnusedProjectColor } from "../utils/project-color.js";
import {
  enforceProjectWrite,
  evaluateProjectWrite,
  resolveActorUserId,
  resolveProjectAccess,
} from "../utils/project-access.js";
import {
  addProjectOwner,
  countProjectOwners,
  getProjectOwnerMap,
  getProjectOwners,
  resolveAccessLevel,
} from "../utils/project-owners.js";

/**
 * Every project response carries its owner list and the caller's own effective
 * access, so a client never has to infer write authority from team role. The
 * owners are passed in rather than fetched here because the list endpoint loads
 * them for the whole page in one query.
 */
function serializeProject(
  p: typeof projects.$inferSelect,
  owners: ProjectOwnerResponse[],
  actorUserId: string | null,
) {
  return {
    id: p.id,
    team_id: p.team_id,
    name: p.name,
    slug: p.slug,
    color: p.color,
    retention_days_events: p.retention_days_events,
    retention_days_metrics: p.retention_days_metrics,
    retention_days_funnels: p.retention_days_funnels,
    effective_retention_days_events: p.retention_days_events ?? DEFAULT_RETENTION_DAYS_EVENTS,
    effective_retention_days_metrics: p.retention_days_metrics ?? DEFAULT_RETENTION_DAYS_METRICS,
    effective_retention_days_funnels: p.retention_days_funnels ?? DEFAULT_RETENTION_DAYS_FUNNELS,
    attachment_user_quota_bytes: p.attachment_user_quota_bytes,
    attachment_project_quota_bytes: p.attachment_project_quota_bytes,
    effective_attachment_user_quota_bytes: p.attachment_user_quota_bytes ?? DEFAULT_ATTACHMENT_USER_QUOTA_BYTES,
    effective_attachment_project_quota_bytes: p.attachment_project_quota_bytes ?? DEFAULT_ATTACHMENT_PROJECT_QUOTA_BYTES,
    issue_alert_frequency: p.issue_alert_frequency,
    effective_issue_alert_frequency: p.issue_alert_frequency ?? "daily",
    created_at: p.created_at.toISOString(),
    owners,
    access_level: resolveAccessLevel(owners, actorUserId),
  };
}

function validateIntegerInRange(value: unknown, field: string, min: number, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${field} must be an integer or null`;
  }
  if (value < min || value > max) {
    return `${field} must be between ${min} and ${max}`;
  }
  return null;
}

export async function projectsRoutes(app: FastifyInstance) {
  // List projects for the authenticated user's teams
  app.get<{ Querystring: { team_id?: string } }>(
    "/projects",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id } = request.query;

      // If team_id is specified, validate access and scope to that team
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { projects: [] };
      }

      const rows = await app.db
        .select()
        .from(projects)
        .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)))
        .orderBy(asc(projects.created_at), asc(projects.id));

      // One owner query for the whole page, not one per project.
      const ownerMap = await getProjectOwnerMap(app.db, rows.map((r) => r.id));
      const actorUserId = resolveActorUserId(auth);

      return {
        projects: rows.map((r) => serializeProject(r, ownerMap.get(r.id) ?? [], actorUserId)),
      };
    }
  );

  // Get single project with its apps
  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      const [project] = await app.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const projectApps = await app.db
        .select()
        .from(apps)
        .where(and(eq(apps.project_id, id), isNull(apps.deleted_at)));

      const secretMap = await getClientSecretMap(app.db, projectApps.map(a => a.id));
      const owners = await getProjectOwners(app.db, id);

      return {
        ...serializeProject(project, owners, resolveActorUserId(auth)),
        apps: projectApps.map(a => serializeApp({ ...a, client_secret: secretMap.get(a.id) ?? null })),
      };
    }
  );

  // Create project
  app.post<{ Body: CreateProjectRequest }>(
    "/projects",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { team_id, name, slug, retention_days_events, retention_days_metrics, retention_days_funnels } = request.body;

      if (!team_id || !name || !slug) {
        return reply
          .code(400)
          .send({ error: "team_id, name, and slug are required" });
      }

      if (!SLUG_REGEX.test(slug)) {
        return reply
          .code(400)
          .send({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      for (const [field, value] of Object.entries({ retention_days_events, retention_days_metrics, retention_days_funnels })) {
        const err = validateIntegerInRange(value, field, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
        if (err) return reply.code(400).send({ error: err });
      }

      if (!hasTeamAccess(auth, team_id)) {
        return reply.code(403).send({ error: "Not a member of this team" });
      }

      // Any member of the team may create a project; there is no team-level
      // role gate on creation any more. What creation *does* require is an
      // effective human actor to become the first owner — a client or import
      // key has none, so those are refused even if they somehow carry
      // `projects:write`. For an agent key the actor is its `created_by`, never
      // the key itself: a key is not a person and cannot own a project.
      const actorUserId = resolveActorUserId(auth);
      if (actorUserId === null) {
        return reply
          .code(403)
          .send({ error: "This operation requires a user session or an agent key" });
      }

      try {
        const color = await pickUnusedProjectColor(app.db, team_id);

        // The project and its first owner are inserted together. A project that
        // committed without an owner row would be ownerless, and therefore
        // writable by nobody but the team owner's recovery path.
        const created = await app.db.transaction(async (tx) => {
          // Clear any soft-deleted project with the same slug so it can be reused
          await tx
            .delete(projects)
            .where(
              and(
                eq(projects.team_id, team_id),
                eq(projects.slug, slug),
                isNotNull(projects.deleted_at)
              )
            );

          const [row] = await tx
            .insert(projects)
            .values({
              team_id,
              name,
              slug,
              color,
              retention_days_events: retention_days_events ?? null,
              retention_days_metrics: retention_days_metrics ?? null,
              retention_days_funnels: retention_days_funnels ?? null,
            })
            .returning();

          await addProjectOwner(tx, row.id, actorUserId);

          return row;
        });

        logAuditEvent(app.db, auth, {
          team_id,
          action: "create",
          resource_type: "project",
          resource_id: created.id,
          metadata: { name, slug },
        });
        logAuditEvent(app.db, auth, {
          team_id,
          action: "create",
          resource_type: "project_owner",
          resource_id: actorUserId,
          metadata: { project_id: created.id },
        });

        const owners = await getProjectOwners(app.db, created.id);
        return reply.code(201).send(serializeProject(created, owners, actorUserId));
      } catch (err: any) {
        if (err.code === PG_UNIQUE_VIOLATION) {
          return reply
            .code(409)
            .send({ error: "A project with this slug already exists in your team" });
        }
        throw err;
      }
    }
  );

  // Update project
  app.patch<{ Params: { id: string }; Body: UpdateProjectRequest }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const {
        name,
        color,
        retention_days_events,
        retention_days_metrics,
        retention_days_funnels,
        attachment_user_quota_bytes,
        attachment_project_quota_bytes,
        issue_alert_frequency,
      } = request.body;

      const hasRetention = retention_days_events !== undefined || retention_days_metrics !== undefined || retention_days_funnels !== undefined;
      const hasAttachmentQuota = attachment_user_quota_bytes !== undefined || attachment_project_quota_bytes !== undefined;
      if (!name && color === undefined && !hasRetention && !hasAttachmentQuota && issue_alert_frequency === undefined) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      if (color !== undefined && !isValidProjectColor(color)) {
        return reply.code(400).send({ error: "color must be a valid hex code in #RRGGBB format" });
      }

      for (const [field, value] of Object.entries({ retention_days_events, retention_days_metrics, retention_days_funnels })) {
        const err = validateIntegerInRange(value, field, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
        if (err) return reply.code(400).send({ error: err });
      }

      for (const [field, value, min, max] of [
        ["attachment_user_quota_bytes", attachment_user_quota_bytes, MIN_ATTACHMENT_USER_QUOTA_BYTES, MAX_ATTACHMENT_USER_QUOTA_BYTES],
        ["attachment_project_quota_bytes", attachment_project_quota_bytes, MIN_ATTACHMENT_PROJECT_QUOTA_BYTES, MAX_ATTACHMENT_PROJECT_QUOTA_BYTES],
      ] as const) {
        const err = validateIntegerInRange(value, field, min, max);
        if (err) return reply.code(400).send({ error: err });
      }

      if (issue_alert_frequency !== undefined && !ISSUE_ALERT_FREQUENCIES.includes(issue_alert_frequency)) {
        return reply.code(400).send({ error: `issue_alert_frequency must be one of: ${ISSUE_ALERT_FREQUENCIES.join(", ")}` });
      }

      // Ordinary project write: owner-only, and for an agent key additionally
      // gated on `projects:write` and on its creator's current ownership. Team
      // ownership alone is deliberately not enough — recovery authority is not
      // an ordinary write bypass.
      const access = await enforceProjectWrite(app, id, auth, reply, {
        permission: "projects:write",
      });
      if (!access) return;

      const [project] = await app.db
        .select({
          id: projects.id,
          team_id: projects.team_id,
          name: projects.name,
          color: projects.color,
          retention_days_events: projects.retention_days_events,
          retention_days_metrics: projects.retention_days_metrics,
          retention_days_funnels: projects.retention_days_funnels,
          attachment_user_quota_bytes: projects.attachment_user_quota_bytes,
          attachment_project_quota_bytes: projects.attachment_project_quota_bytes,
          issue_alert_frequency: projects.issue_alert_frequency,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, id),
            inArray(projects.team_id, getAuthTeamIds(auth)),
            isNull(projects.deleted_at)
          )
        )
        .limit(1);

      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const setFields: Record<string, unknown> = {};
      const changes: Record<string, { before: unknown; after: unknown }> = {};

      if (name !== undefined) {
        setFields.name = name;
        changes.name = { before: project.name, after: name };
      }
      if (color !== undefined) {
        setFields.color = color;
        changes.color = { before: project.color, after: color };
      }
      if (retention_days_events !== undefined) {
        setFields.retention_days_events = retention_days_events;
        changes.retention_days_events = { before: project.retention_days_events, after: retention_days_events };
      }
      if (retention_days_metrics !== undefined) {
        setFields.retention_days_metrics = retention_days_metrics;
        changes.retention_days_metrics = { before: project.retention_days_metrics, after: retention_days_metrics };
      }
      if (retention_days_funnels !== undefined) {
        setFields.retention_days_funnels = retention_days_funnels;
        changes.retention_days_funnels = { before: project.retention_days_funnels, after: retention_days_funnels };
      }
      if (attachment_user_quota_bytes !== undefined) {
        setFields.attachment_user_quota_bytes = attachment_user_quota_bytes;
        changes.attachment_user_quota_bytes = { before: project.attachment_user_quota_bytes, after: attachment_user_quota_bytes };
      }
      if (attachment_project_quota_bytes !== undefined) {
        setFields.attachment_project_quota_bytes = attachment_project_quota_bytes;
        changes.attachment_project_quota_bytes = { before: project.attachment_project_quota_bytes, after: attachment_project_quota_bytes };
      }
      if (issue_alert_frequency !== undefined) {
        setFields.issue_alert_frequency = issue_alert_frequency;
        changes.issue_alert_frequency = { before: project.issue_alert_frequency, after: issue_alert_frequency };
      }

      const [updated] = await app.db
        .update(projects)
        .set(setFields)
        .where(eq(projects.id, id))
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "update",
        resource_type: "project",
        resource_id: id,
        changes,
      });

      const owners = await getProjectOwners(app.db, id);
      return serializeProject(updated, owners, access.actor_user_id);
    }
  );

  // Delete project (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: requirePermission("projects:write") },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete projects" });
      }

      const { id } = request.params;

      const access = await resolveProjectAccess(app, id, auth, reply);
      if (!access) return;

      // Deletion is an ordinary project-owner write, plus one recovery
      // exception: the singleton team owner may delete a project that has no
      // owners at all, because otherwise an orphaned project could never be
      // cleaned up. The exception is enabled only once the project is *proved*
      // orphaned, so team ownership never becomes a general delete bypass. An
      // owner already passes, so the count is only paid on the other path.
      const orphaned = access.is_project_owner
        ? false
        : (await countProjectOwners(app.db, id)) === 0;

      const denial = evaluateProjectWrite(auth, access, {
        permission: "projects:write",
        humanOnly: true,
        allowTeamOwnerRecovery: orphaned,
      });
      if (denial) {
        return reply.code(denial.status).send({ error: denial.error });
      }

      const project = access.project;
      const now = new Date();

      // Find app IDs for cascading to api_keys
      const projectApps = await app.db
        .select({ id: apps.id })
        .from(apps)
        .where(and(eq(apps.project_id, id), isNull(apps.deleted_at)));
      const appIds = projectApps.map((a) => a.id);

      // Soft-delete the project, its apps, their api_keys, and definitions
      await Promise.all([
        app.db
          .update(apps)
          .set({ deleted_at: now })
          .where(and(eq(apps.project_id, id), isNull(apps.deleted_at))),
        app.db
          .update(projects)
          .set({ deleted_at: now })
          .where(eq(projects.id, id)),
        app.db
          .update(metricDefinitions)
          .set({ deleted_at: now })
          .where(and(eq(metricDefinitions.project_id, id), isNull(metricDefinitions.deleted_at))),
        app.db
          .update(funnelDefinitions)
          .set({ deleted_at: now })
          .where(and(eq(funnelDefinitions.project_id, id), isNull(funnelDefinitions.deleted_at))),
        ...(appIds.length > 0
          ? [app.db
              .update(apiKeys)
              .set({ deleted_at: now })
              .where(and(inArray(apiKeys.app_id, appIds), isNull(apiKeys.deleted_at)))]
          : []),
      ]);

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "delete",
        resource_type: "project",
        resource_id: id,
      });

      return { deleted: true };
    }
  );
}
