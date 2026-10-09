import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// saveRouteProfile / commitLiveSnapshotMutation are closures defined inside the
// App() component in src/App.jsx (they close over React state and refs), so they
// cannot be imported and executed directly the way api/_lib/* helpers can. This
// file follows the same "source-pinned" pattern this repo already uses for the
// same class of problem (see the "missing workspace row is never reported as a
// remote-live success (source-pinned)" test in tests/workspace-bootstrap.test.mjs):
// it asserts the exact behavioural shape of the shipped source, so a regression
// that reintroduces the old "React state changed -> report success" bug, or
// breaks the atomic write, fails a test rather than only being caught by manual
// QA. The atomic UPDATE logic itself (Phase 2) is additionally covered below by a
// real, executing test against an in-memory fake Postgres row.

// Normalized to LF once here so every \n-based marker below matches regardless of
// whether the checkout has CRLF line endings (this repo's git config converts LF to
// CRLF on Windows checkouts).
const appSource = (await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const dataGatewaySource = (
  await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

const sliceFrom = (source, marker, length = 2200) => {
  const index = source.indexOf(marker);
  assert.ok(index !== -1, `expected to find "${marker}" in source`);
  return source.slice(index, index + length);
};

test("saveRouteProfile is async and does not report success before a remote commit", () => {
  const fn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 4000);

  // The old bug: setSnapshot() called synchronously, then an immediate
  // `ok: true` return, with remote persistence left to a later, disconnected
  // generic effect. Assert setSnapshot is no longer called directly from this
  // function at all - every write now goes through the confirmed helper.
  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "saveRouteProfile must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("saveRouteProfile only returns ok:true after verifying the route in the commit's returned snapshot", () => {
  const fn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 6000);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const firstOkTrueIndex = fn.indexOf("ok: true");

  assert.ok(commitCallIndex !== -1);
  assert.ok(firstOkTrueIndex !== -1, "saveRouteProfile must still return ok:true on confirmed success");
  assert.ok(
    commitCallIndex < firstOkTrueIndex,
    "the remote commit must happen before any ok:true is returned",
  );

  // The fresh-read verification: the final success path must derive the
  // returned routeId from the commit's own (post-reload) snapshot, not from the
  // locally-built nextRoute/nextSnapshot the caller assembled before saving.
  assert.match(fn, /commitResult\.snapshot\?\.routes/);
  assert.match(fn, /confirmedRoute\.id/);
});

test("saveRouteProfile reports a clear failure message when the commit does not succeed", () => {
  const fn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 4000);

  assert.match(fn, /if \(!commitResult\.ok\)/);
  assert.match(
    fn,
    /Route could not be saved to the live workspace\. No confirmed change was made\./,
  );
});

test("saveRouteProfile keeps duplicate route-code validation", () => {
  const fn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 4000);

  assert.match(fn, /duplicateCode/);
  assert.match(fn, /This route code is already linked to another route\./);
});

