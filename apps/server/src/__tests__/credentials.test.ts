import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import type { Permission } from "@pubky-pulse/shared";
import {
  buildApp,
  truncateAll,
  seedTestData,
  createUserAndGetToken,
  createProjectWithOwner,
  getTokenAndTeamId,
  TEST_CLIENT_KEY,
  TEST_IMPORT_KEY,
  TEST_DB_URL,
} from "./setup.js";

/**
 * Credential isolation (handoff §8 "API keys and secret serialization" and §12
 * "Credential tests").
 *
 * The rule under test is that authorization decides what is loaded and what is
 * serialized, never that everything is loaded and then filtered:
 *
 *   - a member sees their own agent keys plus the client/import keys of apps in
 *     projects they own;
 *   - the singleton team owner sees every team key's *metadata* and may revoke
 *     any of them for recovery, but every secret they are not otherwise
 *     entitled to serializes as `null` — never omitted, never another key's;
 *   - `GET /keys/:id` is exactly as strict as the list, so knowing a key's UUID
 *     reveals nothing;
 *   - app and project responses redact `client_secret` for non-owners,
 *     including a team owner who does not own that project;
 *   - an agent may mint an import key only for an app in a project its creator
 *     owns, only with `apps:write`, and sees the secret only in that response.
 *
 * Canonical actors, as in `project-access.test.ts` and
 * `project-acl-matrix.test.ts`:
 *   teamOwner — configured singleton team owner; owns neither Project A nor B;
 *   ownerA    — member, first owner of Project A;
 *   ownerB    — member, first owner of Project B, therefore a viewer of A.
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed
 * domains (vitest.config.ts); no deployment domain appears here. Secrets in
 * this file are generated per test run and never committed as fixtures.
 */

let app: FastifyInstance;
let client: postgres.Sql;

interface Actor {
  userId: string;
  token: string;
}

interface KeyRow {
  id: string;
  secret: string;
}

const AGENT_PERMISSIONS: Permission[] = ["apps:read", "apps:write", "projects:read"];
const AGENT_PERMISSIONS_WITHOUT_APPS_WRITE: Permission[] = ["apps:read", "projects:read"];

let teamId: string;
let teamOwner: Actor;
let ownerA: Actor;
let ownerB: Actor;

let projectA: string;
let projectB: string;
let appA: string;
let appB: string;

/** Client and import credentials for Project A's app, and a client key for B's. */
let clientKeyA: KeyRow;
let importKeyA: KeyRow;
let clientKeyB: KeyRow;

/** Personal agent keys, one per member, so cross-member leakage has a target. */
let agentOfOwnerA: KeyRow;
let agentOfOwnerB: KeyRow;
let agentOfOwnerAWithoutAppsWrite: KeyRow;

beforeAll(async () => {
  app = await buildApp();
  client = postgres(TEST_DB_URL, { max: 1 });
});

afterAll(async () => {
  await client.end();
  await app.close();
});

beforeEach(async () => {
  await truncateAll();
  const seeded = await seedTestData();
  teamId = seeded.teamId;

  const { token: teamOwnerToken } = await getTokenAndTeamId(app);
  teamOwner = { userId: seeded.userId, token: teamOwnerToken };

  ownerA = await signUp("owner-a@example.com");
  ownerB = await signUp("owner-b@example.com");

  projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "Project A" });
  projectB = await createProjectWithOwner(teamId, ownerB.userId, { name: "Project B" });

  appA = await insertApp(projectA, "App A");
  appB = await insertApp(projectB, "App B");

  clientKeyA = await insertKey({ keyType: "client", appId: appA, createdBy: ownerA.userId });
  importKeyA = await insertKey({ keyType: "import", appId: appA, createdBy: ownerA.userId });
  clientKeyB = await insertKey({ keyType: "client", appId: appB, createdBy: ownerB.userId });

  agentOfOwnerA = await insertKey({
    keyType: "agent",
    createdBy: ownerA.userId,
    permissions: AGENT_PERMISSIONS,
  });
  agentOfOwnerB = await insertKey({
    keyType: "agent",
    createdBy: ownerB.userId,
    permissions: AGENT_PERMISSIONS,
  });
  agentOfOwnerAWithoutAppsWrite = await insertKey({
    keyType: "agent",
    createdBy: ownerA.userId,
    permissions: AGENT_PERMISSIONS_WITHOUT_APPS_WRITE,
  });
});

