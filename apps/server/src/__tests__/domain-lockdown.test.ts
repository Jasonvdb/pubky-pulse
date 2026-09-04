import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { hashVerificationCode } from "@pubky-pulse/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  getToken,
  getTokenAndTeamId,
  testEmailService,
  TEST_BUNDLE_ID,
  TEST_CLIENT_KEY,
  TEST_DB_URL,
  TEST_SESSION_ID,
  TEST_USER,
} from "./setup.js";
import { config } from "../config.js";

/**
 * `pulse.pubky.org` and `example.com` are the configured allowed domains for the
 * test suite (see vitest.config.ts). Everything below leans on `blocked.test`
 * being outside that list.
 */
const DISALLOWED_EMAIL = "intruder@blocked.test";

let app: FastifyInstance;
let client: postgres.Sql;
let testData: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  app = await buildApp();
  client = postgres(TEST_DB_URL, { max: 1 });
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
  testEmailService.lastEmail = "";
  testEmailService.lastCode = "";
});

afterAll(async () => {
  await client.end();
  await app.close();
});

/** Insert a usable verification code directly, bypassing /send-code entirely. */
async function injectCode(email: string, code = "424242"): Promise<void> {
  await client`
    INSERT INTO email_verification_codes (email, code_hash, expires_at)
    VALUES (${email}, ${hashVerificationCode(code)}, ${new Date(Date.now() + 10 * 60 * 1000)})
  `;
}

describe("POST /v1/auth/send-code domain policy", () => {
  it("rejects a disallowed domain without creating a code or sending mail", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: DISALLOWED_EMAIL },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).not.toContain(DISALLOWED_EMAIL);

    const codes = await client`SELECT id FROM email_verification_codes`;
    expect(codes).toHaveLength(0);
    expect(testEmailService.lastEmail).toBe("");
    expect(testEmailService.lastCode).toBe("");
  });

  it("rejects a near-match subdomain that is not itself allowed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "someone@mail.pulse.pubky.org" },
    });

    expect(res.statusCode).toBe(403);
    expect(await client`SELECT id FROM email_verification_codes`).toHaveLength(0);
  });

  it("accepts an allowed address with surrounding whitespace and mixed case", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "  MixedCase@Pulse.Pubky.Org  " },
    });

    expect(res.statusCode).toBe(200);
    expect(testEmailService.lastEmail).toBe("mixedcase@pulse.pubky.org");

    // The stored code is keyed by the normalized address, so verification finds it.
    const codes = await client`SELECT email FROM email_verification_codes`;
    expect(codes).toHaveLength(1);
    expect(codes[0].email).toBe("mixedcase@pulse.pubky.org");
  });

  it("does not consume a rate-limit slot for a disallowed address", async () => {
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/send-code",
        payload: { email: DISALLOWED_EMAIL },
      });
      // Always the policy rejection, never the 429 that a consumed slot causes.
      expect(res.statusCode).toBe(403);
    }
    expect(await client`SELECT id FROM email_verification_codes`).toHaveLength(0);
  });
});

describe("POST /v1/auth/verify-code domain policy", () => {
  it("cannot consume a valid injected code for a disallowed domain", async () => {
    await injectCode(DISALLOWED_EMAIL);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: DISALLOWED_EMAIL, code: "424242" },
    });

    expect(res.statusCode).toBe(403);

    // The code is left untouched — the request never reached the consumer.
    const [row] = await client`SELECT used_at FROM email_verification_codes`;
    expect(row.used_at).toBeNull();

    const users = await client`SELECT id FROM users WHERE email = ${DISALLOWED_EMAIL}`;
    expect(users).toHaveLength(0);
  });

  it("normalizes the address so a mixed-case sign-in reuses one user row", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "casing@pulse.pubky.org" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: "  CASING@PULSE.PUBKY.ORG ", code: testEmailService.lastCode },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe("casing@pulse.pubky.org");

    const users = await client`SELECT id FROM users WHERE email ILIKE 'casing@pulse.pubky.org'`;
    expect(users).toHaveLength(1);
  });
});

describe("POST /v1/auth/agent-login domain policy", () => {
  it("rejects a disallowed domain and cannot consume an injected code", async () => {
    await injectCode(DISALLOWED_EMAIL);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: DISALLOWED_EMAIL, code: "424242" },
    });

    expect(res.statusCode).toBe(403);

    const [row] = await client`SELECT used_at FROM email_verification_codes`;
    expect(row.used_at).toBeNull();

    // No user, no membership, and above all no agent key was minted.
    expect(await client`SELECT id FROM users WHERE email = ${DISALLOWED_EMAIL}`).toHaveLength(0);
    expect(await client`SELECT id FROM api_keys WHERE name = 'Agent Key'`).toHaveLength(0);
  });

  it("attaches an allowed agent user to the configured team", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "agentjoin@pulse.pubky.org" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email: "agentjoin@pulse.pubky.org", code: testEmailService.lastCode },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().team.id).toBe(testData.teamId);

    const teams = await client`SELECT id FROM teams WHERE deleted_at IS NULL`;
    expect(teams).toHaveLength(1);
  });
});

