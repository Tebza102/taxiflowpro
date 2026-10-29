import { defineConfig } from "@playwright/test";

import { ACTIVE_PROFILE } from "./scripts/localdb/lib/localTarget.mjs";

// TAXIFLOW_LOCALDB_PROFILE=test runs these resetting suites against the separate
// test stack, leaving the default (rehearsal) stack untouched.
const APP_URL = `http://127.0.0.1:${ACTIVE_PROFILE.appPort}`;

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
    baseURL: APP_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node scripts/localdb/dev-tenant.mjs ${ACTIVE_PROFILE.appPort}`,
    url: APP_URL,
    // Never reuse a server: a server from the other profile would point at the wrong stack.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
