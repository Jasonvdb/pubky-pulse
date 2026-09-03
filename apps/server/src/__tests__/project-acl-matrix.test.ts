import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import type { Permission } from "@pubky-pulse/shared";
import type { JobHandler } from "../services/job-runner.js";
import {
  buildApp,
  truncateAll,
  seedTestData,
  createUserAndGetToken,
  createProjectWithOwner,
  getTokenAndTeamId,
  TEST_CLIENT_KEY,
  TEST_IMPORT_KEY,
  TEST_DB_URL,
} from "./setup.js";

/**
 * The route-wiring matrix (handoff §8 "Mutation coverage", §12 "Route-wiring
 * matrix") for the non-comment project-scoped mutations: apps, metric and
 * funnel definitions, attachment deletion and project jobs.
 *
 * `project-access.test.ts` proves the central policy against the helper.
 * This suite proves each endpoint is actually *wired* to it, from the outside,
 * by driving one typed row per mutation endpoint through the same six
 * principals. It is about authorization only — field validation, pagination
 * and business behaviour stay with each route's own suite.
 *
 * Every row asserts, against Project A:
 *
 *   - an eligible project owner succeeds AND the intended state transition
 *     actually happened in the database;
 *   - a same-team viewer gets 403 AND every row the mutation would have
 *     touched is untouched — a 403 that still mutated would be worse than the
 *     bug being fixed;
 *   - the singleton team owner, owning neither project, gets 403: team
 *     ownership is not a silent project-write bypass;
 *   - an owning agent succeeds only where the operation is agent-supported
 *     (handoff §2), and gets 403 where it is human-only;
 *   - an agent holding the permission whose *creator* does not own the project
 *     gets 403 — agent authorization is an intersection, never a union;
 *   - an owning agent without the route's explicit permission gets 403.
 *
 * Canonical actors, as in `project-access.test.ts`:
 *   teamOwner — configured singleton team owner; owns neither project;
 *   ownerA    — member, first owner of Project A;
 *   ownerB    — member, first owner of Project B, so a viewer of Project A.
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed
 * domains (vitest.config.ts); no deployment domain appears here.
 *
 * `POST /v1/identity/properties` is the one mutation in these modules with no
 * owner/viewer/agent axis at all — it is the SDK ingestion data plane, keyed by
 * a client or import credential — so it gets its own describe at the bottom
 * rather than a row whose every column would be empty.
 */

let app: FastifyInstance;
let client: postgres.Sql;

interface Actor {
  userId: string;
  token: string;
}

/** The permissions the "owning agent" keys carry: every route in the matrix. */
const AGENT_WRITE_PERMISSIONS: Permission[] = [
  "apps:write",
  "metrics:write",
  "funnels:write",
  "events:write",
  "jobs:write",
];

/** A permission no row in the matrix requires, for the "missing permission" key. */
const UNRELATED_PERMISSION: Permission[] = ["events:read"];

/** The project-scoped job type the cancel row keeps running until cancelled. */
const SLOW_JOB_TYPE = "stats_aggregate_hourly";

/** The project-scoped job type the trigger row fires (the fast test stub). */
const FAST_JOB_TYPE = "stats_aggregate_daily";

let teamId: string;
let teamOwner: Actor;
let ownerA: Actor;
let ownerB: Actor;
let projectA: string;
let projectB: string;
let seededProjectId: string;

/** Agent key created by ownerA, holding every permission the matrix needs. */
let agentOfOwnerA: string;
/** Agent key created by ownerA, holding none of them. */
let agentOfOwnerAWithoutPermission: string;
/** Agent key created by ownerB — permission present, creator not an owner of A. */
let agentOfOwnerB: string;

/** Runs this suite started, cancelled in afterEach so no handler outlives its test. */
let startedRuns: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A job that runs until cancelled. Registered for `SLOW_JOB_TYPE` so the
 * cancel row has a genuinely running run to cancel; the deadline is only a
 * backstop in case a test fails before its cleanup runs.
 */
const cancellableJobHandler: JobHandler = async (ctx) => {
  const deadline = Date.now() + 30_000;
  while (!ctx.isCancelled() && Date.now() < deadline) {
    await sleep(25);
  }
  return { cancelled: ctx.isCancelled() };
};

