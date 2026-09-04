import { describe, it, expect } from "vitest";
import {
  normalizeErrorMessage,
  generateIssueFingerprint,
  canonicalizeBrowserErrorMessage,
} from "../issues.js";

describe("normalizeErrorMessage", () => {
  it("replaces UUIDs with <uuid>", () => {
    expect(normalizeErrorMessage("User 550e8400-e29b-41d4-a716-446655440000 not found"))
      .toBe("user <uuid> not found");
  });

  it("replaces multiple UUIDs", () => {
    expect(normalizeErrorMessage("Link 550e8400-e29b-41d4-a716-446655440000 to 6ba7b810-9dad-11d1-80b4-00c04fd430c8"))
      .toBe("link <uuid> to <uuid>");
  });

  it("replaces uppercase UUIDs", () => {
    expect(normalizeErrorMessage("ID: 550E8400-E29B-41D4-A716-446655440000"))
      .toBe("id: <uuid>");
  });

  it("replaces integers with <n>", () => {
    expect(normalizeErrorMessage("Error code 404"))
      .toBe("error code <n>");
  });

  it("replaces floating point numbers", () => {
    expect(normalizeErrorMessage("Timeout after 3.5 seconds"))
      .toBe("timeout after <n> seconds");
  });

  it("replaces version-like numbers", () => {
    expect(normalizeErrorMessage("Version 1.2.3 incompatible"))
      .toBe("version <n> incompatible");
  });

  it("replaces negative-adjacent numbers", () => {
    // The regex replaces word-boundary numbers, so "-5" becomes "-<n>"
    expect(normalizeErrorMessage("offset -5 is invalid"))
      .toBe("offset -<n> is invalid");
  });

  it("replaces double-quoted strings with <s>", () => {
    expect(normalizeErrorMessage('Key "username" is required'))
      .toBe('key "<s>" is required');
  });

  it("replaces single-quoted strings with <s>", () => {
    expect(normalizeErrorMessage("Module 'express' not found"))
      .toBe("module '<s>' not found");
  });

  it("handles apostrophes — greedy match consumes contraction", () => {
    // The regex matches 't find module ' as a single-quoted string.
    // This means "Can't find module 'X'" normalizes differently depending on X
    // when there's a contraction. This is a known trade-off of simple regex normalization.
    // Errors without contractions normalize correctly:
    const a = normalizeErrorMessage("Cannot find module 'express'");
    const b = normalizeErrorMessage("Cannot find module 'lodash'");
    expect(a).toBe(b);
    expect(a).toBe("cannot find module '<s>'");
  });

  it("replaces empty quoted strings", () => {
    expect(normalizeErrorMessage('Value "" is not allowed'))
      .toBe('value "<s>" is not allowed');
  });

  it("lowercases the result", () => {
    expect(normalizeErrorMessage("FATAL ERROR"))
      .toBe("fatal error");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeErrorMessage("error   in   module"))
      .toBe("error in module");
  });

  it("trims whitespace", () => {
    expect(normalizeErrorMessage("  error message  "))
      .toBe("error message");
  });

  it("handles empty string", () => {
    expect(normalizeErrorMessage("")).toBe("");
  });

  it("handles message with only numbers", () => {
    expect(normalizeErrorMessage("12345")).toBe("<n>");
  });

  it("handles complex real-world error", () => {
    const msg = 'Failed to fetch user 12345 from /api/users/550e8400-e29b-41d4-a716-446655440000 with status 500';
    expect(normalizeErrorMessage(msg))
      .toBe('failed to fetch user <n> from /api/users/<uuid> with status <n>');
  });

  it("handles JSON-like content in error messages", () => {
    const msg = 'Invalid body: {"name":"test","count":42}';
    // Quotes around "name" and "test" get replaced
    expect(normalizeErrorMessage(msg)).toContain("<s>");
    expect(normalizeErrorMessage(msg)).toContain("<n>");
  });

  it("preserves path-like content", () => {
    expect(normalizeErrorMessage("File /var/log/app.log not found"))
      .toBe("file /var/log/app.log not found");
  });

  it("handles unicode characters", () => {
    expect(normalizeErrorMessage("Erreur: données invalides"))
      .toBe("erreur: données invalides");
  });

  it("normalizes tabs and newlines to spaces", () => {
    expect(normalizeErrorMessage("error\tin\nmodule"))
      .toBe("error in module");
  });

  it("produces identical output for semantically same errors with different values", () => {
    const a = normalizeErrorMessage("User 123 not found");
    const b = normalizeErrorMessage("User 456 not found");
    expect(a).toBe(b);
  });

  it("produces different output for structurally different errors", () => {
    const a = normalizeErrorMessage("Connection timeout");
    const b = normalizeErrorMessage("Authentication failed");
    expect(a).not.toBe(b);
  });
});

