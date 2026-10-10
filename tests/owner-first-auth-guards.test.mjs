import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("live startup fails closed when Supabase auth is unavailable", async () => {
  const source = await read("src/components/ProductionAuthGuard.jsx");

  assert.match(source, /configuredBackendMode === "live"/);
  assert.match(source, /hasSupabaseConfig && Boolean\(supabase\)/);
  assert.match(source, /liveMode && !secureAuthReady/);
  assert.match(source, /Secure sign-in is unavailable/);
});

test("live runtime does not expose seeded @taxiflow.local management accounts", async () => {
  const source = await read("src/lib/appRuntimeSecure.js");

  assert.match(source, /DEMO_EMAIL_SUFFIX = "@taxiflow\.local"/);
  assert.match(source, /AUTH_ACCOUNT_DIRECTORY = LIVE_MODE \? \{\}/);
  assert.match(source, /LOCAL_AUTH_PASSWORD = LIVE_MODE \? null/);
  assert.match(source, /filter\(\(user\) => user\.email && !isDemoSeedEmail\(user\.email\)\)/);
});

test("live snapshot persistence strips local seed users and plaintext credential fields", async () => {
  const source = await read("src/lib/dataGatewaySecure.js");

  assert.match(source, /endsWith\(DEMO_EMAIL_SUFFIX\)/);
  assert.match(source, /const \{ accessPassword, localPassword, password, \.\.\.safeRecord \} = record/);
  assert.match(source, /sanitizeLiveSnapshot\(snapshot\)/);
});

test("legacy account and bootstrap routes are retired unconditionally (no env switch)", async () => {
  for (const route of ["api/admin/auth-users.js", "api/admin/bootstrap-workspace.js"]) {
    const source = await read(route);
    assert.match(source, /410\)/);
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /SERVICE_ROLE|userLifecycle|workspaceBootstrap|createClient/);
  }
});

test("user lifecycle module protects Owner identities and supports deleting non-owners", async () => {
  const source = await read("api/_lib/userLifecycle.js");

  assert.match(source, /Owner accounts cannot be deleted inside TaxiFlow/);
  assert.match(source, /Owner accounts cannot be demoted inside TaxiFlow/);
  assert.match(source, /supabase\.auth\.admin\.deleteUser/);
});

test("legacy production-user scripts are retired: they stop before any setting or network access", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const script of ["scripts/reset-production-users.mjs", "scripts/reconcile-production-users.mjs"]) {
    const source = await read(script);
    assert.doesNotMatch(source, /^\s*import\s/m, `${script} imports nothing`);
    assert.doesNotMatch(source, /process\.env|fetch\(|createClient/, `${script} reads no settings and opens no connection`);
    // Even with every old setting and the old confirmation present, it exits at once.
    const result = spawnSync(process.execPath, [new URL(`../${script}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "--confirm"], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        SUPABASE_URL: "https://vfxftviwteypasredjgm.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
        TAXIFLOW_CONFIRM_OWNER_RESET: "RESET_TAXIFLOW_PRODUCTION_USERS",
        TAXIFLOW_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        TAXIFLOW_BOOTSTRAP_OWNER_PASSWORD: "not-a-real-password",
      },
    });
    assert.equal(result.status, 2, `${script} exits with status 2`);
    assert.match(result.stderr, /RETIRED: .* is disabled and does nothing/);
    assert.equal(result.stdout, "");
  }
});
