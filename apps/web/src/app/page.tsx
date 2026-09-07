import Link from "next/link";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { TerminalCopyButton } from "@/components/terminal-copy-button";
import { LandingAuth } from "@/components/landing-auth";
import { LandingMcpSetup } from "@/components/landing-mcp-setup";
import { PulseLogo } from "@/components/pulse-logo";
import { Button } from "@/components/ui/button";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "@/lib/site";

const AGENT_PROMPT =
  "Set up Pubky Pulse for this project and instrument the app with event tracking.";

const AGENT_DONE = [
  "Authenticated",
  "Project created",
  "App created",
  "SDK installed",
  "Instrumentation added",
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web, Node.js, iOS, Android",
  description:
    "Self-hosted events, metrics, funnels, issues and feedback for web, backend and mobile apps, wired up and queried by your coding agent over MCP.",
  url: SITE_URL,
  image: `${SITE_URL}/pulse-mark.svg`,
  offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  author: {
    "@type": "Organization",
    name: "Pubky",
    url: SITE_URL,
    sameAs: [GITHUB_URL],
  },
};

/** One numbered row of the get-started sequence. */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="mb-3 flex items-center gap-3">
        <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-background">
          {n}
        </span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="md:pl-11">{children}</div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main className="bg-background text-foreground">
        {/* Hero */}
        <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-32 pb-20 text-center md:pt-40 md:pb-28">
          <PulseLogo className="h-16 w-16 text-brand" alt="Pubky Pulse" />

          <span className="mt-8 inline-flex items-center rounded-full border border-brand bg-brand/16 px-3 py-0.5 text-xs font-semibold text-brand">
            Alpha
          </span>

          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance md:text-6xl">
            Observability your agent drives.
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Self-hosted events, metrics, funnels, issues and feedback for web, backend and
            mobile apps, wired up and queried by your coding agent over MCP.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button variant="brand" size="lg" asChild>
              <Link href="#get-started">Get started</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </Button>
          </div>
        </section>

        {/* Get started */}
        <section id="get-started" className="mx-auto max-w-4xl px-6 pb-24 md:pb-32">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              Connect your client. Tell your agent. Done.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Use the fastest supported setup for your MCP client, then your agent handles
              auth, project setup and SDK integration.
            </p>
          </div>

          <div className="relative mt-14">
            {/* Rail joining the three step badges */}
            <div
              aria-hidden
              className="absolute top-8 bottom-8 left-4 hidden border-l border-border md:block"
            />

            <Step n={1} title="Sign in to get your API key">
              <LandingAuth />
            </Step>

            <div className="mt-8">
              <Step n={2} title="Pick your client and use the recommended setup">
                <LandingMcpSetup />
              </Step>
            </div>

            <div className="mt-8">
              <Step n={3} title="Tell your agent to set up Pubky Pulse">
                <div className="overflow-hidden rounded-xl bg-card shadow-sm">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      Your agent
                    </span>
                    <TerminalCopyButton text={AGENT_PROMPT} />
                  </div>
                  <pre className="px-5 py-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                    <code>
                      <span className="text-muted-foreground">&gt;</span>{" "}
                      <span className="text-card-foreground">{AGENT_PROMPT}</span>
                      {"\n\n"}
                      {AGENT_DONE.map((line) => (
                        <span key={line}>
                          <span className="text-brand">✓</span>{" "}
                          <span className="text-muted-foreground">{line}</span>
                          {"\n"}
                        </span>
                      ))}
                      {"\n"}
                      <span className="text-muted-foreground">
                        Done. Pubky Pulse is ready.
                      </span>
                    </code>
                  </pre>
                </div>
              </Step>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
    </>
  );
}
