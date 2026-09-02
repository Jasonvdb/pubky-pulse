"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaIndicator } from "@/components/delta-indicator";
import { Sparkline } from "@/components/charts/sparkline";
import { formatStatNumber } from "@/lib/format-number";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  secondary?: string;
  icon: LucideIcon;
  href?: string;
  isLoading?: boolean;
  // Optional trailing "+N" / "-N" indicator. Always muted on stat tiles —
  // colored deltas are reserved for dedicated detail surfaces.
  delta?: number | null;
  /**
   * Optional trend chart shown at the bottom of the card. `values` are
   * chronological; `isLoading` keeps the slot reserved while data is in
   * flight so the card doesn't pop in height on load. When undefined the
   * card renders unchanged (no slot reserved).
   */
  sparkline?: {
    values: number[];
    isLoading?: boolean;
  };
}

export function StatCard({
  label,
  value,
  secondary,
  icon: Icon,
  href,
  isLoading,
  delta,
  sparkline,
}: StatCardProps) {
  const body = (
    <div
      className={cn(
        "group relative flex h-full min-w-0 flex-col px-5 pt-5 transition-colors hover:bg-accent/40",
        // When a sparkline is rendered, drop the bottom padding so the chart
        // can extend to the card's bottom edge (its floor). Without-sparkline
        // cards keep symmetrical py-5.
        sparkline ? "pb-0" : "pb-5"
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <Icon
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/70 transition-colors",
            href && "group-hover:text-brand"
          )}
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <p
          className={cn(
            "font-semibold tabular-nums leading-none tracking-tight break-words",
            secondary ? "text-3xl" : "text-4xl"
          )}
        >
          {(typeof value === "number" ? formatStatNumber(value) : value) ?? "—"}
          {secondary && (
            <span className="ml-2 text-sm font-medium text-muted-foreground">
              {secondary}
            </span>
          )}
          <DeltaIndicator delta={delta} tone="muted" className="text-sm font-medium" />
        </p>
      )}
      {sparkline && (
        <div className="mt-auto pt-px h-11 w-full">
          {sparkline.isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <Sparkline values={sparkline.values} className="text-brand" />
          )}
        </div>
      )}
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      {/* 4-col grid at lg gives a clean 2 rows for the current 8-card layout
          (Issues, Events, Users, Sessions, Metrics, Funnels, Feedback,
          Responses). At smaller breakpoints the count of rows adjusts
          naturally — divides keep the visual block clean. */}
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-4">
        {children}
      </div>
    </Card>
  );
}
