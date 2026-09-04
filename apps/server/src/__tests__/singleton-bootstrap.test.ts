import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { createDatabaseConnection } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import {
  buildApp,
  truncateAll,
  seedTestData,
  testEmailService,
  TEST_DB_URL,
  TEST_USER,
} from "./setup.js";
import { config } from "../config.js";
import { bootstrapSingletonTeam, findSingletonTeam } from "../services/bootstrap-team.js";

let app: FastifyInstance;
let db: Db;
let client: postgres.Sql;
let testData: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  app = await buildApp();
  db = createDatabaseConnection(TEST_DB_URL);
  client = postgres(TEST_DB_URL, { max: 1 });
});

beforeEach(async () => {
  await truncateAll();
  testData = await seedTestData();
});

afterAll(async () => {
  await client.end();
  await app.close();
});

async function signIn(email: string) {
  await app.inject({ method: "POST", url: "/v1/auth/send-code", payload: { email } });
  return app.inject({
    method: "POST",
    url: "/v1/auth/verify-code",
    payload: { email, code: testEmailService.lastCode },
  });
}

describe("singleton-team bootstrap", () => {
  it("creates the configured team and its sole owner on an empty database", async () => {
    await truncateAll();

    const { teamId, ownerUserId } = await bootstrapSingletonTeam(db);

    const [team] = await client`SELECT name, slug, deleted_at FROM teams WHERE id = ${teamId}`;
    expect(team.name).toBe(config.defaultTeamName);
    expect(team.slug).toBe(config.defaultTeamSlug);
    expect(team.deleted_at).toBeNull();

    const [owner] = await client`SELECT email FROM users WHERE id = ${ownerUserId}`;
    expect(owner.email).toBe(config.teamOwnerEmail);

    const members = await client`SELECT user_id, role FROM team_members WHERE team_id = ${teamId}`;
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");

    // Bootstrap never mints credentials — personal agent keys stay lazy.
    const keys = await client`SELECT id FROM api_keys`;
    expect(keys).toHaveLength(0);
  });

  it("is idempotent and leaves the configured owner as the sole team owner", async () => {
    const first = await bootstrapSingletonTeam(db);
    const second = await bootstrapSingletonTeam(db);
    const third = await bootstrapSingletonTeam(db);

    expect(second.teamId).toBe(first.teamId);
    expect(third.teamId).toBe(first.teamId);
    expect(second.ownerUserId).toBe(first.ownerUserId);

    const teams = await client`SELECT id FROM teams WHERE deleted_at IS NULL`;
    expect(teams).toHaveLength(1);

    const owners = await client`
      SELECT user_id FROM team_members WHERE team_id = ${first.teamId} AND role = 'owner'
    `;
    expect(owners).toHaveLength(1);
    expect(owners[0].user_id).toBe(first.ownerUserId);
  });

  it("demotes any other team-level owner to member", async () => {
    const [usurper] = await client`
      INSERT INTO users (email, name) VALUES ('usurper@pulse.pubky.org', 'Usurper') RETURNING id
    `;
    await client`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES (${testData.teamId}, ${usurper.id}, 'owner')
    `;

    await bootstrapSingletonTeam(db);

    const owners = await client`
      SELECT user_id FROM team_members WHERE team_id = ${testData.teamId} AND role = 'owner'
    `;
    expect(owners).toHaveLength(1);

    const [demoted] = await client`
      SELECT role FROM team_members WHERE team_id = ${testData.teamId} AND user_id = ${usurper.id}
    `;
    expect(demoted.role).toBe("member");
  });

  it("promotes the configured owner when they were only a member", async () => {
    await client`
      UPDATE team_members SET role = 'member'
      WHERE team_id = ${testData.teamId} AND user_id = ${testData.userId}
    `;

    const { ownerUserId } = await bootstrapSingletonTeam(db);
    expect(ownerUserId).toBe(testData.userId);

    const [membership] = await client`
      SELECT role FROM team_members WHERE team_id = ${testData.teamId} AND user_id = ${testData.userId}
    `;
    expect(membership.role).toBe("owner");
  });

  it("fails startup when an additional active team exists", async () => {
    await client`INSERT INTO teams (name, slug) VALUES ('Rogue Team', 'rogue-team')`;

    await expect(bootstrapSingletonTeam(db)).rejects.toThrow(
      /Singleton-team invariant violated/
    );

    // The extra team is reported, never removed or merged.
    const rogue = await client`SELECT deleted_at FROM teams WHERE slug = 'rogue-team'`;
    expect(rogue).toHaveLength(1);
    expect(rogue[0].deleted_at).toBeNull();
  });

  it("fails when the configured slug is held by a soft-deleted team", async () => {
    await client`UPDATE teams SET deleted_at = NOW() WHERE id = ${testData.teamId}`;

    await expect(bootstrapSingletonTeam(db)).rejects.toThrow(/soft-deleted/);

    // No second team was created to work around the conflict.
    const teams = await client`SELECT id FROM teams`;
    expect(teams).toHaveLength(1);
  });

  it("fails when the stored team name conflicts with the configured name", async () => {
    await client`UPDATE teams SET name = 'Something Else' WHERE id = ${testData.teamId}`;

    await expect(bootstrapSingletonTeam(db)).rejects.toThrow(/PULSE_DEFAULT_TEAM_NAME/);

    const teams = await client`SELECT id, name FROM teams`;
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe("Something Else");
  });

  it("resolves the team by slug, so a recreated team row is still found", async () => {
    const before = await findSingletonTeam(db);
    expect(before?.id).toBe(testData.teamId);

    // Exactly what the harness does between cases: drop and reseed the team.
    await truncateAll();
    const reseeded = await seedTestData();

    const after = await findSingletonTeam(db);
    expect(after?.id).toBe(reseeded.teamId);
    expect(after?.id).not.toBe(testData.teamId);
  });
});

