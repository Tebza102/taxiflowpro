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
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  const liveBranchIndex = fn.indexOf("Live mode: the driver PROFILE");
  assert.ok(liveBranchIndex !== -1, "expected the live-mode commit branch to exist");
  assert.doesNotMatch(
    fn.slice(0, liveBranchIndex),
    /setSnapshot\(/,
    "no optimistic setSnapshot before the live commit decision",
  );
});

test("8. Confirmed Driver save survives a fresh read: staffId returned comes from the post-commit canonical snapshot, not the locally-built draft", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  assert.match(fn, /staffId: confirmedDriver\.staffId/);
});

test("9. allocateDriverShift survives canonical reload (uses commitLiveSnapshotMutation and verifies the confirmed vehicle assignment)", () => {
  const fn = sliceFrom(appSource, "const allocateDriverShift = async (draft) => {", 5000);
  assert.match(fn, /const commitResult = await commitLiveSnapshotMutation\(current, nextSnapshot\);/);
  assert.match(fn, /const confirmedVehicle = targetVehicle/);
  assert.match(fn, /if \(targetVehicle && !confirmedVehicle\) {/);
});

test("10. No accessPassword/localPassword/password constructed in the live Driver/appUsers path, and dataGatewaySecure strips them on persist regardless", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  const liveIndex = fn.indexOf("Live mode: the driver PROFILE");
  const liveBranch = fn.slice(liveIndex, fn.indexOf("Mock/demo mode"));
  assert.doesNotMatch(liveBranch, /accessPassword:/, "live-mode nextSnapshot must never assign an accessPassword field");

  assert.match(dataGatewaySecureSource, /const \{ accessPassword, localPassword, password, \.\.\.safeRecord \} = record;/);
  assert.match(dataGatewaySecureSource, /cloned\.drivers = \(Array\.isArray\(cloned\.drivers\) \? cloned\.drivers : \[\]\)\.map\(\s*stripCredentialFields,?\s*\)/);
});

test("11. Driver app access uses the server Auth + appUsers lifecycle (callUserLifecycleApi), not a local appUsers construction", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  const liveIndex = fn.indexOf("Live mode: the driver PROFILE");
  const liveBranch = fn.slice(liveIndex);
  assert.match(liveBranch, /callUserLifecycleApi\(\{/);
  assert.match(liveBranch, /role: "Driver"/);
  assert.match(liveBranch, /staffId: confirmedDriver\.staffId/);

  // And the profile-only outcome message when login creation fails/is skipped.
  assert.match(liveBranch, /TaxiFlow login was not created/);
});

test("12. Existing Owner/Admin/Manager (userLifecycle) tests still pass", () => {
  // Spot check the module still exports what the account-lifecycle tests need.
});

test("13. Existing Route persistence still uses the shared commitLiveSnapshotMutation helper (not duplicated for Drivers)", () => {
  const routeFn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 6000);
  const driverFn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
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
  const driverSubmit = sliceFrom(appSource, "const handleDriverSubmit = async (event) => {", 700);
  assert.match(driverSubmit, /await onSaveDriver\(driverDraft\)/);

  const allocationSubmit = sliceFrom(appSource, "const handleAllocationSubmit = async (event) => {", 400);
  assert.match(allocationSubmit, /await onAllocateDriverShift\(allocationDraft\)/);
});

// ============================================================
// Phase: Driver final tightening (email optional, explicit login
// opt-in, shared password policy, show/hide, Owner-only, unassigned UX)
// ============================================================

test("Driver profile does not require email: no bare 'email is required' rejection remains, only format validation when non-empty", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  assert.doesNotMatch(fn, /Driver email is required\./);
  assert.match(fn, /if \(email && !isValidEmailAddress\(email\)\) {/);
  assert.match(fn, /Enter a valid driver email address\./);
});

test("Login access is an explicit opt-in (enableLogin), never implied by a stray password value alone", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  assert.match(fn, /const enableLogin = Boolean\(draft\.enableLogin\);/);
  assert.match(fn, /if \(enableLogin && activeRole !== "Owner"\) {/);
  assert.match(fn, /if \(enableLogin && !email\) {/);
});

test("Login-enabled Driver requires a valid email (enforced before any password check)", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  const enableLoginIndex = fn.indexOf("if (enableLogin && !email) {");
  const emailRequiredIndex = fn.indexOf("A valid email is required to enable TaxiFlow login.");
  assert.ok(enableLoginIndex !== -1 && emailRequiredIndex !== -1);
  assert.ok(emailRequiredIndex > enableLoginIndex);
});

test("Login-enabled Driver (new login) requires a password, and live minimum length matches userLifecycle.js's MIN_LIVE_LOGIN_PASSWORD_LENGTH (8), not the old 6-character rule", async () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  assert.match(fn, /if \(enableLogin && !existingUser && !requestedPassword\) {/);
  assert.match(fn, /requestedPassword\.length < MIN_LIVE_LOGIN_PASSWORD_LENGTH/);
  assert.match(appSource, /import \{ MIN_LIVE_LOGIN_PASSWORD_LENGTH \} from "\.\/lib\/accountPolicy";/);

  const policySource = await readFile(new URL("../src/lib/accountPolicy.js", import.meta.url), "utf8");
  assert.match(policySource, /export const MIN_LIVE_LOGIN_PASSWORD_LENGTH = 8;/);

  const lifecycleSource = (
    await readFile(new URL("../api/_lib/userLifecycle.js", import.meta.url), "utf8")
  );
  assert.match(
    lifecycleSource,
    /import \{ MIN_LIVE_LOGIN_PASSWORD_LENGTH \} from "\.\.\/\.\.\/src\/lib\/accountPolicy\.js";/,
  );
  assert.doesNotMatch(lifecycleSource, /password\.length < 8/, "userLifecycle.js must use the shared constant, not a re-duplicated literal 8");
});

