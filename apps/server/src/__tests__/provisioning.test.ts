import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createForeignTeam,
  addTeamMember,
  testEmailService,
  TEST_USER,
} from "./setup.js";

let app: FastifyInstance;
let testData: { userId: string; teamId: string; projectId: string; appId: string };

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

afterAll(async () => {
  await app.close();
});

/** Send a code and return it (via TestEmailService). */
async function sendCode(email: string): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/v1/auth/send-code",
    payload: { email },
  });
  return testEmailService.lastCode;
}

describe("POST /v1/auth/agent-login", () => {
  it("verifies code and returns agent key for new user", async () => {
    const code = await sendCode("newagent@pulse.pubky.org");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "newagent@pulse.pubky.org", code },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.api_key).toMatch(/^pulse_agent_/);
    // A new agent user joins the configured team rather than getting one of
    // their own.
    expect(body.team.id).toBe(testData.teamId);
    expect(body.team.name).toBe("Test Team");
  });

  it("verifies code and returns agent key for existing user", async () => {
    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.api_key).toMatch(/^pulse_agent_/);
    expect(body.team.id).toBe(testData.teamId);
  });

  it("returned agent key works for API calls", async () => {
    const code = await sendCode("apitest@pulse.pubky.org");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "apitest@pulse.pubky.org", code },
    });

    const agentKey = res.json().api_key;

    const projRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${agentKey}` },
    });

    // The key belongs to the configured team, so it reads that team's projects.
    expect(projRes.statusCode).toBe(200);
    expect(projRes.json().projects.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid code", async () => {
    await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code: "000000" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email },
    });

    expect(res.statusCode).toBe(400);
  });

  it("requires team_id when user has multiple teams", async () => {
    // Team creation is gone from the API, so the second membership is seeded
    // directly. It is still reachable through agent-login because that flow
    // resolves every membership the user holds, not only the configured one.
    await getTokenAndTeamId(app);
    const foreign = await createForeignTeam();
    await addTeamMember(foreign.teamId, testData.userId, "member");

    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/team_id/i);
    expect(res.json().teams).toHaveLength(2);
  });

  it("returns agent key for specific team when team_id provided", async () => {
    await getTokenAndTeamId(app);
    const foreign = await createForeignTeam();
    await addTeamMember(foreign.teamId, testData.userId, "member");
    const secondTeamId = foreign.teamId;

    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code, team_id: secondTeamId },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().team.id).toBe(secondTeamId);
  });

  it("rejects non-member team_id", async () => {
    const foreign = await createForeignTeam();
    const code = await sendCode(TEST_USER.email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code, team_id: foreign.teamId },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("Full agent bootstrap flow (end-to-end)", () => {
  it("send-code → agent-login for new user", async () => {
    // Step 1: Send code
    const sendRes = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "agentuser@pulse.pubky.org" },
    });
    expect(sendRes.statusCode).toBe(200);

    // Step 2: Agent login (verify + get agent key)
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "agentuser@pulse.pubky.org", code: testEmailService.lastCode },
    });
    expect(loginRes.statusCode).toBe(201);
    const body = loginRes.json();
    expect(body.api_key).toMatch(/^pulse_agent_/);
    expect(body.team).toBeDefined();

    // Step 3: Agent key works, reading the configured team's projects
    const projRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${body.api_key}` },
    });
    expect(projRes.statusCode).toBe(200);
    expect(projRes.json().projects.length).toBeGreaterThanOrEqual(1);
  });

  it("send-code → agent-login for existing user", async () => {
    const sendRes = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: TEST_USER.email },
    });
    expect(sendRes.statusCode).toBe(200);

    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: TEST_USER.email, code: testEmailService.lastCode },
    });
    expect(loginRes.statusCode).toBe(201);
    const body = loginRes.json();
    expect(body.api_key).toMatch(/^pulse_agent_/);

    // Agent key works — existing user has seeded project
    const projRes = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${body.api_key}` },
    });
    expect(projRes.statusCode).toBe(200);
    expect(projRes.json().projects.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /v1/auth/whoami", () => {
  it("returns key info for agent key auth", async () => {
    const code = await sendCode("whoami@pulse.pubky.org");

    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "whoami@pulse.pubky.org", code },
    });
    const agentKey = loginRes.json().api_key;

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe("api_key");
    expect(body.key_type).toBe("agent");
    expect(body.team.name).toBe("Test Team");
    expect(body.permissions).toBeInstanceOf(Array);
    expect(body.permissions.length).toBeGreaterThan(0);
  });

  it("returns user info for JWT auth", async () => {
    const { token } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe("user");
    expect(body.email).toBe(TEST_USER.email);
    expect(body.teams).toBeInstanceOf(Array);
    expect(body.teams.length).toBeGreaterThanOrEqual(1);
    expect(body.teams[0]).toHaveProperty("role");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
    });

    expect(res.statusCode).toBe(401);
  });
});
