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
  let row = snapshot
    ? {
        workspace_key: WORKSPACE_KEY,
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        updated_at: new Date().toISOString(),
        updated_by: null,
      }
    : null;
  let nextAuthId = 1;
  // Applied exactly once, immediately before the next atomic CAS write is
  // evaluated - simulates another writer's commit landing in the real race
  // window between this caller's own read and its write (see the CONCURRENCY
  // tests below). Not used by most tests, which run with no interleaving.
  let raceHookBeforeNextCasWrite = null;

  const chain = (getResult) => ({
    eq: () => chain(getResult),
    maybeSingle: () => Promise.resolve(getResult()),
    then: (resolve, reject) => Promise.resolve(getResult()).then(resolve, reject),
  });

  // Mirrors enough of the real Supabase JS query-builder chain for
  // .update(...).eq(...).eq(...).select(...) (the atomic CAS path in
  // writeWorkspaceRowAtomic) AND the simpler .update(...).eq(...) awaited
  // directly with no .select() (the deleteUser audit-reference reassignment,
  // which is unconditional single-column housekeeping, not a CAS write).
  const buildUpdateChain = (updates) => {
    const filters = {};
    const applyIfMatches = () => {
      if (raceHookBeforeNextCasWrite) {
        const hook = raceHookBeforeNextCasWrite;
        raceHookBeforeNextCasWrite = null;
        if (row) row = { ...row, ...hook(row) };
      }
      const matches = row && Object.entries(filters).every(([column, value]) => row[column] === value);
      if (matches) {
        row = { ...row, ...updates };
      }
      return matches;
    };
    const builder = {
      eq(column, value) {
        filters[column] = value;
        return builder;
      },
      select: async () => {
        if (failSnapshotWrite) {
          return { data: [], error: { message: "simulated snapshot write failure" } };
        }
        const matched = applyIfMatches();
        return { data: matched ? [{ workspace_key: WORKSPACE_KEY }] : [], error: null };
      },
      // Awaited directly (no .select()) - the reassignment call in deleteUser.
      then: (resolve, reject) => {
        applyIfMatches();
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  const from = (table) => {
    assert.equal(table, "workspace_snapshots");
    return {
      select: (cols) => {
        const colsStr = String(cols ?? "");
        if (colsStr.includes("snapshot")) {
          return chain(() => ({ data: row, error: null }));
        }
        // Bare "workspace_key, updated_by" select (deleteUser's audit-reference
        // scan) - awaited directly, returns every row (just the one, here).
        return Promise.resolve({
          data: row ? [{ workspace_key: WORKSPACE_KEY, updated_by: row.updated_by }] : [],
          error: null,
        });
      },
      insert: async (payload) => {
        if (failSnapshotWrite) {
          return { error: { message: "simulated snapshot write failure" } };
        }
        if (row) {
          return { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
        row = {
          workspace_key: WORKSPACE_KEY,
          snapshot: payload.snapshot,
          updated_at: payload.updated_at,
          updated_by: payload.updated_by ?? null,
        };
        return { error: null };
      },
      update: (updates) => buildUpdateChain(updates),
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
    getSnapshot: () => row?.snapshot ?? null,
    getRowUpdatedAt: () => row?.updated_at ?? null,
    setFailSnapshotWrite: (value) => {
      failSnapshotWrite = value;
    },
    // Applies `patch` to the underlying row exactly once, at the moment the next
    // atomic CAS write is evaluated - simulating a concurrent writer (e.g. a
    // Route/Driver/Fleet/Finance save from App.jsx) landing in the real race
    // window between this caller's own read and its write.
    simulateConcurrentWriteBeforeNextCasWrite: (patch) => {
      raceHookBeforeNextCasWrite = (currentRow) => ({ ...currentRow, ...patch });
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

// ---------------------------------------------------------------------------
// Phase C: server-side optimistic-locking concurrency. writeWorkspaceRowAtomic
// replaced the old read-then-upsert pattern (a re-read that shrank, but never
// closed, the race window) with the same compare-and-swap already proven
// client-side in src/lib/dataGateway.js: the write is gated on the exact
// `updated_at` this caller's own read returned, in one database round trip.
// These tests simulate a concurrent writer (e.g. an operational Route/Driver/
// Fleet/Finance save from App.jsx, or a second lifecycle call) landing in the
// real race window between this caller's read and its write, and prove the
// conflict is detected - never silently overwritten - with compensation/
// rollback/fail-closed behaviour preserved exactly as it was before.
// ---------------------------------------------------------------------------

test("CONCURRENCY: createUser detects a concurrent write as a conflict (409), compensates (deletes) the just-created Auth user, and never overwrites the concurrent data", async () => {
  const fake = createFakeSupabase({
    authUsers: [{ id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } }],
    snapshot: baseSnapshot,
  });

  fake.simulateConcurrentWriteBeforeNextCasWrite({
    updated_at: new Date(Date.now() + 60000).toISOString(),
    snapshot: { ...baseSnapshot, drivers: [{ staffId: "drv-concurrent" }] },
  });

  const result = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "race@example.com",
    name: "Race Condition",
    role: "Manager",
    password: "correct horse battery",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.ok(
    !fake.getAuthUsers().some((u) => u.email === "race@example.com"),
    "the just-created Auth identity must be compensated (deleted), never left as an orphan",
  );
  assert.ok(
    !fake.getAppUsers().some((u) => u.email === "race@example.com"),
    "the losing writer's appUsers change must never land",
  );
  assert.deepEqual(
    fake.getSnapshot().drivers,
    [{ staffId: "drv-concurrent" }],
    "the concurrent writer's data must survive completely untouched, not be silently overwritten",
  );
});

test("CONCURRENCY: updateUser detects a concurrent write as a conflict (409) and rolls back the already-applied Auth metadata change", async () => {
  const fake = createFakeSupabase({
    authUsers: [
      { id: "auth-owner", email: "owner@example.com", app_metadata: { role: "Owner" } },
      { id: "auth-mgr", email: "manager@example.com", app_metadata: { role: "Manager" }, user_metadata: { name: "Manager Person" } },
    ],
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "manager@example.com", email: "manager@example.com", name: "Manager Person", role: "Manager", actorId: "auth-mgr", active: true },
      ],
      drivers: [],
    },
  });

  fake.simulateConcurrentWriteBeforeNextCasWrite({
    updated_at: new Date(Date.now() + 60000).toISOString(),
    snapshot: {
      appUsers: [
        ownerAppUser,
        { id: "manager@example.com", email: "manager@example.com", name: "Concurrently Renamed", role: "Manager", actorId: "auth-mgr", active: true },
      ],
      drivers: [],
    },
  });

  const result = await updateUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "manager@example.com",
    role: "Admin",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  const authUser = fake.getAuthUsers().find((u) => u.email === "manager@example.com");
  assert.equal(authUser.app_metadata.role, "Manager", "Auth metadata must be rolled back to its pre-update value");
  assert.equal(
    fake.getAppUsers().find((u) => u.email === "manager@example.com").name,
    "Concurrently Renamed",
    "the concurrent writer's appUsers change must survive untouched",
  );
});

test("CONCURRENCY: deleteUser detects a concurrent write as a conflict (409) and fails closed with no changes made", async () => {
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

  fake.simulateConcurrentWriteBeforeNextCasWrite({
    updated_at: new Date(Date.now() + 60000).toISOString(),
    snapshot: { ...fake.getSnapshot(), drivers: [{ staffId: "drv-concurrent" }] },
  });

  const result = await deleteUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@example.com",
    email: "manager@example.com",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.ok(
    fake.getAppUsers().some((u) => u.email === "manager@example.com"),
    "the target user must still be present - deleteUser must fail closed, not partially remove membership",
  );
  assert.ok(
    fake.getAuthUsers().some((u) => u.email === "manager@example.com"),
    "the Auth identity must be untouched - Step 1 (appUsers write) failed, so Step 2 (Auth deletion) must never run",
  );
  assert.deepEqual(fake.getSnapshot().drivers, [{ staffId: "drv-concurrent" }]);
});

test("writeWorkspaceRowAtomic uses one atomic UPDATE gated on both workspace_key and the expected updated_at, exactly like the client-side atomic write", async () => {
  const source = (
    await readFile(new URL("../api/_lib/userLifecycle.js", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  const index = source.indexOf("const { data: updatedRows, error } = await supabase");
  assert.ok(index !== -1);
  const fn = source.slice(index, index + 500);

  assert.match(fn, /\.from\("workspace_snapshots"\)/);
  assert.match(fn, /\.update\(\{/);
  assert.match(fn, /\.eq\("workspace_key", workspaceKey\)/);
  assert.match(fn, /\.eq\("updated_at", expectedVersion\)/);
  assert.match(fn, /\.select\("workspace_key"\)/);

  const conflictIndex = source.indexOf("if (!updatedRows || updatedRows.length === 0) {");
  assert.ok(conflictIndex !== -1);
  const conflictBranch = source.slice(conflictIndex, conflictIndex + 300);
  assert.match(conflictBranch, /throw new WorkspaceConflictError\(/);
});

test("the old blind upsert is gone from every user-lifecycle write path", async () => {
  const source = await readFile(new URL("../api/_lib/userLifecycle.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\.upsert\(/,
    "no write path in userLifecycle.js may use an unconditional upsert - every write must be an atomic, version-guarded UPDATE or a guarded INSERT",
  );
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