async function signUp(email: string): Promise<Actor> {
  const created = await createUserAndGetToken(app, email);
  return { userId: created.userId, token: created.token };
}

function unique(): string {
  return randomUUID().slice(0, 8);
}

async function insertApp(projectId: string, name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${name}, 'apple', ${`dev.credentials.${unique()}`})
    RETURNING id
  `;
  return row.id as string;
}

/**
 * Insert a key straight into the database rather than through `POST
 * /v1/auth/keys`, so a fixture can never pass because the route it is about to
 * test happened to allow it.
 */
async function insertKey(opts: {
  keyType: "client" | "import" | "agent";
  createdBy: string;
  appId?: string;
  permissions?: Permission[];
  expiresAt?: Date;
}): Promise<KeyRow> {
  const permissions =
    opts.permissions ??
    (opts.keyType === "agent" ? AGENT_PERMISSIONS : (["events:write"] as Permission[]));
  const secret = `pulse_${opts.keyType}_${randomUUID().replace(/-/g, "")}`;
  const [row] = await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions, expires_at)
    VALUES (
      ${secret}, ${opts.keyType}, ${opts.appId ?? null}, ${teamId},
      ${`Credentials ${opts.keyType} ${unique()}`}, ${opts.createdBy},
      ${JSON.stringify(permissions)}::jsonb, ${opts.expiresAt ?? null}
    )
    RETURNING id
  `;
  return { id: row.id as string, secret };
}

async function listKeys(token: string) {
  const res = await app.inject({
    method: "GET",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json().api_keys as Array<{
    id: string;
    secret: string | null;
    key_type: string;
    name: string;
    created_by: string | null;
  }>;
}

async function getKey(token: string, keyId: string) {
  return app.inject({
    method: "GET",
    url: `/v1/auth/keys/${keyId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function isKeyRevoked(keyId: string): Promise<boolean> {
  const [row] = await client`SELECT deleted_at FROM api_keys WHERE id = ${keyId}`;
  return row?.deleted_at !== null;
}

async function keyName(keyId: string): Promise<string> {
  const [row] = await client`SELECT name FROM api_keys WHERE id = ${keyId}`;
  return row.name as string;
}

// ─── Agent-key isolation between members ─────────────────────────────

describe("agent key isolation between members", () => {
  it("does not show one member another member's agent key", async () => {
    const keys = await listKeys(ownerA.token);
    const ids = keys.map((k) => k.id);

    expect(ids).toContain(agentOfOwnerA.id);
    expect(ids).not.toContain(agentOfOwnerB.id);
  });

  it("never serializes another member's agent secret in any field", async () => {
    const keys = await listKeys(ownerA.token);
    const secrets = keys.map((k) => k.secret);

    expect(secrets).toContain(agentOfOwnerA.secret);
    expect(secrets).not.toContain(agentOfOwnerB.secret);
  });

  it("returns 404 when a member fetches another member's agent key by id", async () => {
    const res = await getKey(ownerA.token, agentOfOwnerB.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("API key not found");
  });

  it("keeps /auth/me scoped to the caller's own default agent key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(200);
    const membership = res.json().teams.find((t: { id: string }) => t.id === teamId);
    expect(membership.default_agent_key).not.toBe(agentOfOwnerB.secret);
  });
});

// ─── Client and import key visibility follows project ownership ──────

describe("client and import key visibility", () => {
  it("gives a project owner the client and import keys of their own project", async () => {
    const keys = await listKeys(ownerA.token);
    const byId = new Map(keys.map((k) => [k.id, k]));

    expect(byId.get(clientKeyA.id)?.secret).toBe(clientKeyA.secret);
    expect(byId.get(importKeyA.id)?.secret).toBe(importKeyA.secret);
  });

  it("hides another project's client key from a viewer of that project", async () => {
    const keys = await listKeys(ownerB.token);
    const ids = keys.map((k) => k.id);

    expect(ids).toContain(clientKeyB.id);
    expect(ids).not.toContain(clientKeyA.id);
    expect(ids).not.toContain(importKeyA.id);
    expect(keys.map((k) => k.secret)).not.toContain(clientKeyA.secret);
  });

  it("returns 404 when a viewer fetches an unowned project's client key by id", async () => {
    for (const key of [clientKeyA, importKeyA]) {
      const res = await getKey(ownerB.token, key.id);
      expect(res.statusCode).toBe(404);
    }
  });

  it("lets a project owner rename a client key of their own project", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/auth/keys/${clientKeyA.id}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { name: "Renamed By Owner" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().api_key.name).toBe("Renamed By Owner");
    expect(await keyName(clientKeyA.id)).toBe("Renamed By Owner");
  });

  it("lets a project owner revoke a client key of their own project", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${importKeyA.id}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(await isKeyRevoked(importKeyA.id)).toBe(true);
  });

  it("refuses a project owner every management verb on another project's key", async () => {
    const before = await keyName(clientKeyB.id);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/v1/auth/keys/${clientKeyB.id}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { name: "Hijacked" },
    });
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${clientKeyB.id}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(patchRes.statusCode).toBe(404);
    expect(deleteRes.statusCode).toBe(404);
    expect(await keyName(clientKeyB.id)).toBe(before);
    expect(await isKeyRevoked(clientKeyB.id)).toBe(false);
  });

  it("refuses a non-owner minting a client key for another project's app", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { name: "Sneaky Client", key_type: "client", app_id: appB },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/project ownership/i);
  });

  it("lets a project owner mint a client key for their own app", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${ownerA.token}` },
      payload: { name: "Owner Client", key_type: "client", app_id: appA },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.secret).toMatch(/^pulse_client_/);
  });

  it("lets any member mint their own agent key without a project or role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${ownerB.token}` },
      payload: { name: "My Own Agent", key_type: "agent", team_id: teamId },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.created_by).toBe(ownerB.userId);
    expect(res.json().api_key.secret).toMatch(/^pulse_agent_/);
  });
});

