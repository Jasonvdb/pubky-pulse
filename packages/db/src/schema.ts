import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  date,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const teamRoleEnum = pgEnum("team_role", ["owner", "admin", "member"]);
export const apiKeyTypeEnum = pgEnum("api_key_type", ["client", "agent", "server", "import"]);
export const appPlatformEnum = pgEnum("app_platform", ["apple", "android", "web", "backend"]);
export const environmentEnum = pgEnum("environment", ["ios", "ipados", "macos", "watchos", "android", "web", "backend"]);
export const logLevelEnum = pgEnum("log_level", [
  "info",
  "debug",
  "warn",
  "error",
]);

export const metricPhaseEnum = pgEnum("metric_phase", ["start", "complete", "fail", "cancel", "record"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "completed", "failed", "cancelled"]);
export const issueStatusEnum = pgEnum("issue_status", ["new", "in_progress", "resolved", "silenced", "regressed", "snoozed"]);
export const issueAlertFrequencyEnum = pgEnum("issue_alert_frequency", ["none", "hourly", "6_hourly", "daily", "weekly"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["new", "in_review", "addressed", "dismissed"]);
export const questionnaireResponseStatusEnum = pgEnum("questionnaire_response_status", ["draft", "new", "in_review", "addressed", "dismissed"]);

// Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  preferences: jsonb("preferences")
    .$type<import("@pubky-pulse/shared").UserPreferences>()
    .notNull()
    .default({}),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Email Verification Codes
export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    code_hash: text("code_hash").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    used_at: timestamp("used_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("email_verification_codes_email_idx").on(table.email)]
);

// Teams
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

// Team members
export const teamMembers = pgTable(
  "team_members",
  {
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("member"),
    joined_at: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("team_members_team_user_idx").on(table.team_id, table.user_id),
    index("team_members_user_id_idx").on(table.user_id),
  ]
);

// Projects
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(),
    retention_days_events: integer("retention_days_events"),
    retention_days_metrics: integer("retention_days_metrics"),
    retention_days_funnels: integer("retention_days_funnels"),
    attachment_user_quota_bytes: bigint("attachment_user_quota_bytes", { mode: "number" }),
    attachment_project_quota_bytes: bigint("attachment_project_quota_bytes", { mode: "number" }),
    issue_alert_frequency: issueAlertFrequencyEnum("issue_alert_frequency").default("daily"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("projects_team_id_idx").on(table.team_id),
    uniqueIndex("projects_team_slug_idx").on(table.team_id, table.slug),
  ]
);

// Apps
export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    platform: appPlatformEnum("platform").notNull(),
    bundle_id: varchar("bundle_id", { length: 255 }),
    latest_app_version: varchar("latest_app_version", { length: 50 }),
    latest_app_version_updated_at: timestamp("latest_app_version_updated_at", { withTimezone: true }),
    // The languages this app ships, used to compute the localization gap
    // (demand for a language the app doesn't ship). Auto-reported by the SDK
    // from `Bundle.main.localizations` (source 'sdk', authoritative); 'manual'
    // is an optional override for apps not yet reporting.
    supported_languages: text("supported_languages").array(),
    supported_languages_source: varchar("supported_languages_source", { length: 10 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("apps_team_id_idx").on(table.team_id),
    index("apps_project_id_idx").on(table.project_id),
  ]
);

// API Keys
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secret: text("secret").notNull(),
    key_type: apiKeyTypeEnum("key_type").notNull(),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    created_by: uuid("created_by").notNull().references(() => users.id),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_secret_idx").on(table.secret),
    index("api_keys_team_id_idx").on(table.team_id),
    index("api_keys_app_id_idx").on(table.app_id),
  ]
);

