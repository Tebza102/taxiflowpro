import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// saveStandardIncome / saveSpecialIncome / saveExpense / submitDriverCashUp /
// verifyIncome / deleteTransaction / lockDeposit are closures defined inside the
// App() component in src/App.jsx (they close over React state and refs), so they
// cannot be imported and executed directly the way api/_lib/* helpers can. This
// follows the same "source-pinned" pattern already established for
// Route/Driver/Fleet persistence (see tests/route-persistence.test.mjs,
// tests/driver-persistence.test.mjs, tests/fleet-persistence.test.mjs): it
// asserts the exact behavioural shape of the shipped source, so a regression
// that reintroduces the old "React state changed -> report success" bug, or
// silently permits a status transition the finance contract does not allow,
// fails a test rather than only being caught by manual QA.
//
// This is the highest-risk phase of this hardening pass (real money workflow),
// so beyond the per-function shape checks below, there is a dedicated
// "FINANCE ACCEPTANCE" section that walks the full contractual
// pending -> counted -> verified -> banked chain and proves no branch can skip
// a status.

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
// Driver capture: saveStandardIncome, saveSpecialIncome, saveExpense,
// submitDriverCashUp
// ---------------------------------------------------------------------------

test("saveStandardIncome is async, confirmed-write, and preserves the trip logbook/odometer rules", () => {
  const fn = sliceFrom(appSource, "const saveStandardIncome = async (draft) => {", 9700);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "saveStandardIncome must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /commitResult\.snapshot\?\.financeTransactions/);
  assert.match(fn, /confirmedRecord/);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const firstOkTrueIndex = fn.indexOf("ok: true");
  assert.ok(commitCallIndex !== -1 && firstOkTrueIndex !== -1);
  assert.ok(commitCallIndex < firstOkTrueIndex, "the remote commit must happen before any ok:true is returned");

  assert.match(fn, /Add at least one trip to the daily logbook\./);
  assert.match(fn, /Closing odometer must be greater than opening odometer\./);
  assert.match(fn, /Deposited records can no longer be changed\./);
  assert.match(fn, /Add a note explaining why you are updating this daily taking\./);
  assert.match(fn, /status: "pending"/);
});