// ─── Team owner: metadata and revocation, never secrets or updates ───

describe("team owner recovery view", () => {
  it("lists unauthorized keys as metadata with a null secret", async () => {
    const keys = await listKeys(teamOwner.token);
    const byId = new Map(keys.map((k) => [k.id, k]));

    for (const key of [agentOfOwnerA, agentOfOwnerB, clientKeyA, clientKeyB, importKeyA]) {
      const listed = byId.get(key.id);
      expect(listed).toBeDefined();
      // The field is present and explicitly null — never omitted, so a client
      // can tell "you may not see this" from "there is nothing here".
      expect(listed).toHaveProperty("secret", null);
    }

    // And never substituted with some other key's secret.
    const realSecrets = new Set(
      [agentOfOwnerA, agentOfOwnerB, clientKeyA, clientKeyB, importKeyA].map((k) => k.secret),
    );
    for (const listed of keys) {
      if (listed.secret !== null) expect(realSecrets.has(listed.secret)).toBe(false);
    }
  });

  it("still shows the team owner their own keys in full", async () => {
    const ownKey = await insertKey({ keyType: "agent", createdBy: teamOwner.userId });
    const keys = await listKeys(teamOwner.token);
    const listed = keys.find((k) => k.id === ownKey.id);

    expect(listed?.secret).toBe(ownKey.secret);
  });

  it("returns metadata with a null secret for a single unauthorized key", async () => {
    const res = await getKey(teamOwner.token, agentOfOwnerA.id);

    expect(res.statusCode).toBe(200);
    const body = res.json().api_key;
    expect(body.id).toBe(agentOfOwnerA.id);
    expect(body.key_type).toBe("agent");
    expect(body.created_by).toBe(ownerA.userId);
    expect(body.secret).toBeNull();
  });

  it("refuses the team owner updating a key they do not own", async () => {
    const before = await keyName(agentOfOwnerA.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/auth/keys/${agentOfOwnerA.id}`,
      headers: { authorization: `Bearer ${teamOwner.token}` },
      payload: { name: "Team Owner Rename" },
    });

    expect(res.statusCode).toBe(403);
    expect(await keyName(agentOfOwnerA.id)).toBe(before);
  });

  it("lets the team owner revoke any key as a recovery action", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${agentOfOwnerA.id}`,
      headers: { authorization: `Bearer ${teamOwner.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(await isKeyRevoked(agentOfOwnerA.id)).toBe(true);
  });

  it("does not let a revoke response disclose the revoked secret", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${clientKeyA.id}`,
      headers: { authorization: `Bearer ${teamOwner.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain(clientKeyA.secret);
  });
});

// ─── Single-key GET is exactly as strict as the list ─────────────────

describe("single-key GET matches list filtering", () => {
  it("returns 404 for every key absent from the caller's own list", async () => {
    const actors = [ownerA, ownerB];
    const allKeys = [agentOfOwnerA, agentOfOwnerB, clientKeyA, clientKeyB, importKeyA];

    for (const actor of actors) {
      const visibleIds = new Set((await listKeys(actor.token)).map((k) => k.id));

      for (const key of allKeys) {
        const res = await getKey(actor.token, key.id);
        if (visibleIds.has(key.id)) {
          expect(res.statusCode).toBe(200);
        } else {
          expect(res.statusCode).toBe(404);
        }
      }
    }
  });

  it("serializes the same secret through the list and the single-key route", async () => {
    const listed = (await listKeys(ownerA.token)).find((k) => k.id === clientKeyA.id);
    const single = (await getKey(ownerA.token, clientKeyA.id)).json().api_key;

    expect(single.secret).toBe(listed?.secret);
    expect(single.secret).toBe(clientKeyA.secret);
  });
});

// ─── App and project serialization ───────────────────────────────────

describe("app and project client_secret redaction", () => {
  it("redacts client secrets for a viewer in the app list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${ownerB.token}` },
    });

    expect(res.statusCode).toBe(200);
    const listed = res.json().apps as Array<{ id: string; client_secret: string | null }>;
    const byId = new Map(listed.map((a) => [a.id, a]));

    expect(byId.get(appA)).toHaveProperty("client_secret", null);
    expect(byId.get(appB)?.client_secret).toBe(clientKeyB.secret);
  });

  it("redacts a client secret for a viewer on the single-app route", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${appA}`,
      headers: { authorization: `Bearer ${ownerB.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("client_secret", null);
  });

  it("returns the client secret to the app's own project owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/apps/${appA}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().client_secret).toBe(clientKeyA.secret);
  });

  it("redacts client secrets in a project detail response for a viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectA}`,
      headers: { authorization: `Bearer ${ownerB.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_level).toBe("viewer");
    for (const listed of body.apps) {
      expect(listed).toHaveProperty("client_secret", null);
    }
  });

  it("redacts client secrets from a team owner who does not own the project", async () => {
    const appsRes = await app.inject({
      method: "GET",
      url: `/v1/apps/${appA}`,
      headers: { authorization: `Bearer ${teamOwner.token}` },
    });
    const projectRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectA}`,
      headers: { authorization: `Bearer ${teamOwner.token}` },
    });

    expect(appsRes.json()).toHaveProperty("client_secret", null);
    expect(projectRes.json().access_level).toBe("viewer");
    for (const listed of projectRes.json().apps) {
      expect(listed).toHaveProperty("client_secret", null);
    }
  });

  /**
   * An agent key is the one principal that both reads `/v1/apps` and is itself
   * a long-lived credential a person can hold. It inherits its creator's
   * project access, so `client_secret` must follow `created_by`'s ownership —
   * in both directions, or a member could mint an agent key and read every
   * other project's ingestion secret through it.
   */
  it("returns a client secret to an agent whose creator owns the app's project", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
    });

    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().apps as Array<{ id: string; client_secret: string | null }>).map((a) => [a.id, a]),
    );

    expect(byId.get(appA)?.client_secret).toBe(clientKeyA.secret);
    expect(byId.get(appB)).toHaveProperty("client_secret", null);
  });

  it("redacts a client secret from an agent whose creator owns the other project", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/apps",
      headers: { authorization: `Bearer ${agentOfOwnerB.secret}` },
    });

    expect(res.statusCode).toBe(200);
    const byId = new Map(
      (res.json().apps as Array<{ id: string; client_secret: string | null }>).map((a) => [a.id, a]),
    );

    expect(byId.get(appB)?.client_secret).toBe(clientKeyB.secret);
    expect(byId.get(appA)).toHaveProperty("client_secret", null);
    expect(res.body).not.toContain(clientKeyA.secret);
    expect(res.body).not.toContain(importKeyA.secret);
  });

  it("returns client secrets to the project owner in a project detail response", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectA}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });

    expect(res.json().access_level).toBe("owner");
    const listed = res.json().apps.find((a: { id: string }) => a.id === appA);
    expect(listed.client_secret).toBe(clientKeyA.secret);
  });
});

