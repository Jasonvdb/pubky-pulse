"use client";

// The six chart tokens, in order, cycled with `i % length`. Categorical series
// get their colour from the design system's chart ramp rather than from raw
// Tailwind palette classes, so a token change in globals.css moves every chart
// at once. `data` is sliced to 8 rows below, so rows 7 and 8 reuse chart-1/2 —
// acceptable because the label sits directly beside its own bar.
const BAR_COLORS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
];

interface BreakdownChartProps {
  title: string;
  data: Array<{ label: string; count: number }>;
  total: number;
}

export function BreakdownChart({ title, data, total }: BreakdownChartProps) {
  const items = data.slice(0, 8);
  if (items.length === 0) return null;
  const maxCount = Math.max(...items.map((d) => d.count));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="space-y-2">
        {items.map((item, i) => {
          const pct = total > 0 ? (item.count / total) * 100 : 0;
          const barWidth = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate max-w-[60%]">{item.label || "(empty)"}</span>
                <span className="text-muted-foreground">
                  {item.count} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
