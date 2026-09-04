import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import postgres from "postgres";
import { rateLimit, resetRateLimitBuckets } from "../middleware/rate-limit.js";
import {
  createCorsOriginResolver,
  invalidateWebAppOriginsCache,
} from "../utils/app-origins.js";
import {
  buildApp,
  truncateAll,
  seedTestData,
  seedWebTestApp,
  TEST_CLIENT_KEY,
  TEST_WEB_CLIENT_KEY,
  TEST_WEB_BUNDLE_ID,
  TEST_WEB_ORIGIN,
  TEST_SESSION_ID,
  TEST_DB_URL,
} from "./setup.js";

/**
 * The request layer in front of every SDK route: which bucket a caller draws
 * from, which browser origins CORS answers for, and which origins an app
 * actually accepts data from.
 *
 * The app is built with `trustProxy` on because that is the production shape
 * (Cloudflare, then nginx, then node on loopback) and the only one where
 * `X-Forwarded-For` means anything.
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ trustProxy: true });
});

beforeEach(async () => {
  await truncateAll();
  await seedTestData();
  await seedWebTestApp();
  // Buckets and the CORS union are module state that outlives a single case,
  // and truncateAll has just invalidated everything they hold.
  resetRateLimitBuckets();
  invalidateWebAppOriginsCache();
});

afterAll(async () => {
  await app.close();
});

async function clientKeyId(secret: string): Promise<string> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    const [row] = await client`SELECT id FROM api_keys WHERE secret = ${secret}`;
    return row.id as string;
  } finally {
    await client.end();
  }
}

/**
 * Drain a client key's bucket for one caller IP by calling the middleware
 * directly, rather than by firing a hundred HTTP requests.
 *
 * A bucket refills at 10 tokens per second, so "send more requests than the
 * bucket holds" is a race against however long those requests take — the exact
 * flake this avoids. Calling the middleware in a tight loop consumes the
 * tokens in well under the refill interval, and it is the same module state
 * the route's preHandler reads.
 */
async function drainBucket(keyId: string, ip: string): Promise<void> {
  const request = {
    ip,
    auth: { type: "api_key", key_type: "client", key_id: keyId },
  } as unknown as FastifyRequest;

  let limited = false;
  const reply = {
    header: () => reply,
    code: () => reply,
    send: () => {
      limited = true;
      return reply;
    },
  } as unknown as FastifyReply & { send: () => unknown };

  for (let i = 0; i < 200 && !limited; i++) {
    await rateLimit(request, reply);
  }
  expect(limited, "expected the bucket to drain within 200 calls").toBe(true);
}

function claim(ip: string) {
  return app.inject({
    method: "POST",
    url: "/v1/identity/claim",
    headers: { authorization: `Bearer ${TEST_CLIENT_KEY}`, "x-forwarded-for": ip },
    payload: { anonymous_id: "anon_request_layer", user_id: "user-request-layer" },
  });
}

describe("rate limiting", () => {
  it("gives two X-Forwarded-For addresses on one client key independent buckets", async () => {
    const keyId = await clientKeyId(TEST_CLIENT_KEY);
    await drainBucket(keyId, "203.0.113.10");

    const drained = await claim("203.0.113.10");
    expect(drained.statusCode).toBe(429);

    // A different visitor of the same site is untouched by the first one.
    const other = await claim("198.51.100.20");
    expect(other.statusCode).not.toBe(429);
  });

  it("returns 429 with Retry-After on POST /v1/identity/claim when the bucket is empty", async () => {
    const keyId = await clientKeyId(TEST_CLIENT_KEY);
    await drainBucket(keyId, "203.0.113.11");

    const res = await claim("203.0.113.11");
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json().error).toBe("Rate limit exceeded");
  });

  it("returns 429 on POST /v1/identity/properties when the bucket is empty", async () => {
    const keyId = await clientKeyId(TEST_CLIENT_KEY);
    await drainBucket(keyId, "203.0.113.12");

    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/properties",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        "x-forwarded-for": "203.0.113.12",
      },
      payload: { user_id: "user-request-layer", properties: { plan: "pro" } },
    });

    expect(res.statusCode).toBe(429);
  });
});

