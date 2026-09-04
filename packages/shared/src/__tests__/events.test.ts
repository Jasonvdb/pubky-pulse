import { describe, it, expect } from "vitest";
import {
  HTTP_DURATION_MS_ATTRIBUTE,
  HTTP_STATUS_ATTRIBUTE,
  PAGE_URL_ATTRIBUTE,
  REFERRER_ATTRIBUTE,
} from "../events.js";
import {
  MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH,
  RESERVED_ATTRIBUTE_VALUE_LENGTH_OVERRIDES,
} from "../constants.js";

describe("reserved web attribute keys", () => {
  // SDKs write these literals on the wire, so the constants are a contract:
  // renaming a value would silently orphan every event already ingested.
  it("pins the key names the Web SDK emits", () => {
    expect(PAGE_URL_ATTRIBUTE).toBe("_page_url");
    expect(REFERRER_ATTRIBUTE).toBe("_referrer");
    expect(HTTP_STATUS_ATTRIBUTE).toBe("_http_status");
    expect(HTTP_DURATION_MS_ATTRIBUTE).toBe("_http_duration_ms");
  });

  it("gives URL-valued keys a 2048-char cap", () => {
    expect(RESERVED_ATTRIBUTE_VALUE_LENGTH_OVERRIDES[PAGE_URL_ATTRIBUTE]).toBe(2048);
    expect(RESERVED_ATTRIBUTE_VALUE_LENGTH_OVERRIDES[REFERRER_ATTRIBUTE]).toBe(2048);
  });

  it("leaves the small HTTP keys on the default cap", () => {
    expect(RESERVED_ATTRIBUTE_VALUE_LENGTH_OVERRIDES[HTTP_STATUS_ATTRIBUTE]).toBeUndefined();
    expect(RESERVED_ATTRIBUTE_VALUE_LENGTH_OVERRIDES[HTTP_DURATION_MS_ATTRIBUTE]).toBeUndefined();
  });

  it("only overrides caps upward from the default", () => {
    for (const cap of Object.values(RESERVED_ATTRIBUTE_VALUE_LENGTH_OVERRIDES)) {
      expect(cap).toBeGreaterThan(MAX_CUSTOM_ATTRIBUTE_VALUE_LENGTH);
    }
  });
});
