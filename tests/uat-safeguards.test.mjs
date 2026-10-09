import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  BANKED_STEP_STATUS,
  UatSafetyError,
  assertDisposableVehicleFixture,
  assertSafePreviewTarget,
  classifyAuthUserChanges,
  classifyWorkspaceChanges,
  fingerprintWorkspace,
  verifyDeploymentTarget,
} from "../scripts/uat/lib/safeguards.mjs";
import { runPreviewUat, TEST_TITLE_TO_SCORECARD_KEY } from "../scripts/uat/run-preview-uat.mjs";

// All I/O here is mocked: no network, no Supabase, no browser.

const PREVIEW_HOST = "taxiflowpro-lapropkuh-apprigate.vercel.app";
const COMMIT = "628121b68908a1e1fc820bde932699ef7703a9af";
const PROJECT_ID = "prj_vYaxObYXR8imyMKRr951yLJ0XAh7";
const PROD_DEPLOYMENT_HOST = "taxiflowpro-vq1gbf579-apprigate.vercel.app";
const TOKEN = "test-token-not-real";

const clone = (value) => JSON.parse(JSON.stringify(value));

const baseSnapshot = () => ({
  vehicles: [
    { id: "veh-1", registration: "JHB 457 GP", status: "active", currentOdometer: 384120, assignedDriverId: "drv-01" },
    { id: "veh-uat", registration: "UAT-TEST-01", status: "active", currentOdometer: 1000, assignedDriverId: null },
  ],
  financeTransactions: [{ id: "fin-real", vehicle: "JHB 457 GP", amountClaimed: 500, status: "pending" }],
  dailyCashUps: [{ id: "cu-real", vehicle: "JHB 457 GP", status: "counted" }],
  appUsers: [{ email: "owner@example.com", role: "Owner", active: true }],
  auditTrail: [{ id: "aud-1", title: "Earlier owner action" }],
  emailOutbox: [],
  profile: { name: "Test Fleet" },
});

// --- Target -------------------------------------------------------------------

const target = (overrides = {}) => ({
  previewUrl: `https://${PREVIEW_HOST}`,
  expectedHost: PREVIEW_HOST,
  expectedCommitSha: COMMIT,
  ...overrides,
});

test("target: accepts the exact verified immutable Preview host", () => {
  assert.deepEqual(assertSafePreviewTarget(target()), {
    host: PREVIEW_HOST,
    origin: `https://${PREVIEW_HOST}`,
  });
});

test("target: refuses production hosts, aliases and custom domains", () => {
  for (const host of [
    "taxiflowpro.vercel.app",
    "taxiflowpro-apprigate.vercel.app",
    "taxiflowpro-git-main-apprigate.vercel.app",
    "taxiflow.apprigate.com",
    PROD_DEPLOYMENT_HOST,
  ]) {
    assert.throws(
      () => assertSafePreviewTarget(target({ previewUrl: `https://${host}`, expectedHost: host })),
      UatSafetyError,
      host,
    );
  }
});

test("target: refuses moving branch aliases, extra production hosts and non-immutable hosts", () => {
  const branchAlias = "taxiflowpro-git-agent-owner-first-auth-reset-apprigate.vercel.app";
  assert.throws(() => assertSafePreviewTarget(target({ previewUrl: `https://${branchAlias}`, expectedHost: branchAlias })), /not an immutable/);
  assert.throws(
    () => assertSafePreviewTarget(target({ extraProductionHosts: [PREVIEW_HOST] })),
    /production host/,
  );
  assert.throws(() => assertSafePreviewTarget(target({ previewUrl: "https://example.com", expectedHost: "example.com" })), /not an immutable/);
});

