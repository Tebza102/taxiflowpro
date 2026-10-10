import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveTenantMode } from "../src/lib/securityMode.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("any build that can reach Supabase, or is configured live, is a tenant build", () => {
  assert.equal(resolveTenantMode({ hasSupabaseConfig: true, configuredBackendMode: "live" }), true);
  // A mock-configured build with real Supabase settings cannot use the legacy path.
  assert.equal(resolveTenantMode({ hasSupabaseConfig: true, configuredBackendMode: "mock" }), true);
  // A live build without settings fails closed through the tenant path.
  assert.equal(resolveTenantMode({ hasSupabaseConfig: false, configuredBackendMode: "live" }), true);
});

test("only a build with no Supabase settings and mock mode is the demo build", () => {
  assert.equal(resolveTenantMode({ hasSupabaseConfig: false, configuredBackendMode: "mock" }), false);
  assert.equal(resolveTenantMode(), false);
});

test("no build flag selects the tenant or legacy path", async () => {
  const sources = await Promise.all(
    ["src/lib/tenantWorkspace.js", "src/lib/securityMode.js", "src/lib/dataGateway.js", "src/App.jsx", "api/admin/auth-users.js", "api/admin/bootstrap-workspace.js"].map(read),
  );
  for (const source of sources) {
    assert.doesNotMatch(source, /VITE_TENANT_MODE\s*===|TAXIFLOW_TENANT_MODE/);
  }
  assert.match(sources[0], /isTenantMode = resolveTenantMode\(\{ hasSupabaseConfig, configuredBackendMode \}\)/);
});

test("every legacy direct workspace_snapshots function refuses in tenant builds before any network call", async () => {
  const source = await read("src/lib/dataGateway.js");
  for (const name of ["getLiveSnapshotMeta", "loadSupabaseLiveSnapshot", "persistSupabaseLiveSnapshot"]) {
    const start = source.indexOf(`const ${name} = async`);
    assert.ok(start >= 0, `${name} exists`);
    const head = source.slice(start, start + 400);
    const guard = head.indexOf("if (isTenantMode)");
    assert.ok(guard > 0, `${name} starts with the tenant guard`);
    assert.ok(guard < (head.indexOf("supabase") === -1 ? Infinity : head.indexOf("supabase")), `${name} guard precedes Supabase access`);
  }
  // Every direct table access sits inside one of those guarded function bodies
  // (a body ends at the next top-level declaration).
  const bodies = ["getLiveSnapshotMeta", "loadSupabaseLiveSnapshot", "persistSupabaseLiveSnapshot"].map((name) => {
    const start = source.indexOf(`const ${name} = async`);
    const end = source.indexOf("\nconst ", start + 1);
    return [start, end < 0 ? source.length : end];
  });
  let index = source.indexOf('.from("workspace_snapshots")');
  let count = 0;
  while (index >= 0) {
    count += 1;
    assert.ok(bodies.some(([start, end]) => index > start && index < end), `workspace_snapshots access at ${index} is inside a guarded function`);
    index = source.indexOf('.from("workspace_snapshots")', index + 1);
  }
  assert.ok(count >= 3);
});
