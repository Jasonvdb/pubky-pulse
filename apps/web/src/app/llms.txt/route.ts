import { docsSource } from "@/lib/docs-source";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export function GET() {
  const pages = docsSource.getPages();

  const lines = [
    `# ${SITE_NAME}`,
    "",
    "> Self-hosted observability platform for web, backend and mobile apps. Structured events, performance metrics, and conversion funnels — purpose-built for AI coding agents.",
    "",
    "## Docs",
    "",
    ...pages.map(
      (page) =>
        `- [${page.data.title}](${SITE_URL}${page.url})${page.data.description ? `: ${page.data.description}` : ""}`
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
