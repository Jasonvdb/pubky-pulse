import { describe, expect, it } from "vitest";
import { hasPostgresErrorCode } from "../utils/postgres-error.js";

const UNIQUE_VIOLATION = "23505";

describe("hasPostgresErrorCode", () => {
  it("matches a direct PostgreSQL error code", () => {
    expect(hasPostgresErrorCode({ code: UNIQUE_VIOLATION }, UNIQUE_VIOLATION)).toBe(true);
  });

  it("matches a PostgreSQL error code nested in the cause chain", () => {
    const wrapped = new Error("query failed", {
      cause: new Error("statement failed", {
        cause: { code: UNIQUE_VIOLATION },
      }),
    });

    expect(hasPostgresErrorCode(wrapped, UNIQUE_VIOLATION)).toBe(true);
  });

  it("does not match unrelated errors or nested fields outside the cause chain", () => {
    expect(hasPostgresErrorCode({ code: "23503" }, UNIQUE_VIOLATION)).toBe(false);
    expect(hasPostgresErrorCode({ error: { code: UNIQUE_VIOLATION } }, UNIQUE_VIOLATION)).toBe(false);
  });

  it("rejects malformed error values and non-string codes", () => {
    expect(hasPostgresErrorCode(null, UNIQUE_VIOLATION)).toBe(false);
    expect(hasPostgresErrorCode("query failed", UNIQUE_VIOLATION)).toBe(false);
    expect(hasPostgresErrorCode({ code: 23505 }, UNIQUE_VIOLATION)).toBe(false);
    expect(hasPostgresErrorCode({ cause: 42 }, UNIQUE_VIOLATION)).toBe(false);
  });

  it("stops safely when the cause chain is cyclic", () => {
    const first: { cause?: unknown } = {};
    const second: { cause?: unknown } = { cause: first };
    first.cause = second;

    expect(hasPostgresErrorCode(first, UNIQUE_VIOLATION)).toBe(false);
  });
});