// Events — NOTE: This table is partitioned by month on `timestamp`.
// Drizzle doesn't natively support partitioning, so the migration SQL
// must be manually edited to use PARTITION BY RANGE (timestamp).
// See src/migrate.ts for partition creation logic.
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom(),
    app_id: uuid("app_id").notNull(),
    client_event_id: uuid("client_event_id"),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    api_key_id: uuid("api_key_id"),
    level: logLevelEnum("level").notNull(),
    source_module: text("source_module"),
    message: text("message").notNull(),
    screen_name: varchar("screen_name", { length: 255 }),
    custom_attributes: jsonb("custom_attributes").$type<Record<string, string>>(),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    sdk_name: varchar("sdk_name", { length: 50 }),
    sdk_version: varchar("sdk_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    // `locale` is the *shown* locale (Locale.current on iOS) — its language
    // component is constrained to what the app ships. `preferred_language` is
    // the user's top *wanted* language (Locale.preferredLanguages.first),
    // unconstrained by the app — the real localization-demand signal.
    locale: varchar("locale", { length: 20 }),
    preferred_language: varchar("preferred_language", { length: 35 }),
    country_code: varchar("country_code", { length: 2 }),
    is_dev: boolean("is_dev").notNull().default(false),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_app_timestamp_idx").on(table.app_id, table.timestamp),
    index("events_app_level_timestamp_idx").on(
      table.app_id,
      table.level,
      table.timestamp
    ),
    index("events_app_user_timestamp_idx").on(
      table.app_id,
      table.user_id,
      table.timestamp
    ),
    index("events_app_screen_name_timestamp_idx").on(
      table.app_id,
      table.screen_name,
      table.timestamp
    ),
    index("events_client_event_id_idx").on(table.app_id, table.client_event_id),
    index("events_app_session_timestamp_idx").on(table.app_id, table.session_id, table.timestamp),
    index("events_app_dev_timestamp_idx").on(table.app_id, table.is_dev, table.timestamp),
  ]
);

// App Users — auto-populated on ingest, tracks anonymous vs real users
// Users are unique per project (not per app). The app_user_apps junction
// table tracks which apps a user has been seen from.
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 255 }).notNull(),
    is_anonymous: boolean("is_anonymous").notNull(),
    claimed_from: jsonb("claimed_from").$type<string[]>(),
    properties: jsonb("properties").$type<Record<string, string>>(),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_country_code: varchar("last_country_code", { length: 2 }),
    last_app_version: varchar("last_app_version", { length: 50 }),
    last_sdk_name: varchar("last_sdk_name", { length: 50 }),
    last_sdk_version: varchar("last_sdk_version", { length: 50 }),
    // Denormalized locale signals (see events.locale / events.preferred_language).
    // `last_locale` (shown) is backfillable from historical events; `last_preferred_language`
    // (wanted) only populates as users upgrade to the SDK that captures it.
    last_locale: varchar("last_locale", { length: 20 }),
    last_preferred_language: varchar("last_preferred_language", { length: 35 }),
    // Dev vs prod, mirroring events.is_dev so user listings/counts can filter by
    // data_mode like every other surface. Derived from CLIENT events only
    // (apple/android/web apps) via upsertAppUsers — backend-platform apps never
    // drive it, because dev/test clients routinely hit production backends and
    // would otherwise be mislabeled prod. Last-write-wins, like the last_* columns.
    is_dev: boolean("is_dev").notNull().default(false),
  },
  (table) => [
    uniqueIndex("app_users_project_user_idx").on(table.project_id, table.user_id),
    index("app_users_project_anonymous_idx").on(table.project_id, table.is_anonymous),
    index("app_users_project_last_seen_idx").on(table.project_id, table.last_seen_at),
    index("app_users_project_is_dev_idx").on(table.project_id, table.is_dev),
  ]
);

// Junction table: tracks which apps a user has been seen from
export const appUserApps = pgTable(
  "app_user_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    app_user_id: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("app_user_apps_user_app_idx").on(table.app_user_id, table.app_id),
    index("app_user_apps_app_id_idx").on(table.app_id),
  ]
);

// Team Invitations
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: teamRoleEnum("role").notNull().default("member"),
    token: uuid("token").notNull().defaultRandom(),
    invited_by_user_id: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("team_invitations_team_email_idx").on(table.team_id, table.email),
    uniqueIndex("team_invitations_token_idx").on(table.token),
    index("team_invitations_email_idx").on(table.email),
  ]
);

// Funnel Definitions
export const funnelDefinitions = pgTable(
  "funnel_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    steps: jsonb("steps")
      .$type<Array<{ name: string; event_filter: { step_name?: string; screen_name?: string } }>>()
      .notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("funnel_definitions_project_id_idx").on(table.project_id),
    uniqueIndex("funnel_definitions_project_slug_idx").on(table.project_id, table.slug),
  ]
);

