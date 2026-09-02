import { cn } from "@/lib/utils";

interface DeltaIndicatorProps {
  delta: number | null | undefined;
  tone?: "muted" | "colored";
  className?: string;
}

// Hides on null/undefined/0 — keeps stable rows visually quiet.
export function DeltaIndicator({ delta, tone = "colored", className }: DeltaIndicatorProps) {
  if (delta == null || delta === 0) return null;
  const formatted = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
  // Up is `--chart-2` (green), down is `--chart-5` (red). chart-5 is a pure red
  // that falls under the muted-foreground contrast floor as text, so — exactly
  // as the tinted `red` badge tone does — it is lifted toward white with the
  // same color-mix Tailwind emits for `/opacity` modifiers.
  const toneClass =
    tone === "muted"
      ? "text-muted-foreground"
      : delta > 0
        ? "text-chart-2"
        : "[color:color-mix(in_oklab,var(--chart-5),white_22%)]";
  return (
    <span className={cn("ml-1 tabular-nums", toneClass, className)}>{formatted}</span>
  );
}