test("target: refuses http, credentials, paths, a host mismatch and a missing/short commit", () => {
  assert.throws(() => assertSafePreviewTarget(target({ previewUrl: `http://${PREVIEW_HOST}` })), /https/);
  assert.throws(() => assertSafePreviewTarget(target({ previewUrl: `https://u:p@${PREVIEW_HOST}` })), /credentials/);
  assert.throws(() => assertSafePreviewTarget(target({ previewUrl: `https://${PREVIEW_HOST}/login` })), /bare deployment origin/);
  assert.throws(
    () => assertSafePreviewTarget(target({ expectedHost: "taxiflowpro-abcdefghi-apprigate.vercel.app" })),
    /does not match/,
  );
  assert.throws(() => assertSafePreviewTarget(target({ expectedHost: "" })), /UAT_EXPECTED_DEPLOYMENT_HOST/);
  assert.throws(() => assertSafePreviewTarget(target({ expectedCommitSha: "628121b" })), /40-character/);
});

// --- Deployment verification ----------------------------------------------------

const vercelFetch = ({ project = {}, deployment = {}, status = 200 } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization });
    const body = url.includes("/v9/projects/")
      ? {
          targets: { production: { id: "dpl_prod", url: PROD_DEPLOYMENT_HOST, alias: ["taxiflowpro.vercel.app"] } },
          ...project,
        }
      : {
          id: "dpl_preview",
          projectId: PROJECT_ID,
          url: PREVIEW_HOST,
          target: null,
          readyState: "READY",
          meta: { githubCommitSha: COMMIT },
          alias: ["taxiflowpro-git-agent-owner-first-auth-reset-apprigate.vercel.app"],
          ...deployment,
        };
    return { ok: status === 200, status, json: async () => body };
  };
  return { fetchImpl, calls };
};

const verify = (fetchImpl, overrides = {}) =>
  verifyDeploymentTarget({ host: PREVIEW_HOST, expectedCommitSha: COMMIT, token: TOKEN, fetchImpl, ...overrides });

test("deployment: accepts a READY preview of this project at the expected commit; token only goes to the Vercel API", async () => {
  const { fetchImpl, calls } = vercelFetch();
  const result = await verify(fetchImpl);
  assert.equal(result.deploymentId, "dpl_preview");
  assert.equal(result.target, "preview");
  assert.ok(calls.length === 2 && calls.every((call) => call.url.startsWith("https://api.vercel.com/")));
});

test("deployment: refuses without a token and makes no request", async () => {
  const { fetchImpl, calls } = vercelFetch();
  await assert.rejects(verify(fetchImpl, { token: "" }), /VERCEL_TOKEN/);
  assert.equal(calls.length, 0);
});

test("deployment: refuses production target, production id/alias, wrong commit, not ready, wrong project, API errors", async () => {
  const cases = [
    [{ deployment: { target: "production" } }, /production-target/],
    [{ deployment: { id: "dpl_prod" } }, /current production deployment/],
    [{ deployment: { alias: ["taxiflow.apprigate.com"] } }, /aliased to production/],
    [{ project: { targets: { production: { id: "dpl_prod", url: PROD_DEPLOYMENT_HOST, alias: [PREVIEW_HOST] } } } }, /production deployment or one of its aliases/],
    [{ deployment: { meta: { githubCommitSha: "0".repeat(40) } } }, /different commit/],
    [{ deployment: { readyState: "BUILDING" } }, /not READY/],
    [{ deployment: { projectId: "prj_other" } }, /expected Vercel project/],
    [{ deployment: { url: "taxiflowpro-zzzzzzzzz-apprigate.vercel.app" } }, /immutable URL/],
    [{ status: 403 }, /HTTP 403/],
    [{ project: { targets: {} } }, /production deployment/],
  ];
  for (const [options, expected] of cases) {
    const { fetchImpl } = vercelFetch(options);
    await assert.rejects(verify(fetchImpl), expected, JSON.stringify(options));
  }
  await assert.rejects(
    verify(async () => {
      throw new Error("offline");
    }),
    /Could not reach/,
  );
});

test("deployment: error messages never contain the token", async () => {
  const { fetchImpl } = vercelFetch({ status: 401 });
  await assert.rejects(verify(fetchImpl), (error) => !error.message.includes(TOKEN));
});

// --- Fixture ------------------------------------------------------------------

test("fixture: accepts an unassigned, unreferenced UAT- vehicle chosen by id", () => {
  assert.deepEqual(assertDisposableVehicleFixture(baseSnapshot(), { vehicleId: "veh-uat" }), {
    id: "veh-uat",
    registration: "UAT-TEST-01",
  });
});