describe("sign-in against the singleton team", () => {
  it("puts a first-time user in the existing team as a member, creating no new team", async () => {
    const res = await signIn("firsttimer@pulse.pubky.org");

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].id).toBe(testData.teamId);
    expect(body.teams[0].role).toBe("member");

    const teams = await client`SELECT id FROM teams WHERE deleted_at IS NULL`;
    expect(teams).toHaveLength(1);
  });

  it("gives the configured owner address the owner role", async () => {
    // The seeded user is the configured owner; drop their membership so the
    // sign-in path, not the seed, has to assign the role.
    await client`DELETE FROM team_members WHERE user_id = ${testData.userId}`;

    const res = await signIn(TEST_USER.email);

    expect(res.statusCode).toBe(200);
    expect(res.json().teams[0].role).toBe("owner");
  });

  it("repairs an allowed existing user whose singleton membership is missing", async () => {
    const [orphan] = await client`
      INSERT INTO users (email, name) VALUES ('orphan@pulse.pubky.org', 'Orphan') RETURNING id
    `;

    const res = await signIn("orphan@pulse.pubky.org");

    expect(res.statusCode).toBe(200);
    expect(res.json().is_new_user).toBe(false);

    const [membership] = await client`
      SELECT role FROM team_members WHERE team_id = ${testData.teamId} AND user_id = ${orphan.id}
    `;
    expect(membership.role).toBe("member");
  });

  it("repeated sign-in creates no duplicate team, user, membership or key", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await signIn("repeat@pulse.pubky.org");
      expect([200, 201]).toContain(res.statusCode);
    }

    const users = await client`SELECT id FROM users WHERE email = 'repeat@pulse.pubky.org'`;
    expect(users).toHaveLength(1);

    const teams = await client`SELECT id FROM teams WHERE deleted_at IS NULL`;
    expect(teams).toHaveLength(1);

    const memberships = await client`SELECT team_id FROM team_members WHERE user_id = ${users[0].id}`;
    expect(memberships).toHaveLength(1);
    expect(memberships[0].team_id).toBe(testData.teamId);

    // Sign-in provisions no credential at all.
    const keys = await client`SELECT id FROM api_keys WHERE created_by = ${users[0].id}`;
    expect(keys).toHaveLength(0);
  });
});
