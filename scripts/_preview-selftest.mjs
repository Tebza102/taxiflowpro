import { createServiceClient, buildDefaultModuleAccess, isDemoSeedEmail } from "../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

// TEMPORARY, Preview-only. Explicitly authorized, narrowly-scoped reconciliation of
// EXACTLY two known legitimate Auth-only accounts (taxiadmin@apprigate.com,
// taximanager@apprigate.com) into workspace_snapshots["taxiflow-live"].appUsers.
// Dry run first; only writes if the dry-run plan matches exactly what was
// authorized. Never touches Owner, never creates/deletes Auth users, never changes
// roles, never touches any other appUsers record or any other snapshot data.
//
// Hard-gated to Preview + this exact branch. Always exits 0. Temporary - removed
// once the result is read from the build log.

const log = (...args) => console.log("[reconcile]", ...args);

const AUTHORIZED_EMAILS = new Set(["taxiadmin@apprigate.com", "taximanager@apprigate.com"]);
const RECOGNISED_ROLES = ["Owner", "Admin", "Manager", "Driver", "Viewer"];

const isTargetEnvironment =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "agent/owner-first-auth-reset";

if (!isTargetEnvironment) {
  log(`skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, VERCEL_GIT_COMMIT_REF=${process.env.VERCEL_GIT_COMMIT_REF ?? "unset"})`);
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  log("skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in this build.");
  process.exit(0);
}

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

const readRow = async () => {
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();
  if (error) throw new Error(`Workspace read failed: ${error.message}`);
  return data;
};

const main = async () => {
  const authUsers = await listAllAuthUsers();
  const row = await readRow();
  const appUsers = Array.isArray(row?.snapshot?.appUsers) ? row.snapshot.appUsers : [];
  const appUserByEmail = new Map(appUsers.map((u) => [(u.email ?? "").toLowerCase(), u]));
  const authByEmail = new Map(authUsers.map((u) => [(u.email ?? "").toLowerCase(), u]));

  // ---------- DRY RUN PLAN ----------
  const additions = [];
  const unexpectedAdditions = [];
  for (const u of authUsers) {
    const email = (u.email ?? "").toLowerCase();
    if (appUserByEmail.has(email)) continue;
    if (isDemoSeedEmail(email)) continue;
    const role = u.app_metadata?.role ?? u.user_metadata?.role ?? null;
    if (!role || !RECOGNISED_ROLES.includes(role)) continue;

    if (AUTHORIZED_EMAILS.has(email)) {
      additions.push({ authUser: u, email, role });
    } else {
      unexpectedAdditions.push(email);
    }
  }

  const roleMismatches = appUsers.filter((u) => {
    const auth = authByEmail.get((u.email ?? "").toLowerCase());
    return auth && (auth.app_metadata?.role ?? auth.user_metadata?.role) !== u.role;
  }).length;

  const appUsersOnlyRemovals = appUsers.filter((u) => !authByEmail.has((u.email ?? "").toLowerCase())).length;

  log("=== DRY RUN ===");
  log(`additions planned: ${additions.length} (${additions.map((a) => `${a.email}:${a.role}`).join(", ")})`);
  log(`unexpected additions: ${unexpectedAdditions.length} (${unexpectedAdditions.join(", ")})`);
  log(`role mismatches: ${roleMismatches}`);
  log(`appUsers-only removals: ${appUsersOnlyRemovals}`);

  const dryRunExact =
    additions.length === 2 &&
    additions.every((a) => AUTHORIZED_EMAILS.has(a.email)) &&
    unexpectedAdditions.length === 0 &&
    roleMismatches === 0 &&
    appUsersOnlyRemovals === 0;

  if (!dryRunExact) {
    log("DRY RUN DID NOT MATCH THE AUTHORIZED PLAN EXACTLY. Not writing anything.");
    log("RESULT: FAIL (dry run mismatch, no write attempted)");
    return;
  }

  log("Dry run matches the authorized plan exactly. Proceeding with --confirm.");

  // ---------- WRITE (exactly the two authorized records) ----------
  const newRecords = additions.map(({ authUser, email, role }) => ({
    id: email,
    email,
    name: authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? email,
    role,
    actorId: authUser.id,
    staffId: null,
    active: true,
    moduleAccess: buildDefaultModuleAccess(role),
  }));

  const { error: writeError } = await supabase
    .from("workspace_snapshots")
    .update({
      snapshot: { ...(row?.snapshot ?? {}), appUsers: [...appUsers, ...newRecords] },
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_key", WORKSPACE_KEY);

  if (writeError) {
    log(`WRITE FAILED: ${writeError.message}`);
    log("RESULT: FAIL");
    return;
  }

  // ---------- ONE FRESH VERIFY ----------
  const freshAuthUsers = await listAllAuthUsers();
  const freshRow = await readRow();
  const freshAppUsers = Array.isArray(freshRow?.snapshot?.appUsers) ? freshRow.snapshot.appUsers : [];
  const freshAppUserByEmail = new Map(freshAppUsers.map((u) => [(u.email ?? "").toLowerCase(), u]));
  const freshAuthByEmail = new Map(freshAuthUsers.map((u) => [(u.email ?? "").toLowerCase(), u]));

  log("=== FRESH VERIFY ===");
  for (const email of ["owner@apprigate.com", "taxiadmin@apprigate.com", "taximanager@apprigate.com"]) {
    const auth = freshAuthByEmail.get(email);
    const appUser = freshAppUserByEmail.get(email);
    log(
      JSON.stringify({
        email,
        authExists: Boolean(auth),
        appUsersExists: Boolean(appUser),
        role: appUser?.role ?? null,
        actorIdAligned: Boolean(auth && appUser && appUser.actorId === auth.id),
      }),
    );
  }

  const finalAuthOnly = freshAuthUsers.filter((u) => {
    const email = (u.email ?? "").toLowerCase();
    const role = u.app_metadata?.role ?? u.user_metadata?.role ?? null;
    return role && RECOGNISED_ROLES.includes(role) && !isDemoSeedEmail(email) && !freshAppUserByEmail.has(email);
  }).length;
  const finalAppUsersOnly = freshAppUsers.filter((u) => !freshAuthByEmail.has((u.email ?? "").toLowerCase())).length;
  const finalRoleMismatch = freshAppUsers.filter((u) => {
    const auth = freshAuthByEmail.get((u.email ?? "").toLowerCase());
    return auth && (auth.app_metadata?.role ?? auth.user_metadata?.role) !== u.role;
  }).length;

  log(`appUsers total: ${freshAppUsers.length}`);
  log(`authOnlyCount: ${finalAuthOnly}`);
  log(`appUsersOnlyCount: ${finalAppUsersOnly}`);
  log(`roleMismatchCount: ${finalRoleMismatch}`);

  const closed = freshAppUsers.length === 3 && finalAuthOnly === 0 && finalAppUsersOnly === 0 && finalRoleMismatch === 0;
  log(closed ? "RESULT: PASS (RECONCILIATION CLOSED)" : "RESULT: FAIL");
};

main()
  .catch((error) => log("RESULT: FAIL (unexpected error):", error?.message ?? error))
  .finally(() => process.exit(0));
