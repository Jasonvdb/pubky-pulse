import type { LogLevel } from "@pubky-pulse/shared";

/**
 * Log-level colours, mapped onto the design system's chart tokens so no raw
 * Tailwind palette class survives outside globals.css. Shape is unchanged:
 * every level still yields `{ text, bg, border }` class strings.
 *
 * `error` is the one token that needs help. `--chart-5` is a pure red and
 * measures ~5.1:1 on the app background and ~4.2:1 on a card — under the
 * `--muted-foreground` (#89898f) contrast floor the rest of the UI holds to.
 * The `text` entry therefore lifts it toward white with the same `color-mix`
 * Tailwind emits for `/opacity` modifiers (matching the tinted `red` badge
 * tone), which clears the floor at ~6.9:1 / ~5.7:1. The 10%/30% `bg` and
 * `border` washes are decorative, so they use the plain token.
 */
export const levelColors: Record<LogLevel, { text: string; bg: string; border: string }> = {
  error: {
    text: "[color:color-mix(in_oklab,var(--chart-5),white_22%)]",
    bg: "bg-chart-5/10",
    border: "border-chart-5/30",
  },
  warn: { text: "text-chart-6", bg: "bg-chart-6/10", border: "border-chart-6/30" },
  info: { text: "text-chart-3", bg: "bg-chart-3/10", border: "border-chart-3/30" },
  debug: { text: "text-muted-foreground", bg: "bg-muted/40", border: "border-border" },
};
