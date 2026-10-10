import { defineConfig } from "@playwright/test";

// Tenant-mode browser proof against the LOCAL synthetic Supabase stack only
// (scripts/localdb). Run after `node scripts/localdb/setup.mjs reset`:
//   npx playwright test -c playwright.localdb.config.mjs
// The dev server is started through scripts/localdb/dev-tenant.mjs, which
// refuses to run unless the stack is local and loopback-only.
export default defineConfig({
  testDir: "./tests/localdb-browser",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5175",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/localdb/dev-tenant.mjs 5175",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
