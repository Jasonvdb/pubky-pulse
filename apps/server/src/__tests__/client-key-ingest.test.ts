import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import {
  buildApp, truncateAll, seedTestData, seedWebTestApp, TEST_DB_URL,
  TEST_CLIENT_KEY, TEST_ANDROID_CLIENT_KEY, TEST_BACKEND_CLIENT_KEY,
  TEST_WEB_CLIENT_KEY, TEST_WEB_ORIGIN, TEST_BUNDLE_ID, TEST_SESSION_ID, TEST_AGENT_KEY,
} from "./setup.js";

let app: FastifyInstance;
let db: postgres.Sql;

beforeAll(async () => {
  app = await buildApp();
  db = postgres(TEST_DB_URL, { max: 1 });
});
beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  await seedWebTestApp();
});
afterAll(async () => {
  await db.end();
  await app.close();
});

describe.each([
  ["apple", TEST_CLIENT_KEY], ["android", TEST_ANDROID_CLIENT_KEY],
  ["backend", TEST_BACKEND_CLIENT_KEY], ["web", TEST_WEB_CLIENT_KEY],
])("%s SDK app association", (platform, key) => {
  it.each(["missing", "matching", "mismatching", "empty", "null", "non-string"] as const)("handles %s bundle metadata without changing the key-selected app", async (kind) => {
    const [target] = await db`
      SELECT a.id, a.project_id, a.bundle_id FROM apps a JOIN api_keys k ON k.app_id=a.id WHERE k.secret=${key}
    `;
    const bundle_id = {
      missing: undefined, matching: target.bundle_id ?? "legacy.backend.identifier",
      mismatching: "unrelated.legacy.identifier", empty: "", null: null, "non-string": 42,
    }[kind];
    await db`
      INSERT INTO questionnaires (project_id, app_id, slug, name, schema, is_active)
      VALUES (${target.project_id}, ${target.id}, 'key-only', 'Key-only',
        '{"version":1,"questions":[]}'::jsonb, true)
    `;
    const headers = { authorization: `Bearer ${key}`, origin: TEST_WEB_ORIGIN };
    const metadata = bundle_id === undefined ? {} : { bundle_id };
    const query = bundle_id === undefined ? "" : `?bundle_id=${encodeURIComponent(String(bundle_id))}`;
    if ((platform === "apple" || platform === "android") && kind !== "missing" && kind !== "matching") {
      const requests = [
        { method: "POST" as const, url: "/v1/ingest", payload: { ...metadata, events: [{ level: "info", message: "key-only", session_id: TEST_SESSION_ID }] } },
        { method: "POST" as const, url: "/v1/feedback", payload: { ...metadata, message: "key-only" } },
        { method: "GET" as const, url: "/v1/questionnaires/key-only" + query },
        { method: "POST" as const, url: "/v1/questionnaires/key-only/responses", payload: { ...metadata, user_id: "key-only-user", answers: {} } },
        { method: "POST" as const, url: "/v1/questionnaires/dismiss", payload: { ...metadata, user_id: "key-only-user" } },
      ];
      for (const request of requests) {
        const response = await app.inject({ ...request, headers });
        expect(response.statusCode, request.url).toBe(403);
        expect(response.json()).toEqual({ error: "bundle_id does not match the app associated with this API key" });
      }
      expect(await db`SELECT app_id FROM events WHERE message='key-only'`).toHaveLength(0);
      expect(await db`SELECT app_id FROM feedback WHERE message='key-only'`).toHaveLength(0);
      expect(await db`SELECT app_id FROM questionnaire_responses WHERE user_id='key-only-user'`).toHaveLength(0);
      expect(await db`SELECT project_id FROM app_users WHERE user_id='key-only-user'`).toHaveLength(0);
      return;
    }
    const ingest = await app.inject({
      method: "POST", url: "/v1/ingest", headers,
      payload: { ...metadata, events: [{ level: "info", message: "key-only", session_id: TEST_SESSION_ID }] },
    });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json()).toEqual({ accepted: 1, rejected: 0 });
    const [event] = await db`SELECT app_id FROM events WHERE message='key-only'`;
    expect(event.app_id).toBe(target.id);

    const feedback = await app.inject({
      method: "POST", url: "/v1/feedback", headers,
      payload: { ...metadata, message: "key-only" },
    });
    expect(feedback.statusCode).toBe(201);
    const [storedFeedback] = await db`SELECT app_id FROM feedback WHERE id=${feedback.json().id}`;
    expect(storedFeedback.app_id).toBe(target.id);

    const fetched = await app.inject({
      method: "GET", headers,
      url: "/v1/questionnaires/key-only" + query,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().eligible).toBe(true);
    const saved = await app.inject({
      method: "POST", url: "/v1/questionnaires/key-only/responses", headers,
      payload: { ...metadata, user_id: "key-only-user", answers: {} },
    });
    expect(saved.statusCode).toBe(201);
    const [response] = await db`SELECT app_id FROM questionnaire_responses WHERE id=${saved.json().id}`;
    expect(response.app_id).toBe(target.id);
    const dismissed = await app.inject({
      method: "POST", url: "/v1/questionnaires/dismiss", headers,
      payload: { ...metadata, user_id: "key-only-user" },
    });
    expect(dismissed.statusCode).toBe(200);
    const [user] = await db`SELECT project_id FROM app_users WHERE user_id='key-only-user'`;
    expect(user.project_id).toBe(target.project_id);
  });
});

describe("key-only boundaries", () => {
  const requests = [
    { method: "POST" as const, url: "/v1/ingest", payload: { events: [{ level: "info", message: "test", session_id: TEST_SESSION_ID }] } },
    { method: "POST" as const, url: "/v1/feedback", payload: { message: "test" } },
    { method: "GET" as const, url: "/v1/questionnaires/foreign" },
    { method: "POST" as const, url: "/v1/questionnaires/foreign/responses", payload: { answers: {} } },
    { method: "POST" as const, url: "/v1/questionnaires/dismiss", payload: { user_id: "test" } },
  ];

  it.each(requests)("preserves origin and authentication checks for $method $url", async (request) => {
    const unauthorized = await app.inject(request);
    expect(unauthorized.statusCode).toBe(401);
    const forbidden = await app.inject({
      ...request,
      headers: { authorization: `Bearer ${TEST_WEB_CLIENT_KEY}`, origin: "https://unregistered.example.com" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toMatch(/allowed origin/);
    const wrongPermission = await app.inject({
      ...request,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    expect(wrongPermission.statusCode).toBe(403);
  });

  it("cannot select another app's questionnaire using its bundle metadata", async () => {
    const [native] = await db`SELECT id, project_id FROM apps WHERE bundle_id=${TEST_BUNDLE_ID}`;
    await db`
      INSERT INTO questionnaires (project_id, app_id, slug, name, schema, is_active)
      VALUES (${native.project_id}, ${native.id}, 'foreign', 'Foreign',
        '{"version":1,"questions":[]}'::jsonb, true)
    `;
    const headers = { authorization: `Bearer ${TEST_WEB_CLIENT_KEY}`, origin: TEST_WEB_ORIGIN };
    const fetched = await app.inject({
      method: "GET", url: `/v1/questionnaires/foreign?bundle_id=${TEST_BUNDLE_ID}`, headers,
    });
    expect(fetched.statusCode).toBe(404);
    const saved = await app.inject({
      method: "POST", url: "/v1/questionnaires/foreign/responses", headers,
      payload: { bundle_id: TEST_BUNDLE_ID, answers: {} },
    });
    expect(saved.statusCode).toBe(404);
  });
});
