import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeScopedChanges,
  projectWorkspace,
  resolveWorkspaceScope,
  WORKSPACE_SCOPES,
} from "../api/_lib/scopedWorkspace.js";
import { mockSnapshot } from "../src/data/mockData.js";
import { normalizeTripFinanceTransactions } from "../src/lib/tripHistory.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const DRIVER = { email: "driver.one@pilot.test", role: "Driver", staffId: "drv-01", actorId: "drv-01", active: true };
const OTHER_DRIVER_ID = "drv-02";
const NO_MONEY_MANAGER = {
  email: "manager@pilot.test",
  role: "Manager",
  staffId: "mgr-01",
  actorId: "mgr-01",
  active: true,
  moduleAccess: { finance: false, fleet: true, drivers: true },
};

const storedWorkspace = () => {
  const snapshot = clone(mockSnapshot);
  snapshot.appUsers = [DRIVER, NO_MONEY_MANAGER, { email: "owner@pilot.test", role: "Owner", active: true }];
  snapshot.profile = { ...(snapshot.profile ?? {}), monthlyTarget: 2480000 };
  snapshot.vehicles = snapshot.vehicles.map((vehicle) => ({
    ...vehicle,
    verifiedRevenue: 99999,
    netYield: 88888,
    assetExpenseTotal: 7777,
    vehicleLedger: [{ id: "leak", amount: 123456 }],
  }));
  snapshot.drivers = snapshot.drivers.map((driver) => ({ ...driver, cashAccuracy: 97, avgShiftRevenue: 4500 }));
  snapshot.finance = { ...snapshot.finance, globalFleetProfit: 555555, expenseCatalog: { asset: [{ name: "Fuel" }] } };
  snapshot.verificationQueue = [{ id: "q-1", claimed: 4830 }];
  snapshot.auditTrail = [
    { id: "a-own", actorId: "drv-01", scope: "finance", detail: "own capture" },
    { id: "a-other", actorId: "drv-02", scope: "finance", detail: "R 5 000 handed in" },
    { id: "a-fleet", actorId: "owner", scope: "fleet", detail: "vehicle archived" },
  ];
  snapshot.dailyCashUps = [
    { id: "cu-own", driverStaffId: "drv-01", workDate: "2026-03-27", status: "pending", actualCashReceived: null },
    { id: "cu-other", driverStaffId: "drv-02", workDate: "2026-03-27", status: "counted", actualCashReceived: 5000 },
  ];
  snapshot.driverTerminal = { ...snapshot.driverTerminal, activeDriverId: "drv-02", dayCashSummary: { total: 5000 } };
  return snapshot;
};

const ownRecords = (snapshot) =>
  snapshot.financeTransactions.filter((record) => (record.driverStaffId ?? (record.createdByRole === "Driver" ? record.createdBy : null)) === "drv-01");

// --- Scope -----------------------------------------------------------------

test("scope matches the database rule: direct access only for Owner and Money-on management", () => {
  assert.equal(resolveWorkspaceScope({ role: "Owner", moduleAccess: { finance: false } }), WORKSPACE_SCOPES.FULL);
  assert.equal(resolveWorkspaceScope({ role: "Admin" }), WORKSPACE_SCOPES.FULL);
  assert.equal(resolveWorkspaceScope({ role: "Manager", moduleAccess: { finance: true } }), WORKSPACE_SCOPES.FULL);
  assert.equal(resolveWorkspaceScope({ role: "Manager", moduleAccess: { finance: false } }), WORKSPACE_SCOPES.NO_FINANCE);
  assert.equal(resolveWorkspaceScope({ role: "admin", moduleAccess: { finance: false } }), WORKSPACE_SCOPES.NO_FINANCE);
  assert.equal(resolveWorkspaceScope(DRIVER), WORKSPACE_SCOPES.DRIVER);
  assert.equal(resolveWorkspaceScope({ role: "Driver" }), null);
  assert.equal(resolveWorkspaceScope({ role: "Viewer" }), null);
  assert.equal(resolveWorkspaceScope({ ...NO_MONEY_MANAGER, active: false }), null);
  assert.equal(resolveWorkspaceScope(null), null);
});

