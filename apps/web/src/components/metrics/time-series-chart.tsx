"use client";

import { formatShortDate } from "@/lib/format-date";

interface TimeSeriesChartProps {
  data: Array<{ bucket: string; count: number; complete_count?: number; fail_count?: number }>;
}

export function TimeSeriesChart({ data }: TimeSeriesChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data for this time period</p>;
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1 h-40">
        {data.map((item, i) => {
          const height = (item.count / maxCount) * 100;
          const date = new Date(item.bucket);
          const label = formatShortDate(date);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[10px] text-muted-foreground">{item.count}</span>
              <div className="w-full flex flex-col justify-end" style={{ height: "120px" }}>
                <div
                  className="w-full rounded-t bg-chart-1 transition-colors hover:bg-chart-1/80"
                  style={{ height: `${Math.max(height, 2)}%` }}
                  title={`${label}: ${item.count} events`}
                />
              </div>
              <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
