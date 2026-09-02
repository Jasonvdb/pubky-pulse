import { docsSource } from "@/lib/docs-source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { McpSetupInstructions } from "@/components/mcp-setup-instructions";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "@/lib/site";

/** Absolute origin for canonical URLs and JSON-LD; single source of truth. */
const BASE = SITE_URL;

function buildBreadcrumbItems(slugParts: string[], pageTitle: string) {
  const items: { position: number; name: string; item?: string }[] = [
    { position: 1, name: "Docs", item: `${BASE}/docs` },
  ];

  for (let i = 0; i < slugParts.length; i++) {
    const parentSlug = slugParts.slice(0, i + 1);
    const isLast = i === slugParts.length - 1;
    const parentPage = docsSource.getPage(parentSlug);
    const name = isLast ? pageTitle : (parentPage?.data.title ?? slugParts[i]);

    items.push({
      position: i + 2,
      name,
      ...(isLast ? {} : { item: `${BASE}/docs/${parentSlug.join("/")}` }),
    });
  }

  return items;
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = docsSource.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const slugParts = params.slug ?? [];
  const breadcrumbItems = buildBreadcrumbItems(slugParts, page.data.title);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems.map((item) => ({
        "@type": "ListItem",
        ...item,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: `${page.data.title} — ${SITE_NAME} Docs`,
      description: page.data.description,
      url: `${BASE}/docs${slugParts.length ? `/${slugParts.join("/")}` : ""}`,
      publisher: {
        "@type": "Organization",
        name: "Pubky",
        url: BASE,
        logo: `${BASE}/pulse-mark.svg`,
      },
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: BASE },
      inLanguage: "en",
    },
  ];

  return (
    <>
      <DocsPage toc={page.data.toc}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={{ ...defaultMdxComponents, Tab, Tabs, McpSetupInstructions }} />
          <div className="not-prose mt-12 rounded-xl bg-card p-6 text-center shadow-sm">
            <p className="text-sm font-semibold text-card-foreground">
              Ready to get started?
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect your agent via MCP and start tracking.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/docs/getting-started"
                className="inline-flex h-10 items-center rounded-full border border-brand bg-brand px-4 text-sm font-semibold text-background shadow-xs outline-none transition-colors hover:bg-brand/90 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Get Started
              </Link>
              <Link
                href={GITHUB_URL}
                className="inline-flex h-10 items-center rounded-full border border-input bg-input/30 px-4 text-sm font-semibold text-foreground shadow-xs outline-none transition-colors hover:bg-input/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                GitHub
              </Link>
            </div>
          </div>
        </DocsBody>
      </DocsPage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}

export function generateStaticParams() {
  return docsSource.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = docsSource.getPage(params.slug);
  if (!page) notFound();

  const slug = params.slug?.join("/") ?? "";
  const url = `/docs${slug ? `/${slug}` : ""}`;
  const title = `${page.data.title} — ${SITE_NAME} Docs`;
  return {
    title: { absolute: title },
    description: page.data.description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: page.data.description,
      url,
    },
  };
}