// --- Driver view ------------------------------------------------------------

test("a Driver's view contains no other driver's money and no management finance", () => {
  const stored = storedWorkspace();
  const view = projectWorkspace(stored, DRIVER, WORKSPACE_SCOPES.DRIVER);

  for (const record of view.financeTransactions) {
    if (record.odometerAnchor) {
      for (const field of ["amount", "amountClaimed", "actualCashReceived", "tripLogbook", "notes", "status"]) {
        assert.equal(field in record, false, `anchor must not carry ${field}`);
      }
    } else {
      assert.equal(record.driverStaffId ?? record.createdBy, "drv-01");
    }
  }
  assert.ok(view.financeTransactions.some((record) => !record.odometerAnchor), "own records are included");
  assert.deepEqual(view.deposits, []);
  assert.deepEqual(view.verificationQueue, []);
  assert.deepEqual(Object.keys(view.finance), ["expenseCatalog"]);
  assert.deepEqual(view.dailyCashUps.map((entry) => entry.id), ["cu-own"]);
  assert.deepEqual(view.auditTrail.map((event) => event.id), ["a-own"]);
  assert.deepEqual(view.appUsers.map((user) => user.email), [DRIVER.email]);
  assert.equal(view.profile.monthlyTarget, undefined);
  assert.equal(view.driverTerminal.dayCashSummary, null);
  assert.equal(view.driverTerminal.lastShift, null, "another driver's last shift is not shown");
  for (const vehicle of view.vehicles) {
    assert.equal(vehicle.vehicleLedger, undefined);
    assert.equal(vehicle.verifiedRevenue, undefined);
  }
  for (const driver of view.drivers) {
    assert.equal(driver.cashAccuracy, undefined);
  }
  const serialized = JSON.stringify(view);
  for (const leak of ["555555", "99999", "123456", "R 5 000", "4830"]) {
    assert.equal(serialized.includes(leak), false, `view leaks ${leak}`);
  }
});

test("a Driver's view keeps the other driver's latest odometer reading on a shared vehicle", () => {
  const stored = storedWorkspace();
  stored.financeTransactions.push({
    id: "other-latest",
    type: "income",
    incomeKind: "standard",
    vehicleId: "veh-1",
    vehicle: "JHB 457 GP",
    timestamp: "2030-01-01T18:00:00+02:00",
    tripDate: "2030-01-01",
    openingOdo: 500000,
    closingOdo: 500250,
    amountClaimed: 6100,
    createdBy: OTHER_DRIVER_ID,
    createdByRole: "Driver",
    driverStaffId: OTHER_DRIVER_ID,
  });

  const anchor = projectWorkspace(stored, DRIVER, WORKSPACE_SCOPES.DRIVER).financeTransactions.find(
    (record) => record.id === "other-latest",
  );

  assert.equal(anchor.odometerAnchor, true);
  assert.equal(anchor.closingOdo, 500250);
  assert.equal(anchor.amountClaimed, undefined);
  assert.equal(anchor.driverStaffId, "odometer-anchor");
});

// --- Round trips ------------------------------------------------------------

for (const [label, member, scope] of [
  ["Driver", DRIVER, WORKSPACE_SCOPES.DRIVER],
  ["Money-off manager", NO_MONEY_MANAGER, WORKSPACE_SCOPES.NO_FINANCE],
]) {
  test(`${label}: saving the view unchanged leaves the stored row untouched`, () => {
    const stored = storedWorkspace();
    const before = JSON.stringify(stored);
    const { snapshot, changed } = mergeScopedChanges(stored, member, scope, projectWorkspace(stored, member, scope));

    assert.equal(changed, false);
    assert.equal(JSON.stringify(snapshot), before);
    assert.equal(JSON.stringify(stored), before, "input is not mutated");
  });

  test(`${label}: saving after the browser's own normalisation leaves the stored row untouched`, () => {
    const stored = storedWorkspace();
    stored.financeTransactions = normalizeTripFinanceTransactions(stored.financeTransactions, { source: stored });
    const view = projectWorkspace(stored, member, scope);
    view.financeTransactions = normalizeTripFinanceTransactions(view.financeTransactions, { source: view });

    assert.equal(mergeScopedChanges(stored, member, scope, view).changed, false);
  });
}

