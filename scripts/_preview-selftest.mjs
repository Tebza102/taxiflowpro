import crypto from "node:crypto";
import {
  createServiceClient,
  createUser,
  deleteUser,
} from "../api/_lib/userLifecycle.js";

// TEMPORARY, Preview-only, two-part script:
//   1. Targeted repair: if the real Auth Owner is missing (or inactive) in
//      workspace_snapshots.snapshot.appUsers, add/reactivate exactly that one
//      record. Everything else in the snapshot is preserved untouched. This is
//      NOT a reset - it never touches appUsers entries other than the Owner's.
//   2. Immediately re-runs the previously authorized disposable account
//      persistence proof using the real api/_lib/userLifecycle.js functions.
//
// Hard-gated to Preview + this exact branch; no-ops everywhere else, including
// Production. Always exits 0 so it can never break the actual deployment.
// Temporary - removed once the result is read from the build log.

const log = (...args) => console.log("[preview-selftest]", ...args);

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

const readWorkspaceRow = async () => {
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();
  if (error) throw new Error(`Workspace read failed: ${error.message}`);
  return data;
};

const freshReadAuth = async (email) => {
  const users = await listAllAuthUsers();
  return users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
};

const freshReadAppUser = async (email) => {
  const row = await readWorkspaceRow();
  const appUsers = Array.isArray(row?.snapshot?.appUsers) ? row.snapshot.appUsers : [];
  return appUsers.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
};

// ---------- STEP 1: targeted Owner membership repair ----------
const repairOwnerMembership = async () => {
  const authUsers = await listAllAuthUsers();
  const authOwners = authUsers.filter(
    (u) => u.app_metadata?.role === "Owner" || u.user_metadata?.role === "Owner",
  );

  if (authOwners.length !== 1) {
    log(`STOP: expected exactly one Auth Owner, found ${authOwners.length}.`);
    return { ok: false };
  }

  const owner = authOwners[0];
  const ownerEmail = (owner.email ?? "").toLowerCase();
  log(`Auth Owner resolved: ${ownerEmail}`);

  const row = await readWorkspaceRow();
  const snapshot = row?.snapshot ?? null;

  if (!snapshot) {
    log("STOP: no workspace_snapshots row found for this workspace_key; refusing to fabricate one.");
    return { ok: false };
  }

  const appUsers = Array.isArray(snapshot.appUsers) ? snapshot.appUsers : [];
  const existing = appUsers.find((u) => (u.email ?? "").toLowerCase() === ownerEmail);

  if (existing && existing.active !== false) {
    log("appUsers Owner record already present and active; no repair needed.");
    return { ok: true, ownerEmail };
  }

  const ownerRecord = existing
    ? { ...existing, role: "Owner", active: true }
    : {
        id: ownerEmail,
        email: ownerEmail,
        name: owner.user_metadata?.name ?? owner.user_metadata?.full_name ?? ownerEmail,
        role: "Owner",
        actorId: owner.id,
        staffId: null,
        active: true,
        moduleAccess: { overview: true, finance: true, fleet: true, drivers: true, settings: true },
      };

  const nextAppUsers = existing
    ? appUsers.map((u) => ((u.email ?? "").toLowerCase() === ownerEmail ? ownerRecord : u))
    : [...appUsers, ownerRecord];

  const { error: writeError } = await supabase
    .from("workspace_snapshots")
    .update({ snapshot: { ...snapshot, appUsers: nextAppUsers }, updated_at: new Date().toISOString() })
    .eq("workspace_key", WORKSPACE_KEY);

  if (writeError) {
    log(`STOP: failed to write Owner repair: ${writeError.message}`);
    return { ok: false };
  }

  const verify = await freshReadAppUser(ownerEmail);
  const verifyOk = Boolean(verify) && verify.role === "Owner" && verify.active === true;
  log(`Owner repair verified (fresh read): ${verifyOk ? "PASS" : "FAIL"}`);
  return { ok: verifyOk, ownerEmail };
};

// ---------- STEP 2: disposable account persistence proof ----------
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
    log("createUser: FAIL", createResult.error);
    return false;
  }
  log("createUser: PASS");

  const authAfterCreate = await freshReadAuth(testEmail);
  const appUserAfterCreate = await freshReadAppUser(testEmail);
  const authCreatedOk = Boolean(authAfterCreate) && authAfterCreate.app_metadata?.role === "Manager";
  const appUsersCreatedOk = Boolean(appUserAfterCreate) && appUserAfterCreate.role === "Manager" && appUserAfterCreate.active !== false;
  log(`Fresh read 1 - Auth: ${authCreatedOk ? "PASS" : "FAIL"}, appUsers: ${appUsersCreatedOk ? "PASS" : "FAIL"}`);

  const appUserSecondRead = await freshReadAppUser(testEmail);
  const secondReadOk = Boolean(appUserSecondRead) && appUserSecondRead.role === "Manager";
  log(`Fresh read 2: ${secondReadOk ? "PASS" : "FAIL"}`);

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
  log(`Final read - Auth removed: ${authRemovedOk ? "PASS" : "FAIL"}, appUsers removed: ${appUsersRemovedOk ? "PASS" : "FAIL"}`);

  const ownerAfter = await freshReadAppUser(ownerEmail);
  const ownerPreservedOk = Boolean(ownerAfter) && ownerAfter.role === "Owner" && ownerAfter.active === true;
  log(`Owner preserved: ${ownerPreservedOk ? "PASS" : "FAIL"}`);

  return authCreatedOk && appUsersCreatedOk && secondReadOk && deleteResult.ok && authRemovedOk && appUsersRemovedOk && ownerPreservedOk;
};

const main = async () => {
  const repair = await repairOwnerMembership();
  if (!repair.ok) {
    log("RESULT: FAIL (Owner membership repair did not succeed)");
    return;
  }

  const passed = await runPersistenceProof(repair.ownerEmail);
  log(passed ? "RESULT: PASS" : "RESULT: FAIL");
};

main()
  .catch((error) => log("RESULT: FAIL (unexpected error):", error?.message ?? error))
  .finally(() => process.exit(0));