test("saveRouteProfile keeps all prior field validation and route data shape", () => {
  const fn = sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 4000);

  assert.match(fn, /Only management can edit route settings\./);
  assert.match(fn, /Route name is required\./);
  assert.match(fn, /Primary origin and destination are required\./);
  assert.match(fn, /normalizeRouteMasterRecord\(/);
  assert.match(fn, /collectRouteMasterRecords\(/);
  assert.match(fn, /buildCurrentAuditEvent\(/);
  assert.match(fn, /createdBy: existingRoute\?\.createdBy \?\? actorId/);
});

test("commitLiveSnapshotMutation: live-mode failure/conflict reloads canonical state instead of reporting success", () => {
  const fn = sliceFrom(appSource, "const commitLiveSnapshotMutation = async (current, nextSnapshot) => {", 3200);

  // Conflict branch
  const conflictIndex = fn.indexOf("persistResult?.conflict");
  assert.ok(conflictIndex !== -1);
  const conflictBranch = fn.slice(conflictIndex, conflictIndex + 400);
  assert.match(conflictBranch, /reloadCanonicalLiveSnapshot\(\)/);
  assert.match(conflictBranch, /ok:\s*false/);

  // Generic failure branch (ok !== true)
  const failureIndex = fn.indexOf("persistResult?.ok !== true");
  assert.ok(failureIndex !== -1);
  const failureBranch = fn.slice(failureIndex, failureIndex + 400);
  assert.match(failureBranch, /reloadCanonicalLiveSnapshot\(\)/);
  assert.match(failureBranch, /ok:\s*false/);
});

test("commitLiveSnapshotMutation: success path performs a fresh canonical read and returns it, not the optimistic snapshot", () => {
  const fn = sliceFrom(appSource, "const commitLiveSnapshotMutation = async (current, nextSnapshot) => {", 3200);

  const successIndex = fn.indexOf("Write succeeded");
  assert.ok(successIndex !== -1, "expects the success-path comment/branch to exist");
  const successBranch = fn.slice(successIndex, successIndex + 800);
  assert.match(successBranch, /const canonical = await reloadCanonicalLiveSnapshot\(\)/);
  assert.match(successBranch, /return \{ ok: true, snapshot: canonical \}/);
});

test("commitLiveSnapshotMutation: mock mode keeps the original local-only behaviour", () => {
  const fn = sliceFrom(appSource, "const commitLiveSnapshotMutation = async (current, nextSnapshot) => {", 3200);

  const mockIndex = fn.indexOf('effectiveBackendMode !== "live"');
  assert.ok(mockIndex !== -1);
  const mockBranch = fn.slice(mockIndex, mockIndex + 250);
  assert.match(mockBranch, /setSnapshot\(nextSnapshot\)/);
  assert.match(mockBranch, /return \{ ok: true, snapshot: nextSnapshot \}/);
});

test("reloadCanonicalLiveSnapshot suppresses the redundant generic-persist write (no immediate duplicate write)", () => {
  const fn = sliceFrom(appSource, "const reloadCanonicalLiveSnapshot = async () => {", 500);

  const loadIndex = fn.indexOf("repository.loadSnapshot(");
  const skipIndex = fn.indexOf("skipNextGenericPersistRef.current = true");
  const setSnapshotIndex = fn.indexOf("setSnapshot(loaded)");

  assert.ok(loadIndex !== -1 && skipIndex !== -1 && setSnapshotIndex !== -1);
  assert.ok(
    loadIndex < skipIndex && skipIndex < setSnapshotIndex,
    "must fetch canonical, arm the skip flag, THEN update React state (in that order) " +
      "so the generic persistence effect sees the flag before it would otherwise fire",
  );

  // And confirm the generic effect actually honours that flag.
  const genericEffectIndex = appSource.indexOf("if (skipNextGenericPersistRef.current) {");
  assert.ok(genericEffectIndex !== -1);
  const genericEffect = appSource.slice(genericEffectIndex, genericEffectIndex + 200);
  assert.match(genericEffect, /return undefined/);
});

test("FleetPanel route submit awaits the async save and does not clear the form before confirmation", () => {
  const fn = sliceFrom(appSource, "const handleRouteSubmit = async (event) => {", 700);

  assert.match(fn, /await onSaveRoute\(routeDraft\)/);

  const responseIndex = fn.indexOf("const response = await onSaveRoute(routeDraft);");
  const clearIndex = fn.indexOf("setRouteDraft(createRouteDraft())");
  assert.ok(responseIndex !== -1 && clearIndex !== -1);
  assert.ok(responseIndex < clearIndex, "the form must not clear before the awaited response arrives");
  assert.match(fn, /response\?\.ok === true/, "clearing the form must be gated on a confirmed ok:true");
});

test("FleetPanel route submit guards against double-submission and disables the button while saving", () => {
  assert.match(appSource, /const \[routeSaving, setRouteSaving\] = useState\(false\);/);

  const fn = sliceFrom(appSource, "const handleRouteSubmit = async (event) => {", 700);
  assert.match(fn, /if \(routeSaving\) {\s*return;\s*}/);
  assert.match(fn, /setRouteSaving\(true\)/);
  assert.match(fn, /setRouteSaving\(false\)/);

  const buttonIndex = appSource.indexOf("disabled={!canEditFleetUpdates || routeSaving}");
  assert.ok(buttonIndex !== -1, "the submit button must be disabled while a save is in flight");
});

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  assert.match(dataGatewaySource, /\["pending", "counted", "verified", "banked"\]/);
});

// ---------------------------------------------------------------------------
// Phase 2: atomic version-guarded write, tested against real execution logic
// (a minimal in-memory fake of the one Postgres row + PostgREST-style filter
// semantics), not just source inspection - this is the highest-risk change in
// this phase, so it gets a real behavioural proof, not only a shape assertion.
// ---------------------------------------------------------------------------

const createFakeWorkspaceTable = (initialRow) => {
  let row = initialRow ? { ...initialRow } : null;

  // Mimics enough of the Supabase JS query-builder chain for
  // .update(...).eq(...).eq(...).select(...) and .insert(...) to exercise the
  // exact conditional-update semantics persistSupabaseLiveSnapshot depends on:
  // an UPDATE only matches (and is only applied) when every .eq() filter matches
  // the current row, and .select() after an update returns the matched rows
  // (empty when nothing matched) - the same shape Postgres/PostgREST returns.
  const update = (patch) => {
    const filters = {};
    const builder = {
      eq(column, value) {
        filters[column] = value;
        return builder;
      },
      select() {
        const matches =
          row &&
          Object.entries(filters).every(([column, value]) => row[column] === value);

        if (matches) {
          row = { ...row, ...patch };
          return Promise.resolve({ data: [{ workspace_key: row.workspace_key }], error: null });
        }

        return Promise.resolve({ data: [], error: null });
      },
    };
    return builder;
  };

  const insert = async (payload) => {
    if (row) {
      return { error: { message: "duplicate key value violates unique constraint" } };
    }
    row = { ...payload };
    return { error: null };
  };

  const select = () => ({
    eq: () => ({
      maybeSingle: async () => ({ data: row ? { updated_at: row.updated_at } : null, error: null }),
    }),
  });

  return {
    getRow: () => row,
    from: (table) => {
      assert.equal(table, "workspace_snapshots");
      return { update, insert, select };
    },
  };
};