// --- Driver saves -----------------------------------------------------------

const driverSave = (stored, mutate) => {
  const view = projectWorkspace(stored, DRIVER, WORKSPACE_SCOPES.DRIVER);
  mutate(view);
  return mergeScopedChanges(stored, DRIVER, WORKSPACE_SCOPES.DRIVER, view).snapshot;
};

test("a Driver's new capture is saved as pending, with discrepancy computed from all records", () => {
  const stored = storedWorkspace();
  stored.financeTransactions.push({
    id: "other-latest",
    type: "income",
    incomeKind: "standard",
    vehicleId: "veh-1",
    timestamp: "2030-01-01T18:00:00+02:00",
    closingOdo: 500250,
    createdBy: OTHER_DRIVER_ID,
    createdByRole: "Driver",
    driverStaffId: OTHER_DRIVER_ID,
  });

  const merged = driverSave(stored, (view) => {
    view.financeTransactions.push({
      id: "new-capture",
      type: "income",
      incomeKind: "standard",
      vehicleId: "veh-1",
      timestamp: "2030-01-02T18:00:00+02:00",
      openingOdo: 500100,
      closingOdo: 500400,
      amountClaimed: 4200,
      actualCashReceived: 4200,
      status: "verified",
      verifiedBy: "drv-01",
      discrepancy: false,
      createdBy: "drv-01",
      createdByRole: "Driver",
      driverStaffId: "drv-01",
    });
  });
  const saved = merged.financeTransactions.find((record) => record.id === "new-capture");

  assert.equal(saved.status, "pending");
  assert.equal(saved.actualCashReceived, null);
  assert.equal(saved.verifiedBy, null);
  assert.equal(saved.amountClaimed, 4200);
  assert.equal(saved.discrepancy, true, "opening 500100 differs from the other driver's closing 500250");
});

test("a Driver cannot change other people's records, advance a status, delete, or touch banked records", () => {
  const stored = storedWorkspace();
  const own = ownRecords(stored);
  const ownPending = own.find((record) => record.status === "pending") ?? own[0];
  ownPending.status = "counted";
  ownPending.actualCashReceived = 4000;
  const ownBanked = { ...clone(ownPending), id: "own-banked", status: "banked", amountClaimed: 100 };
  stored.financeTransactions.push(ownBanked);
  const adminAssigned = {
    id: "admin-assigned",
    type: "income",
    incomeKind: "standard",
    vehicleId: "veh-1",
    amountClaimed: 3000,
    status: "pending",
    createdBy: "adm-01",
    createdByRole: "Admin",
    driverStaffId: "drv-01",
  };
  stored.financeTransactions.push(adminAssigned);
  const otherRecord = stored.financeTransactions.find(
    (record) => (record.driverStaffId ?? record.createdBy) !== "drv-01" && record.createdByRole !== "Admin",
  );

  const merged = driverSave(stored, (view) => {
    const find = (id) => view.financeTransactions.find((record) => record.id === id);
    Object.assign(find(ownPending.id), { status: "verified", actualCashReceived: 9999, notes: "tamper" });
    Object.assign(find("own-banked"), { amountClaimed: 1 });
    Object.assign(find("admin-assigned"), { amountClaimed: 1 });
    view.financeTransactions = view.financeTransactions.filter((record) => record.id !== own[1]?.id);
    view.financeTransactions.push({ ...clone(otherRecord ?? {}), id: otherRecord?.id ?? "x", amountClaimed: 1 });
    view.financeTransactions.push({ id: "forged", type: "income", createdBy: "drv-02", createdByRole: "Driver", driverStaffId: "drv-02" });
    view.deposits = [{ depositId: "fake" }];
    view.finance = { globalFleetProfit: 1 };
    view.appUsers = [{ ...DRIVER, role: "Owner" }];
  });
  const find = (id) => merged.financeTransactions.find((record) => record.id === id);

  assert.equal(find(ownPending.id).status, "counted", "status cannot be advanced");
  assert.equal(find(ownPending.id).actualCashReceived, 4000, "counted cash is kept");
  assert.equal(find(ownPending.id).notes, "tamper", "the driver's own content edit is kept");
  assert.equal(find("own-banked").amountClaimed, 100);
  assert.equal(find("admin-assigned").amountClaimed, 3000);
  if (own[1]) assert.ok(find(own[1].id), "drivers cannot delete");
  if (otherRecord) assert.deepEqual(find(otherRecord.id), otherRecord);
  assert.equal(find("forged"), undefined);
  assert.deepEqual(merged.deposits, stored.deposits);
  assert.deepEqual(merged.finance, stored.finance);
  assert.deepEqual(merged.appUsers, stored.appUsers);
});