// Metric Definitions
export const metricDefinitions = pgTable(
  "metric_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    documentation: text("documentation"),
    schema_definition: jsonb("schema_definition"),
    aggregation_rules: jsonb("aggregation_rules"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("metric_definitions_project_id_idx").on(table.project_id),
    uniqueIndex("metric_definitions_project_slug_idx").on(table.project_id, table.slug),
  ]
);

// Metric Events — NOTE: This table is partitioned by month on `timestamp`.
// Same strategy as events table. See src/migrate.ts for partition creation logic.
export const metricEvents = pgTable(
  "metric_events",
  {
    id: uuid("id").defaultRandom(),
    app_id: uuid("app_id").notNull(),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    api_key_id: uuid("api_key_id"),
    metric_slug: varchar("metric_slug", { length: 255 }).notNull(),
    phase: metricPhaseEnum("phase").notNull(),
    tracking_id: uuid("tracking_id"),
    duration_ms: integer("duration_ms"),
    error: text("error"),
    attributes: jsonb("attributes").$type<Record<string, string>>(),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    sdk_name: varchar("sdk_name", { length: 50 }),
    sdk_version: varchar("sdk_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    country_code: varchar("country_code", { length: 2 }),
    is_dev: boolean("is_dev").notNull().default(false),
    client_event_id: uuid("client_event_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("metric_events_app_slug_timestamp_idx").on(table.app_id, table.metric_slug, table.timestamp),
    index("metric_events_app_slug_phase_timestamp_idx").on(table.app_id, table.metric_slug, table.phase, table.timestamp),
    index("metric_events_app_tracking_id_idx").on(table.app_id, table.tracking_id),
    index("metric_events_app_client_event_id_idx").on(table.app_id, table.client_event_id),
  ]
);

// Audit Logs
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "api_key", "system"]);
export const auditActionEnum = pgEnum("audit_action", ["create", "update", "delete"]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    actor_type: auditActorTypeEnum("actor_type").notNull(),
    actor_id: varchar("actor_id", { length: 255 }).notNull(),
    action: auditActionEnum("action").notNull(),
    resource_type: varchar("resource_type", { length: 50 }).notNull(),
    resource_id: varchar("resource_id", { length: 255 }).notNull(),
    changes: jsonb("changes").$type<Record<string, { before?: unknown; after?: unknown }>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_team_timestamp_idx").on(table.team_id, table.timestamp),
    index("audit_logs_resource_idx").on(table.resource_type, table.resource_id),
    index("audit_logs_actor_idx").on(table.actor_type, table.actor_id),
  ]
);

// Funnel Events — NOTE: This table is partitioned by month on `timestamp`.
// Same strategy as events and metric_events tables. See src/migrate.ts for partition creation logic.
export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: uuid("id").defaultRandom(),
    app_id: uuid("app_id").notNull(),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    api_key_id: uuid("api_key_id"),
    step_name: varchar("step_name", { length: 255 }).notNull(),
    message: text("message").notNull(),
    screen_name: varchar("screen_name", { length: 255 }),
    custom_attributes: jsonb("custom_attributes").$type<Record<string, string>>(),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    sdk_name: varchar("sdk_name", { length: 50 }),
    sdk_version: varchar("sdk_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    build_number: varchar("build_number", { length: 50 }),
    country_code: varchar("country_code", { length: 2 }),
    is_dev: boolean("is_dev").notNull().default(false),
    client_event_id: uuid("client_event_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    received_at: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("funnel_events_app_step_timestamp_idx").on(table.app_id, table.step_name, table.timestamp),
    index("funnel_events_app_user_timestamp_idx").on(table.app_id, table.user_id, table.timestamp),
    index("funnel_events_app_step_user_timestamp_idx").on(table.app_id, table.step_name, table.user_id, table.timestamp),
    index("funnel_events_app_client_event_id_idx").on(table.app_id, table.client_event_id),
  ]
);

