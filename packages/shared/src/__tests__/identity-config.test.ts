import { describe, it, expect } from "vitest";
import {
  isEmailDomainAllowed,
  normalizeEmail,
  parseIdentityConfig,
  type IdentityConfigResult,
  type RawIdentityConfig,
} from "../identity-config.js";

/**
 * Neutral placeholder values. No deployment domain, team, or owner address
 * belongs in a fixture.
 */
const validRaw: RawIdentityConfig = {
  PULSE_ALLOWED_EMAIL_DOMAINS: "example.com,example.org",
  PULSE_DEFAULT_TEAM_NAME: "Example Team",
  PULSE_DEFAULT_TEAM_SLUG: "example-team",
  PULSE_TEAM_OWNER_EMAIL: "owner@example.com",
};

function parse(overrides: Partial<RawIdentityConfig> = {}): IdentityConfigResult {
  return parseIdentityConfig({ ...validRaw, ...overrides });
}

/** Replace exactly one variable without a computed key, so the type stays checked. */
function parseWithout(variable: keyof RawIdentityConfig, value?: string): IdentityConfigResult {
  const raw: RawIdentityConfig = { ...validRaw };
  raw[variable] = value;
  return parseIdentityConfig(raw);
}

const REQUIRED_VARIABLES = [
  "PULSE_ALLOWED_EMAIL_DOMAINS",
  "PULSE_DEFAULT_TEAM_NAME",
  "PULSE_DEFAULT_TEAM_SLUG",
  "PULSE_TEAM_OWNER_EMAIL",
] as const;

function expectError(result: IdentityConfigResult): string {
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.error;
}

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Owner@Example.COM  ")).toBe("owner@example.com");
  });

  it("preserves dot-atom local parts", () => {
    expect(normalizeEmail("first.last+tag@example.com")).toBe("first.last+tag@example.com");
  });

  it("splits on the final @", () => {
    expect(normalizeEmail("user@example.com@example.org")).toBeNull();
  });

  it("rejects a missing @", () => {
    expect(normalizeEmail("user.example.com")).toBeNull();
  });

  it("rejects an empty local part", () => {
    expect(normalizeEmail("@example.com")).toBeNull();
  });

  it("rejects an empty domain", () => {
    expect(normalizeEmail("user@")).toBeNull();
  });

  it("rejects a single-label domain", () => {
    expect(normalizeEmail("user@localhost")).toBeNull();
  });

  it("rejects malformed domains", () => {
    expect(normalizeEmail("user@example..com")).toBeNull();
    expect(normalizeEmail("user@-example.com")).toBeNull();
    expect(normalizeEmail("user@example.com-")).toBeNull();
    expect(normalizeEmail("user@.example.com")).toBeNull();
    expect(normalizeEmail("user@example.com.")).toBeNull();
  });

  it("rejects embedded whitespace", () => {
    expect(normalizeEmail("us er@example.com")).toBeNull();
    expect(normalizeEmail("user@exa mple.com")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });
});

