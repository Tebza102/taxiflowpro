import { createClient } from "@supabase/supabase-js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";

const required = (name) => {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const SUPABASE_URL = required("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const OWNER_EMAIL = required("TAXIFLOW_BOOTSTRAP_OWNER_EMAIL").toLowerCase();
const OWNER_PASSWORD = required("TAXIFLOW_BOOTSTRAP_OWNER_PASSWORD");
const OWNER_NAME = String(process.env.TAXIFLOW_BOOTSTRAP_OWNER_NAME ?? "TaxiFlow Owner").trim();
const WORKSPACE_KEY = resolveServerWorkspaceKey();
const CONFIRMATION = String(process.env.TAXIFLOW_CONFIRM_OWNER_RESET ?? "").trim();

if (CONFIRMATION !== "RESET_TAXIFLOW_PRODUCTION_USERS") {
  throw new Error(
    "Refusing destructive reset. Set TAXIFLOW_CONFIRM_OWNER_RESET=RESET_TAXIFLOW_PRODUCTION_USERS to continue.",
  );
}

if (!OWNER_EMAIL.includes("@")) {
  throw new Error("TAXIFLOW_BOOTSTRAP_OWNER_EMAIL must be a valid email address.");
}

if (OWNER_EMAIL.endsWith("@taxiflow.local")) {
  throw new Error("Production Owner must use a real email address, not @taxiflow.local.");
}

if (OWNER_PASSWORD.length < 8) {
  throw new Error("TAXIFLOW_BOOTSTRAP_OWNER_PASSWORD must be at least 8 characters long.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const listAllUsers = async () => {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }

  return users;
};

const existingUsers = await listAllUsers();
const existingOwner = existingUsers.find(
  (user) => user.email?.trim().toLowerCase() === OWNER_EMAIL,
);

let owner;

if (existingOwner) {
  const { data, error } = await supabase.auth.admin.updateUserById(existingOwner.id, {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      ...(existingOwner.user_metadata ?? {}),
      name: OWNER_NAME,
      role: "Owner",
    },
    app_metadata: {
      ...(existingOwner.app_metadata ?? {}),
      role: "Owner",
    },
  });

  if (error || !data?.user) {
    throw new Error(`Failed to repair bootstrap Owner: ${error?.message ?? "unknown error"}`);
  }

  owner = data.user;
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    email_confirm: true,
    user_metadata: {
      name: OWNER_NAME,
      role: "Owner",
    },
    app_metadata: {
      role: "Owner",
    },
  });

  if (error || !data?.user) {
    throw new Error(`Failed to create bootstrap Owner: ${error?.message ?? "unknown error"}`);
  }

  owner = data.user;
}

// The replacement Owner is guaranteed to exist before any other Auth user is removed.
const usersToDelete = existingUsers.filter((user) => user.id !== owner.id);
const userIdsToDelete = new Set(usersToDelete.map((user) => user.id));

console.log(
  `TaxiFlow production auth reset: Owner is ready; ${usersToDelete.length} other account(s) will be removed.`,
);

// workspace_snapshots.updated_by references auth.users(id) without ON DELETE CASCADE/SET NULL.
// Clear references to accounts that are about to be removed so PostgreSQL does not reject
// the Auth deletion. The production workspace is assigned back to the new Owner later.
const { data: workspaceAuditRows, error: workspaceAuditReadError } = await supabase
  .from("workspace_snapshots")
  .select("workspace_key, updated_by");

if (workspaceAuditReadError) {
  throw new Error(
    `Owner is ready, but workspace audit references could not be read: ${workspaceAuditReadError.message}`,
  );
}

for (const row of workspaceAuditRows ?? []) {
  if (!row.updated_by || !userIdsToDelete.has(row.updated_by)) continue;

  const { error: workspaceAuditClearError } = await supabase
    .from("workspace_snapshots")
    .update({ updated_by: null })
    .eq("workspace_key", row.workspace_key);

  if (workspaceAuditClearError) {
    throw new Error(
      `Owner is ready, but workspace audit reference ${row.workspace_key} could not be cleared: ${workspaceAuditClearError.message}`,
    );
  }
}

for (const user of usersToDelete) {
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) {
    throw new Error(`Failed to remove existing Auth user ${user.id}: ${error.message}`);
  }
}

const now = new Date().toISOString();

const { data: workspaceRow, error: workspaceReadError } = await supabase
  .from("workspace_snapshots")
  .select("snapshot")
  .eq("workspace_key", WORKSPACE_KEY)
  .maybeSingle();

if (workspaceReadError) {
  throw new Error(`Owner is ready, but workspace cleanup could not be read: ${workspaceReadError.message}`);
}

if (workspaceRow?.snapshot && typeof workspaceRow.snapshot === "object") {
  const existingSnapshot = workspaceRow.snapshot;
  const sanitizedDrivers = Array.isArray(existingSnapshot.drivers)
    ? existingSnapshot.drivers.map(({ accessPassword, localPassword, password, ...driver }) => driver)
    : [];
  const ownerRecord = {
    id: OWNER_EMAIL,
    email: OWNER_EMAIL,
    name: OWNER_NAME,
    role: "Owner",
    actorId: owner.id,
    staffId: null,
    accessPassword: null,
    active: true,
    moduleAccess: {
      overview: true,
      finance: true,
      fleet: true,
      drivers: true,
      settings: true,
    },
    createdAt: now,
    createdBy: "developer-bootstrap",
    createdByRole: "Developer",
  };

  const nextSnapshot = {
    ...existingSnapshot,
    appUsers: [ownerRecord],
    drivers: sanitizedDrivers,
    passwordResetRequests: [],
    emailOutbox: [],
  };

  const { error: workspaceWriteError } = await supabase.from("workspace_snapshots").upsert(
    {
      workspace_key: WORKSPACE_KEY,
      snapshot: nextSnapshot,
      updated_at: now,
      updated_by: owner.id,
    },
    { onConflict: "workspace_key" },
  );

  if (workspaceWriteError) {
    throw new Error(
      `Owner is ready, but workspace user reset failed: ${workspaceWriteError.message}`,
    );
  }
} else {
  console.log("No existing workspace snapshot was found; Auth reset completed without snapshot mutation.");
}

console.log("TaxiFlow production accounts reset successfully.");
console.log(`Bootstrap Owner ready: ${OWNER_EMAIL}`);
console.log("No password value was printed or stored in the workspace snapshot.");
