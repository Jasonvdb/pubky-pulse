import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import type { Db } from "@pubky-pulse/db";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { feedbackIngestRoutes } from "./routes/feedback-ingest.js";
import { questionnaireIngestRoutes } from "./routes/questionnaire-ingest.js";
import { ingestAttachmentRoutes } from "./routes/ingest-attachment.js";
import { attachmentsRoutes } from "./routes/attachments.js";
import { importRoutes } from "./routes/import.js";
import { eventsRoutes } from "./routes/events.js";
import { appsRoutes } from "./routes/apps.js";
import { projectsRoutes } from "./routes/projects.js";
import { projectOwnersRoutes } from "./routes/project-owners.js";
import { identityRoutes } from "./routes/identity.js";
import { appUsersRoutes } from "./routes/app-users.js";
import { teamsRoutes } from "./routes/teams.js";
import { invitationRoutes } from "./routes/invitations.js";
import { metricsRoutes, metricByIdRoutes, teamMetricsRoutes } from "./routes/metrics.js";
import { funnelsRoutes, funnelByIdRoutes, teamFunnelsRoutes } from "./routes/funnels.js";
import { auditLogsRoutes } from "./routes/audit-logs.js";
import { userPropertiesRoutes } from "./routes/user-properties.js";
import { jobsRoutes, jobsByIdRoutes } from "./routes/jobs.js";
import { issuesRoutes, teamIssuesRoutes } from "./routes/issues.js";
import { feedbackRoutes, teamFeedbackRoutes } from "./routes/feedback.js";
import { questionnaireRoutes, teamQuestionnaireRoutes } from "./routes/questionnaires.js";
import { statsRoutes, teamStatsRoutes } from "./routes/stats.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { mcpRoute } from "./mcp/index.js";
import { decompressPlugin } from "./middleware/decompress.js";
import type { EmailService } from "./services/email.js";
import type { JobRunner } from "./services/job-runner.js";
import type { NotificationDispatcher } from "./services/notifications/dispatcher.js";

/**
 * Everything the HTTP surface needs, supplied by the caller so that production
 * and the test harness can differ in *implementations* (real database and email
 * versus test ones) without differing in *routes*.
 */
export interface ServerDeps {
  app: FastifyInstance;
  db: Db;
  databaseUrl: string;
  emailService: EmailService;
  jobRunner: JobRunner;
  notificationDispatcher: NotificationDispatcher;
  cors: FastifyCorsOptions;
  jwtSecret: string;
}

/**
 * The single registration list for the whole API. `src/index.ts` and
 * `src/__tests__/setup.ts` both go through here, so a route added or removed in
 * one is added or removed in the other — previously the list was maintained by
 * hand in both files and could silently drift, leaving the test suite green
 * while production served a different set of routes.
 *
 * Registration order is significant to Fastify prefixing and must be preserved.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(ingestRoutes, { prefix: "/v1" });
  await app.register(feedbackIngestRoutes, { prefix: "/v1" });
  await app.register(questionnaireIngestRoutes, { prefix: "/v1" });
  await app.register(ingestAttachmentRoutes, { prefix: "/v1" });
  await app.register(attachmentsRoutes, { prefix: "/v1" });
  await app.register(importRoutes, { prefix: "/v1" });
  await app.register(eventsRoutes, { prefix: "/v1" });
  await app.register(appsRoutes, { prefix: "/v1" });
  await app.register(projectsRoutes, { prefix: "/v1" });
  await app.register(projectOwnersRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(identityRoutes, { prefix: "/v1" });
  await app.register(appUsersRoutes, { prefix: "/v1" });
  await app.register(teamsRoutes, { prefix: "/v1" });
  await app.register(invitationRoutes, { prefix: "/v1" });
  await app.register(metricsRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(metricByIdRoutes, { prefix: "/v1" });
  await app.register(teamMetricsRoutes, { prefix: "/v1" });
  await app.register(funnelsRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(funnelByIdRoutes, { prefix: "/v1" });
  await app.register(teamFunnelsRoutes, { prefix: "/v1" });
  await app.register(auditLogsRoutes, { prefix: "/v1/teams/:teamId" });
  await app.register(userPropertiesRoutes, { prefix: "/v1" });
  await app.register(jobsRoutes, { prefix: "/v1/teams/:teamId" });
  await app.register(jobsByIdRoutes, { prefix: "/v1" });
  await app.register(issuesRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(teamIssuesRoutes, { prefix: "/v1" });
  await app.register(feedbackRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(teamFeedbackRoutes, { prefix: "/v1" });
  await app.register(questionnaireRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(teamQuestionnaireRoutes, { prefix: "/v1" });
  await app.register(statsRoutes, { prefix: "/v1/projects/:projectId" });
  await app.register(teamStatsRoutes, { prefix: "/v1" });
  await app.register(notificationsRoutes, { prefix: "/v1" });
  await app.register(mcpRoute);
}

/**
 * Decorates the instance, installs the shared plugins, then registers every
 * route. The caller owns the Fastify instance itself because it also owns the
 * logger, and the job runner and notification dispatcher are built against that
 * logger before they can be decorated onto the app.
 *
 * The instance is returned but not readied or listened to — the caller decides
 * whether it listens (production) or is only injected against (tests).
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { app } = deps;

  app.decorate("db", deps.db);
  app.decorate("databaseUrl", deps.databaseUrl);
  app.decorate("emailService", deps.emailService);
  app.decorate("jobRunner", deps.jobRunner);
  app.decorate("notificationDispatcher", deps.notificationDispatcher);

  await app.register(decompressPlugin);
  await app.register(cookie);
  await app.register(cors, deps.cors);
  await app.register(jwt, { secret: deps.jwtSecret });

  await registerRoutes(app);

  return app;
}
