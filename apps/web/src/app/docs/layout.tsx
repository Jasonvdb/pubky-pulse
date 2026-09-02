import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { docsSource } from "@/lib/docs-source";
import { PulseLogo } from "@/components/pulse-logo";
import { GITHUB_URL, SITE_NAME } from "@/lib/site";
import { BookOpen, LayoutDashboard, Github } from "lucide-react";
import type { ReactNode } from "react";

function DocsNavTitle() {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* Decorative: the wordmark beside it already names the product, so the
          mark stays out of the accessibility tree (default `alt=""`). */}
      <PulseLogo className="h-6 w-6 text-brand" />
      <span className="text-lg font-semibold tracking-tight">{SITE_NAME}</span>
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    // The product has exactly one theme. `<html>` carries `class="dark"` and
    // `color-scheme: dark`, so this subtree only needs the surface colours —
    // Fumadocs' own theme switcher stays disabled.
    <RootProvider theme={{ enabled: false }}>
      <div className="min-h-screen bg-background text-foreground">
        <DocsLayout
          tree={docsSource.pageTree}
          nav={{
            title: <DocsNavTitle />,
            url: "/",
          }}
          themeSwitch={{ enabled: false }}
          links={[
            { text: "Docs", url: "/docs", icon: <BookOpen /> },
            { text: "Dashboard", url: "/dashboard", icon: <LayoutDashboard /> },
            {
              text: "GitHub",
              url: GITHUB_URL,
              external: true,
              icon: <Github />,
            },
          ]}
        >
          {children}
        </DocsLayout>
      </div>
    </RootProvider>
  );
}
