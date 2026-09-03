import type { FastifyInstance } from "fastify";
import { eq, and, inArray, isNull, asc } from "drizzle-orm";
import { apps, apiKeys } from "@pubky-pulse/db";
import type { CreateAppRequest, UpdateAppRequest } from "@pubky-pulse/shared";
import { APP_PLATFORMS, DEFAULT_API_KEY_PERMISSIONS, generateApiKeySecret } from "@pubky-pulse/shared";
import { requirePermission, getAuthTeamIds } from "../middleware/auth.js";
import { serializeApp, getClientSecret, getClientSecretMap } from "../utils/serialize.js";
import { logAuditEvent } from "../utils/audit.js";
import {
  applyProjectWrite,
  enforceProjectWrite,
  resolveActorUserId,
  resolveAppInProject,
} from "../utils/project-access.js";
import { getOwnedProjectIds } from "../utils/project-owners.js";

export async function appsRoutes(app: FastifyInstance) {
  // List apps for the authenticated user's teams
  app.get<{ Querystring: { team_id?: string } }>(
    "/apps",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const allTeamIds = getAuthTeamIds(auth);
      const { team_id } = request.query;

      // If team_id is specified, validate access and scope to that team
      const teamIds = team_id
        ? (allTeamIds.includes(team_id) ? [team_id] : [])
        : allTeamIds;

      if (teamIds.length === 0) {
        return { apps: [] };
      }

      const rows = await app.db
        .select()
        .from(apps)
        .where(and(inArray(apps.team_id, teamIds), isNull(apps.deleted_at)))
        .orderBy(asc(apps.created_at), asc(apps.id));

      // A client secret is a project credential, so only the apps in projects
      // this caller owns are eligible — and the ownership set is resolved
      // before the secrets are loaded, so an unowned secret never leaves the
      // database. Everyone else still sees the app row with a null secret.
      const ownedProjectIds = await getOwnedProjectIds(
        app.db,
        resolveActorUserId(auth),
        [...new Set(rows.map(r => r.project_id))],
      );
      const secretMap = await getClientSecretMap(app.db, rows, ownedProjectIds);

      return {
        apps: rows.map(r => serializeApp(
          { ...r, client_secret: secretMap.get(r.id) ?? null },
          { canReadClientSecret: ownedProjectIds.has(r.project_id) },
        )),
      };
    }
  );

  // Get single app
  app.get<{ Params: { id: string } }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:read") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;

      // Reading an app is a team-membership read, but reading its client
      // secret is not: the app is resolved together with its project so the
      // same request also answers "does this caller own that project".
      const contained = await resolveAppInProject(app, { appId: id }, auth, reply);
      if (!contained) return;
      const existing = contained.resource;
      const access = { canReadClientSecret: contained.is_project_owner };

      return serializeApp(
        { ...existing, client_secret: await getClientSecret(app.db, id, access) },
        access,
      );
    }
  );

  // Create app (team derived from project)
  app.post<{ Body: CreateAppRequest }>(
    "/apps",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { name, platform, bundle_id, project_id } = request.body;

      if (!name || !platform || !project_id) {
        return reply
          .code(400)
          .send({
            error: "name, platform, and project_id are required",
          });
      }

      if (!(APP_PLATFORMS as readonly string[]).includes(platform)) {
        return reply
          .code(400)
          .send({ error: `Invalid platform. Must be one of: ${APP_PLATFORMS.join(", ")}` });
      }

      // Backend apps don't need a bundle_id; all other platforms require it
      if (platform !== "backend" && !bundle_id) {
        return reply
          .code(400)
          .send({ error: "bundle_id is required for non-backend platforms" });
      }

      // An app is project configuration, so creating one is an ordinary
      // project write: the project's owner list decides, not team role. This
      // sends 404 for a project the caller cannot see — a cross-team project id
      // stays indistinguishable from a missing one — and 403 when they can see
      // it but do not own it. For an agent key it additionally requires
      // `apps:write` and its creator's current ownership.
      const access = await enforceProjectWrite(app, project_id, auth, reply, {
        permission: "apps:write",
      });
      if (!access) return;
      const project = access.project;

      const clientSecret = generateApiKeySecret("client");

      const created = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(apps)
          .values({
            team_id: project.team_id,
            project_id,
            name,
            platform,
            bundle_id: bundle_id || null,
          })
          .returning();

        await tx
          .insert(apiKeys)
          .values({
            secret: clientSecret,
            key_type: "client",
            app_id: created.id,
            team_id: project.team_id,
            name: `${name} Client Key`,
            created_by: auth.type === "user" ? auth.user_id : auth.created_by,
            permissions: DEFAULT_API_KEY_PERMISSIONS.client,
          });

        return { ...created, client_secret: clientSecret };
      });

      logAuditEvent(app.db, auth, {
        team_id: project.team_id,
        action: "create",
        resource_type: "app",
        resource_id: created.id,
        metadata: { name, platform, bundle_id: bundle_id || null },
      });

      // The creator just proved project ownership above, so they are entitled
      // to the client secret this request minted.
      return reply.code(201).send(serializeApp(created, { canReadClientSecret: true }));
    }
  );

  // Update app
  app.patch<{ Params: { id: string }; Body: UpdateAppRequest }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params;
      const { name } = request.body;

      if (!name) {
        return reply.code(400).send({ error: "At least one field to update is required" });
      }

      // The app is resolved together with the project that contains it, so
      // authorization is applied to that project rather than to the caller's
      // team: an app id from a project the caller does not own cannot be
      // updated by substituting it here.
      const contained = await resolveAppInProject(app, { appId: id }, auth, reply);
      if (!contained) return;
      if (!applyProjectWrite(contained, auth, reply, { permission: "apps:write" })) return;
      const existing = contained.resource;

      const [updated] = await app.db
        .update(apps)
        .set({ name })
        .where(eq(apps.id, id))
        .returning();

      logAuditEvent(app.db, auth, {
        team_id: existing.team_id,
        action: "update",
        resource_type: "app",
        resource_id: id,
        changes: { name: { before: existing.name, after: name } },
      });

      // Only a project owner reaches this line, so the secret is theirs to see.
      const patchAccess = { canReadClientSecret: true };
      return serializeApp(
        { ...updated, client_secret: await getClientSecret(app.db, id, patchAccess) },
        patchAccess,
      );
    }
  );

  // Delete app (soft delete)
  app.delete<{ Params: { id: string } }>(
    "/apps/:id",
    { preHandler: requirePermission("apps:write") },
    async (request, reply) => {
      const auth = request.auth;

      if (auth.type !== "user") {
        return reply.code(403).send({ error: "Only users can delete apps" });
      }

      const { id } = request.params;

      // Deleting an app is one of the deliberately human-only destructive
      // operations (handoff §2): an agent key never reaches here, even when its
      // creator owns the project and it carries `apps:write`.
      const contained = await resolveAppInProject(app, { appId: id }, auth, reply);
      if (!contained) return;
      if (
        !applyProjectWrite(contained, auth, reply, {
          permission: "apps:write",
          humanOnly: true,
        })
      ) {
        return;
      }
      const existing = contained.resource;

      const now = new Date();

      // Soft-delete the app and its api_keys
      await Promise.all([
        app.db
          .update(apps)
          .set({ deleted_at: now })
          .where(eq(apps.id, id)),
        app.db
          .update(apiKeys)
          .set({ deleted_at: now })
          .where(and(eq(apiKeys.app_id, id), isNull(apiKeys.deleted_at))),
      ]);

      logAuditEvent(app.db, auth, {
        team_id: existing.team_id,
        action: "delete",
        resource_type: "app",
        resource_id: id,
      });

      return { deleted: true };
    }
  );
}
