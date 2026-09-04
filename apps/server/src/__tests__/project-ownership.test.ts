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
  addProjectOwner,
  getTokenAndTeamId,
  TEST_AGENT_KEY,
  TEST_CLIENT_KEY,
  TEST_DB_URL,
  TEST_USER,
} from "./setup.js";

/**
 * The ownership lifecycle (handoff §12): who becomes a project's first owner,
 * how the owner list is read and changed, and what changes the moment it does.
 *
 * These are route-level tests on purpose. `project-access.test.ts` pins the
 * policy down against the helper; this suite proves the project and owner
 * endpoints are actually wired to it, and that the two invariants that can only
 * be broken at the database level — a project is never created without an
 * owner, and never loses its last one — hold in the database itself.
 *
 * Canonical actors, as in `project-access.test.ts`:
 *   teamOwner — configured singleton team owner; owns neither project;
 *   ownerA    — member, first owner of Project A;
 *   coOwnerA  — member, added as an equal owner of Project A;
 *   ownerB    — member, first owner of Project B, so a viewer of Project A.
 *
 * `pulse.pubky.org` and `example.com` are the suite's configured allowed
 * domains (vitest.config.ts); no deployment domain appears here.
 */

let app: FastifyInstance;
let client: postgres.Sql;

interface Actor {
  userId: string;
  email: string;
  token: string;
}

let teamId: string;
let teamOwner: Actor;
let ownerA: Actor;
let coOwnerA: Actor;
let ownerB: Actor;
let projectA: string;
let projectB: string;

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

  const { token: ownerToken } = await getTokenAndTeamId(app);
  teamOwner = { userId: seeded.userId as string, email: TEST_USER.email, token: ownerToken };

  ownerA = await signUp("owner-a@example.com");
  coOwnerA = await signUp("co-owner-a@example.com");
  ownerB = await signUp("owner-b@example.com");

  projectA = await createProjectWithOwner(teamId, ownerA.userId, { name: "Project A" });
  await addProjectOwner(projectA, coOwnerA.userId);
  projectB = await createProjectWithOwner(teamId, ownerB.userId, { name: "Project B" });
});

async function signUp(email: string): Promise<Actor> {
  const created = await createUserAndGetToken(app, email);
  return { userId: created.userId, email, token: created.token };
}

/**
 * Insert an agent key straight into the database, as `project-access.test.ts`
 * does: the key-creation route still carries the old team-role gate, and these
 * rows are about what an *existing* key can do as its creator's access changes.
 */
async function insertAgentKey(createdBy: string, permissions: Permission[]): Promise<string> {
  const secret = `pulse_agent_${randomUUID().replace(/-/g, "")}`;
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${secret}, 'agent', ${null}, ${teamId}, 'Ownership Test Agent Key', ${createdBy},
      ${JSON.stringify(permissions)}::jsonb
    )
  `;
  return secret;
}

/** The owner user ids currently recorded for a project, read straight from the table. */
async function ownerIdsInDb(projectId: string): Promise<string[]> {
  const rows = await client`
    SELECT user_id FROM project_owners WHERE project_id = ${projectId} ORDER BY added_at, user_id
  `;
  return rows.map((r) => r.user_id as string);
}

/** The slug a project currently holds, so a test can ask for it back. */
async function slugOf(projectId: string): Promise<string> {
  const [row] = await client`SELECT slug FROM projects WHERE id = ${projectId}`;
  return row.slug as string;
}

/** Soft-delete a project as `DELETE /v1/projects/:id` does, keeping its slug taken. */
async function softDelete(projectId: string): Promise<void> {
  await client`UPDATE projects SET deleted_at = now() WHERE id = ${projectId}`;
}

/** Whether the row is still present at all — a hard delete removes it entirely. */
async function projectExists(projectId: string): Promise<boolean> {
  const [row] = await client`SELECT 1 AS present FROM projects WHERE id = ${projectId}`;
  return row !== undefined;
}

async function insertAppInProject(projectId: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${teamId}, ${projectId}, ${`Owned App ${suffix}`}, 'apple', ${`dev.ownership.${suffix}`})
    RETURNING id
  `;
  return row.id as string;
}