// Background job runs
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job_type: varchar("job_type", { length: 100 }).notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    team_id: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    triggered_by: varchar("triggered_by", { length: 100 }).notNull(),
    params: jsonb("params").$type<Record<string, unknown>>(),
    progress: jsonb("progress").$type<{
      processed: number;
      total: number;
      message?: string;
    }>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    notify: boolean("notify").notNull().default(false),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("job_runs_job_type_created_at_idx").on(table.job_type, table.created_at),
    index("job_runs_status_idx").on(table.status),
    index("job_runs_team_id_created_at_idx").on(table.team_id, table.created_at),
    index("job_runs_project_id_idx").on(table.project_id),
  ]
);

// Issues — error events grouped by fingerprint for tracking and resolution
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: issueStatusEnum("status").notNull().default("new"),
    title: text("title").notNull(),
    source_module: text("source_module"),
    is_dev: boolean("is_dev").notNull().default(false),
    occurrence_count: integer("occurrence_count").notNull().default(0),
    unique_user_count: integer("unique_user_count").notNull().default(0),
    resolved_at_version: varchar("resolved_at_version", { length: 50 }),
    first_seen_app_version: varchar("first_seen_app_version", { length: 50 }),
    last_seen_app_version: varchar("last_seen_app_version", { length: 50 }),
    first_seen_sdk_version: varchar("first_seen_sdk_version", { length: 50 }),
    last_seen_sdk_version: varchar("last_seen_sdk_version", { length: 50 }),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    last_notified_at: timestamp("last_notified_at", { withTimezone: true }),
    snoozed_at: timestamp("snoozed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("issues_project_status_idx").on(table.project_id, table.status),
    index("issues_project_last_seen_idx").on(table.project_id, table.last_seen_at),
    index("issues_project_unique_users_idx").on(table.project_id, table.unique_user_count),
    index("issues_app_status_idx").on(table.app_id, table.status),
  ]
);

// Issue Fingerprints — lookup table for deduplication, supports merging
export const issueFingerprints = pgTable(
  "issue_fingerprints",
  {
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull().default(false),
    issue_id: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
  },
  (table) => [
    // Composite PK — guarantees no two issues claim the same fingerprint
    uniqueIndex("issue_fingerprints_pk").on(table.fingerprint, table.app_id, table.is_dev),
    index("issue_fingerprints_issue_id_idx").on(table.issue_id),
  ]
);

// Issue Occurrences — one per session per issue
export const issueOccurrences = pgTable(
  "issue_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issue_id: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    session_id: uuid("session_id").notNull(),
    user_id: varchar("user_id", { length: 255 }),
    app_version: varchar("app_version", { length: 50 }),
    sdk_name: varchar("sdk_name", { length: 50 }),
    sdk_version: varchar("sdk_version", { length: 50 }),
    environment: environmentEnum("environment"),
    event_id: uuid("event_id"),
    country_code: varchar("country_code", { length: 2 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("issue_occurrences_issue_session_idx").on(table.issue_id, table.session_id),
    index("issue_occurrences_issue_timestamp_idx").on(table.issue_id, table.timestamp),
    index("issue_occurrences_user_id_idx").on(table.user_id),
  ]
);

// Issue Comments — investigation notes from users and agents
export const issueComments = pgTable(
  "issue_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issue_id: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    author_type: varchar("author_type", { length: 10 }).notNull(),
    author_id: uuid("author_id").notNull(),
    author_name: varchar("author_name", { length: 255 }).notNull(),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("issue_comments_issue_created_at_idx").on(table.issue_id, table.created_at),
    index("issue_comments_author_id_idx").on(table.author_id),
  ]
);

// Event Attachments — files uploaded by SDKs to accompany error events for debugging.
// Bytes live on disk (see FileStorage); only metadata is stored here. Not partitioned —
// row count stays small relative to events. Linked to an event via event_client_id at
// upload time, with event_id backfilled when the event lands (race-safe either direction).
// Linked to an issue by the issue-scan job so attachments survive event retention pruning.
export const eventAttachments = pgTable(
  "event_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    event_client_id: uuid("event_client_id"),
    event_id: uuid("event_id"),
    issue_id: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    user_id: varchar("user_id", { length: 255 }),
    original_filename: varchar("original_filename", { length: 512 }).notNull(),
    content_type: varchar("content_type", { length: 128 }).notNull(),
    size_bytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storage_path: text("storage_path").notNull(),
    is_dev: boolean("is_dev").notNull().default(false),
    uploaded_at: timestamp("uploaded_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("event_attachments_project_created_at_idx").on(table.project_id, table.created_at),
    index("event_attachments_app_event_client_id_idx").on(table.app_id, table.event_client_id),
    index("event_attachments_event_id_idx").on(table.event_id),
    index("event_attachments_issue_id_idx").on(table.issue_id),
    index("event_attachments_project_deleted_at_idx").on(table.project_id, table.deleted_at),
    index("event_attachments_project_user_idx").on(table.project_id, table.user_id),
  ]
);

