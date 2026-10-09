import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// saveVehicleProfile / archiveVehicle / logDefect / resolveDefect are closures
// defined inside the App() component in src/App.jsx (they close over React state
// and refs), so they cannot be imported and executed directly the way api/_lib/*
// helpers can. This follows the same "source-pinned" pattern already established
// for Route/Driver persistence (see tests/route-persistence.test.mjs,
// tests/driver-persistence.test.mjs): it asserts the exact behavioural shape of
// the shipped source, so a regression that reintroduces the old "React state
// changed -> report success" bug fails a test rather than only being caught by
// manual QA.

// Normalized to LF once here so every \n-based marker below matches regardless of
// whether the checkout has CRLF line endings (this repo's git config converts LF to
// CRLF on Windows checkouts).
const appSource = (await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const sliceFrom = (source, marker, length = 2200) => {
  const index = source.indexOf(marker);
  assert.ok(index !== -1, `expected to find "${marker}" in source`);
  return source.slice(index, index + length);
};

// ---------------------------------------------------------------------------
// saveVehicleProfile
// ---------------------------------------------------------------------------

test("saveVehicleProfile is async and does not report success before a remote commit", () => {
  const fn = sliceFrom(appSource, "const saveVehicleProfile = async (draft) => {", 5000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "saveVehicleProfile must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("saveVehicleProfile only returns ok:true after verifying the vehicle in the commit's returned snapshot", () => {
  const fn = sliceFrom(appSource, "const saveVehicleProfile = async (draft) => {", 5000);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const firstOkTrueIndex = fn.indexOf("ok: true");

  assert.ok(commitCallIndex !== -1);
  assert.ok(firstOkTrueIndex !== -1);
  assert.ok(commitCallIndex < firstOkTrueIndex, "the remote commit must happen before any ok:true is returned");

  assert.match(fn, /commitResult\.snapshot\?\.vehicles/);
  assert.match(fn, /confirmedVehicle\.id/);
});

test("saveVehicleProfile reports a clear failure message when the commit does not succeed", () => {
  const fn = sliceFrom(appSource, "const saveVehicleProfile = async (draft) => {", 5000);

  assert.match(fn, /if \(!commitResult\.ok\)/);
  assert.match(fn, /Vehicle profile could not be saved to the live workspace\. No confirmed change was made\./);
});

test("saveVehicleProfile keeps registration/model/route validation and driver-link rules", () => {
  const fn = sliceFrom(appSource, "const saveVehicleProfile = async (draft) => {", 5000);

  assert.match(fn, /Registration, model, and route are required\./);
  assert.match(fn, /Select a valid driver for this vehicle\./);
  assert.match(fn, /Only management can edit vehicle settings\./);
  assert.match(fn, /resolveVehicleRouteSelection\(/);
  assert.match(fn, /normalizeVehicleCapabilityHooks\(/);
});

// ---------------------------------------------------------------------------
// archiveVehicle
// ---------------------------------------------------------------------------

test("archiveVehicle is async and does not report success before a remote commit", () => {
  const fn = sliceFrom(appSource, "const archiveVehicle = async (vehicleId) => {", 3000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "archiveVehicle must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("archiveVehicle verifies the confirmed vehicle is actually archived before reporting success", () => {
  const fn = sliceFrom(appSource, "const archiveVehicle = async (vehicleId) => {", 3000);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const successIndex = fn.indexOf('archived for audit retention.` };');

  assert.ok(commitCallIndex !== -1 && successIndex !== -1);
  assert.ok(commitCallIndex < successIndex);
  assert.match(fn, /confirmedVehicle\.status !== "archived"/);
});

test("archiveVehicle keeps the already-archived guard and management-only rule", () => {
  const fn = sliceFrom(appSource, "const archiveVehicle = async (vehicleId) => {", 3000);

  assert.match(fn, /Vehicle is already archived\./);
  assert.match(fn, /Only management can archive vehicles\./);
  assert.match(fn, /Vehicle not found\./);
});

// ---------------------------------------------------------------------------
// logDefect
// ---------------------------------------------------------------------------

test("logDefect is async and does not report success before a remote commit", () => {
  const fn = sliceFrom(appSource, "const logDefect = async (draft) => {", 4000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "logDefect must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("logDefect only returns ok:true after verifying the defect in the commit's returned snapshot", () => {
  const fn = sliceFrom(appSource, "const logDefect = async (draft) => {", 4000);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const firstOkTrueIndex = fn.indexOf("ok: true");

  assert.ok(commitCallIndex !== -1 && firstOkTrueIndex !== -1);
  assert.ok(commitCallIndex < firstOkTrueIndex);
  assert.match(fn, /commitResult\.snapshot\?\.defects/);
  assert.match(fn, /confirmedDefect/);
});

test("logDefect keeps category/vehicle validation and the resolved-defect lock, including the Driver reporting path", () => {
  const fn = sliceFrom(appSource, "const logDefect = async (draft) => {", 4000);

  assert.match(fn, /Select a vehicle before reporting a problem\./);
  assert.match(fn, /Select a valid problem category\./);
  assert.match(fn, /Fixed problems can no longer be changed\./);
  assert.match(fn, /Only management can update reported problems\./);
  // Drivers must still be able to report a problem without fleet module-update access.
  assert.match(fn, /activeRole !== "Driver" && !hasModuleUpdateAccess\(current, "fleet"\)/);
});

// ---------------------------------------------------------------------------
// resolveDefect
// ---------------------------------------------------------------------------

test("resolveDefect is async and does not report success before a remote commit", () => {
  const fn = sliceFrom(appSource, "const resolveDefect = async (defectId, repairCost) => {", 4000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "resolveDefect must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("resolveDefect verifies both the resolved defect AND the linked expense transaction before reporting success", () => {
  const fn = sliceFrom(appSource, "const resolveDefect = async (defectId, repairCost) => {", 4000);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const successIndex = fn.indexOf("Problem marked as fixed and the repair cost was added to expenses.");

  assert.ok(commitCallIndex !== -1 && successIndex !== -1);
  assert.ok(commitCallIndex < successIndex);

  assert.match(fn, /commitResult\.snapshot\?\.defects/);
  assert.match(fn, /commitResult\.snapshot\?\.financeTransactions/);
  assert.match(fn, /confirmedDefect\.status !== "resolved"/);
  assert.match(fn, /!confirmedExpense/);
});

test("resolveDefect keeps the repair-cost validation, resolved-lock, and links the expense to the defect", () => {
  const fn = sliceFrom(appSource, "const resolveDefect = async (defectId, repairCost) => {", 4000);

  assert.match(fn, /Enter the repair cost before marking this as fixed\./);
  assert.match(fn, /Fixed problems can no longer be changed\./);
  assert.match(fn, /Only management can mark problems as fixed\./);
  assert.match(fn, /resolvedExpenseId: expenseId/);
  assert.match(fn, /status: "verified"/);
});

// ---------------------------------------------------------------------------
// FleetPanel UI: await + double-submission guards
// ---------------------------------------------------------------------------

test("FleetPanel vehicle submit awaits the async save and guards against double submission", () => {
  assert.match(appSource, /const \[vehicleSaving, setVehicleSaving\] = useState\(false\);/);

  const fn = sliceFrom(appSource, "const handleVehicleSubmit = async (event) => {", 700);
  assert.match(fn, /if \(vehicleSaving\) {\s*return;\s*}/);
  assert.match(fn, /await onSaveVehicle\(vehicleDraft\)/);
  assert.match(fn, /setVehicleSaving\(true\)/);
  assert.match(fn, /setVehicleSaving\(false\)/);

  assert.match(appSource, /disabled=\{!canEditFleetUpdates \|\| vehicleSaving\}/);
});

test("FleetPanel archive action awaits the async archive and guards against double submission", () => {
  assert.match(appSource, /const \[archivingVehicleId, setArchivingVehicleId\] = useState\(null\);/);

  const fn = sliceFrom(appSource, "const handleArchiveVehicle = async (vehicleId) => {", 500);
  assert.match(fn, /if \(archivingVehicleId\) {\s*return;\s*}/);
  assert.match(fn, /await onArchiveVehicle\(vehicleId\)/);
  assert.match(fn, /setArchivingVehicleId\(vehicleId\)/);
  assert.match(fn, /setArchivingVehicleId\(null\)/);

  assert.match(appSource, /onClick=\{\(\) => handleArchiveVehicle\(selectedVehicle\.id\)\}/);
});

test("FleetPanel defect submit awaits the async save and guards against double submission", () => {
  assert.match(appSource, /const \[defectSaving, setDefectSaving\] = useState\(false\);/);

  const fn = sliceFrom(appSource, "const handleDefectSubmit = async (event) => {", 700);
  assert.match(fn, /if \(defectSaving\) {\s*return;\s*}/);
  assert.match(fn, /await onLogDefect\(/);
  assert.match(fn, /setDefectSaving\(true\)/);
  assert.match(fn, /setDefectSaving\(false\)/);
});

test("FleetPanel resolve action awaits the async resolve and guards against double submission per-defect", () => {
  assert.match(appSource, /const \[resolvingDefectId, setResolvingDefectId\] = useState\(null\);/);

  const fn = sliceFrom(appSource, "const handleResolve = async (defectId) => {", 700);
  assert.match(fn, /if \(resolvingDefectId\) {\s*return;\s*}/);
  assert.match(fn, /await onResolveDefect\(defectId, resolutionCosts\[defectId\]\)/);
  assert.match(fn, /setResolvingDefectId\(defectId\)/);
  assert.match(fn, /setResolvingDefectId\(null\)/);
});

test("all four Fleet call sites in FleetPanel's props are the actual App-level functions (no parallel implementation)", () => {
  assert.match(appSource, /onSaveVehicle=\{saveVehicleProfile\}/);
  assert.match(appSource, /onArchiveVehicle=\{archiveVehicle\}/);
  assert.match(appSource, /onLogDefect=\{logDefect\}/);
  assert.match(appSource, /onResolveDefect=\{resolveDefect\}/);
});

// ---------------------------------------------------------------------------
// Regression: Routes and Drivers were not touched by this Fleet phase
// ---------------------------------------------------------------------------

test("REGRESSION: saveRouteProfile is untouched (still async, still commitLiveSnapshotMutation-based)", () => {
  const fn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 4000);
  assert.doesNotMatch(fn, /\bsetSnapshot\(/);
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("REGRESSION: saveDriver is untouched (still async, still separates profile from login)", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /enableLogin/);
});

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const dataGatewaySource = (
    await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  assert.match(dataGatewaySource, /\["pending", "counted", "verified", "banked"\]/);
});