async function appExists(appId: string): Promise<boolean> {
  const [row] = await client`SELECT 1 AS present FROM apps WHERE id = ${appId}`;
  return row !== undefined;
}

function bearer(credential: string) {
  return { authorization: `Bearer ${credential}` };
}

function getOwners(projectId: string, credential: string) {
  return app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/owners`,
    headers: bearer(credential),
  });
}

function putOwner(projectId: string, userId: string, credential: string) {
  return app.inject({
    method: "PUT",
    url: `/v1/projects/${projectId}/owners/${userId}`,
    headers: bearer(credential),
  });
}

function deleteOwner(projectId: string, userId: string, credential: string) {
  return app.inject({
    method: "DELETE",
    url: `/v1/projects/${projectId}/owners/${userId}`,
    headers: bearer(credential),
  });
}

/** An ordinary project write, used to observe when access actually changes. */
function renameProject(projectId: string, credential: string, name: string) {
  return app.inject({
    method: "PATCH",
    url: `/v1/projects/${projectId}`,
    headers: bearer(credential),
    payload: { name },
  });
}

// ─── Creation assigns the first owner, atomically ─────────────────────────

describe("project creation ownership", () => {
  it("makes the creating human the project's first and only owner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(ownerB.token),
      payload: { team_id: teamId, name: "Fresh", slug: "fresh" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.owners.map((o: { user_id: string }) => o.user_id)).toEqual([ownerB.userId]);
    expect(body.owners[0].email).toBe(ownerB.email);
    expect(body.access_level).toBe("owner");
    expect(await ownerIdsInDb(body.id)).toEqual([ownerB.userId]);
  });

  it("lets an ordinary team member create a project", async () => {
    // Membership, not a team role, is what creation requires now. coOwnerA is a
    // plain member of the singleton team and owns nothing yet.
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(coOwnerA.token),
      payload: { team_id: teamId, name: "Member Made", slug: "member-made" },
    });

    expect(res.statusCode).toBe(201);
    expect(await ownerIdsInDb(res.json().id)).toEqual([coOwnerA.userId]);
  });

  it("assigns an agent-created project to the key's creator, not to the key", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:write", "projects:read"]);
    const [keyRow] = await client`SELECT id FROM api_keys WHERE secret = ${key}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(key),
      payload: { team_id: teamId, name: "Agent Made", slug: "agent-made" },
    });

    expect(res.statusCode).toBe(201);
    const ownerIds = await ownerIdsInDb(res.json().id);
    expect(ownerIds).toEqual([ownerA.userId]);
    expect(ownerIds).not.toContain(keyRow.id);
    // The key reports its creator's access, because that is the access it has.
    expect(res.json().access_level).toBe("owner");
  });

  it("refuses creation from a client key, which has no human actor", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(TEST_CLIENT_KEY),
      payload: { team_id: teamId, name: "Ingest Made", slug: "ingest-made" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("refuses to reclaim a colleague's soft-deleted slug, leaving the project intact", async () => {
    // Creating with a taken slug frees it by *hard*-deleting the soft-deleted
    // project and everything under it, ending the 7-day undo window. Any member
    // can create a project now, so without an authority check a colleague could
    // destroy ownerA's deleted project just by guessing its slug.
    const slug = await slugOf(projectA);
    const appId = await insertAppInProject(projectA);
    await softDelete(projectA);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(ownerB.token),
      payload: { team_id: teamId, name: "Slug Grab", slug },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/slug already exists/i);
    expect(await projectExists(projectA)).toBe(true);
    expect(await appExists(appId)).toBe(true);
  });

  it("lets the original owner reuse their own soft-deleted slug", async () => {
    const slug = await slugOf(projectA);
    await softDelete(projectA);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(ownerA.token),
      payload: { team_id: teamId, name: "Reborn", slug },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe(projectA);
    expect(await projectExists(projectA)).toBe(false);
    expect(await ownerIdsInDb(res.json().id)).toEqual([ownerA.userId]);
  });

  it("refuses an agent key the slug even when its creator owns the deleted project", async () => {
    // Hard-deleting a project is one of the human-only destructive operations,
    // and reclaiming a slug is exactly that under another name.
    const key = await insertAgentKey(ownerA.userId, ["projects:write", "projects:read"]);
    const slug = await slugOf(projectA);
    await softDelete(projectA);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(key),
      payload: { team_id: teamId, name: "Agent Grab", slug },
    });

    expect(res.statusCode).toBe(409);
    expect(await projectExists(projectA)).toBe(true);
  });

  it("lets the team owner reclaim the slug of an orphaned soft-deleted project", async () => {
    const slug = await slugOf(projectA);
    await client`DELETE FROM project_owners WHERE project_id = ${projectA}`;
    await softDelete(projectA);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(teamOwner.token),
      payload: { team_id: teamId, name: "Recovered", slug },
    });

    expect(res.statusCode).toBe(201);
    expect(await projectExists(projectA)).toBe(false);
  });

  it("does not let the team owner reclaim a slug that still has an owner", async () => {
    const slug = await slugOf(projectA);
    await softDelete(projectA);

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: bearer(teamOwner.token),
      payload: { team_id: teamId, name: "Overreach", slug },
    });

    expect(res.statusCode).toBe(409);
    expect(await projectExists(projectA)).toBe(true);
  });

  it("leaves no project behind when the first owner cannot be inserted", async () => {
    // Force the owner INSERT to fail so the rollback is observable. Without the
    // transaction the project row would commit first and survive as an
    // ownerless project that nobody but the team owner could ever act on.
    await client.unsafe(`
      CREATE OR REPLACE FUNCTION pulse_test_block_owner_insert() RETURNS trigger
      LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'owner insert blocked'; END; $fn$;
      CREATE TRIGGER pulse_test_block_owner_insert
        BEFORE INSERT ON project_owners
        FOR EACH ROW EXECUTE FUNCTION pulse_test_block_owner_insert();
    `);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers: bearer(ownerA.token),
        payload: { team_id: teamId, name: "Doomed", slug: "doomed" },
      });

      expect(res.statusCode).toBe(500);
      const rows = await client`SELECT id FROM projects WHERE slug = 'doomed'`;
      expect(rows).toHaveLength(0);
    } finally {
      await client.unsafe(`
        DROP TRIGGER IF EXISTS pulse_test_block_owner_insert ON project_owners;
        DROP FUNCTION IF EXISTS pulse_test_block_owner_insert();
      `);
    }
  });
});

