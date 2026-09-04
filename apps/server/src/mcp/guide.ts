export const GUIDE_CONTENT = `# Pubky Pulse — Agent Guide

Pubky Pulse is a self-hosted analytics platform for web, backend and mobile apps. It captures events, structured metrics, and funnel conversions from its SDKs (Web, Node, Swift, Android), stores them in a partitioned PostgreSQL database, and exposes query and management APIs.

You are connected via MCP using an **agent key** (\`pulse_agent_...\`). Agent keys are for reading data and managing resources. **Client keys** (\`pulse_client_...\`) are used by SDKs for event ingestion — you will not ingest events yourself, but you will retrieve client keys when creating apps for SDK configuration. **Import keys** (\`pulse_import_...\`) are for bulk-importing historical event data — you can create these with the \`create-import-key\` tool.

## Resource Hierarchy

Pubky Pulse organises resources in a **Team → Project → Apps** hierarchy:

- **Team** — the deployment's single configured team. Every allowed user belongs to it, and all resources (projects, apps, keys) are team-scoped. Use \`whoami\` to see your team and permissions.
- **Project** — groups related apps under one product (e.g., "MyApp" project). Metrics and funnels are defined at the project level so they span all apps in the project. Each project has configurable data retention policies for events (default: 120 days), metrics (default: 365 days), and funnels (default: 365 days).
- **App** — represents a single deployable artifact. Each app has a \`platform\` (\`apple\`, \`android\`, \`web\`, \`backend\`) and, for non-backend platforms, a \`bundle_id\`. On \`apple\` and \`android\` the bundle id is the reverse-DNS bundle identifier (\`com.example.acme\`); on \`web\` it is the **site identifier** — the site's host reads best (\`app.acme.com\`) — and it is what the SDK sends as \`bundleId\`, not a URL. A \`web\` app additionally carries \`allowed_origins\`, the browser origins its client key may send from (editable at any time, unlike \`bundle_id\`). Creating an app auto-generates a \`client_secret\` for SDK use.

Projects group apps cross-platform: a web front-end, a mobile app, and their backend API can share the same project, enabling unified funnel and metric analysis across all of them.

## Access Model

Your agent key was created by a person. **Reads are wide, writes are narrow**, and the difference is that person's project ownership:

- **Reads** span every project in the configured team, for each read permission your key holds. There is nothing to unlock per project — if \`list-projects\` shows it, you can read it.
- **Writes** additionally require your key's **creator** to currently own the target project. Ownership lives in a per-project owner list, not in a team role.

Authorization for a write is an **intersection, never a union** — every one of these must hold:

\`\`\`text
allowed = key is active
       AND key has the route's explicit permission
       AND creator is an active team member on an allowed email domain
       AND creator currently owns the target project
       AND the operation is agent-supported
\`\`\`

Holding \`projects:write\` does not by itself let you write to a project; owning a project does not by itself substitute for the permission. A refusal is a \`403\` with the reason in the message (\`Missing permission: ...\` vs \`Requires project ownership\`), so read the error rather than retrying blindly.

**Ownership is re-read on every request.** When a human adds your creator to a project — or removes them — the very next tool call reflects it. The key is never recreated, re-issued, or reconnected for an ownership change to take effect.

**\`create-project\` makes your key's creator the project's first owner**, atomically with the project row. The key itself never owns anything: a key is not a person.

**Human-only operations** — these return \`403\` for any agent key, even one whose creator owns the project and whose permissions are complete:

- changing a project's owner list (add/remove owners);
- deleting a project, an app, a feedback item, a questionnaire, a questionnaire response, or an attachment;
- deleting a comment written by anyone other than this exact key.

**Agent-supported writes** — allowed with ownership plus the right permission:

- creating and updating projects, apps, metric and funnel definitions, and questionnaires;
- deleting metric and funnel definitions;
- merging issues and changing issue / feedback / questionnaire-response status;
- triggering and cancelling project-scoped jobs;
- creating comments, and editing or deleting comments **this exact key** authored (MCP exposes comment creation only — editing and deleting a comment go through the REST API or the dashboard).

**Comments are the one exception to the ownership rule.** Any team member — and any agent key whose creator is one — may comment on any project they can read, so long as the key holds the route's write permission (\`issues:write\`, \`feedback:write\`, \`questionnaires:write\`). The exception replaces *only* the ownership check: authentication, containment and permission still apply. Comment authorship is bound to the exact key, so one agent key cannot edit or delete another key's comment, or its creator's own human comment, even under the same creator.

## Discovering IDs

Start with \`whoami\` to see your team, then drill down:

- **Team ID**: \`whoami\` → \`teams[].id\`
- **Project ID**: \`list-projects\` → \`projects[].id\`
- **App ID**: \`list-apps\` → \`apps[].id\` (also returns \`client_secret\`)
- **Metric/Funnel slug**: \`list-metrics\` / \`list-funnels\` → \`[].slug\`

All list tools support an optional \`team_id\` parameter to scope results.

## Concepts

### Events
Events are raw log records emitted by SDKs — every \`Pulse.info()\`, \`Pulse.error()\`, \`Pulse.step()\`, etc. Each event has:
- **level**: \`info\`, \`debug\`, \`warn\`, \`error\`
- **message**: the log message or event name
- **session_id**: unique per SDK \`configure()\` call, groups events in a session. See **Cross-SDK Session Correlation** below for the client-to-backend pattern.
- **user_id**: optional, set via identity claim
- **screen_name**: optional, from SDK screen tracking. On \`web\` this is the URL **path** (\`/checkout/payment\`) — no origin, no query string
- **environment**: the runtime — \`ios\`, \`ipados\`, \`macos\`, \`watchos\`, \`android\`, \`web\`, \`backend\`
- **device_model** / **os_version**: the reporting device. On native apps the hardware model (\`iPhone15,2\`) and OS version (\`18.0\`); on \`web\` the **browser** and its major version (\`Chrome 120\`) and the OS name and version (\`macOS 10.15.7\`), both parsed from the user agent and both absent when the browser reports too little to parse
- **build_number**: native only — web events never carry one, so use \`app_version\` for browser releases
- **custom_attributes**: freeform JSONB data

Query events when debugging specific issues, investigating user behavior, or reviewing what happened in a time window. Default range is last 24 hours.

**Reserved attribute keys.** Underscore-prefixed \`custom_attributes\` keys are reserved for SDK and platform use — do not invent your own. Values are capped at 200 characters, with per-key exceptions noted below:

- \`_error_type\` / \`_error_stack\` / \`_error_code\` / \`_error_domain\` — extracted when a consumer passes an error object to \`Pulse.error()\`. \`_error_stack\` is capped at 16000 instead of 200. \`_unhandled\` marks an error the SDK caught rather than one the app logged.
- \`_http_url\` / \`_http_method\` / \`_http_status\` / \`_http_duration_ms\` — auto-instrumented network requests. \`_http_status\` is \`"0"\` when the request never completed.
- \`_page_url\` / \`_referrer\` — browser page context, capped at 2048 each. \`screen_name\` holds only the path, so these are where the full URL (query string included) and the referrer live.

### Cross-SDK Session Correlation

Every SDK emits events under a \`session_id\`. By default the Node SDK's session is **per-process** — shared across every request the process handles — which is almost never what you want for a multi-client backend. To make client and backend events show up together under one session, forward the client's session id with each request.

The pattern (client → backend):

1. **Client (Web / Swift / Android)**: read \`Pulse.sessionId\` and attach it to outgoing requests as an \`X-Pulse-Session-Id\` header — the Web SDK does this for you on \`fetch\` requests whose URL matches a \`propagateSessionTo\` prefix (requests made with \`XMLHttpRequest\` or \`sendBeacon\` are not annotated and must set the header themselves).
2. **Backend (Node)**: pull the header off the request and either wrap the handler in \`Pulse.withSession(sessionId)\` (all events inside that scope pick it up) or pass \`{ sessionId }\` to each individual log call.

**Precedence**: per-call \`options.sessionId\` > \`withSession(...)\` scope > default session from \`configure()\`. Non-UUID values are silently ignored, so it is safe to forward the header unconditionally.

Result: one logical user interaction (tap → API call → DB query → response → UI update) lands under a single \`session_id\`. \`investigate-event\` and \`query-events\` with \`session_id\` filters then return the full cross-app timeline automatically. Wire this up on any project that pairs a client app with a Node backend — it is the whole point of grouping them under one project.

### Structured Metrics
Metrics are project-scoped definitions that tell Pubky Pulse what structured data to expect. Two kinds:

- **Lifecycle metrics**: track operations with a start → complete/fail/cancel flow. Use for things with duration — API calls, uploads, database queries. The SDK auto-tracks \`duration_ms\`. Phases: \`start\`, \`complete\`, \`fail\`, \`cancel\`.
- **Single-shot metrics** (\`record\` phase): record a point-in-time measurement. Use for snapshots — cache hit rates, queue depth, cold start time.

The metric definition must exist on the server **before** the SDK emits events for that slug. Create definitions with \`create-metric\`.

Aggregation queries (\`query-metric\`) return: total count, counts per phase, success rate, duration percentiles (avg, p50, p95, p99), unique users, and error breakdown. Results can be grouped by app, version, environment, device, OS, or time bucket.

Metric slugs: lowercase letters, numbers, hyphens only (\`/^[a-z0-9-]+$/\`).

### Funnels
Funnels measure how users progress through a multi-step flow and where they drop off. Each funnel has ordered steps with an \`event_filter\` matching on \`step_name\` and/or \`screen_name\`.

The \`step_name\` in the filter matches what developers pass to \`Pulse.step("step-name")\` — no prefix transformation needed.

Two analysis modes:
- **Open mode** (default): independent — each step counts distinct users separately, regardless of other steps. Good for non-linear flows.
- **Closed mode** (\`mode: "closed"\`): sequential — users must complete steps in order with strict timestamp ordering per \`user_id\`. Events with no \`user_id\` are excluded. Good for linear flows like checkout.

Maximum 20 steps per funnel. Funnel slugs follow the same rules as metric slugs.

### Data Modes
The \`data_mode\` parameter filters development vs production events:
- \`production\` (default) — real user data only
- \`development\` — test/debug data only (SDKs auto-detect: DEBUG builds on Apple platforms, debuggable builds on Android, \`NODE_ENV !== "production"\` on Node, \`localhost\`/\`127.0.0.1\`/\`file:\` pages on Web — override with \`isDev\` in \`configure()\`)
- \`all\` — both

Available on: \`query-events\`, \`query-metric\`, \`list-metric-events\`, \`query-funnel\`.

### Time Formats
All time parameters (\`since\`, \`until\`) accept:
- **Relative durations**: \`30s\`, \`30m\`, \`1h\`, \`7d\`, \`1w\` (backwards from now)
- **ISO 8601 dates**: \`2025-01-15T10:00:00Z\`

Default ranges: events = 24 hours, funnels = 30 days, metrics = 24 hours.

### User Properties
Custom key-value properties stored on project-level users. Users are unique per project, not per app — the same user ID seen from multiple apps (e.g., a web front-end, a mobile app, and their backend) is a single user. Each user tracks which apps they've been seen from. Properties are set via SDK (\`setUserProperties()\`). Properties are shallow-merged on update; empty string values delete keys. Limits: 50 keys max, 50-char keys, 200-char values.

### Issues
Error events are automatically scanned hourly and grouped into **issues** via fingerprinting (normalized error message + source module, plus optional discriminator). The discriminator is set for two cases: \`sdk:network_request\` errors discriminate on \`METHOD host/templated_path\` from \`_http_url\`/\`_http_method\`, and any error event carrying an \`_error_type\` reserved attribute (set by the SDKs when consumers call \`Pulse.error(error)\` with an Error/Exception value) discriminates on the runtime type so different error classes with identical wording stay on separate issues. For \`web\` events the message is first canonicalized across browsers — Chrome's \`Cannot read properties of undefined (reading 'total')\`, Firefox's \`can't access property "total", cart is undefined\` and Safari's \`undefined is not an object (evaluating 'cart.total')\` are one issue, not three — so do not assume a browser-specific title means a browser-specific bug. Each issue tracks:
- **Occurrences**: one per unique session. Each occurrence records the \`session_id\`, \`user_id\`, \`event_id\`, \`app_version\`, \`environment\`, and the reporting device — \`device_model\` and \`os_version\`, which on \`web\` are the browser (\`Chrome 120\`) and the OS (\`macOS 10.15.7\`) — use these to drill into what happened, and to tell a browser-specific or OS-specific fault from a universal one.
- **Unique users**: how many distinct users are affected (severity indicator)
- **Status lifecycle**: \`new\` → \`in_progress\` (claimed by agent/user) → \`resolved\` (the app version where the fix was applied is **required** — it powers regression detection) → may \`regress\` if the error reappears in a newer version. Two off-ramps stop notifications without claiming a fix: \`silenced\` (terminal — stays silent even if the error keeps happening; use for transient infra blips), and \`snoozed\` (auto-reverts to \`new\` and re-fires \`issue.new\` on the very next occurrence; use when you suspect a one-off and only want to be alerted if the assumption turns out wrong).
- **Comments**: investigation notes from users (\`👤\`) and agents (\`🕶️\`). Markdown supported.
- **Merge**: if two issues turn out to be the same problem, merge them — all fingerprints, occurrences, and comments move to the target.
- **Notifications**: two types fire on production issues. \`issue.new\` is an in-app-by-default summary that fires from \`issue_scan\` at the end of every hourly run when anything was just created or regressed (one alert per team per scan). \`issue.digest\` is the per-project email-by-default digest gated by \`issue_alert_frequency\` (none/hourly/6-hourly/daily/weekly). See the Notifications section for per-channel defaults.

**Session-burst aliasing**: when multiple error events fire in the same session within 5 seconds, the scan aliases their fingerprints onto a single issue — a loader throwing + a caller logging + an \`op.fail()\` all collapse into one. Conservative: two pre-existing issues never auto-merge, only newly-seen fingerprints attach to a co-occurring existing issue. Dev and prod remain separate.

Dev events (\`is_dev = true\`) create separate issues — they are tracked but never trigger notifications.

#### Investigating an issue

To fully investigate an issue, follow this workflow:

1. **Find the issue**: \`list-issues\` with \`project_id\` to see open issues, most recently active first (a new occurrence, status change, or comment). Sort the results by \`unique_user_count\` to prioritise by severity (users affected). Filter by \`status: "new"\` to focus on uninvestigated issues.
2. **Claim it**: \`claim-issue\` to set status to \`in_progress\`, signaling that you're investigating.
3. **Read the detail**: \`get-issue\` returns the issue with its \`occurrences\` array. Each occurrence represents a unique session where the error happened and includes:
   - \`session_id\` — the session where the error occurred
   - \`user_id\` — the affected user (null if anonymous)
   - \`event_id\` — the specific error event
   - \`app_version\` / \`environment\` — which build and platform
   - \`device_model\` / \`os_version\` — the device, or on \`web\` the browser and OS. Compare across occurrences: all-Safari points at a browser bug, mixed points at your code
   - \`timestamp\` — when it happened
4. **Reconstruct breadcrumbs**: For each occurrence, call \`investigate-event\` with the \`event_id\` to get the best timeline we can build — the full session (or a ±5 min window for events without a session_id), enriched with cross-app events (e.g. backend) for the same user in the same project. Results come merged, deduped, and sorted ascending by timestamp. Pass \`compact: true\` to drop verbose fields (custom_attributes, device metadata) and avoid MCP token overflow on long timelines.
5. **Read the error event**: Use \`get-event\` with the occurrence's \`event_id\` to see the full error details including \`custom_attributes\` (stack traces, error codes, etc.).
6. **Iterate every occurrence, then look for patterns**: Repeat steps 4-5 across the occurrences returned by \`get-issue\` — one breadcrumb is rarely enough, the goal is to surface what they have in common (same screen, same \`app_version\`, same user flow, same preceding step). If \`occurrence_has_more\` is true on the \`get-issue\` response, call \`get-issue\` again with the returned \`occurrence_cursor\` to walk the next page. For very high-frequency issues, a representative sample across occurrences is fine — sample broadly enough to be confident the pattern is real.
7. **Document findings**: \`add-issue-comment\` to record what you found — root cause, the common pattern across occurrences, affected versions, reproduction steps, or a fix plan. This is visible to the team.
8. **Resolve or escalate**: \`resolve-issue\` with the fix version once patched (the version is required so the regression detector has something to compare against). Use \`silence-issue\` when there's nothing to fix and you don't want to hear about it again. Use \`snooze-issue\` when you suspect a one-off — same as silence but auto-reopens to \`new\` if the error recurs. Leave the comment for the team to act on otherwise.

### Feedback
Free-text user feedback. Three ingest paths: mobile apps via the Swift and Android SDKs (\`PulseFeedbackView\` / \`Pulse.sendFeedback\`), browsers via the Web SDK's \`Pulse.sendFeedback\` (called directly from the page, no proxy needed — API only, bring your own form), and server handlers via the Node SDK (\`Pulse.sendFeedback\`) — use the Node path when a team collects feedback through their own frontend (form, chat widget, support page) and wants it forwarded into Pubky Pulse. Each feedback row captures \`message\`, optional \`submitter_name\` and \`submitter_email\`, plus the session, user, app version, device, environment, and country — automatic in the mobile and web SDKs, caller-supplied on Node.

- **Status lifecycle** — free transitions between \`new\`, \`in_review\`, \`addressed\`, \`dismissed\`. No forced order; \`dismissed\` is the "not actionable" state. Changing status needs \`feedback:write\` **and** your creator's ownership of the project.
- **Comments** — investigation notes from users (\`👤\`) and agents (\`🕶️\`), mirror the issue-comment model. Commenting is the ownership exception: any reader with \`feedback:write\` may comment.
- **Session link** — \`session_id\` on the feedback row maps to the full event stream; pass it to \`investigate-event\` with any event from that session to reconstruct the breadcrumb timeline around the complaint.
- **Delete** — human-only, and there is no MCP tool for it by design: use \`update-feedback-status → dismissed\` for "not actionable" instead.

Typical workflow: \`list-feedback\` filtered to \`status: "new"\` → \`get-feedback\` to read the message and linked session → \`investigate-event\` on an event from that session to understand what the user was doing → \`add-feedback-comment\` with root cause or a cross-link to a related issue → \`update-feedback-status\` to \`in_review\` or \`addressed\`.

### Questionnaires
Structured multi-question surveys, complementary to free-text feedback. Each questionnaire has an immutable \`slug\` and a JSON \`schema\` of up to 30 questions (\`text\`, \`single_choice\`, \`multi_choice\`, \`rating\` 1–5, \`nps\` 0–10). The Swift and Android SDKs fetch the spec by slug and render it via \`PulseQuestionnaireView\` (or auto-trigger it on the Nth launch — SwiftUI's \`.pulseQuestionnaire(...)\` view modifier, Compose's \`PulseQuestionnaireGate\` wrapper). The Web SDK exposes the same server flow as an API and ships no UI: \`Pulse.fetchQuestionnaire(slug, { force })\` returns the spec plus \`inProgress\` for resume and \`ineligibleReason\`, \`Pulse.saveQuestionnaireResponse(slug, answers, isComplete)\` writes drafts and the final submission, and \`Pulse.dismissQuestionnaires()\` records the opt-out — the form is the caller's. Each submitted response stores its own \`schema_snapshot\` (captured at completion) so editing the parent definition never retroactively changes how historical answers render.

- **Progressive responses** — the mobile SDKs persist answers on every Next tap, not just on Submit, and a web caller does the same with \`saveQuestionnaireResponse(slug, answers, false)\`. A user who answers Q1 then quits has a row in \`questionnaire_responses\` with \`submitted_at = null\`, \`status = 'draft'\`, \`schema_snapshot = null\`, and \`{q1: ...}\` in \`answers\`. Subsequent Next taps merge new keys onto the same row (re-saves overwrite). On the final Submit, \`submitted_at\` flips to non-null, \`status\` becomes \`new\`, and the live schema is snapshotted. The team notification fires only on the flip — drafts don't ping. Drafts appear in \`list-questionnaire-responses\` and \`get-questionnaire-analytics\` by default (so abandonment shows up as a drop-off curve in the per-question rollups); pass \`submitted_only: true\` to filter them out.
- **Resume across launches** — if a user has an unsubmitted draft, \`GET /v1/questionnaires/:slug\` (the SDK eligibility check) returns \`in_progress: { response_id, answers }\` alongside the spec, and the SDK lands them at the first unanswered question with prior answers pre-filled.
- **Slug** — immutable after creation. The client SDKs reference it directly; renaming would orphan the in-app integration.
- **Dismissal** — when a user taps "Don't show again" in any questionnaire sheet (or a web caller invokes \`Pulse.dismissQuestionnaires()\`), the SDK calls \`POST /v1/questionnaires/dismiss\` and the server writes \`_questionnaires_dismissed_at\` to \`app_users.properties\`. Globally one-and-done across every questionnaire in the project for that user — survives reinstall.
- **One response per user per slug** — partial unique index drives the race-safe upsert; duplicate completed submission returns 409 \`already_responded\`. Drafts can resume any number of times until completion.
- **Schema versioning** — none in V1. Edits to a questionnaire's \`schema\` apply going forward; submitted responses keep their captured \`schema_snapshot\`. Drafts render against the live schema until completion — at submit time, answers whose question id is no longer in the schema are pruned.
- **Status lifecycle** — \`draft\` (unsubmitted) → on completion → \`new\` → \`in_review\` → \`addressed\` / \`dismissed\` (free transitions after submission).
- **Comments** — same model as feedback comments. Editing is author-only, always. Deleting is the author, or a human project owner moderating someone else's comment — an agent key never moderates, whoever created it.
- **Delete** — \`delete-questionnaire\` and deleting a response are human-only (agent keys get \`403\`). Existing responses are preserved.

Typical workflow: \`create-questionnaire\` with a slug + schema → wait for SDK responses → \`get-questionnaire-analytics\` for the rolled-up distribution per question (drafts included by default to show drop-off) → \`list-questionnaire-responses\` to drill into individual answers → \`add-questionnaire-response-comment\` to flag interesting feedback for teammates.

### Event Attachments (limited resource)
SDKs can optionally upload a file alongside an error event (e.g. the input image that failed to convert, a 3D model file that failed to parse). These show up as \`attachments\` on \`get-event\` and \`get-issue\` responses and can be downloaded via \`get-attachment\` which returns a short-lived signed URL.

**Attachments are a limited, finite resource.** Each project has a storage quota (default 5 GB) and each end-user has their own bucket within that project (default 250 MB per user). Uploads that would exceed the per-user bucket are rejected with \`413 user_quota_exhausted\`; ones that would exceed the project ceiling return \`413 quota_exhausted\`. Either way the event still posts, but the attachment does not. Before asking a user to re-run a scenario with a file attached, call \`get-project-attachment-usage\` (optionally with that user's \`user_id\`) so you know whether there's headroom.

**When attachments help investigations**:
- A media-conversion error where the input bytes are needed to reproduce the bug.
- A model-load failure where the file format itself is the suspect.
- A parse error on a file whose bytes you cannot reconstruct from event attributes alone.

**When they don't**:
- Routine errors whose root cause is obvious from the message or stack trace.
- Data you can already reconstruct from \`custom_attributes\` or breadcrumbs.
- Frequent/high-volume errors — the quota will fill almost immediately.

Attachments linked to an event are automatically linked to its issue by the issue-scan job. They survive event retention pruning as long as the issue is still open, and are hard-deleted 7 days after the issue (or the attachment itself) is soft-deleted. Use \`delete-attachment\` once an issue is confirmed resolved and the file is no longer useful.

### Time-Series Rollups
Daily and hourly pre-aggregated counts for **events** (with derived \`users\` and \`sessions\` columns), **metric_completions**, **funnel_completions**, and **questionnaire_responses**. Two tables per kind — \`*_daily\` keyed on a \`day\` (UTC date) column, \`*_hourly\` keyed on an \`hour\` (UTC \`timestamptz\`) column. Backs the subtle sparkline charts on the main dashboard cards today and arbitrary time-range trend pages going forward.

Two rows are written for each (project, is_dev, bucket, kind-specific dimensions):
- A **per-app row** (\`app_id\` not null).
- A **project-rollup row** (\`app_id\` is null) summing across every app in the project. Distinct user / session counts in the rollup are **project-level distincts** (a user active on two apps counts once), not the sum of per-app distincts.

Read with \`query-stats-bucketed\`. The endpoint reads the per-app row when an \`app_id\` is supplied, otherwise the rollup row — single-row reads, no SUM at query time. \`excluding_current=true\` (default) drops the in-progress bucket so a partial day or hour can't show as a misleading dip.

Aggregation runs every hour at \`:05\` UTC (re-aggregates the trailing 3 hours) and every day at \`00:30\` UTC (re-aggregates the trailing 3 days). Historical backfills run through \`trigger-job\`: pass \`job_type: "stats_aggregate_daily"\` (or \`stats_aggregate_hourly\`) with a \`project_id\` and \`start\`/\`end\` params — both types are project-scoped, so they are triggerable via MCP and the API. Owners can alternatively run \`pnpm backfill\` on the production VPS to refresh the trailing 365 days.

**Retention**: these tables are **not** subject to retention pruning or soft-delete cleanup. The counts are anonymous (no user / session IDs, only COUNT DISTINCT values) and kept indefinitely so historical sparklines and year-views survive even after raw events have aged out.

### Background Jobs
Asynchronous server-side tasks with progress tracking and optional email notifications. Used for long-running operations like bulk syncs. Only one instance of each job type (per project) can run at a time — duplicates return an error.

### Notifications
Pubky Pulse has a unified, multi-channel notification system: each user-facing event (new feedback, new/regressed issues, manual job completion) writes a row to the user's inbox \`notifications\` table and fans out to whichever channels the user has enabled — in-app and email (Resend). New channels (Telegram, Slack, etc.) plug in as new \`ChannelAdapter\`s without producer changes. Per-user preferences live under \`users.preferences.notifications.types\` and are merged into \`PATCH /v1/auth/me\`. Sign-in verification codes stay transactional (sent directly via EmailService) because their recipient may not yet be a user; there is no invite flow to email, since access is granted by configured email domain. **Notifications are user-scoped, not team-scoped, so they do not have MCP tools** — humans read them in the web dashboard (\`/dashboard/notifications\`).

**Issue notification types** — there are two:
- \`issue.new\` fires from \`issue_scan\` at the end of every hourly run, with one alert per team summarizing all production issues that were just created or regressed. Defaults: in_app on, email off. Bypasses any cadence throttle, so the alert lands within ~5 min of detection.
- \`issue.digest\` fires from \`issue_notify\` at the project's \`issue_alert_frequency\` (none/hourly/6-hourly/daily/weekly). Defaults: email only (in_app off so the digest doesn't double up with the instant \`issue.new\` alert). Project-level rate limit / batching policy.

### Audit Trail
Every mutation (create, update, delete) on resources is recorded in audit logs with the actor, action, resource type, resource ID, and metadata. Query with \`list-audit-logs\`.

## Tool Reference

### Auth
- \`whoami\` — Check identity, team, and permissions

### Projects
- \`list-projects\` — List every project in the team you can read (optional \`team_id\` filter). Each row carries \`owners\` and your creator's \`access_level\` (\`owner\` | \`viewer\`) — check it before attempting a write
- \`get-project\` — Get project by ID with nested apps, retention policies, \`owners\` and \`access_level\`
- \`create-project\` — Create project (needs \`projects:write\`; your key's creator becomes its first owner): \`team_id\`, \`name\`, \`slug\`, optional \`retention_days_events\`, \`retention_days_metrics\`, \`retention_days_funnels\`
  - **Naming (strict)**: project names MUST be the bare product name only — e.g. "Lofi". Never include a platform suffix ("Lofi iOS", "Lofi Backend") on the project itself; suffixes belong on apps within the project.
- \`update-project\` — Update project name, display color, or retention policies (needs \`projects:write\` **and** your creator's ownership of this project). Set retention to \`null\` to reset to defaults. \`color\` is \`#RRGGBB\` hex — auto-assigned on create, overridable here.

### Apps
- \`list-apps\` — List all apps (optional \`team_id\` filter)
- \`get-app\` — Get app by ID (includes \`client_secret\`)
- \`create-app\` — Create app (needs \`apps:write\` **and** ownership of \`project_id\`): \`name\`, \`platform\`, \`project_id\`, optional \`bundle_id\`, optional \`allowed_origins\`
  - Platforms: \`apple\`, \`android\`, \`web\`, \`backend\`
  - \`bundle_id\` required for non-backend, immutable after creation. On \`web\` it is the site identifier (\`app.acme.com\`)
  - \`allowed_origins\` — \`web\` only, rejected for other platforms. Full origins with no path and no trailing slash (\`["https://app.acme.com", "http://localhost:3000"]\`), at most 50; they are lowercased and their default ports dropped on write. A web app whose list is empty refuses every request carrying an \`Origin\` header, which is every request a browser makes — so create the app with the site's origins, including the developer's localhost port
  - Returns \`client_secret\` for SDK configuration
  - **Naming (strict)**: app names MUST always be \`<project name> <platform>\` — e.g. "Lofi iOS", "Lofi Android", "Lofi Web", "Lofi Backend". Never omit the platform suffix, even if the project name seems to imply a platform.
- \`update-app\` — Update an app's \`name\` and/or its \`allowed_origins\`, at least one of them (needs \`apps:write\` **and** ownership of the app's project). \`allowed_origins\` replaces the whole list, so send the origins you want to keep along with the new one. Deleting an app is human-only and has no MCP tool
- \`list-app-users\` — List users for an app (search, anonymous filter, \`data_mode\` dev/prod filter, pagination). A user's dev/prod flag is derived from their client (non-backend) events, last-write-wins; \`data_mode\` defaults to \`production\`.
- \`list-user-locales\` — Locale demand for deciding where to localize next. Returns \`by_locale\` (users grouped by their **wanted** language, e.g. \`fr-FR\`, \`pt-BR\` — \`Locale.preferredLanguages.first\` on Apple, \`navigator.language\` in a browser — each with a \`shipped\` flag) and \`by_country\` (works for every user today, no SDK upgrade needed). Narrow with \`project_id\` and/or \`app_id\` to populate the \`shipped\`/gap flags (\`shipped: false\` = demand for a language the app doesn't ship yet); \`team_id\` ⊥ \`project_id\` ⊥ \`app_id\`. \`shipped\` is \`null\` (no flag) across multiple apps. The language signal fills in as users upgrade to the SDK that reports preferred language; until then lean on the country breakdown.

#### Latest version detection
Every app response includes \`latest_app_version\` and \`latest_app_version_updated_at\`. The value is computed from ingested data: the highest \`app_version\` seen across the app's production events in the last 90 days. Refreshed hourly by the \`app_version_sync\` system job. To compare a user/event/issue version against the latest, use string equality with the app's \`latest_app_version\` (semver-aware comparison only matters for ordering — equality is enough to flag "on latest"). \`app_version_sync\` is a **system** job and cannot be triggered via MCP or the API (the trigger route rejects system-scoped types) — the hourly run picks up new versions on its own.

### Events
- \`query-events\` — Filter by project, app, level, user, session, environment, screen, \`device_model\` (the browser on web), \`os_version\`, time, data mode. \`screen_name\` matches exactly or as a path prefix, so \`/checkout\` also returns \`/checkout/payment\` but not \`/checkout-abandoned\`. Cursor pagination. Pass \`order: "asc"\` to walk events chronologically (default \`desc\`/newest-first). Pass \`compact: true\` to drop verbose fields. **Not the right tool for issue investigation** — use \`investigate-event\` for that, which builds a richer breadcrumb (full session + cross-app events) directly from an occurrence's \`event_id\`. Reach for \`query-events\` for ad-hoc filter-driven searches.
- \`get-event\` — Get full event details by ID
- \`investigate-event\` — **The standard tool for investigating an issue's occurrences.** Given an \`event_id\` (typically from a \`get-issue\` occurrence), pulls the full session (or ±window_minutes if no session_id), then enriches with cross-app events for the same user in the same project. Returns a single chronological \`events\` array with \`target_event_id\`. Run across **multiple** occurrences of the same issue to surface common patterns. Supports \`compact: true\`.

### Metrics
- \`list-metrics\` — List definitions. \`project_id\` for one project; \`team_id\` lists every metric across all accessible projects (mutually exclusive)
- \`get-metric\` — Get definition by slug
- \`create-metric\` — Create definition (needs \`metrics:write\`): \`project_id\`, \`name\`, \`slug\`
- \`update-metric\` — Update definition (needs \`metrics:write\`)
- \`delete-metric\` — Soft-delete (needs \`metrics:write\`)
- \`query-metric\` — Aggregated stats with optional grouping
- \`list-metric-events\` — Raw metric events with phase/tracking_id filters

### Funnels
- \`list-funnels\` — List definitions. \`project_id\` for one project; \`team_id\` lists every funnel across all accessible projects (mutually exclusive)
- \`get-funnel\` — Get definition by slug with steps
- \`create-funnel\` — Create with ordered steps (needs \`funnels:write\`): \`project_id\`, \`name\`, \`slug\`, \`steps\`
- \`update-funnel\` — Update name, description, or steps (needs \`funnels:write\`)
- \`delete-funnel\` — Soft-delete (needs \`funnels:write\`)
- \`query-funnel\` — Conversion analytics with mode (open/closed) and grouping

### Issues
- \`list-issues\` — List issues for a project (filter by status, app, dev/prod). Each issue includes \`first_seen_app_version\` / \`last_seen_app_version\` (denormalised from occurrences) — compare \`last_seen_app_version\` against the app's \`latest_app_version\` to tell whether the issue is still happening on the current release.
- \`get-issue\` — Get issue detail with occurrences, comments, fingerprints, and linked attachments
- \`resolve-issue\` — Mark resolved (fix version required — used for regression detection)
- \`silence-issue\` — Silence notifications (still tracks occurrences)
- \`reopen-issue\` — Reopen a resolved or silenced issue
- \`claim-issue\` — Set status to in_progress (claim for investigation)
- \`merge-issues\` — Merge source issue into target (moves all data, deletes source)
- \`list-issue-comments\` — List investigation comments on an issue
- \`add-issue-comment\` — Add a comment to document findings or fixes

### Feedback
- \`list-feedback\` — List user feedback for a project (filter by status, app, dev/prod)
- \`get-feedback\` — Get feedback detail with comments
- \`update-feedback-status\` — Transition status (\`new\` | \`in_review\` | \`addressed\` | \`dismissed\`)
- \`add-feedback-comment\` — Attach an investigation note or cross-link

### Questionnaires
- \`list-questionnaires\` — List questionnaire definitions in a project
- \`get-questionnaire\` — Get definition + schema + response_count
- \`create-questionnaire\` — Create with slug (immutable) + schema
- \`update-questionnaire\` — Patch name, description, schema, app_id, is_active
- \`delete-questionnaire\` — ⚠️ Human-only (agent keys 403); responses preserved
- \`list-questionnaire-responses\` — List responses with filters + pagination
- \`get-questionnaire-response\` — Read individual response with comments + schema_snapshot
- \`update-questionnaire-response-status\` — Triage state
- \`add-questionnaire-response-comment\` — Annotate a response
- \`get-questionnaire-analytics\` — Per-question distribution (counts, averages, NPS score)

### Attachments
- \`list-attachments\` — filter by event, issue, or project
- \`get-attachment\` — metadata + 60-second signed download URL
- \`delete-attachment\` — ⚠️ Human-only (agent keys 403). Humans soft-delete once the file is no longer useful, freeing quota
- \`get-project-attachment-usage\` — check quota headroom before recommending re-runs

### Time-Series Rollups
- \`query-stats-bucketed\` — bucketed counts (daily or hourly) for \`events | users | sessions | metric_completions | funnel_completions | questionnaire_responses\`. Pass \`project_id\` or \`team_id\` (mutually exclusive); optional \`app_id\` to narrow; \`days\` / \`hours\` for trailing windows, or \`from\` / \`to\` for explicit ranges. \`slug\` filters to one metric / funnel / questionnaire. Returns a zero-padded chronological series of \`{bucket, value}\` pairs. Use this for sparklines, trend pages, or any "how has X changed over time" question — cheaper and more honest than re-aggregating raw events.

### Jobs
- \`list-jobs\` — List job runs for a team (filter by type, status, project, date)
- \`get-job\` — Get job details with progress
- \`trigger-job\` — Trigger a job (needs \`jobs:write\` **and** ownership of the target project): \`team_id\`, \`job_type\`, \`project_id\` (every triggerable job is project-scoped), optional \`params\`, \`notify\`
- \`cancel-job\` — Cancel a running job (cooperative cancellation; same permission and ownership as triggering it)

### Audit Logs
- \`list-audit-logs\` — Query the team-wide audit trail (needs \`audit_logs:read\` **and** a creator who is the team owner — it spans every project, so it is an oversight surface): filter by resource_type, actor, action, date

## Permissions

Your agent key has specific permissions. They are **necessary but not sufficient** for a write: a write also needs your key's creator to own the target project (see **Access Model** above). Common permission sets:

| Permission | Grants |
|---|---|
| \`events:read\` | query-events, get-event, investigate-event |
| \`projects:read\` | list-projects, get-project |
| \`projects:write\` | create-project, update-project |
| \`apps:read\` | list-apps, get-app, list-app-users, list-user-locales |
| \`apps:write\` | create-app, update-app |
| \`metrics:read\` | list-metrics, get-metric, query-metric, list-metric-events |
| \`metrics:write\` | create-metric, update-metric, delete-metric |
| \`funnels:read\` | list-funnels, get-funnel, query-funnel |
| \`funnels:write\` | create-funnel, update-funnel, delete-funnel |
| \`issues:read\` | list-issues, get-issue, list-issue-comments |
| \`issues:write\` | resolve-issue, silence-issue, reopen-issue, claim-issue, merge-issues, add-issue-comment |
| \`feedback:read\` | list-feedback, get-feedback |
| \`feedback:write\` | update-feedback-status, add-feedback-comment |
| \`questionnaires:read\` | list-questionnaires, get-questionnaire, get-questionnaire-analytics, list-questionnaire-responses, get-questionnaire-response |
| \`questionnaires:write\` | create-questionnaire, update-questionnaire, update-questionnaire-response-status, add-questionnaire-response-comment |
| \`jobs:read\` | list-jobs, get-job |
| \`jobs:write\` | trigger-job, cancel-job |
| \`audit_logs:read\` | list-audit-logs |

Three different \`403\`s are worth telling apart:

- \`Missing permission: <permission>\` — the key was never granted that permission. A human has to update the key.
- \`Requires project ownership\` — the permission is there, but your key's creator does not own that project. A human project owner adds them to the owner list; the next call then succeeds, with no change to the key.
- \`This operation requires a user session\` — the operation is human-only (see **Access Model**). No permission or ownership change will unlock it; ask a human to do it.

## Typical Workflows

### Setting up a new project
1. \`whoami\` → get team ID and verify permissions
2. \`create-project\` → create project with name and slug (optionally set retention policies)
3. \`create-app\` → create app(s) for each platform, note the \`client_secret\`
4. Read the SDK integration guide for the platform — see **SDK Integration Guides** below
5. Configure the SDK with the \`client_secret\` and ingest endpoint

### Defining what to track
1. \`create-metric\` → for each measurable operation (API calls, load times, etc.)
2. \`create-funnel\` → for each user flow (onboarding, checkout, etc.)
3. Instrument the SDK code with the corresponding metric slugs and step names — see the SDK guides for API details

### Querying and analysis
1. \`query-events\` → search for specific events, errors, or user activity. Use \`session_id\` to reconstruct a full user session.
2. \`query-metric\` → aggregated performance stats with grouping
3. \`list-metric-events\` → drill into individual metric events
4. \`query-funnel\` → conversion rates and drop-off analysis

### Investigating issues
1. \`list-issues\` → find open issues (most recently active first; sort by \`unique_user_count\` for severity)
2. \`claim-issue\` → mark as in_progress
3. \`get-issue\` → read occurrences (each has \`session_id\`, \`event_id\`, \`user_id\`, \`app_version\`)
4. \`investigate-event\` with each occurrence's \`event_id\` (add \`compact: true\` for long timelines) → build the full breadcrumb (entire session + cross-app events for the same user). This is the standard issue-investigation move; do it for **every** occurrence, not just one.
5. \`get-event\` with \`event_id\` → read the full error details (custom_attributes, stack trace)
6. Iterate across occurrences and look for what they share — same screen, same \`app_version\`, same user flow. If \`occurrence_has_more\` is true, call \`get-issue\` again with the returned \`occurrence_cursor\` to walk the next page (sample broadly on very high-frequency issues).
7. \`add-issue-comment\` → document root cause, the shared pattern, and affected versions
8. \`resolve-issue\` → mark resolved with fix version

## SDK Integration Guides

This guide is served as the MCP resource \`pubky-pulse://guide\` — fetch it whenever you need the concepts, conventions, or SDK detail behind a tool. MCP is the agent interface: create projects and apps, define metrics and funnels, and query events with the tools (\`create-project\`, \`create-app\`, \`create-metric\`, \`create-funnel\`, \`query-events\`).

Pubky Pulse instruments web, backend and mobile apps. Four SDKs cover it — what each covers:

- **Web** ([github.com/Jasonvdb/pubky-pulse-web](https://github.com/Jasonvdb/pubky-pulse-web)) — framework-agnostic browser SDK (\`@synonymdev/pubky-pulse-web\`): package installation, \`Pulse.configure()\` with the app's \`bundleId\`, event logging with automatic capture of uncaught errors and unhandled rejections, automatic screen tracking on History API navigation, structured metrics, funnels, user identity (\`Pulse.setUser()\` flushes and claims the anonymous history), user properties, **error attachments**, **feedback** (\`Pulse.sendFeedback\`), **questionnaires** (\`Pulse.fetchQuestionnaire\` / \`saveQuestionnaireResponse\` plus pure answer helpers — the SDK ships no UI), and \`propagateSessionTo\` to forward \`X-Pulse-Session-Id\` to your own API for session correlation with the Node SDK. Create the app with \`platform: "web"\`, a site identifier as its \`bundle_id\`, and the site's origins in its \`allowed_origins\` — including the dev server's (\`http://localhost:5173\`). Ingest refuses a browser request whose \`Origin\` is not on that list, and CORS allows the ones that are; nothing needs to change in the server's \`CORS_ORIGINS\`, which is the dashboard's own origin. Set \`appVersion\` in \`Pulse.configure()\` too: without it issue regression detection and the latest-version badges have nothing to compare.
- **Node** ([github.com/Jasonvdb/pubky-pulse-node](https://github.com/Jasonvdb/pubky-pulse-node)) — package installation, \`Pulse.configure()\`, event logging, structured metrics, funnels, user identity, user properties, **error attachments**, **feedback forwarding** (when the team collects feedback through their own frontend and wants it pushed to Pubky Pulse with \`Pulse.sendFeedback\`), and **per-request session/user scoping** (\`Pulse.withSession(...)\` / \`Pulse.withUser(...)\` / per-call \`options.sessionId\`) for linking backend events to a client session via the \`X-Pulse-Session-Id\` header.
- **Swift** ([github.com/pubky/pubky-pulse-swift](https://github.com/pubky/pubky-pulse-swift)) — iOS, iPadOS and macOS: package installation, \`Pulse.configure()\`, event logging, automatic screen tracking, structured metrics, funnels, user identity, user properties, **error attachments**, **feedback collection** (drop-in \`PulseFeedbackView\` or programmatic \`Pulse.sendFeedback\`), **questionnaires** (\`.pulseQuestionnaire(...)\` / \`PulseQuestionnaireView\`), and reading \`Pulse.sessionId\` to forward to a backend for session correlation.
- **Android** ([github.com/pubky/pubky-pulse-android](https://github.com/pubky/pubky-pulse-android)) — Kotlin core plus an optional Jetpack Compose artifact: dependency setup, \`Pulse.configure()\`, event logging, screen tracking (\`Modifier.pulseScreen()\`), structured metrics, funnels, user identity, user properties, **error attachments**, **feedback collection** (\`PulseFeedbackView\` / \`Pulse.sendFeedback\`), **questionnaires** (\`PulseQuestionnaireGate\` / \`PulseQuestionnaireView\`), and reading \`Pulse.sessionId\` to forward to a backend for session correlation.

## Key Notes

- \`bundle_id\` is **immutable after creation** — to change it, an owner must delete and recreate the app from the dashboard; there is no \`delete-app\` MCP tool. Backend apps have no bundle_id. A web app's \`allowed_origins\`, by contrast, is editable with \`update-app\` at any time.
- Agent keys are for reading/managing. Client keys are for SDK event ingestion.
- Reads reach every project in the team; writes reach only the projects your key's creator owns, re-checked on every request. See **Access Model**.
- Metric and funnel definitions must exist on the server before the SDK emits events for that slug.
- Cursor-based pagination: use the \`cursor\` from the response to fetch the next page. \`has_more\` indicates more results.
- All write tools that modify resources are recorded in the audit log.
- Soft-deleted resources can be restored by creating a new resource with the same slug.

## Bulk Import

To migrate historical event data from another system into Pubky Pulse:

1. **Create an import key** using the \`create-import-key\` tool with the target \`app_id\`.
2. **Write an export script** that reads events from the source system and POSTs them to \`POST /v1/import\` with the import key as a Bearer token.
3. Each request can contain up to **1000 events**. There is **no timestamp restriction** — any historical date is accepted.
4. Events with a matching \`client_event_id\` are **updated** (not skipped), so re-running an import script after tweaking attributes is safe.
5. The request body is \`{ "events": [...] }\` — same event shape as SDK ingestion (\`message\`, \`level\`, \`session_id\` required; \`timestamp\`, \`user_id\`, \`custom_attributes\`, etc. optional).
6. Metric events (\`metric:slug:phase\` messages) and funnel events (\`step:step_name\` messages, or legacy \`track:step_name\`) are auto-detected and dual-written.
7. Import keys use the \`pulse_import_\` prefix and are scoped to a single app.
`;
