import { createClient } from "@supabase/supabase-js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

// Repairs divergence between Supabase Auth and workspace_snapshots.snapshot.appUsers
// for LEGITIMATE existing Auth identities that are missing (or inactive) in the
// account directory. It never creates, deletes, or modifies a Supabase Auth user -
// Auth is treated as the source of truth for "who legitimately has an account", and
// this script only ever adds or repairs the matching appUsers membership record.
//
// Safety:
// - Dry run by default. Pass --confirm to actually write.
// - Never creates a duplicate Auth user (it never creates Auth users at all).
// - Never demotes or removes the Owner. An existing Owner appUsers record is left
//   untouched; a missing Owner is added back with role "Owner", never anything else.
// - Idempotent: an already-repaired account produces no diff on a second run.
// - Never prints Auth tokens, passwords, or the service-role key.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_KEY = resolveServerWorkspaceKey();
const CONFIRM = process.argv.includes("--confirm");

const VALID_ROLES = ["Owner", "Admin", "Manager", "Driver", "Viewer"];
const DEMO_EMAIL_SUFFIX = "@taxiflow.local";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");
  console.error("This script does not read or write any secret file - export them in your shell.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

const listAllAuthUsers = async () => {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Failed to list Auth users: ${error.message}`);
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }
  return users;
};

const buildDefaultModuleAccess = (role) => {
  const keys = ["overview", "finance", "fleet", "drivers", "settings"];
  if (role === "Owner") return Object.fromEntries(keys.map((k) => [k, true]));
  if (role === "Viewer") return Object.fromEntries(keys.map((k) => [k, k === "overview"]));
  if (role === "Admin" || role === "Manager") {
    return Object.fromEntries(keys.map((k) => [k, k !== "overview" ? true : true]));
  }
  return Object.fromEntries(keys.map((k) => [k, k === "overview" || k === "fleet" || k === "drivers"]));
};

const main = async () => {
  const authUsers = await listAllAuthUsers();

  const { data: workspaceRow, error: workspaceError } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", WORKSPACE_KEY)
    .maybeSingle();

  if (workspaceError) {
    throw new Error(`Failed to read workspace_snapshots: ${workspaceError.message}`);
  }

  const snapshot = workspaceRow?.snapshot ?? null;

  if (!snapshot) {
    console.log(`No workspace_snapshots row found for workspace_key="${WORKSPACE_KEY}". Nothing to reconcile.`);
    return;
  }

  const appUsers = Array.isArray(snapshot.appUsers) ? snapshot.appUsers : [];
  const appUsersByEmail = new Map(appUsers.map((u) => [normalizeEmail(u.email), u]));

  const additions = [];
  const reactivations = [];
  const skippedNoRole = [];
  const skippedDemoEmail = [];

  for (const authUser of authUsers) {
    const email = normalizeEmail(authUser.email);
    if (!email) continue;

    if (email.endsWith(DEMO_EMAIL_SUFFIX)) {
      skippedDemoEmail.push(email);
      continue;
    }

    const role = authUser.app_metadata?.role ?? authUser.user_metadata?.role ?? null;

    if (!role || !VALID_ROLES.includes(role)) {
      skippedNoRole.push({ email, role });
      continue;
    }

    const existing = appUsersByEmail.get(email);

    if (!existing) {
      additions.push({
        id: email,
        email,
        name: String(authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? email).trim(),
        role,
        actorId: authUser.id,
        staffId: null,
        active: true,
        moduleAccess: buildDefaultModuleAccess(role),
        createdAt: new Date().toISOString(),
        createdBy: "reconcile-production-users-script",
        createdByRole: "Developer",
      });
      continue;
    }

    if (existing.active === false) {
      reactivations.push({ email, previousRole: existing.role, authRole: role });
    }
  }

  console.log("=== RECONCILIATION PLAN ===");
  console.log(`Workspace: ${WORKSPACE_KEY}`);
  console.log(`Auth users total: ${authUsers.length}`);
  console.log(`appUsers total (before): ${appUsers.length}`);
  console.log("");
  console.log(`Accounts to ADD (Auth-only, legitimate, missing from directory): ${additions.length}`);
  for (const a of additions) {
    console.log(`  + ${a.email}  role=${a.role}  actorId=${a.actorId}`);
  }
  console.log("");
  console.log(`Accounts to REACTIVATE (present but marked inactive): ${reactivations.length}`);
  for (const r of reactivations) {
    console.log(`  ~ ${r.email}  role=${r.previousRole}`);
  }
  console.log("");
  console.log(`Auth users skipped (no recognised role metadata): ${skippedNoRole.length}`);
  for (const s of skippedNoRole) {
    console.log(`  ? ${s.email}  role=${s.role ?? "none"}`);
  }
  console.log("");
  console.log(`Auth users skipped (@taxiflow.local demo accounts, never reconciled into production): ${skippedDemoEmail.length}`);

  if (additions.length === 0 && reactivations.length === 0) {
    console.log("");
    console.log("Nothing to do - Auth and the account directory are already aligned.");
    return;
  }

  if (!CONFIRM) {
    console.log("");
    console.log("DRY RUN ONLY - no changes were made. Re-run with --confirm to apply this exact plan.");
    return;
  }

  const nextAppUsers = [...appUsers];
  for (const addition of additions) {
    nextAppUsers.push(addition);
  }
  for (const reactivation of reactivations) {
    const idx = nextAppUsers.findIndex((u) => normalizeEmail(u.email) === reactivation.email);
    if (idx !== -1) {
      nextAppUsers[idx] = { ...nextAppUsers[idx], active: true };
    }
  }

  const { error: writeError } = await supabase
    .from("workspace_snapshots")
    .update({
      snapshot: { ...snapshot, appUsers: nextAppUsers },
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_key", WORKSPACE_KEY);

  if (writeError) {
    throw new Error(`Failed to write reconciled snapshot: ${writeError.message}`);
  }

  console.log("");
  console.log(`Applied: added ${additions.length}, reactivated ${reactivations.length}.`);
  console.log("No Auth users were created, deleted, or modified. No passwords were read or written.");
};

main().catch((error) => {
  console.error("RECONCILIATION FAILED:", error.message);
  process.exit(1);
});
