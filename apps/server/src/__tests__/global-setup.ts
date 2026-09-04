import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Ensure the server config picks up a test-scoped attachments directory before any
// test code imports config.ts.
const attachmentsTempDir =
  process.env.PULSE_ATTACHMENTS_PATH ||
  mkdtempSync(join(tmpdir(), "pubky-pulse-attachments-test-"));
process.env.PULSE_ATTACHMENTS_PATH = attachmentsTempDir;
process.env.PULSE_ATTACHMENTS_SIGNING_SECRET =
  process.env.PULSE_ATTACHMENTS_SIGNING_SECRET || "test-attachment-secret";

// Identity configuration is required — config.ts throws without it — and these
// values mirror vitest.config.ts `test.env`, which covers the worker processes
// but not this one. The domains match what seedTestData inserts.
process.env.PULSE_ALLOWED_EMAIL_DOMAINS =
  process.env.PULSE_ALLOWED_EMAIL_DOMAINS || "pulse.pubky.org,example.com";
process.env.PULSE_TEAM_OWNER_EMAIL =
  process.env.PULSE_TEAM_OWNER_EMAIL || "test@pulse.pubky.org";
process.env.PULSE_DEFAULT_TEAM_SLUG =
  process.env.PULSE_DEFAULT_TEAM_SLUG || "test-team";
process.env.PULSE_DEFAULT_TEAM_NAME =
  process.env.PULSE_DEFAULT_TEAM_NAME || "Test Team";

export async function setup() {
  // Imported lazily: ./setup.js pulls in the routes and therefore config.ts,
  // whose module-load validation must see the environment assigned above.
  const { setupTestDb } = await import("./setup.js");
  await setupTestDb();
}

export async function teardown() {
  if (attachmentsTempDir.startsWith(tmpdir())) {
    rmSync(attachmentsTempDir, { recursive: true, force: true });
  }
}
