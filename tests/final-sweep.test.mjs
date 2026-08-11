import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Phase G of the production-hardening pass: a sweep of every remaining
// setSnapshot(...) call in src/App.jsx for the "React state changed -> report
// success" pattern already fixed for Route/Driver/Fleet/Finance/account
// lifecycle. resolvePasswordResetRequest (management marking a password-reset
// request as handled) was the one remaining reachable UNCONFIRMED BUSINESS
// MUTATION found by that sweep; this file follows the same source-pinned
// pattern as tests/fleet-persistence.test.mjs to cover its fix.
//
// Everything else found by the sweep was either:
//   - SAFE LOCAL UI STATE (driver-terminal "which vehicle/route" display
//     pointers, canonical-reload reads, already-confirmed mock-mode branches,
//     the expense-preset category/description catalog which is config, not a
//     financial transaction), or
//   - genuinely unreachable dead code: requestAdminModuleAccess /
//     reviewAdminModuleAccess / setAdminModuleAccess are only ever invoked by
//     AdminEditAccessPanel, which is defined but never rendered anywhere in
//     the component tree, so no user can reach that write path today.
// Neither category needed a code change; see the final hardening report for
// the full account of what was reviewed.

const appSource = (await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const sliceFrom = (source, marker, length = 2200) => {
  const index = source.indexOf(marker);
  assert.ok(index !== -1, `expected to find "${marker}" in source`);
  return source.slice(index, index + length);
};

test("resolvePasswordResetRequest is async and does not report success before a remote commit", () => {
  const fn = sliceFrom(appSource, "const resolvePasswordResetRequest = async (requestId) => {", 3000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "resolvePasswordResetRequest must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
});

test("resolvePasswordResetRequest only returns ok:true after verifying the request is resolved in the commit's returned snapshot", () => {
  const fn = sliceFrom(appSource, "const resolvePasswordResetRequest = async (requestId) => {", 3000);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const firstOkTrueIndex = fn.indexOf("ok: true");
  assert.ok(commitCallIndex !== -1 && firstOkTrueIndex !== -1);
  assert.ok(commitCallIndex < firstOkTrueIndex, "the remote commit must happen before any ok:true is returned");

  assert.match(fn, /commitResult\.snapshot\?\.passwordResetRequests/);
  assert.match(fn, /confirmedRequest\.status !== "resolved"/);
});

test("resolvePasswordResetRequest keeps the management-only gate and the already-resolved guard", () => {
  const fn = sliceFrom(appSource, "const resolvePasswordResetRequest = async (requestId) => {", 3000);

  assert.match(fn, /Only management can close password reset requests\./);
  assert.match(fn, /This password reset request is already marked as handled\./);
  assert.match(fn, /Password reset request not found\./);
});

test("SettingsPanel awaits the async resolve call and guards against double submission", () => {
  assert.match(appSource, /const \[resolvingRequestId, setResolvingRequestId\] = useState\(null\);/);

  const fn = sliceFrom(appSource, "const handleResolvePasswordResetRequest = async (requestId) => {", 400);
  assert.match(fn, /if \(resolvingRequestId\) {\s*return;\s*}/);
  assert.match(fn, /await onResolvePasswordResetRequest\(requestId\)/);

  assert.match(appSource, /onClick=\{\(\) => handleResolvePasswordResetRequest\(request\.id\)\}/);
});

test("REGRESSION: requestAdminModuleAccess/reviewAdminModuleAccess/setAdminModuleAccess remain unreachable (AdminEditAccessPanel is defined but never rendered)", () => {
  assert.match(appSource, /function AdminEditAccessPanel\(\{/);
  assert.doesNotMatch(
    appSource,
    /<AdminEditAccessPanel/,
    "if AdminEditAccessPanel is ever wired into the render tree, requestAdminModuleAccess/" +
      "reviewAdminModuleAccess/setAdminModuleAccess must be converted to the confirmed " +
      "commitLiveSnapshotMutation pattern before that happens - see the final hardening report",
  );
});

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const dataGatewaySource = (
    await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  assert.match(dataGatewaySource, /\["pending", "counted", "verified", "banked"\]/);
});