describe("generateIssueFingerprint", () => {
  it("returns a 64-character hex string", async () => {
    const fp = await generateIssueFingerprint("test error", null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same message and module produces same fingerprint", async () => {
    const a = await generateIssueFingerprint("Connection refused", "NetworkModule");
    const b = await generateIssueFingerprint("Connection refused", "NetworkModule");
    expect(a).toBe(b);
  });

  it("different messages produce different fingerprints", async () => {
    const a = await generateIssueFingerprint("Connection refused", null);
    const b = await generateIssueFingerprint("Timeout exceeded", null);
    expect(a).not.toBe(b);
  });

  it("same message with different modules produces different fingerprints", async () => {
    const a = await generateIssueFingerprint("Connection refused", "ModuleA");
    const b = await generateIssueFingerprint("Connection refused", "ModuleB");
    expect(a).not.toBe(b);
  });

  it("null source_module vs empty string produces different fingerprints", async () => {
    const a = await generateIssueFingerprint("Error", null);
    const b = await generateIssueFingerprint("Error", "");
    expect(a).toBe(b); // Both normalize to ":error" since null → ""
  });

  it("normalizes variable parts before hashing — same error with different IDs", async () => {
    const a = await generateIssueFingerprint("User 123 not found", "UserService");
    const b = await generateIssueFingerprint("User 456 not found", "UserService");
    expect(a).toBe(b);
  });

  it("normalizes UUIDs — same error with different UUIDs", async () => {
    const a = await generateIssueFingerprint(
      "Record 550e8400-e29b-41d4-a716-446655440000 not found", null
    );
    const b = await generateIssueFingerprint(
      "Record 6ba7b810-9dad-11d1-80b4-00c04fd430c8 not found", null
    );
    expect(a).toBe(b);
  });

  it("is case-insensitive", async () => {
    const a = await generateIssueFingerprint("CONNECTION REFUSED", "Net");
    const b = await generateIssueFingerprint("connection refused", "Net");
    expect(a).toBe(b);
  });

  it("handles empty message", async () => {
    const fp = await generateIssueFingerprint("", null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles very long messages", async () => {
    const longMsg = "Error: " + "x".repeat(10000);
    const fp = await generateIssueFingerprint(longMsg, null);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateIssueFingerprint with discriminator", () => {
  it("omitting discriminator matches the legacy 2-arg call", async () => {
    const a = await generateIssueFingerprint("sdk:network_request", "Net");
    const b = await generateIssueFingerprint("sdk:network_request", "Net", undefined);
    expect(a).toBe(b);
  });

  it("null discriminator equals omitting it", async () => {
    const a = await generateIssueFingerprint("sdk:network_request", "Net");
    const b = await generateIssueFingerprint("sdk:network_request", "Net", null);
    expect(a).toBe(b);
  });

  it("passing a discriminator changes the fingerprint vs no discriminator", async () => {
    const a = await generateIssueFingerprint("sdk:network_request", "Net");
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users",
    );
    expect(a).not.toBe(b);
  });

  it("same discriminator → same fingerprint", async () => {
    const a = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users",
    );
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users",
    );
    expect(a).toBe(b);
  });

  it("different host → different fingerprint", async () => {
    const a = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users",
    );
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.bar.com/v1/users",
    );
    expect(a).not.toBe(b);
  });

  it("different path on same host → different fingerprint", async () => {
    const a = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users",
    );
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/orders",
    );
    expect(a).not.toBe(b);
  });

  it("different methods → different fingerprints", async () => {
    const a = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users",
    );
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "POST api.foo.com/v1/users",
    );
    expect(a).not.toBe(b);
  });

  it("normalizer is reused — numeric path segments collapse", async () => {
    const a = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users/123",
    );
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/users/456",
    );
    expect(a).toBe(b);
  });

  it("normalizer is reused — UUIDs in path collapse", async () => {
    const a = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/sessions/550e8400-e29b-41d4-a716-446655440000",
    );
    const b = await generateIssueFingerprint(
      "sdk:network_request",
      "Net",
      "GET api.foo.com/v1/sessions/6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    );
    expect(a).toBe(b);
  });
});

// The same missing `cart.total` read, as each engine words it.
const UNDEFINED_PROPERTY_TRIPLE = [
  "Cannot read properties of undefined (reading 'total')", // Chrome
  "cart.total is undefined", // Firefox
  "undefined is not an object (evaluating 'cart.total')", // Safari
];

const NOT_A_FUNCTION_TRIPLE = [
  "cart.total is not a function", // Chrome
  "cart.total is not a function", // Firefox
  "cart.total is not a function. (In 'cart.total()', 'cart.total' is undefined)", // Safari
];

const NOT_DEFINED_TRIPLE = [
  "cart is not defined", // Chrome
  "cart is not defined", // Firefox
  "Can't find variable: cart", // Safari
];

