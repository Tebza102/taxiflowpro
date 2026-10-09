#!/usr/bin/env node
// Automated release gate for the TaxiFlow Preview deployment.
//
// Order of operations (every live write happens after step 3):
//   1. Configuration + target checks: PREVIEW_URL must be the exact verified
//      immutable Preview host, and the Vercel API must confirm it is a READY,
//      non-production deployment of this project at UAT_EXPECTED_COMMIT_SHA and
//      not the production deployment or any production alias.
//   2. Read-only baseline: the live workspace row and the Auth user ids are
//      fingerprinted (keys + hashes only, no contents kept or printed).
//   3. Fixture check: UAT_FIXTURE_VEHICLE_ID must be a disposable "UAT-" vehicle
//      that no real record references. The first/any real vehicle is never used.
//   4. Disposable user provisioning through api/_lib/userLifecycle.js, then a
//      re-read that must show ONLY that account (plus its audit entries) changed.
//   5. A recovery link via admin.generateLink (no inbox needed).
//   6. A version re-check immediately before the browser suite: if anyone else has
//      written to the workspace since step 4, the run stops before any UI write.
//   7. tests/uat/preview.spec.js (Owner login, new-user login, recovery,
//      persistence, pending -> counted -> verified on the fixture vehicle, delete).
//      The spec stops at the first live conflict or save warning.
//   8. Disposable user cleanup, then a final diff against the baseline that sorts
//      every change into retained (run audit entries, fixture vehicle), residue
//      (run records left behind) and unexpected (anything else).
//
// It never merges, promotes, deploys, alters secrets, applies migrations, or
// writes/restores a whole workspace snapshot. The banked step is NOT TESTED.
// It never prints a full Supabase URL, a key, a password or a token.
//
// One-time local setup: an untracked, gitignored .env.uat.local at the repo root:
//   PREVIEW_URL=https://<immutable-preview-host>
//   UAT_EXPECTED_DEPLOYMENT_HOST=<the same host>
//   UAT_EXPECTED_COMMIT_SHA=<full commit SHA the Preview was built from>
//   UAT_FIXTURE_VEHICLE_ID=<id of a disposable vehicle registered as UAT-...>
//   VERCEL_TOKEN=<token able to read this Vercel project>
//   UAT_OWNER_EMAIL / UAT_OWNER_PASSWORD
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (the Preview's server values)
// Optional: UAT_TEST_EMAIL_DOMAIN, UAT_DISPOSABLE_ROLE, UAT_PRODUCTION_HOSTS
// (comma-separated extra hosts to refuse), VERCEL_AUTOMATION_BYPASS_SECRET.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createUatServiceClient, extractProjectRef } from "./lib/serviceClient.mjs";
import {
  buildDisposableUatEmail,
  provisionDisposableUser,
  cleanupDisposableUser,
} from "./lib/disposableUser.mjs";
import { generateRecoveryActionLink } from "./lib/recoveryLink.mjs";
import { loadLocalUatEnv } from "./lib/loadLocalEnv.mjs";
import {
  BANKED_STEP_STATUS,
  assertDisposableVehicleFixture,
  assertSafePreviewTarget,
  classifyAuthUserChanges,
  classifyWorkspaceChanges,
  fingerprintWorkspace,
  parseHostList,
  summarizeChanges,
  verifyDeploymentTarget,
} from "./lib/safeguards.mjs";
import { resolveServerWorkspaceKey } from "../../api/_lib/workspaceKey.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const REPORT_DIR = path.join(REPO_ROOT, "uat-reports");
const LOCAL_ENV_FILE = ".env.uat.local";

// --- Test-title -> scorecard mapping -------------------------------------------
// Kept in one place so a renamed test in tests/uat/preview.spec.js fails loudly
// here instead of silently vanishing from the scorecard.
export const TEST_TITLE_TO_SCORECARD_KEY = {
  "Owner login": "ownerLogin",
  "Environment ref capture": "envRefCapture",
  "New-user login": "newUserLogin",
  "Recovery application": "recoveryApplication",
  "Persistence (fresh context)": "persistenceAndFinancePending",
  "Finance: pending to counted": "financeCounted",
  "Finance: counted to verified": "financeVerified",
  "Cleanup: finance UAT record": "financeCleanup",
};

const SCORECARD_ORDER = [
  ["target", "Preview target"],
  ["fixture", "Disposable fixture"],
  ["envRefs", "Environment refs"],
  ["ownerLogin", "Owner login"],
  ["userProvisioning", "User provisioning"],
  ["newUserLogin", "New-user login"],
  ["recoveryApplication", "Recovery application"],
  ["recoveryEmailDelivery", "Recovery email delivery"],
  ["persistenceAndFinancePending", "Persistence"],
  ["financePending", "Finance pending"],
  ["financeCounted", "Finance counted"],
  ["financeVerified", "Finance verified"],
  ["financeBanked", "Finance banked"],
  ["writeInventory", "Write inventory"],
  ["cleanup", "Cleanup"],
];

const requireValue = (env, name) => {
  const value = String(env[name] ?? "").trim();
  if (!value) {
    throw new Error(
      `Missing required configuration: ${name}. Set it in your shell or in the untracked ` +
        `${LOCAL_ENV_FILE} at the repo root (see the header of this file).`,
    );
  }
  return value;
};

// Refuses to proceed if the local secrets file exists but git would track it.
const assertLocalEnvFileIsIgnored = () => {
  const filePath = path.join(REPO_ROOT, LOCAL_ENV_FILE);
  const result = spawnSync("git", ["check-ignore", "-q", filePath], { cwd: REPO_ROOT });
  if (result.status === 1) {
    throw new Error(
      `${LOCAL_ENV_FILE} exists but is not covered by .gitignore. Refusing to load it.`,
    );
  }
};

const runPlaywright = ({ env }) =>
  new Promise((resolve) => {
    // The repo's own Playwright binary; fixed command and args, never interpolated.
    const playwrightBin = path.join(
      REPO_ROOT,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "playwright.cmd" : "playwright",
    );
    const child = spawn(playwrightBin, ["test", "-c", "playwright.uat.config.mjs"], {
      cwd: REPO_ROOT,
      env,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

const parsePlaywrightResults = async () => {
  let raw;
  try {
    raw = await readFile(path.join(REPORT_DIR, "playwright-results.json"), "utf8");
  } catch {
    return {};
  }
  const json = JSON.parse(raw);
  const outcomes = {};
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      // A skipped test (e.g. after an earlier failure in a serial block) is not a pass.
      const status = spec.tests?.[0]?.results?.[0]?.status;
      outcomes[spec.title] = status === "skipped" ? "NOT RUN" : spec.ok ? "PASS" : "FAIL";
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of json.suites ?? []) walk(suite);
  return outcomes;
};

const readCapturedClientRef = async () => {
  const captured = JSON.parse(await readFile(path.join(REPORT_DIR, "captured-client-ref.json"), "utf8"));
  return captured.clientRef ?? null;
};

// Real I/O. Tests replace any of these with mocks.
export const createDefaultDeps = () => {
  let supabase = null;
  const client = (env) => {
    supabase ??= createUatServiceClient({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return supabase;
  };

  return {
    loadEnv: async () => {
      assertLocalEnvFileIsIgnored();
      const { loaded } = await loadLocalUatEnv({ repoRoot: REPO_ROOT, fileName: LOCAL_ENV_FILE });
      return { env: process.env, loaded };
    },
    fetchImpl: globalThis.fetch,
    readWorkspace: async (env) => {
      const { data, error } = await client(env)
        .from("workspace_snapshots")
        .select("snapshot, updated_at")
        .eq("workspace_key", resolveServerWorkspaceKey())
        .maybeSingle();
      if (error) throw new Error(`Workspace read failed: ${error.message}`);
      if (!data) throw new Error("The live workspace row does not exist.");
      return { snapshot: data.snapshot ?? {}, version: data.updated_at ?? null };
    },
    listAuthUserIds: async (env) => {
      const ids = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await client(env).auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`Auth user listing failed: ${error.message}`);
        const users = data?.users ?? [];
        ids.push(...users.map((user) => user.id));
        if (users.length < 1000) return ids;
      }
    },
    findAuthUserId: async (env, email) => {
      const { data, error } = await client(env).auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw new Error(`Auth user lookup failed: ${error.message}`);
      return (data?.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
    },
    provisionUser: (env, args) => provisionDisposableUser({ supabase: client(env), ...args }),
    cleanupUser: (env, args) => cleanupDisposableUser({ supabase: client(env), ...args }),
    mintRecoveryLink: (env, args) => generateRecoveryActionLink({ supabase: client(env), ...args }),
    runPlaywright,
    parsePlaywrightResults,
    readCapturedClientRef,
    writeReport: async (name, report) => {
      await mkdir(REPORT_DIR, { recursive: true });
      const reportPath = path.join(REPORT_DIR, name);
      await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
      return path.relative(REPO_ROOT, reportPath);
    },
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
    randomId: () => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
    randomPassword: () => `Uat!${randomBytes(9).toString("base64url")}`,
  };
};

const printScorecard = (deps, scorecard) => {
  deps.log("\n=== Preview Release Gate ===");
  for (const [key, label] of SCORECARD_ORDER) {
    deps.log(`${label.padEnd(24, ".")} ${scorecard[key] ?? "NOT RUN"}`);
  }
};

// Returns the process exit code. Every live write (user provisioning, recovery
// link, browser suite) sits after the target, baseline and fixture checks.
export const runPreviewUat = async (overrides = {}) => {
  const deps = { ...createDefaultDeps(), ...overrides };
  const scorecard = { financeBanked: BANKED_STEP_STATUS, recoveryEmailDelivery: "HUMAN CHECK REQUIRED" };
  const { env, loaded } = await deps.loadEnv();
  deps.log(
    loaded
      ? `[uat] Loaded local configuration from ${LOCAL_ENV_FILE} (contents never logged).`
      : `[uat] No ${LOCAL_ENV_FILE} found - relying on shell-exported environment variables only.`,
  );

  // --- 1. Target ---------------------------------------------------------------
  let target;
  let fixture;
  let baseline;
  let baselineAuthIds;
  const extraProductionHosts = parseHostList(env.UAT_PRODUCTION_HOSTS);
  let stage = "target";
  try {
    const expectedCommitSha = requireValue(env, "UAT_EXPECTED_COMMIT_SHA");
    target = assertSafePreviewTarget({
      previewUrl: requireValue(env, "PREVIEW_URL"),
      expectedHost: requireValue(env, "UAT_EXPECTED_DEPLOYMENT_HOST"),
      expectedCommitSha,
      extraProductionHosts,
    });
    const deployment = await verifyDeploymentTarget({
      host: target.host,
      expectedCommitSha,
      token: env.VERCEL_TOKEN,
      fetchImpl: deps.fetchImpl,
      extraProductionHosts,
    });
    scorecard.target = "PASS";
    stage = "configuration";
    deps.log(`[uat] Target ${target.host}: ${deployment.target} deployment ${deployment.deploymentId} @ ${deployment.commitSha}`);

    for (const name of ["UAT_OWNER_EMAIL", "UAT_OWNER_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      requireValue(env, name);
    }
    if (!extractProjectRef(env.SUPABASE_URL)) {
      throw new Error("Could not derive a project ref from SUPABASE_URL.");
    }

    // --- 2. Read-only baseline -------------------------------------------------
    stage = "baseline read";
    baseline = await deps.readWorkspace(env);
    baselineAuthIds = await deps.listAuthUserIds(env);

    // --- 3. Fixture -------------------------------------------------------------
    stage = "fixture";
    fixture = assertDisposableVehicleFixture(baseline.snapshot, { vehicleId: env.UAT_FIXTURE_VEHICLE_ID });
    scorecard.fixture = "PASS";
  } catch (error) {
    if (stage === "target") scorecard.target = "FAIL";
    else scorecard.fixture = stage === "fixture" ? "FAIL" : `NOT RUN (${stage} failed)`;
    deps.error(`[uat] Refused before any write (${stage}): ${error.message}`);
    printScorecard(deps, scorecard);
    return 2;
  }

  const ownerEmail = env.UAT_OWNER_EMAIL.trim();
  const runId = deps.randomId();
  const runTag = `RG-${runId}`;
  const disposableEmail = buildDisposableUatEmail({
    runId,
    domain: env.UAT_TEST_EMAIL_DOMAIN?.trim() || "apprigate.com",
  });
  const disposableRole = env.UAT_DISPOSABLE_ROLE?.trim() || "Manager";
  const disposablePassword = deps.randomPassword();
  const recoveryNewPassword = deps.randomPassword();
  const classifyArgs = {
    runTag,
    disposableEmail,
    fixtureVehicleId: fixture.id,
    fixtureRegistration: fixture.registration,
  };
  const inventory = { afterProvisioning: null, final: null };
  deps.log(`[uat] Run tag: ${runTag}; disposable account: ${disposableEmail} (${disposableRole}); fixture: ${fixture.registration}`);

  // --- 4. Provision, then confirm it was the only change ------------------------
  let disposableUserId = null;
  let proceed = false;
  let provisionedState = null;
  try {
    await deps.provisionUser(env, {
      ownerEmail,
      email: disposableEmail,
      password: disposablePassword,
      role: disposableRole,
    });
    scorecard.userProvisioning = "PASS";
    disposableUserId = await deps.findAuthUserId(env, disposableEmail);
    provisionedState = await deps.readWorkspace(env);
    const workspace = classifyWorkspaceChanges({
      before: fingerprintWorkspace(baseline.snapshot),
      after: fingerprintWorkspace(provisionedState.snapshot),
      beforeSnapshot: baseline.snapshot,
      afterSnapshot: provisionedState.snapshot,
      ...classifyArgs,
    });
    const auth = classifyAuthUserChanges({
      beforeIds: baselineAuthIds,
      afterIds: await deps.listAuthUserIds(env),
      disposableUserId,
    });
    const onlyOurAccountAdded =
      workspace.unexpected.length === 0 &&
      auth.unexpected.length === 0 &&
      workspace.residue.some((change) => change.collection === "appUsers" && change.kind === "added");
    inventory.afterProvisioning = {
      retained: summarizeChanges(workspace.retained),
      created: summarizeChanges(workspace.residue),
      unexpected: [...summarizeChanges(workspace.unexpected), ...auth.unexpected.map((id) => `auth:${id}`)],
    };
    if (onlyOurAccountAdded) {
      proceed = true;
    } else {
      deps.error("[uat] STOP: provisioning changed more than the disposable account, or another writer is active.");
    }
  } catch (error) {
    scorecard.userProvisioning ??= "FAIL";
    deps.error(`[uat] Disposable user provisioning failed: ${error.message}`);
  }

  // --- 5. Recovery link --------------------------------------------------------
  let recoveryActionLink = null;
  if (proceed) {
    try {
      const linkResult = await deps.mintRecoveryLink(env, { email: disposableEmail, redirectTo: target.origin });
      const redirectHost = linkResult.redirectTo ? new URL(linkResult.redirectTo).host : null;
      const actionRedirect = new URL(linkResult.actionLink).searchParams.get("redirect_to");
      const actionRedirectHost = actionRedirect ? new URL(actionRedirect).host : null;
      if (redirectHost === target.host && actionRedirectHost === target.host) {
        recoveryActionLink = linkResult.actionLink;
      } else {
        deps.error("[uat] Recovery link does not redirect to the verified Preview host; not opening it.");
      }
    } catch (error) {
      deps.error(`[uat] Recovery link generation failed: ${error.message}`);
    }
  }

  // --- 6. Version re-check, then 7. browser suite --------------------------------
  if (proceed && recoveryActionLink) {
    const current = await deps.readWorkspace(env);
    if (current.version !== provisionedState.version) {
      deps.error("[uat] STOP: the live workspace changed after provisioning (another writer). No UI writes made.");
      proceed = false;
    }
  }

  if (proceed && recoveryActionLink) {
    const exitCode = await deps.runPlaywright({
      env: {
        ...env,
        PREVIEW_URL: target.origin,
        UAT_OWNER_EMAIL: ownerEmail,
        UAT_OWNER_PASSWORD: env.UAT_OWNER_PASSWORD,
        UAT_DISPOSABLE_EMAIL: disposableEmail,
        UAT_DISPOSABLE_PASSWORD: disposablePassword,
        UAT_DISPOSABLE_ROLE: disposableRole,
        UAT_RECOVERY_NEW_PASSWORD: recoveryNewPassword,
        UAT_RECOVERY_ACTION_LINK: recoveryActionLink,
        UAT_CLIENT_REF_OUTPUT_PATH: path.join(REPORT_DIR, "captured-client-ref.json"),
        UAT_RUN_TAG: runTag,
        UAT_FIXTURE_VEHICLE_ID: fixture.id,
        UAT_FIXTURE_VEHICLE_REGISTRATION: fixture.registration,
        UAT_RUNNER_PREFLIGHT: "passed",
      },
    });
    deps.log(`[uat] Browser suite exit code ${exitCode}.`);
    const outcomes = await deps.parsePlaywrightResults();
    for (const [title, key] of Object.entries(TEST_TITLE_TO_SCORECARD_KEY)) {
      scorecard[key] = outcomes[title] ?? "NOT RUN";
    }
    scorecard.financePending = scorecard.persistenceAndFinancePending;

    let clientRef = null;
    try {
      clientRef = scorecard.envRefCapture === "PASS" ? await deps.readCapturedClientRef() : null;
    } catch (error) {
      deps.error(`[uat] Could not read the captured client ref: ${error.message}`);
    }
    const serverRef = extractProjectRef(env.SUPABASE_URL);
    scorecard.envRefs = clientRef ? (clientRef === serverRef ? "PASS" : "FAIL") : "FAIL";
    deps.log(`[uat] Supabase ref: server ${serverRef}, client ${clientRef ?? "not captured"}`);
  } else {
    deps.error("[uat] Browser suite not run.");
  }

  // --- 8. Cleanup and final inventory -------------------------------------------
  let cleanupOk = true;
  if (scorecard.userProvisioning === "PASS") {
    try {
      const result = await deps.cleanupUser(env, { ownerEmail, email: disposableEmail });
      if (!result?.ok) {
        cleanupOk = false;
        deps.error(`[uat] Disposable user cleanup failed: ${result?.error ?? "unknown error"}`);
      }
    } catch (error) {
      cleanupOk = false;
      deps.error(`[uat] Disposable user cleanup threw: ${error.message}`);
    }
  }

  try {
    const finalState = await deps.readWorkspace(env);
    const workspace = classifyWorkspaceChanges({
      before: fingerprintWorkspace(baseline.snapshot),
      after: fingerprintWorkspace(finalState.snapshot),
      beforeSnapshot: baseline.snapshot,
      afterSnapshot: finalState.snapshot,
      ...classifyArgs,
    });
    const auth = classifyAuthUserChanges({
      beforeIds: baselineAuthIds,
      afterIds: await deps.listAuthUserIds(env),
      disposableUserId,
    });
    inventory.final = {
      retained: summarizeChanges(workspace.retained),
      residue: [...summarizeChanges(workspace.residue), ...auth.residue.map((id) => `auth:${id}`)],
      unexpected: [...summarizeChanges(workspace.unexpected), ...auth.unexpected.map((id) => `auth:${id}`)],
    };
    scorecard.writeInventory = inventory.final.unexpected.length === 0 ? "PASS" : "FAIL — unexpected changes";
    scorecard.cleanup = cleanupOk && inventory.final.residue.length === 0 ? "PASS" : "FAIL — residue";
    for (const [label, list] of Object.entries(inventory.final)) {
      deps.log(`[uat] ${label}: ${list.length ? list.join(", ") : "none"}`);
    }
  } catch (error) {
    scorecard.writeInventory = "FAIL — could not read final state";
    scorecard.cleanup = "FAIL — not verified";
    deps.error(`[uat] Final inventory could not run: ${error.message}`);
  }

  const required = [
    "target",
    "fixture",
    "envRefs",
    "ownerLogin",
    "userProvisioning",
    "newUserLogin",
    "recoveryApplication",
    "persistenceAndFinancePending",
    "financeCounted",
    "financeVerified",
    "writeInventory",
    "cleanup",
  ];
  const automatedChecksAllPassed = required.every((key) => scorecard[key] === "PASS");

  printScorecard(deps, scorecard);
  deps.log("\nFINAL: BLOCKED FOR FULL RELEASE GATE (banked step not tested; recovery email needs a human check)");

  const timestamp = new Date().toISOString();
  const reportPath = await deps.writeReport(`preview-uat-${timestamp.replace(/[:.]/g, "-")}.json`, {
    timestamp,
    runTag,
    previewHost: target.host,
    expectedCommitSha: env.UAT_EXPECTED_COMMIT_SHA,
    fixtureVehicle: fixture.registration,
    automatedChecksAllPassed,
    scorecard,
    inventory,
  });
  deps.log(`[uat] Report written to ${reportPath}`);

  return automatedChecksAllPassed ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPreviewUat()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`[uat] Fatal: ${error.message}`);
      process.exit(1);
    });
}
