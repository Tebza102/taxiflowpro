import { createClient } from "@supabase/supabase-js";

// Mirrors src/lib/appRuntime.js's MODULE_VIEW_ACCESS role table for the purpose of
// seeding a new user's default module access. Duplicated (rather than imported) so
// this serverless function does not pull in the full browser-oriented app runtime
// (icons, React-adjacent helpers) into its bundle. The client re-normalizes
// moduleAccess against the authoritative table on every load, so this only needs to
// be a reasonable default, not a permanent source of truth.
const MODULE_KEYS = ["overview", "finance", "fleet", "drivers", "settings"];
const MODULE_ROLES = {
  overview: ["Owner", "Admin", "Manager", "Driver", "Viewer"],
  finance: ["Owner", "Admin", "Manager", "Viewer"],
  fleet: ["Owner", "Admin", "Manager", "Driver", "Viewer"],
  drivers: ["Owner", "Admin", "Manager", "Driver", "Viewer"],
  settings: ["Owner", "Admin", "Manager"],
};

export const VALID_ROLES = ["Owner", "Admin", "Manager", "Driver", "Viewer"];
export const DEMO_EMAIL_SUFFIX = "@taxiflow.local";

export const buildDefaultModuleAccess = (role) => {
  if (role === "Owner") {
    return Object.fromEntries(MODULE_KEYS.map((key) => [key, true]));
  }
  if (role === "Viewer") {
    return Object.fromEntries(MODULE_KEYS.map((key) => [key, key === "overview"]));
  }
  if (role === "Admin" || role === "Manager") {
    return Object.fromEntries(MODULE_KEYS.map((key) => [key, MODULE_ROLES[key].includes(role)]));
  }
  // Driver (and any unrecognised role) gets the same conservative default as the client.
  return Object.fromEntries(
    MODULE_KEYS.map((key) => [
      key,
      key === "settings" ? false : key === "overview" ? true : MODULE_ROLES[key].includes(role),
    ]),
  );
};

export const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

export const isDemoSeedEmail = (email) => normalizeEmail(email).endsWith(DEMO_EMAIL_SUFFIX);

export const stripCredentialFields = (record = {}) => {
  const { accessPassword, localPassword, password, ...safeRecord } = record;
  return safeRecord;
};

export const createServiceClient = (supabaseUrl, serviceRoleKey) =>
  createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const getAppUsersArray = (snapshot) =>
  Array.isArray(snapshot?.appUsers) ? snapshot.appUsers : [];

const findAppUserByEmail = (appUsers, email) => {
  const normalized = normalizeEmail(email);
  return appUsers.find((user) => normalizeEmail(user.email) === normalized) ?? null;
};

