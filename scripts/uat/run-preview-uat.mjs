#!/usr/bin/env node
// Automated release gate for the TaxiFlow Preview deployment. Orchestrates:
//   1. An environment project-ref check - the server-side ref is derived directly
//      from the locally supplied SUPABASE_URL (no dashboard read needed: the
//      operator already has this value in hand to run the script at all), and the
//      Preview client-side ref is captured live from the browser's own network
//      traffic during the Playwright run. The two are compared automatically.
//   2. Disposable-user provisioning/cleanup through the SAME api/_lib/userLifecycle.js
//      functions the production HTTP endpoint calls (see scripts/uat/lib/disposableUser.mjs).
//   3. A real Supabase Auth recovery link (admin.generateLink) so the recovery
//      application flow can be tested without waiting on an inbox.
//   4. The tests/uat/preview.spec.js Playwright suite against the live Preview URL.
//   5. A read-only residue check + the release-gate scorecard.
//
// This script never merges, promotes, deploys, alters secrets, or applies the RLS
// migration. It only reads/writes UAT-tagged data through the app's own lifecycle
// functions and its own UI (via Playwright). It never prints a full Supabase URL,
// a key, a password, or a token - only project-ref segments and PASS/FAIL/MATCH.
//
// One-time local setup: create an untracked .env.uat.local (already covered by the
// repo's .env*.local gitignore rule) at the repo root with:
//   PREVIEW_URL=https://<your-preview-deployment>.vercel.app
//   UAT_OWNER_EMAIL=<real Owner email on that Preview deployment>
//   UAT_OWNER_PASSWORD=<that Owner's password>
//   SUPABASE_URL=<the same value Preview's server functions use>
//   SUPABASE_SERVICE_ROLE_KEY=<the same service-role key>
// Real shell-exported env vars always take precedence over this file. After that
// file exists, `npm run uat:preview` is the only command needed for future runs.
//
// Optional:
//   UAT_TEST_EMAIL_DOMAIN        - domain for the disposable account (default: apprigate.com)
//   UAT_DISPOSABLE_ROLE          - role for the disposable account (default: Manager)
//   --allow-banked-leg           - CLI flag; still requires UAT_WORKSPACE_ISOLATION_PROOF
//                                   AND an automated ref mismatch (see below) to actually run
//   UAT_WORKSPACE_ISOLATION_PROOF - must be exactly "CONFIRMED_ISOLATED_FROM_PRODUCTION"

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createUatServiceClient, extractProjectRef } from "./lib/serviceClient.mjs";
import {
  buildDisposableUatEmail,
  provisionDisposableUser,
  cleanupDisposableUser,
} from "./lib/disposableUser.mjs";
import { generateRecoveryActionLink } from "./lib/recoveryLink.mjs";
import { loadLocalUatEnv } from "./lib/loadLocalEnv.mjs";
import { resolveServerWorkspaceKey } from "../../api/_lib/workspaceKey.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const REPORT_DIR = path.join(REPO_ROOT, "uat-reports");
const LOCAL_ENV_FILE = ".env.uat.local";

const ALLOW_BANKED_LEG = process.argv.includes("--allow-banked-leg");

const requireEnv = (name) => {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(
      `Missing required configuration: ${name}. Set it in your shell or in an ` +
        `untracked ${LOCAL_ENV_FILE} at the repo root (see the header of this file ` +
        `for the exact template).`,
    );
  }
  return value;
};

// Refuses to proceed if the local secrets file exists but git would track it - this
// is a fail-closed guard against ever committing real credentials, checked before
// the file's contents are read into memory at all.
const assertLocalEnvFileIsIgnored = () => {
  const filePath = path.join(REPO_ROOT, LOCAL_ENV_FILE);
  const result = spawnSync("git", ["check-ignore", "-q", filePath], {
    cwd: REPO_ROOT,
  });

  // check-ignore exits 1 when the path is NOT ignored (and the file may not exist
  // yet, which is fine - loadLocalUatEnv handles that separately).
  if (result.status === 1) {
    throw new Error(
      `${LOCAL_ENV_FILE} exists but is not covered by .gitignore. Refusing to load it ` +
        `until it is properly ignored, to avoid ever committing real credentials.`,
    );
  }
};

