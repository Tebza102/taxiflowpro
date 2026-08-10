import crypto from "node:crypto";
import {
  createServiceClient,
  createUser,
  deleteUser,
} from "../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

// TEMPORARY, Preview-only. Two parts:
//   Phase 7: verify the workspace foundation (project match, key match now that the
//   split-brain fix is in place, canonical row exists, Owner present in both Auth
//   and appUsers with a matching actorId).
//   Phase 8: if and only if the foundation verifies, run the disposable Manager
//   account persistence test exactly once via the real userLifecycle.js functions.
//
// Hard-gated to Preview + this exact branch. Always exits 0. Temporary - removed
// once the result is read from the build log.

const log = (...args) => console.log("[preview-selftest]", ...args);

const isTargetEnvironment =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "agent/owner-first-auth-reset";

if (!isTargetEnvironment) {
  log(`skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, VERCEL_GIT_COMMIT_REF=${process.env.VERCEL_GIT_COMMIT_REF ?? "unset"})`);
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  log("skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in this build.");
  process.exit(0);
}

const projectRefOf = (url) => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
};

const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const WORKSPACE_KEY = resolveServerWorkspaceKey();

const listAllAuthUsers = async () => {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Auth list failed: ${error.message}`);
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }
  return users;
};

const freshReadAuth = async (email) => {
  const users = await listAllAuthUsers();
  return users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
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

// ---------- PHASE 7: verify foundation ----------
const verifyFoundation = async () => {
  const serverRef = projectRefOf(SUPABASE_URL);
  const frontendRef = projectRefOf(VITE_SUPABASE_URL);
  const projectMatch = Boolean(serverRef && frontendRef && serverRef === frontendRef);
  log(`PROJECT_MATCH: ${projectMatch ? "YES" : "NO"}`);

  const keyMatch = WORKSPACE_KEY === "taxiflow-live";
  log(`SERVER_WORKSPACE_KEY resolves to canonical: ${keyMatch ? "YES" : "NO"} (${WORKSPACE_KEY})`);

  const { data: row, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();

  if (error) {
    log(`FAIL: workspace read error: ${error.message}`);
    return { ok: false };
  }

  if (!row) {
    log("FAIL: canonical workspace row still does not exist.");
    return { ok: false };
  }

  const appUsers = Array.isArray(row.snapshot?.appUsers) ? row.snapshot.appUsers : [];
  const activeOwners = appUsers.filter((u) => u.role === "Owner" && u.active !== false);

  if (activeOwners.length !== 1) {
    log(`FAIL: expected exactly one active appUsers Owner, found ${activeOwners.length}.`);
    return { ok: false };
  }

  const ownerAppUser = activeOwners[0];
  const ownerAuth = await freshReadAuth(ownerAppUser.email);

  if (!ownerAuth) {
    log(`FAIL: Owner ${ownerAppUser.email} not found in Supabase Auth on fresh read.`);
    return { ok: false };
  }

  const actorIdAligned = ownerAppUser.actorId === ownerAuth.id;
  log(`Owner in Auth: YES (${ownerAuth.email})`);
  log(`Owner in appUsers: YES (role=${ownerAppUser.role}, active=${ownerAppUser.active})`);
  log(`Owner actorId aligned with Auth id: ${actorIdAligned ? "YES" : "NO"}`);

  const foundationOk = projectMatch && keyMatch && actorIdAligned;
  log(`FOUNDATION: ${foundationOk ? "VERIFIED" : "NOT VERIFIED"}`);
  return { ok: foundationOk, ownerEmail: ownerAppUser.email };
};

// ---------- PHASE 8: run the account persistence test exactly once ----------
const runPersistenceProof = async (ownerEmail) => {
  const testEmail = `taxiflow.persistence.test.${Date.now()}@example.invalid`;
  const testPassword = crypto.randomBytes(24).toString("base64url");
  log(`Test identity: ${testEmail}`);

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
    log("Auth create: FAIL", createResult.error);
    log("appUsers create: FAIL (not reached)");
    return false;
  }
  log("Auth create: PASS");

  const authAfterCreate = await freshReadAuth(testEmail);
  const appUserAfterCreate = await freshReadAppUser(testEmail);
  const appUsersCreatedOk = Boolean(appUserAfterCreate) && appUserAfterCreate.role === "Manager";
  log(`appUsers create: ${appUsersCreatedOk ? "PASS" : "FAIL"}`);
  log(`Fresh read 1: ${Boolean(authAfterCreate) && appUsersCreatedOk ? "PASS" : "FAIL"}`);

  const appUserSecondRead = await freshReadAppUser(testEmail);
  const secondReadOk = Boolean(appUserSecondRead) && appUserSecondRead.role === "Manager";
  log(`Fresh read 2: ${secondReadOk ? "PASS" : "FAIL"}`);

  const deleteResult = await deleteUser({
    supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: ownerEmail,
    email: testEmail,
  });
  log(`Cleanup Auth: ${deleteResult.ok ? "PASS" : "FAIL"}${deleteResult.ok ? "" : ` (${deleteResult.error})`}`);

  const authAfterDelete = await freshReadAuth(testEmail);
  const appUserAfterDelete = await freshReadAppUser(testEmail);
  log(`Cleanup appUsers: ${!appUserAfterDelete ? "PASS" : "FAIL"}`);
  log(`Final Auth removed check: ${!authAfterDelete ? "PASS" : "FAIL"}`);

  const ownerAfter = await freshReadAppUser(ownerEmail);
  const ownerPreservedOk = Boolean(ownerAfter) && ownerAfter.role === "Owner" && ownerAfter.active !== false;
  log(`Owner preserved: ${ownerPreservedOk ? "PASS" : "FAIL"}`);

  return (
    createResult.ok &&
    appUsersCreatedOk &&
    secondReadOk &&
    deleteResult.ok &&
    !authAfterDelete &&
    !appUserAfterDelete &&
    ownerPreservedOk
  );
};

const main = async () => {
  const foundation = await verifyFoundation();
  if (!foundation.ok) {
    log("RESULT: FAIL (foundation not verified; account test not attempted)");
    return;
  }

  const passed = await runPersistenceProof(foundation.ownerEmail);
  log(passed ? "RESULT: PASS" : "RESULT: FAIL");
};

main()
  .catch((error) => log("RESULT: FAIL (unexpected error):", error?.message ?? error))
  .finally(() => process.exit(0));
