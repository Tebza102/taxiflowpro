import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
} from "../api/_lib/userLifecycle.js";

const WORKSPACE_KEY = "test-workspace";

// A minimal, purpose-built fake of the subset of the supabase-js client surface
// that api/_lib/userLifecycle.js actually calls. It's a real in-memory store, not a
// mock that just records calls - createUser/updateUser/deleteUser/resetPassword run
// against it for real and we assert on the resulting state, so these are genuine
// behavioural tests of the exported orchestration functions.
const createFakeSupabase = ({ authUsers = [], snapshot = null, failSnapshotWrite = false } = {}) => {
  let users = authUsers.map((u) => ({ ...u }));
  let row = snapshot ? { snapshot: JSON.parse(JSON.stringify(snapshot)), updated_at: new Date().toISOString(), updated_by: null } : null;
  let nextAuthId = 1;

  const chain = (getResult) => ({
    eq: () => chain(getResult),
    maybeSingle: () => Promise.resolve(getResult()),
    then: (resolve, reject) => Promise.resolve(getResult()).then(resolve, reject),
  });

  const from = (table) => {
    assert.equal(table, "workspace_snapshots");
    return {
      select: (cols) =>
        chain(() => {
          if (String(cols).includes("snapshot")) {
            return { data: row, error: null };
          }
          return {
            data: row ? [{ workspace_key: WORKSPACE_KEY, updated_by: row.updated_by }] : [],
            error: null,
          };
        }),
      upsert: async (payload) => {
        if (failSnapshotWrite) {
          return { error: { message: "simulated snapshot write failure" } };
        }
        row = {
          snapshot: payload.snapshot,
          updated_at: payload.updated_at,
          updated_by: payload.updated_by ?? null,
        };
        return { error: null };
      },
      update: (updates) => ({
        eq: async () => {
          if (row) row = { ...row, ...updates };
          return { error: null };
        },
      }),
    };
  };

  const auth = {
    admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      createUser: async ({ email, user_metadata, app_metadata }) => {
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          return { data: null, error: { message: "User already registered" } };
        }
        const user = {
          id: `auth-${nextAuthId++}`,
          email,
          user_metadata: user_metadata ?? {},
          app_metadata: app_metadata ?? {},
          created_at: new Date().toISOString(),
        };
        users.push(user);
        return { data: { user }, error: null };
      },
      updateUserById: async (id, updates) => {
        const idx = users.findIndex((u) => u.id === id);
        if (idx === -1) return { data: null, error: { message: "not found" } };
        users[idx] = {
          ...users[idx],
          ...updates,
          user_metadata: { ...users[idx].user_metadata, ...(updates.user_metadata ?? {}) },
          app_metadata: { ...users[idx].app_metadata, ...(updates.app_metadata ?? {}) },
        };
        return { data: { user: users[idx] }, error: null };
      },
      deleteUser: async (id) => {
        const before = users.length;
        users = users.filter((u) => u.id !== id);
        if (users.length === before) return { error: { message: "not found" } };
        return { error: null };
      },
    },
  };

  return {
    supabase: { auth, from },
    getAuthUsers: () => users,
    getAppUsers: () => (Array.isArray(row?.snapshot?.appUsers) ? row.snapshot.appUsers : []),
    setFailSnapshotWrite: (value) => {
      failSnapshotWrite = value;
    },
  };
};

const ownerAppUser = {
  id: "owner@example.com",
  email: "owner@example.com",
  name: "Test Owner",
  role: "Owner",
  actorId: "auth-owner",
  active: true,
};

const baseSnapshot = { appUsers: [ownerAppUser], drivers: [] };

test("CREATE MANAGER: Auth user and appUsers record are both created and survive a reload", async () => {
  const fake = createFakeSupabase({
    authUsers: [{ id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } }],
    snapshot: baseSnapshot,
  });

  const result = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "new.manager@example.com",
    name: "New Manager",
    role: "Manager",
    password: "correct horse battery",
  });

  assert.equal(result.ok, true);
  assert.ok(fake.getAuthUsers().some((u) => u.email === "new.manager@example.com"));
  const reloaded = fake.getAppUsers();
  const created = reloaded.find((u) => u.email === "new.manager@example.com");
  assert.ok(created, "appUsers record must exist after reload");
  assert.equal(created.role, "Manager");
  assert.equal(created.actorId, fake.getAuthUsers().find((u) => u.email === "new.manager@example.com").id);
});

