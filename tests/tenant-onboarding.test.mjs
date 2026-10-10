import assert from "node:assert/strict";
import test from "node:test";

import { buildInitialSnapshot, withDirectoryEntry } from "../api/_lib/tenantOnboarding.js";

test("initial snapshot: the Owner is the only directory entry; owner-driver adds one linked profile", () => {
  const plain = buildInitialSnapshot({ name: "Pilot", owner: { email: "o@example.com", name: "O" } });
  assert.equal(plain.appUsers.length, 1);
  assert.equal(plain.appUsers[0].role, "Owner");
  assert.equal(plain.appUsers[0].staffId, null);
  assert.deepEqual(plain.drivers, []);
  for (const key of ["vehicles", "routes", "financeTransactions", "dailyCashUps", "deposits"]) assert.deepEqual(plain[key], []);

  const drives = buildInitialSnapshot({ name: "Pilot", owner: { email: "o@example.com", name: "O" }, ownerDriver: { staffId: "drv-x", name: "O" } });
  assert.equal(drives.appUsers[0].staffId, "drv-x");
  assert.deepEqual(drives.drivers.map((d) => d.staffId), ["drv-x"]);
});

test("directory entry: one entry per email, updated in place, module toggles capped by role", () => {
  let snapshot = { appUsers: [{ email: "A@Example.com", name: "Ann", role: "Manager", moduleAccess: { finance: false } }] };
  snapshot = withDirectoryEntry(snapshot, { email: "a@example.com", role: "Admin", staffId: null, active: true });
  assert.equal(snapshot.appUsers.length, 1);
  assert.equal(snapshot.appUsers[0].role, "Admin");
  assert.equal(snapshot.appUsers[0].name, "Ann");
  assert.equal(snapshot.appUsers[0].moduleAccess.finance, false, "an explicit Owner toggle is kept");
  snapshot = withDirectoryEntry(snapshot, { email: "d@example.com", role: "Driver", staffId: "drv-1", active: true, moduleAccess: { settings: true } });
  assert.equal(snapshot.appUsers.length, 2);
  assert.equal(snapshot.appUsers[1].moduleAccess.settings, false, "a Driver can never be given Settings");
  snapshot = withDirectoryEntry(snapshot, { email: "d@example.com", role: "Driver", staffId: "drv-1", active: false });
  assert.equal(snapshot.appUsers[1].active, false);
});
