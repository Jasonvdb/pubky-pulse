import type { Db } from "@pubky-pulse/db";
import type { FastifyInstance } from "fastify";
import type { TeamRole, Permission, ApiKeyType } from "@pubky-pulse/shared";
import type { EmailService } from "./services/email.js";
import type { JobRunner } from "./services/job-runner.js";
import type { NotificationDispatcher } from "./services/notifications/dispatcher.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    databaseUrl: string;
    emailService: EmailService;
    jobRunner: JobRunner;
    notificationDispatcher: NotificationDispatcher;
  }
}

export interface UserJwtPayload {
  sub: string; // user id
  email: string;
}

export interface ApiKeyContext {
  type: "api_key";
  key_id: string;
  key_type: ApiKeyType;
  app_id: string | null;
  team_id: string;
  created_by: string;
  permissions: Permission[];
}

export interface TeamMembership {
  team_id: string;
  role: TeamRole;
}

/**
 * A human identity, rebuilt from the database on every request rather than
 * decoded from the JWT — see `revalidateUserIdentity` in `middleware/auth.ts`.
 */
export interface UserContext {
  type: "user";
  user_id: string;
  /** The email stored on the user row right now, not the one inside the JWT. */
  email: string;
  /** The configured singleton team this request was revalidated against. */
  team_id: string;
  /** True when this user is the configured sole team-level owner. */
  is_team_owner: boolean;
  /**
   * Stays an array because every route filters with `inArray(...)` against
   * `getAuthTeamIds`. It holds exactly the singleton membership.
   */
  team_memberships: TeamMembership[];
}

export type AuthContext = ApiKeyContext | UserContext;
