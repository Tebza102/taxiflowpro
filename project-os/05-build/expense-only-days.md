# Expense-only Driver Days: Behaviour Today and Recommended Rule

Investigated 2026-10-10 from the code; no change made. **A decision is needed before the hosted rehearsal.**

## How a driver day's cash works today
`summarizeDriverDayCash` (`src/lib/cashUpContract.js`, the same maths on the server):
- `totalIncome` is the trip income claimed that day.
- `cashExpenses` are that day's expenses marked **"Paid from safe"** (`cashExpense: true`). The driver paid them in cash out of the money on hand.
- **Expected cash in = totalIncome − cashExpenses.** The driver hands in the takings less the cash they spent. Non-cash expenses don't change the hand-in.
- **Bank deposit** (`deposit.lock`, server) = the sum of each verified day's *counted* hand-in (always ≥ 0) + standalone verified income − standalone cash expenses. The deposit also *reports* `verifiedTakings` and `cashExpenses`.

## What happens to an expense-only day (or a day whose cash expenses exceed income)

1. **Submit works.** `cashup.submit` only requires at least one entry. The driver sees "Checking sent", and a pending day checking is stored (proven in Task 17: `cashup-uat-drv-b-owner-2026-10-08`).
2. **It never reaches Banking.** The verification queue (`src/lib/appRuntime.js`, `activeDriverCashVerificationQueue`) keeps only day checkings with `incomeCount > 0`. An expense-only day is invisible to Admin and Manager, so:
   - it can never be counted, verified or banked;
   - its expense records stay **pending** for ever, still editable and deletable, and never part of a deposit or a closed day;
   - the day is never closed, so the driver can keep adding work to it.
3. **The expected cash is negative or zero:**
   - with only non-cash expenses: expected cash 0, nothing to hand in, nothing owed;
   - with "Paid from safe" expenses and no or too little income: expected cash is **negative**. The driver spent more cash than they collected, so the business owes the driver the difference (a **reimbursement**).
4. **No reimbursement is tracked.** If such a mixed day were counted, the hand-in must be ≥ 0, so it would be recorded as 0. The variance shown would be a positive "over-collection" of the negative amount, which is misleading. The amount owed to the driver appears nowhere.
5. **The deposit is not distorted today.** The server sums counted hand-ins (≥ 0), so a negative day cannot reduce a bank deposit. Netting a reimbursement into the deposit would understate the money banked and hide a payable. **It must stay that way.**

## Recommended rule (for Tebogo's decision)

**R1. Every submitted day is reviewed and closed, whatever its income.**
- Expense-only and negative days appear in the Banking queue like any other day checking.
- The Admin records the hand-in (usually R 0) and confirms the receipts; the Manager verifies.
- Closing the day locks its records, as for any closed day.

**R2. Split the day's settlement into two numbers; never net them.**
- **Cash to hand in** = max(totalIncome − cashExpenses, 0). This is what goes towards the bank deposit.
- **Reimbursement due to the driver** = max(cashExpenses − totalIncome, 0). This is shown on the day and on the Banking card as "Reimbursement due", and is **never** included in or subtracted from a bank deposit.

**R3. Reimbursements are a separate payable.**
- They are settled outside the deposit: the Owner or Manager records "reimbursed", with the date and method, and it is audited.
- They are listed in the Daily Finance Report as a separate line.
- Until that feature exists, a non-zero reimbursement keeps the day out of banking with a clear message, rather than silently closing it.

**R4. Non-cash expense-only days** (expected cash 0) close with a R 0 hand-in, and no reimbursement is created.

## Minimal implementation, after the decision (not done)
- **Queue:** include day checkings with `entryCount > 0` (not only `incomeCount > 0`) in the Banking queue; show "No cash to hand in" and any "Reimbursement due".
- **Server:**
  - `cashup.record_handin` accepts 0 for these days and stores `reimbursementDue` on the day checking;
  - `deposit.lock` keeps summing counted hand-ins only;
  - a new `cashup.record_reimbursement` (Owner/Manager) records the settlement.
- **Tests:** an expense-only cash day, an expense-only non-cash day, a negative mixed day, deposit totals unchanged, reimbursement never in deposit.

## Interim guidance for the pilot (if R1–R3 are not built before go-live)
- Ask drivers to record out-of-pocket expenses only on days with takings, or have the Admin record them as management expenses (not "Paid from safe").
- Treat any expense-only day checking as an open item to clear with the operator.
- **Open acceptance item:** the expense-only-day handling must be decided and tested before the hosted rehearsal sign-off.
