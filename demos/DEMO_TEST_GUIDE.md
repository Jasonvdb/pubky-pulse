# Pubky Pulse Full Demo Test Guide

Step-by-step guide for setting up, running, and verifying the full Pubky Pulse demo stack. Designed so an AI agent (or human) can follow it end-to-end.

## Phase 1: Prerequisites

Verify these tools are available:

```bash
node --version          # v18+
pnpm --version          # v8+
psql --version          # PostgreSQL 15+
xcodebuildmcp --help    # XcodeBuildMCP command-line tool (required for iOS build/run/UI automation)
```

If `xcodebuildmcp` is not installed, see https://github.com/getsentry/XcodeBuildMCP for setup instructions. All iOS simulator operations (build, run, screenshot, tap) use this tool — do not use raw `xcrun simctl` or `xcodebuild` directly.

## Phase 2: Database & Build Setup

```bash
# Create database if it doesn't exist (safe to run if it already exists)
createdb pubky_pulse 2>/dev/null || true

# Install dependencies and build all packages
pnpm install && pnpm build

# Run migrations (creates partitioned events table)
pnpm db:migrate

# Seed dev data (admin user, team, project, apps, API keys)
pnpm dev:seed
```

### Seed credentials

- **Dashboard login**: `admin@pulse.pubky.org` (verification code appears in server console)
- **Agent API key**: `pulse_agent_demo_000000000000000000000000000000000000000000`
- **Server client key**: `pulse_client_svr_0000000000000000000000000000000000000000`

## Phase 3: Start Servers

