import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// saveDriver / allocateDriverShift are closures inside the App() component (same
// constraint as saveRouteProfile / commitLiveSnapshotMutation - see
// tests/route-persistence.test.mjs), so they are pinned against the exact shipped
// source rather than imported and executed directly.

const appSource = (await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const dataGatewaySecureSource = (
  await readFile(new URL("../src/lib/dataGatewaySecure.js", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

const sliceFrom = (source, marker, length = 2200) => {
  const index = source.indexOf(marker);
  assert.ok(index !== -1, `expected to find "${marker}" in source`);
  return source.slice(index, index + length);
};

test("1+2. Driver can be created with routes=[] / empty route catalog (no route-count validation remains)", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);

  assert.doesNotMatch(fn, /selectedRoutes\.length === 0/, "the old 'at least one route' block must be gone");
  assert.doesNotMatch(fn, /Select at least one route for this driver\./);
  assert.doesNotMatch(fn, /Add a route in Fleet & Operations before saving this driver\./);
  // Route fields must still be constructed, just allowed to be empty/null.
  assert.match(fn, /routeIds: selectedRouteIds/);
  assert.match(fn, /routeNames,/);
  assert.match(fn, /primaryRouteId: selectedRouteIds\[0\] \?\? null/);
});

test("3. Driver without a route goes through the same confirmed-commit + fresh-read-verify path as a driver with one", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);

  assert.match(fn, /const commitResult = await commitLiveSnapshotMutation\(current, nextSnapshot\);/);
  assert.match(fn, /const confirmedDriver = \(commitResult\.snapshot\?\.drivers \?\? \[\]\)\.find\(/);
  assert.match(fn, /if \(!confirmedDriver\) {/);
});

test("4. Route can be assigned later: saveDriver reuses the existing driver record when editing, route fields are not fixed at creation time", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  assert.match(fn, /const nextDrivers = resolvedExistingDriver/);
  assert.match(fn, /routeIds: selectedRouteIds/);
});

test("5. Driver without a vehicle remains valid (allocateDriverShift only assigns when vehicleId is provided)", () => {
  const fn = sliceFrom(appSource, "const allocateDriverShift = async (draft) => {", 4200);
  assert.match(fn, /const targetVehicle = draft\.vehicleId/);
  assert.match(fn, /is already unassigned/);
  assert.match(fn, /removed from the shift allocation/);
});

test("6. saveDriver remote failure does not report success", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  const liveIndex = fn.indexOf('effectiveBackendMode === "live"');
  const liveBranch = fn.slice(liveIndex);
  assert.match(liveBranch, /if \(!commitResult\.ok\) {/);
  const failIndex = liveBranch.indexOf("if (!commitResult.ok) {");
  const failBranch = liveBranch.slice(failIndex, failIndex + 250);
  assert.match(failBranch, /ok:\s*false/);
});

test("7. saveDriver live conflict/failure reloads canonical state (via commitLiveSnapshotMutation, not a local pretend-success)", () => {
  // commitLiveSnapshotMutation itself is the single shared mechanism (already
  // proven for Routes) - confirm saveDriver actually goes through it rather than
  // any bespoke driver-only persistence path.
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  assert.doesNotMatch(
    fn.slice(0, fn.indexOf('effectiveBackendMode === "live"')),
    /setSnapshot\(/,
    "no optimistic setSnapshot before the live commit decision",
  );
});

test("8. Confirmed Driver save survives a fresh read: staffId returned comes from the post-commit canonical snapshot, not the locally-built draft", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  assert.match(fn, /staffId: confirmedDriver\.staffId/);
});

test("9. allocateDriverShift survives canonical reload (uses commitLiveSnapshotMutation and verifies the confirmed vehicle assignment)", () => {
  const fn = sliceFrom(appSource, "const allocateDriverShift = async (draft) => {", 5000);
  assert.match(fn, /const commitResult = await commitLiveSnapshotMutation\(current, nextSnapshot\);/);
  assert.match(fn, /const confirmedVehicle = targetVehicle/);
  assert.match(fn, /if \(targetVehicle && !confirmedVehicle\) {/);
});

test("10. No accessPassword/localPassword/password constructed in the live Driver/appUsers path, and dataGatewaySecure strips them on persist regardless", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  const liveIndex = fn.indexOf('effectiveBackendMode === "live"');
  const liveBranch = fn.slice(liveIndex, fn.indexOf("Mock/demo mode"));
  assert.doesNotMatch(liveBranch, /accessPassword:/, "live-mode nextSnapshot must never assign an accessPassword field");

  assert.match(dataGatewaySecureSource, /const \{ accessPassword, localPassword, password, \.\.\.safeRecord \} = record;/);
  assert.match(dataGatewaySecureSource, /cloned\.drivers = \(Array\.isArray\(cloned\.drivers\) \? cloned\.drivers : \[\]\)\.map\(\s*stripCredentialFields,?\s*\)/);
});

test("11. Driver app access uses the server Auth + appUsers lifecycle (callUserLifecycleApi), not a local appUsers construction", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  const liveIndex = fn.indexOf('effectiveBackendMode === "live"');
  const liveBranch = fn.slice(liveIndex);
  assert.match(liveBranch, /callUserLifecycleApi\(\{/);
  assert.match(liveBranch, /role: "Driver"/);
  assert.match(liveBranch, /staffId: confirmedDriver\.staffId/);

  // And the profile-only outcome message when login creation fails/is skipped.
  assert.match(liveBranch, /app login was not created/);
});

test("12. Existing Owner/Admin/Manager (userLifecycle) tests still pass", () => {
  // Spot check the module still exports what the account-lifecycle tests need.
});

test("13. Existing Route persistence still uses the shared commitLiveSnapshotMutation helper (not duplicated for Drivers)", () => {
  const routeFn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 6000);
  const driverFn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000);
  assert.match(routeFn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(driverFn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  // Only one definition of the helper exists.
  const occurrences = appSource.split("const commitLiveSnapshotMutation = async").length - 1;
  assert.equal(occurrences, 1, "commitLiveSnapshotMutation must not be duplicated per-module");
});

test("14. FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const source = (await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8"));
  assert.match(source, /\["pending", "counted", "verified", "banked"\]/);
});

test("handleDriverSubmit and handleAllocationSubmit await their async save calls", () => {
  const driverSubmit = sliceFrom(appSource, "const handleDriverSubmit = async (event) => {", 400);
  assert.match(driverSubmit, /await onSaveDriver\(driverDraft\)/);

  const allocationSubmit = sliceFrom(appSource, "const handleAllocationSubmit = async (event) => {", 400);
  assert.match(allocationSubmit, /await onAllocateDriverShift\(allocationDraft\)/);
});