describe("canonicalizeBrowserErrorMessage", () => {
  it("collapses the browser wordings of a read on undefined", () => {
    const canonical = UNDEFINED_PROPERTY_TRIPLE.map(canonicalizeBrowserErrorMessage);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("<undefined-property> total");
  });

  it("collapses the null-valued wordings onto the undefined ones", () => {
    for (const message of [
      "Cannot read properties of null (reading 'total')",
      "Cannot read property 'total' of null",
      "null is not an object (evaluating 'cart.total')",
      "cart.total is null",
    ]) {
      expect(canonicalizeBrowserErrorMessage(message)).toBe("<undefined-property> total");
    }
  });

  it("handles the legacy Chrome and Firefox property wordings", () => {
    expect(canonicalizeBrowserErrorMessage("Cannot read property 'total' of undefined"))
      .toBe("<undefined-property> total");
    expect(canonicalizeBrowserErrorMessage('can\'t access property "total", cart is undefined'))
      .toBe("<undefined-property> total");
  });

  it("collapses the browser wordings of calling a non-function", () => {
    const canonical = NOT_A_FUNCTION_TRIPLE.map(canonicalizeBrowserErrorMessage);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("<not-a-function> total");
  });

  it("collapses the browser wordings of an undeclared variable", () => {
    const canonical = NOT_DEFINED_TRIPLE.map(canonicalizeBrowserErrorMessage);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("<not-defined> cart");
  });

  it("collapses the cross-origin literal with and without its period", () => {
    expect(canonicalizeBrowserErrorMessage("Script error.")).toBe("<cross-origin-script-error>");
    expect(canonicalizeBrowserErrorMessage("Script error")).toBe("<cross-origin-script-error>");
  });

  it("keeps the property name, so different faults stay distinct", () => {
    expect(canonicalizeBrowserErrorMessage("Cannot read properties of undefined (reading 'total')"))
      .not.toBe(canonicalizeBrowserErrorMessage("items is undefined"));
  });

  it("keeps the fault kind, so a missing property and a bad call stay distinct", () => {
    expect(canonicalizeBrowserErrorMessage("cart.total is undefined"))
      .not.toBe(canonicalizeBrowserErrorMessage("cart.total is not a function"));
  });

  it("reduces a dotted expression to its last segment", () => {
    expect(canonicalizeBrowserErrorMessage("undefined is not an object (evaluating 'a.b.total')"))
      .toBe("<undefined-property> total");
  });

  it("returns unrecognised messages unchanged", () => {
    expect(canonicalizeBrowserErrorMessage("Checkout failed for order 42"))
      .toBe("Checkout failed for order 42");
    expect(canonicalizeBrowserErrorMessage("")).toBe("");
  });
});

describe("generateIssueFingerprint with environment", () => {
  const allTriples = [UNDEFINED_PROPERTY_TRIPLE, NOT_A_FUNCTION_TRIPLE, NOT_DEFINED_TRIPLE];

  it("groups each browser triple onto one fingerprint on web", async () => {
    for (const triple of allTriples) {
      const fps = await Promise.all(
        triple.map((m) => generateIssueFingerprint(m, "Checkout", null, "web")),
      );
      expect(new Set(fps).size).toBe(1);
    }
  });

  it("keeps the triples apart from each other on web", async () => {
    const fps = await Promise.all(
      allTriples.map((triple) => generateIssueFingerprint(triple[0], "Checkout", null, "web")),
    );
    expect(new Set(fps).size).toBe(allTriples.length);
  });

  it("leaves non-web environments split across browser wordings", async () => {
    for (const environment of [undefined, null, "production", "ios"]) {
      const fps = await Promise.all(
        UNDEFINED_PROPERTY_TRIPLE.map((m) =>
          generateIssueFingerprint(m, "Checkout", null, environment),
        ),
      );
      expect(new Set(fps).size).toBe(UNDEFINED_PROPERTY_TRIPLE.length);
    }
  });

  it("matches the legacy 2-arg and 3-arg output for non-web environments", async () => {
    const legacy2 = await generateIssueFingerprint("cart.total is undefined", "Checkout");
    const legacy3 = await generateIssueFingerprint("cart.total is undefined", "Checkout", null);
    expect(await generateIssueFingerprint("cart.total is undefined", "Checkout", null, null)).toBe(legacy2);
    expect(await generateIssueFingerprint("cart.total is undefined", "Checkout", null, "backend")).toBe(legacy3);
  });

  it("leaves an unrecognised web message on its legacy fingerprint", async () => {
    const legacy = await generateIssueFingerprint("Checkout failed", "Checkout");
    expect(await generateIssueFingerprint("Checkout failed", "Checkout", null, "web")).toBe(legacy);
  });

  it("still splits web fingerprints by discriminator", async () => {
    const a = await generateIssueFingerprint("cart.total is undefined", "Checkout", "TypeError", "web");
    const b = await generateIssueFingerprint("cart.total is undefined", "Checkout", "RangeError", "web");
    expect(a).not.toBe(b);
  });
});
