import { eq, isNull, and } from "drizzle-orm";
import { apps } from "@pubky-pulse/db";
import { compareVersions } from "@pubky-pulse/shared";
import type postgres from "postgres";
import type { JobHandler } from "../services/job-runner.js";

// 90-day window keeps partition pruning effective and matches the cadence at
// which apps actually release. Anything older is irrelevant for "latest".
const EVENTS_LOOKBACK_DAYS = 90;

async function computeLatestFromEvents(
  client: postgres.Sql,
  appId: string,
): Promise<string | null> {
  const rows = await client<{ app_version: string }[]>`
    SELECT DISTINCT app_version FROM events
    WHERE app_id = ${appId}
      AND is_dev = false
      AND app_version IS NOT NULL
      AND "timestamp" > NOW() - (${EVENTS_LOOKBACK_DAYS} || ' days')::interval
  `;
  if (rows.length === 0) return null;
  let max = rows[0].app_version;
  for (let i = 1; i < rows.length; i++) {
    if (compareVersions(rows[i].app_version, max) > 0) {
      max = rows[i].app_version;
    }
  }
  return max;
}

export const appVersionSyncHandler: JobHandler = async (ctx, params) => {
  const targetAppId = typeof params.app_id === "string" ? params.app_id : null;

  const baseQuery = ctx.db.select({ id: apps.id }).from(apps);

  const allApps = targetAppId
    ? await baseQuery.where(and(eq(apps.id, targetAppId), isNull(apps.deleted_at)))
    : await baseQuery.where(isNull(apps.deleted_at));

  let processed = 0;
  let computedSynced = 0;
  let nullified = 0;

  const client = ctx.createClient();
  try {
    for (const app of allApps) {
      if (ctx.isCancelled()) break;

      const version = await computeLatestFromEvents(client, app.id);
      if (version) {
        computedSynced++;
      } else {
        nullified++;
      }

      await ctx.db
        .update(apps)
        .set({
          latest_app_version: version,
          latest_app_version_updated_at: new Date(),
        })
        .where(eq(apps.id, app.id));

      processed++;
      if (processed % 10 === 0) {
        await ctx.updateProgress({
          processed,
          total: allApps.length,
          message: `Processed ${processed}/${allApps.length} apps`,
        });
      }
    }
  } finally {
    await client.end();
  }

  return {
    apps_processed: processed,
    computed_synced: computedSynced,
    no_version_available: nullified,
    _silent: computedSynced === 0,
  };
};
