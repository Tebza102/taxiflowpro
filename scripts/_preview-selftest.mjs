import { createServiceClient } from "../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

// TEMPORARY, Preview-only, read-only inventory. Single combined pass: full Auth
// user list, full appUsers list, and the cross-reference (Auth-only, appUsers-only,
// role mismatches, inactive) needed to decide what (if anything) is safe to
// reconcile. No writes.
//
// Hard-gated to Preview + this exact branch. Always exits 0. Temporary - removed
// once the result is read from the build log.

const log = (...args) => console.log("[preview-inventory]", ...args);

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

const main = async () => {
  const authUsers = await listAllAuthUsers();
  const { data: row, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();

  if (error) {
    log(`FAIL: workspace read error: ${error.message}`);
    process.exit(0);
  }

  const appUsers = Array.isArray(row?.snapshot?.appUsers) ? row.snapshot.appUsers : [];
  const authByEmail = new Map(authUsers.map((u) => [(u.email ?? "").toLowerCase(), u]));
  const appUserByEmail = new Map(appUsers.map((u) => [(u.email ?? "").toLowerCase(), u]));

  log(`Auth users total: ${authUsers.length}`);
  log(`appUsers total: ${appUsers.length}`);

  log("=== ALL AUTH USERS ===");
  for (const u of authUsers) {
    const email = (u.email ?? "").toLowerCase();
    const authRole = u.app_metadata?.role ?? u.user_metadata?.role ?? null;
    const inAppUsers = appUserByEmail.has(email);
    const appUser = appUserByEmail.get(email);
    log(
      JSON.stringify({
        email,
        authId: u.id,
        authRole,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at,
        inAppUsers,
        appUsersRole: appUser?.role ?? null,
        appUsersActive: appUser ? appUser.active !== false : null,
        actorIdAligned: appUser ? appUser.actorId === u.id : null,
        roleMismatch: inAppUsers && appUser?.role !== authRole,
      }),
    );
  }

  log("=== APPUSERS WITH NO MATCHING AUTH USER ===");
  for (const u of appUsers) {
    const email = (u.email ?? "").toLowerCase();
    if (!authByEmail.has(email)) {
      log(JSON.stringify({ email, role: u.role, actorId: u.actorId, active: u.active !== false }));
    }
  }

  const authOnlyCount = authUsers.filter((u) => !appUserByEmail.has((u.email ?? "").toLowerCase())).length;
  const appUsersOnlyCount = appUsers.filter((u) => !authByEmail.has((u.email ?? "").toLowerCase())).length;
  const inactiveCount = appUsers.filter((u) => u.active === false).length;
  const roleMismatchCount = appUsers.filter((u) => {
    const auth = authByEmail.get((u.email ?? "").toLowerCase());
    return auth && (auth.app_metadata?.role ?? auth.user_metadata?.role) !== u.role;
  }).length;

  log("=== SUMMARY ===");
  log(
    JSON.stringify({
      authOnlyCount,
      appUsersOnlyCount,
      inactiveCount,
      roleMismatchCount,
    }),
  );
  log("INVENTORY COMPLETE");
};

main()
  .catch((error) => log("INVENTORY FAILED:", error?.message ?? error))
  .finally(() => process.exit(0));