// Feedback — user-submitted feedback collected via SDK or dashboard. One row per submission.
// Not partitioned (low volume, wants FK for comments). Soft-deletable for undo.
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    session_id: uuid("session_id"),
    user_id: varchar("user_id", { length: 255 }),
    message: text("message").notNull(),
    submitter_name: varchar("submitter_name", { length: 255 }),
    submitter_email: varchar("submitter_email", { length: 320 }),
    status: feedbackStatusEnum("status").notNull().default("new"),
    is_dev: boolean("is_dev").notNull().default(false),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    sdk_name: varchar("sdk_name", { length: 50 }),
    sdk_version: varchar("sdk_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    country_code: varchar("country_code", { length: 2 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("feedback_project_status_idx").on(table.project_id, table.status),
    index("feedback_project_created_at_idx").on(table.project_id, table.created_at),
    index("feedback_app_status_idx").on(table.app_id, table.status),
    index("feedback_session_id_idx").on(table.session_id),
    index("feedback_user_id_idx").on(table.user_id),
  ]
);

// Feedback Comments — investigation notes from users and agents (mirrors issue_comments)
export const feedbackComments = pgTable(
  "feedback_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedback_id: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    author_type: varchar("author_type", { length: 10 }).notNull(),
    author_id: uuid("author_id").notNull(),
    author_name: varchar("author_name", { length: 255 }).notNull(),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("feedback_comments_feedback_created_at_idx").on(table.feedback_id, table.created_at),
    index("feedback_comments_author_id_idx").on(table.author_id),
  ]
);

// Questionnaires — structured multi-question surveys. The schema is stored as
// JSONB and snapshotted into each response so historical answers always render
// against the schema they were captured under. Slug is unique per project among
// non-deleted rows; restoring a soft-deleted definition is allowed by reusing
// the slug at the application layer.
export const questionnaires = pgTable(
  "questionnaires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    schema: jsonb("schema").notNull(),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("questionnaires_project_slug_active_idx")
      .on(table.project_id, table.slug)
      .where(sql`${table.deleted_at} IS NULL`),
    index("questionnaires_project_idx").on(table.project_id, table.deleted_at),
  ]
);

