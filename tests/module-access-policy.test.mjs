import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultModuleViewAccess,
  normalizeModuleViewAccess,
} from "../src/lib/moduleAccessPolicy.js";

test("an Owner's explicit Money off for an Admin or Manager is honoured", () => {
  for (const role of ["Admin", "Manager"]) {
    const access = normalizeModuleViewAccess(
      { overview: true, finance: false, fleet: true, drivers: true, settings: true },
      role,
    );

    assert.equal(access.finance, false, `${role} finance`);
    assert.equal(access.reports, false, `${role} reports follows finance`);
    assert.equal(access.fleet, true);
  }
});

test("a missing module key falls back to the role default", () => {
  for (const role of ["Admin", "Manager"]) {
    const access = normalizeModuleViewAccess({}, role);

    assert.equal(access.finance, true);
    assert.equal(access.reports, true);
    assert.equal(access.settings, true);
  }
});

test("the stored shapes in the live pilot keep exactly the access they have today", () => {
  const managerShape = { fleet: true, drivers: true, finance: true, overview: true, settings: true };
  const driverShape = { fleet: true, drivers: true, finance: false, overview: true, settings: false };

  assert.deepEqual(normalizeModuleViewAccess(managerShape, "Manager"), {
    overview: true,
    finance: true,
    fleet: true,
    drivers: true,
    reports: true,
    settings: true,
  });
  assert.deepEqual(normalizeModuleViewAccess(driverShape, "Driver"), {
    overview: true,
    finance: false,
    fleet: true,
    drivers: true,
    reports: false,
    settings: false,
  });
});

test("the Owner is never restricted by stored toggles", () => {
  const access = normalizeModuleViewAccess({ finance: false, fleet: false, settings: false }, "Owner");

  assert.ok(Object.values(access).every(Boolean));
});

test("a stored true never grants what the role does not allow", () => {
  const driver = normalizeModuleViewAccess({ finance: true, reports: true, settings: true }, "Driver");

  assert.equal(driver.finance, false);
  assert.equal(driver.reports, false);
  assert.equal(driver.settings, false);
});

test("a stored reports flag is ignored: reports always follows Money", () => {
  assert.equal(normalizeModuleViewAccess({ finance: false, reports: true }, "Manager").reports, false);
  assert.equal(normalizeModuleViewAccess({ finance: true, reports: false }, "Manager").reports, true);
});

test("Viewer keeps the demo-only defaults and never gets reports", () => {
  assert.deepEqual(createDefaultModuleViewAccess("Viewer").reports, false);
  assert.equal(normalizeModuleViewAccess({ finance: true }, "Viewer").reports, false);
});