describe("CORS origin resolution", () => {
  function resolve(origin: string | undefined, configured: string[] = []): Promise<boolean> {
    const resolver = createCorsOriginResolver(app.db, configured);
    return new Promise((done, fail) => {
      resolver(origin, (err, allow) => (err ? fail(err) : done(allow)));
    });
  }

  it("allows an origin registered on a live web app", async () => {
    expect(await resolve(TEST_WEB_ORIGIN)).toBe(true);
  });

  it("rejects an origin no app registered", async () => {
    expect(await resolve("https://evil.example.com")).toBe(false);
  });

  it("allows a configured CORS_ORIGINS entry, which is the dashboard", async () => {
    expect(await resolve("http://localhost:3000", ["http://localhost:3000"])).toBe(true);
  });

  it("allows a request with no Origin header, which no browser sent", async () => {
    expect(await resolve(undefined)).toBe(true);
  });

  it("rejects a malformed origin", async () => {
    expect(await resolve("not-an-origin")).toBe(false);
  });

  it("stops allowing an origin once the app that registered it is updated", async () => {
    expect(await resolve(TEST_WEB_ORIGIN)).toBe(true);

    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`UPDATE apps SET allowed_origins = '{}' WHERE platform = 'web'`;
    } finally {
      await client.end();
    }
    invalidateWebAppOriginsCache();

    expect(await resolve(TEST_WEB_ORIGIN)).toBe(false);
  });
});

describe("web app origin enforcement", () => {
  function ingestFromOrigin(origin: string | undefined) {
    return app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_WEB_CLIENT_KEY}`,
        ...(origin ? { origin } : {}),
      },
      payload: {
        bundle_id: TEST_WEB_BUNDLE_ID,
        events: [
          {
            level: "info",
            message: "Page viewed",
            session_id: TEST_SESSION_ID,
            environment: "web",
          },
        ],
      },
    });
  }

  it("accepts ingest from the app's registered origin", async () => {
    const res = await ingestFromOrigin(TEST_WEB_ORIGIN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, rejected: 0 });
  });

  it("accepts ingest from the registered origin regardless of its casing", async () => {
    const res = await ingestFromOrigin("https://TEST.PULSE.PUBKY.ORG");
    expect(res.statusCode).toBe(200);
  });

  it("rejects ingest from an origin the app did not register", async () => {
    const res = await ingestFromOrigin("https://evil.example.com");
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("allowed_origins");
  });

  it("accepts ingest with no Origin header, which is every non-browser caller", async () => {
    const res = await ingestFromOrigin(undefined);
    expect(res.statusCode).toBe(200);
  });

  it("rejects identity claim from an unregistered origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/claim",
      headers: {
        authorization: `Bearer ${TEST_WEB_CLIENT_KEY}`,
        origin: "https://evil.example.com",
      },
      payload: { anonymous_id: "anon_web_origin", user_id: "user-web-origin" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("leaves a non-web app alone: its Origin header is not authorized against a list", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TEST_CLIENT_KEY}`,
        origin: "https://evil.example.com",
      },
      payload: {
        bundle_id: "org.pubky.pulse.test",
        events: [{ level: "info", message: "Launched", session_id: TEST_SESSION_ID }],
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("refuses every browser request once a web app's origin list is emptied", async () => {
    const client = postgres(TEST_DB_URL, { max: 1 });
    try {
      await client`UPDATE apps SET allowed_origins = '{}' WHERE platform = 'web'`;
    } finally {
      await client.end();
    }

    const res = await ingestFromOrigin(TEST_WEB_ORIGIN);
    expect(res.statusCode).toBe(403);
  });
});
