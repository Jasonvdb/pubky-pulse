/**
 * Shared constants for the static Open Graph / Twitter image.
 *
 * `ImageResponse` (satori) cannot resolve CSS variables, so the design tokens
 * from `src/app/globals.css` are duplicated here as literal hex values.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/** Literal hex design tokens (ImageResponse cannot use CSS variables). */
export const OG_TOKENS = {
  background: "#05050a",
  cardBg: "#1d1d20",
  avatarMuted: "#303034",
  foreground: "#ffffff",
  secondaryForeground: "#d4d4db",
  mutedForeground: "#89898f",
  brand: "#c8ff00",
} as const;