// ─── Default agent key ───────────────────────────────────────────────

describe("POST /v1/auth/default-agent-key", () => {
  it("creates a key for the calling user, never another member's", async () => {
    // A member with no agent key of their own yet: ownerA and ownerB both
    // already hold one from the fixture, and the point of this test is that
    // the lookup is scoped to `created_by`, not to the team.
    const fresh = await signUp("no-key-yet@example.com");

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/default-agent-key",
      headers: { authorization: `Bearer ${fresh.token}` },
      payload: { team_id: teamId },
    });

    expect(res.statusCode).toBe(201);
    const secret = res.json().secret;
    expect(secret).not.toBe(agentOfOwnerA.secret);
    expect(secret).not.toBe(agentOfOwnerB.secret);

    const [row] = await client`
      SELECT created_by FROM api_keys WHERE secret = ${secret}
    `;
    expect(row.created_by).toBe(fresh.userId);
  });

  it("returns an existing agent key of the caller's rather than creating a second one", async () => {
    // ownerB already has exactly one agent key from the fixture, so the first
    // call must find it instead of minting another.
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/default-agent-key",
      headers: { authorization: `Bearer ${ownerB.token}` },
      payload: { team_id: teamId },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/default-agent-key",
      headers: { authorization: `Bearer ${ownerB.token}` },
      payload: { team_id: teamId },
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().secret).toBe(agentOfOwnerB.secret);
    expect(second.statusCode).toBe(200);
    expect(second.json().secret).toBe(first.json().secret);
    expect(second.json().created).toBe(false);

    const rows = await client`
      SELECT id FROM api_keys
      WHERE created_by = ${ownerB.userId} AND key_type = 'agent' AND deleted_at IS NULL
    `;
    expect(rows).toHaveLength(1);
  });

  it("creates no duplicates under concurrent calls", async () => {
    const fresh = await signUp("concurrent@example.com");

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/auth/default-agent-key",
          headers: { authorization: `Bearer ${fresh.token}` },
          payload: { team_id: teamId },
        }),
      ),
    );

    const secrets = new Set(responses.map((r) => r.json().secret));
    expect(secrets.size).toBe(1);

    const rows = await client`
      SELECT id FROM api_keys
      WHERE created_by = ${fresh.userId} AND key_type = 'agent' AND deleted_at IS NULL
    `;
    expect(rows).toHaveLength(1);
  });
});