beforeAll(async () => {
  app = await buildApp();
  app.jobRunner.register(SLOW_JOB_TYPE, cancellableJobHandler);
  client = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await client.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  const seeded = await seedTestData();
  teamId = seeded.teamId;
  seededProjectId = seeded.projectId;

  const { token: teamOwnerToken } = await getTokenAndTeamId(app);
  teamOwner = { userId: seeded.userId, token: teamOwnerToken };

  ownerA = await signUp("owner-a@example.com");
  ownerB = await signUp("owner-b@example.com");

  projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "Project A" });
  projectB = await createProjectWithOwner(teamId, ownerB.userId, { name: "Project B" });

  agentOfOwnerA = await insertAgentKey(ownerA.userId, AGENT_WRITE_PERMISSIONS);
  agentOfOwnerAWithoutPermission = await insertAgentKey(ownerA.userId, UNRELATED_PERMISSION);
  agentOfOwnerB = await insertAgentKey(ownerB.userId, AGENT_WRITE_PERMISSIONS);
});

afterEach(async () => {
  for (const runId of startedRuns) app.jobRunner.cancel(runId);
  startedRuns = [];
});

async function signUp(email: string): Promise<Actor> {
  const created = await createUserAndGetToken(app, email);
  return { userId: created.userId, token: created.token };
}

/**
 * Insert an agent key straight into the database, as `project-ownership.test.ts`
 * does: `POST /v1/auth/keys` still carries the old team-role gate, and these
 * keys belong to plain members.
 */
async function insertAgentKey(createdBy: string, permissions: Permission[]): Promise<string> {
  const secret = `pulse_agent_${randomUUID().replace(/-/g, "")}`;
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${secret}, 'agent', ${null}, ${teamId}, 'Matrix Test Agent Key', ${createdBy},
      ${JSON.stringify(permissions)}::jsonb
    )
  `;
  return secret;
}

/* ---------------------------------------------------------------------------
 * Fixtures, inserted directly so the row under test is the only route call in
 * the attempt: a fixture built through an owner's own request would hide a
 * missing check behind a passing one.
 * ------------------------------------------------------------------------ */

function unique(): string {
  return randomUUID().slice(0, 8);
}

async function insertApp(projectId: string, name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${name}, 'apple', ${`dev.matrix.${unique()}`})
    RETURNING id
  `;
  return row.id as string;
}

async function insertMetric(projectId: string, slug: string, name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO metric_definitions (project_id, name, slug)
    VALUES (${projectId}, ${name}, ${slug})
    RETURNING id
  `;
  return row.id as string;
}

async function insertFunnel(projectId: string, slug: string, name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO funnel_definitions (project_id, name, slug, steps)
    VALUES (${projectId}, ${name}, ${slug}, ${client.json(FUNNEL_STEPS)})
    RETURNING id
  `;
  return row.id as string;
}

