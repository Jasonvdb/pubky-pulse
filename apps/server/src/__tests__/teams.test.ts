import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getTokenAndTeamId,
  createUserAndGetToken,
  createForeignTeam,
  addTeamMember,
  addProjectOwner,
  createAgentKey,
  TEST_USER,
  TEST_DB_URL,
} from "./setup.js";
import postgres from "postgres";

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

/** Create a second user and return their token + user info. */
async function registerSecondUser() {
  return createUserAndGetToken(app, "second@pulse.pubky.org", "Second User");
}

// ─── Singleton Team Reads ───────────────────────────────────────────

describe("GET /v1/teams/:teamId", () => {
  it("returns team details with members", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Test Team");
    expect(body.members).toHaveLength(1);
    expect(body.members[0].role).toBe("owner");
    expect(body.members[0].email).toBe(TEST_USER.email);
    // The invitation surface is gone entirely, contract included.
    expect(body.pending_invitations).toBeUndefined();
  });

  it("returns 403 for non-members", async () => {
    // Signing in attaches every allowed user to the configured team, so the
    // team a caller is *not* a member of is seeded directly in the database.
    const { token } = await getTokenAndTeamId(app);
    const foreign = await createForeignTeam();

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${foreign.teamId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("is readable by an ordinary member, not just the owner", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${second.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(2);
  });
});

describe("GET /v1/teams/:teamId/members", () => {
  it("lets any member read the roster with colleague-appropriate fields", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members`,
      headers: { authorization: `Bearer ${second.token}` },
    });

    expect(res.statusCode).toBe(200);
    const members = res.json().members;
    expect(members).toHaveLength(2);

    // The roster is the source for the project-owner picker, so it carries
    // identity and role and nothing else — no credentials, no preferences.
    for (const member of members) {
      expect(Object.keys(member).sort()).toEqual([
        "email", "joined_at", "name", "role", "user_id",
      ]);
      expect(["owner", "member"]).toContain(member.role);
    }
  });

  it("returns 403 for a team the caller is not in", async () => {
    const { token } = await getTokenAndTeamId(app);
    const foreign = await createForeignTeam();

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${foreign.teamId}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Removed Multi-Team and Invitation Surface ──────────────────────

describe("removed team and invitation endpoints", () => {
  it("no longer routes team creation, mutation, role change, removal or invitations", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    const routes = [
      { method: "POST" as const, url: "/v1/teams", payload: { name: "New", slug: "new-team" } },
      { method: "PATCH" as const, url: `/v1/teams/${teamId}`, payload: { name: "Renamed" } },
      { method: "DELETE" as const, url: `/v1/teams/${teamId}` },
      { method: "PATCH" as const, url: `/v1/teams/${teamId}/members/${testData.userId}`, payload: { role: "member" } },
      { method: "DELETE" as const, url: `/v1/teams/${teamId}/members/${testData.userId}` },
      { method: "POST" as const, url: `/v1/teams/${teamId}/invitations`, payload: { email: "someone@pulse.pubky.org" } },
      { method: "DELETE" as const, url: `/v1/teams/${teamId}/invitations/00000000-0000-0000-0000-000000000000` },
      { method: "GET" as const, url: "/v1/invites/00000000-0000-0000-0000-000000000000" },
      { method: "POST" as const, url: "/v1/invites/accept", payload: { token: "00000000-0000-0000-0000-000000000000" } },
    ];

    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${token}` },
        payload: "payload" in route ? route.payload : undefined,
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(404);
    }
  });

  it("leaves the singleton team and its roster untouched", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/teams/${teamId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const client = postgres(TEST_DB_URL, { max: 1 });
    const [team] = await client`SELECT deleted_at FROM teams WHERE id = ${teamId}`;
    expect(team.deleted_at).toBeNull();
    const members = await client`SELECT * FROM team_members WHERE team_id = ${teamId}`;
    expect(members).toHaveLength(1);
    await client.end();
  });

  it("dropped the team_invitations table", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    const [row] = await client`SELECT to_regclass('public.team_invitations') AS oid`;
    await client.end();
    expect(row.oid).toBeNull();
  });

  it("narrowed the team_role enum to owner and member", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    const rows = await client`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'team_role'
      ORDER BY e.enumsortorder
    `;
    await client.end();
    expect(rows.map((r) => r.label)).toEqual(["owner", "member"]);
  });
});

// ─── Agent Key Listing ──────────────────────────────────────────────

