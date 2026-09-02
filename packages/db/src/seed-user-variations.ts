import "./load-root-env.js";
import { createDatabaseConnection } from "./index.js";
import { projects, apps, appUsers, appUserApps, users, teamMembers, teams } from "./schema.js";
import { and, eq, inArray, isNull } from "drizzle-orm";

if (process.env.NODE_ENV === "production") {
  console.error("Seed script is for development only. Aborting.");
  process.exit(1);
}

const url = process.env.DATABASE_URL || "postgres://localhost:5432/pubky_pulse";

// Prefixed so reruns can cleanly delete-and-reinsert these specific users
// without touching real seed data (user-42, user-99, pulse_anon_demo-visitor).
const USER_ID_PREFIX = "test_variation_";

interface SeededUser {
  user_id: string;
  properties: Record<string, string>;
  country: string | null;
  /** Offset in minutes subtracted from `now` for first_seen_at. */
  offsetMinutes: number;
  note: string;
}

const USERS: SeededUser[] = [
  {
    user_id: `${USER_ID_PREFIX}pro_full`,
    note: "Pro plan + full signup context + 8 product props (dense Properties cell)",
    country: "US",
    offsetMinutes: 1,
    properties: {
      plan: "pro",
      plan_status: "active",
      plan_renews: "true",
      plan_period: "2026-04-01_2027-04-01",
      signup_source: "search",
      signup_campaign: "spring-launch-us",
      signup_referrer: "docs",
      locale: "en_US",
      onboarding_completed: "true",
      favorite_feature: "habits",
      theme: "light",
      seats: "5",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}pro_partial`,
    note: "Pro plan + signup source only — no product props",
    country: "DE",
    offsetMinutes: 2,
    properties: {
      plan: "pro",
      plan_status: "active",
      plan_renews: "true",
      signup_source: "search",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}trial_active`,
    note: "Active trial + signup source + 2 other props",
    country: "JP",
    offsetMinutes: 3,
    properties: {
      plan: "pro",
      plan_status: "trialing",
      plan_renews: "true",
      plan_period: "2026-04-20_2026-04-27",
      signup_source: "referral",
      locale: "ja_JP",
      notifications_enabled: "true",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}trial_lapsed`,
    note: "Lapsed trial (will not renew) + organic signup + 1 other prop",
    country: "GB",
    offsetMinutes: 4,
    properties: {
      plan: "free",
      plan_status: "trialing",
      plan_renews: "false",
      signup_source: "organic",
      referral_source: "friend",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}team_plan`,
    note: "Team plan, cancelled, with churn context + 3 other props",
    country: "FR",
    offsetMinutes: 5,
    properties: {
      plan: "team",
      plan_status: "cancelled",
      plan_renews: "false",
      plan_period: "2026-04-10_2026-05-10",
      signup_source: "search",
      signup_campaign: "fr-retention",
      last_screen: "settings",
      churn_reason: "price",
      seats: "12",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}organic_only`,
    note: "Free plan + organic signup + 2 other props",
    country: "CA",
    offsetMinutes: 6,
    properties: {
      signup_source: "organic",
      locale: "en_CA",
      device_class: "phone",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}props_only`,
    note: "No plan and no signup source — 3 arbitrary product props only",
    country: null,
    offsetMinutes: 7,
    properties: {
      locale: "en_AU",
      theme: "dark",
      first_session_duration_seconds: "87",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}many_props`,
    note: "Trial + 16 other props (tests the overflow tooltip)",
    country: "AU",
    offsetMinutes: 8,
    properties: {
      plan: "pro",
      plan_status: "trialing",
      plan_renews: "true",
      entitlements: "pro,cloud_sync",
      signup_source: "podcast",
      signup_campaign: "anz-launch",
      locale: "en_AU",
      onboarding_completed: "true",
      notifications_enabled: "false",
      theme: "system",
      beta_tester: "true",
      marketing_opt_in: "false",
      preferred_units: "metric",
      habit_count: "12",
      workspace_role: "admin",
      seats: "3",
      last_screen: "dashboard",
      device_class: "tablet",
    },
  },
  {
    user_id: `${USER_ID_PREFIX}empty`,
    note: "No properties at all — Properties column renders empty",
    country: "BR",
    offsetMinutes: 9,
    properties: {},
  },
  {
    user_id: `${USER_ID_PREFIX}minimal`,
    note: "Exactly one property — single-chip Properties cell",
    country: "NL",
    offsetMinutes: 10,
    properties: {
      plan: "free",
    },
  },
];

async function resolveTarget(db: ReturnType<typeof createDatabaseConnection>) {
  // Optional command-line arg: project slug. Default: the first project owned by the
  // seeded admin account (see seed.ts).
  const slugArg = process.argv[2];
  const emailDefault = "admin@pulse.pubky.org";

  if (slugArg) {
    const [project] = await db.select().from(projects).where(eq(projects.slug, slugArg));
    if (!project || project.deleted_at) {
      console.error(`Project with slug "${slugArg}" not found.`);
      process.exit(1);
    }
    return project;
  }

  const [u] = await db.select().from(users).where(eq(users.email, emailDefault));
  if (!u) {
    console.error(`User ${emailDefault} not found. Pass a project slug as argv[2] to override.`);
    process.exit(1);
  }
  const memberships = await db
    .select({ team_id: teamMembers.team_id })
    .from(teamMembers)
    .where(eq(teamMembers.user_id, u.id));
  if (memberships.length === 0) {
    console.error(`User ${emailDefault} has no team memberships.`);
    process.exit(1);
  }
  const teamIds = memberships.map((m) => m.team_id);
  const candidateProjects = await db
    .select()
    .from(projects)
    .where(and(inArray(projects.team_id, teamIds), isNull(projects.deleted_at)));
  if (candidateProjects.length === 0) {
    console.error(`No active projects in teams for ${emailDefault}.`);
    process.exit(1);
  }
  // Prefer personal (non-"default") team so we don't land back in the shared
  // seed's Demo Project when the user is actually viewing their own team.
  const teamRows = await db.select().from(teams).where(inArray(teams.id, teamIds));
  const personal = teamRows.find((t) => t.slug !== "default");
  const preferredTeamId = personal?.id;
  const chosen = preferredTeamId
    ? candidateProjects.find((p) => p.team_id === preferredTeamId) ?? candidateProjects[0]
    : candidateProjects[0];
  return chosen;
}

async function main() {
  const db = createDatabaseConnection(url);

  const project = await resolveTarget(db);

  // Include soft-deleted apps — in dev the only app in a test project may be
  // soft-deleted, and the /dashboard/users list still renders its badge.
  const projectApps = await db
    .select()
    .from(apps)
    .where(eq(apps.project_id, project.id));
  const demoApp = projectApps.find((a) => !a.deleted_at) ?? projectApps[0];
  if (!demoApp) {
    console.warn(`No apps in project "${project.name}" — users will have no app badge.`);
  }

  console.log(`Project: ${project.name} (${project.id})`);
  if (demoApp) console.log(`App:     ${demoApp.name} (${demoApp.id})`);

  // Delete any stray test_variation_* users across ALL projects (not just the
  // target), so reruns clean up mistakes from earlier runs that landed in a
  // different project.
  const userIds = USERS.map((u) => u.user_id);
  const deleted = await db
    .delete(appUsers)
    .where(inArray(appUsers.user_id, userIds))
    .returning({ id: appUsers.id });
  if (deleted.length > 0) {
    console.log(`Removed ${deleted.length} existing test_variation_* users (cascaded).`);
  }

  const now = Date.now();

  for (const u of USERS) {
    const seenAt = new Date(now - u.offsetMinutes * 60_000);
    const [inserted] = await db
      .insert(appUsers)
      .values({
        project_id: project.id,
        user_id: u.user_id,
        is_anonymous: false,
        properties: u.properties,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
        last_country_code: u.country,
      })
      .returning({ id: appUsers.id });

    if (demoApp) {
      await db.insert(appUserApps).values({
        app_user_id: inserted.id,
        app_id: demoApp.id,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
      });
    }

    console.log(`  ${u.user_id.padEnd(38)} — ${u.note}`);
  }

  console.log(`\nSeeded ${USERS.length} test_variation_* users in ${project.name}.`);
  console.log("Visit http://localhost:3000/dashboard/users?sort=first_seen to test.");

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
