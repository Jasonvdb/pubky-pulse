import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { projectOwners, projects, teamMembers, users } from "@pubky-pulse/db";
import type { Db } from "@pubky-pulse/db";
import type { ProjectAccessLevel, ProjectOwnerResponse } from "@pubky-pulse/shared";

/**
 * Reading and maintaining a project's owner list.
 *
 * Authorization itself lives in `project-access.ts` — this module only loads
 * and mutates the rows once a caller has been cleared. It is deliberately
 * separate from the serializers so that the *bulk* loader is the obvious thing
 * to reach for: the project list endpoint serializes every project in the team
 * in one response, and a per-project owner query there would be an N+1.
 */

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run these queries: the pool, or a transaction on it. */
type Queryable = Pick<Db, "select">;

/**
 * Owner rows for many projects in one query, keyed by project id.
 *
 * Mirrors `getClientSecretMap` in `utils/serialize.ts`, which solves the same
 * shape for client secrets on the same endpoints. Projects with no owners are
 * absent from the map, so callers should default to an empty array — an
 * orphaned project is a real (recoverable) state, not an error.
 */
export async function getProjectOwnerMap(
  db: Queryable,
  projectIds: string[],
): Promise<Map<string, ProjectOwnerResponse[]>> {
  const map = new Map<string, ProjectOwnerResponse[]>();
  if (projectIds.length === 0) return map;

  const rows = await db
    .select({
      project_id: projectOwners.project_id,
      user_id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(projectOwners)
    .innerJoin(users, eq(users.id, projectOwners.user_id))
    .where(inArray(projectOwners.project_id, projectIds))
    // Oldest owner first, then by id, so the list is stable across requests.
    .orderBy(asc(projectOwners.added_at), asc(users.id));

  for (const row of rows) {
    const owners = map.get(row.project_id) ?? [];
    owners.push({ user_id: row.user_id, name: row.name, email: row.email });
    map.set(row.project_id, owners);
  }
  return map;
}

/**
 * The subset of `projectIds` that `actorUserId` currently owns.
 *
 * Credential visibility is decided from this set *before* any secret is
 * loaded: client and import keys belong to their app's project, so "which
 * projects do you own" is the whole of the entitlement question for them.
 *
 * Passing `projectIds` narrows the query to the page being served; omitting it
 * asks for every project the actor owns, which is what a key list — whose rows
 * can point at any app in the team — needs. A `null` actor (a client or import
 * key, which has no human behind it) owns nothing.
 */
export async function getOwnedProjectIds(
  db: Queryable,
  actorUserId: string | null,
  projectIds?: readonly string[],
): Promise<Set<string>> {
  if (actorUserId === null) return new Set();
  if (projectIds && projectIds.length === 0) return new Set();

  const rows = await db
    .select({ project_id: projectOwners.project_id })
    .from(projectOwners)
    .where(
      and(
        eq(projectOwners.user_id, actorUserId),
        projectIds ? inArray(projectOwners.project_id, [...projectIds]) : undefined,
      ),
    );

  return new Set(rows.map((r) => r.project_id));
}

/** The owner list for a single project. */
export async function getProjectOwners(
  db: Queryable,
  projectId: string,
): Promise<ProjectOwnerResponse[]> {
  const map = await getProjectOwnerMap(db, [projectId]);
  return map.get(projectId) ?? [];
}

/**
 * The caller's effective access to a project, derived from the owner list that
 * is being serialized anyway rather than from a separate ownership query.
 *
 * `actorUserId` is the effective *human* actor (`resolveActorUserId`), so an
 * agent key reports the access level its creator has — which is exactly the
 * access the key itself gets on a write.
 */
export function resolveAccessLevel(
  owners: ProjectOwnerResponse[],
  actorUserId: string | null,
): ProjectAccessLevel {
  if (actorUserId === null) return "viewer";
  return owners.some((o) => o.user_id === actorUserId) ? "owner" : "viewer";
}

/**
 * Whether a user is a member of a team, used to check an owner-list addition.
 *
 * Only an existing member of the project's own team can be made an owner:
 * there is no outside-user invitation path, so a user id that is not on the
 * roster must read as absent (404) rather than as a refusal, which would
 * confirm that the id names a real user somewhere.
 */
export async function isTeamMember(
  db: Queryable,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ user_id: teamMembers.user_id })
    .from(teamMembers)
    .where(and(eq(teamMembers.team_id, teamId), eq(teamMembers.user_id, userId)))
    .limit(1);
  return Boolean(row);
}

/** The outcome of an owner removal, as the HTTP status the route should send. */
export type OwnerRemovalOutcome =
  | { status: "removed" }
  | { status: "not_an_owner" }
  | { status: "last_owner" };

/**
 * Remove one owner, or refuse, with the final-owner invariant held by the
 * database rather than by the application's view of it.
 *
 * The project row is locked FOR UPDATE *before* the owner set is counted, so
 * two concurrent removals serialize: the second one re-counts after the first
 * has committed, sees a single remaining owner and refuses. Counting outside
 * the lock would let both requests observe two owners and both delete, leaving
 * the project ownerless — the exact race the lock exists to prevent.
 *
 * The lock is taken on `projects` rather than on the `project_owners` rows
 * because the row being deleted is not the only row that matters: the count
 * covers rows a concurrent transaction may be inserting too, and only a lock
 * on the parent serializes both.
 */
export async function removeProjectOwner(
  db: Db,
  projectId: string,
  userId: string,
): Promise<OwnerRemovalOutcome> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deleted_at)))
      .limit(1)
      .for("update");

    const owners = await tx
      .select({ user_id: projectOwners.user_id })
      .from(projectOwners)
      .where(eq(projectOwners.project_id, projectId));

    if (!owners.some((o) => o.user_id === userId)) {
      return { status: "not_an_owner" } as const;
    }
    if (owners.length <= 1) {
      return { status: "last_owner" } as const;
    }

    await tx
      .delete(projectOwners)
      .where(and(eq(projectOwners.project_id, projectId), eq(projectOwners.user_id, userId)));

    return { status: "removed" } as const;
  });
}

/**
 * Add an owner if they are not one already.
 *
 * `ON CONFLICT DO NOTHING` against the unique (project_id, user_id) index makes
 * the PUT idempotent without a read-then-write race.
 */
export async function addProjectOwner(
  db: Db | Tx,
  projectId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(projectOwners)
    .values({ project_id: projectId, user_id: userId })
    .onConflictDoNothing();
}

/** How many owners a project currently has. */
export async function countProjectOwners(db: Queryable, projectId: string): Promise<number> {
  const rows = await db
    .select({ user_id: projectOwners.user_id })
    .from(projectOwners)
    .where(eq(projectOwners.project_id, projectId));
  return rows.length;
}
