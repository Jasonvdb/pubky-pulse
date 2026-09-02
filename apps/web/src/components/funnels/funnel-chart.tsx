"use client";

import type { FunnelStepAnalytics } from "@pubky-pulse/shared";
import { cn } from "@/lib/utils";

interface FunnelChartProps {
  steps: FunnelStepAnalytics[];
}

export function FunnelChart({ steps }: FunnelChartProps) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No funnel data</p>;
  }

  const maxUsers = steps[0].unique_users;
  const lastIndex = steps.length - 1;

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const widthPercent = maxUsers > 0 ? (step.unique_users / maxUsers) * 100 : 0;
        // The final step is the funnel's conversion endpoint, so it carries the
        // solid brand fill; every step before it is the same lime held back to
        // 20% so the eye lands on the number that actually matters.
        const isLast = i === lastIndex;

        return (
          <div key={step.step_index}>
            {/* Step bar */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-5 shrink-0 text-right">
                {step.step_index + 1}
              </span>
              <span className="text-xs font-medium shrink-0 w-36 truncate" title={step.step_name}>
                {step.step_name}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className={cn(
                    "h-7 rounded-md transition-all",
                    isLast ? "bg-brand" : "bg-brand/20",
                  )}
                  style={{ width: `${Math.max(widthPercent, 2)}%` }}
                />
              </div>
              <div className="shrink-0 text-right w-32 flex items-center gap-2 justify-end">
                <span className="text-sm font-semibold tabular-nums">
                  {step.unique_users.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums w-12">
                  {step.percentage}%
                </span>
              </div>
            </div>

            {/* Drop-off indicator between steps. The label lifts chart-5 toward
                white with the same color-mix the tinted badge tones use — pure
                chart-5 as 10px text sits under the contrast floor on card. */}
            {i < steps.length - 1 && steps[i + 1].drop_off_count > 0 && (
              <div className="flex items-center gap-3 ml-8 mt-0.5 mb-0.5">
                <div className="flex-1 flex items-center gap-2 pl-2">
                  <div className="h-px flex-1 max-w-16 bg-chart-5/40" />
                  <span className="text-[10px] [color:color-mix(in_oklab,var(--chart-5),white_22%)]">
                    -{steps[i + 1].drop_off_count.toLocaleString()} ({steps[i + 1].drop_off_percentage}%)
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
