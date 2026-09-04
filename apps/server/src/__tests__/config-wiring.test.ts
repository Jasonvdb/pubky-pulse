import { describe, it, expect } from "vitest";
import { parseCorsOrigins, resolveIdentityConfig, resolveTrustProxy } from "../config.js";

/**
 * Startup wiring for the identity configuration.
 *
 * `identity-config.test.ts` covers the pure parser in `@pubky-pulse/shared`.
 * What is untested there is the server's own half of the contract: that
 * `config.ts` actually hands the parser all four variables, and that an invalid
 * or absent one becomes a thrown startup error naming the variable at fault
 * rather than a silently half-configured access model.
 *
 * This drives the exported function with explicit records instead of mutating
 * `process.env` and re-importing the module. `config.ts` dotenv-loads the
 * repo-root `.env` at import, so a re-import test would let a developer's local
 * `.env` supply a variable the case had deliberately deleted — green in CI, red
 * on the machine that actually has the file, or the reverse. An explicit record
 * has no such ambient input.
 *
 * `pulse.pubky.org` and `example.com` are the suite's own allowed domains. No
 * deployment domain, team or owner address appears here.
 */

const VALID = {
  PULSE_ALLOWED_EMAIL_DOMAINS: "pulse.pubky.org,example.com",
  PULSE_DEFAULT_TEAM_NAME: "Wiring Test Team",
  PULSE_DEFAULT_TEAM_SLUG: "wiring-test-team",
  PULSE_TEAM_OWNER_EMAIL: "Owner@Pulse.Pubky.Org",
} as const;

/** The four variables, as a mutable record the cases can delete a key from. */
function env(overrides: Partial<Record<keyof typeof VALID, string>> = {}) {
  return { ...VALID, ...overrides } as NodeJS.ProcessEnv;
}

function withoutVariable(variable: keyof typeof VALID): NodeJS.ProcessEnv {
  const record = env();
  delete record[variable];
  return record;
}

/** The message of the error `run` threw, failing the test if it threw none. */
function messageFrom(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a thrown configuration error, but the call returned");
}

describe("resolveIdentityConfig", () => {
  it("returns the normalized config when all four variables are valid", () => {
    const identity = resolveIdentityConfig(env());

    expect(identity).toEqual({
      allowedEmailDomains: ["pulse.pubky.org", "example.com"],
      defaultTeamName: "Wiring Test Team",
      defaultTeamSlug: "wiring-test-team",
      // Lowercased on the way through, so every later comparison is exact.
      teamOwnerEmail: "owner@pulse.pubky.org",
    });
  });

  it.each([
    "PULSE_ALLOWED_EMAIL_DOMAINS",
    "PULSE_DEFAULT_TEAM_NAME",
    "PULSE_DEFAULT_TEAM_SLUG",
    "PULSE_TEAM_OWNER_EMAIL",
  ] as const)("throws naming %s when it is missing", (variable) => {
    // The reason clause is asserted, not the whole message: the message's
    // trailing "…must all be set" sentence lists every variable, so matching
    // the bare name would pass for any of the four failures.
    expect(() => resolveIdentityConfig(withoutVariable(variable))).toThrow(
      `Invalid identity configuration: ${variable} is required.`,
    );
  });

  it.each([
    "PULSE_ALLOWED_EMAIL_DOMAINS",
    "PULSE_DEFAULT_TEAM_NAME",
    "PULSE_DEFAULT_TEAM_SLUG",
    "PULSE_TEAM_OWNER_EMAIL",
  ] as const)("throws naming %s when it is present but blank", (variable) => {
    expect(() => resolveIdentityConfig(env({ [variable]: "   " }))).toThrow(
      `Invalid identity configuration: ${variable} is required.`,
    );
  });

  it("rejects an owner whose domain is outside the allowlist", () => {
    // Otherwise the deployment boots with a team owner who can never sign in.
    expect(() =>
      resolveIdentityConfig(env({ PULSE_TEAM_OWNER_EMAIL: "owner@not-listed.example" })),
    ).toThrow(/PULSE_TEAM_OWNER_EMAIL domain "not-listed\.example" is not listed/);
  });

  it("rejects a malformed slug", () => {
    expect(() =>
      resolveIdentityConfig(env({ PULSE_DEFAULT_TEAM_SLUG: "Not A Slug!" })),
    ).toThrow(/PULSE_DEFAULT_TEAM_SLUG/);

    // And the reason is the slug's own validation, not a generic "is required".
    expect(() =>
      resolveIdentityConfig(env({ PULSE_DEFAULT_TEAM_SLUG: "Not A Slug!" })),
    ).not.toThrow(/PULSE_DEFAULT_TEAM_SLUG is required/);
  });

  it("rejects a malformed owner address without echoing it", () => {
    const local = "not-an-address-local-part";
    const message = messageFrom(() =>
      resolveIdentityConfig(env({ PULSE_TEAM_OWNER_EMAIL: `${local}@@` })),
    );

    expect(message).toContain("PULSE_TEAM_OWNER_EMAIL must be a single email address");
    // A startup log is a wide-open surface: it names the variable at fault,
    // never the contact address that was rejected.
    expect(message).not.toContain(local);
  });

  it("rejects a malformed domain entry without echoing another variable's value", () => {
    expect(() =>
      resolveIdentityConfig(env({ PULSE_ALLOWED_EMAIL_DOMAINS: "pulse.pubky.org,localhost" })),
    ).toThrow(/PULSE_ALLOWED_EMAIL_DOMAINS contains an invalid domain: "localhost"/);
  });
});

/**
 * The two request-layer switches. Both are pure functions over a raw string for
 * the same reason `resolveIdentityConfig` is: `config.ts` dotenv-loads the
 * repo-root `.env` at import, so anything driven through `process.env` here
 * would read a developer's local file.
 */
describe("parseCorsOrigins", () => {
  it("trims entries and drops empty ones", () => {
    expect(parseCorsOrigins("https://a.example.com , https://b.example.com,,")).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("de-duplicates repeated entries", () => {
    expect(parseCorsOrigins("https://a.example.com,https://a.example.com")).toEqual([
      "https://a.example.com",
    ]);
  });

  it("falls back to the local dashboard when unset or empty", () => {
    expect(parseCorsOrigins(undefined)).toEqual(["http://localhost:3000"]);
    expect(parseCorsOrigins("  , ")).toEqual(["http://localhost:3000"]);
  });
});

describe("resolveTrustProxy", () => {
  it("is off unless the value is exactly true", () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy("")).toBe(false);
    expect(resolveTrustProxy("false")).toBe(false);
    expect(resolveTrustProxy("1")).toBe(false);
    expect(resolveTrustProxy("yes")).toBe(false);
  });

  it("accepts true regardless of casing or surrounding whitespace", () => {
    expect(resolveTrustProxy("true")).toBe(true);
    expect(resolveTrustProxy(" TRUE ")).toBe(true);
  });
});