test("fixture: refuses a missing id, unknown id, real/first vehicle, archived, assigned or referenced vehicle", () => {
  const snapshot = baseSnapshot();
  assert.throws(() => assertDisposableVehicleFixture(snapshot, { vehicleId: "" }), /UAT_FIXTURE_VEHICLE_ID is required/);
  assert.throws(() => assertDisposableVehicleFixture(snapshot, { vehicleId: "veh-x" }), /does not exist/);
  assert.throws(() => assertDisposableVehicleFixture(snapshot, { vehicleId: "veh-1" }), /not marked disposable/);

  const archived = baseSnapshot();
  archived.vehicles[1].archivedAt = "2026-10-01T00:00:00Z";
  assert.throws(() => assertDisposableVehicleFixture(archived, { vehicleId: "veh-uat" }), /archived/);

  const assigned = baseSnapshot();
  assigned.vehicles[1].assignedDriverId = "drv-01";
  assert.throws(() => assertDisposableVehicleFixture(assigned, { vehicleId: "veh-uat" }), /assigned to a driver/);

  for (const collection of ["financeTransactions", "dailyCashUps", "defects"]) {
    const referenced = baseSnapshot();
    referenced[collection] = [...(referenced[collection] ?? []), { id: "real-use", vehicleId: "veh-uat", note: "real trip" }];
    assert.throws(() => assertDisposableVehicleFixture(referenced, { vehicleId: "veh-uat" }), /non-UAT/, collection);
  }
});

// --- Write inventory ------------------------------------------------------------

const classify = (before, after) =>
  classifyWorkspaceChanges({
    before: fingerprintWorkspace(before),
    after: fingerprintWorkspace(after),
    beforeSnapshot: before,
    afterSnapshot: after,
    runTag: "RG-run1",
    disposableEmail: "taxiflow-uat+run1@apprigate.com",
    fixtureVehicleId: "veh-uat",
    fixtureRegistration: "UAT-TEST-01",
  });

test("inventory: an unchanged workspace is clean", () => {
  assert.deepEqual(classify(baseSnapshot(), baseSnapshot()), { retained: [], residue: [], unexpected: [] });
});

test("inventory: run audit entries and fixture vehicle changes are retained, not residue", () => {
  const after = baseSnapshot();
  after.auditTrail.unshift({ id: "aud-run", title: "Trip saved", detail: "UAT-PROBE to RG-run1" });
  after.vehicles[1].currentOdometer = 1010;
  const result = classify(baseSnapshot(), after);
  assert.deepEqual(result.retained.map((c) => `${c.collection}:${c.id}`).sort(), ["auditTrail:aud-run", "vehicles:veh-uat"]);
  assert.equal(result.residue.length + result.unexpected.length, 0);
});

test("inventory: run records left behind are residue (finance, cash-up, user, outbox)", () => {
  const after = baseSnapshot();
  after.financeTransactions.push({ id: "fin-run", toLocation: "RG-run1", vehicleId: "veh-uat" });
  after.dailyCashUps.push({ id: "cu-run", vehicle: "UAT-TEST-01", status: "counted" });
  after.appUsers.push({ email: "taxiflow-uat+run1@apprigate.com", role: "Manager" });
  after.emailOutbox.push({ id: "mail-run", to: "taxiflow-uat+run1@apprigate.com" });
  const result = classify(baseSnapshot(), after);
  assert.deepEqual(
    result.residue.map((c) => c.collection).sort(),
    ["appUsers", "dailyCashUps", "emailOutbox", "financeTransactions"],
  );
  assert.equal(result.unexpected.length, 0);
});

