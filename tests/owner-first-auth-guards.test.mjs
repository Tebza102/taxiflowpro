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

test("Supabase account API protects Owner identities and supports deleting non-owners", async () => {
  const source = await read("api/admin/auth-users.js");

  assert.match(source, /"delete"/);
  assert.match(source, /Owner accounts cannot be deleted inside TaxiFlow/);
  assert.match(source, /Owner accounts cannot be demoted inside TaxiFlow/);
  assert.match(source, /supabase\.auth\.admin\.deleteUser/);
});

test("production reset requires explicit destructive confirmation and bootstraps one Owner", async () => {
  const source = await read("scripts/reset-production-users.mjs");

  assert.match(source, /RESET_TAXIFLOW_PRODUCTION_USERS/);
  assert.match(source, /role: "Owner"/);
  assert.match(source, /appUsers: \[ownerRecord\]/);
  assert.match(source, /accessPassword: null/);
});

test("production reset clears workspace auth-user foreign keys before deleting old users", async () => {
  const source = await read("scripts/reset-production-users.mjs");

  assert.match(source, /select\("workspace_key, updated_by"\)/);
  assert.match(source, /update\(\{ updated_by: null \}\)/);

  const clearIndex = source.indexOf('update({ updated_by: null })');
  const deleteIndex = source.indexOf('supabase.auth.admin.deleteUser(user.id)');

  assert.ok(clearIndex >= 0, "expected workspace updated_by cleanup");
  assert.ok(deleteIndex >= 0, "expected old Auth user deletion");
  assert.ok(clearIndex < deleteIndex, "workspace foreign-key cleanup must happen before Auth deletion");
});
