import assert from "node:assert/strict";
import test from "node:test";

import { assertReportAccess, REPORT_ALLOWED_ROLES } from "../api/_lib/reportAccess.js";
import { resolveRequester } from "../api/_lib/snapshotLoader.js";
import { normalizeModuleViewAccess } from "../src/lib/moduleAccessPolicy.js";

const liveDirectory = {
  appUsers: [
    { email: "owner@fleet.co.za", role: "Owner", active: true, moduleAccess: { finance: false } },
    { email: "Driver.One@fleet.co.za", role: "Driver", active: true },
    { email: "former.manager@fleet.co.za", role: "Manager", active: false },
    { email: "manager.money@fleet.co.za", role: "Manager", active: true, moduleAccess: { finance: true } },
    { email: "manager.nomoney@fleet.co.za", role: "Manager", active: true, moduleAccess: { finance: false } },
    { email: "admin.nomoney@fleet.co.za", role: "Admin", active: true, moduleAccess: { finance: false } },
    { email: "admin.default@fleet.co.za", role: "Admin", active: true },
  ],
};

const requesterFor = (role, moduleAccess = {}) => ({
  id: `u-${role}`,
  role,
  moduleAccess: normalizeModuleViewAccess(moduleAccess, role),
});

test("an Admin or Manager whose Money access is off is denied reports", () => {
  for (const email of ["manager.nomoney@fleet.co.za", "admin.nomoney@fleet.co.za"]) {
    const requester = resolveRequester({ id: email, email }, liveDirectory);

    assert.equal(requester.moduleAccess.finance, false);
    assert.equal(requester.moduleAccess.reports, false);
    assert.throws(
      () => assertReportAccess({ source: "live", requestedBy: requester }),
      (e) => e.statusCode === 403 && /Money access/.test(e.message),
    );
  }
});

test("an Admin or Manager with Money on, explicitly or by default, is permitted", () => {
  for (const email of ["manager.money@fleet.co.za", "admin.default@fleet.co.za"]) {
    const requester = resolveRequester({ id: email, email }, liveDirectory);

    assert.equal(requester.moduleAccess.reports, true);
    assert.doesNotThrow(() => assertReportAccess({ source: "live", requestedBy: requester }));
  }
});

test("the Owner follows the Owner policy: never restricted, even with a stored Money off", () => {
  const requester = resolveRequester({ id: "u-o", email: "owner@fleet.co.za" }, liveDirectory);

  assert.equal(requester.moduleAccess.finance, true);
  assert.doesNotThrow(() => assertReportAccess({ source: "live", requestedBy: requester }));
});

test("a requester without resolved module access is denied, even with an allowed role", () => {
  assert.throws(
    () => assertReportAccess({ source: "live", requestedBy: { id: "u1", role: "Manager" } }),
    (e) => e.statusCode === 403,
  );
});

test("role comes from the active directory entry, not from editable token metadata", () => {
  const forged = {
    id: "u-driver",
    email: "driver.one@fleet.co.za",
    user_metadata: { role: "Owner" },
    app_metadata: { role: "Owner" },
  };

  const requester = resolveRequester(forged, liveDirectory);

  assert.equal(requester.role, "Driver");
  assert.throws(() => assertReportAccess({ source: "live", requestedBy: requester }), (e) => e.statusCode === 403);
});

test("an authenticated user with no directory entry, or an inactive one, has no role", () => {
  const outsider = resolveRequester({ id: "u-x", email: "someone@else.com", user_metadata: { role: "Owner" } }, liveDirectory);
  const inactive = resolveRequester({ id: "u-m", email: "former.manager@fleet.co.za" }, liveDirectory);

  for (const requester of [outsider, inactive]) {
    assert.equal(requester.role, null);
    assert.equal(requester.activeMember, false);
    assert.throws(() => assertReportAccess({ source: "live", requestedBy: requester }), (e) => e.statusCode === 403);
  }
});

test("an active Owner in the directory is permitted", () => {
  const requester = resolveRequester({ id: "u-o", email: "OWNER@fleet.co.za" }, liveDirectory);

  assert.equal(requester.role, "Owner");
  assert.doesNotThrow(() => assertReportAccess({ source: "live", requestedBy: requester }));
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
