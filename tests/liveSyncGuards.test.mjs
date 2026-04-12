import assert from "node:assert/strict";
import {
  LIVE_CONFLICT_MESSAGE,
  createLiveConflictError,
  detectLiveWriteConflict,
  shouldBypassLiveCacheRequest,
} from "../src/lib/liveSyncGuards.js";

const checks = [
  () => {
    const conflict = detectLiveWriteConflict(
      "2026-04-11T08:00:00.000Z",
      "2026-04-11T08:05:00.000Z",
    );

    assert.ok(conflict);
    assert.equal(conflict.code, "LIVE_SNAPSHOT_CONFLICT");
    assert.equal(conflict.message, LIVE_CONFLICT_MESSAGE);
    assert.equal(conflict.reason, "server-newer-than-local");
    assert.equal(conflict.action, "refresh");
  },
  () => {
    const conflict = detectLiveWriteConflict(null, "2026-04-11T08:05:00.000Z");

    assert.ok(conflict);
    assert.equal(conflict.reason, "missing-live-baseline");
  },
  () => {
    const conflict = detectLiveWriteConflict(
      "2026-04-11T08:05:00.000Z",
      "2026-04-11T08:05:00.000Z",
    );

    assert.equal(conflict, null);
  },
  () => {
    const conflict = createLiveConflictError({
      localVersion: "local-v",
      serverVersion: "server-v",
      reason: "custom-reason",
    });

    assert.deepEqual(conflict, {
      code: "LIVE_SNAPSHOT_CONFLICT",
      message: LIVE_CONFLICT_MESSAGE,
      localVersion: "local-v",
      serverVersion: "server-v",
      reason: "custom-reason",
      action: "refresh",
    });
  },
  () => {
    assert.equal(
      shouldBypassLiveCacheRequest("https://example.supabase.co/rest/v1/workspace_snapshots"),
      true,
    );
    assert.equal(
      shouldBypassLiveCacheRequest("https://example.com/api/data?workspace_key=taxiflow-live"),
      true,
    );
    assert.equal(
      shouldBypassLiveCacheRequest("https://example.com/assets/index.js", "bypass"),
      true,
    );
    assert.equal(
      shouldBypassLiveCacheRequest("https://example.com/assets/index.js"),
      false,
    );
  },
];

checks.forEach((check) => check());
console.log("liveSyncGuards checks passed");
