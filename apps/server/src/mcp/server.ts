import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { GUIDE_CONTENT } from "./guide.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerAppsTools } from "./tools/apps.js";
import { registerEventsTools } from "./tools/events.js";
import { registerMetricsTools } from "./tools/metrics.js";
import { registerFunnelsTools } from "./tools/funnels.js";
import { registerJobsTools } from "./tools/jobs.js";
import { registerAuditLogsTools } from "./tools/audit-logs.js";
import { registerIssuesTools } from "./tools/issues.js";
import { registerFeedbackTools } from "./tools/feedback.js";
import { registerQuestionnaireTools } from "./tools/questionnaires.js";
import { registerAttachmentsTools } from "./tools/attachments.js";
import { registerStatsTools } from "./tools/stats.js";

// Surfaced to MCP clients during the initialize handshake — Claude Code
// displays this verbatim at the top of every session that has the server
// connected, so it's the primary discovery surface for the feature set.
// Keep it terse and feature-comprehensive; deep concepts live in
// `pubky-pulse://guide`.
const SERVER_INSTRUCTIONS = `Pubky Pulse — self-hosted analytics for web, backend and mobile apps. Use these tools to manage projects/apps, query analytics, and triage user-facing surfaces.

Capabilities:
- Projects & apps — create/update projects and apps, create import keys, read the per-project owner list. A web app also carries allowed_origins, the browser origins that may send with the app's client key — a web app with none refuses every browser request, and create-app/update-app set the list
- Events & analytics — ingest history, breadcrumb timelines, cross-app session investigation (investigate-event)
- Metrics & funnels — definitions + query rollups (counts, durations, conversion %)
- Issues — clustered error tracking: list, claim, comment, merge, resolve-with-version, silence, snooze, regression detection
- Feedback — free-text user feedback: list, status, comments
- Questionnaires — structured in-app surveys (text / single & multi choice / 1–5 rating / 0–10 NPS) with per-question analytics
- Locale demand — rank users by wanted language + country, flag languages with demand the app doesn't ship yet (list-user-locales)
- Time-series rollups — daily + hourly aggregates for events / users / sessions / metric completions / funnel completions / questionnaire responses; retained indefinitely, powers sparklines and arbitrary-range trend pages (query-stats-bucketed)
- Attachments — binary files attached to events; signed downloads
- Audit logs, background jobs (trigger/cancel), user listings

Access model — read wide, write narrow:
- Reads span every project in the single configured team, wherever your key holds the matching read permission.
- Writes additionally require the human who created your key to currently own the target project. Authorization is an intersection, never a union: key active AND the route's explicit permission AND the creator is an active allowed-domain team member AND the creator owns that project AND the operation is agent-supported.
- Ownership is re-read per request. When your creator is added to or removed from a project, the next call reflects it — no key recreation, no reconnect.
- create-project makes your key's creator the new project's first owner; the key itself never owns anything.
- Human-only, always 403 for an agent key: changing a project's owner list, and deleting projects, apps, feedback items, questionnaires, questionnaire responses, attachments, or another author's comment.
- Agent-supported writes include deleting metric and funnel definitions, merging issues, changing issue/feedback/questionnaire-response status, triggering and cancelling project jobs, and deleting comments this exact key authored.

For concepts, resource hierarchy, naming conventions, soft-delete rules, key types, data modes, and end-to-end workflows, fetch the \`pubky-pulse://guide\` resource — it covers everything tool descriptions don't.`;

export function createMcpServer(app: FastifyInstance, agentKey: string): McpServer {
  const server = new McpServer(
    {
      name: "pubky-pulse",
      version: "1.0.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // Register the operational guide as a resource
  server.registerResource("guide", "pubky-pulse://guide", {
    description: "Pubky Pulse operational guide — concepts, resource hierarchy, workflows, and conventions for using the MCP tools.",
    mimeType: "text/markdown",
  }, async () => ({
    contents: [{
      uri: "pubky-pulse://guide",
      mimeType: "text/markdown",
      text: GUIDE_CONTENT,
    }],
  }));

  // Register all tool domains
  registerAuthTools(server, app, agentKey);
  registerProjectsTools(server, app, agentKey);
  registerAppsTools(server, app, agentKey);
  registerEventsTools(server, app, agentKey);
  registerMetricsTools(server, app, agentKey);
  registerFunnelsTools(server, app, agentKey);
  registerJobsTools(server, app, agentKey);
  registerAuditLogsTools(server, app, agentKey);
  registerIssuesTools(server, app, agentKey);
  registerFeedbackTools(server, app, agentKey);
  registerQuestionnaireTools(server, app, agentKey);
  registerAttachmentsTools(server, app, agentKey);
  registerStatsTools(server, app, agentKey);

  return server;
}
