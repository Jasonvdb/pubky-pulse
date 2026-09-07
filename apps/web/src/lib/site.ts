/**
 * Canonical, build-time constants for the public Pubky Pulse deployment.
 *
 * Anything that renders a hostname, a canonical URL or a repo link should read
 * it from here rather than hard-coding a string, so a rebrand or a domain move
 * is a one-file change.
 */

export const SITE_NAME = "Pubky Pulse";

/** Public origin of the dashboard + marketing site. Used for `metadataBase`. */
export const SITE_URL = "https://pubkypulse.com";

/** REST/MCP control-plane host. */
export const API_HOST = "https://api.pubkypulse.com";

/** High-volume event ingest host. */
export const INGEST_HOST = "https://ingest.pubkypulse.com";

export const GITHUB_URL = "https://github.com/Jasonvdb/pubky-pulse";