const PRODUCTION_URL_MARKERS = ["taxiflowpro.vercel.app"];

const assertNeverProduction = (url) => {
  if (PRODUCTION_URL_MARKERS.some((marker) => url.includes(marker))) {
    throw new Error(
      `PREVIEW_URL ("${url}") looks like the production URL. Refusing to run UAT against it. ` +
        `This gate only ever runs against a Preview deployment.`,
    );
  }
};

// --- Test-title -> scorecard mapping -------------------------------------------
// Kept in one place so a renamed test in tests/uat/preview.spec.js fails loudly
// here instead of silently vanishing from the scorecard.
const TEST_TITLE_TO_SCORECARD_KEY = {
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
  ["cleanup", "Cleanup"],
];

const runPlaywright = ({ env }) =>
  new Promise((resolve) => {
    // Invoke the repo's own installed Playwright binary directly (not npx) so the
    // exact tested version is deterministic. `shell: true` is required for Windows
    // to execute the .cmd shim; the command/args here are fixed constants, never
    // interpolated from external input, so this is not an injection risk.
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
  const resultsPath = path.join(REPORT_DIR, "playwright-results.json");
  let raw;
  try {
    raw = await readFile(resultsPath, "utf8");
  } catch {
    return {};
  }

  const json = JSON.parse(raw);
  const outcomes = {};

  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      // Playwright's JSON reporter sets spec.ok = true for a SKIPPED test (e.g.
      // every test after an earlier failure in this suite's test.describe.serial
      // block) - skipped is not a pass. Check the actual result status first so a
      // test that never ran is never reported as PASS.
      const status = spec.tests?.[0]?.results?.[0]?.status;
      outcomes[spec.title] = status === "skipped" ? "NOT RUN" : spec.ok ? "PASS" : "FAIL";
    }
    for (const child of suite.suites ?? []) {
      walk(child);
    }
  };

  for (const suite of json.suites ?? []) {
    walk(suite);
  }

  return outcomes;
};

