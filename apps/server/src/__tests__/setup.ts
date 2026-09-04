import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/drizzle",
);
import * as schema from "@pubky-pulse/db";
import { createDatabaseConnection, ensurePartitions, ensureMetricEventPartitions, ensureFunnelEventPartitions } from "@pubky-pulse/db";
import type { Permission, TeamRole } from "@pubky-pulse/shared";
import { buildServer } from "../app.js";
import { bootstrapSingletonTeam } from "../services/bootstrap-team.js";
import type { EmailService } from "../services/email.js";
import { JobRunner } from "../services/job-runner.js";
import type { JobContext, JobHandler } from "../services/job-runner.js";
import { NotificationDispatcher } from "../services/notifications/dispatcher.js";
import { inAppAdapter } from "../services/notifications/adapters/in-app.js";
import { createEmailAdapter } from "../services/notifications/adapters/email.js";
import { notificationDeliverHandler } from "../jobs/notification-deliver.js";

export const TEST_DB_URL = "postgres://localhost:5432/pubky_pulse_test";

export const TEST_CLIENT_KEY =
  "pulse_client_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const TEST_AGENT_KEY =
  "pulse_agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const TEST_EXPIRED_KEY =
  "pulse_client_cccccccccccccccccccccccccccccccccccccccccccccc";
export const TEST_BACKEND_CLIENT_KEY =
  "pulse_client_dddddddddddddddddddddddddddddddddddddddddddddd";
export const TEST_ANDROID_CLIENT_KEY =
  "pulse_client_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const TEST_IMPORT_KEY =
  "pulse_import_ffffffffffffffffffffffffffffffffffffffffffffffff";
export const TEST_ANDROID_BUNDLE_ID = "org.pubky.pulse.test.android";
export const TEST_BUNDLE_ID = "org.pubky.pulse.test";
export const TEST_SESSION_ID = "00000000-0000-0000-0000-000000000001";
export const TEST_USER = {
  email: "test@pulse.pubky.org",
  name: "Test User",
};

export class TestEmailService implements EmailService {
  lastCode: string = "";
  lastEmail: string = "";
  lastJobAlertEmail: string = "";
  lastJobAlertParams: { job_type: string; status: string; duration: string; error?: string } | null = null;

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.lastCode = code;
    this.lastEmail = email;
  }

  async sendJobAlert(email: string, params: { job_type: string; status: string; duration: string; error?: string }): Promise<void> {
    this.lastJobAlertEmail = email;
    this.lastJobAlertParams = params;
  }

  lastIssueDigestEmail: string = "";
  lastIssueDigestParams: { project_name: string; issues: Array<{ title: string; status: string; occurrence_count: number; unique_user_count: number; app_name: string }>; dashboard_url: string } | null = null;

  async sendIssueDigest(email: string, params: { project_name: string; issues: Array<{ title: string; status: string; occurrence_count: number; unique_user_count: number; app_name: string }>; dashboard_url: string }): Promise<void> {
    this.lastIssueDigestEmail = email;
    this.lastIssueDigestParams = params;
  }

  lastGenericNotificationEmail: string = "";
  lastGenericNotificationParams: { subject: string; body: string; link?: string; link_text?: string } | null = null;

  async sendGenericNotification(email: string, params: { subject: string; body: string; link?: string; link_text?: string }): Promise<void> {
    this.lastGenericNotificationEmail = email;
    this.lastGenericNotificationParams = params;
  }
}

let migrationClient: postgres.Sql | null = null;

