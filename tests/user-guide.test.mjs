import assert from "node:assert/strict";
import test from "node:test";

import { buildUserGuide, getUserGuideStorageKey } from "../src/lib/userGuide.js";

const ids = (guide) => guide.steps.map((step) => step.id);
const MANAGEMENT_VIEWS = ["overview", "finance", "fleet", "drivers", "reports", "settings"];

test("storage key needs both a user and a workspace", () => {
  assert.equal(getUserGuideStorageKey({ userKey: "u1", workspaceKey: "b1" }), "taxiflow-user-guide-v1:u1:b1");
  assert.equal(getUserGuideStorageKey({ userKey: "u1", workspaceKey: null }), null);
  assert.equal(getUserGuideStorageKey({ userKey: null, workspaceKey: "b1" }), null);
});

test("steps only point at screens the account can open", () => {
  for (const role of ["Owner", "Admin", "Manager", "Driver", "Viewer"]) {
    const views = ["overview", "fleet"];
    const guide = buildUserGuide({ role, views });
    for (const step of guide.steps) {
      assert.ok(views.includes(step.view), `${role}: ${step.id} -> ${step.view}`);
    }
  }
});

test("driver guide: vehicle, trips, costs, checking, defects; first step is the vehicle", () => {
  const guide = buildUserGuide({ role: "Driver", views: ["overview", "fleet", "drivers"], linkedVehicleCount: 1 });
  assert.deepEqual(ids(guide), ["driver-vehicle", "driver-trips", "driver-expenses", "driver-cashup", "driver-defects"]);
  assert.equal(guide.firstStep.id, "driver-vehicle");
  assert.ok(!guide.warnings.some((item) => item.id === "driver-no-vehicle"));
});

test("driver without a linked vehicle is told what happened, why and what to do", () => {
  const guide = buildUserGuide({ role: "Driver", views: ["drivers"], linkedVehicleCount: 0 });
  const item = guide.warnings.find((entry) => entry.id === "driver-no-vehicle");
  assert.ok(item?.what && item.why && item.todo);
});

test("one navigation button per screen", () => {
  const guide = buildUserGuide({ role: "Owner", views: MANAGEMENT_VIEWS, cash: { count: true, verify: true, bank: true } });
  const labelled = guide.steps.filter((step) => step.actionLabel).map((step) => step.view);
  assert.deepEqual(labelled, [...new Set(labelled)]);
  assert.equal(guide.firstStep.id, "mgmt-capture");
});

test("cash part follows the cash steps the account holds", () => {
  const counter = buildUserGuide({ role: "Admin", views: MANAGEMENT_VIEWS, cash: { count: true } });
  assert.match(counter.steps.find((step) => step.id === "mgmt-review").body, /Your part: record the cash a driver hands in \(count\)\.$/);
  const none = buildUserGuide({ role: "Manager", views: MANAGEMENT_VIEWS, cash: {} });
  assert.match(none.steps.find((step) => step.id === "mgmt-review").body, /has not given you a cash step/);
});

test("business workspace: counters are warned about the second-person rule; owner-driver gets own-driving step", () => {
  const guide = buildUserGuide({
    role: "Owner",
    views: MANAGEMENT_VIEWS,
    cash: { count: true, verify: true, bank: true },
    tenant: { live: true, ownerDriver: true },
  });
  assert.ok(guide.warnings.some((item) => item.id === "mgmt-second-person"));
  assert.ok(ids(guide).includes("mgmt-own-driving"));
  const local = buildUserGuide({ role: "Owner", views: MANAGEMENT_VIEWS, cash: { count: true } });
  assert.ok(!local.warnings.some((item) => item.id === "mgmt-second-person"));
});

test("management without Money gets the switched-off warning and no Money steps", () => {
  const guide = buildUserGuide({ role: "Manager", views: ["overview", "fleet", "drivers", "settings"] });
  assert.ok(guide.warnings.some((item) => item.id === "mgmt-money-off"));
  assert.ok(!guide.steps.some((step) => step.view === "finance"));
});

test("fleet and driver edit rights change the wording, not the visibility", () => {
  const guide = buildUserGuide({
    role: "Manager",
    views: MANAGEMENT_VIEWS,
    tenant: { live: true, fleetManage: false, driversManage: false },
  });
  assert.match(guide.steps.find((step) => step.id === "mgmt-fleet").body, /Owner decides/);
  assert.match(guide.steps.find((step) => step.id === "mgmt-drivers").body, /Owner decides/);
});
