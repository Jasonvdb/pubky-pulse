/**
 * Canonical, build-time constants for the public Pubky Pulse deployment.
 *
 * Anything that renders a hostname, a canonical URL or a repo link should read
 * it from here rather than hard-coding a string, so a rebrand or a domain move
 * is a one-file change.
 */

export const SITE_NAME = "Pubky Pulse";

/** Public origin of the dashboard + marketing site. Used for `metadataBase`. */
export const SITE_URL = "https://pulse.pubky.org";

/** REST/MCP control-plane host. */
export const API_HOST = "https://api.pulse.pubky.org";

/** High-volume event ingest host. */
export const INGEST_HOST = "https://ingest.pulse.pubky.org";

export const GITHUB_URL = "https://github.com/pubky/pubky-pulse";
