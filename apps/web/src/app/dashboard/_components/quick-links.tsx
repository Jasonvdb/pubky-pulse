"use client";

import Link from "next/link";
import { ArrowUpRight, Globe, Rocket, Smartphone, Server, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

interface DocLink {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

const LINKS: DocLink[] = [
  {
    label: "Getting Started",
    description: "Your first project",
    href: "/docs/getting-started",
    icon: Rocket,
  },
  {
    label: "Swift SDK",
    description: "iOS, iPadOS, macOS",
    href: "/docs/sdks/swift",
    icon: Smartphone,
  },
  {
    label: "Web SDK",
    description: "Browser instrumentation",
    href: "/docs/sdks/web",
    icon: Globe,
  },
  {
    label: "Node SDK",
    description: "Backend instrumentation",
    href: "/docs/sdks/node",
    icon: Server,
  },
  {
    label: "MCP",
    description: "Connect AI agents",
    href: "/docs/mcp/setup",
    icon: Plug,
  },
];

export function QuickLinks() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-border px-4 pt-3.5 pb-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Docs
          </span>
          <h3 className="text-sm font-semibold tracking-tight">Documentation</h3>
        </div>
      </div>
      <div className="grid divide-y divide-border/60 md:grid-cols-5 md:divide-y-0 md:divide-x">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand transition-colors group-hover:bg-brand/20">
              <link.icon className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{link.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {link.description}
              </p>
            </div>
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
