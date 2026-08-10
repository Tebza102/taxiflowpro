import crypto from "node:crypto";
import {
  createServiceClient,
  createUser,
  deleteUser,
} from "../api/_lib/userLifecycle.js";

// TEMPORARY, self-removing account-persistence proof. Runs automatically as an npm
// postbuild hook so it executes inside Vercel's build container, which has the same
// real (Sensitive) SUPABASE_* env vars as the deployed runtime - unlike this
// developer's local machine, which cannot read them via `vercel env pull`.
//
// Hard-gated to Preview + this exact branch. Never runs locally (no VERCEL_ENV) and
// never runs for Production. Always exits 0 - a self-test failure must never break
// the actual deployment.
//
// Explicitly authorized for exactly this disposable test-account use. This file and
// its postbuild hook in package.json are removed once the proof result is read.

const log = (...args) => console.log("[preview-selftest]", ...args);

const finish = (passed) => {
  log(passed ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(0);
};

const isTargetEnvironment =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "agent/owner-first-auth-reset";

if (!isTargetEnvironment) {
  log(
    `skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, VERCEL_GIT_COMMIT_REF=${process.env.VERCEL_GIT_COMMIT_REF ?? "unset"})`,
  );
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_KEY = process.env.SUPABASE_WORKSPACE_KEY || "taxiflow-live";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  log("skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in this build.");
  process.exit(0);
}

const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const freshReadAuth = async (email) => {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Auth list failed: ${error.message}`);
  return (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
};

const freshReadAppUser = async (email) => {
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();
  if (error) throw new Error(`Workspace read failed: ${error.message}`);
  const appUsers = Array.isArray(data?.snapshot?.appUsers) ? data.snapshot.appUsers : [];
  return appUsers.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
};

const main = async () => {
  const { data: initialRow, error: initialError } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();

  if (initialError) {
    log("FAIL: could not read the workspace snapshot:", initialError.message);
    return finish(false);
  }

  const appUsers = Array.isArray(initialRow?.snapshot?.appUsers) ? initialRow.snapshot.appUsers : [];
  const activeOwners = appUsers.filter((u) => u.role === "Owner" && u.active !== false);

  if (activeOwners.length !== 1) {
    log(`FAIL: expected exactly one unambiguous active Owner, found ${activeOwners.length}.`);
    return finish(false);
  }

  const ownerEmail = activeOwners[0].email;
  const ownerSnapshotBefore = JSON.stringify(activeOwners[0]);
  const testEmail = `taxiflow.persistence.test.${Date.now()}@example.invalid`;
  const testPassword = crypto.randomBytes(24).toString("base64url");

  log(`Owner resolved: ${ownerEmail}`);
  log(`Test identity: ${testEmail}`);

  // --- CREATE, via the real production user lifecycle code ---
  const createResult = await createUser({
    supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: ownerEmail,
    email: testEmail,
    name: "Persistence Selftest",
    role: "Manager",
    password: testPassword,
  });

  if (!createResult.ok) {
    log("FAIL: createUser did not succeed:", createResult.error);
    return finish(false);
  }
  log("createUser: PASS");

  // --- FRESH remote reads (independent network round-trips, no cached objects) ---
  const authAfterCreate = await freshReadAuth(testEmail);
  const appUserAfterCreate = await freshReadAppUser(testEmail);

  const authCreatedOk = Boolean(authAfterCreate) && (authAfterCreate.app_metadata?.role === "Manager");
  const appUsersCreatedOk = Boolean(appUserAfterCreate) && appUserAfterCreate.role === "Manager" && appUserAfterCreate.active !== false;

  log(`Fresh read 1 - Auth exists: ${authCreatedOk ? "PASS" : "FAIL"} (role=${authAfterCreate?.app_metadata?.role ?? "none"})`);
  log(`Fresh read 1 - appUsers exists: ${appUsersCreatedOk ? "PASS" : "FAIL"} (role=${appUserAfterCreate?.role ?? "none"}, active=${appUserAfterCreate?.active})`);

  // --- SECOND fresh read: simulates "logout / reload / come back" ---
  const appUserSecondRead = await freshReadAppUser(testEmail);
  const secondReadOk = Boolean(appUserSecondRead) && appUserSecondRead.role === "Manager";
  log(`Fresh read 2 (second independent query) - still present: ${secondReadOk ? "PASS" : "FAIL"}`);

  const createProofPassed = authCreatedOk && appUsersCreatedOk && secondReadOk;

  // --- CLEANUP, regardless of whether the proof passed, via the real delete path ---
  const deleteResult = await deleteUser({
    supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: ownerEmail,
    email: testEmail,
  });

  log(`deleteUser: ${deleteResult.ok ? "PASS" : "FAIL"}${deleteResult.ok ? "" : ` (${deleteResult.error})`}`);

  const authAfterDelete = await freshReadAuth(testEmail);
  const appUserAfterDelete = await freshReadAppUser(testEmail);
  const authRemovedOk = !authAfterDelete;
  const appUsersRemovedOk = !appUserAfterDelete;

  log(`Final fresh read - Auth removed: ${authRemovedOk ? "PASS" : "FAIL"}`);
  log(`Final fresh read - appUsers removed: ${appUsersRemovedOk ? "PASS" : "FAIL"}`);

  const { data: finalRow, error: finalError } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();

  const ownerAfter = (Array.isArray(finalRow?.snapshot?.appUsers) ? finalRow.snapshot.appUsers : []).find(
    (u) => (u.email ?? "").toLowerCase() === ownerEmail.toLowerCase(),
  );
  const ownerPreservedOk = !finalError && ownerAfter && JSON.stringify(ownerAfter) === ownerSnapshotBefore;
  log(`Owner unchanged: ${ownerPreservedOk ? "PASS" : "FAIL"}`);

  const cleanupOk = deleteResult.ok && authRemovedOk && appUsersRemovedOk && ownerPreservedOk;

  return finish(createProofPassed && cleanupOk);
};

main().catch((error) => {
  log("FAIL: unexpected error:", error?.message ?? error);
  finish(false);
});
