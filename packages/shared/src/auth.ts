import type { AppPlatform } from "./events.js";

/**
 * The deployment runs one configured team. Its configured owner holds the
 * team-level recovery authority; everybody else is an ordinary member.
 *
 * There is deliberately no role hierarchy any more: with two values a
 * "minimum role" comparison only ever means "is this the team owner", and the
 * old ranking invited routes to be gated on a rank rather than on the thing
 * they actually need — project ownership, which lives in `project_owners`.
 */
export type TeamRole = "owner" | "member";

export const VALID_TEAM_ROLES: TeamRole[] = ["owner", "member"];

export type ApiKeyType = "client" | "agent" | "import";

export type Permission =
  | "events:write"
  | "events:read"
  | "funnels:read"
  | "funnels:write"
  | "apps:read"
  | "apps:write"
  | "projects:read"
  | "projects:write"
  | "metrics:read"
  | "metrics:write"
  | "audit_logs:read"
  | "users:write"
  | "jobs:read"
  | "jobs:write"
  | "issues:read"
  | "issues:write"
  | "feedback:read"
  | "feedback:write"
  | "questionnaires:read"
  | "questionnaires:write";

export const VALID_PERMISSIONS: Permission[] = [
  "events:write",
  "events:read",
  "funnels:read",
  "funnels:write",
  "apps:read",
  "apps:write",
  "projects:read",
  "projects:write",
  "metrics:read",
  "metrics:write",
  "audit_logs:read",
  "users:write",
  "jobs:read",
  "jobs:write",
  "issues:read",
  "issues:write",
  "feedback:read",
  "feedback:write",
  "questionnaires:read",
  "questionnaires:write",
];

export const ALLOWED_PERMISSIONS_BY_KEY_TYPE: Record<ApiKeyType, Permission[]> = {
  client: ["events:write", "users:write"],
  agent: ["events:read", "funnels:read", "funnels:write", "apps:read", "apps:write", "projects:read", "projects:write", "metrics:read", "metrics:write", "audit_logs:read", "users:write", "jobs:read", "jobs:write", "issues:read", "issues:write", "feedback:read", "feedback:write", "questionnaires:read", "questionnaires:write"],
  import: ["events:write", "users:write"],
};

export const DEFAULT_API_KEY_PERMISSIONS: Record<ApiKeyType, Permission[]> = {
  client: ["events:write", "users:write"],
  agent: ["events:read", "funnels:read", "funnels:write", "apps:read", "apps:write", "projects:read", "projects:write", "metrics:read", "metrics:write", "audit_logs:read", "users:write", "jobs:read", "jobs:write", "issues:read", "issues:write", "feedback:read", "feedback:write", "questionnaires:read", "questionnaires:write"],
  import: ["events:write", "users:write"],
};

/**
 * Validates that every permission in the array is valid for the given key type.
 * Returns an error string if invalid, or null if valid.
 */
export function validatePermissionsForKeyType(
  keyType: ApiKeyType,
  permissions: string[]
): string | null {
  if (permissions.length === 0) {
    return "At least one permission is required";
  }

  const unique = new Set(permissions);
  if (unique.size !== permissions.length) {
    return "Duplicate permissions are not allowed";
  }

  const allowed = ALLOWED_PERMISSIONS_BY_KEY_TYPE[keyType];
  for (const perm of permissions) {
    if (!VALID_PERMISSIONS.includes(perm as Permission)) {
      return `Unknown permission: ${perm}`;
    }
    if (!allowed.includes(perm as Permission)) {
      return `Permission "${perm}" is not allowed for ${keyType} keys`;
    }
  }

  return null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  preferences: import("./preferences.js").UserPreferences;
  created_at: Date;
  updated_at: Date;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeamMember {
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: Date;
}

export interface ApiKey {
  id: string;
  secret: string;
  key_type: ApiKeyType;
  app_id: string | null;
  team_id: string;
  name: string;
  created_by: string | null;
  permissions: Permission[];
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Project {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  color: string;
  retention_days_events: number | null;
  retention_days_metrics: number | null;
  retention_days_funnels: number | null;
  attachment_user_quota_bytes: number | null;
  attachment_project_quota_bytes: number | null;
  issue_alert_frequency: import("./issues.js").IssueAlertFrequency | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface App {
  id: string;
  team_id: string;
  project_id: string;
  name: string;
  platform: AppPlatform;
  bundle_id: string | null;
  latest_app_version: string | null;
  latest_app_version_updated_at: Date | null;
  /** Languages this app ships (Bundle.main.localizations), drives the localization gap. */
  supported_languages: string[] | null;
  supported_languages_source: "sdk" | "manual" | null;
  created_at: Date;
  deleted_at: Date | null;
}