const readWorkspaceRow = async (supabase, workspaceKey) => {
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot, updated_at")
    .eq("workspace_key", workspaceKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read workspace snapshot: ${error.message}`);
  }

  return data ?? null;
};

const writeWorkspaceRow = async (supabase, workspaceKey, snapshot, updatedByAuthId) => {
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("workspace_snapshots").upsert(
    {
      workspace_key: workspaceKey,
      snapshot,
      updated_at: nowIso,
      updated_by: updatedByAuthId ?? null,
    },
    { onConflict: "workspace_key" },
  );

  if (error) {
    throw new Error(`Failed to persist workspace snapshot: ${error.message}`);
  }

  return nowIso;
};

const listAllAuthUsers = async (supabase) => {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      throw new Error(`Failed to list Supabase Auth users: ${error.message}`);
    }
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }

  return users;
};

/**
 * Confirms the requesting identity is an ACTIVE Owner in the account directory
 * (not just an Owner-flavoured Supabase Auth session). This is the membership half
 * of the "valid Auth identity + active appUsers membership" contract - an Auth
 * session alone (e.g. a stale or orphaned Auth user) is never sufficient to manage
 * other accounts.
 */
export const requireActiveOwner = async (supabase, workspaceKey, requesterEmail) => {
  const row = await readWorkspaceRow(supabase, workspaceKey);
  const appUsers = getAppUsersArray(row?.snapshot);
  const requester = findAppUserByEmail(appUsers, requesterEmail);

  if (!requester || requester.role !== "Owner" || requester.active === false) {
    return {
      ok: false,
      status: 403,
      error: "Only an active Owner listed in the TaxiFlow account directory can manage users.",
    };
  }

  return { ok: true, row, appUsers, requester };
};

const buildAppUserRecord = ({ email, name, role, authUserId, staffId, actorId: requesterActorId }) => {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();

  return {
    id: normalizedEmail,
    email: normalizedEmail,
    name: String(name || normalizedEmail).trim(),
    role,
    actorId: authUserId,
    staffId: staffId ?? null,
    active: true,
    moduleAccess: buildDefaultModuleAccess(role),
    createdAt: now,
    createdBy: requesterActorId ?? null,
    createdByRole: "Owner",
    updatedAt: null,
    updatedBy: null,
    updatedByRole: null,
  };
};

/**
 * CREATE: Owner creates a new production user.
 *
 * Order of operations is deliberate: Supabase Auth identity is created FIRST, then
 * the appUsers record. If the appUsers write fails, the just-created Auth identity
 * is deleted (compensation) so we never report success while leaving an
 * Auth-only orphan behind.
 */
export const createUser = async ({
  supabase,
  workspaceKey,
  requesterEmail,
  email,
  name,
  role,
  password,
  staffId,
}) => {
  const ownerCheck = await requireActiveOwner(supabase, workspaceKey, requesterEmail);
  if (!ownerCheck.ok) return ownerCheck;

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { ok: false, status: 400, error: "Valid email address required." };
  }

  if (isDemoSeedEmail(normalizedEmail)) {
    return {
      ok: false,
      status: 400,
      error: "Production accounts cannot use @taxiflow.local addresses.",
    };
  }

  if (!VALID_ROLES.includes(role)) {
    return { ok: false, status: 400, error: "Valid role required for user creation." };
  }

  if (!password || password.length < 8) {
    return {
      ok: false,
      status: 400,
      error: "A real password (8+ characters) is required for live account creation.",
    };
  }

  if (findAppUserByEmail(ownerCheck.appUsers, normalizedEmail)) {
    return {
      ok: false,
      status: 409,
      error: "A user with this email already exists in the account directory.",
    };
  }

  const existingAuthUsers = await listAllAuthUsers(supabase);
  if (existingAuthUsers.some((user) => normalizeEmail(user.email) === normalizedEmail)) {
    return { ok: false, status: 409, error: "User already exists in Supabase Auth." };
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { name: name || normalizedEmail, role, staffId: staffId ?? null },
    app_metadata: { role, staff_id: staffId ?? null },
  });

  if (createError || !created?.user) {
    return {
      ok: false,
      status: 502,
      error: createError?.message ?? "Failed to create Supabase Auth user.",
    };
  }

  const authUser = created.user;

  try {
    // Re-read the snapshot immediately before writing to shrink (not eliminate) the
    // race window against a concurrent mutation, and re-check the email hasn't
    // appeared in the meantime.
    const freshRow = await readWorkspaceRow(supabase, workspaceKey);
    const freshAppUsers = getAppUsersArray(freshRow?.snapshot);

    if (findAppUserByEmail(freshAppUsers, normalizedEmail)) {
      throw new Error("A user with this email was just created by someone else.");
    }

    const newAppUser = buildAppUserRecord({
      email: normalizedEmail,
      name,
      role,
      authUserId: authUser.id,
      staffId,
      actorId: ownerCheck.requester.actorId,
    });

    const nextSnapshot = {
      ...(freshRow?.snapshot ?? {}),
      appUsers: [...freshAppUsers, newAppUser].map(stripCredentialFields),
    };

    await writeWorkspaceRow(supabase, workspaceKey, nextSnapshot, authUser.id);

    return {
      ok: true,
      user: { id: authUser.id, email: normalizedEmail, role },
      appUser: newAppUser,
    };
  } catch (snapshotError) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);

    if (deleteError) {
      return {
        ok: false,
        status: 500,
        error:
          `User creation failed and automatic cleanup also failed. A Supabase Auth ` +
          `account for ${normalizedEmail} may still exist without a matching TaxiFlow ` +
          `profile - this requires manual review in the Supabase dashboard. ` +
          `(${snapshotError.message}; cleanup error: ${deleteError.message})`,
      };
    }

    return {
      ok: false,
      status: 500,
      error:
        `User creation failed before the account directory could be updated. The ` +
        `partially created Supabase Auth account was removed automatically, so no ` +
        `orphaned account was left behind. (${snapshotError.message})`,
    };
  }
};

/**
 * UPDATE: role / name / module-access changes. Keeps Supabase Auth metadata and the
 * appUsers record aligned. Owner accounts can never be demoted here.
 */
export const updateUser = async ({
  supabase,
  workspaceKey,
  requesterEmail,
  email,
  name,
  role,
  moduleAccess,
}) => {
  const ownerCheck = await requireActiveOwner(supabase, workspaceKey, requesterEmail);
  if (!ownerCheck.ok) return ownerCheck;

  const normalizedEmail = normalizeEmail(email);
  const existingAppUser = findAppUserByEmail(ownerCheck.appUsers, normalizedEmail);

  if (!existingAppUser) {
    return { ok: false, status: 404, error: "This user account could not be found." };
  }

  if (role && !VALID_ROLES.includes(role)) {
    return { ok: false, status: 400, error: "Valid role required for user update." };
  }

  if (existingAppUser.role === "Owner" && role && role !== "Owner") {
    return { ok: false, status: 403, error: "Owner accounts cannot be demoted inside TaxiFlow." };
  }

  const existingAuthUsers = await listAllAuthUsers(supabase);
  const authUser = existingAuthUsers.find(
    (user) => normalizeEmail(user.email) === normalizedEmail,
  );

  const nextRole = role || existingAppUser.role;
  const nextName = String(name ?? existingAppUser.name ?? "").trim() || existingAppUser.name;

  // Step 1: update Supabase Auth metadata first, if an Auth identity exists.
  if (authUser) {
    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(authUser.id, {
      user_metadata: { ...(authUser.user_metadata ?? {}), name: nextName, role: nextRole },
      app_metadata: { ...(authUser.app_metadata ?? {}), role: nextRole },
    });

    if (authUpdateError) {
      return {
        ok: false,
        status: 502,
        error: `Failed to update Supabase Auth metadata: ${authUpdateError.message}. The account directory was not changed, so Auth and appUsers remain aligned.`,
      };
    }
  }

  // Step 2: update the appUsers record. If this fails after the Auth metadata was
  // already updated, attempt to roll the Auth metadata back so the two stores don't
  // silently diverge.
  try {
    const freshRow = await readWorkspaceRow(supabase, workspaceKey);
    const freshAppUsers = getAppUsersArray(freshRow?.snapshot);
    const freshExisting = findAppUserByEmail(freshAppUsers, normalizedEmail);

    if (!freshExisting) {
      throw new Error("This user account no longer exists in the account directory.");
    }

    const nextAppUser = stripCredentialFields({
      ...freshExisting,
      name: nextName,
      role: nextRole,
      moduleAccess: moduleAccess ?? buildDefaultModuleAccess(nextRole),
      updatedAt: new Date().toISOString(),
      updatedBy: ownerCheck.requester.actorId ?? null,
      updatedByRole: "Owner",
    });

    const nextSnapshot = {
      ...(freshRow?.snapshot ?? {}),
      appUsers: freshAppUsers.map((user) =>
        normalizeEmail(user.email) === normalizedEmail ? nextAppUser : user,
      ),
    };

    await writeWorkspaceRow(supabase, workspaceKey, nextSnapshot, authUser?.id ?? null);

    return { ok: true, appUser: nextAppUser };
  } catch (snapshotError) {
    if (authUser) {
      const { error: rollbackError } = await supabase.auth.admin.updateUserById(authUser.id, {
        user_metadata: authUser.user_metadata ?? {},
        app_metadata: authUser.app_metadata ?? {},
      });

      if (rollbackError) {
        return {
          ok: false,
          status: 500,
          error:
            `Account directory update failed and rolling back the Supabase Auth ` +
            `metadata change also failed. Auth and the account directory are now ` +
            `inconsistent for ${normalizedEmail} and require manual review. ` +
            `(${snapshotError.message}; rollback error: ${rollbackError.message})`,
        };
      }
    }

    return {
      ok: false,
      status: 500,
      error: `Account directory update failed; any Supabase Auth metadata change was rolled back. (${snapshotError.message})`,
    };
  }
};

/**
 * PASSWORD RESET: password lives only in Supabase Auth. Never writes accessPassword
 * / localPassword / password into the snapshot. If a name change is bundled with the
 * reset, that alone may still touch the appUsers record, but the password value
 * itself never does.
 */
export const resetPassword = async ({
  supabase,
  workspaceKey,
  requesterEmail,
  requesterRole,
  email,
  name,
  password,
}) => {
  const normalizedEmail = normalizeEmail(email);
  const row = await readWorkspaceRow(supabase, workspaceKey);
  const appUsers = getAppUsersArray(row?.snapshot);
  const requester = findAppUserByEmail(appUsers, requesterEmail);

  if (!requester || requester.active === false || !["Owner", "Admin", "Manager"].includes(requester.role)) {
    return {
      ok: false,
      status: 403,
      error: "Only active Owner, Admin, or Manager accounts can reset TaxiFlow passwords.",
    };
  }

  const targetAppUser = findAppUserByEmail(appUsers, normalizedEmail);

  if (targetAppUser?.role === "Owner" && requester.role !== "Owner") {
    return { ok: false, status: 403, error: "Only an owner can reset an owner account password." };
  }

  if (!password || password.length < 8) {
    return { ok: false, status: 400, error: "Reset password must be at least 8 characters long." };
  }

  const existingAuthUsers = await listAllAuthUsers(supabase);
  const authUser = existingAuthUsers.find(
    (user) => normalizeEmail(user.email) === normalizedEmail,
  );

  if (!authUser) {
    return { ok: false, status: 404, error: "User not found in Supabase Auth." };
  }

  const { error: authUpdateError } = await supabase.auth.admin.updateUserById(authUser.id, {
    password,
    email_confirm: true,
    user_metadata: {
      ...(authUser.user_metadata ?? {}),
      ...(name ? { name: String(name).trim() } : {}),
    },
  });

  if (authUpdateError) {
    return { ok: false, status: 502, error: authUpdateError.message };
  }

  if (!name || !targetAppUser) {
    return { ok: true, message: `Password reset for ${normalizedEmail}.` };
  }

  // Name change bundled with the reset: update appUsers, but the password field
  // itself is never part of this write.
  try {
    const freshRow = await readWorkspaceRow(supabase, workspaceKey);
    const freshAppUsers = getAppUsersArray(freshRow?.snapshot);
    const nextAppUsers = freshAppUsers.map((user) =>
      normalizeEmail(user.email) === normalizedEmail
        ? stripCredentialFields({ ...user, name: String(name).trim() })
        : user,
    );

    await writeWorkspaceRow(
      supabase,
      workspaceKey,
      { ...(freshRow?.snapshot ?? {}), appUsers: nextAppUsers },
      authUser.id,
    );
  } catch (snapshotError) {
    // The password reset itself already succeeded and must not be rolled back (a
    // successfully rotated credential cannot be safely "un-rotated"). Report the
    // partial outcome plainly instead.
    return {
      ok: true,
      warning: `Password reset succeeded, but the display name update did not save: ${snapshotError.message}`,
    };
  }

  return { ok: true, message: `Password and details reset for ${normalizedEmail}.` };
};

/**
 * DELETE: removes a non-Owner user. appUsers membership is removed FIRST so that,
 * even if the subsequent Supabase Auth deletion fails, the user is immediately
 * blocked from TaxiFlow access (the membership gate requires an appUsers record).
 * Before deleting the Auth identity, any workspace_snapshots.updated_by reference to
 * that identity is reassigned to the acting Owner, mirroring the guard already used
 * in scripts/reset-production-users.mjs.
 */
export const deleteUser = async ({ supabase, workspaceKey, requesterEmail, email }) => {
  const ownerCheck = await requireActiveOwner(supabase, workspaceKey, requesterEmail);
  if (!ownerCheck.ok) return ownerCheck;

  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail === normalizeEmail(requesterEmail)) {
    return { ok: false, status: 403, error: "Cannot delete the account you are signed in with." };
  }

  const targetAppUser = findAppUserByEmail(ownerCheck.appUsers, normalizedEmail);

  if (!targetAppUser) {
    return { ok: false, status: 404, error: "This user account could not be found." };
  }

  if (targetAppUser.role === "Owner") {
    return { ok: false, status: 403, error: "Owner accounts cannot be deleted inside TaxiFlow." };
  }

  // Step 1: remove appUsers membership. This alone blocks TaxiFlow access.
  let freshRow;
  try {
    freshRow = await readWorkspaceRow(supabase, workspaceKey);
    const freshAppUsers = getAppUsersArray(freshRow?.snapshot);
    const nextSnapshot = {
      ...(freshRow?.snapshot ?? {}),
      appUsers: freshAppUsers.filter(
        (user) => normalizeEmail(user.email) !== normalizedEmail,
      ),
    };

    await writeWorkspaceRow(supabase, workspaceKey, nextSnapshot, ownerCheck.requester.actorId ?? null);
  } catch (snapshotError) {
    return {
      ok: false,
      status: 500,
      error: `Failed to remove ${normalizedEmail} from the account directory; no changes were made. (${snapshotError.message})`,
    };
  }

  // Step 2: reassign any workspace_snapshots.updated_by pointing at this identity's
  // Auth user id, then delete the Auth identity.
  const existingAuthUsers = await listAllAuthUsers(supabase);
  const authUser = existingAuthUsers.find(
    (user) => normalizeEmail(user.email) === normalizedEmail,
  );

  if (!authUser) {
    return {
      ok: true,
      message: `${normalizedEmail} was removed from the account directory. No matching Supabase Auth account was found to delete.`,
    };
  }

  try {
    const { data: allWorkspaceRows, error: readError } = await supabase
      .from("workspace_snapshots")
      .select("workspace_key, updated_by");

    if (readError) {
      throw new Error(`Could not read workspace audit references: ${readError.message}`);
    }

    for (const row of allWorkspaceRows ?? []) {
      if (row.updated_by !== authUser.id) continue;
      const { error: reassignError } = await supabase
        .from("workspace_snapshots")
        .update({ updated_by: ownerCheck.requester.actorId ?? null })
        .eq("workspace_key", row.workspace_key);

      if (reassignError) {
        throw new Error(`Could not reassign workspace audit reference: ${reassignError.message}`);
      }
    }
  } catch (reassignError) {
    return {
      ok: false,
      status: 207,
      partial: true,
      error:
        `${normalizedEmail} was removed from the account directory and is BLOCKED from ` +
        `TaxiFlow access, but the Supabase Auth account could not be safely deleted yet ` +
        `(${reassignError.message}). This requires manual cleanup in Supabase - the user ` +
        `remains blocked in the meantime, which is the safe state.`,
    };
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);

  if (deleteError) {
    return {
      ok: false,
      status: 207,
      partial: true,
      error:
        `${normalizedEmail} was removed from the account directory and is BLOCKED from ` +
        `TaxiFlow access, but the Supabase Auth account could not be deleted ` +
        `(${deleteError.message}). This requires manual cleanup in Supabase - the user ` +
        `remains blocked in the meantime, which is the safe state.`,
    };
  }

  return {
    ok: true,
    message: `${normalizedEmail} was removed from the account directory and deleted from Supabase Auth.`,
  };
};

export const listAllAuthUsersForDiagnostics = listAllAuthUsers;
export const readWorkspaceRowForDiagnostics = readWorkspaceRow;
