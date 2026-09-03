import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { teams, teamMembers, users } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import { config } from "../config.js";

/**
 * Idempotent bootstrap of the single configured team.
 *
 * The deployment has exactly one active team, named and identified by
 * `PULSE_DEFAULT_TEAM_SLUG`/`PULSE_DEFAULT_TEAM_NAME`, whose sole team-level
 * owner is `PULSE_TEAM_OWNER_EMAIL`. This runs before the server accepts
 * traffic — and from the test harness's app factory, so tests exercise the same
 * path — and either leaves the database matching that configuration or throws.
 *
 * Deliberately non-destructive: it never deletes or merges a team, never moves
 * projects between teams, and never generates or prints credentials. Personal
 * default agent keys stay lazily created after their owner authenticates.
 */

export interface SingletonTeamBootstrap {
  teamId: string;
  ownerUserId: string;
}

/**
 * A neutral initial display name derived from an address's local part, used
 * only when a user row has to be created before that person has ever signed in.
 * They can rename themselves afterwards. Kept here so the bootstrap and the
 * login flow derive names identically.
 */
export function deriveInitialDisplayName(email: string): string {
  const localPart = email.slice(0, email.lastIndexOf("@"));
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

/**
 * Resolve the configured singleton team by slug.
 *
 * Callers must look the team up by SLUG on every request rather than caching an
 * id: the row can legitimately be recreated with a new uuid (the test harness
 * truncates and reseeds between cases), and a cached id would silently reject
 * every authenticated request afterwards.
 */
export async function findSingletonTeam(
  db: Db
): Promise<{ id: string; name: string; slug: string } | null> {
  const [team] = await db
    .select({ id: teams.id, name: teams.name, slug: teams.slug })
    .from(teams)
    .where(and(eq(teams.slug, config.defaultTeamSlug), isNull(teams.deleted_at)))
    .limit(1);
  return team ?? null;
}

export async function bootstrapSingletonTeam(db: Db): Promise<SingletonTeamBootstrap> {
  return db.transaction(async (tx) => {
    // `teams.slug` is globally unique, so a single lookup settles both "does the
    // configured team exist" and "is something else already holding the slug".
    const [existing] = await tx
      .select({ id: teams.id, name: teams.name, deleted_at: teams.deleted_at })
      .from(teams)
      .where(eq(teams.slug, config.defaultTeamSlug))
      .limit(1);

    let teamId: string;

    if (!existing) {
      const [created] = await tx
        .insert(teams)
        .values({ name: config.defaultTeamName, slug: config.defaultTeamSlug })
        .returning({ id: teams.id });
      teamId = created.id;
    } else {
      // An identity conflict is reported, never repaired. Renaming or reviving
      // the row here would quietly re-point every project, key and membership
      // that already hangs off it, which is exactly the silent data movement
      // this bootstrap exists to prevent.
      if (existing.deleted_at !== null) {
        throw new Error(
          `Singleton-team bootstrap failed: the team with slug "${config.defaultTeamSlug}" is soft-deleted. ` +
            "Restore that team row or point PULSE_DEFAULT_TEAM_SLUG at the active team; " +
            "the bootstrap will not revive it or create a second team."
        );
      }
      if (existing.name !== config.defaultTeamName) {
        throw new Error(
          `Singleton-team bootstrap failed: the team with slug "${config.defaultTeamSlug}" is named ` +
            `"${existing.name}" but PULSE_DEFAULT_TEAM_NAME is "${config.defaultTeamName}". ` +
            "Align the configuration with the stored team, or rename the team row deliberately."
        );
      }
      teamId = existing.id;
    }

    // A fresh-database rollout has exactly one active team. An extra one means
    // data lives somewhere this access model cannot see, so startup fails
    // loudly rather than deleting or merging it.
    const [extra] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(teams)
      .where(and(isNull(teams.deleted_at), ne(teams.id, teamId)));

    if (extra.count > 0) {
      throw new Error(
        `Singleton-team invariant violated: ${extra.count} additional active team(s) exist alongside ` +
          `"${config.defaultTeamSlug}". This deployment supports exactly one active team. ` +
          "Resolve the extra team(s) manually — the bootstrap will never delete or merge them."
      );
    }

    let [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, config.teamOwnerEmail))
      .limit(1);

    if (!owner) {
      [owner] = await tx
        .insert(users)
        .values({
          email: config.teamOwnerEmail,
          name: deriveInitialDisplayName(config.teamOwnerEmail),
        })
        .returning({ id: users.id });
    }

    await tx
      .insert(teamMembers)
      .values({ team_id: teamId, user_id: owner.id, role: "owner" })
      .onConflictDoUpdate({
        target: [teamMembers.team_id, teamMembers.user_id],
        set: { role: "owner" },
      });

    // Sole-team-owner invariant: if the configured owner changed, the previous
    // owner is demoted to member rather than left with team-level authority.
    await tx
      .update(teamMembers)
      .set({ role: "member" })
      .where(
        and(
          eq(teamMembers.team_id, teamId),
          ne(teamMembers.user_id, owner.id),
          ne(teamMembers.role, "member")
        )
      );

    return { teamId, ownerUserId: owner.id };
  });
}