// Questionnaire responses — one row per user submission. `schema_snapshot` is
// frozen at write time so editing the parent questionnaire's schema never
// retroactively changes how an existing response renders.
// onDelete: "restrict" on the FK prevents accidental hard deletes while
// responses exist — users soft-delete the questionnaire instead.
export const questionnaireResponses = pgTable(
  "questionnaire_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionnaire_id: uuid("questionnaire_id")
      .notNull()
      .references(() => questionnaires.id, { onDelete: "restrict" }),
    slug: varchar("slug", { length: 64 }).notNull(),
    app_id: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    session_id: uuid("session_id"),
    user_id: varchar("user_id", { length: 255 }),
    answers: jsonb("answers").notNull(),
    // Captured at completion (submitted_at flips null → non-null). Drafts have
    // no snapshot — they render against the live questionnaires.schema so that
    // mid-draft schema edits flow through transparently.
    schema_snapshot: jsonb("schema_snapshot"),
    // null while the user is mid-flow; set to now() the first time the SDK
    // calls with is_complete=true. Drives the team notification (one ping per
    // submission, computed via SQL RETURNING) and gates analytics/filters that
    // explicitly want "completed only".
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    // Default stays "new" (matches every pre-refactor row) — the route handler
    // sets status explicitly on every INSERT/UPDATE (`draft` for partial saves,
    // `new` on the submission flip), so the default is just a fallback for
    // direct SQL inserts. Changing the default would also force a same-tx use
    // of the new enum value in the migration, which Postgres refuses.
    status: questionnaireResponseStatusEnum("status").notNull().default("new"),
    is_dev: boolean("is_dev").notNull().default(false),
    environment: environmentEnum("environment"),
    os_version: varchar("os_version", { length: 50 }),
    app_version: varchar("app_version", { length: 50 }),
    sdk_name: varchar("sdk_name", { length: 50 }),
    sdk_version: varchar("sdk_version", { length: 50 }),
    device_model: varchar("device_model", { length: 100 }),
    country_code: varchar("country_code", { length: 2 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Partial unique index drives the race-safe ON CONFLICT DO NOTHING during
    // ingest. One non-deleted response per (project, slug, user) — when user is
    // present. Anonymous (NULL user_id) responses are not deduped here.
    uniqueIndex("questionnaire_responses_one_per_user_idx")
      .on(table.project_id, table.slug, table.user_id)
      .where(sql`${table.deleted_at} IS NULL AND ${table.user_id} IS NOT NULL`),
    index("questionnaire_responses_project_status_idx").on(table.project_id, table.status),
    index("questionnaire_responses_project_created_at_idx").on(table.project_id, table.created_at),
    index("questionnaire_responses_questionnaire_created_at_idx").on(
      table.questionnaire_id,
      table.created_at
    ),
    index("questionnaire_responses_app_status_idx").on(table.app_id, table.status),
    index("questionnaire_responses_session_id_idx").on(table.session_id),
    index("questionnaire_responses_user_id_idx").on(table.user_id),
  ]
);

// Questionnaire response comments — team discussion thread per response.
// Mirrors feedback_comments shape and edit/delete semantics exactly.
export const questionnaireResponseComments = pgTable(
  "questionnaire_response_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionnaire_response_id: uuid("questionnaire_response_id")
      .notNull()
      .references(() => questionnaireResponses.id, { onDelete: "cascade" }),
    author_type: varchar("author_type", { length: 10 }).notNull(),
    author_id: uuid("author_id").notNull(),
    author_name: varchar("author_name", { length: 255 }).notNull(),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("questionnaire_response_comments_response_created_at_idx").on(
      table.questionnaire_response_id,
      table.created_at
    ),
    index("questionnaire_response_comments_author_id_idx").on(table.author_id),
  ]
);

// Notifications — per-user inbox row, the durable record of a user-facing event.
// Channel-agnostic: in-app rendering reads this directly; email is a separate
// delivery row. type/channel are varchar (not enum) to keep the schema open as new
// notification types and channels are added — runtime validation lives in
// @pubky-pulse/shared NOTIFICATION_TYPES + NOTIFICATION_CHANNELS.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    team_id: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    read_at: timestamp("read_at", { withTimezone: true }),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_user_created_at_idx")
      .on(table.user_id, table.created_at)
      .where(sql`${table.deleted_at} IS NULL`),
    index("notifications_user_unread_idx")
      .on(table.user_id)
      .where(sql`${table.read_at} IS NULL AND ${table.deleted_at} IS NULL`),
    index("notifications_team_id_idx").on(table.team_id),
    index("notifications_type_created_at_idx").on(table.type, table.created_at),
  ]
);

// Notification Deliveries — per-channel attempt log. One row per (notification, channel)
// queued or attempted. Decoupled from `notifications` so retrying a failed email doesn't
// rewrite the inbox row, and so we can answer "did the email send?" without grep-ing a
// status grab-bag jsonb. The `in_app` channel row is created+marked sent synchronously
// alongside the inbox row insert.
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notification_id: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempt_metadata: jsonb("attempt_metadata").$type<Record<string, unknown>>(),
    error: text("error"),
    attempted_at: timestamp("attempted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notification_deliveries_notification_id_idx").on(table.notification_id),
    index("notification_deliveries_pending_idx")
      .on(table.id)
      .where(sql`${table.status} = 'pending'`),
  ]
);

// Audit trail for event data deletions (retention cleanup + soft-delete cleanup)
export const eventDeletions = pgTable(
  "event_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    project_id: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    table_name: varchar("table_name", { length: 50 }).notNull(),
    reason: varchar("reason", { length: 50 }).notNull(),
    cutoff_date: timestamp("cutoff_date", { withTimezone: true }).notNull(),
    deleted_count: integer("deleted_count").notNull(),
    executed_at: timestamp("executed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("event_deletions_project_executed_at_idx").on(table.project_id, table.executed_at),
  ]
);

