import fs from "node:fs";
import path from "node:path";
import { docsSource } from "@/lib/docs-source";

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

export function GET() {
  const pages = docsSource.getPages();
  const docsDir = path.join(process.cwd(), "content/docs");

  const header = [
    "# Pubky Pulse",
    "",
    "> Self-hosted observability platform for web, backend and mobile apps. Structured events, performance metrics, and conversion funnels — purpose-built for AI coding agents.",
    "",
    "## About Pubky Pulse",
    "",
    "Pubky Pulse is an agent-first, open-source observability platform for web, backend and mobile apps.",
    "It provides structured events, performance metrics, and conversion funnels.",
    "",
    "Key capabilities:",
    "- **Events**: Structured events with log levels, session tracking, and screen context",
    "- **Attachments**: Upload files alongside error events for reproducible debugging",
    "- **Metrics**: Time any operation end-to-end — track p50, p95, failure rates",
    "- **Funnels**: Multi-step conversion funnels with drop-off analysis",
    "- **Time-series rollups**: Pre-aggregated daily and hourly counts of events, users, sessions, metric completions, funnel completions, and questionnaire responses — powering dashboard sparklines and trend queries that survive raw-event retention",
    "- **Locale demand**: Rank users by the language they want (device preferred language) and by country, flagging languages with demand the app doesn't ship yet — to decide where to localize next",
    "- **Notifications**: Unified multi-channel inbox (in-app, email) with per-user channel preferences",
    "- **SDKs**: Node.js (backends), Swift (iOS/macOS/watchOS), and Android (Kotlin / Jetpack Compose) — batching, compression, and retry built in; watch events relay through paired iPhone via WatchConnectivity when offline. A Web SDK is coming soon",
    "- **MCP server**: Agent-native MCP interface for setup, querying, and management — coding agents create projects, query events, and triage issues directly",
    "- **Self-hosted**: Single Postgres database, deploy on your own infrastructure",
    "",
    "- Docs: https://pulse.pubky.org/docs",
    "- GitHub: https://github.com/pubky/pubky-pulse",
    "- Dashboard: https://pulse.pubky.org/dashboard",
    "",
    "## License and Hosting",
    "",
    "Pubky Pulse is self-hosted and MIT licensed. There is no hosted service and no paid plans — you run it on your own infrastructure.",
    "",
    "## Alternatives",
    "",
    "Pubky Pulse is an open-source alternative to Mixpanel, Amplitude, PostHog, and Firebase Analytics,",
    "differentiated by its agent-first API design and single-database self-hosted architecture.",
    "",
    "## Docs",
    "",
  ];

  const pageSections = pages.map((page) => {
    const filePath = path.join(docsDir, page.path);
    let body = "";
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      body = stripFrontmatter(raw);
    } catch {
      body = "(content unavailable)";
    }

    return [
      `# ${page.data.title}`,
      "",
      page.data.description ? `${page.data.description}` : "",
      "",
      `URL: https://pulse.pubky.org${page.url}`,
      "",
      body,
      "",
      "---",
      "",
    ]
      .join("\n");
  });

  const output = header.join("\n") + "\n---\n\n" + pageSections.join("");

  return new Response(output, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