describe("isEmailDomainAllowed", () => {
  const allowed = ["example.com", "example.org"];

  it("accepts an exact domain match", () => {
    expect(isEmailDomainAllowed("user@example.com", allowed)).toBe(true);
    expect(isEmailDomainAllowed("user@example.org", allowed)).toBe(true);
  });

  it("accepts regardless of case or surrounding whitespace", () => {
    expect(isEmailDomainAllowed("  User@EXAMPLE.com  ", allowed)).toBe(true);
  });

  it("normalizes the allowlist entries too", () => {
    expect(isEmailDomainAllowed("user@example.com", [" Example.COM "])).toBe(true);
  });

  it("rejects a subdomain of an allowed domain", () => {
    expect(isEmailDomainAllowed("user@sub.example.com", allowed)).toBe(false);
  });

  it("rejects a parent of an allowed subdomain", () => {
    expect(isEmailDomainAllowed("user@example.com", ["sub.example.com"])).toBe(false);
  });

  it("rejects a suffix near-match", () => {
    expect(isEmailDomainAllowed("user@notexample.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("user@example.com.attacker.test", allowed)).toBe(false);
  });

  it("rejects a malformed address", () => {
    expect(isEmailDomainAllowed("user-at-example.com", allowed)).toBe(false);
    expect(isEmailDomainAllowed("@example.com", allowed)).toBe(false);
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(isEmailDomainAllowed("user@example.com", [])).toBe(false);
  });
});

describe("parseIdentityConfig", () => {
  it("returns a normalized config for valid input", () => {
    const result = parse();
    expect(result).toEqual({
      ok: true,
      value: {
        allowedEmailDomains: ["example.com", "example.org"],
        defaultTeamName: "Example Team",
        defaultTeamSlug: "example-team",
        teamOwnerEmail: "owner@example.com",
      },
    });
  });

  it("trims and lowercases domains and the owner email", () => {
    const result = parse({
      PULSE_ALLOWED_EMAIL_DOMAINS: "  Example.COM , EXAMPLE.org  ",
      PULSE_DEFAULT_TEAM_NAME: "  Example Team  ",
      PULSE_DEFAULT_TEAM_SLUG: "  example-team  ",
      PULSE_TEAM_OWNER_EMAIL: "  Owner@Example.COM  ",
    });
    expect(result.ok && result.value).toEqual({
      allowedEmailDomains: ["example.com", "example.org"],
      defaultTeamName: "Example Team",
      defaultTeamSlug: "example-team",
      teamOwnerEmail: "owner@example.com",
    });
  });

  it("keeps the team name's case and inner spacing", () => {
    const result = parse({ PULSE_DEFAULT_TEAM_NAME: "Example Team HQ" });
    expect(result.ok && result.value.defaultTeamName).toBe("Example Team HQ");
  });

  describe("missing values", () => {
    it.each(REQUIRED_VARIABLES)("rejects an absent %s", (variable) => {
      expect(expectError(parseWithout(variable))).toBe(`${variable} is required`);
    });

    it.each(REQUIRED_VARIABLES)("rejects a whitespace-only %s", (variable) => {
      expect(expectError(parseWithout(variable, "   "))).toBe(`${variable} is required`);
    });
  });

  describe("allowed domains", () => {
    it("rejects an empty entry from a trailing comma", () => {
      const error = expectError(parse({ PULSE_ALLOWED_EMAIL_DOMAINS: "example.com," }));
      expect(error).toContain("PULSE_ALLOWED_EMAIL_DOMAINS");
      expect(error).toContain("empty entry");
    });

    it("rejects an empty entry between two domains", () => {
      expect(
        expectError(parse({ PULSE_ALLOWED_EMAIL_DOMAINS: "example.com,,example.org" }))
      ).toContain("empty entry");
    });

    it.each([
      ["example..com"],
      ["-example.com"],
      ["example.com-"],
      [".example.com"],
      ["example.com."],
      ["localhost"],
      ["user@example.com"],
      ["example.com/path"],
      ["192.168.0.1"],
    ])("rejects the malformed domain %s", (domain) => {
      const error = expectError(parse({ PULSE_ALLOWED_EMAIL_DOMAINS: domain }));
      expect(error).toContain("PULSE_ALLOWED_EMAIL_DOMAINS contains an invalid domain");
    });

    it("rejects a duplicate domain", () => {
      const error = expectError(
        parse({ PULSE_ALLOWED_EMAIL_DOMAINS: "example.com,example.org,example.com" })
      );
      expect(error).toContain("duplicate domain");
    });

    it("rejects a duplicate that only collides after normalization", () => {
      const error = expectError(
        parse({ PULSE_ALLOWED_EMAIL_DOMAINS: "example.com, EXAMPLE.COM " })
      );
      expect(error).toContain("duplicate domain");
    });

    it("accepts a subdomain listed in its own right", () => {
      const result = parse({
        PULSE_ALLOWED_EMAIL_DOMAINS: "example.com,sub.example.com",
      });
      expect(result.ok && result.value.allowedEmailDomains).toEqual([
        "example.com",
        "sub.example.com",
      ]);
    });
  });

  describe("team slug", () => {
    it.each([["Example-Team"], ["example team"], ["example_team"], ["example.team"]])(
      "rejects the invalid slug %s",
      (slug) => {
        expect(expectError(parse({ PULSE_DEFAULT_TEAM_SLUG: slug }))).toContain(
          "PULSE_DEFAULT_TEAM_SLUG"
        );
      }
    );

    it("accepts digits and hyphens", () => {
      const result = parse({ PULSE_DEFAULT_TEAM_SLUG: "team-2" });
      expect(result.ok && result.value.defaultTeamSlug).toBe("team-2");
    });
  });

  describe("owner email", () => {
    it.each([
      ["owner.example.com"],
      ["@example.com"],
      ["owner@"],
      ["owner@localhost"],
      ["owner @example.com"],
      ["owner@example.com,second@example.com"],
    ])("rejects the malformed owner email %s", (email) => {
      const error = expectError(parse({ PULSE_TEAM_OWNER_EMAIL: email }));
      expect(error).toContain("PULSE_TEAM_OWNER_EMAIL must be a single email address");
    });

    it("rejects an owner outside the allowlist", () => {
      const error = expectError(parse({ PULSE_TEAM_OWNER_EMAIL: "owner@other.test" }));
      expect(error).toContain("PULSE_ALLOWED_EMAIL_DOMAINS");
      expect(error).toContain("other.test");
    });

    it("rejects an owner on a subdomain of an allowed domain", () => {
      expect(
        expectError(parse({ PULSE_TEAM_OWNER_EMAIL: "owner@sub.example.com" }))
      ).toContain("not listed in PULSE_ALLOWED_EMAIL_DOMAINS");
    });

    it("rejects an owner on a suffix near-match of an allowed domain", () => {
      expect(
        expectError(parse({ PULSE_TEAM_OWNER_EMAIL: "owner@notexample.com" }))
      ).toContain("not listed in PULSE_ALLOWED_EMAIL_DOMAINS");
    });

    it("never echoes the owner's local part in an error", () => {
      const error = expectError(parse({ PULSE_TEAM_OWNER_EMAIL: "secret-owner@other.test" }));
      expect(error).not.toContain("secret-owner");
    });

    it("accepts an owner whose domain matches after normalization", () => {
      const result = parse({ PULSE_TEAM_OWNER_EMAIL: " OWNER@Example.ORG " });
      expect(result.ok && result.value.teamOwnerEmail).toBe("owner@example.org");
    });
  });

  it("reports the first failure precisely when several values are invalid", () => {
    const error = expectError(
      parse({ PULSE_ALLOWED_EMAIL_DOMAINS: "bad_domain", PULSE_DEFAULT_TEAM_SLUG: "Bad Slug" })
    );
    expect(error).toContain("PULSE_ALLOWED_EMAIL_DOMAINS");
  });

  it("accepts a parsed config whose domains then pass isEmailDomainAllowed", () => {
    const result = parse();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isEmailDomainAllowed(result.value.teamOwnerEmail, result.value.allowedEmailDomains)).toBe(
      true
    );
    expect(isEmailDomainAllowed("user@sub.example.com", result.value.allowedEmailDomains)).toBe(
      false
    );
  });
});
