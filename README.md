# Pubky Pulse

Self-hosted, agent-first observability for web, backend and mobile apps.

[![Tests](https://github.com/pubky/pubky-pulse/actions/workflows/test.yml/badge.svg)](https://github.com/pubky/pubky-pulse/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

> Alpha software. APIs, database schema and configuration can change without notice. Run it, but expect breakage.

## What it is

Pubky Pulse collects what your apps report — events, errors, metrics, funnel steps, feedback — into one Postgres database, and exposes all of it through a single HTTP API. Agents talk to that API over MCP; the dashboard and the SDKs are just other clients of the same endpoints. It is web-first and platform-agnostic: any runtime that can make an HTTPS request can send data, and every field the SDKs stamp (device, OS, app version, locale, country) is optional.

Capability areas:

- **Events** — batched ingest with deduplication and gzip, four log levels, custom attributes, monthly-partitioned storage
- **Metrics** — structured operations tracked as start / complete / fail, queried as counts, success rates and duration percentiles
- **Funnels** — named step sequences with drop-off queries
- **Issues** — error events clustered by fingerprint, with a lifecycle (new, in progress, resolved, silenced, snoozed, regressed), comments, merging and regression detection
- **Feedback** — free-text reports from your apps, linked back to the session that produced them
- **Questionnaires** — in-app surveys built from text, single choice, multi choice, rating and NPS questions, with per-question rollups
- **Attachments** — files uploaded alongside an event, stored on disk behind signed URLs, with per-project and per-user quotas
- **Identity and user properties** — anonymous IDs (`pulse_anon_`) that can later be claimed by a known user, plus custom key-value metadata per user
- **Locale demand** — which languages and countries your users have, and which ones your app does not ship yet
- **Stats rollups** — daily and hourly pre-aggregated counts that outlive raw-event retention
- **Notifications** — in-app inbox and email, per user and per type
- **Access control** — one configured team locked to your own email domains, with per-project owner lists deciding who can write
- **Audit** — who created, updated or deleted what, queryable like any other resource
- **Jobs** — 13 background job types on pg-boss, with scheduling, progress and cancellation
- **Retention** — per-project retention windows plus an optional database size cap that drops the oldest partitions first

The whole thing is one Postgres database, one Node API server, and an optional Next.js dashboard. No Kafka, no ClickHouse, no Redis. Every event is tagged `production` or `development`, so a local run never pollutes the numbers you care about, and the three high-volume tables (events, metric events, funnel events) are partitioned by month, so expiring old data means dropping a partition rather than running a long `DELETE`.

## Get started

MCP is the only agent interface. Point your agent at a running instance:

```bash
claude mcp add --transport http --scope user pubky-pulse \
  https://api.pulse.pubky.org/mcp \
  --header "Authorization: Bearer pulse_agent_..."
```

`api.pulse.pubky.org` is a placeholder — self-hosters use their own instance URL, and local development uses `http://localhost:4000/mcp`. The key is an agent key (`pulse_agent_*`) created from the dashboard; client and import keys are rejected by the MCP endpoint.

Then tell your agent what you want. It reads the `pubky-pulse://guide` resource on connect, so it knows the resource hierarchy and conventions, and it has 62 tools covering projects, apps, events, metrics, funnels, issues, feedback, questionnaires, attachments, jobs, audit logs, stats and identity. Ask it to create a project and an app, wire the SDK into your codebase, and from then on ask it questions instead of opening charts: what broke since the last release, which funnel step people abandon, what a specific user did in the ten minutes before the crash.

Permissions are enforced per tool, not per connection: a key without `projects:write` gets an error from `create-project` and keeps working for everything else, so you can hand a read-only key to an agent you are still learning to trust.

Reads are wide and writes are narrow. An agent key reads every project in the team, but an ordinary write also requires the *person who created the key* to currently own the target project — so an agent is never more powerful than the colleague it belongs to, and adding or removing that person from a project takes effect on the next call with no new key. Deleting projects, apps, feedback, questionnaires, responses and attachments, and changing a project's owner list, stay human-only.

Three other key types exist alongside agent keys: `pulse_client_*` for SDKs sending data (scoped to one app's bundle ID), `pulse_import_*` for backfilling history, and a passwordless email code that signs you into the dashboard. Only agent keys reach MCP.

Editor-specific setup lives at [pulse.pubky.org/docs/mcp/setup](https://pulse.pubky.org/docs/mcp/setup); the walkthrough from empty database to first event is at [pulse.pubky.org/docs/getting-started](https://pulse.pubky.org/docs/getting-started).

## Why agent-first

Dashboards assume a human is watching. Most of the time now, the thing reading your error logs and correlating them with a deploy is an agent — and it is bad at screenshots and good at API calls. So the API is the product here, and everything else is a client of it: the MCP server, the dashboard, the SDKs. Nothing is dashboard-only, which means an agent can do anything a person can do in the web UI.

That changes what the tool is for. An agent that can query issues, pull the cross-app session timeline around an incident, download the attachment from a failed request and read the user's feedback about it has enough context to write the fix. The dashboard stays useful for looking around, but you should not have to open it to get an answer.

## Why self-hosted

Behavioural data is among the most sensitive you hold: what users do, on which device, from which country, and the stack traces and crash dumps from when it went wrong. Pubky Pulse keeps all of it on infrastructure you control. There is no third-party vendor in the path, nothing to negotiate a data processing agreement over, and no export step if you want to query the raw tables yourself.

Operationally it is deliberately boring. Postgres holds everything; the API server is a normal Node process; backups are `pg_dump` plus one directory of attachment files. The `deploy/` scripts take a fresh Ubuntu VPS to a running instance.

## Architecture

```
apps/server        Fastify API server (port 4000) — the core; also hosts the MCP endpoint and pg-boss jobs
apps/web           Next.js dashboard and Fumadocs documentation site (port 3000)
packages/shared    Shared TypeScript types and constants
packages/db        Drizzle schema, baseline migration, seeds, partition utilities
deploy/            Ubuntu VPS setup scripts and nginx snippets
```

`packages/db` carries a single baseline migration rather than a chain of incremental ones, so a fresh instance is one `pnpm db:migrate` away. That same step converts the three high-volume tables to partitioned ones and creates partitions for the current month and the next two; a background job keeps the window rolling forward.

The MCP server is not a separate process. It lives inside `apps/server` as a Streamable HTTP handler on `POST /mcp`, authenticated with the same agent keys as the REST API and backed by the same service layer — so a tool and its equivalent endpoint cannot drift apart.

## SDKs

| SDK | Status | Docs | Repo |
| --- | --- | --- | --- |
| Web | Coming soon | [/docs/sdks/web](https://pulse.pubky.org/docs/sdks/web) | TBD |
| Node.js | Docs describe the current API surface | [/docs/sdks/node](https://pulse.pubky.org/docs/sdks/node) | [pubky/pubky-pulse-node](https://github.com/pubky/pubky-pulse-node) |
| Swift | Docs describe the current API surface | [/docs/sdks/swift](https://pulse.pubky.org/docs/sdks/swift) | [pubky/pubky-pulse-swift](https://github.com/pubky/pubky-pulse-swift) |
| Android | Docs describe the current API surface | [/docs/sdks/android](https://pulse.pubky.org/docs/sdks/android) | [pubky/pubky-pulse-android](https://github.com/pubky/pubky-pulse-android) |

The SDK repositories are being rebuilt under the [pubky](https://github.com/pubky) org and are not published yet, so package names and coordinates may still change. Ingest is plain HTTP, so you do not have to wait for one.

## Local development

Requires Node.js >= 20, PostgreSQL >= 15 and pnpm 10.

```bash
pnpm install

createdb pubky_pulse
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, PORT, HOST, CORS_ORIGINS
                              # plus the four required PULSE_* identity variables

pnpm db:migrate               # tables plus the first event partitions
pnpm dev:seed                 # seed user, team, project (with an owner), app, API keys

pnpm dev:server               # API on http://localhost:4000
pnpm dev:web                  # dashboard and docs on http://localhost:3000
```

Sign-in is restricted to the email domains you configure. `PULSE_ALLOWED_EMAIL_DOMAINS`, `PULSE_DEFAULT_TEAM_NAME`, `PULSE_DEFAULT_TEAM_SLUG` and `PULSE_TEAM_OWNER_EMAIL` are required in every environment including local development — there are no defaults, and the server refuses to start without them. The seed inserts its own team (`Default Team` / `default`, owned by `admin@pulse.pubky.org`), so point those four at that team and domain if you seed, otherwise the startup bootstrap finds two active teams and stops.

`pnpm dev:seed` gives you a working account, team, project, app and API keys, and prints them; with no `RESEND_API_KEY` set, the sign-in code for the dashboard is printed to the API server console and written to `.dev-verification-code` instead of being mailed. To get data to look at, `pnpm dev:seed-events`, `pnpm dev:seed-issues` and `pnpm dev:seed-aggregates` generate synthetic events, error clusters and stats rollups.

Tests need their own database. `apps/server` test setup hardcodes `postgres://localhost:5432/pubky_pulse_test`, so create it under exactly that name and keep Postgres reachable on the default port as your local OS user:

```bash
createdb pubky_pulse_test
pnpm test                     # Vitest across the workspace
pnpm test:coverage            # server tests with coverage
```

`pnpm dev:unsafe-reset` truncates every table. It refuses to run when `NODE_ENV=production` or when the database name does not end in `_test`, so it is a way to reset the test database, not the development one.

CI pins pnpm 10.33.0 through corepack. Match it locally (`corepack prepare pnpm@10.33.0 --activate`) if you touch `pnpm-lock.yaml`, otherwise a different patch release can rewrite the lockfile.

## Self-hosting

The full walkthrough — system dependencies, PostgreSQL, nginx, SSL, environment variables, maintenance — is at [pulse.pubky.org/docs/self-hosting](https://pulse.pubky.org/docs/self-hosting).

Configuration is environment variables only. Four of them decide who may use the instance at all — `PULSE_ALLOWED_EMAIL_DOMAINS`, `PULSE_DEFAULT_TEAM_NAME`, `PULSE_DEFAULT_TEAM_SLUG` and `PULSE_TEAM_OWNER_EMAIL` — and the server refuses to start if any is missing or invalid. Point them at a fresh database: the bootstrap adopts or creates the team with the configured slug and fails if another active team already exists. Beyond those and `DATABASE_URL`, `JWT_SECRET`, `PORT`, `HOST` and `CORS_ORIGINS`, a production instance wants `PULSE_ATTACHMENTS_PATH` and `PULSE_ATTACHMENTS_SIGNING_SECRET` (the server refuses to start without the latter, and it must differ from `JWT_SECRET`), `API_PUBLIC_URL` and `WEB_APP_URL`, `COOKIE_DOMAIN`, `MAX_DATABASE_SIZE_GB` for the pruning safety net, and `RESEND_API_KEY` plus `EMAIL_FROM` if you want email out. `.env.example` documents each one. The dashboard is separate: its only variable, `NEXT_PUBLIC_API_URL`, goes in `apps/web/.env` (Next.js resolves env files relative to `apps/web`) and is inlined at build time, so set it before `pnpm build`.

The short version: `deploy/setup-ubuntu-vps.sh` provisions a fresh Ubuntu host (Node, PostgreSQL, nginx, pm2). The application lives in `/opt/pubky-pulse` and runs as two pm2 processes, `pulse-api` and `pulse-web`. Event attachments are written to `/opt/pubky-pulse-attachments`, outside the database — back that directory up alongside `pg_dump`, and exclude it from the dump itself.

## Documentation

Documentation is served by the dashboard app and published at [pulse.pubky.org/docs](https://pulse.pubky.org/docs) (placeholder until DNS is set up):

- [Getting started](https://pulse.pubky.org/docs/getting-started) — from empty database to first event
- [Concepts](https://pulse.pubky.org/docs/concepts) — events, issues, feedback, attachments, metrics, funnels, jobs and more
- [MCP](https://pulse.pubky.org/docs/mcp) — endpoint, tool reference and editor setup
- [API reference](https://pulse.pubky.org/docs/api-reference) — the core REST routes with request and response examples (feedback, questionnaires and stats are covered by the MCP and concept pages)
- [SDKs](https://pulse.pubky.org/docs/sdks) — web, Node.js, Swift and Android
- [Self-hosting](https://pulse.pubky.org/docs/self-hosting) — VPS setup, nginx, pm2, SSL, configuration
- [FAQ](https://pulse.pubky.org/docs/faq) — platforms, licensing, and how this differs from hosted analytics tools

Running locally, the same pages are at `http://localhost:3000/docs`. They are MDX files under `apps/web/content/docs`, so a documentation fix is an ordinary pull request.

## License

MIT — see [LICENSE](./LICENSE).

## History

Pubky Pulse started as a copy of the owlmetry monorepo; the pre-rework tree is tagged `owlmetry-baseline`.