test("a Driver editing their own counted record resets it to pending, as the app does", () => {
  const stored = storedWorkspace();
  const target = ownRecords(stored)[0];
  Object.assign(target, { status: "counted", actualCashReceived: 4000, countedBy: "adm-01" });

  const merged = driverSave(stored, (view) => {
    Object.assign(view.financeTransactions.find((record) => record.id === target.id), {
      amountClaimed: 4100,
      status: "pending",
      actualCashReceived: null,
    });
  });
  const saved = merged.financeTransactions.find((record) => record.id === target.id);

  assert.equal(saved.status, "pending");
  assert.equal(saved.amountClaimed, 4100);
  assert.equal(saved.actualCashReceived, null);
  assert.equal(saved.countedBy, null);
});

test("a Driver's day cash-up, defects, audit events and terminal: own additions only", () => {
  const stored = storedWorkspace();

  const merged = driverSave(stored, (view) => {
    view.dailyCashUps.push({ id: "cu-new", driverStaffId: "drv-01", workDate: "2026-03-28", status: "counted", actualCashReceived: 777 });
    view.dailyCashUps.push({ id: "cu-forged", driverStaffId: "drv-02", workDate: "2026-03-28" });
    view.defects.push({ id: "d-own", vehicleId: "veh-1", reportedByStaffId: "drv-01", issue: "Windscreen" });
    view.defects.push({ id: "d-forged", vehicleId: "veh-1", reportedByStaffId: "drv-02" });
    view.auditTrail.push({ id: "a-new", actorId: "drv-01" });
    view.auditTrail.push({ id: "a-forged", actorId: "owner" });
    view.auditTrail = view.auditTrail.filter((event) => event.id !== "a-own");
    view.driverTerminal = { ...view.driverTerminal, activeDriverId: "drv-01", assignedVehicleId: "veh-1" };
  });

  const newCashUp = merged.dailyCashUps.find((entry) => entry.id === "cu-new");
  assert.equal(newCashUp.status, "pending");
  assert.equal(newCashUp.actualCashReceived, null);
  assert.equal(merged.dailyCashUps.find((entry) => entry.id === "cu-forged"), undefined);
  assert.deepEqual(merged.dailyCashUps.find((entry) => entry.id === "cu-other"), stored.dailyCashUps[1]);
  assert.ok(merged.defects.find((defect) => defect.id === "d-own"));
  assert.equal(merged.defects.find((defect) => defect.id === "d-forged"), undefined);
  assert.deepEqual(merged.auditTrail.map((event) => event.id), ["a-own", "a-other", "a-fleet", "a-new"]);
  assert.equal(merged.driverTerminal.activeDriverId, "drv-01");

  const spoofed = driverSave(stored, (view) => {
    view.driverTerminal = { ...view.driverTerminal, activeDriverId: "drv-02", dayCashSummary: { total: 1 } };
  });
  assert.deepEqual(spoofed.driverTerminal, stored.driverTerminal);
});

