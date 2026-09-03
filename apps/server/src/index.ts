import Fastify from "fastify";
import { createDatabaseConnection } from "@pubky-pulse/db";
import { config } from "./config.js";
import { buildServer } from "./app.js";
import { bootstrapSingletonTeam } from "./services/bootstrap-team.js";
import { createEmailService } from "./services/email.js";
import { JobRunner } from "./services/job-runner.js";
import { registerAllJobs } from "./jobs/index.js";
import { NotificationDispatcher } from "./services/notifications/dispatcher.js";
import { inAppAdapter } from "./services/notifications/adapters/in-app.js";
import { createEmailAdapter } from "./services/notifications/adapters/email.js";
import type { ChannelAdapter } from "./services/notifications/types.js";

const app = Fastify({ logger: true });

// Database
const db = createDatabaseConnection(config.databaseUrl);

// Services
const emailService = createEmailService(config.resendApiKey, config.emailFrom);

// Job Runner
const jobRunner = new JobRunner({
  db,
  databaseUrl: config.databaseUrl,
  log: app.log,
  emailService,
  systemJobsAlertEmail: config.systemJobsAlertEmail,
});

// Notification dispatcher — in-app and email channels.
const adapters: ChannelAdapter[] = [inAppAdapter, createEmailAdapter(emailService)];

const notificationDispatcher = new NotificationDispatcher({
  db,
  jobRunner,
  log: app.log,
  adapters,
});
jobRunner.setNotificationDispatcher(notificationDispatcher);

registerAllJobs(jobRunner, notificationDispatcher);

const isDev = process.env.NODE_ENV !== "production";

jobRunner.schedule({
  jobType: "partition_creation",
  cron: isDev ? "*/5 * * * *" : "0 4 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "db_pruning",
  cron: isDev ? "* * * * *" : "0 * * * *",
  enabled: () => config.maxDatabaseSizeGb > 0,
  params: () => ({ max_size_bytes: config.maxDatabaseSizeGb * 1024 * 1024 * 1024 }),
});
jobRunner.schedule({
  jobType: "retention_cleanup",
  cron: isDev ? "*/5 * * * *" : "0 2 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "soft_delete_cleanup",
  cron: isDev ? "*/5 * * * *" : "0 3 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "issue_scan",
  cron: isDev ? "*/5 * * * *" : "0 * * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "issue_notify",
  cron: isDev ? "*/5 * * * *" : "5 * * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "attachment_cleanup",
  cron: isDev ? "*/5 * * * *" : "0 5 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "app_version_sync",
  cron: isDev ? "*/5 * * * *" : "15 * * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "notification_cleanup",
  cron: isDev ? "*/10 * * * *" : "0 6 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "questionnaire_draft_cleanup",
  cron: isDev ? "*/10 * * * *" : "30 6 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "stats_aggregate_daily",
  // Daily 00:30 UTC in prod — 30 min past midnight so the previous UTC day
  // has settled past most SDK late-arrivals. Dev runs every 10 min so the
  // sparklines update quickly when seeding new data. The default no-param run
  // re-aggregates the trailing 3 days to absorb any late events.
  cron: isDev ? "*/10 * * * *" : "30 0 * * *",
  enabled: () => true,
  params: () => ({}),
});
jobRunner.schedule({
  jobType: "stats_aggregate_hourly",
  // Hourly at :05 UTC — 5 min past the hour for the same reason. Dev runs
  // every 5 min. The default no-param run re-aggregates the trailing 3 hours.
  cron: isDev ? "*/5 * * * *" : "5 * * * *",
  enabled: () => true,
  params: () => ({}),
});

// Decorators, plugins and routes — the shared factory in app.ts owns the route
// list so this file and the test harness can never drift apart.
await buildServer({
  app,
  db,
  databaseUrl: config.databaseUrl,
  emailService,
  jobRunner,
  notificationDispatcher,
  cors: {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  },
  jwtSecret: config.jwtSecret,
});

// The configured team, its sole owner, and the sole-owner invariant must all
// hold before a single request is served — a half-configured access model is
// worse than a server that refuses to start. The error is printed on its own
// because it names configuration, never credentials.
try {
  await bootstrapSingletonTeam(db);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// Start
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Server running on ${config.host}:${config.port}`);
} catch (err: any) {
  if (err?.code === "EADDRINUSE") {
    console.error(`\nPort ${config.port} is already in use. Kill the existing process:\n  lsof -ti:${config.port} | xargs kill\n`);
  } else {
    app.log.error(err);
  }
  // Kill the parent process (tsx watch) so it doesn't restart in a loop
  if (process.ppid) process.kill(process.ppid, "SIGTERM");
  process.exit(1);
}

// Start scheduled jobs after server is listening
jobRunner.startSchedules().catch((err) => {
  app.log.error(err, "Failed to start job schedules");
});

// Graceful shutdown
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  // Force-exit if graceful shutdown takes too long (e.g. tsx watch killing us)
  const forceTimer = setTimeout(() => process.exit(0), 3000);
  forceTimer.unref();

  await jobRunner.shutdown(2500);
  try {
    await app.close();
  } catch {
    // Ignore close errors during shutdown
  }
  clearTimeout(forceTimer);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