async function insertAttachment(projectId: string, appId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO event_attachments (
      project_id, app_id, original_filename, content_type, size_bytes, sha256,
      storage_path, uploaded_at
    )
    VALUES (
      ${projectId}, ${appId}, 'matrix.bin', 'application/octet-stream', ${64},
      ${"a".repeat(64)}, ${`matrix/${unique()}`}, now()
    )
    RETURNING id
  `;
  return row.id as string;
}

const FUNNEL_STEPS = [
  { name: "Welcome", event_filter: { step_name: "welcome" } },
  { name: "Sign Up", event_filter: { step_name: "signup" } },
];

/** Start a real run for Project A and wait until it is actually running. */
async function startCancellableRun(): Promise<string> {
  const run = await app.jobRunner.trigger(SLOW_JOB_TYPE, {
    triggeredBy: "matrix-test",
    teamId,
    projectId: projectA,
  });
  startedRuns.push(run.id);
  await waitForRunStatus(run.id, "running");
  return run.id;
}

async function runStatus(runId: string): Promise<string | null> {
  const [row] = await client`SELECT status FROM job_runs WHERE id = ${runId}`;
  return (row?.status as string) ?? null;
}

async function waitForRunStatus(runId: string, status: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if ((await runStatus(runId)) === status) return;
    await sleep(25);
  }
  expect(await runStatus(runId)).toBe(status);
}

/* ---------------------------------------------------------------------------
 * State probes
 * ------------------------------------------------------------------------ */

async function appRow(appId: string): Promise<{ name: string; deleted_at: Date | null }> {
  const [row] = await client`SELECT name, deleted_at FROM apps WHERE id = ${appId}`;
  return row as { name: string; deleted_at: Date | null };
}

async function liveAppNames(projectId: string): Promise<string[]> {
  const rows = await client`
    SELECT name FROM apps
    WHERE project_id = ${projectId} AND deleted_at IS NULL
    ORDER BY name
  `;
  return rows.map((r) => r.name as string);
}

async function metricRow(id: string): Promise<{ name: string; deleted_at: Date | null }> {
  const [row] = await client`SELECT name, deleted_at FROM metric_definitions WHERE id = ${id}`;
  return row as { name: string; deleted_at: Date | null };
}

async function liveMetricSlugs(projectId: string): Promise<string[]> {
  const rows = await client`
    SELECT slug FROM metric_definitions
    WHERE project_id = ${projectId} AND deleted_at IS NULL
    ORDER BY slug
  `;
  return rows.map((r) => r.slug as string);
}

async function funnelRow(id: string): Promise<{ name: string; deleted_at: Date | null }> {
  const [row] = await client`SELECT name, deleted_at FROM funnel_definitions WHERE id = ${id}`;
  return row as { name: string; deleted_at: Date | null };
}

async function liveFunnelSlugs(projectId: string): Promise<string[]> {
  const rows = await client`
    SELECT slug FROM funnel_definitions
    WHERE project_id = ${projectId} AND deleted_at IS NULL
    ORDER BY slug
  `;
  return rows.map((r) => r.slug as string);
}

async function attachmentDeletedAt(id: string): Promise<Date | null> {
  const [row] = await client`SELECT deleted_at FROM event_attachments WHERE id = ${id}`;
  return (row?.deleted_at as Date | null) ?? null;
}

async function runIdsForProject(projectId: string, jobType: string): Promise<string[]> {
  const rows = await client`
    SELECT id FROM job_runs WHERE project_id = ${projectId} AND job_type = ${jobType}
  `;
  return rows.map((r) => r.id as string);
}

/* ---------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/** One HTTP mutation, already aimed at fixtures inside Project A. */
interface MutationRequest {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  payload?: Record<string, unknown>;
}

/** One attempt's fixtures, request and the two state assertions about it. */
interface PreparedMutation {
  request: MutationRequest;
  /** Throws unless the mutation actually took effect in the database. */
  expectApplied: () => Promise<void>;
  /** Throws unless every row the mutation would have touched is untouched. */
  expectUntouched: () => Promise<void>;
  /** Release anything the fixture holds open (a running job). */
  cleanup?: () => Promise<void>;
}

interface MutationRow {
  /** The endpoint, written as the route table names it. */
  endpoint: string;
  /** The explicit permission this route requires of an API key. */
  permission: Permission;
  /**
   * Whether an agent principal may perform this operation at all. False marks
   * the deliberately human-only destructive operations of handoff §2.
   */
  agentAllowed: boolean;
  /** The status the happy path returns. */
  ok: number;
  /** Build fresh fixtures and the request for exactly one attempt. */
  prepare: () => Promise<PreparedMutation>;
}

const rows: MutationRow[] = [
  {
    endpoint: "POST /v1/apps",
    permission: "apps:write",
    agentAllowed: true,
    ok: 201,
    prepare: async () => {
      const name = `Matrix App ${unique()}`;
      const before = await liveAppNames(projectA);
      return {
        request: {
          method: "POST",
          url: "/v1/apps",
          payload: {
            name,
            platform: "apple",
            bundle_id: `dev.matrix.${unique()}`,
            project_id: projectA,
          },
        },
        expectApplied: async () => {
          expect(await liveAppNames(projectA)).toEqual([...before, name].sort());
        },
        expectUntouched: async () => {
          expect(await liveAppNames(projectA)).toEqual(before);
        },
      };
    },
  },
  {
    endpoint: "PATCH /v1/apps/:id",
    permission: "apps:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const original = `Matrix App ${unique()}`;
      const appId = await insertApp(projectA, original);
      return {
        request: { method: "PATCH", url: `/v1/apps/${appId}`, payload: { name: "Matrix Renamed" } },
        expectApplied: async () => {
          expect((await appRow(appId)).name).toBe("Matrix Renamed");
        },
        expectUntouched: async () => {
          expect((await appRow(appId)).name).toBe(original);
        },
      };
    },
  },
  {
    // Human-only: an agent may not delete an app even when its creator owns
    // the project and it holds `apps:write` (handoff §2).
    endpoint: "DELETE /v1/apps/:id",
    permission: "apps:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      return {
        request: { method: "DELETE", url: `/v1/apps/${appId}` },
        expectApplied: async () => {
          expect((await appRow(appId)).deleted_at).not.toBeNull();
        },
        expectUntouched: async () => {
          expect((await appRow(appId)).deleted_at).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "POST /v1/projects/:projectId/metrics",
    permission: "metrics:write",
    agentAllowed: true,
    ok: 201,
    prepare: async () => {
      const slug = `matrix-metric-${unique()}`;
      const before = await liveMetricSlugs(projectA);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/metrics`,
          payload: { name: "Matrix Metric", slug },
        },
        expectApplied: async () => {
          expect(await liveMetricSlugs(projectA)).toEqual([...before, slug].sort());
        },
        expectUntouched: async () => {
          expect(await liveMetricSlugs(projectA)).toEqual(before);
        },
      };
    },
  },
  {
    endpoint: "PATCH /v1/projects/:projectId/metrics/:slug",
    permission: "metrics:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const slug = `matrix-metric-${unique()}`;
      const metricId = await insertMetric(projectA, slug, "Matrix Metric");
      return {
        request: {
          method: "PATCH",
          url: `/v1/projects/${projectA}/metrics/${slug}`,
          payload: { name: "Matrix Metric Renamed" },
        },
        expectApplied: async () => {
          expect((await metricRow(metricId)).name).toBe("Matrix Metric Renamed");
        },
        expectUntouched: async () => {
          expect((await metricRow(metricId)).name).toBe("Matrix Metric");
        },
      };
    },
  },
  {
    // Agent-supported: deleting a metric definition is one of the destructive
    // operations agents are deliberately allowed (handoff §2).
    endpoint: "DELETE /v1/projects/:projectId/metrics/:slug",
    permission: "metrics:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const slug = `matrix-metric-${unique()}`;
      const metricId = await insertMetric(projectA, slug, "Matrix Metric");
      return {
        request: { method: "DELETE", url: `/v1/projects/${projectA}/metrics/${slug}` },
        expectApplied: async () => {
          expect((await metricRow(metricId)).deleted_at).not.toBeNull();
        },
        expectUntouched: async () => {
          expect((await metricRow(metricId)).deleted_at).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "POST /v1/projects/:projectId/funnels",
    permission: "funnels:write",
    agentAllowed: true,
    ok: 201,
    prepare: async () => {
      const slug = `matrix-funnel-${unique()}`;
      const before = await liveFunnelSlugs(projectA);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/funnels`,
          payload: { name: "Matrix Funnel", slug, steps: FUNNEL_STEPS },
        },
        expectApplied: async () => {
          expect(await liveFunnelSlugs(projectA)).toEqual([...before, slug].sort());
        },
        expectUntouched: async () => {
          expect(await liveFunnelSlugs(projectA)).toEqual(before);
        },
      };
    },
  },
  {
    endpoint: "PATCH /v1/projects/:projectId/funnels/:slug",
    permission: "funnels:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const slug = `matrix-funnel-${unique()}`;
      const funnelId = await insertFunnel(projectA, slug, "Matrix Funnel");
      return {
        request: {
          method: "PATCH",
          url: `/v1/projects/${projectA}/funnels/${slug}`,
          payload: { name: "Matrix Funnel Renamed" },
        },
        expectApplied: async () => {
          expect((await funnelRow(funnelId)).name).toBe("Matrix Funnel Renamed");
        },
        expectUntouched: async () => {
          expect((await funnelRow(funnelId)).name).toBe("Matrix Funnel");
        },
      };
    },
  },
  {
    // Agent-supported, like metric-definition deletion (handoff §2).
    endpoint: "DELETE /v1/projects/:projectId/funnels/:slug",
    permission: "funnels:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const slug = `matrix-funnel-${unique()}`;
      const funnelId = await insertFunnel(projectA, slug, "Matrix Funnel");
      return {
        request: { method: "DELETE", url: `/v1/projects/${projectA}/funnels/${slug}` },
        expectApplied: async () => {
          expect((await funnelRow(funnelId)).deleted_at).not.toBeNull();
        },
        expectUntouched: async () => {
          expect((await funnelRow(funnelId)).deleted_at).toBeNull();
        },
      };
    },
  },
  {
    // Human project-owner only (handoff §2): agents may not delete
    // attachments, and an ingestion key that uploaded one cannot remove it.
    endpoint: "DELETE /v1/attachments/:id",
    permission: "events:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const attachmentId = await insertAttachment(projectA, appId);
      return {
        request: { method: "DELETE", url: `/v1/attachments/${attachmentId}` },
        expectApplied: async () => {
          expect(await attachmentDeletedAt(attachmentId)).not.toBeNull();
        },
        expectUntouched: async () => {
          expect(await attachmentDeletedAt(attachmentId)).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "POST /v1/teams/:teamId/jobs/trigger",
    permission: "jobs:write",
    agentAllowed: true,
    ok: 201,
    prepare: async () => {
      expect(await runIdsForProject(projectA, FAST_JOB_TYPE)).toEqual([]);
      return {
        request: {
          method: "POST",
          url: `/v1/teams/${teamId}/jobs/trigger`,
          payload: { job_type: FAST_JOB_TYPE, project_id: projectA },
        },
        expectApplied: async () => {
          expect(await runIdsForProject(projectA, FAST_JOB_TYPE)).toHaveLength(1);
        },
        expectUntouched: async () => {
          expect(await runIdsForProject(projectA, FAST_JOB_TYPE)).toEqual([]);
        },
      };
    },
  },
  {
    endpoint: "POST /v1/jobs/:runId/cancel",
    permission: "jobs:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const runId = await startCancellableRun();
      return {
        request: { method: "POST", url: `/v1/jobs/${runId}/cancel` },
        expectApplied: async () => {
          await waitForRunStatus(runId, "cancelled");
        },
        expectUntouched: async () => {
          expect(await runStatus(runId)).toBe("running");
        },
        cleanup: async () => {
          app.jobRunner.cancel(runId);
        },
      };
    },
  },
];

/* ---------------------------------------------------------------------------
 * The two outcomes every row is driven through
 * ------------------------------------------------------------------------ */

function inject(prepared: PreparedMutation, credential: string) {
  const { method, url, payload } = prepared.request;
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${credential}` },
    ...(payload ? { payload } : {}),
  });
}