// --- Money-off management -----------------------------------------------------

const noMoneySave = (stored, mutate) => {
  const view = projectWorkspace(stored, NO_MONEY_MANAGER, WORKSPACE_SCOPES.NO_FINANCE);
  mutate(view);
  return mergeScopedChanges(stored, NO_MONEY_MANAGER, WORKSPACE_SCOPES.NO_FINANCE, view).snapshot;
};

test("a Money-off manager's view has no finance data", () => {
  const view = projectWorkspace(storedWorkspace(), NO_MONEY_MANAGER, WORKSPACE_SCOPES.NO_FINANCE);
  const serialized = JSON.stringify(view);

  assert.deepEqual(view.financeTransactions, []);
  assert.deepEqual(view.dailyCashUps, []);
  assert.deepEqual(view.deposits, []);
  assert.deepEqual(view.verificationQueue, []);
  assert.deepEqual(Object.keys(view.finance), ["expenseCatalog"]);
  assert.deepEqual(view.auditTrail.map((event) => event.id), ["a-fleet"]);
  for (const leak of ["555555", "99999", "123456", "2480000", "R 5 000"]) {
    assert.equal(serialized.includes(leak), false, `view leaks ${leak}`);
  }
});

test("a Money-off manager can run fleet and staff; finance is kept as stored", () => {
  const stored = storedWorkspace();

  const merged = noMoneySave(stored, (view) => {
    view.vehicles[0].status = "In workshop";
    view.vehicles[0].verifiedRevenue = 0;
    view.drivers[0].shiftStatus = "Off";
    view.profile.monthlyTarget = 1;
    view.financeTransactions.push(
      { id: "repair-exp", type: "expense", amount: 850, createdBy: "mgr-01", createdByRole: "Manager", status: "verified" },
      { id: "forged-income", type: "income", amountClaimed: 1, createdBy: "mgr-01" },
      { id: "forged-exp", type: "expense", amount: 1, createdBy: "owner" },
    );
    view.auditTrail = [...view.auditTrail, { id: "a-mgr", actorId: "mgr-01", scope: "fleet" }];
    view.permissionControls = {
      fleet: { requestStatus: "pending", requestedBy: "mgr-01", active: false },
      finance: { requestStatus: "approved", requestedBy: "mgr-01", active: true, grantedAt: "now" },
    };
    view.appUsers = view.appUsers.map((user) => ({ ...user, moduleAccess: { finance: true } }));
  });

  assert.equal(merged.vehicles[0].status, "In workshop");
  assert.equal(merged.vehicles[0].verifiedRevenue, 99999, "finance figures restored");
  assert.equal(merged.drivers[0].shiftStatus, "Off");
  assert.equal(merged.drivers[0].avgShiftRevenue, 4500);
  assert.equal(merged.profile.monthlyTarget, 2480000);
  assert.deepEqual(
    merged.financeTransactions.slice(stored.financeTransactions.length).map((record) => record.id),
    ["repair-exp"],
  );
  assert.deepEqual(merged.financeTransactions.slice(0, stored.financeTransactions.length), stored.financeTransactions);
  assert.deepEqual(merged.dailyCashUps, stored.dailyCashUps);
  assert.deepEqual(merged.verificationQueue, stored.verificationQueue);
  assert.deepEqual(merged.finance, stored.finance);
  assert.deepEqual(merged.auditTrail.map((event) => event.id), ["a-own", "a-other", "a-fleet", "a-mgr"]);
  assert.deepEqual(merged.permissionControls, {
    fleet: { requestStatus: "pending", requestedBy: "mgr-01", active: false },
  });
  assert.deepEqual(merged.appUsers, stored.appUsers);
});
