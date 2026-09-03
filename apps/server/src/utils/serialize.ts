/**
 * Whether this caller is entitled to the secret of the key being serialized.
 *
 * It is a required argument rather than an optional flag so that a route which
 * forgets to decide does not silently serialize the credential: omitting it is
 * a compile error, not a leak. The decision itself belongs to the route, which
 * is the only layer that knows who is asking — see `routes/auth.ts`.
 */
export interface ApiKeySecretAccess {
  canReadSecret: boolean;
}

export function serializeApiKey(
  k: {
    id: string; secret: string; key_type: string; app_id: string | null;
    team_id: string; name: string; created_by: string | null; permissions: unknown;
    created_at: Date; updated_at: Date; last_used_at: Date | null; expires_at: Date | null;
    app_name?: string | null; created_by_email?: string | null;
  },
  access: ApiKeySecretAccess,
) {
  return {
    id: k.id,
    // Redacted secrets serialize as `null`, never as an omitted field and never
    // as some other key's secret: a client rendering the list can tell "you may
    // not see this" apart from "this key has no secret".
    secret: access.canReadSecret ? k.secret : null,
    key_type: k.key_type,
    app_id: k.app_id,
    team_id: k.team_id,
    name: k.name,
    created_by: k.created_by,
    permissions: k.permissions,
    created_at: k.created_at.toISOString(),
    updated_at: k.updated_at.toISOString(),
    last_used_at: k.last_used_at?.toISOString() || null,
    expires_at: k.expires_at?.toISOString() || null,
    app_name: k.app_name ?? null,
    created_by_email: k.created_by_email ?? null,
  };
}

export function serializeAuditLog(a: {
  id: string; team_id: string; actor_type: string; actor_id: string;
  action: string; resource_type: string; resource_id: string;
  changes: unknown; metadata: unknown; timestamp: Date;
}) {
  return {
    id: a.id,
    team_id: a.team_id,
    actor_type: a.actor_type,
    actor_id: a.actor_id,
    action: a.action,
    resource_type: a.resource_type,
    resource_id: a.resource_id,
    changes: a.changes,
    metadata: a.metadata,
    timestamp: a.timestamp.toISOString(),
  };
}

export function serializeAppUser(u: {
  id: string; project_id: string; user_id: string;
  is_anonymous: boolean; claimed_from: string[] | null;
  properties: Record<string, string> | null;
  apps: Array<{ app_id: string; app_name: string; first_seen_at: Date; last_seen_at: Date }>;
  first_seen_at: Date; last_seen_at: Date;
  last_country_code?: string | null;
  last_app_version?: string | null;
  last_sdk_name?: string | null;
  last_sdk_version?: string | null;
  last_locale?: string | null;
  last_preferred_language?: string | null;
  is_dev?: boolean;
}) {
  return {
    id: u.id,
    project_id: u.project_id,
    user_id: u.user_id,
    is_anonymous: u.is_anonymous,
    claimed_from: u.claimed_from,
    properties: u.properties,
    apps: u.apps.map((a) => ({
      app_id: a.app_id,
      app_name: a.app_name,
      first_seen_at: a.first_seen_at.toISOString(),
      last_seen_at: a.last_seen_at.toISOString(),
    })),
    first_seen_at: u.first_seen_at.toISOString(),
    last_seen_at: u.last_seen_at.toISOString(),
    last_country_code: u.last_country_code ?? null,
    last_app_version: u.last_app_version ?? null,
    last_sdk_name: u.last_sdk_name ?? null,
    last_sdk_version: u.last_sdk_version ?? null,
    last_locale: u.last_locale ?? null,
    last_preferred_language: u.last_preferred_language ?? null,
    is_dev: u.is_dev ?? false,
  };
}

export function serializeJobRun(r: {
  id: string; job_type: string; status: string;
  team_id: string | null; project_id: string | null;
  triggered_by: string; params: unknown; progress: unknown;
  result: unknown; error: string | null; notify: boolean;
  started_at: Date | null; completed_at: Date | null; created_at: Date;
}) {
  return {
    id: r.id,
    job_type: r.job_type,
    status: r.status,
    team_id: r.team_id,
    project_id: r.project_id,
    triggered_by: r.triggered_by,
    params: r.params,
    progress: r.progress,
    result: r.result,
    error: r.error,
    notify: r.notify,
    started_at: r.started_at?.toISOString() ?? null,
    completed_at: r.completed_at?.toISOString() ?? null,
    created_at: r.created_at.toISOString(),
  };
}

