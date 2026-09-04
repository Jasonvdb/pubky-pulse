import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  createForeignTeam,
  TEST_USER,
  TEST_AGENT_KEY,
  TEST_CLIENT_KEY,
  TEST_SESSION_ID,
  TEST_DB_URL,
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

describe("GET /v1/apps", () => {
  it("lists apps with client keys", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.apps).toHaveLength(3);
    const appleApp = body.apps.find((a: any) => a.platform === "apple");
    expect(appleApp.name).toBe("Test App");
    expect(appleApp.client_secret).toBe(TEST_CLIENT_KEY);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/apps/:id", () => {
  it("returns app by id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(testData.appId);
    expect(body.name).toBe("Test App");
    expect(body.platform).toBe("apple");
    expect(body.client_secret).toBe(TEST_CLIENT_KEY);
    expect(body.created_at).toBeDefined();
  });

  it("returns 404 for non-existent app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for deleted app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for app in another team", async () => {
    // A second sign-in no longer produces a team of its own, so the far side of
    // the boundary is seeded directly. The caller is a full member of the one
    // configured team and still must not see an app outside it.
    const foreign = await createForeignTeam();
    const token = await getToken(app);

    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${foreign.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects client key (no apps:read permission)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/apps", () => {
  it("creates a new app with auto-generated client key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Android App",
        platform: "android",
        bundle_id: "org.pubky.pulse.android",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Android App");
    expect(body.platform).toBe("android");
    expect(body.bundle_id).toBe("org.pubky.pulse.android");
    expect(body.team_id).toBe(testData.teamId);
    expect(body.client_secret).toMatch(/^pulse_client_/);
  });

  it("auto-created client key appears in keys list", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Key List App",
        platform: "apple",
        bundle_id: "org.pubky.pulse.keylist",
        project_id: testData.projectId,
      },
    });

    const appId = createRes.json().id;

    const keysRes = await app.inject({
      method: "GET",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${token}` },
    });

    const keys = keysRes.json().api_keys;
    const autoKey = keys.find((k: { app_id: string }) => k.app_id === appId);
    expect(autoKey).toBeDefined();
    expect(autoKey.key_type).toBe("client");
  });

  it("auto-created client key works for ingest", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ingest App",
        platform: "apple",
        bundle_id: "org.pubky.pulse.ingest",
        project_id: testData.projectId,
      },
    });

    const body = createRes.json();
    const clientKey = body.client_secret;

    const ingestRes = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${clientKey}` },
      payload: {
        bundle_id: "org.pubky.pulse.ingest",
        events: [
          { level: "info", message: "test event", session_id: TEST_SESSION_ID },
        ],
      },
    });

    expect(ingestRes.statusCode).toBe(200);
  });

  it("client key is consistent between create and list", async () => {
    const token = await getToken(app);
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Consistent App",
        platform: "apple",
        bundle_id: "org.pubky.pulse.consistent",
        project_id: testData.projectId,
      },
    });

    const createdKey = createRes.json().client_secret;

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    const listedApp = listRes.json().apps.find(
      (a: { bundle_id: string }) => a.bundle_id === "org.pubky.pulse.consistent"
    );
    expect(listedApp.client_secret).toBe(createdKey);
  });

  it("rejects missing required fields", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "No Platform" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects missing bundle_id", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "No Bundle", platform: "apple", project_id: testData.projectId },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects client key (no apps:write permission)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        name: "Nope",
        platform: "apple",
        bundle_id: "org.pubky.pulse.nope",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("new app appears in list", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Second App", platform: "web", bundle_id: "pulse.pubky.org", project_id: testData.projectId },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().apps).toHaveLength(4);
  });

  it("cannot create app under a deleted project", async () => {
    const token = await getToken(app);

    // Delete the project first
    await app.inject({
      method: "DELETE",
      url: `/v1/projects/${testData.projectId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Ghost App",
        platform: "apple",
        bundle_id: "org.pubky.pulse.ghost",
        project_id: testData.projectId,
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/apps/:id", () => {
  it("updates app name and preserves client key", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Renamed App" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Renamed App");
    expect(body.client_secret).toBe(TEST_CLIENT_KEY);
  });

  it("ignores bundle_id in update payload", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { bundle_id: "org.pubky.pulse.updated" },
    });

    // bundle_id is not an updatable field, so this is treated as an empty update
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty body", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/apps/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects client key (no apps:write permission)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("cannot update a deleted app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Nope" },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /v1/apps/:id", () => {
  it("soft-deletes an app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);

    // Verify it no longer appears in the list
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.json().apps).toHaveLength(2);
  });

  it("returns 404 for non-existent app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/apps/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("cascade soft-deletes api_keys for the app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Client key for this app should be soft-deleted
    const client = postgres(TEST_DB_URL, { max: 1 });
    const activeKeys = await client`
      SELECT id FROM api_keys
      WHERE app_id = ${testData.appId} AND deleted_at IS NULL
    `;
    expect(activeKeys).toHaveLength(0);

    // Keys for other apps should be unaffected
    const otherKeys = await client`
      SELECT id FROM api_keys
      WHERE app_id != ${testData.appId} AND app_id IS NOT NULL AND deleted_at IS NULL
    `;
    expect(otherKeys.length).toBeGreaterThan(0);
    await client.end();
  });

  it("returns 404 when deleting an already-deleted app", async () => {
    const token = await getToken(app);

    await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for app belonging to another team", async () => {
    const foreign = await createForeignTeam();
    const token = await getToken(app);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${foreign.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);

    // The refusal must also be a no-op: a 404 that still soft-deleted the row
    // would be worse than a 403.
    const client = postgres(TEST_DB_URL, { max: 1 });
    const [row] = await client`SELECT deleted_at FROM apps WHERE id = ${foreign.appId}`;
    await client.end();
    expect(row.deleted_at).toBeNull();
  });

  it("rejects client key (no apps:write permission)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

/**
 * `allowed_origins` is what actually scopes a web app's public client key to
 * the sites its operator owns, so the write path is where a bad entry has to be
 * refused — the enforcement hook can only compare against what was stored.
 */
describe("app allowed_origins", () => {
  const WEB_APP = {
    name: "Web App",
    platform: "web",
    bundle_id: "app.example.com",
  };

  async function createWebApp(token: string, allowed_origins?: unknown) {
    return app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...WEB_APP,
        project_id: testData.projectId,
        ...(allowed_origins !== undefined ? { allowed_origins } : {}),
      },
    });
  }

  it("stores normalized origins on create", async () => {
    const token = await getToken(app);
    const res = await createWebApp(token, [
      "HTTPS://App.Example.com",
      "http://localhost:3000",
      "https://app.example.com",
    ]);

    expect(res.statusCode).toBe(201);
    expect(res.json().allowed_origins).toEqual([
      "https://app.example.com",
      "http://localhost:3000",
    ]);
  });

  it("defaults to an empty list when create omits the field", async () => {
    const token = await getToken(app);
    const res = await createWebApp(token);

    expect(res.statusCode).toBe(201);
    expect(res.json().allowed_origins).toEqual([]);
  });

  it("serializes an empty list for a non-web app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().allowed_origins).toEqual([]);
  });

  it("rejects an origin with a path", async () => {
    const token = await getToken(app);
    const res = await createWebApp(token, ["https://app.example.com/analytics"]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("https://app.example.com/analytics");
  });

  it("rejects allowed_origins on a non-web platform", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Apple App",
        platform: "apple",
        bundle_id: "org.pubky.pulse.origins",
        project_id: testData.projectId,
        allowed_origins: ["https://app.example.com"],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("only supported for web apps");
  });

  it("replaces the whole list on update and audit-logs the change", async () => {
    const token = await getToken(app);
    const created = await createWebApp(token, ["https://app.example.com"]);
    const appId = created.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { allowed_origins: ["https://staging.example.com"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().allowed_origins).toEqual(["https://staging.example.com"]);

    const logs = await app.inject({
      method: "GET",
      url: `/v1/teams/${testData.teamId}/audit-logs`,
      headers: { authorization: `Bearer ${token}` },
    });
    const entry = logs
      .json()
      .audit_logs.find(
        (l: any) => l.resource_id === appId && l.action === "update",
      );
    expect(entry.changes.allowed_origins).toEqual({
      before: ["https://app.example.com"],
      after: ["https://staging.example.com"],
    });
  });

  it("clears the list when update sends an empty array", async () => {
    const token = await getToken(app);
    const created = await createWebApp(token, ["https://app.example.com"]);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${created.json().id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { allowed_origins: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().allowed_origins).toEqual([]);
  });

  it("rejects updating allowed_origins on a non-web app", async () => {
    const token = await getToken(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/apps/${testData.appId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { allowed_origins: ["https://app.example.com"] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("only supported for web apps");
  });

  it("rejects a non-array value", async () => {
    const token = await getToken(app);
    const res = await createWebApp(token, "https://app.example.com");

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("must be an array");
  });
});