async function expectAllowed(row: MutationRow, credential: string) {
  const prepared = await row.prepare();
  try {
    const res = await inject(prepared, credential);
    expect(res.statusCode).toBe(row.ok);
    await prepared.expectApplied();
  } finally {
    await prepared.cleanup?.();
  }
}

async function expectRefused(row: MutationRow, credential: string) {
  const prepared = await row.prepare();
  try {
    const res = await inject(prepared, credential);
    expect(res.statusCode).toBe(403);
    expect(typeof res.json().error).toBe("string");
    await prepared.expectUntouched();
  } finally {
    await prepared.cleanup?.();
  }
}

describe.each(rows)("$endpoint", (row) => {
  it("a project owner succeeds and the change lands in the database", async () => {
    await expectAllowed(row, ownerA.token);
  });

  it("a same-team viewer is refused with 403 and nothing changes", async () => {
    await expectRefused(row, ownerB.token);
  });

  it("the team owner, not owning the project, is refused with 403 and nothing changes", async () => {
    await expectRefused(row, teamOwner.token);
  });

  if (row.agentAllowed) {
    it("an owning agent with the permission succeeds", async () => {
      await expectAllowed(row, agentOfOwnerA);
    });
  } else {
    it("an owning agent with the permission is refused: human-only", async () => {
      await expectRefused(row, agentOfOwnerA);
    });
  }

  it("an agent with the permission whose creator is not an owner is refused with 403", async () => {
    await expectRefused(row, agentOfOwnerB);
  });

  it(`an owning agent without ${row.permission} is refused with 403`, async () => {
    await expectRefused(row, agentOfOwnerAWithoutPermission);
  });
});

