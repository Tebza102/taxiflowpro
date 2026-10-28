# Data Model

## Main Entities
List the main data objects used by the app.

| Entity | Purpose | Key Fields | Relationships |
|---|---|---|---|
| Example | What it stores | id, name | Related entity |

## Database Collections or Tables
Document actual collections/tables after scan.

## Validation Rules
Describe required fields, formats, and business rules.

## Data Lifecycle
Explain how data is created, updated, archived, deleted, exported, or synced.

## Security Considerations
Document who can read/write which data.

## Migration Notes
Record any schema changes needed later.

## Driver salaries (2026-10-28, branch `agent/driver-salary`)

Stored in the business workspace snapshot JSON; no database migration. Rules live in `src/lib/salaryContract.js` (shared by the browser and `api/_lib/salaryActions.js`).

- `finance.salaryArrangements[]`: one schedule per driver `{ id: "salary-<staffId>", driverStaffId, driverName, amount, frequency: daily|weekly|fortnightly|monthly, payMethod: bank|cash, startDate, active, amountHistory[{ amount, frequency, effectiveFrom, recordedAt, recordedBy }], created*/updated* }`. A schedule is a plan only: saving it creates no expense. `describeSalarySchedule` gives the next payment (period, due date = period end, scheduled amount) and the due periods (ended and unpaid) with their total.
- Periods: daily = the date; weekly = the Monday starting the week; fortnightly = the Monday starting a 14-day block counted from the schedule start's Monday (manual payments: any Monday); monthly = `YYYY-MM`. Ends: same day / +6 / +13 / last day of month.
- A payment (with or without a schedule; without = `manual: true`, `scheduledAmount: null`) is one `financeTransactions` expense: `category "Salary"`, `expenseKind "operational"`, `id "txn-salary-<staffId>-<frequency>-<period>"`, `amount` = amount paid, plus `salaryPayment { arrangementId, manual, driverStaffId, driverName, frequency, period, periodLabel, periodStart, periodEnd, scheduledAmount, method, source }`. One per driver, frequency and period (409 otherwise).
- Method vs source: `bank` -> `business_bank` (not a cash expense, `driverStaffId: null`, verified); `cash` -> `business_cash` (cash expense, `driverStaffId: null`, verified) or `driver_takings` (cash expense linked to that driver day via `driverStaffId` and `expenseDate` = paid date; status `pending` so it goes through that day's checking; refused if that day is counted, verified, banked or closed). Only the takings source changes a driver's expected cash, and only on that day, once.
- Edits: recorded salaries cannot be edited through `record.edit` or the expense form; a pending (takings) one can be deleted under the existing rules and recorded again.
- Server actions `salary.arrangement_save` and `salary.payment_record`: Owner, or Admin/Manager with Money edit access.
- Visibility: Driver and no-Money projections never receive schedules (only `finance.expenseCatalog`); a driver receives only their own takings-funded salary records (they reduce that driver's hand-in); no-Money managers receive no transactions.
- Reports checked: (1) Money > Expenses monthly CSV: every expense in the month, salary lines itemised with method and source, salaries + other = total, "of which from drivers' takings" subtotal; schedules excluded. (2) Daily finance report (PDF download and its on-screen preview, `/api/admin/daily-log/:id/report-pdf` and `/report-view`): driver-day cash-up figures include takings-funded salaries in cash expenses and list them as "Salary from takings" lines; bank and business-cash salaries are not part of any driver day and correctly do not appear there. No other financial download exists (the backup tool is a restore format, not a report).
