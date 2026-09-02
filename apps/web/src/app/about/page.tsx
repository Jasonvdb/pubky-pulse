import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

export const metadata: Metadata = {
	title: "About",
	description:
		"Pubky Pulse closes the feedback loop in app development. Agent-first observability that catches issues before users give up.",
};

export default function AboutPage() {
	return (
		<>
			<MarketingNav />
			<main
				className="min-h-screen pt-14"
				style={{ background: "oklch(0.12 0.015 55)" }}
			>
				<div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
					<article className="prose prose-invert prose-lg max-w-none prose-headings:text-white prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-p:text-white/70 prose-p:leading-relaxed prose-strong:text-white/90 prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline">
						<h1>About Pubky Pulse</h1>

						<h2>The problem</h2>
						<p>
							Users don&apos;t file bug reports anymore. They hit a
							broken screen, a slow load, a confusing flow &mdash;
							and they&apos;re gone. With an alternative always one
							click away, your window to fix things is measured in
							hours, not weeks.
						</p>

						<h2>The mission</h2>
						<p>
							Pubky Pulse exists to close the feedback loop. Structured
							events, performance metrics, and conversion funnels
							give you real-time visibility into what&apos;s actually
							happening in your web, backend, and mobile apps &mdash;
							so you can catch errors,
							spot regressions, and ship fixes before users give up.
						</p>

						<h2>Agent-first</h2>
						<p>
							Most observability tools assume a human staring at a
							dashboard. Pubky Pulse is built for the agents that write
							your code. Point your agent at the MCP endpoint
							and let it monitor for errors, track regressions,
							find where users drop off, and improve conversions
							&mdash; using real production data, not guesses.
						</p>
						<p>
							The dashboard is there when you want it. The MCP
							server is there when your agent needs it.
						</p>

						<h2>Open source, self-hosted</h2>
						<p>
							The entire platform is{" "}
							<a
								href="https://github.com/pubky/pubky-pulse"
								target="_blank"
								rel="noopener noreferrer"
							>
								open source
							</a>{" "}
							and runs on a single PostgreSQL database. Deploy it on
							your own infrastructure &mdash; there is no hosted
							tier, and the whole platform is MIT licensed.
						</p>

						<hr className="!border-white/10 !my-12" />

						<p className="!text-white/40 !text-base">
							Pubky Pulse is built by Pubky.
						</p>
					</article>
				</div>
			</main>
			<MarketingFooter />
		</>
	);
}
