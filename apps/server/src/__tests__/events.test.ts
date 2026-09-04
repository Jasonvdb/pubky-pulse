import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  createForeignTeam,
  seedWebTestApp,
  TEST_CLIENT_KEY,
  TEST_AGENT_KEY,
  TEST_BUNDLE_ID,
  TEST_SESSION_ID,
  TEST_USER,
  TEST_WEB_CLIENT_KEY,
  TEST_WEB_BUNDLE_ID,
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

async function ingestEvents(events: any[]) {
  await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
    payload: { bundle_id: TEST_BUNDLE_ID, events },
  });
}

// The web app is its own fixture because `environment: "web"` is only accepted
// for a web-platform app.
async function ingestWebEvents(events: any[]) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { authorization: `Bearer ${TEST_WEB_CLIENT_KEY}` },
    payload: { bundle_id: TEST_WEB_BUNDLE_ID, events },
  });
  expect(res.json().rejected).toBe(0);
}

function messagesOf(res: { json: () => any }): string[] {
  return res.json().events.map((e: any) => e.message).sort();
}

function queryEvents(params: Record<string, string> = {}, key = TEST_AGENT_KEY) {
  const qs = new URLSearchParams(params).toString();
  return app.inject({
    method: "GET",
    url: `/v1/events${qs ? `?${qs}` : ""}`,
    headers: { authorization: `Bearer ${key}` },
  });
}