// --- Client secret lookup helpers ---
// These avoid duplicating the api_keys query across app/project routes, and
// they are the single funnel through which a client secret can reach a
// response: both take the caller's resolved access and refuse to *load* a
// secret the caller is not entitled to, rather than loading everything and
// hoping the route remembers to filter afterwards.

import { eq, and, inArray, isNull, or, gt, asc } from "drizzle-orm";
import { apiKeys } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";

/**
 * Whether this caller may see the client secret of the app being serialized.
 *
 * An app's client secret is a project credential, so the answer is "the caller
 * currently owns the app's project" — a team owner who does not own that
 * project is a non-owner here, exactly like any other viewer.
 */
export interface AppSecretAccess {
  canReadClientSecret: boolean;
}

export async function getClientSecret(
  db: Db,
  appId: string,
  access: AppSecretAccess,
): Promise<string | null> {
  if (!access.canReadClientSecret) return null;
  const now = new Date();
  const [row] = await db
    .select({ secret: apiKeys.secret })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.app_id, appId),
        eq(apiKeys.key_type, "client"),
        isNull(apiKeys.deleted_at),
        or(isNull(apiKeys.expires_at), gt(apiKeys.expires_at, now)),
      ),
    )
    .orderBy(asc(apiKeys.created_at))
    .limit(1);
  return row?.secret ?? null;
}

/**
 * Client secrets for many apps in one query, keyed by app id.
 *
 * Apps outside `ownedProjectIds` are dropped *before* the query runs, so an
 * unauthorized secret is never read out of the database in the first place.
 * Apps with no visible secret are simply absent from the map.
 */
export async function getClientSecretMap(
  db: Db,
  appRefs: ReadonlyArray<{ id: string; project_id: string }>,
  ownedProjectIds: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const appIds = appRefs.filter((a) => ownedProjectIds.has(a.project_id)).map((a) => a.id);
  if (appIds.length === 0) return new Map();
  const now = new Date();
  const rows = await db
    .select({ app_id: apiKeys.app_id, secret: apiKeys.secret })
    .from(apiKeys)
    .where(
      and(
        inArray(apiKeys.app_id, appIds),
        eq(apiKeys.key_type, "client"),
        isNull(apiKeys.deleted_at),
        or(isNull(apiKeys.expires_at), gt(apiKeys.expires_at, now)),
      ),
    )
    .orderBy(asc(apiKeys.created_at));
  const map = new Map<string, string>();
  for (const k of rows) {
    if (k.app_id && !map.has(k.app_id)) map.set(k.app_id, k.secret);
  }
  return map;
}

export function serializeApp(
  a: {
    id: string; team_id: string; project_id: string;
    name: string; platform: string; bundle_id: string | null;
    latest_app_version?: string | null;
    latest_app_version_updated_at?: Date | null;
    supported_languages?: string[] | null;
    supported_languages_source?: string | null;
    client_secret?: string | null;
    created_at: Date; deleted_at: Date | null;
  },
  access: AppSecretAccess,
) {
  return {
    id: a.id,
    team_id: a.team_id,
    project_id: a.project_id,
    name: a.name,
    platform: a.platform,
    bundle_id: a.bundle_id,
    latest_app_version: a.latest_app_version ?? null,
    latest_app_version_updated_at: a.latest_app_version_updated_at?.toISOString() ?? null,
    supported_languages: a.supported_languages ?? null,
    supported_languages_source: (a.supported_languages_source ?? null) as "sdk" | "manual" | null,
    // Second gate on the same decision the loaders above already applied: a
    // caller that hands in a secret it should not have still cannot publish it.
    client_secret: access.canReadClientSecret ? (a.client_secret ?? null) : null,
    created_at: a.created_at.toISOString(),
  };
}
