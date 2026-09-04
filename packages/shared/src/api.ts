import type { StoredEvent, IngestRequest, IngestResponse, AppPlatform } from "./events.js";
import type { App, User, Team, Project, ApiKey, ApiKeyType, TeamRole, Permission } from "./auth.js";
import type { FunnelDefinition, FunnelStep, FunnelAnalytics, FunnelDefinitionResponse, FunnelStepAnalytics, FunnelBreakdownGroup } from "./funnels.js";
import type { MetricDefinition, MetricSchemaDefinition, MetricAggregationRules, MetricPhase, StoredMetricEvent } from "./metrics.js";
import type { AuditAction, AuditActorType, AuditResourceType } from "./audit.js";
import type { IssueAlertFrequency } from "./issues.js";

// Data mode for global development/production filtering
export const DATA_MODES = ["production", "development", "all"] as const;
export type DataMode = (typeof DATA_MODES)[number];

// Serialized response types (dates as ISO strings)
export type UserResponse = Omit<User, "created_at" | "updated_at"> & { created_at: string; updated_at: string };

// Auth
export interface SendCodeRequest {
  email: string;
}

export interface SendCodeResponse {
  message: string;
}

export interface VerifyCodeRequest {
  email: string;
  code: string;
}

export interface VerifyCodeResponse extends AuthResponse {
  is_new_user: boolean;
}

export interface AuthTeamMembership {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
  default_agent_key?: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
  teams: AuthTeamMembership[];
}

// Agent login (agent bootstrap flow — no JWT, returns an agent API key directly)
export interface AgentLoginRequest {
  email: string;
  code: string;
  team_id?: string; // required if user has multiple teams
}

export interface AgentLoginResponse {
  api_key: string;
  team: { id: string; name: string; slug: string };
  project: { id: string; name: string; slug: string } | null;
  app: { id: string; name: string; platform: string } | null;
  is_new_setup: boolean;
}

// API Keys
export interface CreateApiKeyRequest {
  name: string;
  key_type: ApiKeyType;
  app_id?: string;
  team_id?: string; // required for agent keys (no app_id to derive team from)
  permissions?: Permission[];
  expires_in_days?: number;
}

// Serialized API key (dates as ISO strings, excludes deleted_at)
// `secret` is nullable here but not on the `ApiKey` domain type: the column is
// NOT NULL in the database and always populated, and only serialization redacts
// it for callers who are not entitled to read it.
export type ApiKeyResponse = Omit<ApiKey, "created_at" | "updated_at" | "last_used_at" | "expires_at" | "deleted_at" | "secret"> & {
  secret: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  app_name?: string | null;
  created_by_email?: string | null;
};

