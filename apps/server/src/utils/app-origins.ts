import { and, eq, isNull } from "drizzle-orm";
import { apps } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import { normalizeOrigin } from "@pubky-pulse/shared";

/**
 * The browser-origin half of CORS.
 *
 * `CORS_ORIGINS` names the dashboard, which is one fixed deployment. Every
 * other allowed origin belongs to a `web` app and is edited by operators
 * through the API, so it cannot be a startup constant — the resolver reads the
 * union of every live web app's `allowed_origins` instead.
 *
 * That union is cached because CORS asks on every cross-origin request,
 * including every preflight. The cache is invalidated whenever an app is
 * created, updated or deleted in this process, and expires on its own after
 * `CACHE_TTL_MS` so a second process's write is picked up too.
 */
const CACHE_TTL_MS = 60_000;

let cache: { origins: Set<string>; expires_at: number } | null = null;

/** Drop the cached union. Called by the app write routes, and by tests. */
export function invalidateWebAppOriginsCache(): void {
  cache = null;
}

async function loadWebAppOrigins(db: Db): Promise<Set<string>> {
  const now = Date.now();
  if (cache && cache.expires_at > now) return cache.origins;

  const rows = await db
    .select({ allowed_origins: apps.allowed_origins })
    .from(apps)
    .where(and(eq(apps.platform, "web"), isNull(apps.deleted_at)));

  const origins = new Set<string>();
  for (const row of rows) {
    for (const origin of row.allowed_origins ?? []) origins.add(origin);
  }

  cache = { origins, expires_at: now + CACHE_TTL_MS };
  return origins;
}

/** The `origin` option for `@fastify/cors`, as its callback form. */
export type CorsOriginResolver = (
  origin: string | undefined,
  callback: (err: Error | null, allow: boolean) => void,
) => void;

/**
 * Allow an origin if the deployment configured it (the dashboard) or if some
 * live web app registered it.
 *
 * A request with no `Origin` header is allowed: it is not a browser request, so
 * there is nothing for CORS to decide. A database failure denies instead of
 * allowing — the configured origins are already answered above it, so the
 * dashboard keeps working while an unknown origin stays unknown.
 */
export function createCorsOriginResolver(
  db: Db,
  corsOrigins: readonly string[],
): CorsOriginResolver {
  const configured = new Set(corsOrigins);
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (configured.has(origin)) return callback(null, true);

    const normalized = normalizeOrigin(origin);
    if (!normalized) return callback(null, false);

    loadWebAppOrigins(db).then(
      (origins) => callback(null, origins.has(normalized)),
      () => callback(null, false),
    );
  };
}
