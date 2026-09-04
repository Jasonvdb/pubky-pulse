/**
 * Validated identity configuration for the single-team deployment.
 *
 * This module is deliberately PURE: it never reads `process.env`, never carries
 * company-specific defaults, and never reaches a `NEXT_PUBLIC_*` variable. The
 * server passes it a plain record of raw strings and either gets a normalized
 * config back or a precise error to fail startup with. Keeping it here means the
 * whole contract is unit-testable without booting the server or a database.
 *
 * Error messages name the failing variable and the reason. They may quote a
 * domain (not secret, and needed to find the typo) but never quote an owner
 * address in full — the local part is contact data that has no business in a
 * startup log.
 */

import { validateSlug } from "./constants.js";

export interface IdentityConfig {
  /** Exact, lowercase domains allowed to authenticate. No subdomain wildcards. */
  allowedEmailDomains: string[];
  defaultTeamName: string;
  defaultTeamSlug: string;
  /** Normalized (trimmed, lowercased) address of the sole team owner. */
  teamOwnerEmail: string;
}

/** Raw, unvalidated environment values. Every field may be absent. */
export interface RawIdentityConfig {
  PULSE_ALLOWED_EMAIL_DOMAINS?: string | undefined;
  PULSE_DEFAULT_TEAM_NAME?: string | undefined;
  PULSE_DEFAULT_TEAM_SLUG?: string | undefined;
  PULSE_TEAM_OWNER_EMAIL?: string | undefined;
}

export type IdentityConfigResult =
  | { ok: true; value: IdentityConfig }
  | { ok: false; error: string };

/** `teams.name`, `teams.slug`, and `users.email` are all varchar(255). */
const MAX_IDENTITY_VALUE_LENGTH = 255;

/** A single DNS label: alphanumeric, inner hyphens only, max 63 chars. */
const DOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * RFC 5322 dot-atom local part: no quoting, no folding, no embedded `@`.
 * Real-world addresses fit this; anything else is rejected rather than guessed at.
 */
const EMAIL_LOCAL_PART_REGEX = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/**
 * Validate an already-lowercased, already-trimmed domain.
 *
 * Requires at least two labels so a bare host (`localhost`) can never become an
 * allowlist entry, and rejects an all-numeric last label so an IP literal cannot
 * masquerade as a domain.
 */
function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => DOMAIN_LABEL_REGEX.test(label))) return false;
  const tld = labels[labels.length - 1]!;
  return tld.length >= 2 && !/^[0-9]+$/.test(tld);
}

/**
 * Trim and lowercase an email address, then split it on its FINAL `@`.
 *
 * Returns the normalized address, or `null` when it is malformed — an empty
 * local part, an empty or malformed domain, embedded whitespace, or a local part
 * outside the dot-atom charset. Callers must treat `null` as "reject", never as
 * "pass the raw value through".
 */
export function normalizeEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_IDENTITY_VALUE_LENGTH) return null;
  if (/\s/.test(normalized)) return null;

  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;

  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (localPart.length > 64 || !EMAIL_LOCAL_PART_REGEX.test(localPart)) return null;
  if (!isValidDomain(domain)) return null;

  return `${localPart}@${domain}`;
}

/**
 * Exact-match an address's domain against the allowlist.
 *
 * Matching is exact by design: `person@sub.example.com` is NOT allowed by an
 * `example.com` entry, and `notexample.com` never matches `example.com`. A
 * subdomain has to be listed in its own right.
 */
export function isEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[]
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return allowedDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
}

function requireValue(
  raw: string | undefined,
  variable: string
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: `${variable} is required` };
  if (trimmed.length > MAX_IDENTITY_VALUE_LENGTH) {
    return {
      ok: false,
      error: `${variable} must be at most ${MAX_IDENTITY_VALUE_LENGTH} characters`,
    };
  }
  return { ok: true, value: trimmed };
}

function parseAllowedDomains(
  raw: string | undefined
): { ok: true; value: string[] } | { ok: false; error: string } {
  const variable = "PULSE_ALLOWED_EMAIL_DOMAINS";
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: `${variable} is required` };

  const domains: string[] = [];
  const seen = new Set<string>();
  for (const entry of trimmed.split(",")) {
    const domain = entry.trim().toLowerCase();
    if (!domain) {
      return {
        ok: false,
        error: `${variable} contains an empty entry (check for a stray or trailing comma)`,
      };
    }
    if (!isValidDomain(domain)) {
      return { ok: false, error: `${variable} contains an invalid domain: "${domain}"` };
    }
    if (seen.has(domain)) {
      return {
        ok: false,
        error: `${variable} contains a duplicate domain after normalization: "${domain}"`,
      };
    }
    seen.add(domain);
    domains.push(domain);
  }

  return { ok: true, value: domains };
}

/**
 * Parse and validate the four identity variables together.
 *
 * The cross-field check matters as much as the per-field ones: an owner outside
 * the allowlist would be a team owner who can never sign in, so it is rejected
 * at startup rather than discovered in production.
 */
export function parseIdentityConfig(raw: RawIdentityConfig): IdentityConfigResult {
  const domains = parseAllowedDomains(raw.PULSE_ALLOWED_EMAIL_DOMAINS);
  if (!domains.ok) return domains;

  const name = requireValue(raw.PULSE_DEFAULT_TEAM_NAME, "PULSE_DEFAULT_TEAM_NAME");
  if (!name.ok) return name;

  const slug = requireValue(raw.PULSE_DEFAULT_TEAM_SLUG, "PULSE_DEFAULT_TEAM_SLUG");
  if (!slug.ok) return slug;
  const slugError = validateSlug(slug.value, "PULSE_DEFAULT_TEAM_SLUG");
  if (slugError) return { ok: false, error: slugError };

  const ownerRaw = requireValue(raw.PULSE_TEAM_OWNER_EMAIL, "PULSE_TEAM_OWNER_EMAIL");
  if (!ownerRaw.ok) return ownerRaw;

  const teamOwnerEmail = normalizeEmail(ownerRaw.value);
  if (!teamOwnerEmail) {
    return {
      ok: false,
      error:
        "PULSE_TEAM_OWNER_EMAIL must be a single email address with a non-empty local part and a valid domain",
    };
  }

  const ownerDomain = teamOwnerEmail.slice(teamOwnerEmail.lastIndexOf("@") + 1);
  if (!domains.value.includes(ownerDomain)) {
    return {
      ok: false,
      error: `PULSE_TEAM_OWNER_EMAIL domain "${ownerDomain}" is not listed in PULSE_ALLOWED_EMAIL_DOMAINS`,
    };
  }

  return {
    ok: true,
    value: {
      allowedEmailDomains: domains.value,
      defaultTeamName: name.value,
      defaultTeamSlug: slug.value,
      teamOwnerEmail,
    },
  };
}