test("inventory: unrelated changes are unexpected (other vehicle odometer, real records, unrelated audit, removals, profile)", () => {
  const after = baseSnapshot();
  after.vehicles[0].currentOdometer = 384200;
  after.financeTransactions[0].status = "counted";
  after.auditTrail.unshift({ id: "aud-other", title: "Someone else edited a route" });
  after.dailyCashUps = [];
  after.profile = { name: "Renamed" };
  const unexpected = classify(baseSnapshot(), after).unexpected.map((c) => `${c.collection}:${c.kind}`).sort();
  assert.deepEqual(unexpected, [
    "auditTrail:added",
    "dailyCashUps:removed",
    "financeTransactions:changed",
    "profile:changed",
    "vehicles:changed",
  ]);
});

test("inventory: auth users - disposable left behind is residue, any other change is unexpected", () => {
  assert.deepEqual(
    classifyAuthUserChanges({ beforeIds: ["a"], afterIds: ["a", "uat"], disposableUserId: "uat" }),
    { residue: ["uat"], unexpected: [] },
  );
  assert.deepEqual(
    classifyAuthUserChanges({ beforeIds: ["a", "b"], afterIds: ["a", "x"], disposableUserId: "uat" }),
    { residue: [], unexpected: ["x", "b"] },
  );
});

// --- Runner orchestration (mocked I/O) ------------------------------------------

const validEnv = () => ({
  PREVIEW_URL: `https://${PREVIEW_HOST}`,
  UAT_EXPECTED_DEPLOYMENT_HOST: PREVIEW_HOST,
  UAT_EXPECTED_COMMIT_SHA: COMMIT,
  UAT_FIXTURE_VEHICLE_ID: "veh-uat",
  VERCEL_TOKEN: TOKEN,
  UAT_OWNER_EMAIL: "owner@example.com",
  UAT_OWNER_PASSWORD: "not-a-real-password",
  SUPABASE_URL: "https://vfxftviwteypasredjgm.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
});

const DISPOSABLE = "taxiflow-uat+run1@apprigate.com";

// A tiny in-memory "live project": workspace row + auth ids + call log.
const fakeLive = ({ env = validEnv(), snapshot = baseSnapshot(), fetchOptions, hooks = {} } = {}) => {
  const state = { snapshot: clone(snapshot), version: "v0", authIds: ["auth-owner"] };
  const calls = [];
  const bump = (mutate) => {
    mutate(state.snapshot);
    state.version = `v${Number(state.version.slice(1)) + 1}`;
  };
  const { fetchImpl } = vercelFetch(fetchOptions);
  const outcomes = Object.fromEntries(Object.keys(TEST_TITLE_TO_SCORECARD_KEY).map((title) => [title, "PASS"]));
  const reports = [];

  const deps = {
    loadEnv: async () => ({ env, loaded: true }),
    fetchImpl,
    readWorkspace: async () => {
      calls.push("readWorkspace");
      hooks.onRead?.(state, calls, bump);
      return { snapshot: clone(state.snapshot), version: state.version };
    },
    listAuthUserIds: async () => [...state.authIds],
    findAuthUserId: async () => "auth-uat",
    provisionUser: async () => {
      calls.push("provisionUser");
      bump((s) => {
        s.appUsers.push({ email: DISPOSABLE, role: "Manager", active: true });
        s.auditTrail.unshift({ id: "aud-prov", title: `User created ${DISPOSABLE}` });
      });
      state.authIds.push("auth-uat");
      hooks.afterProvision?.(state, bump);
    },
    cleanupUser: async () => {
      calls.push("cleanupUser");
      bump((s) => {
        s.appUsers = s.appUsers.filter((user) => user.email !== DISPOSABLE);
        s.auditTrail.unshift({ id: "aud-del", title: `User removed ${DISPOSABLE}` });
      });
      state.authIds = state.authIds.filter((id) => id !== "auth-uat");
      return { ok: true };
    },
    mintRecoveryLink: async () => {
      calls.push("mintRecoveryLink");
      const redirect = `https://${PREVIEW_HOST}`;
      return {
        actionLink: `https://vfxftviwteypasredjgm.supabase.co/auth/v1/verify?redirect_to=${encodeURIComponent(redirect)}`,
        redirectTo: redirect,
      };
    },
    runPlaywright: async ({ env: childEnv }) => {
      calls.push("runPlaywright");
      state.childEnv = childEnv;
      (hooks.browserRun ?? defaultBrowserRun)(state, bump);
      return 0;
    },
    parsePlaywrightResults: async () => outcomes,
    readCapturedClientRef: async () => "vfxftviwteypasredjgm",
    writeReport: async (name, report) => {
      reports.push(report);
      return `uat-reports/${name}`;
    },
    log: () => {},
    error: () => {},
    randomId: () => "run1",
    randomPassword: () => "Uat!generated",
  };
  return { deps, calls, state, reports };
};