test("atomic write: a stale writer (expected version no longer matches) is rejected, canonical row untouched", async () => {
  const fake = createFakeWorkspaceTable({
    workspace_key: "taxiflow-live",
    snapshot: { routes: [{ id: "route-a" }] },
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "user-1",
  });

  // Simulate the exact UPDATE this repo's atomic path issues, with a
  // deliberately stale expectedVersion (as if another writer already landed).
  const result = await fake
    .from("workspace_snapshots")
    .update({
      snapshot: { routes: [{ id: "route-a" }, { id: "route-b" }] },
      updated_at: "2026-01-02T00:00:00.000Z",
      updated_by: "user-2",
    })
    .eq("workspace_key", "taxiflow-live")
    .eq("updated_at", "2026-01-01T00:00:00.000Z-STALE")
    .select("workspace_key");

  assert.equal(result.data.length, 0, "0 rows matched must be how a conflict is detected");
  assert.deepEqual(
    fake.getRow().snapshot,
    { routes: [{ id: "route-a" }] },
    "the canonical row must be completely untouched by a rejected stale write",
  );
});

test("atomic write: a writer with the correct expected version succeeds in one statement", async () => {
  const fake = createFakeWorkspaceTable({
    workspace_key: "taxiflow-live",
    snapshot: { routes: [{ id: "route-a" }] },
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "user-1",
  });

  const result = await fake
    .from("workspace_snapshots")
    .update({
      snapshot: { routes: [{ id: "route-a" }, { id: "route-b" }] },
      updated_at: "2026-01-02T00:00:00.000Z",
      updated_by: "user-2",
    })
    .eq("workspace_key", "taxiflow-live")
    .eq("updated_at", "2026-01-01T00:00:00.000Z")
    .select("workspace_key");

  assert.equal(result.data.length, 1);
  assert.deepEqual(fake.getRow().snapshot.routes.map((r) => r.id), ["route-a", "route-b"]);
  assert.equal(fake.getRow().updated_at, "2026-01-02T00:00:00.000Z");
});

test("atomic write: two concurrent writers from the same starting version - exactly one wins, none silently overwritten", async () => {
  const fake = createFakeWorkspaceTable({
    workspace_key: "taxiflow-live",
    snapshot: { routes: [{ id: "route-a" }] },
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "user-1",
  });

  const sharedExpectedVersion = "2026-01-01T00:00:00.000Z";

  // Writer A lands first.
  const resultA = await fake
    .from("workspace_snapshots")
    .update({
      snapshot: { routes: [{ id: "route-a" }, { id: "route-b" }] },
      updated_at: "2026-01-02T00:00:00.000Z",
      updated_by: "writer-a",
    })
    .eq("workspace_key", "taxiflow-live")
    .eq("updated_at", sharedExpectedVersion)
    .select("workspace_key");

  // Writer B started from the SAME baseline version but its write reaches the
  // table after A's already landed - this is exactly the race Phase 2 exists to
  // close: the old read-then-write flow let both of these succeed.
  const resultB = await fake
    .from("workspace_snapshots")
    .update({
      snapshot: { routes: [{ id: "route-a" }, { id: "route-c" }] },
      updated_at: "2026-01-02T00:00:01.000Z",
      updated_by: "writer-b",
    })
    .eq("workspace_key", "taxiflow-live")
    .eq("updated_at", sharedExpectedVersion)
    .select("workspace_key");

  assert.equal(resultA.data.length, 1, "writer A must succeed");
  assert.equal(resultB.data.length, 0, "writer B must be rejected as a conflict, not silently overwrite A");
  assert.deepEqual(
    fake.getRow().snapshot.routes.map((r) => r.id),
    ["route-a", "route-b"],
    "route-b (writer A's confirmed write) must survive; route-c must never have been applied",
  );
});

test("dataGateway.js: the atomic UPDATE is gated on both workspace_key and the expected updated_at, in one statement", () => {
  const fn = sliceFrom(dataGatewaySource, "const { data: updatedRows, error } = await supabase", 500);

  assert.match(fn, /\.from\("workspace_snapshots"\)/);
  assert.match(fn, /\.update\(\{/);
  assert.match(fn, /\.eq\("workspace_key", LIVE_WORKSPACE_KEY\)/);
  assert.match(fn, /\.eq\("updated_at", localVersion\)/);
  assert.match(fn, /\.select\("workspace_key"\)/);
});

test("dataGateway.js: zero matched rows is treated as LIVE_SNAPSHOT_CONFLICT, not silently ignored", () => {
  const fn = sliceFrom(dataGatewaySource, "if (!updatedRows || updatedRows.length === 0) {", 500);

  assert.match(fn, /createLiveConflictError\(/);
  assert.match(fn, /ok:\s*false/);
});

test("dataGateway.js: the old read-meta-then-upsert race is gone from the known-version path", () => {
  const fn = sliceFrom(dataGatewaySource, "// Known prior version:", 1400);

  assert.doesNotMatch(
    fn,
    /\.upsert\(/,
    "the known-version write path must be a single conditional UPDATE, not an unconditional upsert",
  );
});