export async function setupTestDb() {
  migrationClient = postgres(TEST_DB_URL, { max: 1 });

  const migrationDb = drizzle(migrationClient);
  await migrate(migrationDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
  });

  // Set up partitioned events table
  const result = await migrationClient`
    SELECT relkind FROM pg_class WHERE relname = 'events'
  `;

  if (result.length > 0 && result[0].relkind !== "p") {
    await migrationClient`DROP TABLE IF EXISTS events CASCADE`;
  }

  if (result.length === 0 || result[0].relkind !== "p") {
    // Schema mirrors packages/db/src/schema.ts events table. When a column is
    // added in schema.ts + a drizzle migration, add it here too — on a fresh
    // DB the migration applies to a regular events table, and then this
    // DROP+CREATE recreates it as partitioned, so any column not listed here
    // is silently lost.
    await migrationClient.unsafe(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL,
        client_event_id UUID,
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        api_key_id UUID,
        level log_level NOT NULL,
        source_module TEXT,
        message TEXT NOT NULL,
        screen_name VARCHAR(255),
        custom_attributes JSONB,
        environment environment,
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        sdk_name VARCHAR(50),
        sdk_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        locale VARCHAR(20),
        preferred_language VARCHAR(35),
        country_code VARCHAR(2),
        is_dev BOOLEAN NOT NULL DEFAULT FALSE,
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Set up partitioned metric_events table
  const meResult = await migrationClient`
    SELECT relkind FROM pg_class WHERE relname = 'metric_events'
  `;

  if (meResult.length > 0 && meResult[0].relkind !== "p") {
    await migrationClient`DROP TABLE IF EXISTS metric_events CASCADE`;
  }

  // Ensure metric_phase enum exists
  const metricPhaseCheck = await migrationClient`
    SELECT 1 FROM pg_type WHERE typname = 'metric_phase'
  `;
  if (metricPhaseCheck.length === 0) {
    await migrationClient.unsafe(`CREATE TYPE metric_phase AS ENUM ('start', 'complete', 'fail', 'cancel', 'record')`);
  }

  if (meResult.length === 0 || meResult[0].relkind !== "p") {
    // Keep column list aligned with packages/db/src/schema.ts metric_events.
    await migrationClient.unsafe(`
      CREATE TABLE IF NOT EXISTS metric_events (
        id UUID DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL,
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        api_key_id UUID,
        metric_slug VARCHAR(255) NOT NULL,
        phase metric_phase NOT NULL,
        tracking_id UUID,
        duration_ms INTEGER,
        error TEXT,
        attributes JSONB,
        environment environment,
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        sdk_name VARCHAR(50),
        sdk_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        country_code VARCHAR(2),
        is_dev BOOLEAN NOT NULL DEFAULT FALSE,
        client_event_id UUID,
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Set up partitioned funnel_events table
  const feResult = await migrationClient`
    SELECT relkind FROM pg_class WHERE relname = 'funnel_events'
  `;

  if (feResult.length > 0 && feResult[0].relkind !== "p") {
    await migrationClient`DROP TABLE IF EXISTS funnel_events CASCADE`;
  }

  if (feResult.length === 0 || feResult[0].relkind !== "p") {
    // Keep column list aligned with packages/db/src/schema.ts funnel_events.
    await migrationClient.unsafe(`
      CREATE TABLE IF NOT EXISTS funnel_events (
        id UUID DEFAULT gen_random_uuid(),
        app_id UUID NOT NULL,
        session_id UUID NOT NULL,
        user_id VARCHAR(255),
        api_key_id UUID,
        step_name VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        screen_name VARCHAR(255),
        custom_attributes JSONB,
        environment environment,
        os_version VARCHAR(50),
        app_version VARCHAR(50),
        sdk_name VARCHAR(50),
        sdk_version VARCHAR(50),
        device_model VARCHAR(100),
        build_number VARCHAR(50),
        country_code VARCHAR(2),
        is_dev BOOLEAN NOT NULL DEFAULT FALSE,
        client_event_id UUID,
        "timestamp" TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      ) PARTITION BY RANGE ("timestamp");
    `);
  }

  // Create partitions using shared utility
  await ensurePartitions(migrationClient, 1);
  await ensureMetricEventPartitions(migrationClient, 1);
  await ensureFunnelEventPartitions(migrationClient, 1);

  await migrationClient.end();
  migrationClient = null;
}

export const testEmailService = new TestEmailService();

/** A fast test handler that completes immediately. */
export const testJobHandler: JobHandler = async (ctx, params) => {
  const delay = (params.delay_ms as number) ?? 0;
  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
  }
  if (params.should_fail) {
    throw new Error("Test job failed");
  }
  return { test: true };
};

export async function buildApp() {
  const app = Fastify({ logger: false });
  const db = createDatabaseConnection(TEST_DB_URL);

  const jobRunner = new JobRunner({
    db,
    databaseUrl: TEST_DB_URL,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    emailService: testEmailService as EmailService,
  });
  // stats_aggregate_daily is the project-scoped job the trigger-API tests
  // drive; a fast stub keeps them off the real aggregator.
  jobRunner.register("stats_aggregate_daily", testJobHandler);
  jobRunner.register("test_job", testJobHandler);

  const notificationDispatcher = new NotificationDispatcher({
    db,
    jobRunner,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    adapters: [inAppAdapter, createEmailAdapter(testEmailService as EmailService)],
  });
  jobRunner.setNotificationDispatcher(notificationDispatcher);
  jobRunner.register("notification_deliver", notificationDeliverHandler(notificationDispatcher));

  // Plugins and routes come from the shared factory in src/app.ts so the test
  // app can never register a different route set than src/index.ts. Only the
  // test-specific wiring — database URL, stubbed email/job handlers, permissive
  // CORS and the fixed JWT secret — stays here.
  await buildServer({
    app,
    db,
    databaseUrl: TEST_DB_URL,
    emailService: testEmailService as EmailService,
    jobRunner,
    notificationDispatcher,
    cors: { origin: true, credentials: true },
    jwtSecret: "test-secret",
  });

  // Production runs the singleton-team bootstrap before app.listen; the test
  // app runs it here so suites exercise the same identity path.
  //
  // It truncates first because suites share one database and run sequentially
  // (`fileParallelism: false`): the previous file's rows are still present at
  // this point, and a leftover extra active team is a startup invariant
  // violation by design. Each suite's own beforeEach re-seeds from clean.
  await truncateAll();
  await bootstrapSingletonTeam(db);

  await app.ready();
  return app;
}

export async function truncateAll() {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`DELETE FROM notification_deliveries`.catch(() => {});
  await client`DELETE FROM notifications`.catch(() => {});
  await client`DELETE FROM event_attachments`.catch(() => {});
  await client`DELETE FROM feedback_comments`.catch(() => {});
  await client`DELETE FROM feedback`.catch(() => {});
  await client`DELETE FROM issue_comments`.catch(() => {});
  await client`DELETE FROM issue_occurrences`.catch(() => {});
  await client`DELETE FROM issue_fingerprints`.catch(() => {});
  await client`DELETE FROM issues`.catch(() => {});
  await client`DELETE FROM event_deletions`.catch(() => {});
  await client`DELETE FROM job_runs`.catch(() => {});
  await client`DELETE FROM audit_logs`;
  await client`DELETE FROM app_user_apps`;
  await client`DELETE FROM app_users`;
  await client`DELETE FROM events_daily`.catch(() => {});
  await client`DELETE FROM events_hourly`.catch(() => {});
  await client`DELETE FROM metric_events_daily`.catch(() => {});
  await client`DELETE FROM metric_events_hourly`.catch(() => {});
  await client`DELETE FROM funnel_events_daily`.catch(() => {});
  await client`DELETE FROM funnel_events_hourly`.catch(() => {});
  await client`DELETE FROM questionnaire_responses_daily`.catch(() => {});
  await client`DELETE FROM questionnaire_responses_hourly`.catch(() => {});
  await client`DELETE FROM funnel_events`;
  await client`DELETE FROM funnel_definitions`;
  await client`DELETE FROM metric_events`;
  await client`DELETE FROM metric_definitions`;
  await client`DELETE FROM events`;
  await client`DELETE FROM api_keys`;
  await client`DELETE FROM apps`;
  await client`DELETE FROM project_owners`;
  await client`DELETE FROM projects`;
  await client`DELETE FROM team_members`;
  await client`DELETE FROM teams`;
  await client`DELETE FROM email_verification_codes`;
  await client`DELETE FROM users`;
  await client.end();
}

export async function seedTestData() {
  const client = postgres(TEST_DB_URL, { max: 1 });

  const [user] = await client`
    INSERT INTO users (email, name)
    VALUES (${TEST_USER.email}, ${TEST_USER.name})
    RETURNING id
  `;

  const [team] = await client`
    INSERT INTO teams (name, slug)
    VALUES ('Test Team', 'test-team')
    RETURNING id
  `;

  await client`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (${team.id}, ${user.id}, 'owner')
  `;

  const [project] = await client`
    INSERT INTO projects (team_id, name, slug, color)
    VALUES (${team.id}, 'Test Project', 'test-project', '#0ea5e9')
    RETURNING id
  `;

  // Every project needs at least one owner — ordinary project-scoped writes
  // are authorized against project_owners, not team membership.
  await client`
    INSERT INTO project_owners (project_id, user_id)
    VALUES (${project.id}, ${user.id})
  `;

  const [app] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${team.id}, ${project.id}, 'Test App', 'apple', ${TEST_BUNDLE_ID})
    RETURNING id
  `;

  // Client key (events:write + users:write, scoped to app)
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${TEST_CLIENT_KEY},
      'client',
      ${app.id},
      ${team.id},
      'Test Client Key',
      ${user.id},
      ${JSON.stringify(["events:write", "users:write"])}::jsonb
    )
  `;

  // Agent key (events:read, funnels:read, team-wide)
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${TEST_AGENT_KEY},
      'agent',
      ${null},
      ${team.id},
      'Test Agent Key',
      ${user.id},
      ${JSON.stringify(["events:read", "funnels:read", "apps:read", "projects:read", "metrics:read", "feedback:read", "feedback:write", "questionnaires:read", "questionnaires:write"])}::jsonb
    )
  `;

  // Separate project for backend app
  const [backendProject] = await client`
    INSERT INTO projects (team_id, name, slug, color)
    VALUES (${team.id}, 'Test Backend Project', 'test-backend-project', '#22c55e')
    RETURNING id
  `;

  await client`
    INSERT INTO project_owners (project_id, user_id)
    VALUES (${backendProject.id}, ${user.id})
  `;

  // Backend app (no bundle_id, in its own project)
  const [backendApp] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${team.id}, ${backendProject.id}, 'Test Backend App', 'backend', ${null})
    RETURNING id
  `;

  // Backend client key (events:write + users:write, scoped to backend app)
  // Both perms because the Node SDK integration suite both ingests events and
  // sets user properties — same shape as the apple TEST_CLIENT_KEY above.
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${TEST_BACKEND_CLIENT_KEY},
      'client',
      ${backendApp.id},
      ${team.id},
      'Test Backend Client Key',
      ${user.id},
      ${JSON.stringify(["events:write", "users:write"])}::jsonb
    )
  `;

  // Separate project for android app
  const [androidProject] = await client`
    INSERT INTO projects (team_id, name, slug, color)
    VALUES (${team.id}, 'Test Android Project', 'test-android-project', '#a855f7')
    RETURNING id
  `;

  await client`
    INSERT INTO project_owners (project_id, user_id)
    VALUES (${androidProject.id}, ${user.id})
  `;

  // Android app
  const [androidApp] = await client`
    INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
    VALUES (${team.id}, ${androidProject.id}, 'Test Android App', 'android', ${TEST_ANDROID_BUNDLE_ID})
    RETURNING id
  `;

  // Android client key (events:write, scoped to android app)
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${TEST_ANDROID_CLIENT_KEY},
      'client',
      ${androidApp.id},
      ${team.id},
      'Test Android Client Key',
      ${user.id},
      ${JSON.stringify(["events:write"])}::jsonb
    )
  `;

  // Import key (events:write + users:write, scoped to apple app)
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
    VALUES (
      ${TEST_IMPORT_KEY},
      'import',
      ${app.id},
      ${team.id},
      'Test Import Key',
      ${user.id},
      ${JSON.stringify(["events:write", "users:write"])}::jsonb
    )
  `;

  // Expired client key
  await client`
    INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions, expires_at)
    VALUES (
      ${TEST_EXPIRED_KEY},
      'client',
      ${app.id},
      ${team.id},
      'Expired Key',
      ${user.id},
      ${JSON.stringify(["events:write"])}::jsonb,
      ${new Date("2020-01-01")}
    )
  `;

  await client.end();

  return {
    userId: user.id,
    teamId: team.id,
    projectId: project.id,
    appId: app.id,
    backendProjectId: backendProject.id,
    backendAppId: backendApp.id,
    androidProjectId: androidProject.id,
    androidAppId: androidApp.id,
  };
}