/* ---------------------------------------------------------------------------
 * POST /v1/identity/properties — the ingestion data plane
 * ------------------------------------------------------------------------ */

describe("POST /v1/identity/properties", () => {
  const body = { user_id: "matrix-user", properties: { plan: "pro" } };

  async function setProperties(credential: string) {
    return app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: { authorization: `Bearer ${credential}` },
      payload: body,
    });
  }

  async function storedProperties(projectId: string): Promise<Record<string, string> | null> {
    const [row] = await client`
      SELECT properties FROM app_users
      WHERE project_id = ${projectId} AND user_id = ${"matrix-user"}
    `;
    return (row?.properties as Record<string, string> | null) ?? null;
  }

  /** Strip the seeded project's owners: ingestion must not depend on them. */
  async function orphanSeededProject() {
    await client`DELETE FROM project_owners WHERE project_id = ${seededProjectId}`;
  }

  it("a client key ingests properties with no human project owner on the request", async () => {
    await orphanSeededProject();

    const res = await setProperties(TEST_CLIENT_KEY);

    expect(res.statusCode).toBe(200);
    expect(res.json().properties).toEqual({ plan: "pro" });
    expect(await storedProperties(seededProjectId)).toEqual({ plan: "pro" });
  });

  it("an import key ingests properties with no human project owner on the request", async () => {
    await orphanSeededProject();

    const res = await setProperties(TEST_IMPORT_KEY);

    expect(res.statusCode).toBe(200);
    expect(await storedProperties(seededProjectId)).toEqual({ plan: "pro" });
  });

  it("refuses a user session: the app is named by the credential, not the request", async () => {
    const res = await setProperties(ownerA.token);

    expect(res.statusCode).toBe(403);
    expect(await storedProperties(projectA)).toBeNull();
    expect(await storedProperties(seededProjectId)).toBeNull();
  });

  it("refuses an agent key even when its creator owns a project", async () => {
    const key = await insertAgentKey(ownerA.userId, ["users:write"]);

    const res = await setProperties(key);

    expect(res.statusCode).toBe(403);
    expect(await storedProperties(projectA)).toBeNull();
    expect(await storedProperties(seededProjectId)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * Cross-project child ids
 *
 * The rows above all aim at Project A. These pin the other half of the
 * containment contract for the modules this phase wires: a child id from
 * Project B, addressed through Project A (or through an owner of A who has no
 * business with it), is a 404 with no state change — never a successful write.
 * ------------------------------------------------------------------------ */

describe("cross-project child ids", () => {
  it("PATCH /v1/apps/:id: an owner of A cannot rename an app in B", async () => {
    const appInB = await insertApp(projectB, "Project B App");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${appInB}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { name: "Renamed by A" },
    });

    expect(res.statusCode).toBe(403);
    expect((await appRow(appInB)).name).toBe("Project B App");
  });

  it("DELETE /v1/projects/:projectId/metrics/:slug: a B metric is not reachable through A's URL", async () => {
    const slug = `matrix-metric-${unique()}`;
    const metricId = await insertMetric(projectB, slug, "Project B Metric");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectA}/metrics/${slug}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(404);
    expect((await metricRow(metricId)).deleted_at).toBeNull();
  });

  it("PATCH /v1/projects/:projectId/funnels/:slug: a B funnel is not reachable through A's URL", async () => {
    const slug = `matrix-funnel-${unique()}`;
    const funnelId = await insertFunnel(projectB, slug, "Project B Funnel");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectA}/funnels/${slug}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { name: "Renamed by A" },
    });

    expect(res.statusCode).toBe(404);
    expect((await funnelRow(funnelId)).name).toBe("Project B Funnel");
  });

  it("DELETE /v1/attachments/:id: an owner of A cannot delete an attachment in B", async () => {
    const appInB = await insertApp(projectB, "Project B App");
    const attachmentId = await insertAttachment(projectB, appInB);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/attachments/${attachmentId}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(await attachmentDeletedAt(attachmentId)).toBeNull();
  });

  it("POST /v1/teams/:teamId/jobs/trigger: an owner of A cannot trigger a job for B", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/jobs/trigger`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { job_type: FAST_JOB_TYPE, project_id: projectB },
    });

    expect(res.statusCode).toBe(403);
    expect(await runIdsForProject(projectB, FAST_JOB_TYPE)).toEqual([]);
  });

  it("POST /v1/jobs/:runId/cancel: an owner of A cannot cancel a run belonging to B", async () => {
    const run = await app.jobRunner.trigger(SLOW_JOB_TYPE, {
      triggeredBy: "matrix-test",
      teamId,
      projectId: projectB,
    });
    startedRuns.push(run.id);
    await waitForRunStatus(run.id, "running");

    const res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${run.id}/cancel`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(await runStatus(run.id)).toBe("running");
  });
});
