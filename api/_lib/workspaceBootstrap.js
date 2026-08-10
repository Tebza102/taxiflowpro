import { stripCredentialFields, isDemoSeedEmail, normalizeEmail, buildDefaultModuleAccess } from "./userLifecycle.js";

const RECOGNISED_ROLES = ["Owner", "Admin", "Manager", "Driver", "Viewer"];

const listAllAuthUsers = async (supabase) => {
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

const sanitizeIncomingSnapshot = (snapshot) => {
  const cloned = JSON.parse(JSON.stringify(snapshot ?? {}));
  cloned.appUsers = (Array.isArray(cloned.appUsers) ? cloned.appUsers : [])
    .filter((u) => !isDemoSeedEmail(u?.email))
    .map(stripCredentialFields);
  cloned.drivers = (Array.isArray(cloned.drivers) ? cloned.drivers : []).map(stripCredentialFields);
  return cloned;
};

/**
 * First-time live workspace initialization. Only ever creates the canonical
 * workspace row if it does not already exist - never overwrites an existing row.
 * appUsers is rebuilt from legitimate Supabase Auth identities (never fabricated,
 * never duplicated); every other part of the incoming snapshot (finance, fleet,
 * drivers, audit trail, etc.) is preserved as-is, just sanitized of credential
 * fields and @taxiflow.local demo accounts.
 */
export const bootstrapWorkspace = async ({ supabase, workspaceKey, requesterEmail, clientSnapshot }) => {
  const authUsers = await listAllAuthUsers(supabase);
  const requester = authUsers.find((u) => normalizeEmail(u.email) === normalizeEmail(requesterEmail));
  const requesterRole = requester?.app_metadata?.role ?? requester?.user_metadata?.role ?? null;

  if (requesterRole !== "Owner") {
    return { ok: false, status: 403, error: "Only an Owner Supabase Auth identity can bootstrap the live workspace." };
  }

  const authOwners = authUsers.filter(
    (u) => u.app_metadata?.role === "Owner" || u.user_metadata?.role === "Owner",
  );

  if (authOwners.length !== 1) {
    return {
      ok: false,
      status: 409,
      error: `Expected exactly one Auth Owner to bootstrap from, found ${authOwners.length}.`,
    };
  }

  const owner = authOwners[0];

  const { data: existingRow, error: readError } = await supabase
    .from("workspace_snapshots")
    .select("workspace_key")
    .eq("workspace_key", workspaceKey)
    .maybeSingle();

  if (readError) {
    return { ok: false, status: 502, error: `Failed to check for an existing workspace: ${readError.message}` };
  }

  if (existingRow) {
    return { ok: true, alreadyInitialized: true, message: `Workspace "${workspaceKey}" already exists; nothing changed.` };
  }

  const sanitized = sanitizeIncomingSnapshot(clientSnapshot);

  const appUsersByEmail = new Map(
    sanitized.appUsers.map((u) => [normalizeEmail(u.email), u]),
  );

  for (const authUser of authUsers) {
    const email = normalizeEmail(authUser.email);
    if (!email || isDemoSeedEmail(email)) continue;

    const role = authUser.app_metadata?.role ?? authUser.user_metadata?.role ?? null;
    if (!role || !RECOGNISED_ROLES.includes(role)) continue;

    const existing = appUsersByEmail.get(email);
    appUsersByEmail.set(email, {
      id: email,
      email,
      name: existing?.name ?? authUser.user_metadata?.name ?? authUser.user_metadata?.full_name ?? email,
      role,
      actorId: authUser.id,
      staffId: existing?.staffId ?? null,
      active: true,
      moduleAccess: existing?.moduleAccess ?? buildDefaultModuleAccess(role),
    });
  }

  // Guarantee the Owner record exists even if it was somehow filtered above.
  const ownerEmail = normalizeEmail(owner.email);
  if (!appUsersByEmail.has(ownerEmail)) {
    appUsersByEmail.set(ownerEmail, {
      id: ownerEmail,
      email: ownerEmail,
      name: owner.user_metadata?.name ?? owner.user_metadata?.full_name ?? ownerEmail,
      role: "Owner",
      actorId: owner.id,
      staffId: null,
      active: true,
      moduleAccess: buildDefaultModuleAccess("Owner"),
    });
  }

  const nextSnapshot = { ...sanitized, appUsers: Array.from(appUsersByEmail.values()) };
  const nowIso = new Date().toISOString();

  const { error: writeError } = await supabase.from("workspace_snapshots").upsert(
    { workspace_key: workspaceKey, snapshot: nextSnapshot, updated_at: nowIso, updated_by: owner.id },
    { onConflict: "workspace_key" },
  );

  if (writeError) {
    return { ok: false, status: 502, error: `Failed to write the bootstrapped workspace: ${writeError.message}` };
  }

  const { data: verifyRow, error: verifyError } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", workspaceKey)
    .maybeSingle();

  if (verifyError || !verifyRow) {
    return {
      ok: false,
      status: 502,
      error: `Workspace write appeared to succeed but could not be verified: ${verifyError?.message ?? "row not found on re-read"}`,
    };
  }

  return {
    ok: true,
    alreadyInitialized: false,
    message: `Workspace "${workspaceKey}" initialized.`,
    appUsersCount: (verifyRow.snapshot?.appUsers ?? []).length,
  };
};
