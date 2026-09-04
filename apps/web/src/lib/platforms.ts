/**
 * How the dashboard names platforms and environments.
 *
 * The lists themselves are shared contract — `APP_PLATFORMS` and `ENVIRONMENTS`
 * in `@pubky-pulse/shared` are what the API accepts — so they are imported
 * rather than retyped here, and adding a platform or environment there shows up
 * in every picker on its own.
 *
 * Runtime values come through the `./constants` deep export; the barrel pulls
 * `node:crypto` into the browser bundle. Types still come from the barrel.
 */
import { APP_PLATFORMS, ENVIRONMENTS } from "@pubky-pulse/shared/constants";
import type { AppPlatform, Environment } from "@pubky-pulse/shared";

const PLATFORM_EMOJI: Record<AppPlatform, string> = {
  apple: "🍎",
  android: "🤖",
  web: "🌐",
  backend: "☁️",
};

const PLATFORM_LABELS: Record<AppPlatform, string> = {
  apple: "Apple",
  android: "Android",
  web: "Web",
  backend: "Backend",
};

/** Platform choices for a select, in the order the shared contract lists them. */
export const PLATFORM_OPTIONS: { value: AppPlatform; label: string }[] = APP_PLATFORMS.map(
  (platform) => ({ value: platform, label: `${PLATFORM_EMOJI[platform]} ${PLATFORM_LABELS[platform]}` }),
);

/**
 * Environment names as a person reads them. The stored values are lowercase
 * enum members (`ipados`, `macos`), which look like typos in a menu.
 */
const ENVIRONMENT_LABELS: Record<Environment, string> = {
  ios: "iOS",
  ipados: "iPadOS",
  macos: "macOS",
  watchos: "watchOS",
  android: "Android",
  web: "Web (browser)",
  backend: "Backend",
};

export const ENVIRONMENT_OPTIONS: { value: Environment; label: string }[] = ENVIRONMENTS.map(
  (environment) => ({ value: environment, label: ENVIRONMENT_LABELS[environment] }),
);

// The three lookups below take a plain `string`, not the union: they read a
// value the API returned, and an older dashboard must keep rendering when a
// newer server adds a platform or environment. Each returns "" for a value it
// cannot name, so the caller picks its own placeholder with `|| "—"`.

/** Emoji for a platform, empty for one we don't know. */
export function platformEmoji(platform: string | null | undefined): string {
  if (!platform) return "";
  return (PLATFORM_EMOJI as Record<string, string>)[platform] ?? "";
}

/** Label for a platform string off the wire, falling back to the raw value. */
export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return "";
  const label = (PLATFORM_LABELS as Record<string, string>)[platform];
  return label ? `${platformEmoji(platform)} ${label}` : platform;
}

/** Label for an environment string off the wire, falling back to the raw value. */
export function environmentLabel(environment: string | null | undefined): string {
  if (!environment) return "";
  return (ENVIRONMENT_LABELS as Record<string, string>)[environment] ?? environment;
}

/**
 * Whether an event came from a browser.
 *
 * Web events reuse the native columns for browser facts — `device_model` holds
 * the browser, `os_version` the OS name and version, `screen_name` the URL path
 * — so the label a row gets depends on this answer.
 */
export function isWebEnvironment(environment: string | null | undefined): boolean {
  return environment === "web";
}