// ─── Reading owners and access level ──────────────────────────────────────

describe("GET /v1/projects/:projectId/owners", () => {
  it("lets any team member read the owner list", async () => {
    const res = await getOwners(projectA, ownerB.token);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.owners.map((o: { user_id: string }) => o.user_id).sort()).toEqual(
      [ownerA.userId, coOwnerA.userId].sort(),
    );
    // ownerB owns Project B, so they are a viewer here.
    expect(body.access_level).toBe("viewer");
  });

  it("reports the caller's own access level as owner", async () => {
    expect((await getOwners(projectA, ownerA.token)).json().access_level).toBe("owner");
  });

  it("404s for a project the caller cannot see", async () => {
    const res = await getOwners("00000000-0000-0000-0000-000000000000", ownerA.token);
    expect(res.statusCode).toBe(404);
  });

  it("carries owners and access_level on project list and detail", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: bearer(ownerA.token),
    });
    const listed = list.json().projects as Array<{
      id: string;
      owners: Array<{ user_id: string }>;
      access_level: string;
    }>;
    const a = listed.find((p) => p.id === projectA);
    const b = listed.find((p) => p.id === projectB);
    expect(a?.access_level).toBe("owner");
    expect(a?.owners).toHaveLength(2);
    expect(b?.access_level).toBe("viewer");
    expect(b?.owners.map((o) => o.user_id)).toEqual([ownerB.userId]);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectB}`,
      headers: bearer(ownerA.token),
    });
    expect(detail.json().access_level).toBe("viewer");
    expect(detail.json().owners.map((o: { user_id: string }) => o.user_id)).toEqual([
      ownerB.userId,
    ]);
  });
});

// ─── Adding owners ────────────────────────────────────────────────────────

describe("PUT /v1/projects/:projectId/owners/:userId", () => {
  it("lets a project owner add a peer", async () => {
    const res = await putOwner(projectA, ownerB.userId, ownerA.token);

    expect(res.statusCode).toBe(200);
    expect(res.json().owners.map((o: { user_id: string }) => o.user_id)).toContain(ownerB.userId);
    expect(await ownerIdsInDb(projectA)).toContain(ownerB.userId);
  });

  it("is idempotent", async () => {
    const first = await putOwner(projectA, ownerB.userId, ownerA.token);
    const second = await putOwner(projectA, ownerB.userId, ownerA.token);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const ids = await ownerIdsInDb(projectA);
    expect(ids.filter((id) => id === ownerB.userId)).toHaveLength(1);
  });

  it("audits the grant once even when the request is retried", async () => {
    const first = await putOwner(projectA, ownerB.userId, ownerA.token);
    const second = await putOwner(projectA, ownerB.userId, ownerA.token);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    // `logAuditEvent` is fire-and-forget, so both requests' writes get time to
    // land before counting: a missing second row must be a decision, not a race.
    await new Promise((r) => setTimeout(r, 150));

    const owners = await ownerIdsInDb(projectA);
    expect(owners.filter((id) => id === ownerB.userId)).toHaveLength(1);

    const audits = await client`
      SELECT id FROM audit_logs
      WHERE resource_type = 'project_owner'
        AND resource_id = ${ownerB.userId}
        AND metadata->>'project_id' = ${projectA}
    `;
    expect(audits).toHaveLength(1);
  });

  it("404s when the target is not a member of the team", async () => {
    const [outsider] = await client`
      INSERT INTO users (email, name) VALUES ('outsider@example.com', 'Outsider') RETURNING id
    `;

    const res = await putOwner(projectA, outsider.id as string, ownerA.token);

    expect(res.statusCode).toBe(404);
    expect(await ownerIdsInDb(projectA)).not.toContain(outsider.id);
  });

  it("404s for a user id that does not exist", async () => {
    const res = await putOwner(projectA, "00000000-0000-0000-0000-000000000000", ownerA.token);
    expect(res.statusCode).toBe(404);
  });

  it("refuses a viewer", async () => {
    const before = await ownerIdsInDb(projectA);
    const res = await putOwner(projectA, ownerB.userId, ownerB.token);

    expect(res.statusCode).toBe(403);
    expect(await ownerIdsInDb(projectA)).toEqual(before);
  });

  it("refuses an agent key even when its creator owns the project", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:write", "projects:read"]);
    const before = await ownerIdsInDb(projectA);

    const res = await putOwner(projectA, ownerB.userId, key);

    expect(res.statusCode).toBe(403);
    expect(await ownerIdsInDb(projectA)).toEqual(before);
  });

  it("refuses a client key outright", async () => {
    const res = await putOwner(projectA, ownerB.userId, TEST_CLIENT_KEY);
    expect(res.statusCode).toBe(403);
  });
});

// ─── Removing owners ──────────────────────────────────────────────────────

describe("DELETE /v1/projects/:projectId/owners/:userId", () => {
  it("lets a project owner remove a peer", async () => {
    const res = await deleteOwner(projectA, coOwnerA.userId, ownerA.token);

    expect(res.statusCode).toBe(200);
    expect(await ownerIdsInDb(projectA)).toEqual([ownerA.userId]);
  });

  it("lets an owner remove themselves while another owner remains", async () => {
    const res = await deleteOwner(projectA, ownerA.userId, ownerA.token);

    expect(res.statusCode).toBe(200);
    // Their own access level drops immediately in the same response.
    expect(res.json().access_level).toBe("viewer");
    expect(await ownerIdsInDb(projectA)).toEqual([coOwnerA.userId]);
  });

  it("404s for a user who is not an owner", async () => {
    const res = await deleteOwner(projectA, ownerB.userId, ownerA.token);

    expect(res.statusCode).toBe(404);
    expect(await ownerIdsInDb(projectA)).toHaveLength(2);
  });

  it("409s on the final owner and changes nothing", async () => {
    const res = await deleteOwner(projectB, ownerB.userId, ownerB.token);

    expect(res.statusCode).toBe(409);
    expect(await ownerIdsInDb(projectB)).toEqual([ownerB.userId]);
  });

  it("refuses a viewer", async () => {
    const res = await deleteOwner(projectA, ownerA.userId, ownerB.token);

    expect(res.statusCode).toBe(403);
    expect(await ownerIdsInDb(projectA)).toHaveLength(2);
  });

  it("refuses an agent key even when its creator owns the project", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:write", "projects:read"]);

    const res = await deleteOwner(projectA, coOwnerA.userId, key);

    expect(res.statusCode).toBe(403);
    expect(await ownerIdsInDb(projectA)).toHaveLength(2);
  });

  it("cannot leave a project ownerless when two removals race", async () => {
    // vitest runs with `fileParallelism: false` against one shared database, so
    // the race is staged explicitly: a second connection holds the lock the
    // handler must take, which pins the interleaving instead of hoping for it.
    const blocker = postgres(TEST_DB_URL, { max: 1 });
    let blockerOpen = false;
    try {
      await blocker`BEGIN`;
      blockerOpen = true;
      await blocker`SELECT id FROM projects WHERE id = ${projectA} FOR UPDATE`;

      // ownerA removes coOwnerA. Both owners still exist as this is issued, so
      // a handler that counted before locking would delete and leave one owner
      // while the blocker deletes the other — ending at zero.
      let settled = false;
      const pending = deleteOwner(projectA, coOwnerA.userId, ownerA.token).then((res) => {
        settled = true;
        return res;
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false); // blocked on the project row lock

      // The competing removal commits first, taking the owner count to one.
      await blocker`
        DELETE FROM project_owners WHERE project_id = ${projectA} AND user_id = ${ownerA.userId}
      `;
      await blocker`COMMIT`;
      blockerOpen = false;

      const res = await pending;
      expect(res.statusCode).toBe(409);
      expect(await ownerIdsInDb(projectA)).toEqual([coOwnerA.userId]);
    } finally {
      // Only if an assertion threw while the transaction was still open — a
      // stray ROLLBACK after COMMIT would leave the handler waiting forever.
      if (blockerOpen) await blocker`ROLLBACK`.catch(() => {});
      await blocker.end();
    }
  });
});

// ─── Ownership changes take effect on the next request ────────────────────

describe("ownership changes apply immediately", () => {
  it("blocks an existing JWT and agent key as soon as their owner is removed", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:write", "projects:read"]);

    expect((await renameProject(projectA, ownerA.token, "Before")).statusCode).toBe(200);
    expect((await renameProject(projectA, key, "Before Agent")).statusCode).toBe(200);

    expect((await deleteOwner(projectA, ownerA.userId, coOwnerA.token)).statusCode).toBe(200);

    // Same token, same key — no re-login, no key rotation.
    expect((await renameProject(projectA, ownerA.token, "After")).statusCode).toBe(403);
    expect((await renameProject(projectA, key, "After Agent")).statusCode).toBe(403);

    // Reads still work: membership grants those.
    const read = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectA}`,
      headers: bearer(ownerA.token),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().access_level).toBe("viewer");
  });

  it("enables an existing agent key as soon as its creator is added as owner", async () => {
    const key = await insertAgentKey(ownerB.userId, ["projects:write", "projects:read"]);

    expect((await renameProject(projectA, key, "Nope")).statusCode).toBe(403);

    expect((await putOwner(projectA, ownerB.userId, ownerA.token)).statusCode).toBe(200);

    expect((await renameProject(projectA, key, "Now Allowed")).statusCode).toBe(200);
  });

  it("keeps an agent key without the permission out, however its creator is placed", async () => {
    // TEST_AGENT_KEY belongs to the team owner and has read permissions only.
    await putOwner(projectA, teamOwner.userId, teamOwner.token);

    const res = await renameProject(projectA, TEST_AGENT_KEY, "Still Nope");
    expect(res.statusCode).toBe(403);
  });
});