Kill any stale processes, then start the API server and Node demo server. The Node demo now lives in the sibling [`pubky-pulse-node`](https://github.com/pubky/pubky-pulse-node) repo under `Examples/Demo/` and resolves `@synonymdev/pubky-pulse-node` via `file:../..`, so the SDK must be built before the demo can start.

```bash
# Kill stale processes
lsof -ti:4000 | xargs kill 2>/dev/null || true
lsof -ti:4007 | xargs kill 2>/dev/null || true

# Terminal 1 — Pubky Pulse API server (port 4000)
pnpm dev:server

# Terminal 2 — Build the Node SDK once, then start the demo (port 4007, requires API server)
cd ../pubky-pulse-node
npm install
npm run build
cd Examples/Demo
npm install
npm start
```

### Health checks

Wait for both servers to show "Listening" / "Ready", then verify:

```bash
curl -s http://localhost:4000/health | jq .   # {"status":"ok"}
curl -s http://localhost:4007/health | jq .   # {"status":"ok"}
```

## Phase 4: Connect the MCP Server

Point your agent at the local MCP endpoint (`http://localhost:4000/mcp`) using the seeded agent key. For Claude Code:

```bash
claude mcp add --transport http pubky-pulse http://localhost:4000/mcp \
  --header "Authorization: Bearer pulse_agent_demo_000000000000000000000000000000000000000000"
```

Config for every other supported MCP client (Codex, Cursor, VS Code, Claude Desktop, Windsurf, Zed, JetBrains, Cline, Roo Code) is at [/docs/mcp](/docs/mcp/setup).

Verify it works — call the `whoami` tool, then the `list-projects` tool.

Expected: `whoami` reports an `agent` key, and `list-projects` returns "Demo Project".

## Phase 5: Build & Launch iOS App

### Find a simulator

```bash
xcodebuildmcp simulator list
```

Pick a simulator (e.g., "iPhone 16") and note its UDID. You can also use `--simulator-name` instead of `--simulator-id` in commands below.

### Build and run

The iOS demo now lives in the sibling [`pubky-pulse-swift`](https://github.com/pubky/pubky-pulse-swift) repo under `Examples/Demo/`. Assuming it's checked out as a sibling of this repo:

```bash
xcodebuildmcp simulator build-and-run \
  --scheme PulseDemo \
  --project-path ../pubky-pulse-swift/Examples/Demo/PulseDemo.xcodeproj \
  --simulator-name "iPhone 16"
```

This builds, installs, and launches the app in one step. The Simulator app will open automatically.

## Phase 6: Tap "Run Full Demo"

The "Full Demo" section is at the top of the app's form. Tap the **"Run Full Demo"** button.

```bash
# Snapshot the UI to find the button coordinates
xcodebuildmcp ui-automation snapshot-ui --simulator-id <UDID>

# Tap the button (use coordinates from snapshot)
xcodebuildmcp ui-automation tap --simulator-id <UDID> --x <X> --y <Y>

# Wait for events to flush (SDK auto-flushes every 5s, wrapHandler flushes immediately)
sleep 10

# Scroll down to see the event log, then screenshot to verify "Full Demo Complete"
xcodebuildmcp ui-automation swipe --simulator-id <UDID> --x1 196 --y1 600 --x2 196 --y2 100
xcodebuildmcp ui-automation screenshot --simulator-id <UDID> --return-format path
```

### What the button does

1. Sends `Pulse.info("Demo started")` (iOS)
2. Sends `Pulse.tracking("demo_full_test")` (iOS)
3. Calls `POST /api/greet` with `name: "PulseBot"` → 2 backend info events
4. Waits 1 second
5. Calls `POST /api/checkout` with `item: "Premium Plan"` → backend info + warn + error
6. Sends `Pulse.error("Simulated client crash")` (iOS)

## Phase 7: Verify Events

### List all recent events

Call the `query-events` tool:

```json
{ "since": "5m", "compact": true }
```

**Expected: 8 events** across 2 apps:

| # | App | Level | Message |
|---|-----|-------|---------|
| 1 | iOS Demo App | info | Demo started |
| 2 | iOS Demo App | tracking | demo_full_test |
| 3 | Backend Demo API Server | info | Greeting requested |
| 4 | Backend Demo API Server | info | Greeting sent |
| 5 | Backend Demo API Server | info | Checkout started |
| 6 | Backend Demo API Server | warn | Payment gateway timeout |
| 7 | Backend Demo API Server | error | Checkout failed: payment provider unreachable |
| 8 | iOS Demo App | error | Simulated client crash |

Note: iOS events may take up to 5 seconds to appear (SDK flush interval). Backend events flush immediately via `wrapHandler`.

### Filter for errors only

Call `query-events` with a level filter:

```json
{ "level": ["error"], "since": "5m" }
```

Expected: 2 error events — "Checkout failed: payment provider unreachable" and "Simulated client crash".

## Phase 8: Debug Workflow

This simulates how you'd investigate errors in production.

### Step 1: Find the errors

Call `query-events`:

```json
{ "level": ["error"], "since": "5m" }
```

Note the `id` of each error event in the output.

### Step 2: Inspect the checkout error

Call `get-event` for the full event details:

```json
{ "event_id": "<CHECKOUT_ERROR_ID>" }
```

Look at the custom attributes — you'll see `item: "Premium Plan"`.

### Step 3: Investigate the error's breadcrumb trail

Call `investigate-event`:

```json
{ "event_id": "<CHECKOUT_ERROR_ID>", "window_minutes": 5 }
```

This builds a breadcrumb trail around the error: the full session from the same app (or a ±5 min window when the target has no `session_id`), enriched with cross-app events for the same user. You should see the **warn → error chain**:

1. `info` — "Checkout started" (the operation began)
2. `warn` — "Payment gateway timeout" (first sign of trouble)
3. `error` — "Checkout failed: payment provider unreachable" (the failure)

This pattern is typical: a warning precedes the error, giving you context about *why* it failed.

### Step 4: Investigate the iOS error

Call `investigate-event` again:

```json
{ "event_id": "<IOS_ERROR_ID>", "window_minutes": 5 }
```

You should see the full demo sequence from the iOS app's perspective:

1. `info` — "Demo started"
2. `tracking` — "demo_full_test"
3. `error` — "Simulated client crash"

## Phase 9: Cleanup

```bash
# Kill servers
lsof -ti:4000 | xargs kill 2>/dev/null || true
lsof -ti:4007 | xargs kill 2>/dev/null || true

# Terminate iOS app on simulator
xcodebuildmcp simulator stop --simulator-id <UDID> --bundle-id org.pubky.pulse.demo
```

## Troubleshooting

### No events showing up

- Check both servers are running: `curl http://localhost:4000/health && curl http://localhost:4007/health`
- iOS SDK events flush every 5 seconds — wait at least 10 seconds after tapping
- Backend events flush immediately via `wrapHandler` but need the API server to be reachable

### Fewer than 8 events

- If missing iOS events (3): the SDK may not have flushed yet, wait longer
- If missing backend events (5): check the Node demo server logs for connection errors to port 4000
- The `demo_app_opened` tracking event fires on app launch — this is separate from the full demo and not counted in the 8

### MCP tools return no results

- Verify the MCP server is connected: run `/mcp` in Claude Code, or call the `whoami` tool
- Verify the agent key works: call `list-projects` — it should return "Demo Project"
- Try a wider time range: `"since": "30m"`
