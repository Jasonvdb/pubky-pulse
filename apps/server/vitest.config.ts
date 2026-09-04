import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
    globalSetup: "./src/__tests__/global-setup.ts",
    exclude: ["dist/**", "node_modules/**"],
    // config.ts validates identity configuration at module load and every suite
    // imports it transitively, so these must be present in each test worker
    // before the first import. They match the domains seedTestData already uses;
    // global-setup.ts mirrors them for the main process.
    env: {
      PULSE_ALLOWED_EMAIL_DOMAINS: "pulse.pubky.org,example.com",
      PULSE_TEAM_OWNER_EMAIL: "test@pulse.pubky.org",
      PULSE_DEFAULT_TEAM_SLUG: "test-team",
      PULSE_DEFAULT_TEAM_NAME: "Test Team",
    },
  },
});
