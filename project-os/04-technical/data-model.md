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

- `finance.salaryArrangements[]`: one schedule per driver `{ id: "salary-<staffId>", driverStaffId, driverName, amount, frequency: monthly|weekly, payMethod: bank|cash, startDate, active, amountHistory[], created*/updated* }`. A schedule is a plan only: saving it creates no expense.
- A salary payment is one `financeTransactions` expense: `type "expense"`, `expenseKind "operational"`, `category "Salary"`, `id "txn-salary-<staffId>-<period>"`, `status "verified"` (management capture), `amount` = amount actually paid, `cashExpense` true only for cash, `driverStaffId: null` (never part of a driver's day cash-up), plus `salaryPayment { arrangementId, driverStaffId, driverName, frequency, period, periodLabel, scheduledAmount, method }`.
- Period: monthly `YYYY-MM`; weekly = the Monday starting the week (`YYYY-MM-DD`). One payment per driver and period (refused with 409 otherwise).
- Server actions `salary.arrangement_save` and `salary.payment_record`: Owner, or Admin/Manager with Money edit access. Status values are unchanged.
- Visibility: the Driver and no-Money projections receive neither schedules (only `finance.expenseCatalog` is passed) nor salary expenses (not driver-owned).
- Report: `buildMonthlyExpenseReport` / CSV download in Money > Expenses lists every expense in the month with salary lines itemised; salaries + other expenses = total expenses.
