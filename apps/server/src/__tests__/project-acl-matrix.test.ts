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
 * matrix") for the project-scoped mutations: apps, metric and funnel
 * definitions, attachment deletion, project jobs, issue/feedback/response
 * triage, and the three comment implementations.
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
 * Comment routes are the one deliberate variation. The comment policy replaces
 * only the project-owner predicate, so on a `nonOwnersAllowed` row the viewer,
 * the team owner and a non-owner's agent all succeed — while the permission,
 * containment and human-only columns stay exactly as they are everywhere else.
 * Comment *moderation* (deleting a bystander's comment) needs no variation: it
 * is human-project-owner-only, which is the ordinary row shape with
 * `agentAllowed: false`. `comment-policy.test.ts` owns the authorship rules
 * themselves.
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
  "issues:write",
  "feedback:write",
  "questionnaires:write",
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
/**
 * A fourth member who owns nothing and is never a principal in the table. The
 * moderation rows need a comment authored by someone *other* than every
 * principal driven through them, so no row can pass on authorship when it is
 * meant to be testing moderation authority.
 */
let bystander: Actor;
let projectA: string;
let projectB: string;
let seededProjectId: string;

/** An agent key, identified for comment authorship as well as authentication. */
interface AgentKey {
  id: string;
  secret: string;
}

/** Agent key created by ownerA, holding every permission the matrix needs. */
let agentOfOwnerA: AgentKey;
/** Agent key created by ownerA, holding none of them. */
let agentOfOwnerAWithoutPermission: AgentKey;
/** Agent key created by ownerB — permission present, creator not an owner of A. */
let agentOfOwnerB: AgentKey;

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
  bystander = await signUp("bystander@example.com");

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
async function insertAgentKey(createdBy: string, permissions: Permission[]): Promise<AgentKey> {
  const secret = `pulse_agent_${randomUUID().replace(/-/g, "")}`;
  const [row] = await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${secret}, 'agent', ${null}, ${teamId}, 'Matrix Test Agent Key', ${createdBy},
      ${JSON.stringify(permissions)}::jsonb
    )
    RETURNING id
  `;
  return { id: row.id as string, secret };
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

/** The smallest schema `POST /v1/projects/:projectId/questionnaires` accepts. */
const QUESTIONNAIRE_SCHEMA = {
  version: 1,
  questions: [{ id: "q_text", type: "text", title: "Tell us", required: false }],
};

async function insertIssue(projectId: string, appId: string, title: string): Promise<string> {
  const [row] = await client`
    INSERT INTO issues (app_id, project_id, status, title, first_seen_at, last_seen_at)
    VALUES (${appId}, ${projectId}, 'new', ${title}, now(), now())
    RETURNING id
  `;
  return row.id as string;
}

async function insertFeedbackItem(projectId: string, appId: string): Promise<string> {
  const [row] = await client`
    INSERT INTO feedback (app_id, project_id, message)
    VALUES (${appId}, ${projectId}, ${"Matrix feedback"})
    RETURNING id
  `;
  return row.id as string;
}

async function insertQuestionnaire(projectId: string): Promise<{ id: string; slug: string }> {
  const slug = `matrix-q-${unique()}`;
  const [row] = await client`
    INSERT INTO questionnaires (project_id, slug, name, schema)
    VALUES (
      ${projectId}, ${slug}, ${"Matrix Questionnaire"}, ${client.json(QUESTIONNAIRE_SCHEMA)}
    )
    RETURNING id
  `;
  return { id: row.id as string, slug };
}

async function insertResponse(
  projectId: string,
  appId: string,
  questionnaire: { id: string; slug: string },
): Promise<string> {
  const [row] = await client`
    INSERT INTO questionnaire_responses (questionnaire_id, slug, app_id, project_id, answers)
    VALUES (
      ${questionnaire.id}, ${questionnaire.slug}, ${appId}, ${projectId}, ${client.json({})}
    )
    RETURNING id
  `;
  return row.id as string;
}

/**
 * A comment authored by the bystander, for the moderation rows: nobody driven
 * through the table authored it, so only moderation authority can delete it.
 */
async function insertBystanderComment(
  table: "issue_comments" | "feedback_comments" | "questionnaire_response_comments",
  parentColumn: string,
  parentId: string,
): Promise<string> {
  const [row] = await client.unsafe(
    `INSERT INTO ${table} (${parentColumn}, author_type, author_id, author_name, body)
     VALUES ($1, 'user', $2, 'Bystander', 'someone else''s words')
     RETURNING id`,
    [parentId, bystander.userId],
  );
  return row.id as string;
}

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

async function issueStatus(id: string): Promise<string | null> {
  const [row] = await client`SELECT status FROM issues WHERE id = ${id}`;
  return (row?.status as string) ?? null;
}

async function issueExists(id: string): Promise<boolean> {
  const [row] = await client`SELECT 1 AS present FROM issues WHERE id = ${id}`;
  return row !== undefined;
}

async function feedbackRow(id: string): Promise<{ status: string; deleted_at: Date | null }> {
  const [row] = await client`SELECT status, deleted_at FROM feedback WHERE id = ${id}`;
  return row as unknown as { status: string; deleted_at: Date | null };
}

async function questionnaireRow(id: string): Promise<{ name: string; deleted_at: Date | null }> {
  const [row] = await client`SELECT name, deleted_at FROM questionnaires WHERE id = ${id}`;
  return row as unknown as { name: string; deleted_at: Date | null };
}

async function liveQuestionnaireSlugs(projectId: string): Promise<string[]> {
  const rows = await client`
    SELECT slug FROM questionnaires
    WHERE project_id = ${projectId} AND deleted_at IS NULL
    ORDER BY slug
  `;
  return rows.map((r) => r.slug as string);
}

async function responseRow(id: string): Promise<{ status: string; deleted_at: Date | null }> {
  const [row] = await client`
    SELECT status, deleted_at FROM questionnaire_responses WHERE id = ${id}
  `;
  return row as unknown as { status: string; deleted_at: Date | null };
}

async function commentDeletedAt(table: string, id: string): Promise<Date | null> {
  const [row] = await client.unsafe(`SELECT deleted_at FROM ${table} WHERE id = $1`, [id]);
  return (row?.deleted_at as Date | null) ?? null;
}

async function commentCount(table: string, column: string, parentId: string): Promise<number> {
  const [row] = await client.unsafe(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = $1`,
    [parentId],
  );
  return Number(row.count);
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
  /**
   * The route is governed by the comment policy rather than the project-write
   * policy. The exception replaces *only* the project-owner predicate, so a
   * read-only member, the team owner and an agent whose creator owns nothing
   * may all create comments — while the route's explicit key permission,
   * containment and authentication still apply exactly as elsewhere.
   */
  nonOwnersAllowed?: boolean;
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

  /* -------------------------------------------------------------------------
   * Triage and comments (handoff §8 "Mutation coverage": issues, feedback,
   * questionnaires). Before this phase these routes had no ownership check at
   * all — `requirePermission` returns early for every JWT user, so any
   * same-team member could retriage, merge and delete another project's data.
   * ---------------------------------------------------------------------- */

  {
    endpoint: "PATCH /v1/projects/:projectId/issues/:issueId",
    permission: "issues:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const issueId = await insertIssue(projectA, appId, `Matrix Issue ${unique()}`);
      return {
        request: {
          method: "PATCH",
          url: `/v1/projects/${projectA}/issues/${issueId}`,
          payload: { status: "in_progress" },
        },
        expectApplied: async () => {
          expect(await issueStatus(issueId)).toBe("in_progress");
        },
        expectUntouched: async () => {
          expect(await issueStatus(issueId)).toBe("new");
        },
      };
    },
  },
  {
    // A merge DESTROYS the source issue, but it is agent-supported by the
    // locked policy (handoff §2): agents may merge issues.
    endpoint: "POST /v1/projects/:projectId/issues/:issueId/merge",
    permission: "issues:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const targetId = await insertIssue(projectA, appId, `Matrix Target ${unique()}`);
      const sourceId = await insertIssue(projectA, appId, `Matrix Source ${unique()}`);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/issues/${targetId}/merge`,
          payload: { source_issue_id: sourceId },
        },
        expectApplied: async () => {
          expect(await issueExists(sourceId)).toBe(false);
          expect(await issueExists(targetId)).toBe(true);
        },
        expectUntouched: async () => {
          expect(await issueExists(sourceId)).toBe(true);
          expect(await issueExists(targetId)).toBe(true);
        },
      };
    },
  },
  {
    // The comment exception: a read-only member may comment. The row still
    // proves the *permission* half survives it — an agent without
    // `issues:write` is refused and no comment lands.
    endpoint: "POST /v1/projects/:projectId/issues/:issueId/comments",
    permission: "issues:write",
    agentAllowed: true,
    nonOwnersAllowed: true,
    ok: 201,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const issueId = await insertIssue(projectA, appId, `Matrix Issue ${unique()}`);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/issues/${issueId}/comments`,
          payload: { body: "matrix comment" },
        },
        expectApplied: async () => {
          expect(await commentCount("issue_comments", "issue_id", issueId)).toBe(1);
        },
        expectUntouched: async () => {
          expect(await commentCount("issue_comments", "issue_id", issueId)).toBe(0);
        },
      };
    },
  },
  {
    // Moderation: the comment belongs to a bystander, so only a HUMAN project
    // owner may delete it. An agent never moderates, even one whose creator
    // owns the project — hence `agentAllowed: false`.
    endpoint: "DELETE /v1/projects/:projectId/issues/:issueId/comments/:commentId",
    permission: "issues:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const issueId = await insertIssue(projectA, appId, `Matrix Issue ${unique()}`);
      const commentId = await insertBystanderComment("issue_comments", "issue_id", issueId);
      return {
        request: {
          method: "DELETE",
          url: `/v1/projects/${projectA}/issues/${issueId}/comments/${commentId}`,
        },
        expectApplied: async () => {
          expect(await commentDeletedAt("issue_comments", commentId)).not.toBeNull();
        },
        expectUntouched: async () => {
          expect(await commentDeletedAt("issue_comments", commentId)).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "PATCH /v1/projects/:projectId/feedback/:feedbackId",
    permission: "feedback:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const feedbackId = await insertFeedbackItem(projectA, appId);
      return {
        request: {
          method: "PATCH",
          url: `/v1/projects/${projectA}/feedback/${feedbackId}`,
          payload: { status: "in_review" },
        },
        expectApplied: async () => {
          expect((await feedbackRow(feedbackId)).status).toBe("in_review");
        },
        expectUntouched: async () => {
          expect((await feedbackRow(feedbackId)).status).toBe("new");
        },
      };
    },
  },
  {
    // Human-only: deleting a feedback item is one of the destructive
    // operations agents are deliberately denied (handoff §2).
    endpoint: "DELETE /v1/projects/:projectId/feedback/:feedbackId",
    permission: "feedback:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const feedbackId = await insertFeedbackItem(projectA, appId);
      return {
        request: {
          method: "DELETE",
          url: `/v1/projects/${projectA}/feedback/${feedbackId}`,
        },
        expectApplied: async () => {
          expect((await feedbackRow(feedbackId)).deleted_at).not.toBeNull();
        },
        expectUntouched: async () => {
          expect((await feedbackRow(feedbackId)).deleted_at).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "POST /v1/projects/:projectId/feedback/:feedbackId/comments",
    permission: "feedback:write",
    agentAllowed: true,
    nonOwnersAllowed: true,
    ok: 201,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const feedbackId = await insertFeedbackItem(projectA, appId);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/feedback/${feedbackId}/comments`,
          payload: { body: "matrix comment" },
        },
        expectApplied: async () => {
          expect(await commentCount("feedback_comments", "feedback_id", feedbackId)).toBe(1);
        },
        expectUntouched: async () => {
          expect(await commentCount("feedback_comments", "feedback_id", feedbackId)).toBe(0);
        },
      };
    },
  },
  {
    endpoint: "DELETE /v1/projects/:projectId/feedback/:feedbackId/comments/:commentId",
    permission: "feedback:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const feedbackId = await insertFeedbackItem(projectA, appId);
      const commentId = await insertBystanderComment(
        "feedback_comments",
        "feedback_id",
        feedbackId,
      );
      return {
        request: {
          method: "DELETE",
          url: `/v1/projects/${projectA}/feedback/${feedbackId}/comments/${commentId}`,
        },
        expectApplied: async () => {
          expect(await commentDeletedAt("feedback_comments", commentId)).not.toBeNull();
        },
        expectUntouched: async () => {
          expect(await commentDeletedAt("feedback_comments", commentId)).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "POST /v1/projects/:projectId/questionnaires",
    permission: "questionnaires:write",
    agentAllowed: true,
    ok: 201,
    prepare: async () => {
      const slug = `matrix-q-${unique()}`;
      const before = await liveQuestionnaireSlugs(projectA);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/questionnaires`,
          payload: { slug, name: "Matrix Questionnaire", schema: QUESTIONNAIRE_SCHEMA },
        },
        expectApplied: async () => {
          expect(await liveQuestionnaireSlugs(projectA)).toEqual([...before, slug].sort());
        },
        expectUntouched: async () => {
          expect(await liveQuestionnaireSlugs(projectA)).toEqual(before);
        },
      };
    },
  },
  {
    endpoint: "PATCH /v1/projects/:projectId/questionnaires/:questionnaireId",
    permission: "questionnaires:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const questionnaire = await insertQuestionnaire(projectA);
      return {
        request: {
          method: "PATCH",
          url: `/v1/projects/${projectA}/questionnaires/${questionnaire.id}`,
          payload: { name: "Matrix Questionnaire Renamed" },
        },
        expectApplied: async () => {
          expect((await questionnaireRow(questionnaire.id)).name).toBe(
            "Matrix Questionnaire Renamed",
          );
        },
        expectUntouched: async () => {
          expect((await questionnaireRow(questionnaire.id)).name).toBe("Matrix Questionnaire");
        },
      };
    },
  },
  {
    // Human-only (handoff §2).
    endpoint: "DELETE /v1/projects/:projectId/questionnaires/:questionnaireId",
    permission: "questionnaires:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const questionnaire = await insertQuestionnaire(projectA);
      return {
        request: {
          method: "DELETE",
          url: `/v1/projects/${projectA}/questionnaires/${questionnaire.id}`,
        },
        expectApplied: async () => {
          expect((await questionnaireRow(questionnaire.id)).deleted_at).not.toBeNull();
        },
        expectUntouched: async () => {
          expect((await questionnaireRow(questionnaire.id)).deleted_at).toBeNull();
        },
      };
    },
  },
  {
    // Agent-supported: changing a response's status is triage, not destruction.
    endpoint: "PATCH /v1/projects/:projectId/questionnaires/:qId/responses/:responseId",
    permission: "questionnaires:write",
    agentAllowed: true,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const questionnaire = await insertQuestionnaire(projectA);
      const responseId = await insertResponse(projectA, appId, questionnaire);
      return {
        request: {
          method: "PATCH",
          url: `/v1/projects/${projectA}/questionnaires/${questionnaire.id}/responses/${responseId}`,
          payload: { status: "in_review" },
        },
        expectApplied: async () => {
          expect((await responseRow(responseId)).status).toBe("in_review");
        },
        expectUntouched: async () => {
          expect((await responseRow(responseId)).status).toBe("new");
        },
      };
    },
  },
  {
    // Human-only (handoff §2).
    endpoint: "DELETE /v1/projects/:projectId/questionnaires/:qId/responses/:responseId",
    permission: "questionnaires:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const questionnaire = await insertQuestionnaire(projectA);
      const responseId = await insertResponse(projectA, appId, questionnaire);
      return {
        request: {
          method: "DELETE",
          url: `/v1/projects/${projectA}/questionnaires/${questionnaire.id}/responses/${responseId}`,
        },
        expectApplied: async () => {
          expect((await responseRow(responseId)).deleted_at).not.toBeNull();
        },
        expectUntouched: async () => {
          expect((await responseRow(responseId)).deleted_at).toBeNull();
        },
      };
    },
  },
  {
    endpoint: "POST /v1/projects/:projectId/questionnaires/:qId/responses/:responseId/comments",
    permission: "questionnaires:write",
    agentAllowed: true,
    nonOwnersAllowed: true,
    ok: 201,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const questionnaire = await insertQuestionnaire(projectA);
      const responseId = await insertResponse(projectA, appId, questionnaire);
      return {
        request: {
          method: "POST",
          url: `/v1/projects/${projectA}/questionnaires/${questionnaire.id}/responses/${responseId}/comments`,
          payload: { body: "matrix comment" },
        },
        expectApplied: async () => {
          expect(
            await commentCount(
              "questionnaire_response_comments",
              "questionnaire_response_id",
              responseId,
            ),
          ).toBe(1);
        },
        expectUntouched: async () => {
          expect(
            await commentCount(
              "questionnaire_response_comments",
              "questionnaire_response_id",
              responseId,
            ),
          ).toBe(0);
        },
      };
    },
  },
  {
    endpoint:
      "DELETE /v1/projects/:projectId/questionnaires/:qId/responses/:responseId/comments/:commentId",
    permission: "questionnaires:write",
    agentAllowed: false,
    ok: 200,
    prepare: async () => {
      const appId = await insertApp(projectA, `Matrix App ${unique()}`);
      const questionnaire = await insertQuestionnaire(projectA);
      const responseId = await insertResponse(projectA, appId, questionnaire);
      const commentId = await insertBystanderComment(
        "questionnaire_response_comments",
        "questionnaire_response_id",
        responseId,
      );
      return {
        request: {
          method: "DELETE",
          url: `/v1/projects/${projectA}/questionnaires/${questionnaire.id}/responses/${responseId}/comments/${commentId}`,
        },
        expectApplied: async () => {
          expect(
            await commentDeletedAt("questionnaire_response_comments", commentId),
          ).not.toBeNull();
        },
        expectUntouched: async () => {
          expect(await commentDeletedAt("questionnaire_response_comments", commentId)).toBeNull();
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

  if (row.nonOwnersAllowed) {
    it("a same-team viewer succeeds: commenting is the project-owner exception", async () => {
      await expectAllowed(row, ownerB.token);
    });

    it("the team owner, owning no project, succeeds for the same reason", async () => {
      await expectAllowed(row, teamOwner.token);
    });
  } else {
    it("a same-team viewer is refused with 403 and nothing changes", async () => {
      await expectRefused(row, ownerB.token);
    });

    it("the team owner, not owning the project, is refused with 403 and nothing changes", async () => {
      await expectRefused(row, teamOwner.token);
    });
  }

  if (row.agentAllowed) {
    it("an owning agent with the permission succeeds", async () => {
      await expectAllowed(row, agentOfOwnerA.secret);
    });
  } else {
    it("an owning agent with the permission is refused: human-only", async () => {
      await expectRefused(row, agentOfOwnerA.secret);
    });
  }

  if (row.nonOwnersAllowed) {
    it("an agent with the permission whose creator is not an owner also succeeds", async () => {
      await expectAllowed(row, agentOfOwnerB.secret);
    });
  } else {
    it("an agent with the permission whose creator is not an owner is refused with 403", async () => {
      await expectRefused(row, agentOfOwnerB.secret);
    });
  }

  it(`an owning agent without ${row.permission} is refused with 403`, async () => {
    await expectRefused(row, agentOfOwnerAWithoutPermission.secret);
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

    const res = await setProperties(key.secret);

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

/* ---------------------------------------------------------------------------
 * The trigger route authorizes the top-level `project_id`, but the stats
 * aggregators read their target from `params.project_id` — and a caller-supplied
 * params bag used to be spread over the authorized value. A foreign id there
 * re-aggregated (DELETE-then-INSERT) another project's rollups; a null one fanned
 * out over every project in the deployment. Rollup tables are excluded from
 * retention pruning, so that loss is permanent, while the job_runs row and the
 * audit event named the project the caller legitimately owned.
 * ------------------------------------------------------------------------ */

describe("POST /v1/teams/:teamId/jobs/trigger: params cannot redirect the job", () => {
  const BACKFILL_DAY = "2026-01-01";

  /** A project-level rollup row, as an aggregation run would have written it. */
  async function seedRollup(projectId: string, count: number): Promise<void> {
    await client`
      INSERT INTO events_daily (team_id, project_id, app_id, is_dev, day, event_count)
      VALUES (${teamId}, ${projectId}, ${null}, false, ${BACKFILL_DAY}, ${count})
    `;
  }

  async function rollupCount(projectId: string): Promise<number | null> {
    const [row] = await client`
      SELECT event_count FROM events_daily
      WHERE project_id = ${projectId} AND app_id IS NULL AND day = ${BACKFILL_DAY}
    `;
    return row ? Number(row.event_count) : null;
  }

  async function runParams(runId: string): Promise<Record<string, unknown> | null> {
    const [row] = await client`SELECT params FROM job_runs WHERE id = ${runId}`;
    return (row?.params as Record<string, unknown>) ?? null;
  }

  /**
   * Wait for the aggregation to finish and assert it really ran. Without this
   * the "Project B is untouched" assertions could pass for the wrong reason —
   * a run that failed before its DELETE proves nothing.
   */
  async function expectRunCompleted(runId: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const status = await runStatus(runId);
      if (status === "completed" || status === "failed" || status === "cancelled") break;
      await sleep(25);
    }
    expect(await runStatus(runId)).toBe("completed");
  }

  it("ignores a params.project_id naming a project the caller does not own", async () => {
    await seedRollup(projectB, 42);

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/jobs/trigger`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: {
        job_type: FAST_JOB_TYPE,
        project_id: projectA,
        params: { start: BACKFILL_DAY, end: BACKFILL_DAY, project_id: projectB },
      },
    });

    expect(res.statusCode).toBe(201);
    const runId = res.json().job_run.id as string;
    expect((await runParams(runId))?.project_id).toBe(projectA);

    await expectRunCompleted(runId);
    expect(await rollupCount(projectB)).toBe(42);
  });

  it("ignores a null params.project_id, which would have fanned out over every project", async () => {
    await seedRollup(projectB, 7);

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/jobs/trigger`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: {
        job_type: FAST_JOB_TYPE,
        project_id: projectA,
        params: { start: BACKFILL_DAY, end: BACKFILL_DAY, project_id: null },
      },
    });

    expect(res.statusCode).toBe(201);
    const runId = res.json().job_run.id as string;
    expect((await runParams(runId))?.project_id).toBe(projectA);

    await expectRunCompleted(runId);
    expect(await rollupCount(projectB)).toBe(7);
  });

  it("rejects a params key the job type does not declare", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/jobs/trigger`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: {
        job_type: FAST_JOB_TYPE,
        project_id: projectA,
        params: { smuggled: "value" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(await runIdsForProject(projectA, FAST_JOB_TYPE)).toEqual([]);
  });

  it("an owning agent key cannot redirect the job either", async () => {
    await seedRollup(projectB, 13);

    const res = await app.inject({
      method: "POST",
      url: `/v1/teams/${teamId}/jobs/trigger`,
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
      payload: {
        job_type: FAST_JOB_TYPE,
        project_id: projectA,
        params: { start: BACKFILL_DAY, end: BACKFILL_DAY, project_id: projectB },
      },
    });

    expect(res.statusCode).toBe(201);
    const runId = res.json().job_run.id as string;
    expect((await runParams(runId))?.project_id).toBe(projectA);

    await expectRunCompleted(runId);
    expect(await rollupCount(projectB)).toBe(13);
  });
});
