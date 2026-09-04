import { describe, it, expect } from "vitest";
import {
  MAX_APP_ALLOWED_ORIGINS,
  normalizeAllowedOrigins,
  normalizeOrigin,
} from "../origins.js";

describe("normalizeOrigin", () => {
  it("accepts a bare https origin", () => {
    expect(normalizeOrigin("https://app.example.com")).toBe("https://app.example.com");
  });

  it("accepts http with an explicit port, as localhost development needs", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("lowercases the scheme and host", () => {
    expect(normalizeOrigin("HTTPS://App.Example.COM")).toBe("https://app.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOrigin("  https://app.example.com  ")).toBe("https://app.example.com");
  });

  it("drops a default port so it matches the Origin header a browser sends", () => {
    expect(normalizeOrigin("https://app.example.com:443")).toBe("https://app.example.com");
    expect(normalizeOrigin("http://app.example.com:80")).toBe("http://app.example.com");
  });

  it("keeps a non-default port", () => {
    expect(normalizeOrigin("https://app.example.com:8443")).toBe("https://app.example.com:8443");
  });

  it("accepts an IPv6 literal", () => {
    expect(normalizeOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it.each([
    ["a trailing slash", "https://app.example.com/"],
    ["a path", "https://app.example.com/analytics"],
    ["a query string", "https://app.example.com?a=1"],
    ["a fragment", "https://app.example.com#top"],
    ["userinfo", "https://user:pass@app.example.com"],
    ["no scheme", "app.example.com"],
    ["a wildcard", "*"],
    ["a wildcard host", "https://*.example.com"],
    ["a non-http scheme", "ws://app.example.com"],
    ["a file scheme", "file:///Users/dev/index.html"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["an embedded space", "https://app.example.com https://evil.example"],
  ])("rejects %s", (_label, value) => {
    expect(normalizeOrigin(value)).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin(42)).toBeNull();
    expect(normalizeOrigin(["https://app.example.com"])).toBeNull();
  });
});

describe("normalizeAllowedOrigins", () => {
  it("normalizes every entry and preserves order", () => {
    const result = normalizeAllowedOrigins([
      "HTTPS://App.Example.com",
      "http://localhost:3000",
    ]);
    expect(result).toEqual({
      ok: true,
      value: ["https://app.example.com", "http://localhost:3000"],
    });
  });

  it("collapses duplicates that differ only in case", () => {
    const result = normalizeAllowedOrigins([
      "https://app.example.com",
      "https://APP.example.com",
    ]);
    expect(result).toEqual({ ok: true, value: ["https://app.example.com"] });
  });

  it("accepts an empty list", () => {
    expect(normalizeAllowedOrigins([])).toEqual({ ok: true, value: [] });
  });

  it("names the offending entry when one is invalid", () => {
    const result = normalizeAllowedOrigins([
      "https://app.example.com",
      "https://app.example.com/dashboard",
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("https://app.example.com/dashboard");
  });

  it("rejects a non-array", () => {
    const result = normalizeAllowedOrigins("https://app.example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("must be an array");
  });

  it("rejects a list longer than the cap", () => {
    const many = Array.from(
      { length: MAX_APP_ALLOWED_ORIGINS + 1 },
      (_, i) => `https://host-${i}.example.com`,
    );
    const result = normalizeAllowedOrigins(many);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(MAX_APP_ALLOWED_ORIGINS));
  });
});
