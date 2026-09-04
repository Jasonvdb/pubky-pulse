import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { appUsers } from "@pubky-pulse/db";
import {
  MAX_USER_PROPERTY_KEY_LENGTH,
  MAX_USER_PROPERTY_VALUE_LENGTH,
  MAX_USER_PROPERTIES_COUNT,
} from "@pubky-pulse/shared";
import type { SetUserPropertiesRequest, SetUserPropertiesResponse } from "@pubky-pulse/shared";
import { requirePermission } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { enforceWebAppOrigin } from "../middleware/origin.js";
import { mergeUserProperties } from "../utils/user-properties.js";
import { resolveAccessibleProjectIdFromApp } from "../utils/project.js";

export async function userPropertiesRoutes(app: FastifyInstance) {
  app.post<{ Body: SetUserPropertiesRequest }>(
    "/identity/properties",
    { preHandler: [requirePermission("users:write"), rateLimit, enforceWebAppOrigin] },
    async (request, reply) => {
      const auth = request.auth;
      const { user_id, properties } = request.body;

      if (!user_id || typeof user_id !== "string") {
        return reply.code(400).send({ error: "user_id is required" });
      }

      if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
        return reply.code(400).send({ error: "properties must be an object" });
      }

      // Validate keys and values, separate sets from deletes
      const toSet: Record<string, string> = {};
      const toDelete: string[] = [];
      for (const [key, value] of Object.entries(properties)) {
        if (typeof key !== "string" || key.length === 0) {
          return reply.code(400).send({ error: "Property keys must be non-empty strings" });
        }
        if (key.length > MAX_USER_PROPERTY_KEY_LENGTH) {
          return reply.code(400).send({ error: `Property key "${key}" exceeds max length of ${MAX_USER_PROPERTY_KEY_LENGTH}` });
        }
        if (typeof value !== "string") {
          return reply.code(400).send({ error: `Property value for "${key}" must be a string` });
        }
        if (value.length > MAX_USER_PROPERTY_VALUE_LENGTH) {
          return reply.code(400).send({ error: `Property value for "${key}" exceeds max length of ${MAX_USER_PROPERTY_VALUE_LENGTH}` });
        }
        if (value === "") {
          toDelete.push(key);
        } else {
          toSet[key] = value;
        }
      }

      // This route is SDK ingestion, not management: the target app comes from
      // the credential itself and never from the request, and a client or
      // import key deliberately carries no human project owner (handoff §2), so
      // it must keep working without one.
      //
      // Only those two key types belong on this data plane. An agent key acts
      // with its creator's authority, and there is no project owner check that
      // could be applied here — the app is not named in the request — so an
      // agent is refused outright rather than silently granted a project write.
      // A user session is refused for the same reason. This matches the
      // documented contract ("client keys only").
      if (auth.type !== "api_key" || (auth.key_type !== "client" && auth.key_type !== "import")) {
        return reply
          .code(403)
          .send({ error: "This endpoint requires a client or import key" });
      }

      const app_id = auth.app_id;
      if (!app_id) {
        return reply.code(400).send({ error: "Client key must be scoped to an app" });
      }

      // Predicated resolver: the app must be active and its project active and
      // inside a team this credential can reach. The unpredicated lookup this
      // replaces resolved any app in any team, so an app id that ever reached
      // it from elsewhere would hand back that project's id.
      const project_id = await resolveAccessibleProjectIdFromApp(app, app_id, auth);
      if (!project_id) {
        return reply.code(400).send({ error: "App not found" });
      }

      // Upsert properties (single DB round-trip, race-condition safe)
      if (Object.keys(toSet).length > 0) {
        await mergeUserProperties(app.db, project_id, user_id, toSet);
      }

      // Handle key deletions — requires reading current state
      if (toDelete.length > 0) {
        const [row] = await app.db
          .select({ id: appUsers.id, properties: appUsers.properties })
          .from(appUsers)
          .where(and(eq(appUsers.project_id, project_id), eq(appUsers.user_id, user_id)))
          .limit(1);

        if (row?.properties) {
          const current = row.properties as Record<string, string>;
          for (const key of toDelete) delete current[key];
          await app.db
            .update(appUsers)
            .set({ properties: current })
            .where(eq(appUsers.id, row.id));
        }
      }

      // Read final state for response + count validation
      const [final] = await app.db
        .select({ properties: appUsers.properties })
        .from(appUsers)
        .where(and(eq(appUsers.project_id, project_id), eq(appUsers.user_id, user_id)))
        .limit(1);

      const merged = (final?.properties as Record<string, string>) ?? {};

      if (Object.keys(merged).length > MAX_USER_PROPERTIES_COUNT) {
        return reply.code(400).send({
          error: `Total properties count exceeds max of ${MAX_USER_PROPERTIES_COUNT}`,
        });
      }

      return {
        updated: true,
        properties: merged,
      } satisfies SetUserPropertiesResponse;
    }
  );
}
