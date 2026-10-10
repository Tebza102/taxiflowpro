import assert from "node:assert/strict";
import test from "node:test";

import { assertReportAccess, REPORT_ALLOWED_ROLES } from "../api/_lib/reportAccess.js";
import { buildRequester, selectMembership } from "../api/_lib/tenantAuth.js";
import { normalizeModuleViewAccess } from "../src/lib/moduleAccessPolicy.js";

// Roles and memberships come only from business_memberships (the authorization
// passed to buildRequester). snapshot.appUsers may only NARROW module access.
const BUSINESS = "10000000-0000-4000-8000-00000000000a";
const OTHER = "10000000-0000-4000-8000-00000000000b";
const storedSnapshot = {
  appUsers: [
    { email: "owner@fleet.co.za", role: "Owner", active: true, moduleAccess: { finance: false } },
    { email: "driver.one@fleet.co.za", role: "Owner", active: true },
    { email: "manager.money@fleet.co.za", role: "Manager", active: true, moduleAccess: { finance: true } },
    { email: "manager.nomoney@fleet.co.za", role: "Manager", active: true, moduleAccess: { finance: false } },
    { email: "admin.nomoney@fleet.co.za", role: "Admin", active: true, moduleAccess: { finance: false } },
  ],
};
const authorization = (email, role, extra = {}) => ({ userId: `u-${email}`, email, role, businessId: BUSINESS, driverStaffId: null, ...extra });

const requesterFor = (role, moduleAccess = {}) => ({
  id: `u-${role}`,
  role,
  moduleAccess: normalizeModuleViewAccess(moduleAccess, role),
});

test("an Admin or Manager whose Money access is off is denied reports", () => {
  for (const [email, role] of [["manager.nomoney@fleet.co.za", "Manager"], ["admin.nomoney@fleet.co.za", "Admin"]]) {
    const requester = buildRequester(authorization(email, role), storedSnapshot);
    assert.equal(requester.moduleAccess.reports, false);
    assert.throws(() => assertReportAccess({ source: "live", requestedBy: requester }), (e) => e.statusCode === 403 && /Money access/.test(e.message));
  }
});

test("an Admin or Manager with Money on, explicitly or by default, is permitted", () => {
  for (const [email, role] of [["manager.money@fleet.co.za", "Manager"], ["admin.default@fleet.co.za", "Admin"]]) {
    const requester = buildRequester(authorization(email, role), storedSnapshot);
    assert.equal(requester.moduleAccess.reports, true);
    assert.doesNotThrow(() => assertReportAccess({ source: "live", requestedBy: requester }));
  }
});

test("the Owner follows the Owner policy: never restricted, even with a stored Money off", () => {
  const requester = buildRequester(authorization("owner@fleet.co.za", "Owner"), storedSnapshot);
  assert.equal(requester.moduleAccess.finance, true);
  assert.doesNotThrow(() => assertReportAccess({ source: "live", requestedBy: requester }));
});

test("a requester without resolved module access is denied, even with an allowed role", () => {
  assert.throws(() => assertReportAccess({ source: "live", requestedBy: { id: "u1", role: "Manager" } }), (e) => e.statusCode === 403);
});

test("role comes from the membership, never from snapshot.appUsers or token metadata", () => {
  // appUsers claims Owner for this account; the membership says Driver.
  const requester = buildRequester(authorization("driver.one@fleet.co.za", "Driver", { driverStaffId: "drv-1" }), storedSnapshot);
  assert.equal(requester.role, "Driver");
  assert.equal(requester.driverStaffId, "drv-1");
  assert.throws(() => assertReportAccess({ source: "live", requestedBy: requester }), (e) => e.statusCode === 403);
});

test("appUsers module toggles can only narrow a role, never widen it", () => {
  const widened = buildRequester(authorization("x@fleet.co.za", "Driver"), { appUsers: [{ email: "x@fleet.co.za", moduleAccess: { finance: true, reports: true } }] });
  assert.equal(widened.moduleAccess.finance, false);
  assert.equal(widened.moduleAccess.reports, false);
});

test("membership selection: explicit business must match an active membership; no fallback", () => {
  const memberships = [
    { business_id: BUSINESS, role: "Manager", active: true },
    { business_id: OTHER, role: "Driver", driver_staff_id: "d", active: true },
  ];
  assert.equal(selectMembership(memberships, OTHER).role, "Driver");
  assert.throws(() => selectMembership(memberships, null), (e) => e.statusCode === 400 && /select one/.test(e.message));
  assert.throws(() => selectMembership(memberships, "10000000-0000-4000-8000-0000000000ff"), (e) => e.statusCode === 403);
  assert.equal(selectMembership([memberships[0]], null).business_id, BUSINESS);
  assert.throws(() => selectMembership([], null), (e) => e.statusCode === 403);
  assert.throws(() => selectMembership([{ business_id: BUSINESS, role: "Manager", active: false }], BUSINESS), (e) => e.statusCode === 403);
  assert.throws(() => selectMembership([{ business_id: BUSINESS, role: "Viewer", active: true }], BUSINESS), (e) => e.statusCode === 403);
});

const withNodeEnv = (value, fn) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  }
};

test("assertReportAccess rejects an unauthenticated live request", () => {
  assert.throws(
    () => assertReportAccess({ source: "live", requestedBy: null }),
    (error) => error.statusCode === 401,
  );
});

test("assertReportAccess rejects Driver and Viewer roles", () => {
  for (const role of ["Driver", "Viewer"]) {
    assert.throws(
      () => assertReportAccess({ source: "live", requestedBy: requesterFor(role, { finance: true }) }),
      (error) => error.statusCode === 403,
      `expected role ${role} to be rejected`,
    );
  }
});

test("assertReportAccess permits Owner, Admin, and Manager roles with Money on", () => {
  for (const role of REPORT_ALLOWED_ROLES) {
    assert.doesNotThrow(() => assertReportAccess({ source: "live", requestedBy: requesterFor(role) }));
  }
});

test("assertReportAccess permits an unauthenticated mock request outside production", () => {
  withNodeEnv("development", () => {
    assert.doesNotThrow(() => assertReportAccess({ source: "mock", requestedBy: null }));
  });
});

test("assertReportAccess rejects an unauthenticated mock request in production", () => {
  withNodeEnv("production", () => {
    assert.throws(
      () => assertReportAccess({ source: "mock", requestedBy: null }),
      (error) => error.statusCode === 401,
    );
  });
});

test("assertReportAccess still enforces role even when the source is mock", () => {
  assert.throws(
    () => assertReportAccess({ source: "mock", requestedBy: requesterFor("Driver") }),
    (error) => error.statusCode === 403,
  );
});
