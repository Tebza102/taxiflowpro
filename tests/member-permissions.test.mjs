import assert from "node:assert/strict";
import test from "node:test";

import { FINANCE_ACTIONS, applyFinanceAction, parseFinanceActionRequest } from "../api/_lib/financeActions.js";
import { buildRequester } from "../api/_lib/tenantAuth.js";
import { PERMISSION_KEYS, defaultPermissionsForRole, effectivePermissions, hasPermission } from "../src/lib/memberPermissions.js";
import { buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Owner-assigned responsibilities (release 06): the pure policy, the action
// table, and the route / vehicle / driver-profile saves. The behavioural proof
// against the local database is scripts/localdb/member-permissions-tests.mjs.

const RID = "22222222-2222-4222-8222-222222222222";
const VERSION = "2026-10-01T16:30:00Z";
const request = (action, fields) => parseFinanceActionRequest({ action, requestId: RID, expectedVersion: VERSION, fields });
const NOW = "2026-10-19T10:00:00.000Z";
const staff = (role, permissions, moduleAccess = { finance: true, fleet: true, drivers: true }) => ({
  id: `u-${role.toLowerCase()}`,
  role,
  moduleAccess,
  permissions: effectivePermissions({ role, permissions, moduleAccess }),
});
const owner = { id: "u-owner", role: "Owner", moduleAccess: {}, permissions: [...PERMISSION_KEYS] };
const driver = { id: "u-driver", role: "Driver", driverStaffId: "uat-drv-01", permissions: [] };
const forbidden = (fn, pattern) => assert.throws(fn, (error) => error.statusCode === 403 && (!pattern || pattern.test(error.message)));

test("role defaults equal the pre-06 fixed rules; Owner holds all; Driver none", () => {
  assert.deepEqual(defaultPermissionsForRole("Admin"), ["cash.count"]);
  assert.deepEqual(defaultPermissionsForRole("Manager"), ["cash.verify", "cash.bank"]);
  assert.deepEqual(effectivePermissions({ role: "Owner" }), [...PERMISSION_KEYS]);
  assert.deepEqual(effectivePermissions({ role: "Driver", permissions: ["cash.bank"], moduleAccess: { finance: true } }), []);
  // A database without file 06 (null) means the role defaults.
  assert.deepEqual(effectivePermissions({ role: "Manager", permissions: null, moduleAccess: { finance: true } }), ["cash.verify", "cash.bank"]);
  // Unknown stored values are dropped.
  assert.deepEqual(effectivePermissions({ role: "Admin", permissions: ["platform.admin", "cash.count"], moduleAccess: { finance: true } }), ["cash.count"]);
});

test("a switched-off module removes its responsibilities (never bypassed)", () => {
  const all = [...PERMISSION_KEYS];
  assert.deepEqual(effectivePermissions({ role: "Manager", permissions: all, moduleAccess: { finance: false, fleet: true, drivers: true } }), ["drivers.manage", "fleet.manage"]);
  assert.deepEqual(effectivePermissions({ role: "Manager", permissions: all, moduleAccess: { finance: true, fleet: false, drivers: false } }), ["cash.bank", "cash.count", "cash.verify"]);
  assert.equal(hasPermission({ role: "Admin", permissions: [] }, "cash.count"), false);
  assert.equal(hasPermission({ role: "Owner" }, "cash.bank"), true);
});

test("buildRequester takes responsibilities from the membership and caps them by the snapshot toggles", () => {
  const snapshot = { appUsers: [{ email: "m@example.test", moduleAccess: { finance: false, fleet: true, drivers: true } }] };
  const authorization = { userId: "u1", email: "m@example.test", role: "Manager", businessId: "b", driverStaffId: null, permissions: ["cash.bank", "fleet.manage"] };
  assert.deepEqual(buildRequester(authorization, snapshot).permissions, ["fleet.manage"]);
  // Browser-editable appUsers cannot add a responsibility: only the membership value counts.
  const forged = { appUsers: [{ email: "m@example.test", permissions: [...PERMISSION_KEYS], role: "Owner" }] };
  assert.deepEqual(buildRequester({ ...authorization, permissions: [] }, forged).permissions, []);
  assert.equal(buildRequester({ ...authorization, permissions: [] }, forged).role, "Manager");
});

test("every responsibility gates its actions: allowed with it, refused without it", () => {
  const matrix = {
    "cash.count": ["cashup.record_handin", "income.count"],
    "cash.verify": ["cashup.verify", "income.verify"],
    "cash.bank": ["deposit.lock"],
    "fleet.manage": ["route.save", "vehicle.save"],
    "drivers.manage": ["driver.save"],
  };
  for (const [permission, actions] of Object.entries(matrix)) {
    for (const action of actions) {
      assert.equal(FINANCE_ACTIONS[action].permission, permission, `${action} -> ${permission}`);
      assert.deepEqual(FINANCE_ACTIONS[action].roles, ["Owner", "Admin", "Manager"], `${action} roles`);
    }
  }
  const stored = buildSyntheticSnapshot();
  const route = request("route.save", { name: "Rank to Mall", primaryOrigin: "Rank", primaryDestination: "Mall" });
  const vehicle = request("vehicle.save", { registration: "NEW 123 GP", model: "Quantum", routeId: "uat-route-a" });
  const profile = request("driver.save", { name: "New Driver" });
  for (const role of ["Admin", "Manager"]) {
    forbidden(() => applyFinanceAction(stored, route, staff(role, [])), /Manage routes and vehicles/);
    forbidden(() => applyFinanceAction(stored, vehicle, staff(role, ["drivers.manage"])), /Manage routes and vehicles/);
    forbidden(() => applyFinanceAction(stored, profile, staff(role, ["fleet.manage"])), /Manage driver profiles/);
    assert.equal(applyFinanceAction(stored, route, staff(role, ["fleet.manage"]), NOW).response.created, true);
    assert.equal(applyFinanceAction(stored, vehicle, staff(role, ["fleet.manage"]), NOW).response.created, true);
    assert.equal(applyFinanceAction(stored, profile, staff(role, ["drivers.manage"]), NOW).response.created, true);
    // Granted but module switched off -> refused.
    forbidden(() => applyFinanceAction(stored, route, staff(role, ["fleet.manage"], { fleet: false, drivers: true, finance: true })));
    forbidden(() => applyFinanceAction(stored, profile, staff(role, ["drivers.manage"], { drivers: false, fleet: true, finance: true })));
  }
  for (const action of [route, vehicle, profile]) forbidden(() => applyFinanceAction(stored, action, driver), /Your role cannot/);
  for (const action of [route, vehicle, profile]) assert.ok(applyFinanceAction(stored, action, owner, NOW).snapshot);
});

test("an Admin restricted to counting cannot verify or bank; a Manager without banking cannot bank", () => {
  const stored = buildSyntheticSnapshot();
  const countOnly = staff("Admin", ["cash.count"]);
  forbidden(() => applyFinanceAction(stored, request("cashup.verify", { cashUpId: "x" }), countOnly), /Verify counted cash/);
  forbidden(() => applyFinanceAction(stored, request("deposit.lock", { cashUpIds: [], transactionIds: [] }), countOnly), /Bank verified cash/);
  const noBank = staff("Manager", ["cash.verify", "fleet.manage", "drivers.manage"]);
  forbidden(() => applyFinanceAction(stored, request("deposit.lock", { cashUpIds: [], transactionIds: [] }), noBank), /Bank verified cash/);
});

test("route.save: unique names and codes, foreign ids refused, renames blocked by money records", () => {
  const stored = buildSyntheticSnapshot();
  const manager = staff("Manager", ["fleet.manage"]);
  const apply = (fields) => applyFinanceAction(stored, request("route.save", fields), manager, NOW);
  const created = apply({ name: "Rank to Mall", code: "RM1", primaryOrigin: "Rank", primaryDestination: "Mall" });
  const route = created.snapshot.routes.find((entry) => entry.id === created.targetId);
  assert.equal(route.code, "RM1");
  assert.equal(route.createdBy, manager.id);
  assert.equal(route.createdByRole, "Manager");
  assert.equal(created.snapshot.auditTrail[0].entityId, route.id);
  assert.deepEqual(created.snapshot.financeTransactions, stored.financeTransactions);
  assert.throws(() => apply({ name: "uat route a", primaryOrigin: "A", primaryDestination: "B" }), (e) => e.statusCode === 409);
  assert.throws(() => apply({ name: "Other", code: "UA", primaryOrigin: "A", primaryDestination: "B" }), (e) => e.statusCode === 409);
  assert.throws(() => apply({ routeId: "route-of-another-company", name: "X", primaryOrigin: "A", primaryDestination: "B" }), (e) => e.statusCode === 404);
  assert.throws(() => apply({ routeId: "uat-route-a", name: "Renamed", primaryOrigin: "A", primaryDestination: "B" }), /referenced by money records/);
  // Same name, new stops: allowed; route points and history kept.
  const edited = apply({ routeId: "uat-route-a", name: "UAT Route A", code: "UA", primaryOrigin: "Rank", primaryDestination: "Mall" });
  assert.equal(edited.snapshot.routes.find((entry) => entry.id === "uat-route-a").primaryOrigin, "Rank");
  assert.throws(() => request("route.save", { name: "X", primaryOrigin: "A", primaryDestination: "B", businessId: "other" }), /Unsupported fields/);
});

test("vehicle.save: same-business route/driver only, registration and odometer integrity, assignment needs drivers.manage", () => {
  const stored = buildSyntheticSnapshot();
  const fleetOnly = staff("Manager", ["fleet.manage"]);
  const both = staff("Manager", ["fleet.manage", "drivers.manage"]);
  const apply = (fields, who = fleetOnly) => applyFinanceAction(stored, request("vehicle.save", { model: "Quantum", routeId: "uat-route-a", ...fields }), who, NOW);
  assert.throws(() => apply({ registration: "AB 1", routeId: "route-other-company" }), (e) => e.statusCode === 404);
  assert.throws(() => apply({ registration: "AB 1", assignedDriverId: "drv-other-company" }, both), (e) => e.statusCode === 404);
  assert.throws(() => apply({ vehicleId: "veh-other-company", registration: "AB 1" }), (e) => e.statusCode === 404);
  assert.throws(() => apply({ registration: "uat test 01" }), /already belongs/);
  // Editing keeps the stored registration text (money records match it exactly).
  const same = apply({ vehicleId: "uat-veh-01", registration: "UAT TEST 01", currentOdometer: 1500 });
  assert.equal(same.snapshot.vehicles.find((v) => v.id === "uat-veh-01").registration, "UAT-TEST-01");
  assert.equal(same.snapshot.vehicles.find((v) => v.id === "uat-veh-01").assignedDriverId, "uat-drv-01");
  assert.throws(() => apply({ vehicleId: "uat-veh-01", registration: "NEW 1" }), /money records/);
  assert.throws(() => apply({ vehicleId: "uat-veh-01", registration: "UAT-TEST-01", currentOdometer: 999 }), /cannot go back/);
  // Assignment change without drivers.manage is refused; with it, the driver's old vehicle is released.
  forbidden(() => apply({ vehicleId: "uat-veh-02", registration: "UAT-TEST-02", assignedDriverId: "uat-drv-01" }), /Manage driver profiles/);
  const moved = apply({ vehicleId: "uat-veh-02", registration: "UAT-TEST-02", assignedDriverId: "uat-drv-01" }, both);
  assert.equal(moved.snapshot.vehicles.find((v) => v.id === "uat-veh-02").assignedDriverId, "uat-drv-01");
  assert.equal(moved.snapshot.vehicles.find((v) => v.id === "uat-veh-01").assignedDriverId, null);
  assert.equal(moved.snapshot.vehicles.find((v) => v.id === "uat-veh-02").status, "active");
});

test("driver.save: a profile only - no email, password or sign-in fields; routes from this business only", () => {
  const stored = buildSyntheticSnapshot();
  const delegate = staff("Manager", ["drivers.manage"]);
  for (const field of ["email", "enableLogin", "accessPassword", "role", "moduleAccess", "permissions"]) {
    assert.throws(() => request("driver.save", { name: "X", [field]: field === "enableLogin" ? true : "x" }), /Unsupported fields/, field);
  }
  assert.throws(() => applyFinanceAction(stored, request("driver.save", { name: "X", routeIds: ["route-other-company"] }), delegate, NOW), (e) => e.statusCode === 404);
  assert.throws(() => applyFinanceAction(stored, request("driver.save", { staffId: "drv-other-company", name: "X" }), delegate, NOW), (e) => e.statusCode === 404);
  const saved = applyFinanceAction(stored, request("driver.save", { staffId: "uat-drv-01", name: "UAT Driver", routeIds: ["uat-route-a"], prdpExpiryDate: "2027-01-31" }), delegate, NOW);
  const profile = saved.snapshot.drivers.find((entry) => entry.staffId === "uat-drv-01");
  assert.equal(profile.prdpExpiryDate, "2027-01-31");
  assert.deepEqual(profile.routeIds, ["uat-route-a"]);
  assert.equal(profile.email, stored.drivers[0].email ?? null);
  assert.deepEqual(saved.snapshot.appUsers, stored.appUsers);
  assert.equal("accessPassword" in profile, false);
});