const main = async () => {
  assertLocalEnvFileIsIgnored();
  const { loaded: localEnvLoaded } = await loadLocalUatEnv({
    repoRoot: REPO_ROOT,
    fileName: LOCAL_ENV_FILE,
  });
  console.log(
    localEnvLoaded
      ? `[uat] Loaded local configuration from ${LOCAL_ENV_FILE} (contents never logged).`
      : `[uat] No ${LOCAL_ENV_FILE} found - relying on shell-exported environment variables only.`,
  );

  const previewUrl = requireEnv("PREVIEW_URL");
  assertNeverProduction(previewUrl);

  const ownerEmail = requireEnv("UAT_OWNER_EMAIL");
  const ownerPassword = requireEnv("UAT_OWNER_PASSWORD");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const testEmailDomain = process.env.UAT_TEST_EMAIL_DOMAIN?.trim() || "apprigate.com";
  const disposableRole = process.env.UAT_DISPOSABLE_ROLE?.trim() || "Manager";
  // Optional: only needed when the target project has Vercel Deployment
  // Protection (SSO) enabled on *.vercel.app URLs, as this one does. Never
  // logged; forwarded to Playwright, which sends it as a header
  // (see playwright.uat.config.mjs's vercelBypassHeaders) - this never touches
  // the app's own Supabase auth.
  const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || "";
  console.log(
    vercelBypassSecret
      ? "[uat] Vercel Deployment Protection bypass secret loaded (not logged)."
      : "[uat] No VERCEL_AUTOMATION_BYPASS_SECRET set - if this Preview has SSO protection enabled, Owner login will fail at the Vercel login screen.",
  );

  const serverRef = extractProjectRef(supabaseUrl);
  if (!serverRef) {
    throw new Error("Could not derive a project ref from SUPABASE_URL - is it a valid Supabase URL?");
  }

  await mkdir(REPORT_DIR, { recursive: true });

  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const runTag = `RG-${runId}`;
  const disposableEmail = buildDisposableUatEmail({ runId, domain: testEmailDomain });
  const disposablePassword = `Uat!${randomBytes(9).toString("base64url")}`;
  const recoveryNewPassword = `Uat!${randomBytes(9).toString("base64url")}`;

  const supabase = createUatServiceClient({ supabaseUrl, serviceRoleKey });
  const scorecard = {};
  let recoveryActionLink = null;

  console.log(`[uat] Run tag: ${runTag}`);
  console.log(`[uat] Preview target: ${previewUrl}`);
  console.log(`[uat] Disposable account: ${disposableEmail} (role: ${disposableRole})`);

  // --- Step: provision disposable user -----------------------------------------
  try {
    await provisionDisposableUser({
      supabase,
      ownerEmail,
      email: disposableEmail,
      password: disposablePassword,
      role: disposableRole,
    });
    scorecard.userProvisioning = "PASS";
    console.log("[uat] Disposable user provisioned.");
  } catch (error) {
    scorecard.userProvisioning = "FAIL";
    console.error(`[uat] Disposable user provisioning failed: ${error.message}`);
  }

  // --- Step: mint a real recovery link (no inbox required) -----------------------
  // Pre-flight check, BEFORE any browser opens: confirm Supabase's own response
  // (data.properties.redirect_to), not just the redirectTo we sent, actually
  // resolves to PREVIEW_URL. If Supabase itself already reports a different
  // redirect host (e.g. it silently fell back to the project's Site URL because
  // the allow-list entry didn't match), there is no point consuming the link in a
  // browser at all - that would just reproduce the same failure one step later.
  let recoveryRedirectHost = null;
  const previewHost = new URL(previewUrl).host;
  if (scorecard.userProvisioning === "PASS") {
    try {
      const linkResult = await generateRecoveryActionLink({
        supabase,
        email: disposableEmail,
        redirectTo: previewUrl,
      });
      recoveryActionLink = linkResult.actionLink;

      recoveryRedirectHost = linkResult.redirectTo ? new URL(linkResult.redirectTo).host : null;
      const actionLinkRedirectParam = new URL(recoveryActionLink).searchParams.get("redirect_to");
      const actionLinkRedirectHost = actionLinkRedirectParam ? new URL(actionLinkRedirectParam).host : null;
      const redirectMatches = recoveryRedirectHost === previewHost && actionLinkRedirectHost === previewHost;

      console.log("\n=== Recovery redirect pre-flight ===");
      console.log(`Recovery requested URL..... ${previewHost}`);
      console.log(`Generated redirect host.... ${recoveryRedirectHost ?? "none returned"}`);
      console.log(`action_link redirect_to.... ${actionLinkRedirectHost ?? "none present"}`);
      console.log(`Redirect match.............. ${redirectMatches ? "YES" : "NO"}`);

      if (!redirectMatches) {
        console.error(
          "[uat] Recovery link's redirect does not resolve to PREVIEW_URL - refusing to open a " +
            "browser and consume it. This means Supabase's own generateLink response already " +
            "diverges from the requested redirectTo, before any browser is involved.",
        );
        recoveryActionLink = null;
      } else {
        console.log("[uat] Recovery link minted (application flow only - not a real email).");
      }
    } catch (error) {
      console.error(`[uat] Recovery link generation failed: ${error.message}`);
    }
  }
  scorecard.recoveryEmailDelivery = "HUMAN CHECK REQUIRED";

  // --- Step: run the Playwright suite --------------------------------------------
  let playwrightExitCode = 1;
  if (scorecard.userProvisioning === "PASS" && recoveryActionLink) {
    const childEnv = {
      ...process.env,
      PREVIEW_URL: previewUrl,
      UAT_OWNER_EMAIL: ownerEmail,
      UAT_OWNER_PASSWORD: ownerPassword,
      UAT_DISPOSABLE_EMAIL: disposableEmail,
      UAT_DISPOSABLE_PASSWORD: disposablePassword,
      UAT_DISPOSABLE_ROLE: disposableRole,
      UAT_RECOVERY_NEW_PASSWORD: recoveryNewPassword,
      UAT_RECOVERY_ACTION_LINK: recoveryActionLink,
      UAT_CLIENT_REF_OUTPUT_PATH: path.join(REPORT_DIR, "captured-client-ref.json"),
      UAT_RUN_TAG: runTag,
    };

    playwrightExitCode = await runPlaywright({ env: childEnv });
  } else {
    console.error("[uat] Skipping Playwright run: provisioning or recovery-link setup failed.");
  }

  const playwrightOutcomes = await parsePlaywrightResults();
  for (const [title, key] of Object.entries(TEST_TITLE_TO_SCORECARD_KEY)) {
    scorecard[key] = playwrightOutcomes[title] ?? "FAIL";
  }
  // "Persistence (fresh context)" also creates and confirms the pending finance
  // record - it stands in for the "Finance pending" scorecard row.
  scorecard.financePending = scorecard.persistenceAndFinancePending;

  // --- Env ref match: derived server ref vs the ref Playwright captured live -----
  let clientRef = null;
  if (scorecard.envRefCapture === "PASS") {
    try {
      const captured = JSON.parse(
        await readFile(path.join(REPORT_DIR, "captured-client-ref.json"), "utf8"),
      );
      clientRef = captured.clientRef ?? null;
    } catch (error) {
      console.error(`[uat] Could not read the captured client ref: ${error.message}`);
    }
  }
  const refsMatch = Boolean(clientRef) && clientRef === serverRef;
  scorecard.envRefs = clientRef ? (refsMatch ? "PASS" : "FAIL") : "FAIL";

  console.log("\n=== Environment project ref ===");
  console.log(`Server ref (from SUPABASE_URL)....... ${serverRef}`);
  console.log(`Client ref (captured from Preview).... ${clientRef ?? "not captured"}`);
  console.log(`MATCH................................. ${clientRef ? (refsMatch ? "YES" : "NO") : "UNKNOWN"}`);

  // --- Step: cleanup + residue verification (best-effort, always attempted) ------
  // Tracked separately from "did the finance-cleanup UI test run/pass" - a UAT
  // record is only ever created starting at the Persistence step, so if that step
  // (or anything before it) never ran, there is nothing for that test to clean up
  // and reporting a bare FAIL there would be misleading.
  let disposableUserCleanupOk = true;
  let residueClean = true;
  const financeRecordWasEverCreated = scorecard.persistenceAndFinancePending === "PASS";

  try {
    const deleteResult = await cleanupDisposableUser({ supabase, ownerEmail, email: disposableEmail });
    if (!deleteResult.ok) {
      disposableUserCleanupOk = false;
      console.error(`[uat] Disposable user cleanup failed: ${deleteResult.error}`);
    } else {
      console.log("[uat] Disposable user removed.");
    }
  } catch (error) {
    disposableUserCleanupOk = false;
    console.error(`[uat] Disposable user cleanup threw: ${error.message}`);
  }

  try {
    const workspaceKey = resolveServerWorkspaceKey();
    const { data: row, error } = await supabase
      .from("workspace_snapshots")
      .select("snapshot")
      .eq("workspace_key", workspaceKey)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const residualTransactions = (row?.snapshot?.financeTransactions ?? []).filter(
      (record) =>
        String(record.toLocation ?? "").includes(runTag) ||
        String(record.route ?? "").includes(runTag) ||
        String(record.description ?? "").includes(runTag),
    );

    if (residualTransactions.length > 0) {
      residueClean = false;
      console.error(
        `[uat] RESIDUE DETECTED: ${residualTransactions.length} finance record(s) tagged ` +
          `"${runTag}" still exist in the live workspace and were NOT auto-removed by this ` +
          `script (only the app's own delete lifecycle is used, and it was not re-run here). ` +
          `Record id(s): ${residualTransactions.map((r) => r.id).join(", ")}. Manual review required.`,
      );
    }
  } catch (error) {
    residueClean = false;
    console.error(`[uat] Residue verification could not run: ${error.message}`);
  }

  if (!disposableUserCleanupOk || !residueClean) {
    scorecard.cleanup = "FAIL";
  } else if (!financeRecordWasEverCreated) {
    scorecard.cleanup = "NOT REQUIRED";
  } else {
    scorecard.cleanup = scorecard.financeCleanup === "PASS" ? "PASS" : "FAIL";
  }

  // --- Step: Finance banked leg (gated) ------------------------------------------
  // Note: the env-ref check above only proves internal consistency of whichever
  // Supabase project SUPABASE_URL/PREVIEW_URL point at in this run - it says
  // nothing about whether that project is the same one Production uses. There is
  // currently no automated way to prove workspace isolation from Production, so
  // this leg stays blocked regardless of the flag until that changes.
  const isolationProofClaimed =
    process.env.UAT_WORKSPACE_ISOLATION_PROOF === "CONFIRMED_ISOLATED_FROM_PRODUCTION";

  if (!ALLOW_BANKED_LEG) {
    scorecard.financeBanked = "BLOCKED — shared live workspace";
  } else if (!isolationProofClaimed) {
    scorecard.financeBanked = "BLOCKED — isolation not confirmed (UAT_WORKSPACE_ISOLATION_PROOF unset)";
  } else {
    scorecard.financeBanked =
      "BLOCKED — banked-leg automation not implemented yet (no automated way to verify isolation from Production; requires a confirmed isolated workspace to build safely against)";
  }

  // --- Report ----------------------------------------------------------------
  const timestamp = new Date().toISOString();
  const reportPath = path.join(REPORT_DIR, `preview-uat-${timestamp.replace(/[:.]/g, "-")}.json`);

  const allAutomatedRequiredPass =
    [
      "envRefs",
      "ownerLogin",
      "userProvisioning",
      "newUserLogin",
      "recoveryApplication",
      "persistenceAndFinancePending",
      "financeCounted",
      "financeVerified",
    ].every((key) => scorecard[key] === "PASS") &&
    ["PASS", "NOT REQUIRED"].includes(scorecard.cleanup);

  const finalLine = "BLOCKED FOR FULL RELEASE GATE";

  console.log("\n=== Preview Release Gate ===");
  for (const [key, label] of SCORECARD_ORDER) {
    const value = scorecard[key] ?? "FAIL";
    console.log(`${label.padEnd(24, ".")} ${value}`);
  }
  console.log(`\nFINAL: ${finalLine}`);
  console.log(
    scorecard.financeBanked.startsWith("BLOCKED")
      ? "(Finance banked/lockDeposit was intentionally not exercised - see reason above. " +
          "This gate cannot report READY until that leg is tested in a confirmed isolated workspace.)"
      : "",
  );

  await writeFile(
    reportPath,
    JSON.stringify(
      {
        timestamp,
        runTag,
        previewUrl,
        allowBankedLegFlag: ALLOW_BANKED_LEG,
        automatedChecksAllPassed: allAutomatedRequiredPass,
        final: finalLine,
        scorecard,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n[uat] Report written to ${path.relative(REPO_ROOT, reportPath)}`);

  process.exit(allAutomatedRequiredPass ? 0 : 1);
};

main().catch((error) => {
  console.error(`[uat] Fatal: ${error.message}`);
  process.exit(1);
});