describe("GET /v1/events", () => {
  it("returns ingested events", async () => {
    await ingestEvents([
      { level: "info", message: "Event 1", session_id: TEST_SESSION_ID },
      { level: "error", message: "Event 2", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.has_more).toBe(false);
    expect(body.cursor).toBeNull();
  });

  it("filters by level", async () => {
    await ingestEvents([
      { level: "info", message: "Info event", session_id: TEST_SESSION_ID },
      { level: "error", message: "Error event", session_id: TEST_SESSION_ID },
      { level: "error", message: "Another error", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ level: "error" });
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e: any) => e.level === "error")).toBe(true);
  });

  it("filters by user_id", async () => {
    await ingestEvents([
      { level: "info", message: "User A", user_id: "user-a", session_id: TEST_SESSION_ID },
      { level: "info", message: "User B", user_id: "user-b", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ user_id: "user-a" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].user_id).toBe("user-a");
  });

  it("filters by screen_name", async () => {
    await ingestEvents([
      { level: "info", message: "Test", screen_name: "AppDelegate", session_id: TEST_SESSION_ID },
      { level: "info", message: "Test", screen_name: "ViewController", session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ screen_name: "AppDelegate" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].screen_name).toBe("AppDelegate");
  });

  it("filters by time range", async () => {
    const old = new Date("2026-03-01T00:00:00Z").toISOString();
    const recent = new Date().toISOString();

    await ingestEvents([
      { level: "info", message: "Old event", timestamp: old, session_id: TEST_SESSION_ID },
      { level: "info", message: "Recent event", timestamp: recent, session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ since: "2026-03-10T00:00:00Z" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Recent event");
  });

  it("paginates with cursor", async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      level: "info" as const,
      message: `Event ${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      session_id: TEST_SESSION_ID,
    }));
    await ingestEvents(events);

    const page1 = await queryEvents({ limit: "2" });
    const body1 = page1.json();
    expect(body1.events).toHaveLength(2);
    expect(body1.has_more).toBe(true);
    expect(body1.cursor).toBeDefined();

    const page2 = await queryEvents({ limit: "2", cursor: body1.cursor });
    const body2 = page2.json();
    expect(body2.events).toHaveLength(2);

    // No overlap between pages
    const ids1 = body1.events.map((e: any) => e.id);
    const ids2 = body2.events.map((e: any) => e.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it("orders events ascending when order=asc", async () => {
    const now = Date.now();
    await ingestEvents([
      { level: "info", message: "Oldest", timestamp: new Date(now - 3000).toISOString(), session_id: TEST_SESSION_ID },
      { level: "info", message: "Middle", timestamp: new Date(now - 2000).toISOString(), session_id: TEST_SESSION_ID },
      { level: "info", message: "Newest", timestamp: new Date(now - 1000).toISOString(), session_id: TEST_SESSION_ID },
    ]);

    const res = await queryEvents({ order: "asc" });
    const body = res.json();
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e: any) => e.message)).toEqual(["Oldest", "Middle", "Newest"]);

    const timestamps = body.events.map((e: any) => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("paginates ascending with cursor", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      level: "info" as const,
      message: `Event ${i}`,
      timestamp: new Date(now - (4 - i) * 1000).toISOString(),
      session_id: TEST_SESSION_ID,
    }));
    await ingestEvents(events);

    const page1 = await queryEvents({ limit: "2", order: "asc" });
    const body1 = page1.json();
    expect(body1.events).toHaveLength(2);
    expect(body1.has_more).toBe(true);
    expect(body1.cursor).toBeDefined();
    expect(body1.events[0].message).toBe("Event 0");
    expect(body1.events[1].message).toBe("Event 1");

    const page2 = await queryEvents({ limit: "2", order: "asc", cursor: body1.cursor });
    const body2 = page2.json();
    expect(body2.events).toHaveLength(2);
    expect(body2.events[0].message).toBe("Event 2");
    expect(body2.events[1].message).toBe("Event 3");

    const ids1 = body1.events.map((e: any) => e.id);
    const ids2 = body2.events.map((e: any) => e.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);

    const page3 = await queryEvents({ limit: "2", order: "asc", cursor: body2.cursor });
    const body3 = page3.json();
    expect(body3.events).toHaveLength(1);
    expect(body3.events[0].message).toBe("Event 4");
    expect(body3.has_more).toBe(false);
  });

  it("returns a stable order when events share a timestamp", async () => {
    // Batch flush from an SDK assigns the same Date to every event in the batch;
    // without a tiebreaker, Postgres can shuffle the order across polls and the
    // cursor either skips or duplicates rows at page boundaries.
    const ts = new Date().toISOString();
    const batch = Array.from({ length: 6 }, (_, i) => ({
      level: "info" as const,
      message: `Tie ${i}`,
      timestamp: ts,
      session_id: TEST_SESSION_ID,
    }));
    await ingestEvents(batch);

    const first = await queryEvents();
    const firstIds = first.json().events.map((e: any) => e.id);

    for (let i = 0; i < 3; i++) {
      const repeat = await queryEvents();
      expect(repeat.json().events.map((e: any) => e.id)).toEqual(firstIds);
    }

    const page1 = await queryEvents({ limit: "3" });
    const body1 = page1.json();
    expect(body1.events).toHaveLength(3);
    expect(body1.has_more).toBe(true);

    const page2 = await queryEvents({ limit: "3", cursor: body1.cursor });
    const body2 = page2.json();
    expect(body2.events).toHaveLength(3);
    expect(body2.has_more).toBe(false);

    const ids1 = body1.events.map((e: any) => e.id);
    const ids2 = body2.events.map((e: any) => e.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
    expect(new Set([...ids1, ...ids2]).size).toBe(6);
  });

  it("excludes development events by default", async () => {
    await ingestEvents([
      { level: "info", message: "Production event", session_id: TEST_SESSION_ID },
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, is_dev: true },
    ]);

    const res = await queryEvents();
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Production event");
  });

  it("includes development events when data_mode=all", async () => {
    await ingestEvents([
      { level: "info", message: "Production event", session_id: TEST_SESSION_ID },
      { level: "info", message: "Dev event", session_id: TEST_SESSION_ID, is_dev: true },
    ]);

    const res = await queryEvents({ data_mode: "all" });
    const body = res.json();
    expect(body.events).toHaveLength(2);
  });

  it("filters by session_id", async () => {
    const sessionA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const sessionB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await ingestEvents([
      { level: "info", message: "Session A", session_id: sessionA },
      { level: "info", message: "Session B", session_id: sessionB },
    ]);

    const res = await queryEvents({ session_id: sessionA });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Session A");
  });

  it("filters by environment", async () => {
    await ingestEvents([
      { level: "info", message: "iOS event", session_id: TEST_SESSION_ID, environment: "ios" },
      { level: "info", message: "iPadOS event", session_id: TEST_SESSION_ID, environment: "ipados" },
    ]);

    const res = await queryEvents({ environment: "ios" });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("iOS event");
  });

  describe("device and OS filters", () => {
    beforeEach(async () => {
      await seedWebTestApp();
    });

    it("filters by device_model, which carries the browser on web", async () => {
      await ingestWebEvents([
        { level: "info", message: "Chrome", session_id: TEST_SESSION_ID, environment: "web", device_model: "Chrome 120", os_version: "macOS 10.15.7" },
        { level: "info", message: "Safari", session_id: TEST_SESSION_ID, environment: "web", device_model: "Safari 17", os_version: "macOS 10.15.7" },
      ]);

      const res = await queryEvents({ device_model: "Chrome 120" });
      expect(messagesOf(res)).toEqual(["Chrome"]);
    });

    it("filters by os_version, which carries the OS name and version on web", async () => {
      await ingestWebEvents([
        { level: "info", message: "Mac", session_id: TEST_SESSION_ID, environment: "web", device_model: "Chrome 120", os_version: "macOS 10.15.7" },
        { level: "info", message: "Windows", session_id: TEST_SESSION_ID, environment: "web", device_model: "Chrome 120", os_version: "Windows 10" },
      ]);

      const res = await queryEvents({ os_version: "Windows 10" });
      expect(messagesOf(res)).toEqual(["Windows"]);
    });

    it("combines the device and OS filters", async () => {
      await ingestWebEvents([
        { level: "info", message: "Chrome on Mac", session_id: TEST_SESSION_ID, environment: "web", device_model: "Chrome 120", os_version: "macOS 10.15.7" },
        { level: "info", message: "Chrome on Windows", session_id: TEST_SESSION_ID, environment: "web", device_model: "Chrome 120", os_version: "Windows 10" },
        { level: "info", message: "Safari on Mac", session_id: TEST_SESSION_ID, environment: "web", device_model: "Safari 17", os_version: "macOS 10.15.7" },
      ]);

      const res = await queryEvents({ device_model: "Chrome 120", os_version: "macOS 10.15.7" });
      expect(messagesOf(res)).toEqual(["Chrome on Mac"]);
    });
  });

  describe("screen_name filter", () => {
    it("matches the exact path and anything nested under it", async () => {
      await ingestEvents([
        { level: "info", message: "Checkout", session_id: TEST_SESSION_ID, screen_name: "/checkout" },
        { level: "info", message: "Payment", session_id: TEST_SESSION_ID, screen_name: "/checkout/payment" },
        { level: "info", message: "Home", session_id: TEST_SESSION_ID, screen_name: "/" },
      ]);

      const res = await queryEvents({ screen_name: "/checkout" });
      expect(messagesOf(res)).toEqual(["Checkout", "Payment"]);
    });

    it("stops at the path separator rather than matching any prefix", async () => {
      await ingestEvents([
        { level: "info", message: "Checkout", session_id: TEST_SESSION_ID, screen_name: "/checkout" },
        { level: "info", message: "Abandoned", session_id: TEST_SESSION_ID, screen_name: "/checkout-abandoned" },
      ]);

      const res = await queryEvents({ screen_name: "/checkout" });
      expect(messagesOf(res)).toEqual(["Checkout"]);
    });

    it("treats a native screen name with no nesting as an exact match", async () => {
      await ingestEvents([
        { level: "info", message: "Settings", session_id: TEST_SESSION_ID, screen_name: "SettingsView" },
        { level: "info", message: "Settings detail", session_id: TEST_SESSION_ID, screen_name: "SettingsViewDetail" },
      ]);

      const res = await queryEvents({ screen_name: "SettingsView" });
      expect(messagesOf(res)).toEqual(["Settings"]);
    });

    it("treats wildcard characters in the filter as literals", async () => {
      await ingestEvents([
        { level: "info", message: "Literal", session_id: TEST_SESSION_ID, screen_name: "/search/%" },
        { level: "info", message: "Results", session_id: TEST_SESSION_ID, screen_name: "/search/results" },
      ]);

      const res = await queryEvents({ screen_name: "/search/%" });
      expect(messagesOf(res)).toEqual(["Literal"]);
    });
  });

  it("filters by until timestamp", async () => {
    const earlier = new Date(Date.now() - 7200_000).toISOString(); // 2 hours ago
    const later = new Date().toISOString();
    const middle = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago

    await ingestEvents([
      { level: "info", message: "Earlier event", session_id: TEST_SESSION_ID, timestamp: earlier },
      { level: "info", message: "Later event", session_id: TEST_SESSION_ID, timestamp: later },
    ]);

    const res = await queryEvents({ until: middle });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].message).toBe("Earlier event");
  });

  it("returns empty array when no events match", async () => {
    const res = await queryEvents({ level: "warn" });
    const body = res.json();
    expect(body.events).toHaveLength(0);
    expect(body.has_more).toBe(false);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects client key (no events:read permission)", async () => {
    const res = await queryEvents({}, TEST_CLIENT_KEY);
    expect(res.statusCode).toBe(403);
  });

  it("works with JWT auth", async () => {
    await ingestEvents([{ level: "info", message: "JWT test", session_id: TEST_SESSION_ID }]);

    const token = await getToken(app);
    const res = await queryEvents({}, token);
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(1);
  });
});

describe("GET /v1/events/:id", () => {
  it("returns a single event", async () => {
    await ingestEvents([{ level: "info", message: "Find me", session_id: TEST_SESSION_ID }]);

    const listRes = await queryEvents();
    const eventId = listRes.json().events[0].id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${eventId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("Find me");
    expect(typeof body.project_id).toBe("string");
    expect(body.project_id.length).toBeGreaterThan(0);
  });

  it("returns 404 for non-existent event", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("denies cross-team access to event", async () => {
    // The far side of the boundary is seeded directly: an agent key can no
    // longer be minted into a team of its own, because signing in always joins
    // the one configured team.
    const foreign = await createForeignTeam();

    // The configured team's agent key has events:read, and the event genuinely
    // exists — it is out of team, so it must read as absent.
    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${foreign.eventId}`,
      headers: { authorization: `Bearer ${TEST_AGENT_KEY}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects an agent key whose creator is not a member of the configured team", async () => {
    const foreign = await createForeignTeam();

    // Not a 404 and not a 403: per-request revalidation reloads the key's
    // creator, finds no singleton membership, and refuses the credential
    // outright — even for the key's own team's event.
    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${foreign.eventId}`,
      headers: { authorization: `Bearer ${foreign.apiKeySecret}` },
    });

    expect(res.statusCode).toBe(401);
    // Pins the reason: the key itself resolves, its creator does not.
    expect(res.json().error).toMatch(/creator/i);
  });
});
