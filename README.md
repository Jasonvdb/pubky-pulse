# Owlmetry

[![Tests](https://github.com/owlmetry/owlmetry/actions/workflows/test.yml/badge.svg)](https://github.com/owlmetry/owlmetry/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![@owlmetry/node](https://img.shields.io/npm/v/%40owlmetry%2Fnode?label=%40owlmetry%2Fnode)](https://www.npmjs.com/package/@owlmetry/node)

Agent-first observability. Self-hosted. Built for the way you actually ship now.

Owlmetry is an observability platform designed for the agentic development era. Point your coding agent at the setup instructions, and it handles everything — integration, monitoring, debugging, performance analysis. The developer doesn't need to open a dashboard, configure alerts, or interpret charts. The agent does it all through MCP and the REST API.

> **⚠️ Alpha Software** — Owlmetry is in early alpha. APIs, schemas, and configuration may change without notice. Not yet production-ready.

## Get Started

Add the Owlmetry MCP server to your agent's config. It exposes the full product surface as tools, plus its integration guide as the `owlmetry://guide` resource — nothing to install. See the [MCP setup docs](https://owlmetry.com/docs/mcp) for editor-specific instructions, and [owlmetry.com/docs](https://owlmetry.com/docs) for the SDK integration guides.

Your agent handles the rest — account setup, SDK integration, instrumentation, and querying.

## Why agent-first?

Most observability tools are built for humans staring at dashboards. Owlmetry is built for agents making API calls. Every feature is accessible programmatically through agent API keys, an MCP server, and a complete REST API. The web dashboard exists as an optional visual layer — not the primary interface.

With Owlmetry, your agent can:

1. **Set up observability** — create projects, register apps, integrate the SDK into your codebase
2. **Monitor in production** — query events, filter by level/app/time, investigate error clusters, watch user journeys
3. **Diagnose issues** — pull the cross-app session timeline around an incident, download crash attachments, read user feedback
4. **Act on what it finds** — the agent reads the data, understands the problem, and writes the fix

The dashboard is there if you want to look. But you shouldn't have to.

## Why self-hosted?

Your analytics data is some of the most sensitive information you have — user behavior, device details, session traces, error logs, crash dumps. Owlmetry keeps all of it on your own infrastructure. No data leaves your servers, no third-party vendor has access, no privacy policy to hope they follow. Self-hosted by design means GDPR, HIPAA, and SOC 2 compliance become properties of your infrastructure, not vendor promises.

And it's simple: one Postgres database, one Node.js API server, one optional Next.js dashboard. No Kafka, no ClickHouse, no Redis. A `deploy/` folder of Ubuntu scripts gets you from a fresh VPS to a running instance with backups, log rotation, and health checks.

## Features

### Ingestion and instrumentation
- **Event ingestion** — batch ingest up to 100 events per request with deduplication; gzip-compressed payloads supported
- **Bulk historical import** — import keys (`owl_import_`) scoped per project; `POST /v1/import` accepts up to 1000 events per request and upserts duplicates
- **Projects & apps** — organize apps by product across platforms (`apple`, `android`, `web`, `backend`); one Apple app covers iOS, iPadOS, and macOS
- **Device tracking** — environment, OS version, app version, device model, locale, build number, SDK name + version (auto-stamped by official SDKs); latest released version auto-detected per app (highest version seen in the last 90 days of production events) and stale versions badged across surfaces
- **Country tracking** — server auto-derives country from Cloudflare's `CF-IPCountry` header at ingest; rendered as flags across the dashboard
- **Anonymous identity** — SDKs generate `owl_anon_` IDs; `/v1/identity/claim` retroactively links anonymous events to a known user, including late-arriving events after the claim
- **Bundle ID validation** — client API keys are scoped to an app's registered bundle ID, validated on every ingest request
- **SDK console logging** — opt-in via `consoleLogging: true` on `Owl.configure()` (Swift + Node); prints every tracked event, metric, and funnel step to the console so you can verify instrumentation without a dashboard round-trip

### Debugging and incident response
- **Issue tracker** — error events automatically clustered into issues by fingerprint, with status lifecycle (`new → in_progress → resolved → silenced → snoozed → regressed`), agent/user comments, merge duplicates, semver-aware regression detection against `resolved_at_version`, first/last-seen app version tracking. `snoozed` is like `silenced` (no notifications, no fix version required) but auto-flips back to `new` and re-fires the `issue.new` notification when the issue recurs. Same-session error bursts within 5 seconds auto-alias onto a single issue so a loader throwing + caller logging + `op.fail()` doesn't triple-count. Kanban board in the dashboard, full API and MCP surface
- **Notifications** — multi-channel notification system (in-app inbox, email) with per-user preferences and pluggable channel adapters. Triggers today: `issue.new` (fires as soon as an issue opens or regresses), `issue.digest` (per-project email digest, gated by `issue_alert_frequency`: `none | hourly | 6_hourly | daily | weekly`), `feedback.new`, `questionnaire.response_new`, `job.completed`, and `team.invitation`. Users opt channels in or out per type. See [docs/concepts/notifications](https://owlmetry.com/docs/concepts/notifications)
- **Event attachments** — SDKs can upload files (logs, screenshots, crash dumps) alongside error events; stored on disk, linked to events and issues, downloadable via dashboard and MCP. Per-project + per-user quotas. See [docs/concepts/attachments](https://owlmetry.com/docs/concepts/attachments)
- **Cross-app session investigation** — one endpoint reconstructs the full timeline across all apps a user touched during an incident window
- **User feedback** — free-text feedback from apps (Swift SDK `OwlFeedbackView` / `Owl.sendFeedback`) or from your own frontend (Node SDK `Owl.sendFeedback`). Kanban board with status lifecycle, comments, and session-linked event replay. See [docs/concepts/feedback](https://owlmetry.com/docs/concepts/feedback)

### Analytics
- **Structured metrics** — define metrics, track operations with `startOperation`/`complete`/`fail`, query aggregations (counts, success rates, duration percentiles, error breakdowns) via API
- **Funnel analytics** — define conversion funnels and let your agent query drop-off rates programmatically
- **In-app questionnaires** — structured multi-question surveys for product research and NPS. Up to 30 questions per questionnaire across `text` / `single_choice` / `multi_choice` / `rating` (1–5) / `nps` (0–10), with per-question rollups. **Progressive draft saves**: the Swift SDK persists answers on every Next tap so users can resume mid-flow across launches; analytics include drafts by default so abandonment renders as a natural drop-off curve. Identity-aware eligibility (`already_responded` / `globally_dismissed` / `inactive`) and global dismiss via a single user property survive reinstall. Schema edits mid-draft are non-breaking — unknown answer keys prune at submission. Full dashboard and MCP surface. See [docs/concepts/questionnaires](https://owlmetry.com/docs/concepts/questionnaires)
- **User properties** — attach custom key-value metadata to users (plan tier, account status, cohort) from the SDKs or the identity API
- **Time-series rollups** — daily and hourly pre-aggregated counts for events, users, sessions, metric completions, funnel completions, and questionnaire responses. Power subtle SVG sparklines on dashboard cards and trend queries that survive raw-event retention. Per-user window preference (7 / 14 / 30 / 60 / 90 days), backfill via aggregation jobs, full MCP (`query-stats-bucketed`) surface. See [docs/concepts/aggregations](https://owlmetry.com/docs/concepts/aggregations)
- **Locale demand** — rank users by the language they want (device preferred language) and by country, flagging languages with demand the app doesn't ship yet, to decide where to localize next. The Swift SDK reports the user's preferred language (`Locale.preferredLanguages`) plus the app's shipped languages (`Bundle.main.localizations`), so the localization gap is computed automatically. The country breakdown works for every user immediately and bridges until SDK adoption catches up. Dashboard `/dashboard/locales` with project + app scoping; full MCP (`list-user-locales`) surface.

### Agent and human interfaces
- **Agent-native API** — every operation available through `owl_agent_` keys: query events, investigate sessions, read issues, download attachments, trigger jobs
- **MCP server** — Streamable HTTP endpoint exposing the full product surface as tools (62), plus its integration guide as the `owlmetry://guide` resource; agents connect directly with an `owl_agent_` key
- **Dashboard optional** — Next.js web UI for when you want a visual overview. Not required for any workflow

### Platform and operations
- **Auth model** — `owl_client_` keys for SDKs, `owl_agent_` keys for agents (MCP and API), `owl_import_` keys for bulk history, JWT (passwordless email code) for the optional dashboard. Role-based access: **owner** > **admin** > **member**
- **Team management** — create teams, invite members by email (7-day token expiry), change roles, remove members
- **Audit trail** — automatic logging of who created, updated, or deleted resources; queryable via API, MCP, and dashboard
- **Background jobs** — generic job system on pg-boss with cron scheduling, progress tracking, cooperative cancellation, and email alerts. Manages issue scanning, issue digests, aggregation rollups, app-version detection, retention cleanup, and database maintenance with full visibility via dashboard, MCP, and API
- **Per-project retention** — configurable `retention_days_events`, `retention_days_metrics`, `retention_days_funnels` columns enforced by a daily job
- **Database auto-pruning** — optional size limit (`MAX_DATABASE_SIZE_GB`) safety net; drops oldest monthly partitions first
- **Data mode** — every event is tagged `production` / `development`; dashboard sidebar toggles which you're looking at
- **Single Postgres** — one database, one API server. Monthly partitioned events, metrics, and funnels handle the scale. Postgres does what it's been doing reliably for decades

## Architecture

```
apps/server        Fastify API server (port 4000) — the core of Owlmetry
apps/web           Next.js dashboard + Fumadocs documentation site (port 3000)
packages/shared    Shared TypeScript types and constants
packages/db        Drizzle ORM schema, migrations, seed, partition utilities
deploy/            VPS deployment scripts (Ubuntu 24.04)
```

Sibling repos:

- **[owlmetry/owlmetry-swift](https://github.com/owlmetry/owlmetry-swift)** — Swift SDK for iOS, iPadOS, and macOS.
- **[owlmetry/owlmetry-node](https://github.com/owlmetry/owlmetry-node)** — Node.js server SDK (`@owlmetry/node`).

The API server is the product. Everything else — the dashboard, the MCP server, the SDKs — is a client of that API. This means your agent has the same capabilities as the web UI. Nothing is dashboard-only.

## Local Development

Requires Node.js >= 20, PostgreSQL >= 15, and pnpm.

```bash
# Install dependencies
pnpm install

# Create database
createdb owlmetry

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# Run migrations (creates tables + event partitions)
pnpm db:migrate

# Seed dev data (creates admin user, team, project, app, API keys)
pnpm dev:seed

# Start the API server
pnpm dev:server

# Run tests (requires owlmetry_test database)
createdb owlmetry_test
pnpm test              # Vitest workspace tests
pnpm test:coverage     # Server tests with code coverage reporting
```

## Self-Hosting

See the [self-hosting guide](https://owlmetry.com/docs/self-hosting) for the full walkthrough — covers system dependencies, PostgreSQL, nginx, pm2, SSL, Cloudflare, firewall, attachments storage, and maintenance.

## Documentation

Full documentation is available at [owlmetry.com/docs](https://owlmetry.com/docs):

- **[API Reference](https://owlmetry.com/docs/api-reference)** — complete REST API with request/response examples
- **[MCP](https://owlmetry.com/docs/mcp)** — setup and tool reference for MCP clients
- **[Node.js SDK](https://owlmetry.com/docs/sdks/node)** — server-side instrumentation (`npm install @owlmetry/node`)
- **[Swift SDK](https://owlmetry.com/docs/sdks/swift)** — iOS, iPadOS, and macOS instrumentation (Swift Package)
- **[Concepts](https://owlmetry.com/docs/concepts)** — events, issues, feedback, attachments, metrics, funnels, and more
- **[Self-Hosting](https://owlmetry.com/docs/self-hosting)** — VPS setup, nginx, pm2, SSL, environment variables

## Links

- [Website](https://owlmetry.com)
- [Documentation](https://owlmetry.com/docs)
- [Self-Hosting Guide](https://owlmetry.com/docs/self-hosting)
- [Node SDK on npm](https://www.npmjs.com/package/@owlmetry/node)
