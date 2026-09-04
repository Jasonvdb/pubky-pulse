import { eq } from "drizzle-orm";
import { teamMembers, users } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import { isEmailDomainAllowed } from "@pubky-pulse/shared";
import { config } from "../config.js";

/**
 * All user_ids who are members of a team and whose stored email is still on an
 * allowed domain.
 *
 * The domain allowlist is revalidated on every HTTP request
 * (`revalidateUserIdentity` in `middleware/auth.ts`), so a user whose domain is
 * dropped from `PULSE_ALLOWED_EMAIL_DOMAINS` loses access immediately. Team
 * membership rows are not deleted by that change, so callers that fan internal
 * project data out to a member list — notifications, digests — would keep
 * reaching a revoked person. Filtering here means no caller can miss the check.
 *
 * The allowlist is a handful of domains, so the filter runs in JS on the joined
 * rows rather than as SQL the database would have to express per domain.
 */
export async function resolveTeamMemberUserIds(db: Db, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ user_id: teamMembers.user_id, email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.user_id))
    .where(eq(teamMembers.team_id, teamId));
  return rows
    .filter((r) => isEmailDomainAllowed(r.email, config.allowedEmailDomains))
    .map((r) => r.user_id);
}
