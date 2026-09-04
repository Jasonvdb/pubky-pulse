/**
 * The single migration runner: everything that has to happen to bring a
 * database up to date lives here, so the CLI entry point (`migrate.ts`) and the
 * server test setup cannot drift apart.
 *
 * `events`, `metric_events` and `funnel_events` are `PARTITION BY RANGE
 * ("timestamp")` tables. Drizzle cannot express partitioning, so
 * `drizzle/0000_baseline.sql` is hand-edited to add the clause and this runner
 * verifies the result instead of re-creating the tables.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type postgres from "postgres";
import {
  ensurePartitions,
  ensureMetricEventPartitions,
  ensureFunnelEventPartitions,
} from "./partitions.js";

/**
 * Absolute path to the migrations directory.
 *
 * Resolved from this module's own URL rather than `process.cwd()`, the same
 * trick `load-root-env.ts` uses: `src/` (tsx) and `dist/` (compiled) sit at the
 * same depth, so `../drizzle` is correct from both and the runner works no
 * matter which directory the process was launched from.
 */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

/** Tables the baseline creates with `PARTITION BY RANGE ("timestamp")`. */
export const PARTITIONED_TABLES = ["events", "metric_events", "funnel_events"] as const;

/**
 * Fails if any of the high-volume tables is a plain table rather than a
 * partitioned one.
 *
 * The drizzle migrator does not compare stored hashes — it only applies
 * migrations whose journal timestamp is newer than the last applied one — so a
 * database created before the baseline gained its `PARTITION BY RANGE` clauses
 * silently skips the edited baseline and keeps its regular tables. Detecting
 * that here turns a subtle "partitions never appear" bug into a clear failure.
 */
async function assertPartitioned(client: postgres.Sql) {
  const rows = await client<{ relname: string; relkind: string }[]>`
    SELECT relname, relkind
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname::text = ANY(${[...PARTITIONED_TABLES]})
  `;

  const byName = new Map(rows.map((r) => [r.relname, r.relkind]));
  const wrong = PARTITIONED_TABLES.filter((t) => byName.get(t) !== "p");

  if (wrong.length === 0) return;

  const detail = wrong
    .map((t) => `${t} (${byName.has(t) ? `relkind=${byName.get(t)}` : "missing"})`)
    .join(", ");

  throw new Error(
    `Expected partitioned tables, found: ${detail}. This database predates the ` +
      `partitioned baseline migration — drizzle only applies migrations newer than the ` +
      `last one it recorded, so the edited drizzle/0000_baseline.sql was skipped. Drop and ` +
      `recreate the database, then re-run the migration: dropdb <name> && createdb <name>. ` +
      `(For a _test database that is safe to do outright; note that ` +
      `\`pnpm dev:unsafe-reset --yes\` only truncates and will not fix this.)`,
  );
}

/**
 * Applies every pending migration, verifies the partitioned tables really are
 * partitioned, and creates the monthly partitions for the current month plus
 * `monthsAhead - 1` following months.
 *
 * The caller owns the connection — this never opens or closes one, and never
 * loads `.env`; that stays in the CLI entry point.
 */
export async function runMigrations(
  client: postgres.Sql,
  opts: { monthsAhead?: number } = {},
) {
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  await assertPartitioned(client);

  const monthsAhead = opts.monthsAhead ?? 3;
  await ensurePartitions(client, monthsAhead);
  await ensureMetricEventPartitions(client, monthsAhead);
  await ensureFunnelEventPartitions(client, monthsAhead);
}