// ─── Team-owner recovery authority ────────────────────────────────────────

describe("team-owner recovery authority", () => {
  it("can manage the owner list without owning the project", async () => {
    const res = await putOwner(projectA, ownerB.userId, teamOwner.token);

    expect(res.statusCode).toBe(200);
    expect(await ownerIdsInDb(projectA)).toContain(ownerB.userId);
  });

  it("cannot perform an ordinary write until it adds itself", async () => {
    expect((await renameProject(projectA, teamOwner.token, "Nope")).statusCode).toBe(403);

    expect((await putOwner(projectA, teamOwner.userId, teamOwner.token)).statusCode).toBe(200);

    expect((await renameProject(projectA, teamOwner.token, "Renamed")).statusCode).toBe(200);
  });

  it("still cannot remove a project's final owner", async () => {
    const res = await deleteOwner(projectB, ownerB.userId, teamOwner.token);

    expect(res.statusCode).toBe(409);
    expect(await ownerIdsInDb(projectB)).toEqual([ownerB.userId]);
  });

  it("cannot delete a project that still has owners", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectA}`,
      headers: bearer(teamOwner.token),
    });

    expect(res.statusCode).toBe(403);
    const [row] = await client`SELECT deleted_at FROM projects WHERE id = ${projectA}`;
    expect(row.deleted_at).toBeNull();
  });

  it("can delete an orphaned project", async () => {
    // An orphaned project is the one state ordinary ownership cannot resolve:
    // nobody owns it, so nobody but the team owner could ever remove it.
    await client`DELETE FROM project_owners WHERE project_id = ${projectA}`;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectA}`,
      headers: bearer(teamOwner.token),
    });

    expect(res.statusCode).toBe(200);
    const [row] = await client`SELECT deleted_at FROM projects WHERE id = ${projectA}`;
    expect(row.deleted_at).not.toBeNull();
  });

  it("does not extend the orphan-deletion path to an ordinary member", async () => {
    await client`DELETE FROM project_owners WHERE project_id = ${projectA}`;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectA}`,
      headers: bearer(ownerB.token),
    });

    expect(res.statusCode).toBe(403);
    const [row] = await client`SELECT deleted_at FROM projects WHERE id = ${projectA}`;
    expect(row.deleted_at).toBeNull();
  });
});

// ─── Ordinary project writes require ownership ────────────────────────────

describe("project write authorization", () => {
  it("lets an owner update and delete their project", async () => {
    expect((await renameProject(projectA, coOwnerA.token, "Renamed A")).statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectA}`,
      headers: bearer(coOwnerA.token),
    });
    expect(del.statusCode).toBe(200);
  });

  it("refuses a same-team viewer and changes nothing", async () => {
    const res = await renameProject(projectA, ownerB.token, "Hijacked");

    expect(res.statusCode).toBe(403);
    const [row] = await client`SELECT name FROM projects WHERE id = ${projectA}`;
    expect(row.name).toBe("Project A");
  });

  it("refuses an agent whose creator does not own the project", async () => {
    const key = await insertAgentKey(ownerB.userId, ["projects:write", "projects:read"]);

    const res = await renameProject(projectA, key, "Hijacked");

    expect(res.statusCode).toBe(403);
  });

  it("refuses project deletion to an agent whose creator owns the project", async () => {
    const key = await insertAgentKey(ownerA.userId, ["projects:write", "projects:read"]);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectA}`,
      headers: bearer(key),
    });

    expect(res.statusCode).toBe(403);
    const [row] = await client`SELECT deleted_at FROM projects WHERE id = ${projectA}`;
    expect(row.deleted_at).toBeNull();
  });
});