test("CREATE ADMIN: Auth user and appUsers record are both created", async () => {
  const fake = createFakeSupabase({
    authUsers: [{ id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } }],
    snapshot: baseSnapshot,
  });

  const result = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "new.admin@example.com",
    name: "New Admin",
    role: "Admin",
    password: "correct horse battery",
  });

  assert.equal(result.ok, true);
  assert.ok(fake.getAuthUsers().some((u) => u.email === "new.admin@example.com"));
  assert.ok(fake.getAppUsers().some((u) => u.email === "new.admin@example.com" && u.role === "Admin"));
});

test("SNAPSHOT FAILURE DURING CREATE: the just-created Auth identity is compensated (deleted), no false success", async () => {
  const fake = createFakeSupabase({
    authUsers: [{ id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } }],
    snapshot: baseSnapshot,
    failSnapshotWrite: true,
  });

  const result = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "orphan@example.com",
    name: "Should Not Exist",
    role: "Manager",
    password: "correct horse battery",
  });

  assert.equal(result.ok, false);
  assert.ok(!fake.getAuthUsers().some((u) => u.email === "orphan@example.com"), "Auth user must be rolled back");
  assert.ok(!fake.getAppUsers().some((u) => u.email === "orphan@example.com"));
});

test("AUTH FAILURE DURING CREATE: appUsers is never mutated (no fake working account)", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-dupe", email: "dupe@example.com", app_metadata: { role: "Manager" } },
    ],
    snapshot: baseSnapshot,
  });

  const result = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "dupe@example.com", // already exists in Auth -> createUser call fails
    name: "Duplicate",
    role: "Manager",
    password: "correct horse battery",
  });

  assert.equal(result.ok, false);
  assert.ok(!fake.getAppUsers().some((u) => u.email === "dupe@example.com"));
});

test("ROLE UPDATE: Auth metadata role and appUsers role stay aligned", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-mgr", email: "manager@example.com", app_metadata: { role: "Manager" }, user_metadata: {} },
    ],
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "manager@example.com", email: "manager@example.com", name: "Manager Person", role: "Manager", actorId: "auth-mgr", active: true },
      ],
      drivers: [],
    },
  });

  const result = await updateUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "manager@example.com",
    name: "Manager Person",
    role: "Admin",
  });

  assert.equal(result.ok, true);
  const authUser = fake.getAuthUsers().find((u) => u.email === "manager@example.com");
  const appUser = fake.getAppUsers().find((u) => u.email === "manager@example.com");
  assert.equal(authUser.app_metadata.role, "Admin");
  assert.equal(appUser.role, "Admin");
});

test("DELETE USER: appUsers membership and Auth identity are both removed", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-mgr", email: "manager@example.com", app_metadata: { role: "Manager" } },
    ],
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "manager@example.com", email: "manager@example.com", name: "Manager Person", role: "Manager", actorId: "auth-mgr", active: true },
      ],
      drivers: [],
    },
  });

  const result = await deleteUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "manager@example.com",
  });

  assert.equal(result.ok, true);
  assert.ok(!fake.getAppUsers().some((u) => u.email === "manager@example.com"));
  assert.ok(!fake.getAuthUsers().some((u) => u.email === "manager@example.com"));
});

test("DELETE FAILURE: user remains blocked (appUsers removed) even if Auth cleanup fails", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-mgr", email: "manager@example.com", app_metadata: { role: "Manager" } },
    ],
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "manager@example.com", email: "manager@example.com", name: "Manager Person", role: "Manager", actorId: "auth-mgr", active: true },
      ],
      drivers: [],
    },
  });

  // Simulate the Auth deletion step failing by removing the Auth user out from under
  // the lifecycle call between the appUsers write and the delete call: monkeypatch
  // deleteUser on the fake auth admin to always fail.
  fake.supabase.auth.admin.deleteUser = async () => ({ error: { message: "simulated Auth outage" } });

  const result = await deleteUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "manager@example.com",
  });

  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  // The critical safety property: even though Auth deletion failed, appUsers
  // membership is already gone, so the membership gate blocks this account.
  assert.ok(!fake.getAppUsers().some((u) => u.email === "manager@example.com"));
});