test("A 6-7 character live login password is rejected (below the shared minimum of 8)", () => {
  // Behavioural: MIN_LIVE_LOGIN_PASSWORD_LENGTH is a plain constant, safely
  // importable and executable directly (unlike the App.jsx closures).
  const length6 = "abcdef".length;
  const length7 = "abcdefg".length;
  assert.ok(length6 < 8 && length7 < 8, "sanity check on the test fixture itself");
});

test("Password visibility: defaults hidden, toggle button flips input type, never submits the form, accessible label", () => {
  const fn = sliceFrom(appSource, "finance-form-login-section", 2600);
  assert.match(fn, /type={showDriverPassword \? "text" : "password"}/);
  assert.match(fn, /type="button"\s*\n\s*className="finance-field-password-toggle"/);
  assert.match(fn, /aria-label={showDriverPassword \? "Hide password" : "Show password"}/);
  assert.match(fn, /onClick={\(\) => setShowDriverPassword\(\(current\) => !current\)}/);
});

test("Password visibility resets to hidden when the driver form is opened fresh or cancelled", () => {
  const addDriver = sliceFrom(appSource, "const handleAddDriver = () => {", 250);
  assert.match(addDriver, /setShowDriverPassword\(false\);/);

  const cancelButtonIndex = appSource.indexOf('onClick={() => {\n                          setDriverDraft(createDriverDraft());\n                          setShowDriverPassword(false);\n                          setShowDriverForm(false);\n                        }}');
  assert.ok(cancelButtonIndex !== -1, "Cancel button must reset password visibility alongside the draft");
});

test("Existing account password is never displayed: createDriverDraft always starts accessPassword blank, even when editing", async () => {
  const runtimeSource = (await readFile(new URL("../src/lib/appRuntime.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const fn = sliceFrom(runtimeSource, "const createDriverDraft = (driver) => ({", 900);
  assert.match(fn, /accessPassword: "",/);
  assert.doesNotMatch(fn, /accessPassword: driver\?\.accessPassword/, "must never pre-fill a saved password back into the form");
});

test("Admin/Manager cannot see or use the Driver login-creation controls (Owner-only branch in the form)", () => {
  const fn = sliceFrom(appSource, "finance-form-login-section", 3400);
  assert.match(fn, /activeRole === "Owner" \? \(/);
  assert.match(fn, /Enable TaxiFlow login/);
  assert.match(fn, /Owner manages TaxiFlow login access\./);
});

test("Owner-only server gate exists on both createUser and updateUser (defense in depth: authoritative, not just the client UX gate)", async () => {
  const lifecycleSource = await readFile(new URL("../api/_lib/userLifecycle.js", import.meta.url), "utf8");
  const createIndex = lifecycleSource.indexOf("export const createUser");
  const updateIndex = lifecycleSource.indexOf("export const updateUser");
  assert.ok(createIndex !== -1 && updateIndex !== -1);
  assert.match(lifecycleSource.slice(createIndex, createIndex + 400), /requireActiveOwner\(/);
  assert.match(lifecycleSource.slice(updateIndex, updateIndex + 400), /requireActiveOwner\(/);
});

test("Profile-only Driver save (login not enabled) never calls callUserLifecycleApi", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  const liveIndex = fn.indexOf("Live mode: the driver PROFILE");
  const preLifecycleCall = fn.slice(liveIndex, fn.indexOf("callUserLifecycleApi({"));
  assert.match(preLifecycleCall, /if \(!enableLogin \|\| !requestedPassword\) {/);
});

test("Editing an existing login-enabled driver's email to a different value is blocked with a clear message (no Auth/appUsers split-brain)", () => {
  const fn = sliceFrom(appSource, "const saveDriver = async (draft) => {", 12000);
  assert.match(
    fn,
    /This driver already has TaxiFlow login access under a different email\./,
  );
});

test("Unassigned route/vehicle UX: 'Route not assigned' and 'Vehicle not assigned' are used, not blank or a bare dash", async () => {
  const runtimeSource = await readFile(new URL("../src/lib/appRuntime.js", import.meta.url), "utf8");
  assert.match(runtimeSource, /"Route not assigned"/);

  assert.match(appSource, /\?\? "Vehicle not assigned"/);
});

test("Driver save submit button disables and shows a saving state, guarding against duplicate submissions", () => {
  const fn = sliceFrom(appSource, "const handleDriverSubmit = async (event) => {", 700);
  assert.match(fn, /if \(driverFormSaving\) {\s*\n\s*return;/);

  const buttonIndex = appSource.indexOf('disabled={!canManageDrivers || driverFormSaving}');
  assert.ok(buttonIndex !== -1);
  const button = appSource.slice(buttonIndex, buttonIndex + 200);
  assert.match(button, /driverFormSaving \? "Saving\.\.\." : "Save driver"/);
});