describe("per-request JWT revalidation", () => {
  it("rejects a still-signed token after the membership is removed", async () => {
    const token = await getToken(app);

    const before = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    await client`DELETE FROM team_members WHERE user_id = ${testData.userId}`;

    const after = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("rejects a still-signed token after the stored email leaves the allowlist", async () => {
    const token = await getToken(app);

    await client`UPDATE users SET email = ${DISALLOWED_EMAIL} WHERE id = ${testData.userId}`;

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a still-signed token after the user row is deleted", async () => {
    const token = await getToken(app);

    await client`DELETE FROM api_keys WHERE created_by = ${testData.userId}`;
    await client`DELETE FROM project_owners WHERE user_id = ${testData.userId}`;
    await client`DELETE FROM users WHERE id = ${testData.userId}`;

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not trust the email embedded in the token", async () => {
    const { token } = await getTokenAndTeamId(app);

    await client`
      UPDATE users SET email = 'renamed@example.com' WHERE id = ${testData.userId}
    `;

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/whoami",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // The JWT still carries the original address; the response reflects the row.
    expect(res.json().email).toBe("renamed@example.com");
    expect(res.json().email).not.toBe(TEST_USER.email);
  });

  it("resolves the singleton team by slug, so a recreated team keeps sessions working", async () => {
    const token = await getToken(app);

    // Recreate the configured team under a new uuid, carrying the membership over.
    await client`DELETE FROM team_members WHERE team_id = ${testData.teamId}`;
    await client`DELETE FROM project_owners`;
    await client`DELETE FROM api_keys WHERE team_id = ${testData.teamId}`;
    await client`DELETE FROM apps WHERE team_id = ${testData.teamId}`;
    await client`DELETE FROM projects WHERE team_id = ${testData.teamId}`;
    await client`DELETE FROM teams WHERE id = ${testData.teamId}`;
    const [recreated] = await client`
      INSERT INTO teams (name, slug)
      VALUES (${config.defaultTeamName}, ${config.defaultTeamSlug})
      RETURNING id
    `;
    await client`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES (${recreated.id}, ${testData.userId}, 'owner')
    `;

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().teams[0].id).toBe(recreated.id);
  });
});

describe("per-request agent-key revalidation", () => {
  /** Mint an agent key owned by a freshly signed-in member. */
  async function agentKeyFor(email: string): Promise<{ secret: string; userId: string }> {
    await app.inject({ method: "POST", url: "/v1/auth/send-code", payload: { email } });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/agent-login",
      payload: { email, code: testEmailService.lastCode },
    });
    const [user] = await client`SELECT id FROM users WHERE email = ${email}`;
    return { secret: login.json().api_key, userId: user.id as string };
  }

  it("rejects the key once its creator loses membership", async () => {
    const { secret, userId } = await agentKeyFor("agentcreator@pulse.pubky.org");

    const before = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(before.statusCode).toBe(200);

    await client`DELETE FROM team_members WHERE user_id = ${userId}`;

    const after = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("rejects the key once its creator's email leaves the allowlist", async () => {
    const { secret, userId } = await agentKeyFor("agentdomain@pulse.pubky.org");

    await client`UPDATE users SET email = ${DISALLOWED_EMAIL} WHERE id = ${userId}`;

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("keeps client and import ingestion keys working regardless of membership", async () => {
    // The SDK data plane must not be coupled to human team membership: removing
    // every member cannot be allowed to silently stop ingestion.
    await client`DELETE FROM team_members WHERE team_id = ${testData.teamId}`;

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: {
        bundle_id: TEST_BUNDLE_ID,
        events: [
          { level: "info", message: "ingestion survives", session_id: TEST_SESSION_ID },
        ],
      },
    });

    expect(ingest.statusCode).toBe(200);
    expect(ingest.json()).toEqual({ accepted: 1, rejected: 0 });
  });
});

describe("default agent key isolation", () => {
  it("never returns another member's agent key", async () => {
    const { token: ownerToken, teamId } = await getTokenAndTeamId(app);

    // The seeded team already holds an agent key created by the seeded owner.
    const ownerKey = await app.inject({
      method: "POST",
      url: "/v1/auth/default-agent-key",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { team_id: teamId },
    });
    expect(ownerKey.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "colleague@pulse.pubky.org" },
    });
    const colleague = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: "colleague@pulse.pubky.org", code: testEmailService.lastCode },
    });
    const colleagueToken = colleague.json().token;

    // The login response must not carry a key the colleague did not create.
    expect(colleague.json().teams[0].default_agent_key).toBeUndefined();

    const colleagueKey = await app.inject({
      method: "POST",
      url: "/v1/auth/default-agent-key",
      headers: { authorization: `Bearer ${colleagueToken}` },
      payload: { team_id: teamId },
    });
    expect(colleagueKey.statusCode).toBe(201);
    expect(colleagueKey.json().secret).not.toBe(ownerKey.json().secret);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${colleagueToken}` },
    });
    expect(me.json().teams[0].default_agent_key).toBe(colleagueKey.json().secret);
  });

  it("is stable under concurrent calls from the same user", async () => {
    const { token, teamId } = await getTokenAndTeamId(app);

    await app.inject({
      method: "POST",
      url: "/v1/auth/send-code",
      payload: { email: "concurrent@pulse.pubky.org" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-code",
      payload: { email: "concurrent@pulse.pubky.org", code: testEmailService.lastCode },
    });
    const concurrentToken = login.json().token;
    void token;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/auth/default-agent-key",
          headers: { authorization: `Bearer ${concurrentToken}` },
          payload: { team_id: teamId },
        })
      )
    );

    const secrets = new Set(results.map((r) => r.json().secret));
    expect(secrets.size).toBe(1);

    const [user] = await client`SELECT id FROM users WHERE email = 'concurrent@pulse.pubky.org'`;
    const keys = await client`
      SELECT id FROM api_keys WHERE created_by = ${user.id} AND key_type = 'agent' AND deleted_at IS NULL
    `;
    expect(keys).toHaveLength(1);
  });
});
