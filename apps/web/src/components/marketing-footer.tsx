import Link from "next/link";
import { PulseLogo } from "@/components/pulse-logo";
import { GITHUB_URL } from "@/lib/site";

const linkClass =
  "rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
        <Link href="/" className={`flex items-center gap-2.5 ${linkClass}`}>
          <PulseLogo className="h-6 w-6 text-brand" />
          <span className="font-semibold tracking-tight text-foreground">Pubky Pulse</span>
        </Link>

        <div className="flex items-center gap-6">
          <Link href="/docs" className={linkClass}>
            Docs
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            GitHub
          </a>
          <span>&copy; {new Date().getFullYear()} Pubky</span>
        </div>
      </div>
    </footer>
  );
}
