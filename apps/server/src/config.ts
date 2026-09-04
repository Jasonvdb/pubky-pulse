import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { parseIdentityConfig, type IdentityConfig } from "@pubky-pulse/shared";

dotenvConfig({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

const isProduction = process.env.NODE_ENV === "production";

function resolveAttachmentsSigningSecret(): string {
  const explicit = process.env.PULSE_ATTACHMENTS_SIGNING_SECRET;
  if (explicit) return explicit;
  if (isProduction) {
    throw new Error(
      "PULSE_ATTACHMENTS_SIGNING_SECRET must be set in production. " +
        "Generate with `openssl rand -hex 32` and add it to your environment " +
        "(pm2 ecosystem config or systemd unit). It must NOT be the same as JWT_SECRET."
    );
  }
  return process.env.JWT_SECRET || "dev-secret-change-me";
}

/**
 * Identity configuration is required in every environment, including tests and
 * local development: there is no default company domain, team, or owner. An
 * invalid or missing value fails startup here, before any route can accept a
 * request against a half-configured access model.
 *
 * It takes the environment as an argument rather than reading `process.env`
 * itself so this exact wiring — parse, then throw with the offending variable
 * named — is testable from an explicit record. Testing it by re-importing the
 * module would not work: the `dotenvConfig` call above loads the repo-root
 * `.env`, so a developer's local file could quietly supply a variable the test
 * meant to delete, and the case would pass in CI while failing locally.
 */
export function resolveIdentityConfig(env: NodeJS.ProcessEnv): IdentityConfig {
  const result = parseIdentityConfig({
    PULSE_ALLOWED_EMAIL_DOMAINS: env.PULSE_ALLOWED_EMAIL_DOMAINS,
    PULSE_DEFAULT_TEAM_NAME: env.PULSE_DEFAULT_TEAM_NAME,
    PULSE_DEFAULT_TEAM_SLUG: env.PULSE_DEFAULT_TEAM_SLUG,
    PULSE_TEAM_OWNER_EMAIL: env.PULSE_TEAM_OWNER_EMAIL,
  });
  if (!result.ok) {
    throw new Error(
      `Invalid identity configuration: ${result.error}. ` +
        "PULSE_ALLOWED_EMAIL_DOMAINS, PULSE_DEFAULT_TEAM_NAME, PULSE_DEFAULT_TEAM_SLUG " +
        "and PULSE_TEAM_OWNER_EMAIL must all be set — see .env.example."
    );
  }
  return result.value;
}

const identity = resolveIdentityConfig(process.env);

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL || "postgresql://localhost:5432/pubky_pulse",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  maxDatabaseSizeGb: Number(process.env.MAX_DATABASE_SIZE_GB || 0),
  cookieSecure: isProduction,
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "noreply@pulse.pubky.org",
  webAppUrl: process.env.WEB_APP_URL || "http://localhost:3000",
  systemJobsAlertEmail: process.env.SYSTEM_JOBS_ALERT_EMAIL || "",
  publicUrl: process.env.API_PUBLIC_URL || "https://api.pulse.pubky.org",
  attachmentsPath:
    process.env.PULSE_ATTACHMENTS_PATH ||
    (isProduction ? "/opt/pubky-pulse-attachments" : "./data/attachments"),
  attachmentsSigningSecret: resolveAttachmentsSigningSecret(),
  attachmentsInternalUri: process.env.PULSE_ATTACHMENTS_INTERNAL_URI || "",
  // Identity: exact email domains allowed to authenticate, plus the singleton
  // team and its sole owner. Server-side only — never expose as NEXT_PUBLIC_*.
  allowedEmailDomains: identity.allowedEmailDomains,
  defaultTeamName: identity.defaultTeamName,
  defaultTeamSlug: identity.defaultTeamSlug,
  teamOwnerEmail: identity.teamOwnerEmail,
};