// What a clean UI run leaves: audit entries mentioning the run, the fixture
// odometer moved, and the finance record created then deleted.
const defaultBrowserRun = (state, bump) => {
  bump((s) => {
    s.financeTransactions.push({ id: "fin-run", toLocation: "RG-run1", vehicleId: "veh-uat" });
    s.auditTrail.unshift({ id: "aud-trip", title: "Trip saved", detail: "UAT-TEST-01 RG-run1" });
  });
  bump((s) => {
    s.financeTransactions = s.financeTransactions.filter((record) => record.id !== "fin-run");
    s.vehicles.find((vehicle) => vehicle.id === "veh-uat").currentOdometer = 1010;
    s.auditTrail.unshift({ id: "aud-trip-del", title: "Trip deleted", detail: "RG-run1" });
  });
};

const WRITES = ["provisionUser", "mintRecoveryLink", "runPlaywright", "cleanupUser"];
const noWrites = (calls) => WRITES.every((name) => !calls.includes(name));

test("runner: a production alias is refused before any read or write", async () => {
  const env = { ...validEnv(), PREVIEW_URL: "https://taxiflowpro.vercel.app", UAT_EXPECTED_DEPLOYMENT_HOST: "taxiflowpro.vercel.app" };
  const live = fakeLive({ env });
  assert.equal(await runPreviewUat(live.deps), 2);
  assert.deepEqual(live.calls, []);
});

test("runner: a production-target deployment (per the Vercel API) is refused before any write", async () => {
  const live = fakeLive({ fetchOptions: { deployment: { target: "production" } } });
  assert.equal(await runPreviewUat(live.deps), 2);
  assert.ok(noWrites(live.calls));
  assert.ok(!live.calls.includes("readWorkspace"));
});

test("runner: missing Vercel token or expected commit is refused before any write", async () => {
  for (const name of ["VERCEL_TOKEN", "UAT_EXPECTED_COMMIT_SHA", "UAT_EXPECTED_DEPLOYMENT_HOST"]) {
    const env = validEnv();
    delete env[name];
    const live = fakeLive({ env });
    assert.equal(await runPreviewUat(live.deps), 2, name);
    assert.ok(noWrites(live.calls), name);
  }
});

test("runner: a real or missing fixture vehicle is refused after read-only checks, before any write", async () => {
  for (const vehicleId of ["veh-1", "", "veh-missing"]) {
    const live = fakeLive({ env: { ...validEnv(), UAT_FIXTURE_VEHICLE_ID: vehicleId } });
    assert.equal(await runPreviewUat(live.deps), 2, vehicleId);
    assert.ok(noWrites(live.calls), vehicleId);
    assert.ok(live.calls.every((call) => call === "readWorkspace"), vehicleId);
  }
});

test("runner: another writer after provisioning stops the run before any UI write, and the user is cleaned up", async () => {
  const live = fakeLive({
    hooks: {
      onRead: (state, calls, bump) => {
        // The third read is the pre-browser version check.
        if (calls.filter((call) => call === "readWorkspace").length === 3) {
          bump((s) => s.auditTrail.unshift({ id: "aud-other", title: "Someone else saved" }));
        }
      },
    },
  });
  assert.equal(await runPreviewUat(live.deps), 1);
  assert.ok(!live.calls.includes("runPlaywright"));
  assert.ok(live.calls.includes("cleanupUser"));
  assert.match(live.reports[0].scorecard.writeInventory, /unexpected/);
});