// Audit Logs
export interface AuditLogResponse {
  id: string;
  team_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, { before?: unknown; after?: unknown }> | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface AuditLogsQueryParams {
  resource_type?: string;
  resource_id?: string;
  actor_id?: string;
  action?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditLogsResponse {
  audit_logs: AuditLogResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface CreateApiKeyResponse {
  api_key: ApiKeyResponse;
}

export interface DefaultAgentKeyResponse {
  secret: string;
  created: boolean;
}

// User profile
export interface MeResponse {
  user: UserResponse;
  teams: AuthTeamMembership[];
}

export interface UpdateMeRequest {
  name?: string;
  preferences?: Partial<import("./preferences.js").UserPreferences>;
}

export interface UpdateApiKeyRequest {
  name?: string;
  permissions?: Permission[];
}

// Single API key
export interface GetApiKeyResponse {
  api_key: ApiKeyResponse;
}

// API key listing
export interface ListApiKeysResponse {
  api_keys: ApiKeyResponse[];
}

// API key deletion
export interface DeleteApiKeyResponse {
  deleted: true;
}

// Projects
export interface CreateProjectRequest {
  team_id: string;
  name: string;
  slug: string;
  retention_days_events?: number;
  retention_days_metrics?: number;
  retention_days_funnels?: number;
}

export interface UpdateProjectRequest {
  name?: string;
  color?: string;
  retention_days_events?: number | null;
  retention_days_metrics?: number | null;
  retention_days_funnels?: number | null;
  attachment_user_quota_bytes?: number | null;
  attachment_project_quota_bytes?: number | null;
  issue_alert_frequency?: IssueAlertFrequency;
}

// Apps
export interface CreateAppRequest {
  name: string;
  platform: AppPlatform;
  bundle_id?: string;
  project_id: string;
  /** Browser origins the site may send from. `web` platform only. */
  allowed_origins?: string[];
}

export interface UpdateAppRequest {
  name?: string;
  /** Replaces the whole list. `web` platform only. */
  allowed_origins?: string[];
}

export type AppResponse = Omit<
  App,
  "created_at" | "deleted_at" | "latest_app_version_updated_at"
> & {
  created_at: string;
  client_secret: string | null;
  latest_app_version_updated_at: string | null;
};

// Project ownership. A project has one or more equal owners; every team member
// can read every project, but ordinary project-scoped writes require ownership.
export interface ProjectOwnerResponse {
  user_id: string;
  name: string;
  email: string;
}

// The caller's effective access to a project, resolved server-side. Clients must
// use this rather than inferring ownership from team role.
export type ProjectAccessLevel = "owner" | "viewer";

// Projects (serialized)
export type ProjectResponse = Omit<Project, "created_at" | "deleted_at"> & {
  created_at: string;
  effective_retention_days_events: number;
  effective_retention_days_metrics: number;
  effective_retention_days_funnels: number;
  effective_attachment_user_quota_bytes: number;
  effective_attachment_project_quota_bytes: number;
  effective_issue_alert_frequency: IssueAlertFrequency;
  owners: ProjectOwnerResponse[];
  access_level: ProjectAccessLevel;
};
export type ProjectDetailResponse = ProjectResponse & { apps: AppResponse[] };

// Events (serialized — API returns ISO strings, not Date objects)
export type StoredEventResponse = Omit<StoredEvent, "timestamp" | "received_at"> & {
  timestamp: string;
  received_at: string;
  project_id?: string;
};

// Events query
export interface EventsQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  /** Single level (`"info"`) or comma-separated list (`"info,warn,error"`). */
  level?: string;
  user_id?: string;
  session_id?: string;
  environment?: string;
  screen_name?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
  data_mode?: DataMode;
  order?: "asc" | "desc";
}

export interface EventsResponse {
  events: StoredEventResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface EventsCountQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  /** Single level (`"info"`) or comma-separated list (`"info,warn,error"`). */
  level?: string;
  user_id?: string;
  session_id?: string;
  environment?: string;
  screen_name?: string;
  since?: string;
  until?: string;
  data_mode?: DataMode;
}

export interface EventsCountResponse {
  count: number;
  unique_users: number;
  unique_sessions: number;
}

export interface CompletionsCountQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  since?: string;
  until?: string;
  data_mode?: DataMode;
}

export interface CompletionsCountResponse {
  count: number;
  started?: number;
  failed?: number;
}

// Funnels
export interface CreateFunnelRequest {
  name: string;
  slug: string;
  description?: string;
  steps: FunnelStep[];
}

export interface UpdateFunnelRequest {
  name?: string;
  description?: string;
  steps?: FunnelStep[];
}

export { FunnelDefinitionResponse };

export interface FunnelQueryParams {
  since?: string;
  until?: string;
  app_id?: string;
  app_version?: string;
  environment?: string;
  mode?: "closed" | "open";
  group_by?: "environment" | "app_version";
  data_mode?: DataMode;
}

export interface FunnelQueryResponse {
  slug: string;
  analytics: FunnelAnalytics;
}

// Teams
//
// The singleton team is read-only over the API: it is created and owned by
// server configuration, so there are no create/update/delete, role-change,
// member-removal or invitation contracts here.
export interface TeamMemberResponse {
  user_id: string;
  email: string;
  name: string;
  role: TeamRole;
  joined_at: string;
}

export interface TeamDetailResponse {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  members: TeamMemberResponse[];
}

// App Users
export interface AppUserAppInfo {
  app_id: string;
  app_name: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AppUserResponse {
  id: string;
  project_id: string;
  user_id: string;
  is_anonymous: boolean;
  claimed_from: string[] | null;
  properties: Record<string, string> | null;
  apps: AppUserAppInfo[];
  first_seen_at: string;
  last_seen_at: string;
  last_country_code: string | null;
  last_app_version: string | null;
  last_sdk_name: string | null;
  last_sdk_version: string | null;
  /** Shown locale (Locale.current), e.g. "en_US". Backfilled from events. */
  last_locale: string | null;
  /** Wanted language (Locale.preferredLanguages.first), e.g. "fr-CA". Null until SDK upgrade. */
  last_preferred_language: string | null;
  /** Dev vs prod, derived from client events (last-write-wins). Backend events never set it. */
  is_dev: boolean;
}

export interface AppUsersResponse {
  users: AppUserResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface AppUsersQueryParams {
  search?: string;
  is_anonymous?: string;
  /** Filter by dev vs prod (default production). Filters on app_users.is_dev. */
  data_mode?: DataMode;
  /** Sort order. "last_seen" (default) sorts by last_seen_at desc; "first_seen" sorts by first_seen_at desc. */
  sort?: "last_seen" | "first_seen";
  cursor?: string;
  limit?: number;
}

export interface TeamAppUsersQueryParams extends AppUsersQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  since?: string;
  until?: string;
}

// Locale demand / localization gap
/** Base language for an app: shipping "fr" clears demand for "fr", "fr-FR", "fr-CA". */
export function baseLanguage(tag: string): string {
  return tag.split(/[-_]/)[0].toLowerCase();
}

export interface LocaleDemandRow {
  /** Full preferred-language tag as reported, e.g. "fr-FR", "fr", "pt-BR". */
  locale: string;
  /** Lowercased base language, e.g. "fr". */
  base_language: string;
  user_count: number;
  /**
   * Whether the app already ships this base language. Null when not computable
   * (multi-app/project scope, or no supported_languages configured) — render
   * demand without a gap badge.
   */
  shipped: boolean | null;
}

export interface CountryDemandRow {
  country_code: string;
  user_count: number;
}

export interface UserLocalesResponse {
  by_locale: LocaleDemandRow[];
  by_country: CountryDemandRow[];
  /** Union of supported languages across in-scope apps; null when unknown. */
  supported_languages: string[] | null;
  /** Users with a non-null preferred language (the demand-signal denominator). */
  users_with_preferred_language: number;
  total_users: number;
}

// User Properties
export interface SetUserPropertiesRequest {
  user_id: string;
  properties: Record<string, string>;
}

export interface SetUserPropertiesResponse {
  updated: true;
  properties: Record<string, string>;
}

// Metrics
export interface CreateMetricDefinitionRequest {
  name: string;
  slug: string;
  description?: string;
  documentation?: string;
  schema_definition?: MetricSchemaDefinition;
  aggregation_rules?: MetricAggregationRules;
}

export interface UpdateMetricDefinitionRequest {
  name?: string;
  description?: string;
  documentation?: string;
  schema_definition?: MetricSchemaDefinition;
  aggregation_rules?: MetricAggregationRules;
}

export type MetricDefinitionResponse = Omit<MetricDefinition, "created_at" | "updated_at" | "deleted_at"> & {
  created_at: string;
  updated_at: string;
};

/**
 * Team-scoped list response for `GET /v1/metrics?team_id=…`. Re-uses
 * `MetricDefinitionResponse`; `project_id` is already on every row so the
 * dashboard can bucket by project without a new wire type.
 */
export interface TeamMetricListResponse {
  metrics: MetricDefinitionResponse[];
}

export interface MetricQueryParams {
  since?: string;
  until?: string;
  app_id?: string;
  app_version?: string;
  device_model?: string;
  os_version?: string;
  user_id?: string;
  environment?: string;
  group_by?: string; // "app_id" | "app_version" | "device_model" | "os_version" | "environment" | "time:hour" | "time:day" | "time:week"
  data_mode?: DataMode;
}

export interface MetricAggregationResult {
  total_count: number;
  start_count: number;
  complete_count: number;
  fail_count: number;
  cancel_count: number;
  record_count: number;
  success_rate: number | null;
  duration_avg_ms: number | null;
  duration_p50_ms: number | null;
  duration_p95_ms: number | null;
  duration_p99_ms: number | null;
  unique_users: number;
  error_breakdown: Array<{ error: string; count: number }>;
  groups?: Array<{
    key: string;
    value: string;
    total_count: number;
    complete_count: number;
    fail_count: number;
    success_rate: number | null;
    duration_avg_ms: number | null;
  }>;
}

export interface MetricQueryResponse {
  slug: string;
  aggregation: MetricAggregationResult;
}

export interface MetricStatsEntry {
  slug: string;
  complete_count: number;
  fail_count: number;
  success_rate: number | null;
}

export interface MetricStatsParams {
  since?: string;
  until?: string;
  data_mode?: DataMode;
}

export interface MetricStatsResponse {
  stats: MetricStatsEntry[];
}

/**
 * Team-scoped stats entry — adds `project_id` because slugs are only unique
 * *within* a project. The dashboard keys its stats map on `${project_id}:${slug}`
 * in all-projects mode to avoid cross-project slug collisions.
 */
export interface TeamMetricStatsEntry extends MetricStatsEntry {
  project_id: string;
}

export interface TeamMetricStatsResponse {
  stats: TeamMetricStatsEntry[];
}

export type StoredMetricEventResponse = Omit<StoredMetricEvent, "timestamp" | "received_at"> & {
  timestamp: string;
  received_at: string;
};

export interface MetricEventsResponse {
  events: StoredMetricEventResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface MetricEventsQueryParams {
  phase?: MetricPhase;
  tracking_id?: string;
  user_id?: string;
  environment?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
  data_mode?: DataMode;
}

// Notifications
export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown>;
  team_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsListResponse {
  notifications: NotificationResponse[];
  cursor: string | null;
  has_more: boolean;
}

export interface NotificationsUnreadCountResponse {
  count: number;
}

export interface NotificationsListQueryParams {
  read_state?: "unread" | "read" | "all";
  type?: string;
  cursor?: string;
  limit?: number;
}

export interface UpdateNotificationRequest {
  read?: boolean;
}

export interface MarkAllReadRequest {
  type?: string;
}

// ─── Stats aggregations (daily/hourly rollups) ────────────────────────────────
//
// Powers the subtle sparkline charts on dashboard cards today and arbitrary
// time-range analytics queries tomorrow. Backed by 8 pre-aggregated tables:
// {events,metric_events,funnel_events,questionnaire_responses}_{daily,hourly}.
// See apps/web/content/docs/concepts/aggregations.mdx.

export const STATS_KINDS = [
  "events",
  "users",
  "sessions",
  "metric_completions",
  "funnel_completions",
  "questionnaire_responses",
] as const;
export type StatsKind = (typeof STATS_KINDS)[number];

export const STATS_GRAINS = ["daily", "hourly"] as const;
export type StatsGrain = (typeof STATS_GRAINS)[number];

/** Caps on the trailing-window size for stats queries — keeps response payloads small. */
export const STATS_MAX_WINDOW_DAYS = 365;
export const STATS_MAX_WINDOW_HOURS = 24 * 90;

export interface StatsBucketedQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  /** For grain=daily: trailing window in UTC days. Ignored if from/to set. */
  days?: number;
  /** For grain=hourly: trailing window in UTC hours. Ignored if from/to set. */
  hours?: number;
  /**
   * Explicit start ISO 8601 (timestamp for hourly, YYYY-MM-DD for daily). Both
   * `from` and `to` must be set together; otherwise the trailing window applies.
   */
  from?: string;
  /** Explicit end. Inclusive at the bucket level. */
  to?: string;
  /**
   * When true (default), drops the in-progress UTC bucket so a partial day or
   * hour doesn't render as a misleading dip. Set explicitly to "false" to
   * include the current bucket.
   */
  excluding_current?: boolean;
  data_mode?: DataMode;
  /** For metric_completions / questionnaire_responses kinds — narrow to one. */
  slug?: string;
}

export interface StatsBucketedPoint {
  /** YYYY-MM-DD for daily, ISO 8601 hour for hourly. */
  bucket: string;
  value: number;
}

export interface StatsBucketedResponse {
  kind: StatsKind;
  grain: StatsGrain;
  /** ISO start of first bucket (inclusive). */
  from: string;
  /** ISO start of last bucket (inclusive). */
  to: string;
  data: StatsBucketedPoint[];
}

export interface MarkAllReadResponse {
  marked: number;
}

// Re-export for convenience
export type {
  StoredEvent,
  IngestRequest,
  IngestResponse,
  AppPlatform,
  App,
  User,
  Team,
  Project,
  ApiKey,
  TeamRole,
  Permission,
  FunnelDefinition,
  FunnelStep,
  FunnelAnalytics,
  FunnelStepAnalytics,
  FunnelBreakdownGroup,
  MetricDefinition,
  MetricPhase,
  StoredMetricEvent,
};