// ─── Time-series aggregation rollups ──────────────────────────────────────────
//
// Daily + hourly count rollups for events / metric_events / funnel_events /
// questionnaire_responses. Drive subtle sparkline charts on dashboard cards
// today; designed to also power future arbitrary-range analytics pages
// ("events for the past year per project / app").
//
// Conventions shared across all 8 tables:
//
//   - `team_id` denormalized for fast team-scoped reads.
//   - `app_id` nullable: a row with `app_id IS NULL` is a project-level rollup
//     summing every app's contribution for that (project, is_dev, bucket, dim).
//     Both per-app rows AND the rollup row are written by the aggregation job
//     so reads hit a single row, never a SUM. The unique index uses
//     `nullsNotDistinct()` so PG treats two NULL app_ids as equal for the
//     conflict target — one rollup row per (project, is_dev, bucket, dim).
//   - `is_dev` split by row, never aggregated together. `data_mode=all` sums
//     `is_dev = true` + `is_dev = false` at query time.
//   - Anonymous count data, **no PII**: only counts and distincts, no user IDs.
//     Explicitly excluded from retention pruning and soft-delete cleanup —
//     these rollups outlive the raw events they were computed from so
//     sparklines and year-views don't go blank when raw retention kicks in.
//   - Non-additive distincts: `unique_users` / `unique_sessions` are per-bucket
//     COUNT(DISTINCT …) and not summable across buckets (e.g. summing 7 daily
//     uniques does not yield true weekly uniques). The dashboard cards plot
//     `event_count` for the line; multi-bucket distinct queries must fall back
//     to raw event tables.
//
// Populated by the `stats_aggregate_daily` (00:30 UTC) and
// `stats_aggregate_hourly` (every hour at :05) jobs, each re-aggregating the
// trailing 3 buckets to absorb late-arriving SDK events. Backfill mode accepts
// an arbitrary `start`/`end` range.

