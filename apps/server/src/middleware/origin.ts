import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { apps } from "@pubky-pulse/db";
import { normalizeOrigin } from "@pubky-pulse/shared";

/** Enough of the offending value to spot the typo, never enough to flood a log. */
const MAX_ECHOED_ORIGIN_LENGTH = 200;

/**
 * Authorize the browser origin behind an SDK request against the app's own
 * `allowed_origins`.
 *
 * A web app's client key ships inside the page, so anyone can read it. CORS
 * alone does not stop that key being replayed — it is a browser courtesy, not
 * a server check, and a non-browser caller ignores it entirely. This is the
 * server check: when the credential belongs to a `web` app and the request
 * carries an `Origin`, the origin must be one the operator registered.
 *
 * Requests with no `Origin` pass untouched. That is every native SDK, every
 * backend SDK and every curl — none of them can forge a browser origin, so
 * refusing them would break the platforms this list has nothing to say about
 * without making a stolen web key any less usable.
 *
 * Runs after `requirePermission`, which is what populates `request.auth`, and
 * queries only when an `Origin` is actually present so non-browser ingest pays
 * nothing for it.
 */
export async function enforceWebAppOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return;

  const auth = request.auth;
  if (!auth || auth.type !== "api_key" || !auth.app_id) return;

  const [appRow] = await request.server.db
    .select({ platform: apps.platform, allowed_origins: apps.allowed_origins })
    .from(apps)
    .where(and(eq(apps.id, auth.app_id), isNull(apps.deleted_at)))
    .limit(1);

  // A deleted or missing app is the route's own 400 to send, with its own
  // message; this hook only decides origins.
  if (!appRow || appRow.platform !== "web") return;

  const normalized = normalizeOrigin(origin);
  if (normalized && appRow.allowed_origins.includes(normalized)) return;

  reply.code(403).send({
    error:
      `Origin "${origin.slice(0, MAX_ECHOED_ORIGIN_LENGTH)}" is not an allowed origin for this ` +
      "app. Add it to the app's allowed_origins (PATCH /v1/apps/:id) before sending from it.",
  });
}
