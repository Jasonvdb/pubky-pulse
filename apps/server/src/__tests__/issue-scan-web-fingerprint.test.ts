import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { issueScanHandler } from "../jobs/issue-scan.js";
import {
  buildApp,
  truncateAll,
  seedTestData,
  seedWebTestApp,
  getTokenAndTeamId,
  makeJobContext,
  TEST_CLIENT_KEY,
  TEST_BUNDLE_ID,
  TEST_WEB_CLIENT_KEY,
  TEST_WEB_BUNDLE_ID,
  TEST_DB_URL,
} from "./setup.js";

let app: FastifyInstance;
let dbClient: postgres.Sql;
let token: string;
let webProjectId: string;

beforeAll(async () => {
  app = await buildApp();
  dbClient = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await dbClient.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  ({ token } = await getTokenAndTeamId(app));
  ({ webProjectId } = await seedWebTestApp());
});

interface BrowserErrorEvent {
  message: string;
  device_model: string;
  os_version: string;
}

// The same missing `cart.total` read, as Chrome, Firefox and Safari word it.
const BROWSER_ERRORS: BrowserErrorEvent[] = [
  {
    message: "Cannot read properties of undefined (reading 'total')",
    device_model: "Chrome 120",
    os_version: "macOS 10.15.7",
  },
  {
    message: "cart.total is undefined",
    device_model: "Firefox 121",
    os_version: "Windows 10",
  },
  {
    message: "undefined is not an object (evaluating 'cart.total')",
    device_model: "Safari 17",
    os_version: "iOS 17.2",
  },
];

async function ingestErrors(
  events: BrowserErrorEvent[],
  opts: { key: string; bundleId: string; environment: string },
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ingest",
    headers: { Authorization: `Bearer ${opts.key}` },
    payload: {
      bundle_id: opts.bundleId,
      events: events.map((e, i) => ({
        level: "error",
        message: e.message,
        source_module: "Checkout",
        environment: opts.environment,
        device_model: e.device_model,
        os_version: e.os_version,
        // Each wording arrives from a different visitor, so each is its own
        // session — the scan clusters bursts per session.
        session_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
        custom_attributes: { _error_type: "TypeError" },
      })),
    },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().rejected).toBe(0);
}

async function runScan() {
  const handler = issueScanHandler(app.notificationDispatcher);
  return handler(makeJobContext(), {});
}

describe("issue_scan on web events", () => {
  it("groups the three browser wordings of one fault into a single issue", async () => {
    await ingestErrors(BROWSER_ERRORS, {
      key: TEST_WEB_CLIENT_KEY,
      bundleId: TEST_WEB_BUNDLE_ID,
      environment: "web",
    });

    const result = await runScan();
    expect(result.issues_created).toBe(1);
    expect(result.occurrences_created).toBe(BROWSER_ERRORS.length);
  });

  it("records the browser and OS on every occurrence", async () => {
    await ingestErrors(BROWSER_ERRORS, {
      key: TEST_WEB_CLIENT_KEY,
      bundleId: TEST_WEB_BUNDLE_ID,
      environment: "web",
    });
    await runScan();

    const [issueRow] = await dbClient<{ id: string }[]>`
      SELECT id FROM issues WHERE project_id = ${webProjectId}
    `;
    expect(issueRow).toBeDefined();

    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${webProjectId}/issues/${issueRow.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    const occurrences = res.json().occurrences as Array<{
      environment: string | null;
      device_model: string | null;
      os_version: string | null;
    }>;
    expect(occurrences).toHaveLength(BROWSER_ERRORS.length);
    expect(occurrences.every((o) => o.environment === "web")).toBe(true);
    expect(new Set(occurrences.map((o) => o.device_model))).toEqual(
      new Set(BROWSER_ERRORS.map((e) => e.device_model)),
    );
    expect(new Set(occurrences.map((o) => o.os_version))).toEqual(
      new Set(BROWSER_ERRORS.map((e) => e.os_version)),
    );
  });

  it("leaves non-web events split across the browser wordings", async () => {
    // The canonicalization is gated on environment === "web", so an apple app
    // reporting the same three strings keeps its existing fingerprints.
    await ingestErrors(BROWSER_ERRORS, {
      key: TEST_CLIENT_KEY,
      bundleId: TEST_BUNDLE_ID,
      environment: "ios",
    });

    const result = await runScan();
    expect(result.issues_created).toBe(BROWSER_ERRORS.length);
  });
});
