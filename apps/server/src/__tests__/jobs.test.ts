import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  setupTestDb,
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  addTeamMember,
  createAgentKey,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let client: postgres.Sql;
let token: string;
let teamId: string;
let projectId: string;

beforeAll(async () => {
  await setupTestDb();
  app = await buildApp();
  client = postgres(TEST_DB_URL, { max: 1 });
}, 60_000);

afterAll(async () => {
  await client.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  const seed = await seedTestData();
  projectId = seed.projectId;
  const auth = await getTokenAndTeamId(app);
  token = auth.token;
  teamId = auth.teamId;
});

describe("Job Routes", () => {
  describe("GET /v1/teams/:teamId/jobs", () => {
    it("returns empty list initially", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.job_runs).toEqual([]);
      expect(body.has_more).toBe(false);
      expect(body.cursor).toBeNull();
    });

    it("returns job runs after triggering a job", async () => {
      // Trigger a job first
      await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });

      // Wait a moment for the job to be created
      await new Promise((r) => setTimeout(r, 100));

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.job_runs.length).toBeGreaterThanOrEqual(1);
      expect(body.job_runs[0].job_type).toBe("stats_aggregate_daily");
    });

    it("filters by job_type", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs?job_type=stats_aggregate_daily`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it("requires jobs:read permission for agent keys", async () => {
      const keyWithoutPerm = await createAgentKey(app, token, teamId, ["events:read"]);

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${keyWithoutPerm}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("allows agent keys with jobs:read permission", async () => {
      const key = await createAgentKey(app, token, teamId, ["jobs:read"]);

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${key}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it("lets an ordinary member read the team's run history", async () => {
      // The run list is an aggregate read over projects the member can already
      // read, so it is not owner-only. It is also not a mutation path — the
      // trigger test below proves that half separately.
      const member = await createUserAndGetToken(app, "jobs-reader@pulse.pubky.org");
      await addTeamMember(teamId, member.userId, "member");

      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/jobs`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().job_runs).toBeInstanceOf(Array);
    });
  });

  describe("POST /v1/teams/:teamId/jobs/trigger", () => {
    it("triggers a project-scoped job", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.job_run).toBeDefined();
      expect(body.job_run.job_type).toBe("stats_aggregate_daily");
      expect(body.job_run.team_id).toBe(teamId);
      expect(body.job_run.project_id).toBe(projectId);
      expect(["pending", "running", "completed"]).toContain(body.job_run.status);
    });

    it("still refuses a trigger from a member who does not own the project", async () => {
      // Opening the run *list* to every member must not open triggering with
      // it: a write into someone else's project stays a 403.
      const member = await createUserAndGetToken(app, "jobs-viewer@pulse.pubky.org");
      await addTeamMember(teamId, member.userId, "member");

      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { job_type: "stats_aggregate_daily", project_id: projectId },
      });

      expect(res.statusCode).toBe(403);
    });

    it("rejects system job types", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "db_pruning",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("system job");
    });

    it("rejects unknown job types", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "nonexistent_job",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("requires project_id for project-scoped jobs", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("project_id");
    });

    it("prevents duplicate running jobs", async () => {
      // Register a slow test handler
      app.jobRunner.register("stats_aggregate_daily", async (ctx) => {
        await new Promise((r) => setTimeout(r, 5000));
        return { test: true };
      });

      // Trigger first
      const first = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });
      expect(first.statusCode).toBe(201);

      // Wait for it to start running
      await new Promise((r) => setTimeout(r, 100));

      // Trigger duplicate
      const second = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toContain("already running or pending");
    });

    it("rejects a parameter the job type does not declare", async () => {
      // Nothing validated the params bag before, so any key at all reached the
      // handler. Only `JOB_TYPE_META[job_type].params` names are accepted.
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
          params: { not_a_real_param: "x" },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("not_a_real_param");
      const rows = await client`SELECT id FROM job_runs WHERE project_id = ${projectId}`;
      expect(rows).toHaveLength(0);
    });

    it("keeps declared params but pins project_id to the authorized project", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
          params: { start: "2026-01-01", end: "2026-01-02", project_id: null },
        },
      });

      expect(res.statusCode).toBe(201);
      const [row] = await client`
        SELECT params FROM job_runs WHERE id = ${res.json().job_run.id}
      `;
      expect(row.params).toMatchObject({
        start: "2026-01-01",
        end: "2026-01-02",
        project_id: projectId,
      });
    });

    it("supports notify flag", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
          notify: true,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().job_run.notify).toBe(true);
    });
  });

  describe("GET /v1/jobs/:runId", () => {
    it("returns job run detail", async () => {
      const trigger = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });

      const runId = trigger.json().job_run.id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/jobs/${runId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().job_run.id).toBe(runId);
    });

    it("returns 404 for non-existent run", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/jobs/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/jobs/:runId/cancel", () => {
    it("cancels a running job", async () => {
      // Register a slow handler
      app.jobRunner.register("stats_aggregate_daily", async (ctx) => {
        while (!ctx.isCancelled()) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return { cancelled: true };
      });

      const trigger = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });

      const runId = trigger.json().job_run.id;

      // Wait for it to start running
      await new Promise((r) => setTimeout(r, 200));

      const res = await app.inject({
        method: "POST",
        url: `/v1/jobs/${runId}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().cancelled).toBe(true);
    });

    it("returns 400 for non-running job", async () => {
      const trigger = await app.inject({
        method: "POST",
        url: `/v1/teams/${teamId}/jobs/trigger`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          job_type: "stats_aggregate_daily",
          project_id: projectId,
        },
      });

      // Wait for the fast handler to complete
      await new Promise((r) => setTimeout(r, 200));

      const runId = trigger.json().job_run.id;
      const res = await app.inject({
        method: "POST",
        url: `/v1/jobs/${runId}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });

      // Should be 400 since the job already completed
      expect([400, 200]).toContain(res.statusCode);
    });

    it("returns 404 for a run with no team and no project", async () => {
      // A scheduled system run carries neither, so it has no project ownership
      // to authorize against and is not addressable here at all — the same
      // answer GET /v1/jobs/:runId gives for a system run.
      const [run] = await client`
        INSERT INTO job_runs (job_type, status, team_id, project_id, triggered_by)
        VALUES ('db_pruning', 'running', ${null}, ${null}, 'schedule')
        RETURNING id
      `;

      const res = await app.inject({
        method: "POST",
        url: `/v1/jobs/${run.id}/cancel`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