test("runner: provisioning that changes unrelated data stops before the browser suite", async () => {
  const live = fakeLive({
    hooks: { afterProvision: (state, bump) => bump((s) => (s.vehicles[0].currentOdometer += 1)) },
  });
  assert.equal(await runPreviewUat(live.deps), 1);
  assert.ok(!live.calls.includes("mintRecoveryLink"));
  assert.ok(!live.calls.includes("runPlaywright"));
  assert.ok(live.calls.includes("cleanupUser"));
});

test("runner: clean run passes, passes only the verified fixture to the browser, and never tests banked", async () => {
  const live = fakeLive();
  assert.equal(await runPreviewUat(live.deps), 0);
  assert.equal(live.state.childEnv.UAT_FIXTURE_VEHICLE_ID, "veh-uat");
  assert.equal(live.state.childEnv.UAT_FIXTURE_VEHICLE_REGISTRATION, "UAT-TEST-01");
  assert.equal(live.state.childEnv.UAT_RUNNER_PREFLIGHT, "passed");
  assert.equal(live.state.childEnv.PREVIEW_URL, `https://${PREVIEW_HOST}`);

  const [report] = live.reports;
  assert.equal(report.scorecard.financeBanked, BANKED_STEP_STATUS);
  assert.match(report.scorecard.financeBanked, /^NOT TESTED/);
  assert.equal(report.scorecard.writeInventory, "PASS");
  assert.equal(report.scorecard.cleanup, "PASS");
  assert.deepEqual(report.inventory.final.unexpected, []);
  assert.deepEqual(report.inventory.final.residue, []);
  assert.ok(report.inventory.final.retained.includes("vehicles:changed:veh-uat"));
  assert.ok(!JSON.stringify(report).includes("not-a-real-password"));
  assert.ok(!JSON.stringify(report).includes("not-a-real-key"));
  assert.ok(!JSON.stringify(report).includes(TOKEN));
});

test("runner: a finance record left behind is reported as residue and fails cleanup", async () => {
  const live = fakeLive({
    hooks: {
      browserRun: (state, bump) =>
        bump((s) => s.financeTransactions.push({ id: "fin-run", toLocation: "RG-run1", vehicleId: "veh-uat" })),
    },
  });
  assert.equal(await runPreviewUat(live.deps), 1);
  assert.match(live.reports[0].scorecard.cleanup, /residue/);
  assert.deepEqual(live.reports[0].inventory.final.residue, ["financeTransactions:added:fin-run"]);
});

test("runner: a real vehicle changed during the browser suite is unexpected and fails the run", async () => {
  const live = fakeLive({
    hooks: { browserRun: (state, bump) => bump((s) => (s.vehicles[0].currentOdometer = 999999)) },
  });
  assert.equal(await runPreviewUat(live.deps), 1);
  assert.deepEqual(live.reports[0].inventory.final.unexpected, ["vehicles:changed:veh-1"]);
});

// --- Static guarantees ------------------------------------------------------------

const listFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])),
  );
  return files.flat();
};

test("static: UAT tooling never writes, upserts, deletes or restores workspace_snapshots directly", async () => {
  const files = [...(await listFiles("scripts/uat")), ...(await listFiles("tests/uat"))];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/from\("workspace_snapshots"\)([\s\S]{0,200})/g)) {
      assert.doesNotMatch(match[1], /\.(insert|upsert|update|delete)\(/, file);
    }
    assert.doesNotMatch(source, /restore(Whole|Full)?Snapshot|persistSnapshot\(/i, file);
  }
});

test("static: the UAT spec selects the fixture vehicle by id, never by list position, and stops on live conflicts", async () => {
  const spec = await readFile("tests/uat/preview.spec.js", "utf8");
  assert.doesNotMatch(spec, /locator\("option"\)\.first\(\)/);
  assert.match(spec, /required\("UAT_FIXTURE_VEHICLE_ID"\)/);
  assert.match(spec, /selectOption\(FIXTURE_VEHICLE_ID\)/);
  assert.match(spec, /Another device changed this workspace/);
  assert.match(spec, /Changes are queued/);
  const config = await readFile("playwright.uat.config.mjs", "utf8");
  assert.match(config, /UAT_RUNNER_PREFLIGHT !== "passed"/);
});
