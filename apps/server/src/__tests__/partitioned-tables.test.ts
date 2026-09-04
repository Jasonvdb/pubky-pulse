import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { findPartitionProblems } from "@pubky-pulse/db";
import type { PartitionedTableState } from "@pubky-pulse/db";
import { TEST_DB_URL } from "./setup.js";

// `events`, `metric_events` and `funnel_events` are PARTITION BY RANGE tables
// created that way by packages/db/drizzle/0000_baseline.sql, and their indexes
// are declared on the parent only — Postgres 11+ propagates them to every
// partition. This suite pins both halves of that contract: the parents really
// are partitioned, and a freshly attached partition inherits the full index set
// without packages/db/src/partitions.ts creating anything by hand.

// Index counts come from the parent CREATE INDEX statements in the baseline.
const PARTITIONED_TABLES: { table: string; indexCount: number }[] = [
  { table: "events", indexCount: 7 },
  { table: "metric_events", indexCount: 4 },
  { table: "funnel_events", indexCount: 4 },
];

// Far enough out that no other suite's partition covers it.
const PROBE_SUFFIX = "2099_01";
const PROBE_FROM = "2099-01-01";
const PROBE_TO = "2099-02-01";

let client: postgres.Sql;

beforeAll(async () => {
  client = postgres(TEST_DB_URL, { max: 1 });
  for (const { table } of PARTITIONED_TABLES) {
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${table}_${PROBE_SUFFIX}
        PARTITION OF ${table}
        FOR VALUES FROM ('${PROBE_FROM}') TO ('${PROBE_TO}')
    `);
  }
});

afterAll(async () => {
  for (const { table } of PARTITIONED_TABLES) {
    await client.unsafe(`DROP TABLE IF EXISTS ${table}_${PROBE_SUFFIX}`);
  }
  await client.end();
});

async function indexNames(tableName: string): Promise<string[]> {
  const rows = await client<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ${tableName}
    ORDER BY indexname
  `;
  return rows.map((r) => r.indexname);
}

interface InheritedIndex {
  index_name: string;
  parent_table: string | null;
}

async function partitionIndexes(partitionName: string): Promise<InheritedIndex[]> {
  const rows = await client<InheritedIndex[]>`
    SELECT ci.relname AS index_name, pt.relname AS parent_table
    FROM pg_index i
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    LEFT JOIN pg_inherits inh ON inh.inhrelid = ci.oid
    LEFT JOIN pg_index pi ON pi.indexrelid = inh.inhparent
    LEFT JOIN pg_class pt ON pt.oid = pi.indrelid
    WHERE t.relname = ${partitionName}
      AND t.relnamespace = 'public'::regnamespace
    ORDER BY ci.relname
  `;
  return rows;
}

describe("partitioned event tables", () => {
  it("creates events, metric_events and funnel_events as partitioned tables", async () => {
    const rows = await client<{ relname: string; relkind: string }[]>`
      SELECT relname, relkind FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname::text = ANY(${PARTITIONED_TABLES.map((t) => t.table)})
      ORDER BY relname
    `;

    expect(
      rows.map((r) => `${r.relname}=${r.relkind}`).sort(),
      "a table with relkind 'r' means the database predates the partitioned baseline",
    ).toEqual(PARTITIONED_TABLES.map((t) => `${t.table}=p`).sort());
  });

  for (const { table, indexCount } of PARTITIONED_TABLES) {
    it(`gives a new ${table} partition the parent's ${indexCount} indexes, all inherited`, async () => {
      const parentIndexes = await indexNames(table);
      expect(
        parentIndexes,
        `${table}: parent index count changed — update this test and the baseline together`,
      ).toHaveLength(indexCount);

      const partitionName = `${table}_${PROBE_SUFFIX}`;
      const childIndexes = await partitionIndexes(partitionName);

      expect(
        childIndexes.map((r) => r.index_name),
        `${partitionName}: index count differs from the parent — Postgres propagates parent ` +
          `indexes automatically, so a mismatch means an index was added per-partition or the ` +
          `parent index is missing from the baseline`,
      ).toHaveLength(indexCount);

      const notInherited = childIndexes.filter((r) => r.parent_table !== table);
      expect(
        notInherited.map((r) => r.index_name),
        `${partitionName}: indexes that are not pg_inherits children of a ${table} index`,
      ).toEqual([]);
    });
  }
});

// The migration runner's guard, exercised as a pure function so it needs no
// DDL. It has to reject an index-less partitioned parent as well as a plain
// table: a database initialised by the previous runner has relkind 'p' but
// zero parent indexes, and packages/db/src/partitions.ts now relies entirely on
// Postgres propagating the parent's indexes to each new partition.
describe("findPartitionProblems", () => {
  const healthy = (relname: string): PartitionedTableState => ({
    relname,
    relkind: "p",
    indexCount: 4,
  });

  const allHealthy = (): PartitionedTableState[] =>
    PARTITIONED_TABLES.map((t) => healthy(t.table));

  it("passes a partitioned parent that carries indexes", () => {
    expect(findPartitionProblems(allHealthy())).toEqual([]);
  });

  it("reports a partitioned parent with no indexes of its own", () => {
    const rows = allHealthy();
    rows[0] = { relname: "events", relkind: "p", indexCount: 0 };

    expect(findPartitionProblems(rows)).toEqual(["events (partitioned, but 0 parent indexes)"]);
  });

  it("reports a plain table", () => {
    const rows = allHealthy();
    rows[0] = { relname: "events", relkind: "r", indexCount: 7 };

    expect(findPartitionProblems(rows)).toEqual(["events (relkind=r)"]);
  });

  it("reports a missing table", () => {
    const rows = allHealthy().filter((r) => r.relname !== "funnel_events");

    expect(findPartitionProblems(rows)).toEqual(["funnel_events (missing)"]);
  });

  it("reports every offending table at once", () => {
    expect(
      findPartitionProblems([
        { relname: "events", relkind: "p", indexCount: 0 },
        { relname: "metric_events", relkind: "r", indexCount: 4 },
      ]),
    ).toEqual([
      "events (partitioned, but 0 parent indexes)",
      "metric_events (relkind=r)",
      "funnel_events (missing)",
    ]);
  });
});
