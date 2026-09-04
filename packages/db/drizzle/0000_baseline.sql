CREATE TYPE "public"."api_key_type" AS ENUM('client', 'agent', 'server', 'import');--> statement-breakpoint
CREATE TYPE "public"."app_platform" AS ENUM('apple', 'android', 'web', 'backend');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'api_key', 'system');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('ios', 'ipados', 'macos', 'watchos', 'android', 'web', 'backend');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'in_review', 'addressed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."issue_alert_frequency" AS ENUM('none', 'hourly', '6_hourly', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('new', 'in_progress', 'resolved', 'silenced', 'regressed', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'debug', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."metric_phase" AS ENUM('start', 'complete', 'fail', 'cancel', 'record');--> statement-breakpoint
CREATE TYPE "public"."questionnaire_response_status" AS ENUM('draft', 'new', 'in_review', 'addressed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"key_type" "api_key_type" NOT NULL,
	"app_id" uuid,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_by" uuid NOT NULL,
	"permissions" jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_user_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_user_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"is_anonymous" boolean NOT NULL,
	"claimed_from" jsonb,
	"properties" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_country_code" varchar(2),
	"last_app_version" varchar(50),
	"last_sdk_name" varchar(50),
	"last_sdk_version" varchar(50),
	"last_locale" varchar(20),
	"last_preferred_language" varchar(35),
	"is_dev" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"platform" "app_platform" NOT NULL,
	"bundle_id" varchar(255),
	"latest_app_version" varchar(50),
	"latest_app_version_updated_at" timestamp with time zone,
	"supported_languages" text[],
	"supported_languages_source" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"action" "audit_action" NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"event_client_id" uuid,
	"event_id" uuid,
	"issue_id" uuid,
	"user_id" varchar(255),
	"original_filename" varchar(512) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_path" text NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"table_name" varchar(50) NOT NULL,
	"reason" varchar(50) NOT NULL,
	"cutoff_date" timestamp with time zone NOT NULL,
	"deleted_count" integer NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid DEFAULT gen_random_uuid(),
	"app_id" uuid NOT NULL,
	"client_event_id" uuid,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"api_key_id" uuid,
	"level" "log_level" NOT NULL,
	"source_module" text,
	"message" text NOT NULL,
	"screen_name" varchar(255),
	"custom_attributes" jsonb,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"device_model" varchar(100),
	"build_number" varchar(50),
	"locale" varchar(20),
	"preferred_language" varchar(35),
	"country_code" varchar(2),
	"is_dev" boolean DEFAULT false NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"unique_sessions" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"unique_sessions" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" varchar(255),
	"message" text NOT NULL,
	"submitter_name" varchar(255),
	"submitter_email" varchar(320),
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"device_model" varchar(100),
	"country_code" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "funnel_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "funnel_events" (
	"id" uuid DEFAULT gen_random_uuid(),
	"app_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"api_key_id" uuid,
	"step_name" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"screen_name" varchar(255),
	"custom_attributes" jsonb,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"device_model" varchar(100),
	"build_number" varchar(50),
	"country_code" varchar(2),
	"is_dev" boolean DEFAULT false NOT NULL,
	"client_event_id" uuid,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_events_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_events_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"unique_users" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issue_fingerprints" (
	"fingerprint" varchar(64) NOT NULL,
	"app_id" uuid NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"issue_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"environment" "environment",
	"event_id" uuid,
	"country_code" varchar(2),
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "issue_status" DEFAULT 'new' NOT NULL,
	"title" text NOT NULL,
	"source_module" text,
	"is_dev" boolean DEFAULT false NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"unique_user_count" integer DEFAULT 0 NOT NULL,
	"resolved_at_version" varchar(50),
	"first_seen_app_version" varchar(50),
	"last_seen_app_version" varchar(50),
	"first_seen_sdk_version" varchar(50),
	"last_seen_sdk_version" varchar(50),
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_notified_at" timestamp with time zone,
	"snoozed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(100) NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"team_id" uuid,
	"project_id" uuid,
	"triggered_by" varchar(100) NOT NULL,
	"params" jsonb,
	"progress" jsonb,
	"result" jsonb,
	"error" text,
	"notify" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"documentation" text,
	"schema_definition" jsonb,
	"aggregation_rules" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_events" (
	"id" uuid DEFAULT gen_random_uuid(),
	"app_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" varchar(255),
	"api_key_id" uuid,
	"metric_slug" varchar(255) NOT NULL,
	"phase" "metric_phase" NOT NULL,
	"tracking_id" uuid,
	"duration_ms" integer,
	"error" text,
	"attributes" jsonb,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"device_model" varchar(100),
	"build_number" varchar(50),
	"country_code" varchar(2),
	"is_dev" boolean DEFAULT false NOT NULL,
	"client_event_id" uuid,
	"timestamp" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_events_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"metric_slug" varchar(255) NOT NULL,
	"phase" "metric_phase" NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"sum_duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_events_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"metric_slug" varchar(255) NOT NULL,
	"phase" "metric_phase" NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"sum_duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_metadata" jsonb,
	"error" text,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_id" uuid,
	"type" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_owners" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"color" varchar(7) NOT NULL,
	"retention_days_events" integer,
	"retention_days_metrics" integer,
	"retention_days_funnels" integer,
	"attachment_user_quota_bytes" bigint,
	"attachment_project_quota_bytes" bigint,
	"issue_alert_frequency" "issue_alert_frequency" DEFAULT 'daily',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questionnaire_response_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_response_id" uuid NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"author_id" uuid NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"slug" varchar(64) NOT NULL,
	"app_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" varchar(255),
	"answers" jsonb NOT NULL,
	"schema_snapshot" jsonb,
	"submitted_at" timestamp with time zone,
	"status" "questionnaire_response_status" DEFAULT 'new' NOT NULL,
	"is_dev" boolean DEFAULT false NOT NULL,
	"environment" "environment",
	"os_version" varchar(50),
	"app_version" varchar(50),
	"sdk_name" varchar(50),
	"sdk_version" varchar(50),
	"device_model" varchar(100),
	"country_code" varchar(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"questionnaire_id" uuid NOT NULL,
	"is_dev" boolean NOT NULL,
	"day" date NOT NULL,
	"submitted_count" integer DEFAULT 0 NOT NULL,
	"draft_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"questionnaire_id" uuid NOT NULL,
	"is_dev" boolean NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"submitted_count" integer DEFAULT 0 NOT NULL,
	"draft_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"app_id" uuid,
	"slug" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"schema" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_apps" ADD CONSTRAINT "app_user_apps_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_apps" ADD CONSTRAINT "app_user_apps_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deletions" ADD CONSTRAINT "event_deletions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_daily" ADD CONSTRAINT "events_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_daily" ADD CONSTRAINT "events_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_daily" ADD CONSTRAINT "events_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_hourly" ADD CONSTRAINT "events_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_hourly" ADD CONSTRAINT "events_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_hourly" ADD CONSTRAINT "events_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_definitions" ADD CONSTRAINT "funnel_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_daily" ADD CONSTRAINT "funnel_events_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_daily" ADD CONSTRAINT "funnel_events_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_daily" ADD CONSTRAINT "funnel_events_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_hourly" ADD CONSTRAINT "funnel_events_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_hourly" ADD CONSTRAINT "funnel_events_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events_hourly" ADD CONSTRAINT "funnel_events_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_fingerprints" ADD CONSTRAINT "issue_fingerprints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_fingerprints" ADD CONSTRAINT "issue_fingerprints_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_occurrences" ADD CONSTRAINT "issue_occurrences_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_daily" ADD CONSTRAINT "metric_events_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_daily" ADD CONSTRAINT "metric_events_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_daily" ADD CONSTRAINT "metric_events_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_hourly" ADD CONSTRAINT "metric_events_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_hourly" ADD CONSTRAINT "metric_events_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events_hourly" ADD CONSTRAINT "metric_events_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_owners" ADD CONSTRAINT "project_owners_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_owners" ADD CONSTRAINT "project_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_response_comments" ADD CONSTRAINT "questionnaire_response_comments_questionnaire_response_id_questionnaire_responses_id_fk" FOREIGN KEY ("questionnaire_response_id") REFERENCES "public"."questionnaire_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_questionnaire_id_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."questionnaires"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_daily" ADD CONSTRAINT "questionnaire_responses_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_daily" ADD CONSTRAINT "questionnaire_responses_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_daily" ADD CONSTRAINT "questionnaire_responses_daily_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_hourly" ADD CONSTRAINT "questionnaire_responses_hourly_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_hourly" ADD CONSTRAINT "questionnaire_responses_hourly_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses_hourly" ADD CONSTRAINT "questionnaire_responses_hourly_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_secret_idx" ON "api_keys" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "api_keys_team_id_idx" ON "api_keys" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "api_keys_app_id_idx" ON "api_keys" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_apps_user_app_idx" ON "app_user_apps" USING btree ("app_user_id","app_id");--> statement-breakpoint
CREATE INDEX "app_user_apps_app_id_idx" ON "app_user_apps" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_project_user_idx" ON "app_users" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "app_users_project_anonymous_idx" ON "app_users" USING btree ("project_id","is_anonymous");--> statement-breakpoint
CREATE INDEX "app_users_project_last_seen_idx" ON "app_users" USING btree ("project_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "app_users_project_is_dev_idx" ON "app_users" USING btree ("project_id","is_dev");--> statement-breakpoint
CREATE INDEX "apps_team_id_idx" ON "apps" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "apps_project_id_idx" ON "apps" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_logs_team_timestamp_idx" ON "audit_logs" USING btree ("team_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "email_verification_codes_email_idx" ON "email_verification_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "event_attachments_project_created_at_idx" ON "event_attachments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "event_attachments_app_event_client_id_idx" ON "event_attachments" USING btree ("app_id","event_client_id");--> statement-breakpoint
CREATE INDEX "event_attachments_event_id_idx" ON "event_attachments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_attachments_issue_id_idx" ON "event_attachments" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "event_attachments_project_deleted_at_idx" ON "event_attachments" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "event_attachments_project_user_idx" ON "event_attachments" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "event_deletions_project_executed_at_idx" ON "event_deletions" USING btree ("project_id","executed_at");--> statement-breakpoint
CREATE INDEX "events_app_timestamp_idx" ON "events" USING btree ("app_id","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_level_timestamp_idx" ON "events" USING btree ("app_id","level","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_user_timestamp_idx" ON "events" USING btree ("app_id","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_screen_name_timestamp_idx" ON "events" USING btree ("app_id","screen_name","timestamp");--> statement-breakpoint
CREATE INDEX "events_client_event_id_idx" ON "events" USING btree ("app_id","client_event_id");--> statement-breakpoint
CREATE INDEX "events_app_session_timestamp_idx" ON "events" USING btree ("app_id","session_id","timestamp");--> statement-breakpoint
CREATE INDEX "events_app_dev_timestamp_idx" ON "events" USING btree ("app_id","is_dev","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "events_daily_project_dev_day_rollup_idx" ON "events_daily" USING btree ("project_id","is_dev","day") WHERE "events_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_daily_project_app_dev_day_idx" ON "events_daily" USING btree ("project_id","app_id","is_dev","day") WHERE "events_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_daily_team_day_idx" ON "events_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "events_daily_project_day_idx" ON "events_daily" USING btree ("project_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "events_hourly_project_dev_hour_rollup_idx" ON "events_hourly" USING btree ("project_id","is_dev","hour") WHERE "events_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_hourly_project_app_dev_hour_idx" ON "events_hourly" USING btree ("project_id","app_id","is_dev","hour") WHERE "events_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_hourly_team_hour_idx" ON "events_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "events_hourly_project_hour_idx" ON "events_hourly" USING btree ("project_id","hour");--> statement-breakpoint
CREATE INDEX "feedback_project_status_idx" ON "feedback" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "feedback_project_created_at_idx" ON "feedback" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_app_status_idx" ON "feedback" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "feedback_session_id_idx" ON "feedback" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "feedback_user_id_idx" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feedback_comments_feedback_created_at_idx" ON "feedback_comments" USING btree ("feedback_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_comments_author_id_idx" ON "feedback_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "funnel_definitions_project_id_idx" ON "funnel_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_definitions_project_slug_idx" ON "funnel_definitions" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "funnel_events_app_step_timestamp_idx" ON "funnel_events" USING btree ("app_id","step_name","timestamp");--> statement-breakpoint
CREATE INDEX "funnel_events_app_user_timestamp_idx" ON "funnel_events" USING btree ("app_id","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "funnel_events_app_step_user_timestamp_idx" ON "funnel_events" USING btree ("app_id","step_name","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "funnel_events_app_client_event_id_idx" ON "funnel_events" USING btree ("app_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_daily_project_dev_day_step_rollup_idx" ON "funnel_events_daily" USING btree ("project_id","is_dev","day","step_name") WHERE "funnel_events_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_daily_project_app_dev_day_step_idx" ON "funnel_events_daily" USING btree ("project_id","app_id","is_dev","day","step_name") WHERE "funnel_events_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "funnel_events_daily_team_day_idx" ON "funnel_events_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "funnel_events_daily_project_step_day_idx" ON "funnel_events_daily" USING btree ("project_id","step_name","day");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_hourly_project_dev_hour_step_rollup_idx" ON "funnel_events_hourly" USING btree ("project_id","is_dev","hour","step_name") WHERE "funnel_events_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_events_hourly_project_app_dev_hour_step_idx" ON "funnel_events_hourly" USING btree ("project_id","app_id","is_dev","hour","step_name") WHERE "funnel_events_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "funnel_events_hourly_team_hour_idx" ON "funnel_events_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "funnel_events_hourly_project_step_hour_idx" ON "funnel_events_hourly" USING btree ("project_id","step_name","hour");--> statement-breakpoint
CREATE INDEX "issue_comments_issue_created_at_idx" ON "issue_comments" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_comments_author_id_idx" ON "issue_comments" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_fingerprints_pk" ON "issue_fingerprints" USING btree ("fingerprint","app_id","is_dev");--> statement-breakpoint
CREATE INDEX "issue_fingerprints_issue_id_idx" ON "issue_fingerprints" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_occurrences_issue_session_idx" ON "issue_occurrences" USING btree ("issue_id","session_id");--> statement-breakpoint
CREATE INDEX "issue_occurrences_issue_timestamp_idx" ON "issue_occurrences" USING btree ("issue_id","timestamp");--> statement-breakpoint
CREATE INDEX "issue_occurrences_user_id_idx" ON "issue_occurrences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "issues_project_status_idx" ON "issues" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "issues_project_last_seen_idx" ON "issues" USING btree ("project_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "issues_project_unique_users_idx" ON "issues" USING btree ("project_id","unique_user_count");--> statement-breakpoint
CREATE INDEX "issues_app_status_idx" ON "issues" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "job_runs_job_type_created_at_idx" ON "job_runs" USING btree ("job_type","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_status_idx" ON "job_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_runs_team_id_created_at_idx" ON "job_runs" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_project_id_idx" ON "job_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "metric_definitions_project_id_idx" ON "metric_definitions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definitions_project_slug_idx" ON "metric_definitions" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "metric_events_app_slug_timestamp_idx" ON "metric_events" USING btree ("app_id","metric_slug","timestamp");--> statement-breakpoint
CREATE INDEX "metric_events_app_slug_phase_timestamp_idx" ON "metric_events" USING btree ("app_id","metric_slug","phase","timestamp");--> statement-breakpoint
CREATE INDEX "metric_events_app_tracking_id_idx" ON "metric_events" USING btree ("app_id","tracking_id");--> statement-breakpoint
CREATE INDEX "metric_events_app_client_event_id_idx" ON "metric_events" USING btree ("app_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_daily_project_dev_day_slug_phase_rollup_idx" ON "metric_events_daily" USING btree ("project_id","is_dev","day","metric_slug","phase") WHERE "metric_events_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_daily_project_app_dev_day_slug_phase_idx" ON "metric_events_daily" USING btree ("project_id","app_id","is_dev","day","metric_slug","phase") WHERE "metric_events_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "metric_events_daily_team_day_idx" ON "metric_events_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "metric_events_daily_project_slug_day_idx" ON "metric_events_daily" USING btree ("project_id","metric_slug","day");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_hourly_project_dev_hour_slug_phase_rollup_idx" ON "metric_events_hourly" USING btree ("project_id","is_dev","hour","metric_slug","phase") WHERE "metric_events_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_events_hourly_project_app_dev_hour_slug_phase_idx" ON "metric_events_hourly" USING btree ("project_id","app_id","is_dev","hour","metric_slug","phase") WHERE "metric_events_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "metric_events_hourly_team_hour_idx" ON "metric_events_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "metric_events_hourly_project_slug_hour_idx" ON "metric_events_hourly" USING btree ("project_id","metric_slug","hour");--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_pending_idx" ON "notification_deliveries" USING btree ("id") WHERE "notification_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_user_created_at_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL AND "notifications"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_team_id_idx" ON "notifications" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "notifications_type_created_at_idx" ON "notifications" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_owners_project_user_idx" ON "project_owners" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_owners_user_id_idx" ON "project_owners" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_team_id_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_slug_idx" ON "projects" USING btree ("team_id","slug");--> statement-breakpoint
CREATE INDEX "questionnaire_response_comments_response_created_at_idx" ON "questionnaire_response_comments" USING btree ("questionnaire_response_id","created_at");--> statement-breakpoint
CREATE INDEX "questionnaire_response_comments_author_id_idx" ON "questionnaire_response_comments" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_one_per_user_idx" ON "questionnaire_responses" USING btree ("project_id","slug","user_id") WHERE "questionnaire_responses"."deleted_at" IS NULL AND "questionnaire_responses"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "questionnaire_responses_project_status_idx" ON "questionnaire_responses" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_project_created_at_idx" ON "questionnaire_responses" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_questionnaire_created_at_idx" ON "questionnaire_responses" USING btree ("questionnaire_id","created_at");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_app_status_idx" ON "questionnaire_responses" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_session_id_idx" ON "questionnaire_responses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_user_id_idx" ON "questionnaire_responses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_daily_project_dev_day_q_rollup_idx" ON "questionnaire_responses_daily" USING btree ("project_id","is_dev","day","questionnaire_id") WHERE "questionnaire_responses_daily"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_daily_project_app_dev_day_q_idx" ON "questionnaire_responses_daily" USING btree ("project_id","app_id","is_dev","day","questionnaire_id") WHERE "questionnaire_responses_daily"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "questionnaire_responses_daily_team_day_idx" ON "questionnaire_responses_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_daily_project_q_day_idx" ON "questionnaire_responses_daily" USING btree ("project_id","questionnaire_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_hourly_project_dev_hour_q_rollup_idx" ON "questionnaire_responses_hourly" USING btree ("project_id","is_dev","hour","questionnaire_id") WHERE "questionnaire_responses_hourly"."app_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_responses_hourly_project_app_dev_hour_q_idx" ON "questionnaire_responses_hourly" USING btree ("project_id","app_id","is_dev","hour","questionnaire_id") WHERE "questionnaire_responses_hourly"."app_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "questionnaire_responses_hourly_team_hour_idx" ON "questionnaire_responses_hourly" USING btree ("team_id","hour");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_hourly_project_q_hour_idx" ON "questionnaire_responses_hourly" USING btree ("project_id","questionnaire_id","hour");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaires_project_slug_active_idx" ON "questionnaires" USING btree ("project_id","slug") WHERE "questionnaires"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "questionnaires_project_idx" ON "questionnaires" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "team_members" USING btree ("user_id");