test("OWNER PROTECTION: Owner cannot be deleted or demoted", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-owner2", email: "owner2@example.com", app_metadata: { role: "Owner" } },
    ],
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "owner2@example.com", email: "owner2@example.com", name: "Second Owner", role: "Owner", actorId: "auth-owner2", active: true },
      ],
      drivers: [],
    },
  });

  const deleteResult = await deleteUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "owner2@example.com",
  });
  assert.equal(deleteResult.ok, false);
  assert.match(deleteResult.error, /cannot be deleted/i);
  assert.ok(fake.getAppUsers().some((u) => u.email === "owner2@example.com"));

  const demoteResult = await updateUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "owner2@example.com",
    role: "Manager",
  });
  assert.equal(demoteResult.ok, false);
  assert.match(demoteResult.error, /cannot be demoted/i);
  assert.equal(fake.getAppUsers().find((u) => u.email === "owner2@example.com").role, "Owner");
});

test("Only an active Owner in the account directory can call create/update/delete", async () => {
  const fake = createFakeSupabase({
    authUsers: [{ id: "auth-imposter", email: "imposter@example.com", app_metadata: { role: "Owner" } }],
    snapshot: baseSnapshot, // imposter@example.com is NOT in appUsers at all
  });

  const result = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "imposter@example.com",
    email: "victim@example.com",
    name: "Victim",
    role: "Manager",
    password: "correct horse battery",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("PASSWORD RESET never writes a password field into the snapshot", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-mgr", email: "manager@example.com", app_metadata: { role: "Manager" }, user_metadata: {} },
    ],
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "manager@example.com", email: "manager@example.com", name: "Manager Person", role: "Manager", actorId: "auth-mgr", active: true },
      ],
      drivers: [],
    },
  });

  const result = await resetPassword({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "manager@example.com",
    name: "Manager Person Renamed",
    password: "a brand new password",
  });

  assert.equal(result.ok, true);
  const appUser = fake.getAppUsers().find((u) => u.email === "manager@example.com");
  assert.equal(appUser.name, "Manager Person Renamed");
  assert.equal("accessPassword" in appUser, false);
  assert.equal("password" in appUser, false);
});

test("AUTH-ONLY USER and INACTIVE appUsers user cannot resolve to a valid TaxiFlow identity (membership gate)", async () => {
  // appRuntimeSecure.js transitively imports src/lib/supabaseClient.js, which reads
  // import.meta.env - a Vite build-time feature that does not exist when this file
  // is loaded directly by Node's test runner (import.meta.env is undefined outside
  // a Vite-processed bundle), so this module cannot be safely `import()`-ed from a
  // plain `node --test` run the way api/_lib/userLifecycle.js can. The gate is
  // exercised end-to-end for real by the Playwright module-smoke/driver-visibility
  // specs (see tests/module-smoke.spec.js) when a browser runtime is available.
  // Here we assert the exact control-flow shape of the gate directly against the
  // source, pinned to the precise condition so this test breaks (not silently
  // passes) if the gate is ever weakened or removed.
  const source = await readFile(new URL("../src/lib/appRuntimeSecure.js", import.meta.url), "utf8");
  const gateIndex = source.indexOf("const storedUser = getAppUserByEmail(snapshot, email);");
  const returnNullIndex = source.indexOf(
    "if (!storedUser || storedUser.active === false) {",
  );
  assert.ok(gateIndex !== -1, "resolveAuthIdentity must look up the stored appUsers record");
  assert.ok(returnNullIndex !== -1, "resolveAuthIdentity must gate on presence + active");
  assert.ok(
    returnNullIndex > gateIndex,
    "the membership gate must be checked AFTER looking up the stored user, not skipped",
  );
  const afterGate = source.slice(returnNullIndex, returnNullIndex + 80);
  assert.match(afterGate, /return null;/);
});

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const source = await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8");
  assert.match(source, /\["pending", "counted", "verified", "banked"\]/);
});