/** Create an agent key via the API, attributed to the user whose token is provided. Returns the key ID. */
async function createAgentKeyForUser(token: string, teamId: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
    payload: { name, key_type: "agent", team_id: teamId },
  });
  return res.json().api_key.id;
}

/**
 * Create a client key via the API, attributed to the user whose token is
 * provided. Returns the key ID.
 *
 * A client key is a project credential, so the caller must own the app's
 * project — callers below grant that ownership first.
 */
async function createClientKeyForUser(token: string, appId: string, name: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
    payload: { name, key_type: "client", app_id: appId },
  });
  return res.json().api_key.id;
}

describe("GET /v1/teams/:teamId/members/:userId/agent-keys", () => {
  it("returns the caller's own agent keys", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    const keyId = await createAgentKeyForUser(second.token, teamId, "Second Agent");

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${second.userId}/agent-keys`,
      headers: { authorization: `Bearer ${second.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].id).toBe(keyId);
    expect(body.keys[0].name).toBe("Second Agent");
  });

  it("excludes deleted keys and client keys", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    await createAgentKeyForUser(second.token, teamId, "Active Agent");
    // Minting a client key requires owning the app's project, so the second
    // user is made an owner of it first. The point of the test is unchanged:
    // the agent-key listing must exclude the client key.
    await addProjectOwner(testData.projectId, second.userId);
    await createClientKeyForUser(second.token, testData.appId, "Client Key");

    // Soft-delete one agent key
    const deletedId = await createAgentKeyForUser(second.token, teamId, "Deleted Agent");
    const client = postgres(TEST_DB_URL, { max: 1 });
    await client`UPDATE api_keys SET deleted_at = NOW() WHERE id = ${deletedId}`;
    await client.end();

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${second.userId}/agent-keys`,
      headers: { authorization: `Bearer ${second.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().keys).toHaveLength(1);
    expect(res.json().keys[0].name).toBe("Active Agent");
  });

  it("refuses to hand another member's agent secrets to the team owner", async () => {
    // The route returns raw secrets, and an agent key carries its creator's
    // full project access — so nobody, the team owner included, may read
    // somebody else's.
    const { token, teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");
    await createAgentKeyForUser(second.token, teamId, "Second Agent");

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${second.userId}/agent-keys`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("pulse_agent_");
  });
});

// ─── Role Enforcement on Existing Routes ────────────────────────────

describe("Role enforcement on existing routes", () => {
  async function addMemberAndGetToken(teamId: string) {
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");
    const { token } = await createUserAndGetToken(app, "second@pulse.pubky.org");
    return token;
  }

  it("member can create project and becomes its first owner", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    // Registered inline rather than through addMemberAndGetToken because this
    // test needs the new member's own user id to assert first ownership.
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${second.token}` },
      payload: { team_id: teamId, name: "New Project", slug: "new-project" },
    });

    // Creation is not role-gated: any team member may create a project, and
    // the creator becomes its first owner in the same transaction.
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.owners.map((o: { user_id: string }) => o.user_id)).toEqual([
      second.userId,
    ]);
    expect(body.access_level).toBe("owner");
  });

  it("member can read projects", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId);

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects.length).toBeGreaterThanOrEqual(1);
  });

  it("member cannot delete app", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member can create their own agent key", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const second = await registerSecondUser();
    await addTeamMember(teamId, second.userId, "member");
    const { token: memberToken } = await createUserAndGetToken(app, "second@pulse.pubky.org");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: "Test Key", key_type: "agent", team_id: teamId },
    });

    // An agent key carries only its creator's own access, so creating one is
    // not role-gated: it is a personal credential, not a project one.
    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.created_by).toBe(second.userId);
  });

  it("member cannot create a client key for a project they do not own", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: "Test Key", key_type: "client", app_id: testData.appId },
    });

    expect(res.statusCode).toBe(403);
  });

  it("member can read API keys", async () => {
    const { teamId } = await getTokenAndTeamId(app);
    const memberToken = await addMemberAndGetToken(teamId);

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${memberToken}` },
    });

    expect(res.statusCode).toBe(200);
  });
});

// ─── API Key Rejection on Team Routes ───────────────────────────────

describe("API key rejection on team routes", () => {
  it("rejects an agent key on the member agent-key route", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);
    const agentKey = await createAgentKey(app, token, teamId, [
      "events:read", "apps:read", "apps:write", "projects:read", "projects:write",
      "metrics:read", "metrics:write", "funnels:read", "funnels:write", "audit_logs:read",
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/members/${testData.userId}/agent-keys`,
      headers: { authorization: `Bearer ${agentKey}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("pulse_agent_");
  });
});
