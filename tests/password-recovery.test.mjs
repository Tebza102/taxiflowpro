import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// handlePasswordResetRequest / handlePasswordRecoverySubmit / the
// onAuthStateChange listener are closures defined inside the App() component
// in src/App.jsx (they close over React state and refs, and call the real
// Supabase Auth client), so they cannot be imported and executed directly the
// way api/_lib/* helpers can. This follows the same "source-pinned" pattern
// already established throughout this repo (see tests/fleet-persistence.test.mjs,
// tests/final-sweep.test.mjs): it asserts the exact behavioural shape of the
// shipped source, so a regression - a missing session requirement, a leaked
// "email not found" branch, a password written into the workspace snapshot,
// a missing double-submission guard - fails a test rather than only being
// caught by manual QA.
//
// Scope: this is the surgical password-recovery fix only. It does not touch
// Accounts/Routes/Drivers/Fleet/Finance/CAS/Viewer/workspace-key, which remain
// covered by their own existing test files.

// Normalized to LF once here so every \n-based marker below matches regardless of
// whether the checkout has CRLF line endings (this repo's git config converts LF to
// CRLF on Windows checkouts).
const appSource = (await readFile(new URL("../src/App.jsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const sliceFrom = (source, marker, length = 2200) => {
  const index = source.indexOf(marker);
  assert.ok(index !== -1, `expected to find "${marker}" in source`);
  return source.slice(index, index + length);
};

// ---------------------------------------------------------------------------
// 1 & 2: live-mode request uses Supabase's native resetPasswordForEmail, with
// no authenticated session required to call it.
// ---------------------------------------------------------------------------

test("handlePasswordResetRequest calls supabase.auth.resetPasswordForEmail in live/Supabase mode", () => {
  const fn = sliceFrom(appSource, "const handlePasswordResetRequest = async () => {", 8300);

  assert.match(fn, /if \(authEnabled\) \{/);
  const liveBranchIndex = fn.indexOf("if (authEnabled) {");
  const liveBranchEnd = fn.indexOf("Local/mock auth: there is no real Supabase Auth session");
  const liveBranch = fn.slice(liveBranchIndex, liveBranchEnd);

  assert.match(liveBranch, /supabase\.auth\.resetPasswordForEmail\(normalizedEmail, \{/);
  assert.match(liveBranch, /redirectTo/);
});

test("resetPasswordForEmail is called with no dependency on an authenticated session or the appUsers directory", () => {
  const fn = sliceFrom(appSource, "const handlePasswordResetRequest = async () => {", 8300);
  const liveBranchIndex = fn.indexOf("if (authEnabled) {");
  const liveBranchEnd = fn.indexOf("Local/mock auth: there is no real Supabase Auth session");
  const liveBranch = fn.slice(liveBranchIndex, liveBranchEnd);

  // The live branch must not read authSession/currentUserRecord/appUsers before
  // calling resetPasswordForEmail - Supabase's own API requires no session, and
  // this call path must not add one.
  assert.doesNotMatch(liveBranch, /getAppUsers\(/);
  assert.doesNotMatch(liveBranch, /getAppUserByEmail\(/);
  assert.doesNotMatch(liveBranch, /authSession/);
});

// ---------------------------------------------------------------------------
// 3: neutral response - never discloses whether the email maps to a real
// account.
// ---------------------------------------------------------------------------

test("the live-mode response message is the same neutral copy regardless of whether the email exists, and never branches on account existence", () => {
  const fn = sliceFrom(appSource, "const handlePasswordResetRequest = async () => {", 8300);
  const liveBranchIndex = fn.indexOf("if (authEnabled) {");
  const liveBranchEnd = fn.indexOf("Local/mock auth: there is no real Supabase Auth session");
  const liveBranch = fn.slice(liveBranchIndex, liveBranchEnd);

  assert.match(
    liveBranch,
    /If the account can receive password recovery email, check your inbox for the reset link\./,
  );
  // The only branch is on the network/API `error`, never on "does this email exist".
  assert.doesNotMatch(liveBranch, /not mapped/i);
  assert.doesNotMatch(liveBranch, /account (does not|doesn't) exist/i);
});

test("SignInShell shows the same neutral recovery copy for live/Supabase mode, distinct from the local-auth management-notice copy", () => {
  const fn = sliceFrom(appSource, "function SignInShell({", 4600);

  assert.match(fn, /If the account can receive password recovery email, TaxiFlow will send a secure link/);
  assert.match(
    fn,
    /If the account can receive password recovery email, check your inbox for the reset link\./,
  );
  // The old local-auth-only copy must still exist, gated behind isLocalAuth, not removed.
  assert.match(fn, /Management will reset the password for this account\./);
  assert.match(fn, /isLocalAuth\s*\?/);
});

// ---------------------------------------------------------------------------
// 4: PASSWORD_RECOVERY event enters password-update mode.
// ---------------------------------------------------------------------------

test("onAuthStateChange sets passwordRecoveryMode on a PASSWORD_RECOVERY event", () => {
  const fn = sliceFrom(appSource, "supabase.auth.onAuthStateChange((authEvent, session) => {", 1200);

  assert.match(fn, /if \(authEvent === "PASSWORD_RECOVERY"\) \{/);
  const gateIndex = fn.indexOf('if (authEvent === "PASSWORD_RECOVERY") {');
  const gateBranch = fn.slice(gateIndex, gateIndex + 100);
  assert.match(gateBranch, /setPasswordRecoveryMode\(true\)/);
});

test("passwordRecoveryMode takes priority over the normal authSession routing (recovery is never dropped straight into the app)", () => {
  const recoveryCheckIndex = appSource.indexOf("if (passwordRecoveryMode) {");
  const authSessionCheckIndex = appSource.indexOf("if (!authSession) {");

  assert.ok(recoveryCheckIndex !== -1 && authSessionCheckIndex !== -1);
  assert.ok(
    recoveryCheckIndex < authSessionCheckIndex,
    "the passwordRecoveryMode render branch must be checked before the normal !authSession branch",
  );

  const fn = sliceFrom(appSource, "if (passwordRecoveryMode) {", 700);
  assert.match(fn, /<PasswordRecoveryShell/);
});

// ---------------------------------------------------------------------------
// 5, 6, 7: password update validation and updateUser usage.
// ---------------------------------------------------------------------------

test("handlePasswordRecoverySubmit requires the shared MIN_LIVE_LOGIN_PASSWORD_LENGTH minimum", () => {
  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 1780);

  assert.match(fn, /nextPassword\.length < MIN_LIVE_LOGIN_PASSWORD_LENGTH/);
  assert.match(fn, /Password must be at least \$\{MIN_LIVE_LOGIN_PASSWORD_LENGTH\} characters long\./);
});

test("handlePasswordRecoverySubmit rejects a confirmation mismatch before calling Supabase", () => {
  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 1780);

  const mismatchIndex = fn.indexOf("if (nextPassword !== confirmPassword) {");
  const updateUserIndex = fn.indexOf("supabase.auth.updateUser(");
  assert.ok(mismatchIndex !== -1 && updateUserIndex !== -1);
  assert.ok(mismatchIndex < updateUserIndex, "the confirmation check must happen before calling updateUser");
  assert.match(fn, /Passwords do not match\./);
});

test("handlePasswordRecoverySubmit uses supabase.auth.updateUser to rotate the recovered password", () => {
  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 1780);

  assert.match(fn, /supabase\.auth\.updateUser\(\{ password: nextPassword \}\)/);
});

test("after a successful password update, the recovery session is signed out and the app returns to normal sign-in", () => {
  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 1780);

  const successIndex = fn.indexOf("await supabase.auth.signOut();");
  assert.ok(successIndex !== -1);
  const successBranch = fn.slice(successIndex, successIndex + 400);
  assert.match(successBranch, /setPasswordRecoveryMode\(false\)/);
  assert.match(successBranch, /setAuthSession\(null\)/);
  assert.match(successBranch, /Password updated\. Sign in with your new password\./);
});

// ---------------------------------------------------------------------------
// 8: show/hide password control.
// ---------------------------------------------------------------------------

test("PasswordRecoveryShell has a show/hide toggle wired to both password fields", () => {
  const fn = sliceFrom(appSource, "function PasswordRecoveryShell({", 2360);

  assert.match(fn, /onClick=\{onToggleShowPassword\}/);
  assert.match(fn, /type=\{showPassword \? "text" : "password"\}/);
  // Both the new-password and confirm-password inputs must respect the same toggle.
  const occurrences = [...fn.matchAll(/type=\{showPassword \? "text" : "password"\}/g)];
  assert.equal(occurrences.length, 2, "both password fields must respect the show/hide toggle");
});

test("App-level state resets the recovery password visibility toggle back to hidden after success", () => {
  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 1780);
  assert.match(fn, /setShowRecoveryPassword\(false\)/);
});

// ---------------------------------------------------------------------------
// 9: recovered password never enters workspace_snapshots.
// ---------------------------------------------------------------------------

test("the recovered password is never written into setSnapshot/workspace_snapshots - only supabase.auth.updateUser touches it", () => {
  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 1780);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "handlePasswordRecoverySubmit must never call setSnapshot()");
  assert.doesNotMatch(fn, /accessPassword/);
  assert.doesNotMatch(fn, /commitLiveSnapshotMutation/);
});

test("the live-mode reset-request branch never touches setSnapshot either (Supabase Auth handles the entire live recovery flow)", () => {
  const fn = sliceFrom(appSource, "const handlePasswordResetRequest = async () => {", 8300);
  const liveBranchIndex = fn.indexOf("if (authEnabled) {");
  const liveBranchEnd = fn.indexOf("Local/mock auth: there is no real Supabase Auth session");
  const liveBranch = fn.slice(liveBranchIndex, liveBranchEnd);

  assert.doesNotMatch(liveBranch, /\bsetSnapshot\(/);
});

test("REGRESSION: the local/mock-auth management-notice flow (setSnapshot-based) is unchanged and still reachable when Supabase Auth is not configured", () => {
  const fn = sliceFrom(appSource, "const handlePasswordResetRequest = async () => {", 8300);

  assert.match(fn, /Local\/mock auth: there is no real Supabase Auth session/);
  assert.match(fn, /setSnapshot\(\(current\) => \{/);
  assert.match(fn, /passwordResetRequests: \[nextRequest, \.\.\.\(current\.passwordResetRequests \?\? \[\]\)\]/);
});

// ---------------------------------------------------------------------------
// 10: duplicate-submission guards.
// ---------------------------------------------------------------------------

test("handlePasswordResetRequest guards the live-mode branch against duplicate submissions", () => {
  assert.match(appSource, /const \[passwordResetRequestSubmitting, setPasswordResetRequestSubmitting\] = useState\(false\);/);

  const fn = sliceFrom(appSource, "const handlePasswordResetRequest = async () => {", 8300);
  const liveBranchIndex = fn.indexOf("if (authEnabled) {");
  const liveBranch = fn.slice(liveBranchIndex, liveBranchIndex + 600);

  assert.match(liveBranch, /if \(passwordResetRequestSubmitting\) {\s*return;\s*}/);
  assert.match(liveBranch, /setPasswordResetRequestSubmitting\(true\)/);
});

test("the sign-in screen's reset-request button is disabled while a request is in flight and shows Sending...", () => {
  const fn = sliceFrom(appSource, "function SignInShell({", 4600);

  assert.match(fn, /disabled=\{submitting \|\| passwordResetSubmitting \|\| !String\(email \?\? ""\)\.trim\(\)\}/);
  assert.match(fn, /\{passwordResetSubmitting \? "Sending\.\.\." : "Send reset request"\}/);
});

test("handlePasswordRecoverySubmit guards against duplicate submissions", () => {
  assert.match(appSource, /const \[passwordRecoverySubmitting, setPasswordRecoverySubmitting\] = useState\(false\);/);

  const fn = sliceFrom(appSource, "const handlePasswordRecoverySubmit = async (event) => {", 780);
  assert.match(fn, /if \(passwordRecoverySubmitting\) {\s*return;\s*}/);
  assert.match(fn, /setPasswordRecoverySubmitting\(true\)/);
});

test("the password-update submit button is disabled while submitting", () => {
  const fn = sliceFrom(appSource, "function PasswordRecoveryShell({", 2360);
  assert.match(fn, /disabled=\{submitting\}/);
  assert.match(fn, /\{submitting \? "Updating\.\.\." : "Update password"\}/);
});

// ---------------------------------------------------------------------------
// 12: Finance contract untouched.
// ---------------------------------------------------------------------------

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const dataGatewaySource = (
    await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  assert.match(dataGatewaySource, /\["pending", "counted", "verified", "banked"\]/);
});