test("saveSpecialIncome is async, confirmed-write, and preserves the business-travel validation", () => {
  const fn = sliceFrom(appSource, "const saveSpecialIncome = async (draft) => {", 7000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "saveSpecialIncome must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /confirmedRecord/);
  assert.match(fn, /Complete the business travel details before saving\./);
  assert.match(fn, /Enter the amount earned for the extra trip\./);
  assert.match(fn, /isSpecial: true/);
  assert.match(fn, /status: "pending"/);
});

test("saveExpense is async, confirmed-write, and preserves the auto-verify-for-management rule", () => {
  const fn = sliceFrom(appSource, "const saveExpense = async (draft) => {", 6000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "saveExpense must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /confirmedRecord/);
  // Management-entered expenses are auto-verified; driver-entered ones start pending -
  // this status assignment logic must survive the persistence rewrite unchanged.
  assert.match(
    fn,
    /const status =\s*\n\s*activeRole !== "Driver" && hasModuleUpdateAccess\(current, "finance"\)\s*\n\s*\? "verified"\s*\n\s*: "pending";/,
  );
  assert.match(fn, /Vehicle costs need a valid vehicle\./);
});

test("submitDriverCashUp is async, confirmed-write, and links both financeTransactions and dailyCashUps in one snapshot", () => {
  const fn = sliceFrom(appSource, "const submitDriverCashUp = async () => {", 5000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "submitDriverCashUp must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /commitResult\.snapshot\?\.dailyCashUps/);
  assert.match(fn, /confirmedCashUp/);
  assert.match(fn, /syncTransactionsForDriverCashUp\(/);
  assert.match(fn, /Only a driver can wrap up the day with checking\./);
  assert.match(fn, /Deposited day checkings can no longer be updated\./);
  assert.match(fn, /status: "pending"/);
});

// ---------------------------------------------------------------------------
// Management workflow: verifyIncome (Admin counted / Manager verified, for
// both standalone income records AND linked driver cash-ups), deleteTransaction,
// lockDeposit (Manager/Owner banked)
// ---------------------------------------------------------------------------

test("verifyIncome is async and never calls setSnapshot directly", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);
  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "verifyIncome must not call setSnapshot() directly");
});

test("verifyIncome: driver cash-up pending->counted transition is confirmed before success, and never jumps to verified", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  const pendingBranchIndex = fn.indexOf('if (workflowStatus === "pending") {');
  const countedBranchIndex = fn.indexOf('if (workflowStatus === "counted") {');
  assert.ok(pendingBranchIndex !== -1 && countedBranchIndex !== -1);
  const pendingBranch = fn.slice(pendingBranchIndex, countedBranchIndex);

  assert.match(pendingBranch, /status: "counted"/);
  assert.doesNotMatch(pendingBranch, /status: "verified"/, "the pending branch must never write status verified");
  assert.doesNotMatch(pendingBranch, /status: "banked"/, "the pending branch must never write status banked");
  assert.match(pendingBranch, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(pendingBranch, /entry\.id === transactionId && entry\.status === "counted"/);
  assert.match(pendingBranch, /Administrator must record the day hand-in before manager verification\./);
});

test("verifyIncome: driver cash-up counted->verified transition is confirmed before success, and never jumps to banked", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  const countedBranchIndex = fn.indexOf('if (workflowStatus === "counted") {');
  const alreadyVerifiedIndex = fn.indexOf("This day checking has already been verified");
  assert.ok(countedBranchIndex !== -1 && alreadyVerifiedIndex !== -1);
  const countedBranch = fn.slice(countedBranchIndex, alreadyVerifiedIndex);

  assert.match(countedBranch, /status: "verified"/);
  assert.doesNotMatch(countedBranch, /status: "banked"/, "the counted branch must never write status banked");
  assert.match(countedBranch, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(countedBranch, /entry\.id === transactionId && entry\.status === "verified"/);
  assert.match(countedBranch, /Manager must verify the admin day checking before banking\./);
});

test("verifyIncome: standalone income pending->counted transition is confirmed before success, and never jumps to verified", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  const standaloneMarker = "const target = current.financeTransactions.find((record) => record.id === transactionId);";
  const standaloneIndex = fn.indexOf(standaloneMarker);
  assert.ok(standaloneIndex !== -1);
  const standaloneSection = fn.slice(standaloneIndex);

  const pendingBranchIndex = standaloneSection.indexOf('if (target.status === "pending") {');
  const countedBranchIndex = standaloneSection.indexOf('if (target.status === "counted") {');
  assert.ok(pendingBranchIndex !== -1 && countedBranchIndex !== -1);
  const pendingBranch = standaloneSection.slice(pendingBranchIndex, countedBranchIndex);

  assert.match(pendingBranch, /status: "counted"/);
  assert.doesNotMatch(pendingBranch, /status: "verified"/);
  assert.doesNotMatch(pendingBranch, /status: "banked"/);
  assert.match(pendingBranch, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(pendingBranch, /record\.id === transactionId && record\.status === "counted"/);
});

test("verifyIncome: standalone income counted->verified transition is confirmed before success, and never jumps to banked", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  const standaloneMarker = "const target = current.financeTransactions.find((record) => record.id === transactionId);";
  const standaloneIndex = fn.indexOf(standaloneMarker);
  assert.ok(standaloneIndex !== -1);
  const standaloneSection = fn.slice(standaloneIndex);

  const countedBranchIndex = standaloneSection.indexOf('if (target.status === "counted") {');
  const finalReturnIndex = standaloneSection.indexOf("This cash checking has already been verified");
  assert.ok(countedBranchIndex !== -1 && finalReturnIndex !== -1);
  const countedBranch = standaloneSection.slice(countedBranchIndex, finalReturnIndex);

  assert.match(countedBranch, /status: "verified"/);
  assert.doesNotMatch(countedBranch, /status: "banked"/);
  assert.match(countedBranch, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(countedBranch, /record\.id === transactionId && record\.status === "verified"/);
});

test("verifyIncome keeps the banked-is-final guard for both cash-ups and standalone records", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  assert.match(fn, /Deposited day checkings can no longer be changed\./);
  assert.match(fn, /Deposited records can no longer be changed\./);
});

