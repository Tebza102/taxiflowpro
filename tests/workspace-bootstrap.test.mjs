import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { bootstrapWorkspace } from "../api/_lib/workspaceBootstrap.js";
import { createUser } from "../api/_lib/userLifecycle.js";
import { resolveServerWorkspaceKey } from "../api/_lib/workspaceKey.js";
import { LIVE_WORKSPACE_KEY } from "../src/lib/workspaceContract.js";

const WORKSPACE_KEY = LIVE_WORKSPACE_KEY;

// Same style of in-memory fake Supabase client as tests/user-lifecycle.test.mjs -
// createUser/bootstrapWorkspace run against it for real.
const createFakeSupabase = ({ authUsers = [], row = null } = {}) => {
  let users = authUsers.map((u) => ({ ...u }));
  let workspaceRow = row ? JSON.parse(JSON.stringify(row)) : null;
  let nextAuthId = 1;

  const chain = (getResult) => ({
    eq: () => chain(getResult),
    maybeSingle: () => Promise.resolve(getResult()),
    then: (resolve, reject) => Promise.resolve(getResult()).then(resolve, reject),
  });

  const from = (table) => {
    assert.equal(table, "workspace_snapshots");
    return {
      select: () => chain(() => ({ data: workspaceRow, error: null })),
      upsert: async (payload) => {
        workspaceRow = {
          workspace_key: payload.workspace_key,
          snapshot: payload.snapshot,
          updated_at: payload.updated_at,
          updated_by: payload.updated_by ?? null,
        };
        return { error: null };
      },
    };
  };

  const auth = {
    admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      createUser: async ({ email, user_metadata, app_metadata }) => {
        if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          return { data: null, error: { message: "User already registered" } };
        }
        const user = { id: `auth-${nextAuthId++}`, email, user_metadata: user_metadata ?? {}, app_metadata: app_metadata ?? {} };
        users.push(user);
        return { data: { user }, error: null };
      },
    },
  };

  return {
    supabase: { auth, from },
    getRow: () => workspaceRow,
  };
};

const ownerAuth = { id: "auth-owner-1", email: "owner@apprigate.com", app_metadata: { role: "Owner" }, user_metadata: { name: "Real Owner" } };

test("bootstrap creates the canonical workspace row when none exists", async () => {
  const fake = createFakeSupabase({ authUsers: [ownerAuth], row: null });

  const result = await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    clientSnapshot: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyInitialized, false);
  assert.equal(fake.getRow()?.workspace_key, WORKSPACE_KEY);
});

test("bootstrap never overwrites an existing workspace row", async () => {
  const existingSnapshot = { appUsers: [{ email: "owner@apprigate.com", role: "Owner" }], financeTransactions: [{ id: "tx-1" }] };
  const fake = createFakeSupabase({ authUsers: [ownerAuth], row: { workspace_key: WORKSPACE_KEY, snapshot: existingSnapshot } });

  const result = await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    clientSnapshot: { financeTransactions: [] }, // would wipe finance data if it were applied
  });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyInitialized, true);
  assert.deepEqual(fake.getRow().snapshot, existingSnapshot);
});

test("bootstrap preserves unrelated operational snapshot keys", async () => {
  const fake = createFakeSupabase({ authUsers: [ownerAuth], row: null });

  await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    clientSnapshot: {
      financeTransactions: [{ id: "tx-1" }, { id: "tx-2" }],
      vehicles: [{ id: "veh-1" }],
      auditTrail: [{ id: "audit-1" }],
    },
  });

  const written = fake.getRow().snapshot;
  assert.equal(written.financeTransactions.length, 2);
  assert.equal(written.vehicles.length, 1);
  assert.equal(written.auditTrail.length, 1);
});

test("bootstrap strips plaintext credential fields from incoming appUsers/drivers", async () => {
  const fake = createFakeSupabase({ authUsers: [ownerAuth], row: null });

  await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    clientSnapshot: {
      appUsers: [{ email: "owner@apprigate.com", role: "Owner", accessPassword: "should-be-stripped" }],
      drivers: [{ staffId: "drv-1", accessPassword: "also-stripped", password: "also-stripped" }],
    },
  });

  const written = fake.getRow().snapshot;
  for (const u of written.appUsers) {
    assert.equal("accessPassword" in u, false);
    assert.equal("password" in u, false);
  }
  for (const d of written.drivers) {
    assert.equal("accessPassword" in d, false);
    assert.equal("password" in d, false);
  }
});

test("bootstrap maps the Owner appUsers record's actorId to the real Auth user id", async () => {
  const fake = createFakeSupabase({ authUsers: [ownerAuth], row: null });

  await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    clientSnapshot: {},
  });

  const ownerRecord = fake.getRow().snapshot.appUsers.find((u) => u.email === "owner@apprigate.com");
  assert.ok(ownerRecord);
  assert.equal(ownerRecord.actorId, ownerAuth.id);
  assert.equal(ownerRecord.role, "Owner");
  assert.equal(ownerRecord.active, true);
});

test("bootstrap requires the requester to be the Auth Owner", async () => {
  const nonOwner = { id: "auth-2", email: "not-owner@apprigate.com", app_metadata: { role: "Manager" } };
  const fake = createFakeSupabase({ authUsers: [ownerAuth, nonOwner], row: null });

  const result = await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "not-owner@apprigate.com",
    clientSnapshot: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(fake.getRow(), null);
});

test("account created after bootstrap survives a fresh reload of the same row", async () => {
  const fake = createFakeSupabase({ authUsers: [ownerAuth], row: null });

  await bootstrapWorkspace({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    clientSnapshot: {},
  });

  const createResult = await createUser({
    supabase: fake.supabase,
    workspaceKey: WORKSPACE_KEY,
    requesterEmail: "owner@apprigate.com",
    email: "new.manager@apprigate.com",
    name: "New Manager",
    role: "Manager",
    password: "correct horse battery",
  });

  assert.equal(createResult.ok, true);
  const freshRow = fake.getRow();
  assert.ok(freshRow.snapshot.appUsers.some((u) => u.email === "new.manager@apprigate.com"));
});

test("server/client workspace key cannot diverge: resolveServerWorkspaceKey always returns canonical, warns on mismatch", async () => {
  const original = process.env.SUPABASE_WORKSPACE_KEY;
  process.env.SUPABASE_WORKSPACE_KEY = "some-other-key";

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    const resolved = resolveServerWorkspaceKey();
    assert.equal(resolved, LIVE_WORKSPACE_KEY);
    assert.ok(warnings.some((w) => w.includes("some-other-key")), "must warn about the mismatched value");
  } finally {
    console.warn = originalWarn;
    if (original === undefined) delete process.env.SUPABASE_WORKSPACE_KEY;
    else process.env.SUPABASE_WORKSPACE_KEY = original;
  }
});

test("missing workspace row is never reported as a remote-live success (source-pinned)", async () => {
  const source = await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8");
  const missingBranchIndex = source.indexOf("if (!data) {");
  assert.ok(missingBranchIndex !== -1, "loadSupabaseLiveSnapshot must explicitly branch on a missing row");
  const branch = source.slice(missingBranchIndex, missingBranchIndex + 1300);
  assert.match(branch, /ok:\s*false/);
  assert.match(branch, /workspaceMissing:\s*true/);
  assert.match(branch, /source:\s*"workspace-missing"/);
  assert.doesNotMatch(branch, /source:\s*"remote-live"/);
});

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const source = await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8");
  assert.match(source, /\["pending", "counted", "verified", "banked"\]/);
});