// ─── Agent principals ────────────────────────────────────────────────

describe("agent key credential management", () => {
  it("mints an import key for an app in a project its creator owns", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
      payload: { name: "Agent Import", key_type: "import", app_id: appA },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().api_key.secret).toMatch(/^pulse_import_/);
    // The key is attributed to the human behind the agent, not to the key.
    expect(res.json().api_key.created_by).toBe(ownerA.userId);
  });

  it("refuses an import key for an app whose project its creator does not own", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
      payload: { name: "Cross Project Import", key_type: "import", app_id: appB },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/project ownership/i);
  });

  it("refuses an import key when the agent lacks apps:write", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentOfOwnerAWithoutAppsWrite.secret}` },
      payload: { name: "No Permission Import", key_type: "import", app_id: appA },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/apps:write/);
  });

  it("refuses an agent minting a client or agent key", async () => {
    for (const key_type of ["client", "agent"] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/keys",
        headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
        payload: { name: "Wrong Type", key_type, app_id: appA, team_id: teamId },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("shows an agent its new import secret only in the create response", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
      payload: { name: "Write Only Import", key_type: "import", app_id: appA },
    });
    const keyId = created.json().api_key.id;

    for (const route of [
      { method: "GET" as const, url: "/v1/auth/keys" },
      { method: "GET" as const, url: `/v1/auth/keys/${keyId}` },
      { method: "PATCH" as const, url: `/v1/auth/keys/${keyId}`, payload: { name: "Nope" } },
      { method: "DELETE" as const, url: `/v1/auth/keys/${keyId}` },
    ]) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
        ...(route.payload ? { payload: route.payload } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

// ─── Client and import keys are locked out of management ─────────────

describe("client and import keys cannot invoke management endpoints", () => {
  /**
   * Built per test because the team routes carry the seeded team id, which only
   * exists after `beforeEach`. An ingestion credential's own `team_id` satisfies
   * `hasTeamAccess`, so without an explicit human-actor check a client key
   * lifted out of a shipped app binary would read every colleague's user id,
   * email, name, role and join date off the roster.
   */
  function managementRoutes() {
    return [
      { method: "GET" as const, url: "/v1/auth/keys" },
      { method: "GET" as const, url: "/v1/auth/keys/00000000-0000-0000-0000-000000000000" },
      {
        method: "POST" as const,
        url: "/v1/auth/keys",
        payload: { name: "Nope", key_type: "import" },
      },
      {
        method: "PATCH" as const,
        url: "/v1/auth/keys/00000000-0000-0000-0000-000000000000",
        payload: { name: "Nope" },
      },
      { method: "DELETE" as const, url: "/v1/auth/keys/00000000-0000-0000-0000-000000000000" },
      { method: "GET" as const, url: "/v1/auth/me" },
      { method: "GET" as const, url: `/v1/teams/${teamId}` },
      { method: "GET" as const, url: `/v1/teams/${teamId}/members` },
    ];
  }

  it("rejects every key-management route for a client key", async () => {
    for (const route of managementRoutes()) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
        ...(route.payload ? { payload: route.payload } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("rejects every key-management route for an import key", async () => {
    for (const route of managementRoutes()) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${TEST_IMPORT_KEY}` },
        ...(route.payload ? { payload: route.payload } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("leaks no roster field to an ingestion key that guesses the team id", async () => {
    for (const secret of [TEST_CLIENT_KEY, TEST_IMPORT_KEY]) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/teams/${teamId}/members`,
        headers: { authorization: `Bearer ${secret}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(ownerA.userId);
      expect(res.body).not.toContain("owner-a@example.com");
    }
  });

  it("rejects default-agent-key provisioning for a client key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/default-agent-key",
      headers: { authorization: `Bearer ${TEST_CLIENT_KEY}` },
      payload: { team_id: teamId },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Invalidation takes effect on the next request ───────────────────

describe("credential invalidation applies on the next request", () => {
  it("rejects a revoked agent key on its next request", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
    });
    expect(before.statusCode).toBe(200);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/v1/auth/keys/${agentOfOwnerA.id}`,
      headers: { authorization: `Bearer ${ownerA.token}` },
    });
    expect(revoke.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("rejects an expired agent key", async () => {
    const expired = await insertKey({
      keyType: "agent",
      createdBy: ownerA.userId,
      expiresAt: new Date("2020-01-01"),
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${expired.secret}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/expired/i);
  });

  it("rejects an agent key once its creator loses team membership", async () => {
    await client`
      DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${ownerA.userId}
    `;

    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("stops an agent minting project credentials once its creator loses ownership", async () => {
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
      payload: { name: "Still Owned", key_type: "import", app_id: appA },
    });
    expect(allowed.statusCode).toBe(201);

    // Hand Project A to ownerB first so removing ownerA never leaves it
    // ownerless — the invariant the removal path itself enforces.
    await client`
      INSERT INTO project_owners (project_id, user_id)
      VALUES (${projectA}, ${ownerB.userId})
      ON CONFLICT DO NOTHING
    `;
    await client`
      DELETE FROM project_owners WHERE project_id = ${projectA} AND user_id = ${ownerA.userId}
    `;

    const denied = await app.inject({
      method: "POST",
      url: "/v1/auth/keys",
      headers: { authorization: `Bearer ${agentOfOwnerA.secret}` },
      payload: { name: "No Longer Owned", key_type: "import", app_id: appA },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("drops a project's client keys from a member's list once ownership is removed", async () => {
    expect((await listKeys(ownerA.token)).map((k) => k.id)).toContain(clientKeyA.id);

    await client`
      INSERT INTO project_owners (project_id, user_id)
      VALUES (${projectA}, ${ownerB.userId})
      ON CONFLICT DO NOTHING
    `;
    await client`
      DELETE FROM project_owners WHERE project_id = ${projectA} AND user_id = ${ownerA.userId}
    `;

    const after = await listKeys(ownerA.token);
    expect(after.map((k) => k.id)).not.toContain(clientKeyA.id);
    expect((await getKey(ownerA.token, clientKeyA.id)).statusCode).toBe(404);
  });

  it("adds a project's client keys to a member's list as soon as ownership is granted", async () => {
    expect((await listKeys(ownerB.token)).map((k) => k.id)).not.toContain(clientKeyA.id);

    await client`
      INSERT INTO project_owners (project_id, user_id)
      VALUES (${projectA}, ${ownerB.userId})
      ON CONFLICT DO NOTHING
    `;

    const after = await listKeys(ownerB.token);
    const listed = after.find((k) => k.id === clientKeyA.id);
    expect(listed?.secret).toBe(clientKeyA.secret);
  });
});
