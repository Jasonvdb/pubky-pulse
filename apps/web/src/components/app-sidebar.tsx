"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderOpen, ScrollText, BarChart3, Filter, KeyRound, Users, UserSearch, ClipboardList, ListChecks, Cog, BookOpen, Bug, MessageSquare, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeam } from "@/contexts/team-context";
import { useDataMode } from "@/contexts/data-mode-context";
import { PulseLogo } from "@/components/pulse-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DataMode } from "@pubky-pulse/shared";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/events", label: "Events", icon: ScrollText },
  { href: "/dashboard/issues", label: "Issues", icon: Bug },
  { href: "/dashboard/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/dashboard/questionnaires", label: "Questionnaires", icon: ListChecks },
  { href: "/dashboard/users", label: "Users", icon: UserSearch },
  { href: "/dashboard/locales", label: "Locales", icon: Globe },
  { href: "/dashboard/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/dashboard/funnels", label: "Funnels", icon: Filter },
  { href: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/dashboard/projects", label: "Projects", icon: FolderOpen },
  { href: "/dashboard/team", label: "Team", icon: Users },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardList },
  { href: "/dashboard/jobs", label: "Jobs", icon: Cog },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

const DATA_MODES: { value: DataMode; label: string }[] = [
  { value: "production", label: "Prod" },
  { value: "development", label: "Dev" },
  { value: "all", label: "All" },
];

// Lime is the only accent in the system, so the "on" pill matches the brand
// pill treatment used on buttons (tinted fill + brand ink) rather than a
// separate selected-chrome colour.
//
// The `hover` pair is not redundant: toggleVariants' base string carries
// `data-[state=on]:hover:bg-brand/90` and `hover:text-foreground`, and
// tailwind-merge only drops a class when the *whole* modifier chain matches —
// so without these the selected pill would flip to a solid lime slab on hover.
const DATA_MODE_ON = cn(
  "data-[state=on]:bg-brand/16 data-[state=on]:text-brand",
  "data-[state=on]:hover:bg-brand/16 data-[state=on]:hover:text-brand"
);

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { currentTeam, teams, setCurrentTeam } = useTeam();
  const { dataMode, setDataMode } = useDataMode();

  return (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <PulseLogo className="h-6 w-6 text-brand" />
        <Link
          href="/"
          className="rounded-sm text-base font-semibold tracking-tight text-sidebar-foreground outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          Pubky Pulse
        </Link>
      </div>
      {currentTeam && (
        <div className="border-b border-sidebar-border px-3 py-2">
          {teams.length >= 2 ? (
            <Select value={currentTeam.id} onValueChange={setCurrentTeam}>
              <SelectTrigger className="h-8 w-full border-sidebar-border bg-sidebar-accent/50 text-xs font-medium text-muted-foreground shadow-none hover:bg-sidebar-accent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex h-8 w-full items-center rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3">
              <p className="truncate text-xs font-medium text-muted-foreground">
                {currentTeam.name}
              </p>
            </div>
          )}
        </div>
      )}
      <div className="border-b border-sidebar-border px-3 py-2">
        <ToggleGroup
          type="single"
          value={dataMode}
          onValueChange={(v) => { if (v) setDataMode(v as DataMode); }}
          className="w-full rounded-md bg-background/60 p-0.5"
        >
          {DATA_MODES.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className={cn("h-7 flex-1 px-2 text-xs", DATA_MODE_ON)}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                active
                  ? "bg-brand/10 font-medium text-brand"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function AppSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <SidebarContent />
    </aside>
  );
}