/**
 * Direct INSERT into app_users for tests that need to seed a row without
 * going through /v1/ingest or /v1/identity/claim. Returns the row id.
 * Defaults match the most common test shape: a real (non-anonymous) user
 * row with no claimed_from and no properties. Identity-claim tests that
 * need an anonymous row pass `{ isAnonymous: true }` explicitly.
 */
export async function insertAppUser(
  projectId: string,
  userId: string,
  opts: {
    isAnonymous?: boolean;
    properties?: Record<string, string> | null;
    claimedFrom?: string[] | null;
  } = {},
): Promise<string> {
  const { isAnonymous = false, properties = null, claimedFrom = null } = opts;
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    const [row] = await client`
      INSERT INTO app_users (project_id, user_id, is_anonymous, claimed_from, properties)
      VALUES (
        ${projectId},
        ${userId},
        ${isAnonymous},
        ${claimedFrom === null ? null : client.json(claimedFrom)},
        ${properties === null ? null : client.json(properties)}
      )
      RETURNING id
    `;
    return row.id as string;
  } finally {
    await client.end();
  }
}

/**
 * Creates a user via the send-code/verify-code flow and returns token + user info.
 */
export async function createUserAndGetToken(
  app: FastifyInstance,
  email: string,
  name?: string,
): Promise<{ token: string; user: any; teams: any[]; userId: string; teamId: string }> {
  // Send code
  await app.inject({
    method: "POST",
    url: "/v1/auth/send-code",
    payload: { email },
  });

  const code = testEmailService.lastCode;

  // Verify code
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/verify-code",
    payload: { email, code },
  });

  const body = res.json();

  // Optionally update name if provided and different
  if (name && body.user.name !== name) {
    await app.inject({
      method: "PATCH",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${body.token}` },
      payload: { name },
    });
  }

  return {
    token: body.token,
    user: body.user,
    teams: body.teams,
    userId: body.user.id,
    teamId: body.teams[0].id,
  };
}

/**
 * Logs in the seeded test user and returns the JWT token and the user's first team ID.
 */
export async function getTokenAndTeamId(app: FastifyInstance) {
  // Send code for existing test user
  await app.inject({
    method: "POST",
    url: "/v1/auth/send-code",
    payload: { email: TEST_USER.email },
  });

  const code = testEmailService.lastCode;

  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/verify-code",
    payload: { email: TEST_USER.email, code },
  });

  const body = res.json();
  return { token: body.token, teamId: body.teams[0].id };
}

/**
 * Shorthand — returns just the JWT token.
 */
export async function getToken(app: FastifyInstance) {
  const { token } = await getTokenAndTeamId(app);
  return token;
}

/**
 * Creates an agent API key with the given permissions and returns the full key string.
 */
export async function createAgentKey(
  app: FastifyInstance,
  token: string,
  teamId: string,
  permissions: Permission[]
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/keys",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Custom Agent Key", key_type: "agent", team_id: teamId, permissions },
  });
  return res.json().api_key.secret;
}

/**
 * Directly upserts a team member via DB.
 * Useful for tests that need a member at a specific role.
 *
 * It upserts rather than inserts because signing in now attaches the user to
 * the configured singleton team automatically, so callers that log a user in
 * and then place them at a specific role are adjusting an existing row.
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = "member"
): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  await client`
    INSERT INTO team_members (team_id, user_id, role)
    VALUES (${teamId}, ${userId}, ${role})
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;
  await client.end();
}

/**
 * Creates a second, non-configured team with its own owner, project, app,
 * agent key, event and feedback item, entirely in the database.
 *
 * Signing in can no longer produce a team of one's own — every allowed user
 * joins the configured singleton team — so suites that assert a boundary
 * between teams (API keys, agent keys, team-scoped queries) build the far side
 * of that boundary here instead. The rows are deliberately unreachable through
 * the human login flow, which is exactly the situation under test.
 *
 * The event, feedback and job-run rows exist so a boundary test can name real
 * foreign data: a 404 for an id that never existed proves nothing about
 * isolation. The job run is left `running` so a cross-team cancel attempt
 * reaches the containment guard rather than stopping at a status check.
 */
export async function createForeignTeam(opts: {
  email?: string;
  teamName?: string;
  teamSlug?: string;
} = {}): Promise<{
  teamId: string;
  userId: string;
  projectId: string;
  appId: string;
  apiKeyId: string;
  apiKeySecret: string;
  eventId: string;
  feedbackId: string;
  jobRunId: string;
}> {
  const suffix = randomUUID().slice(0, 8);
  const {
    email = `foreign-${suffix}@pulse.pubky.org`,
    teamName = `Foreign Team ${suffix}`,
    teamSlug = `foreign-team-${suffix}`,
  } = opts;

  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    const [user] = await client`
      INSERT INTO users (email, name) VALUES (${email}, ${"Foreign User"}) RETURNING id
    `;
    const [team] = await client`
      INSERT INTO teams (name, slug) VALUES (${teamName}, ${teamSlug}) RETURNING id
    `;
    await client`
      INSERT INTO team_members (team_id, user_id, role) VALUES (${team.id}, ${user.id}, 'owner')
    `;
    const [project] = await client`
      INSERT INTO projects (team_id, name, slug, color)
      VALUES (${team.id}, ${`Foreign Project ${suffix}`}, ${`foreign-project-${suffix}`}, '#f97316')
      RETURNING id
    `;
    await client`
      INSERT INTO project_owners (project_id, user_id) VALUES (${project.id}, ${user.id})
    `;
    const [foreignApp] = await client`
      INSERT INTO apps (team_id, project_id, name, platform, bundle_id)
      VALUES (${team.id}, ${project.id}, ${`Foreign App ${suffix}`}, 'apple', ${`dev.foreign.${suffix}`})
      RETURNING id
    `;
    const apiKeySecret = `pulse_agent_${suffix.padEnd(8, "0").repeat(4)}`;
    const [foreignKey] = await client`
      INSERT INTO api_keys (secret, key_type, app_id, team_id, name, created_by, permissions)
      VALUES (
        ${apiKeySecret},
        'agent',
        ${null},
        ${team.id},
        'Foreign Agent Key',
        ${user.id},
        ${JSON.stringify(["events:read", "apps:read", "projects:read"])}::jsonb
      )
      RETURNING id
    `;
    // Real data inside the foreign app: `events` is partitioned by timestamp,
    // so this uses now() to land in the partition the harness already created.
    const [foreignEvent] = await client`
      INSERT INTO events (app_id, session_id, level, message, timestamp)
      VALUES (${foreignApp.id}, ${randomUUID()}, 'info', ${`Foreign event ${suffix}`}, now())
      RETURNING id
    `;
    const [foreignFeedback] = await client`
      INSERT INTO feedback (app_id, project_id, message)
      VALUES (${foreignApp.id}, ${project.id}, ${`Foreign feedback ${suffix}`})
      RETURNING id
    `;
    const [foreignJobRun] = await client`
      INSERT INTO job_runs (job_type, status, team_id, project_id, triggered_by)
      VALUES ('stats_aggregate_daily', 'running', ${team.id}, ${project.id}, 'foreign-team-fixture')
      RETURNING id
    `;
    return {
      teamId: team.id as string,
      userId: user.id as string,
      projectId: project.id as string,
      appId: foreignApp.id as string,
      apiKeyId: foreignKey.id as string,
      apiKeySecret,
      eventId: foreignEvent.id as string,
      feedbackId: foreignFeedback.id as string,
      jobRunId: foreignJobRun.id as string,
    };
  } finally {
    await client.end();
  }
}

/**
 * Grants a user ownership of a project. Idempotent, matching the PUT
 * /v1/projects/:projectId/owners/:userId contract, so an ACL suite can call it
 * without first checking whether the row already exists.
 */
export async function addProjectOwner(projectId: string, userId: string): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    await client`
      INSERT INTO project_owners (project_id, user_id)
      VALUES (${projectId}, ${userId})
      ON CONFLICT DO NOTHING
    `;
  } finally {
    await client.end();
  }
}

