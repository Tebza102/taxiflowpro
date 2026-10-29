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

## Period reports: business and vehicle (2026-10-29, branch `agent/period-reports`)

No stored data and no migration: reports are computed from the workspace snapshot on request. Rules in `src/lib/periodReport.js` (shared, pure); endpoint `GET /api/admin/reports/period` (`api/admin/reports/period.js`, a static Vercel function; dev route in `vite.config.js`); PDF `api/_lib/periodReportPdf.js` (pdfkit, Daily Finance Report brand/DEMO marking).

- Request: `scope=business|vehicle`, `vehicle=<id>`, `period=daily|weekly|monthly|custom`, `date` (daily/weekly), `month=YYYY-MM` (monthly), `start`/`end` (custom, inclusive, at most 731 days), `format=json|csv|pdf`, plus `mode` and `business` like the daily report. Weeks are Monday to Sunday (the salary week).
- Access: `assertReportAccess` before anything is read from the request (Owner, or Admin/Manager with Money on, from the membership; 401 without a session; demo-only unauthenticated outside production). The snapshot is the caller's business only (tenant boundary).
- Dates: income `tripDate`, expenses `expenseDate`; without one, the capture `timestamp` converted to the South African date (disclosed in the report); entries with no date at all are excluded and counted in the notes. Deposits are dated by their banking timestamp (SAST); driver days by `workDate`.
- Amounts: income = `amountClaimed ?? amount` (recorded takings, as the day cash-up); expenses `amount`; all sums in cents. Every status is included; the verification table splits them.
- Allocation (nothing is spread): a record belongs to a vehicle only if its `vehicleId` (or, without one, its `vehicle` registration) names it. Salary payments (`salaryPayment`) never belong to a vehicle. Expenses with no vehicle (`vehicle` empty or "General") are "business costs without a vehicle". Expenses filed under category Salary without a `salaryPayment` (older records) stay in their allocation and are disclosed, not counted as driver salaries.
- Business report: income (trip/special), expenses split vehicle / without a vehicle / salaries (and takings-funded subtotal), net result, breakdowns, salary lines, per-vehicle results, verification status, cash checking (driver days: expected, counted, short/over, awaiting count, closed without deposit), banking (deposits), all transactions, notes, reconciliation checks (lines = totals; split = total; vehicle nets - unallocated - salaries = net).
- Vehicle report: identity (registration, model, route, status, assigned driver), its own income and expenses, net, activity (trips, special hires, days with income, odometer distance, drivers on its entries), breakdown, verification, transactions, notes. No cash checking or banking (those are per driver day / deposit).
- Labels: "Net result (recorded income less recorded expenses)"; the notes say it is not accounting profit.

## Salary settings in the driver profile (2026-10-29, branch `agent/driver-salary-profile`)

Same single salary model (`finance.salaryArrangements`, `salary.arrangement_save`); no second system and no migration.

- New arrangement fields: `payTiming` (`end` = in arrears, the default and the earlier behaviour; `start` = in advance; it sets each period's due date) and `revision` (1 for a new schedule, +1 per save; a stored schedule without it counts as 1).
- No silent overwrite (server and demo): saving a schedule for a driver who already has one requires the `revision` that was opened; a missing or stale revision is 409 and nothing changes. A change to amount or frequency may not apply before the latest `amountHistory` entry (400), so earlier amounts and dates are never rewritten. Pausing or changing timing/method adds no history entry (audit only).
- Driver profile UI (`src/components/DriverProfileSalary.jsx`, in Drivers > Add driver / Edit profile): optional Salary section with amount, frequency, start/effective date, payment timing, usual method and Active/Paused; shows the current arrangement, next payment, due and amount history. Save runs `driver.save` (needs `drivers.manage`) and then, only if the salary changed, `salary.arrangement_save` (needs Money edit). If the profile saves but the salary is refused, the form stays open on that driver with the reason.
- Access: salary settings = Owner, or Admin/Manager with Money on (`requiresFinanceEdit`); `drivers.manage` alone gives no salary access, and Money alone gives no profile edits (such users see "Salary settings" with read-only profile fields). `driver.save` refuses any salary field (400) and its response is `{ action, staffId, created }`; driver records never hold salary. Workspace projections for Drivers and no-Money managers carry no `salaryArrangements`, no salary records and no finance audit events.
- Money > Expenses > Driver salaries keeps payments (scheduled and manual), duplicates, sources and history; its schedule form was replaced by "Salary settings" links into the profile, and the profile links back ("Record or review salary payments in Money").
- Demo mode note: Reports read the built-in demo data on the server, so entries made during a demo session are not in demo Reports (now stated on the Reports screen). Tenant mode reads the stored business data.