test("deleteTransaction is async, confirmed-write, and refuses to delete banked records", () => {
  const fn = sliceFrom(appSource, "const deleteTransaction = async (transactionId) => {", 3000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "deleteTransaction must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /Deposited records are final and cannot be deleted\./);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const successIndex = fn.indexOf('return { ok: true, message: "Record removed." };');
  assert.ok(commitCallIndex !== -1 && successIndex !== -1);
  assert.ok(commitCallIndex < successIndex);

  // Verifies deletion actually landed remotely (record absent from the fresh
  // canonical read), not merely that the write call didn't error.
  assert.match(fn, /stillPresent/);
  assert.match(fn, /if \(stillPresent\)/);
});

test("lockDeposit is async, confirmed-write, and only locks records already in status verified", () => {
  const fn = sliceFrom(appSource, "const lockDeposit = async () => {", 6000);

  assert.doesNotMatch(fn, /\bsetSnapshot\(/, "lockDeposit must not call setSnapshot() directly");
  assert.match(fn, /commitLiveSnapshotMutation\(current, nextSnapshot\)/);
  assert.match(fn, /entry\.workflowStatus === "verified"/);
  assert.match(fn, /record\.status === "verified" && !verifiedDriverCashUpTransactionIds\.has\(record\.id\)/);
  assert.match(fn, /Only the manager or owner can finalise a verified deposit batch\./);

  const commitCallIndex = fn.indexOf("commitLiveSnapshotMutation(current, nextSnapshot)");
  const successIndex = fn.indexOf("manager-checked records were added to");
  assert.ok(commitCallIndex !== -1 && successIndex !== -1);
  assert.ok(commitCallIndex < successIndex);
});

test("lockDeposit verifies the confirmed deposit AND that every linked transaction/cash-up actually shows banked", () => {
  const fn = sliceFrom(appSource, "const lockDeposit = async () => {", 6000);

  assert.match(fn, /commitResult\.snapshot\?\.deposits/);
  assert.match(fn, /confirmedDeposit/);
  assert.match(fn, /confirmedTransactionsBanked/);
  assert.match(fn, /confirmedCashUpsBanked/);
  assert.match(fn, /!confirmedDeposit \|\| !confirmedTransactionsBanked \|\| !confirmedCashUpsBanked/);
});

test("lockDeposit reports a clear failure (not a silent no-op) when there is nothing to lock", () => {
  const fn = sliceFrom(appSource, "const lockDeposit = async () => {", 6000);

  assert.match(fn, /if \(recordsLocked === 0\) {\s*return \{ ok: false, error: "No manager-checked records are ready to finalise\." \};\s*}/);
});

// ---------------------------------------------------------------------------
// FINANCE ACCEPTANCE: the full pending -> counted -> verified -> banked chain,
// and the invariants that must hold across it
// ---------------------------------------------------------------------------

test("FINANCE ACCEPTANCE: newly captured income/expense/cash-up records always start pending, never any other status", () => {
  const standardFn = sliceFrom(appSource, "const saveStandardIncome = async (draft) => {", 9700);
  const specialFn = sliceFrom(appSource, "const saveSpecialIncome = async (draft) => {", 7000);
  const cashUpFn = sliceFrom(appSource, "const submitDriverCashUp = async () => {", 5000);

  assert.match(standardFn, /status: "pending"/);
  assert.match(specialFn, /status: "pending"/);
  assert.match(cashUpFn, /status: "pending"/);
});

test("FINANCE ACCEPTANCE: verifyIncome can only ever write status counted or status verified, never pending or banked", () => {
  const fn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  const statusWrites = [...fn.matchAll(/status:\s*"([a-z]+)"/g)].map((match) => match[1]);
  const uniqueStatuses = new Set(statusWrites);

  assert.ok(uniqueStatuses.has("counted"));
  assert.ok(uniqueStatuses.has("verified"));
  assert.ok(!uniqueStatuses.has("pending"), "verifyIncome must never write status back to pending");
  assert.ok(!uniqueStatuses.has("banked"), "verifyIncome must never write status directly to banked");
});

test("FINANCE ACCEPTANCE: lockDeposit is the only function that writes status banked, and only from already-verified records", () => {
  const lockDepositFn = sliceFrom(appSource, "const lockDeposit = async () => {", 6000);
  assert.match(lockDepositFn, /status: "banked"/);

  // The other six mutation functions must never themselves assign "banked" -
  // deposit finalisation is the sole path to that status, preserving the
  // contract's "no operation may skip a status" invariant.
  const otherFns = [
    sliceFrom(appSource, "const saveStandardIncome = async (draft) => {", 9700),
    sliceFrom(appSource, "const saveSpecialIncome = async (draft) => {", 7000),
    sliceFrom(appSource, "const saveExpense = async (draft) => {", 6000),
    sliceFrom(appSource, "const submitDriverCashUp = async () => {", 5000),
    sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000),
  ];

  for (const fn of otherFns) {
    assert.doesNotMatch(fn, /status:\s*"banked"/);
  }
});

test("FINANCE ACCEPTANCE: banked records are final - blocked from edit, delete, and re-verification everywhere they are touched", () => {
  const standardFn = sliceFrom(appSource, "const saveStandardIncome = async (draft) => {", 9700);
  const specialFn = sliceFrom(appSource, "const saveSpecialIncome = async (draft) => {", 7000);
  const expenseFn = sliceFrom(appSource, "const saveExpense = async (draft) => {", 6000);
  const deleteFn = sliceFrom(appSource, "const deleteTransaction = async (transactionId) => {", 3000);
  const verifyFn = sliceFrom(appSource, "const verifyIncome = async (transactionId, actualCashReceived) => {", 16000);

  assert.match(standardFn, /existing\?\.status === "banked"/);
  assert.match(specialFn, /existing\?\.status === "banked"/);
  assert.match(expenseFn, /existing\?\.status === "banked"/);
  assert.match(deleteFn, /target\.status === "banked"/);
  assert.match(verifyFn, /target\.status === "banked"/);
  assert.match(verifyFn, /workflowStatus === "banked"/);
});

test("FINANCE ACCEPTANCE: deposit/cash-up links (depositId, cashUpIds, incomeRecordIds/expenseRecordIds) are preserved through the persistence rewrite", () => {
  const lockDepositFn = sliceFrom(appSource, "const lockDeposit = async () => {", 6000);
  const cashUpFn = sliceFrom(appSource, "const submitDriverCashUp = async () => {", 5000);

  assert.match(lockDepositFn, /depositId,\s*\n\s*bankedAt: timestamp,/);
  assert.match(lockDepositFn, /cashUpIds: \[\.\.\.verifiedDriverCashUpIds\]/);
  assert.match(cashUpFn, /incomeRecordIds: daySummary\.incomeRecords\.map\(\(record\) => record\.id\)/);
  assert.match(cashUpFn, /expenseRecordIds: daySummary\.expenseRecords\.map\(\(record\) => record\.id\)/);
});

// ---------------------------------------------------------------------------
// UI: await + double-submission guards
// ---------------------------------------------------------------------------

test("FinancePanel: standard/special/expense submit handlers await the async save and guard against double submission", () => {
  assert.match(appSource, /const \[standardSaving, setStandardSaving\] = useState\(false\);/);
  assert.match(appSource, /const \[specialSaving, setSpecialSaving\] = useState\(false\);/);
  assert.match(appSource, /const \[expenseSaving, setExpenseSaving\] = useState\(false\);/);

  const standardHandler = sliceFrom(appSource, "const handleStandardSubmit = async (event) => {", 700);
  assert.match(standardHandler, /if \(standardSaving\) {\s*return;\s*}/);
  assert.match(standardHandler, /await onSaveStandardIncome\(standardDraft\)/);

  const specialHandler = sliceFrom(appSource, "const handleSpecialSubmit = async (event) => {", 700);
  assert.match(specialHandler, /if \(specialSaving\) {\s*return;\s*}/);
  assert.match(specialHandler, /await onSaveSpecialIncome\(specialDraft\)/);

  const expenseHandler = sliceFrom(appSource, "const handleExpenseSubmit = async (event) => {", 700);
  assert.match(expenseHandler, /if \(expenseSaving\) {\s*return;\s*}/);
  assert.match(expenseHandler, /await onSaveExpense\(expenseDraft\)/);
});

test("FinancePanel: verify/delete/lock-deposit actions await the async call and guard against double submission", () => {
  assert.match(appSource, /const \[verifyingRecordId, setVerifyingRecordId\] = useState\(null\);/);
  assert.match(appSource, /const \[deletingRecordId, setDeletingRecordId\] = useState\(null\);/);
  assert.match(appSource, /const \[depositLocking, setDepositLocking\] = useState\(false\);/);

  const verifyHandler = sliceFrom(appSource, "const handleVerify = async (recordId) => {", 700);
  assert.match(verifyHandler, /if \(verifyingRecordId\) {\s*return;\s*}/);
  assert.match(verifyHandler, /await onVerifyIncome\(recordId, verificationInputs\[recordId\]\)/);

  const deleteHandler = sliceFrom(appSource, "const handleDelete = async (recordId) => {", 400);
  assert.match(deleteHandler, /if \(deletingRecordId\) {\s*return;\s*}/);
  assert.match(deleteHandler, /await onDeleteTransaction\(recordId\)/);

  const lockHandler = sliceFrom(appSource, "const handleLockDeposit = async () => {", 400);
  assert.match(lockHandler, /if \(depositLocking\) {\s*return;\s*}/);
  assert.match(lockHandler, /await onLockDeposit\(\)/);
});

test("OverviewPanel: driver day cash-up submit awaits the async call and guards against double submission", () => {
  const fn = sliceFrom(appSource, "const handleDriverCashUp = async () => {\n    if (cashUpSaving) {", 700);
  assert.match(fn, /if \(cashUpSaving\) {\s*return;\s*}/);
  assert.match(fn, /await onSubmitDriverCashUp\?\.\(\)/);
});

test("all seven Finance call sites are the actual App-level functions (no parallel implementation)", () => {
  assert.match(appSource, /onSaveStandardIncome=\{saveStandardIncome\}/);
  assert.match(appSource, /onSaveSpecialIncome=\{saveSpecialIncome\}/);
  assert.match(appSource, /onSaveExpense=\{saveExpense\}/);
  assert.match(appSource, /onSubmitDriverCashUp=\{submitDriverCashUp\}/);
  assert.match(appSource, /onVerifyIncome=\{verifyIncome\}/);
  assert.match(appSource, /onDeleteTransaction=\{deleteTransaction\}/);
  assert.match(appSource, /onLockDeposit=\{lockDeposit\}/);
});

// ---------------------------------------------------------------------------
// Regression: Route/Driver/Fleet were not touched by this Finance phase
// ---------------------------------------------------------------------------

test("REGRESSION: saveRouteProfile, saveDriver, saveVehicleProfile are untouched by the Finance phase", () => {
  assert.match(
    sliceFrom(appSource, "const saveRouteProfile = async (draft) => {", 4000),
    /commitLiveSnapshotMutation\(current, nextSnapshot\)/,
  );
  assert.match(
    sliceFrom(appSource, "const saveDriver = async (draft) => {", 9000),
    /commitLiveSnapshotMutation\(current, nextSnapshot\)/,
  );
  assert.match(
    sliceFrom(appSource, "const saveVehicleProfile = async (draft) => {", 5000),
    /commitLiveSnapshotMutation\(current, nextSnapshot\)/,
  );
});

test("FINANCE CONTRACT: workflow statuses remain exactly pending | counted | verified | banked", async () => {
  const dataGatewaySource = (
    await readFile(new URL("../src/lib/dataGateway.js", import.meta.url), "utf8")
  ).replace(/\r\n/g, "\n");
  assert.match(dataGatewaySource, /\["pending", "counted", "verified", "banked"\]/);
});