/**
 * Creates a project and its first owner in one transaction, mirroring the
 * invariant the create-project route must hold: a project is never visible
 * without an owner. Returns the project id. The slug defaults to a unique value
 * because slugs are unique per team.
 */
export async function createProjectWithOwner(
  teamId: string,
  ownerUserId: string,
  opts: { name?: string; slug?: string; color?: string } = {},
): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const { name = `Test Project ${suffix}`, slug = `test-project-${suffix}`, color = "#0ea5e9" } = opts;
  // `max: 1` pins every statement below to the same connection, so the explicit
  // transaction control applies to them. postgres.js's `begin()` callback type
  // is not tag-callable, hence BEGIN/COMMIT rather than `client.begin`.
  const client = postgres(TEST_DB_URL, { max: 1 });
  try {
    await client`BEGIN`;
    try {
      const [project] = await client`
        INSERT INTO projects (team_id, name, slug, color)
        VALUES (${teamId}, ${name}, ${slug}, ${color})
        RETURNING id
      `;
      await client`
        INSERT INTO project_owners (project_id, user_id)
        VALUES (${project.id}, ${ownerUserId})
      `;
      await client`COMMIT`;
      return project.id as string;
    } catch (err) {
      await client`ROLLBACK`.catch(() => {});
      throw err;
    }
  } finally {
    await client.end();
  }
}

/**
 * Minimal JobContext for tests that drive a job handler directly without the
 * full JobRunner. Each call gets its own postgres connection so concurrent
 * tests don't share a `client`.
 */
export function makeJobContext(): JobContext {
  return {
    runId: "test-run",
    db: createDatabaseConnection(TEST_DB_URL),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    isCancelled: () => false,
    updateProgress: async () => {},
    createClient: () => postgres(TEST_DB_URL, { max: 1 }),
  };
}

