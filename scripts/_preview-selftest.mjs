import { createServiceClient } from "../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

// TEMPORARY, Preview-only. Disposable Driver PROFILE persistence proof (no route,
// no vehicle, no login password - so this never touches Supabase Auth at all).
// Mirrors the Route proof: exercises the same atomic compare-and-swap write
// saveDriver now uses via commitLiveSnapshotMutation, directly against the real
// workspace_snapshots row.
//
// Hard-gated to Preview + this exact branch. Always exits 0. Temporary - removed
// once the result is read from the build log.

const log = (...args) => console.log("[driver-selftest]", ...args);

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
  const testStaffId = `drv-persistence-test-${Date.now()}`;
  const testDriver = {
    staffId: testStaffId,
    name: `Persistence Test Driver ${Date.now()}`,
    email: `driver.persistence.test.${Date.now()}@example.invalid`,
    route: "",
    routeIds: [],
    routeNames: [],
    primaryRouteId: null,
    shiftStatus: "Ready for dispatch",
    avgShiftRevenue: 0,
    cashAccuracy: 100,
    licenseNumber: null,
    licenseCode: null,
    licenseExpiryDate: null,
    prdpNumber: null,
    prdpExpiryDate: null,
    role: "Driver",
    createdAt: new Date().toISOString(),
  };

  // ---------- CREATE (profile only - no route, no vehicle, no login) ----------
  const initialRow = await readRow();
  if (!initialRow) {
    log("FAIL: no workspace row found.");
    return;
  }
  const initialDrivers = Array.isArray(initialRow.snapshot?.drivers) ? initialRow.snapshot.drivers : [];
  const createResult = await atomicWrite(
    { ...initialRow.snapshot, drivers: [testDriver, ...initialDrivers] },
    initialRow.updated_at,
  );

  if (!createResult.ok) {
    log("Create: FAIL", createResult.error ?? "conflict");
    return;
  }
  log("Create: PASS");

  // ---------- FRESH READ 1 ----------
  const read1 = await readRow();
  const found1 = (read1.snapshot?.drivers ?? []).some((d) => d.staffId === testStaffId);
  log(`Fresh read 1: ${found1 ? "PASS" : "FAIL"}`);

  // ---------- FRESH READ 2 (independent) ----------
  const read2 = await readRow();
  const found2 = (read2.snapshot?.drivers ?? []).some((d) => d.staffId === testStaffId);
  log(`Fresh read 2: ${found2 ? "PASS" : "FAIL"}`);

  const noRouteNoVehicle =
    found2 &&
    (() => {
      const d = read2.snapshot.drivers.find((driver) => driver.staffId === testStaffId);
      const hasNoRoute = !d.route && (d.routeIds ?? []).length === 0 && !d.primaryRouteId;
      const vehicles = Array.isArray(read2.snapshot?.vehicles) ? read2.snapshot.vehicles : [];
      const hasNoVehicle = !vehicles.some((v) => v.assignedDriverId === testStaffId);
      return hasNoRoute && hasNoVehicle;
    })();
  log(`Confirmed no route / no vehicle: ${noRouteNoVehicle ? "PASS" : "FAIL"}`);

  // ---------- CLEANUP ----------
  const preDeleteRow = await readRow();
  const driversWithoutTest = (preDeleteRow.snapshot?.drivers ?? []).filter((d) => d.staffId !== testStaffId);
  const deleteResult = await atomicWrite(
    { ...preDeleteRow.snapshot, drivers: driversWithoutTest },
    preDeleteRow.updated_at,
  );
  log(`Cleanup write: ${deleteResult.ok ? "PASS" : "FAIL"}`);

  const finalRow = await readRow();
  const stillPresent = (finalRow.snapshot?.drivers ?? []).some((d) => d.staffId === testStaffId);
  log(`Cleanup verified (driver gone): ${!stillPresent ? "PASS" : "FAIL"}`);

  const otherFieldsPreserved =
    JSON.stringify({ ...finalRow.snapshot, drivers: undefined }) ===
    JSON.stringify({ ...initialRow.snapshot, drivers: undefined });
  log(`Other snapshot fields preserved: ${otherFieldsPreserved ? "PASS" : "FAIL"}`);

  const passed =
    createResult.ok && found1 && found2 && noRouteNoVehicle && deleteResult.ok && !stillPresent && otherFieldsPreserved;
  log(passed ? "RESULT: PASS" : "RESULT: FAIL");
  log("No Supabase Auth account was created or touched for this test (no login password used).");
};

main()
  .catch((error) => log("RESULT: FAIL (unexpected error):", error?.message ?? error))
  .finally(() => process.exit(0));