export const eventsDaily = pgTable(
  "events_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    event_count: integer("event_count").notNull().default(0),
    unique_users: integer("unique_users").notNull().default(0),
    unique_sessions: integer("unique_sessions").notNull().default(0),
    error_count: integer("error_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("events_daily_project_dev_day_rollup_idx")
      .on(table.project_id, table.is_dev, table.day)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("events_daily_project_app_dev_day_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.day)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("events_daily_team_day_idx").on(table.team_id, table.day),
    index("events_daily_project_day_idx").on(table.project_id, table.day),
  ]
);

export const eventsHourly = pgTable(
  "events_hourly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    event_count: integer("event_count").notNull().default(0),
    unique_users: integer("unique_users").notNull().default(0),
    unique_sessions: integer("unique_sessions").notNull().default(0),
    error_count: integer("error_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("events_hourly_project_dev_hour_rollup_idx")
      .on(table.project_id, table.is_dev, table.hour)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("events_hourly_project_app_dev_hour_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.hour)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("events_hourly_team_hour_idx").on(table.team_id, table.hour),
    index("events_hourly_project_hour_idx").on(table.project_id, table.hour),
  ]
);

export const metricEventsDaily = pgTable(
  "metric_events_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    metric_slug: varchar("metric_slug", { length: 255 }).notNull(),
    phase: metricPhaseEnum("phase").notNull(),
    count: integer("count").notNull().default(0),
    // SUM(duration_ms) only populated for `complete` phase rows (others have no
    // duration). NULL when no row in the bucket had a duration.
    sum_duration_ms: bigint("sum_duration_ms", { mode: "number" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("metric_events_daily_project_dev_day_slug_phase_rollup_idx")
      .on(table.project_id, table.is_dev, table.day, table.metric_slug, table.phase)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("metric_events_daily_project_app_dev_day_slug_phase_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.day, table.metric_slug, table.phase)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("metric_events_daily_team_day_idx").on(table.team_id, table.day),
    index("metric_events_daily_project_slug_day_idx").on(table.project_id, table.metric_slug, table.day),
  ]
);

export const metricEventsHourly = pgTable(
  "metric_events_hourly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    metric_slug: varchar("metric_slug", { length: 255 }).notNull(),
    phase: metricPhaseEnum("phase").notNull(),
    count: integer("count").notNull().default(0),
    sum_duration_ms: bigint("sum_duration_ms", { mode: "number" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("metric_events_hourly_project_dev_hour_slug_phase_rollup_idx")
      .on(table.project_id, table.is_dev, table.hour, table.metric_slug, table.phase)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("metric_events_hourly_project_app_dev_hour_slug_phase_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.hour, table.metric_slug, table.phase)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("metric_events_hourly_team_hour_idx").on(table.team_id, table.hour),
    index("metric_events_hourly_project_slug_hour_idx").on(table.project_id, table.metric_slug, table.hour),
  ]
);

export const funnelEventsDaily = pgTable(
  "funnel_events_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    step_name: varchar("step_name", { length: 255 }).notNull(),
    count: integer("count").notNull().default(0),
    unique_users: integer("unique_users").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("funnel_events_daily_project_dev_day_step_rollup_idx")
      .on(table.project_id, table.is_dev, table.day, table.step_name)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("funnel_events_daily_project_app_dev_day_step_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.day, table.step_name)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("funnel_events_daily_team_day_idx").on(table.team_id, table.day),
    index("funnel_events_daily_project_step_day_idx").on(table.project_id, table.step_name, table.day),
  ]
);

export const funnelEventsHourly = pgTable(
  "funnel_events_hourly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    is_dev: boolean("is_dev").notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    step_name: varchar("step_name", { length: 255 }).notNull(),
    count: integer("count").notNull().default(0),
    unique_users: integer("unique_users").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("funnel_events_hourly_project_dev_hour_step_rollup_idx")
      .on(table.project_id, table.is_dev, table.hour, table.step_name)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("funnel_events_hourly_project_app_dev_hour_step_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.hour, table.step_name)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("funnel_events_hourly_team_hour_idx").on(table.team_id, table.hour),
    index("funnel_events_hourly_project_step_hour_idx").on(table.project_id, table.step_name, table.hour),
  ]
);

// One row per (project, app, is_dev, bucket, questionnaire). `submitted_count`
// flips for the bucket the response was completed in (uses submitted_at, not
// created_at — drafts that complete days later count on the day they were
// submitted). `draft_count` counts responses created in the bucket that are
// still in draft state, so the same response can't double-count between draft
// and submitted columns within a bucket. Card sparkline sums across all
// questionnaire_ids; per-questionnaire pages filter to one.
export const questionnaireResponsesDaily = pgTable(
  "questionnaire_responses_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    questionnaire_id: uuid("questionnaire_id").notNull(),
    is_dev: boolean("is_dev").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    submitted_count: integer("submitted_count").notNull().default(0),
    draft_count: integer("draft_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("questionnaire_responses_daily_project_dev_day_q_rollup_idx")
      .on(table.project_id, table.is_dev, table.day, table.questionnaire_id)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("questionnaire_responses_daily_project_app_dev_day_q_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.day, table.questionnaire_id)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("questionnaire_responses_daily_team_day_idx").on(table.team_id, table.day),
    index("questionnaire_responses_daily_project_q_day_idx").on(
      table.project_id,
      table.questionnaire_id,
      table.day,
    ),
  ]
);

export const questionnaireResponsesHourly = pgTable(
  "questionnaire_responses_hourly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    team_id: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    app_id: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    questionnaire_id: uuid("questionnaire_id").notNull(),
    is_dev: boolean("is_dev").notNull(),
    hour: timestamp("hour", { withTimezone: true }).notNull(),
    submitted_count: integer("submitted_count").notNull().default(0),
    draft_count: integer("draft_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("questionnaire_responses_hourly_project_dev_hour_q_rollup_idx")
      .on(table.project_id, table.is_dev, table.hour, table.questionnaire_id)
      .where(sql`${table.app_id} IS NULL`),
    uniqueIndex("questionnaire_responses_hourly_project_app_dev_hour_q_idx")
      .on(table.project_id, table.app_id, table.is_dev, table.hour, table.questionnaire_id)
      .where(sql`${table.app_id} IS NOT NULL`),
    index("questionnaire_responses_hourly_team_hour_idx").on(table.team_id, table.hour),
    index("questionnaire_responses_hourly_project_q_hour_idx").on(
      table.project_id,
      table.questionnaire_id,
      table.hour,
    ),
  ]
);
