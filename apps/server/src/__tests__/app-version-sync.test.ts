import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";
import { TEST_DB_URL } from "./setup.js";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { apps, teams, projects, schema } from "@pubky-pulse/db";

const dbClient = postgres(TEST_DB_URL, { max: 1 });
const db = drizzle(dbClient, { schema });

let teamId: string;
let projectId: string;
let appleAppId: string;
let backendAppId: string;
let androidAppId: string;

async function createApp(opts: { platform: string; bundle_id: string | null; name: string }): Promise<string> {
  const [row] = await db
    .insert(apps)
    .values({
      team_id: teamId,
      project_id: projectId,
      name: opts.name,
      platform: opts.platform as "apple" | "android" | "web" | "backend",
      bundle_id: opts.bundle_id,
    })
    .returning({ id: apps.id });
  return row.id;
}

beforeAll(async () => {
  const [team] = await db
    .insert(teams)
    .values({ name: "App Version Sync Test Team", slug: `avs-${Date.now()}` })
    .returning({ id: teams.id });
  teamId = team.id;
  const [project] = await db
    .insert(projects)
    .values({ team_id: teamId, name: "App Version Sync Test", slug: `avs-${Date.now()}`, color: "#ff0000" })
    .returning({ id: projects.id });
  projectId = project.id;
});

beforeEach(async () => {
  // Fresh apps per test so version assertions don't leak between them
  appleAppId = await createApp({ platform: "apple", bundle_id: "com.example.test", name: "Apple App" });
  backendAppId = await createApp({ platform: "backend", bundle_id: null, name: "Backend App" });
  androidAppId = await createApp({ platform: "android", bundle_id: "com.example.android", name: "Android App" });
});

afterAll(async () => {
  await db.delete(apps).where(eq(apps.team_id, teamId));
  await db.delete(projects).where(eq(projects.team_id, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
  await dbClient.end();
});

function jobCtx() {
  return {
    runId: "test-run",
    updateProgress: async () => {},
    isCancelled: () => false,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    db,
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
    emailService: undefined,
  };
}

describe("app_version_sync", () => {
  it("nullifies latest_app_version when an app has no production events", async () => {
    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: appleAppId });

    expect(result.computed_synced).toBe(0);
    expect(result.no_version_available).toBe(1);

    const [row] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    expect(row.latest_app_version).toBeNull();
    expect(row.latest_app_version_updated_at).toBeTruthy();
  });

  it("computes from production events for Apple apps", async () => {
    const sessionId = "00000000-0000-0000-0000-cccccccc0001";
    const now = new Date();
    await dbClient`
      INSERT INTO events (app_id, session_id, level, message, app_version, is_dev, "timestamp")
      VALUES (${appleAppId}, ${sessionId}, 'info', 'test', '7.0.0', false, ${now.toISOString()}::timestamptz)
    `;

    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: appleAppId });

    expect(result.computed_synced).toBe(1);

    const [row] = await db.select().from(apps).where(eq(apps.id, appleAppId));
    expect(row.latest_app_version).toBe("7.0.0");
    expect(row.latest_app_version_updated_at).toBeTruthy();
  });

  it("computes the max version semver-aware, ignoring dev events", async () => {
    // Insert a backend event with multiple versions, including the lexicographic-trap pair 1.10.0 vs 1.9.0
    const sessionId = "00000000-0000-0000-0000-bbbbbbbbb001";
    const now = new Date();
    for (const version of ["1.0.0", "1.9.0", "1.10.0", "1.5.0"]) {
      await dbClient`
        INSERT INTO events (app_id, session_id, level, message, app_version, is_dev, "timestamp")
        VALUES (${backendAppId}, ${sessionId}, 'info', 'test', ${version}, false, ${now.toISOString()}::timestamptz)
      `;
    }
    // Insert a dev event with a higher version that should be ignored
    await dbClient`
      INSERT INTO events (app_id, session_id, level, message, app_version, is_dev, "timestamp")
      VALUES (${backendAppId}, ${sessionId}, 'info', 'test', '99.0.0', true, ${now.toISOString()}::timestamptz)
    `;

    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: backendAppId });

    expect(result.computed_synced).toBe(1);
    const [row] = await db.select().from(apps).where(eq(apps.id, backendAppId));
    expect(row.latest_app_version).toBe("1.10.0"); // semver-aware: 1.10 > 1.9
  });

  it("only syncs the requested app when app_id is passed", async () => {
    const { appVersionSyncHandler } = await import("../jobs/app-version-sync.js");
    const result = await appVersionSyncHandler(jobCtx(), { app_id: androidAppId });
    expect(result.apps_processed).toBe(1);
  });
});
