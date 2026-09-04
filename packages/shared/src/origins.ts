/**
 * Browser origins a web app is allowed to send from.
 *
 * A web app's client key is public — it ships inside the page — so the origin
 * list is what actually scopes it to the sites the operator owns. This module
 * is the single definition of what an entry may look like, shared by the REST
 * routes that write the list, the CORS resolver that reads it, and the
 * dashboard form that edits it.
 *
 * Deliberately PURE: no database, no `process.env`, no Node-only imports, so
 * the browser bundle can import it through the `./origins` deep export.
 *
 * An entry is a bare origin — scheme, host, optional port — and nothing else.
 * `https://app.example.com` and `http://localhost:3000` are valid;
 * `https://app.example.com/` (trailing slash), `example.com` (no scheme),
 * `https://app.example.com/analytics` (path), and `ws://…` (wrong scheme) are
 * not. That matches the `Origin` header a browser actually sends, so a stored
 * entry can be compared against it with `===` rather than with a parser that
 * might disagree with the browser's.
 */

/**
 * Scheme, host, optional port. The character class rejects a path, query,
 * fragment, userinfo and whitespace up front, so only the host/port itself is
 * left for `URL` to validate.
 */
const ORIGIN_REGEX = /^(https?):\/\/([^/?#\s@]+)$/i;

/**
 * A DNS host or IPv4 literal, after `URL` has lowercased it. Checked because
 * the WHATWG parser accepts hosts a browser will never send as an `Origin` —
 * `https://*.example.com` parses fine, and storing it would read like a
 * wildcard rule that silently matches nothing.
 */
const HOSTNAME_REGEX = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** A bracketed IPv6 literal, e.g. `[::1]`, as `URL` reports it. */
const IPV6_HOSTNAME_REGEX = /^\[[0-9a-f:.]+\]$/;

/** Room for a production domain, its staging and preview hosts, and localhost. */
export const MAX_APP_ALLOWED_ORIGINS = 50;

export type AllowedOriginsResult =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

/**
 * Normalize one origin, or return null if it is not a bare http(s) origin.
 *
 * `URL` does the normalizing that matters: it lowercases the scheme and host,
 * drops a default port (`https://example.com:443` → `https://example.com`), and
 * rejects a malformed host. The result is lowercased again because a
 * percent-encoded host can survive parsing with uppercase escapes.
 */
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ORIGIN_REGEX.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (!HOSTNAME_REGEX.test(host) && !IPV6_HOSTNAME_REGEX.test(host)) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validate and normalize a whole `allowed_origins` list from a request body.
 *
 * Duplicates collapse (after normalization, so `https://A.com` and
 * `https://a.com` are one entry) and order is preserved, which keeps the
 * dashboard's list stable across a round trip. The error names the offending
 * value so the operator can find the typo without diffing two lists.
 */
export function normalizeAllowedOrigins(input: unknown): AllowedOriginsResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "allowed_origins must be an array of origin strings" };
  }
  if (input.length > MAX_APP_ALLOWED_ORIGINS) {
    return {
      ok: false,
      error: `allowed_origins must contain at most ${MAX_APP_ALLOWED_ORIGINS} origins`,
    };
  }

  const seen = new Set<string>();
  const value: string[] = [];
  for (const entry of input) {
    const normalized = normalizeOrigin(entry);
    if (!normalized) {
      return {
        ok: false,
        error:
          `Invalid origin ${JSON.stringify(entry)}. Use a full origin with no path or trailing ` +
          `slash, e.g. "https://app.example.com" or "http://localhost:3000"`,
      };
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    value.push(normalized);
  }

  return { ok: true, value };
}
