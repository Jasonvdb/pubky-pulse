import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { events, metricEvents, funnelEvents, appUsers } from "@pubky-pulse/db";
import {
  MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH,
  MAX_EVENT_MESSAGE_LENGTH,
  PAGE_URL_ATTRIBUTE,
  REFERRER_ATTRIBUTE,
  HTTP_STATUS_ATTRIBUTE,
  HTTP_DURATION_MS_ATTRIBUTE,
} from "@pubky-pulse/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_EXPIRED_KEY,
  TEST_BACKEND_CLIENT_KEY,
  TEST_ANDROID_CLIENT_KEY,
  TEST_ANDROID_BUNDLE_ID,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_WEB_CLIENT_KEY,
  TEST_WEB_BUNDLE_ID,
  seedWebTestApp,
} from "./setup.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
});

afterAll(async () => {
  await app.close();
});

function ingest(
  events: any[],
  key = TEST_CLIENT_KEY,
  bundle_id = TEST_BUNDLE_ID
) {
  return app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${key}` },
    payload: { bundle_id, events },
  });
}

describe("POST /v1/ingest", () => {
  it("accepts a single valid event", async () => {
    const res = await ingest([
      { level: "info", message: "App launched", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it("accepts a batch of 20 events", async () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      level: "info",
      message: `Event ${i}`,
      session_id: TEST_SESSION_ID,
    }));

    const res = await ingest(events);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(20);
  });

  it("accepts events with all device fields", async () => {
    const res = await ingest([
      {
        level: "info",
        message: "Full event",
        session_id: TEST_SESSION_ID,
        user_id: "user-1",
        source_module: "AppDelegate",
        screen_name: "launch",
        custom_attributes: { key: "value" },
        environment: "ios",
        os_version: "18.2",
        app_version: "2.1.0",
        sdk_name: "pubky-pulse-swift",
        sdk_version: "0.1.0",
        device_model: "iPhone 15 Pro",
        build_number: "142",
        locale: "en_US",
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
  });

  it("persists sdk_name + sdk_version on the event row and propagates to app_users", async () => {
    const res = await ingest([
      {
        level: "info",
        message: "metric:photo-conversion:start",
        session_id: TEST_SESSION_ID,
        user_id: "user-sdk",
        sdk_name: "pubky-pulse-swift",
        sdk_version: "0.4.2",
      },
      {
        level: "info",
        message: "step:checkout-complete",
        session_id: TEST_SESSION_ID,
        user_id: "user-sdk",
        sdk_name: "pubky-pulse-swift",
        sdk_version: "0.4.2",
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(2);

    // The dual-write to metric_events / funnel_events / app_users is fire-and-forget.
    // 200ms matches the wait used in metrics.test.ts — 50ms is reliably too short on CI.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const [eventRow] = await app.db
      .select({ sdk_name: events.sdk_name, sdk_version: events.sdk_version })
      .from(events)
      .where(eq(events.message, "metric:photo-conversion:start"))
      .limit(1);
    expect(eventRow.sdk_name).toBe("pubky-pulse-swift");
    expect(eventRow.sdk_version).toBe("0.4.2");

    const [metricRow] = await app.db
      .select({ sdk_version: metricEvents.sdk_version })
      .from(metricEvents)
      .where(eq(metricEvents.metric_slug, "photo-conversion"))
      .limit(1);
    expect(metricRow.sdk_version).toBe("0.4.2");

    const [funnelRow] = await app.db
      .select({ sdk_version: funnelEvents.sdk_version })
      .from(funnelEvents)
      .where(eq(funnelEvents.step_name, "checkout-complete"))
      .limit(1);
    expect(funnelRow.sdk_version).toBe("0.4.2");

    const [userRow] = await app.db
      .select({ last_sdk_name: appUsers.last_sdk_name, last_sdk_version: appUsers.last_sdk_version })
      .from(appUsers)
      .where(eq(appUsers.user_id, "user-sdk"))
      .limit(1);
    expect(userRow.last_sdk_name).toBe("pubky-pulse-swift");
    expect(userRow.last_sdk_version).toBe("0.4.2");
  });

  it("writes app_users synchronously so a follow-up query returns the row without polling", async () => {
    // Regression for the claim race: a concurrent /v1/identity/claim that
    // arrives between an /v1/ingest response and the fire-and-forget app_users
    // upsert would see stale state and fail to merge the anon row. The fix
    // makes upsertAppUsers awaited; this test pins the new contract by
    // querying app_users immediately after ingest with no polling.
    const userId = "race-test-user";
    const res = await ingest([
      { level: "info", message: "race", session_id: TEST_SESSION_ID, user_id: userId },
    ]);
    expect(res.statusCode).toBe(200);

    const [row] = await app.db
      .select({ user_id: appUsers.user_id })
      .from(appUsers)
      .where(eq(appUsers.user_id, userId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row.user_id).toBe(userId);
  });

  it("rejects batch over 100 events", async () => {
    const events = Array.from({ length: 101 }, (_, i) => ({
      level: "info",
      message: `Event ${i}`,
      session_id: TEST_SESSION_ID,
    }));

    const res = await ingest(events);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/100/);
  });

  it("rejects events with missing message", async () => {
    const res = await ingest([{ level: "info", session_id: TEST_SESSION_ID }]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accepted: 0,
      rejected: 1,
      errors: [{ index: 0, message: expect.stringContaining("message") }],
    });
  });

  it("rejects events with invalid level", async () => {
    const res = await ingest([{ level: "critical", message: "test", session_id: TEST_SESSION_ID }]);

    expect(res.statusCode).toBe(200);
    expect(res.json().rejected).toBe(1);
  });

  it("accepts valid events and rejects invalid ones in same batch", async () => {
    const res = await ingest([
      { level: "info", message: "Good event", session_id: TEST_SESSION_ID },
      { level: "info", session_id: TEST_SESSION_ID }, // missing message
      { level: "error", message: "Another good one", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
  });

  it("deduplicates by client_event_id", async () => {
    const dedupId = "00000000-0000-0000-0000-000000000099";
    await ingest([
      { level: "info", message: "First", client_event_id: dedupId, session_id: TEST_SESSION_ID },
    ]);

    const res = await ingest([
      { level: "info", message: "Duplicate", client_event_id: dedupId, session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(0);
  });

  it("trims custom attribute values over 200 chars", async () => {
    const longValue = "x".repeat(300);
    const res = await ingest([
      {
        level: "info",
        message: "Trimmed custom attributes",
        session_id: TEST_SESSION_ID,
        custom_attributes: { key: longValue },
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
  });

  it("truncates messages over MAX_EVENT_MESSAGE_LENGTH", async () => {
    const message = "m".repeat(MAX_EVENT_MESSAGE_LENGTH + 500);
    const res = await ingest([
      { level: "info", message, session_id: TEST_SESSION_ID, user_id: "long-message-user" },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    const [row] = await app.db
      .select({ message: events.message })
      .from(events)
      .where(eq(events.user_id, "long-message-user"))
      .limit(1);
    expect(row.message).toHaveLength(MAX_EVENT_MESSAGE_LENGTH);
  });

  it("caps non-string custom attribute values", async () => {
    // custom_attributes is untrusted JSON: a client can send an array or
    // object, and stringifying it must not bypass the per-value cap.
    const res = await ingest([
      {
        level: "info",
        message: "Non-string attributes",
        session_id: TEST_SESSION_ID,
        user_id: "non-string-attrs-user",
        custom_attributes: {
          list: Array.from({ length: 400 }, (_, i) => i),
          count: 42,
        } as any,
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    const [row] = await app.db
      .select({ custom_attributes: events.custom_attributes })
      .from(events)
      .where(eq(events.user_id, "non-string-attrs-user"))
      .limit(1);
    expect(row.custom_attributes!.list).toHaveLength(MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH);
    expect(row.custom_attributes!.count).toBe("42");
  });

  it("rejects a non-UUID session_id per event without failing the batch", async () => {
    // session_id is a uuid column: before per-event validation a malformed
    // value blew up the INSERT and took the whole batch down with a 500.
    const res = await ingest([
      { level: "info", message: "Good", session_id: TEST_SESSION_ID },
      { level: "info", message: "Bad session", session_id: "not-a-uuid" },
      { level: "error", message: "Also good", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(2);
    expect(body.rejected).toBe(1);
    expect(body.errors).toEqual([
      { index: 1, message: expect.stringContaining("session_id must be a UUID") },
    ]);
  });

  it("rejects empty events array", async () => {
    const res = await ingest([]);
    expect(res.statusCode).toBe(400);
  });

  it("rejects agent key (no events:write permission)", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      TEST_AGENT_KEY
    );

    expect(res.statusCode).toBe(403);
  });

  it("rejects invalid API key", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      "pulse_client_invalidkeyinvalidkeyinvalidkeyinvalidke"
    );

    expect(res.statusCode).toBe(401);
  });

  it("rejects request without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      payload: { events: [{ level: "info", message: "test", session_id: TEST_SESSION_ID }] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects expired API key", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      TEST_EXPIRED_KEY
    );

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/expired/i);
  });

  it("rate limits after too many requests", async () => {
    // Drain the token bucket (100 tokens default)
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(
        ingest([{ level: "info", message: `Flood ${i}`, session_id: TEST_SESSION_ID }])
      );
    }
    const results = await Promise.all(promises);

    const rateLimited = results.filter((r) => r.statusCode === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
    expect(rateLimited[0].json().error).toMatch(/rate limit/i);
  });

  it("includes Retry-After header on 429 response", async () => {
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(
        ingest([{ level: "info", message: `Flood ${i}`, session_id: TEST_SESSION_ID }])
      );
    }
    const results = await Promise.all(promises);

    const rateLimited = results.find((r) => r.statusCode === 429)!;
    expect(rateLimited).toBeDefined();
    expect(rateLimited.headers["retry-after"]).toBe("1");
  });

  it("rate limits keys independently", async () => {
    // Drain the bucket for the default client key
    const promises = [];
    for (let i = 0; i < 105; i++) {
      promises.push(
        ingest([{ level: "info", message: `Flood ${i}`, session_id: TEST_SESSION_ID }])
      );
    }
    await Promise.all(promises);

    // A different key should still have its own full bucket
    const res = await ingest(
      [{ level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" }],
      TEST_BACKEND_CLIENT_KEY,
      undefined as any
    );

    expect(res.statusCode).toBe(200);
  });

  it("accepts gzip-compressed event payload", async () => {
    const json = JSON.stringify({
      bundle_id: TEST_BUNDLE_ID,
      events: [{ level: "info", message: "Compressed event", session_id: TEST_SESSION_ID }],
    });
    const compressed = gzipSync(Buffer.from(json));

    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: compressed,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it("rejects request with missing bundle_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { events: [{ level: "info", message: "test", session_id: TEST_SESSION_ID }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("rejects request with mismatched bundle_id", async () => {
    const res = await ingest(
      [{ level: "info", message: "test", session_id: TEST_SESSION_ID }],
      TEST_CLIENT_KEY,
      "com.wrong.bundle"
    );

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/bundle_id/);
  });

  it("stores is_dev flag from event payload", async () => {
    const res = await ingest([
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, is_dev: true },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

    // Query with data_mode=all to find the event
    const eventsRes = await app.inject({
      method: "GET",
      url: "/v1/events?data_mode=all",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const events = eventsRes.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].is_dev).toBe(true);
  });

  it("defaults is_dev to false when not provided", async () => {
    const res = await ingest([
      { level: "info", message: "Normal event", session_id: TEST_SESSION_ID },
    ]);

    expect(res.statusCode).toBe(200);

    const eventsRes = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });
    const events = eventsRes.json().events;
    expect(events).toHaveLength(1);
    expect(events[0].is_dev).toBe(false);
  });

  async function appUserIsDev(userId: string): Promise<boolean | undefined> {
    const [row] = await app.db
      .select({ is_dev: appUsers.is_dev })
      .from(appUsers)
      .where(eq(appUsers.user_id, userId))
      .limit(1);
    return row?.is_dev;
  }

  it("derives app_users.is_dev from a client dev event", async () => {
    const res = await ingest([
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, user_id: "dev-client-user", is_dev: true },
    ]);
    expect(res.statusCode).toBe(200);
    expect(await appUserIsDev("dev-client-user")).toBe(true);
  });

  it("is_dev is last-write-wins for client events (dev then prod flips to prod)", async () => {
    await ingest([
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, user_id: "flip-user", is_dev: true },
    ]);
    expect(await appUserIsDev("flip-user")).toBe(true);

    // A later production event from the shipped build re-classifies the user.
    await ingest([
      { level: "info", message: "Prod event", session_id: TEST_SESSION_ID, user_id: "flip-user", is_dev: false },
    ]);
    expect(await appUserIsDev("flip-user")).toBe(false);
  });

  it("does NOT set app_users.is_dev from backend events (dev/test clients hit prod backends)", async () => {
    // Backend-platform apps are excluded: a backend's events are always
    // "production" relative to the end user, so even is_dev:true must not flip
    // the flag — otherwise a dev tester whose backend reports prod looks prod.
    const res = await ingest(
      [{ level: "info", message: "Backend dev event", session_id: TEST_SESSION_ID, user_id: "backend-user", is_dev: true }],
      TEST_BACKEND_CLIENT_KEY,
      undefined,
    );
    expect(res.statusCode).toBe(200);
    expect(await appUserIsDev("backend-user")).toBe(false);
  });

  it("rejects invalid gzip data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      payload: Buffer.from("not valid gzip data"),
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("rejects gzip payload exceeding 1 MB compressed size", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": "2000000",
      },
      body: Buffer.from("irrelevant"),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("Compressed payload too large");
  });

  it("rejects gzip bomb (decompressed payload exceeding 1 MiB)", async () => {
    // 2 MiB of repeated data compresses to a few KiB
    const bomb = Buffer.from("x".repeat(2 * 1024 * 1024));
    const compressed = gzipSync(bomb);

    expect(compressed.length).toBeLessThan(1024 * 1024);

    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: compressed,
    });

    expect(res.statusCode).toBe(413);
  });

  it("accepts gzip-compressed batch of 100 events", async () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      level: "info",
      message: `Compressed batch event ${i} with padding ${"x".repeat(100)}`,
      session_id: TEST_SESSION_ID,
      custom_attributes: { key: "value", padding: "y".repeat(200) },
    }));

    const json = JSON.stringify({ bundle_id: TEST_BUNDLE_ID, events });
    const compressed = gzipSync(Buffer.from(json));

    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
      body: compressed,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(100);
  });

  describe("environment validation against app platform", () => {
    it("apple app accepts ios, ipados, macos, and watchos environments", async () => {
      const res = await ingest([
        { level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" },
        { level: "info", message: "iPadOS event", session_id: TEST_SESSION_ID, environment: "ipados" },
        { level: "info", message: "macOS event", session_id: TEST_SESSION_ID, environment: "macos" },
        { level: "info", message: "watchOS event", session_id: TEST_SESSION_ID, environment: "watchos" },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 4, rejected: 0 });
    });

    it("apple app rejects android, web, and backend environments", async () => {
      const res = await ingest([
        { level: "info", message: "Android event", session_id: TEST_SESSION_ID, environment: "android" },
        { level: "info", message: "Web event", session_id: TEST_SESSION_ID, environment: "web" },
        { level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" },
      ]);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(3);
      expect(body.errors[0].message).toMatch(/environment "android" is not allowed for apple apps/);
    });

    it("backend app accepts backend environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" }],
        TEST_BACKEND_CLIENT_KEY,
        undefined as any
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("backend app rejects ios environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" }],
        TEST_BACKEND_CLIENT_KEY,
        undefined as any
      );

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(1);
      expect(body.errors[0].message).toMatch(/environment "ios" is not allowed for backend apps/);
    });

    it("accepts events without environment (null/undefined)", async () => {
      const res = await ingest([
        { level: "info", message: "No env event", session_id: TEST_SESSION_ID },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("rejects mismatched environment while accepting valid ones in same batch", async () => {
      const res = await ingest([
        { level: "info", message: "Valid iOS", session_id: TEST_SESSION_ID, environment: "ios" },
        { level: "info", message: "Invalid Android", session_id: TEST_SESSION_ID, environment: "android" },
        { level: "info", message: "No environment", session_id: TEST_SESSION_ID },
      ]);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
    });

    // --- android platform ---

    it("android app accepts android environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "Android event", session_id: TEST_SESSION_ID, environment: "android" }],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("android app rejects ios, ipados, macos, web, and backend environments", async () => {
      const res = await ingest(
        [
          { level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" },
          { level: "info", message: "iPadOS event", session_id: TEST_SESSION_ID, environment: "ipados" },
          { level: "info", message: "macOS event", session_id: TEST_SESSION_ID, environment: "macos" },
          { level: "info", message: "Web event", session_id: TEST_SESSION_ID, environment: "web" },
          { level: "info", message: "Backend event", session_id: TEST_SESSION_ID, environment: "backend" },
        ],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(0);
      expect(body.rejected).toBe(5);
      expect(body.errors[0].message).toMatch(/environment "ios" is not allowed for android apps/);
      expect(body.errors[1].message).toMatch(/environment "ipados" is not allowed for android apps/);
      expect(body.errors[2].message).toMatch(/environment "macos" is not allowed for android apps/);
      expect(body.errors[3].message).toMatch(/environment "web" is not allowed for android apps/);
      expect(body.errors[4].message).toMatch(/environment "backend" is not allowed for android apps/);
    });

    it("android app accepts events without environment", async () => {
      const res = await ingest(
        [{ level: "info", message: "No env", session_id: TEST_SESSION_ID }],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
    });

    it("android app rejects mismatched environment while accepting valid ones", async () => {
      const res = await ingest(
        [
          { level: "info", message: "Valid Android", session_id: TEST_SESSION_ID, environment: "android" },
          { level: "info", message: "Invalid iOS", session_id: TEST_SESSION_ID, environment: "ios" },
          { level: "info", message: "No environment", session_id: TEST_SESSION_ID },
        ],
        TEST_ANDROID_CLIENT_KEY,
        TEST_ANDROID_BUNDLE_ID
      );

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(2);
      expect(body.rejected).toBe(1);
    });

    it("android app validates bundle_id", async () => {
      const res = await ingest(
        [{ level: "info", message: "test", session_id: TEST_SESSION_ID, environment: "android" }],
        TEST_ANDROID_CLIENT_KEY,
        "com.wrong.bundle"
      );

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/bundle_id/);
    });

    it("backend app rejects all non-backend environments", async () => {
      for (const env of ["ios", "ipados", "macos", "watchos", "android", "web"]) {
        const res = await ingest(
          [{ level: "info", message: `${env} event`, session_id: TEST_SESSION_ID, environment: env }],
          TEST_BACKEND_CLIENT_KEY,
          undefined as any
        );
        expect(res.json().rejected).toBe(1);
        expect(res.json().errors[0].message).toMatch(new RegExp(`environment "${env}" is not allowed for backend apps`));
      }
    });

    it("backend app accepts batch of backend events", async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({
        level: "info",
        message: `Backend batch ${i}`,
        session_id: TEST_SESSION_ID,
        environment: "backend",
      }));

      const res = await ingest(events, TEST_BACKEND_CLIENT_KEY, undefined as any);
      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(10);
    });
  });

  describe("web platform", () => {
    beforeEach(async () => {
      await seedWebTestApp();
    });

    function ingestWeb(payloads: any[]) {
      return ingest(payloads, TEST_WEB_CLIENT_KEY, TEST_WEB_BUNDLE_ID);
    }

    it("accepts a batch in the shape the Web SDK actually sends", async () => {
      // Mirrors @synonymdev/pubky-pulse-web: environment "web", device_model is
      // the browser, os_version the OS, screen_name the URL path, no build_number.
      const res = await ingestWeb([
        {
          client_event_id: "00000000-0000-0000-0000-0000000000a1",
          session_id: TEST_SESSION_ID,
          level: "info",
          message: "Page viewed",
          screen_name: "/checkout/payment",
          environment: "web",
          sdk_name: "pubky-pulse-web",
          sdk_version: "0.1.0",
          app_version: "1.4.0",
          device_model: "Chrome 120",
          os_version: "macOS 10.15.7",
          locale: "en-GB",
          preferred_language: "en-GB",
          user_id: "web-user",
          is_dev: false,
          timestamp: new Date().toISOString(),
          custom_attributes: {
            [PAGE_URL_ATTRIBUTE]: "https://app.example.com/checkout/payment?step=2",
            [REFERRER_ATTRIBUTE]: "https://app.example.com/checkout",
            [HTTP_STATUS_ATTRIBUTE]: "200",
            [HTTP_DURATION_MS_ATTRIBUTE]: "134",
          },
        },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

      const [row] = await app.db
        .select({
          environment: events.environment,
          device_model: events.device_model,
          os_version: events.os_version,
          screen_name: events.screen_name,
          build_number: events.build_number,
          sdk_name: events.sdk_name,
          custom_attributes: events.custom_attributes,
        })
        .from(events)
        .where(eq(events.user_id, "web-user"))
        .limit(1);
      expect(row.environment).toBe("web");
      expect(row.device_model).toBe("Chrome 120");
      expect(row.os_version).toBe("macOS 10.15.7");
      expect(row.screen_name).toBe("/checkout/payment");
      expect(row.build_number).toBeNull();
      expect(row.sdk_name).toBe("pubky-pulse-web");
      expect(row.custom_attributes![PAGE_URL_ATTRIBUTE]).toBe(
        "https://app.example.com/checkout/payment?step=2",
      );
      expect(row.custom_attributes![HTTP_STATUS_ATTRIBUTE]).toBe("200");
    });

    it("caps _page_url at 2048 rather than the default attribute cap", async () => {
      const longUrl = `https://app.example.com/p?q=${"u".repeat(3000)}`;
      const res = await ingestWeb([
        {
          level: "info",
          message: "Long URL",
          session_id: TEST_SESSION_ID,
          user_id: "long-url-user",
          environment: "web",
          custom_attributes: { [PAGE_URL_ATTRIBUTE]: longUrl, [REFERRER_ATTRIBUTE]: longUrl },
        },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(1);

      const [row] = await app.db
        .select({ custom_attributes: events.custom_attributes })
        .from(events)
        .where(eq(events.user_id, "long-url-user"))
        .limit(1);
      expect(row.custom_attributes![PAGE_URL_ATTRIBUTE]).toHaveLength(2048);
      expect(row.custom_attributes![REFERRER_ATTRIBUTE]).toHaveLength(2048);
    });

    it("truncates an oversize device_model to the column width", async () => {
      // A spoofed or unusually long user agent must not fail the batch's INSERT.
      const res = await ingestWeb([
        {
          level: "info",
          message: "Odd user agent",
          session_id: TEST_SESSION_ID,
          user_id: "long-ua-user",
          environment: "web",
          device_model: "B".repeat(400),
          os_version: "O".repeat(200),
        },
      ]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ accepted: 1, rejected: 0 });

      const [row] = await app.db
        .select({ device_model: events.device_model, os_version: events.os_version })
        .from(events)
        .where(eq(events.user_id, "long-ua-user"))
        .limit(1);
      expect(row.device_model).toHaveLength(100);
      expect(row.os_version).toHaveLength(50);
    });
  });
});
