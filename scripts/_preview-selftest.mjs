import { createServiceClient } from "../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

// TEMPORARY, Preview-only. Disposable-route persistence proof, mirroring the
// account-persistence proof from earlier in this branch. saveRouteProfile /
// commitLiveSnapshotMutation are closures inside the App() component and cannot be
// imported into a standalone script, so this exercises the SAME underlying
// mechanism they use - the atomic compare-and-swap UPDATE in
// src/lib/dataGateway.js's persistSupabaseLiveSnapshot - directly against the real
// workspace_snapshots row, adding one disposable route, verifying two independent
// fresh reads, then removing it via the same mechanism. Owner/Admin/Manager and
// every other snapshot field are read and rewritten unchanged.
//
// Hard-gated to Preview + this exact branch. Always exits 0. Temporary - removed
// once the result is read from the build log.

const log = (...args) => console.log("[route-selftest]", ...args);

const isTargetEnvironment =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "agent/owner-first-auth-reset";

if (!isTargetEnvironment) {
  log(`skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, VERCEL_GIT_COMMIT_REF=${process.env.VERCEL_GIT_COMMIT_REF ?? "unset"})`);
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  log("skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in this build.");
  process.exit(0);
}

const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const WORKSPACE_KEY = resolveServerWorkspaceKey();

const readRow = async () => {
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot, updated_at")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();
  if (error) throw new Error(`Workspace read failed: ${error.message}`);
  return data;
};

// Same atomic pattern as persistSupabaseLiveSnapshot: UPDATE gated by BOTH
// workspace_key and the expected prior updated_at, checking how many rows the
// write actually touched.
const atomicWrite = async (nextSnapshot, expectedVersion) => {
  const nextUpdatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .update({ snapshot: nextSnapshot, updated_at: nextUpdatedAt })
    .eq("workspace_key", WORKSPACE_KEY)
    .eq("updated_at", expectedVersion)
    .select("updated_at");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, conflict: true };
  return { ok: true, updatedAt: nextUpdatedAt };
};

const main = async () => {
  const testRouteId = `route-persistence-test-${Date.now()}`;
  const testRoute = {
    id: testRouteId,
    name: `Persistence Test Route ${Date.now()}`,
    code: `PTEST${Date.now()}`.slice(0, 12).toUpperCase(),
    type: "route_service",
    primaryOrigin: "Persistence Test Origin",
    primaryDestination: "Persistence Test Destination",
    route: `Persistence Test Route ${Date.now()}`,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  // ---------- CREATE ----------
  const initialRow = await readRow();
  if (!initialRow) {
    log("FAIL: no workspace row found.");
    return;
  }
  const initialRoutes = Array.isArray(initialRow.snapshot?.routes) ? initialRow.snapshot.routes : [];
  const createResult = await atomicWrite(
    { ...initialRow.snapshot, routes: [testRoute, ...initialRoutes] },
    initialRow.updated_at,
  );

  if (!createResult.ok) {
    log("Create: FAIL", createResult.error ?? "conflict");
    return;
  }
  log("Create: PASS");

  // ---------- FRESH READ 1 ----------
  const read1 = await readRow();
  const found1 = (read1.snapshot?.routes ?? []).some((r) => r.id === testRouteId);
  log(`Fresh read 1: ${found1 ? "PASS" : "FAIL"}`);

  // ---------- FRESH READ 2 (independent) ----------
  const read2 = await readRow();
  const found2 = (read2.snapshot?.routes ?? []).some((r) => r.id === testRouteId);
  log(`Fresh read 2: ${found2 ? "PASS" : "FAIL"}`);

  // ---------- CLEANUP ----------
  const preDeleteRow = await readRow();
  const routesWithoutTest = (preDeleteRow.snapshot?.routes ?? []).filter((r) => r.id !== testRouteId);
  const deleteResult = await atomicWrite(
    { ...preDeleteRow.snapshot, routes: routesWithoutTest },
    preDeleteRow.updated_at,
  );
  log(`Cleanup write: ${deleteResult.ok ? "PASS" : "FAIL"}`);

  const finalRow = await readRow();
  const stillPresent = (finalRow.snapshot?.routes ?? []).some((r) => r.id === testRouteId);
  log(`Cleanup verified (route gone): ${!stillPresent ? "PASS" : "FAIL"}`);

  const otherFieldsPreserved =
    JSON.stringify({ ...finalRow.snapshot, routes: undefined }) ===
    JSON.stringify({ ...initialRow.snapshot, routes: undefined });
  log(`Other snapshot fields preserved: ${otherFieldsPreserved ? "PASS" : "FAIL"}`);

  const passed = createResult.ok && found1 && found2 && deleteResult.ok && !stillPresent && otherFieldsPreserved;
  log(passed ? "RESULT: PASS" : "RESULT: FAIL");
};

main()
  .catch((error) => log("RESULT: FAIL (unexpected error):", error?.message ?? error))
  .finally(() => process.exit(0));
