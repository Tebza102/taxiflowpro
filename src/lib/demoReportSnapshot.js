// Demo mode only: the report data a LOCAL demo app sends with a report request,
// so demo Reports (screen, CSV and PDF) are built from the demo workspace as it
// is now, including entries made in this session. Every list is reduced to an
// explicit allowlist of the fields the report builders read (periodReport.js,
// dailyFinanceReport.js, dailyLogReportView.js, cashUpContract.js,
// tripHistory.js); anything else, including credentials and contact details,
// is dropped. People become ids, role and name. The server applies this same
// reduction to whatever it receives (api/_lib/reportSnapshot.js).

export const DEMO_REPORT_LIST_KEYS = Object.freeze(["financeTransactions", "vehicles", "drivers", "dailyCashUps", "deposits", "routes", "verificationQueue", "appUsers"]);
export const DEMO_REPORT_MAX_RECORDS = 20_000;

const ACTOR_FIELDS = ["createdAt", "createdBy", "createdByRole", "updatedAt", "updatedBy", "updatedByRole", "countedAt", "countedBy", "countedByRole", "verifiedAt", "verifiedBy", "verifiedByRole", "checkedAt", "checkedBy", "checkedByRole", "lockedBy", "lockedByRole"];

const TRIP_LEG_FIELDS = [
  "id", "tripNumber", "tripId", "tripTime", "timeIn", "time_in", "timeOut", "time_out", "fromLocation", "toLocation",
  "departingFromPoint", "goingToPoint", "passengerCount", "passenger_count", "amountCollected", "amount_collected",
  "tripAmountExpected", "trip_amount_expected", "odometerStart", "odometer_start", "odometerEnd", "odometer_end",
  "openingOdo", "opening_odo", "closingOdo", "closing_odo", "route", "routeId", "routeName",
];
const EDIT_FIELDS = ["actorId", "actorName", "actorRole", "timestamp", "reason", "summary", "changes", "lastEditedAt"];
const SALARY_FIELDS = ["arrangementId", "manual", "driverStaffId", "driverName", "frequency", "period", "periodLabel", "periodStart", "periodEnd", "scheduledAmount", "method", "source"];

// Top-level fields per list; nested lists/objects have their own allowlists.
export const DEMO_REPORT_FIELDS = Object.freeze({
  financeTransactions: [
    "id", "type", "incomeKind", "expenseKind", "isSpecial", "category", "description", "notes", "note", "status", "discrepancy",
    "vehicle", "vehicleId", "vehicleNo", "vehicle_number", "vehicleRegistration", "route", "routeId", "routeName", "currentRouteId", "current_route_id", "assignedRoute",
    "tripDate", "trip_date", "expenseDate", "timestamp", "tripTime", "tripNumber", "tripId", "timeIn", "time_in", "timeOut", "time_out",
    "amount", "amountClaimed", "amount_claimed", "amountCollected", "amount_collected", "actualCashReceived", "cashExpense", "tripAmountExpected", "trip_amount_expected",
    "depositId", "bankedAt", "depositedAt", "reference",
    "driverStaffId", "driver_staff_id", "driverName", "driver_name", "driverId",
    "openingOdo", "opening_odo", "closingOdo", "closing_odo", "odometerStart", "odometer_start", "odometerEnd", "odometer_end", "dayStartOdometer", "dayEndOdometer",
    "passengerCount", "passenger_count", "totalPassengers", "tripCount", "seatCapacity", "seat_capacity",
    "fromLocation", "toLocation", "departingFromPoint", "goingToPoint",
    "edited", "isEdited", "isCorrected", "correctionFlag", "lastEditReason", "lastEditSummary", "lastEditedAt", "lastEditedBy", "lastEditedByRole", "originalCreatedAt",
    ...ACTOR_FIELDS,
  ],
  vehicles: ["id", "registration", "model", "route", "routeId", "currentRouteId", "status", "archivedAt", "assignedDriverId", "seatCapacity", "seat_capacity", "vehicleNo"],
  dailyCashUps: [
    "id", "driverStaffId", "driverName", "workDate", "status", "expectedCashIn", "actualCashReceived", "cashToHandIn", "uncoveredCashExpenses",
    "totalIncome", "totalExpenses", "cashExpenses", "entryCount", "incomeRecordIds", "expenseRecordIds", "depositId", "bankedAt", ...ACTOR_FIELDS,
  ],
  deposits: ["depositId", "reference", "timestamp", "recordsLocked", "verifiedTakings", "cashExpenses", "depositAmount", "transactionIds", "cashUpIds", "lockedBy", "lockedByRole"],
  routes: ["id", "name", "code", "type", "primaryOrigin", "primaryDestination", "isActive"],
  verificationQueue: ["id", "driver", "route", "vehicle", "submittedAt", "claimed", "counted", "shortage", "gapKm", "status"],
});

const text = (value) => String(value ?? "").trim();
const nameOnly = (value) => (text(value) && !text(value).includes("@") ? text(value) : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const pick = (record, fields) => Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]));
const pickList = (value, fields) => list(value).filter(isRecord).map((item) => pick(item, fields));

const transaction = (record) => {
  const out = pick(record, DEMO_REPORT_FIELDS.financeTransactions);
  if (Array.isArray(record.tripLogbook)) out.tripLogbook = pickList(record.tripLogbook, TRIP_LEG_FIELDS);
  if (Array.isArray(record.editHistory)) out.editHistory = pickList(record.editHistory, EDIT_FIELDS);
  if (isRecord(record.salaryPayment)) out.salaryPayment = pick(record.salaryPayment, SALARY_FIELDS);
  return out;
};
const cashUp = (entry) => {
  const out = pick(entry, DEMO_REPORT_FIELDS.dailyCashUps);
  // Settlement holds amounts, flags and actor ids only.
  if (isRecord(entry.settlement)) out.settlement = pick(entry.settlement, ["closedWithoutDeposit", "closedAt", "closedBy", "closedByRole", "expectedCashIn", "countedCash", "variance", "cashToHandIn", "uncoveredCashExpenses", "reason"]);
  return out;
};
const person = (item) => ({
  id: item?.id ?? null,
  actorId: item?.actorId ?? null,
  staffId: item?.staffId ?? null,
  authUserId: item?.authUserId ?? null,
  role: item?.role ?? null,
  name: nameOnly(item?.name),
});

export const sanitizeDemoReportSnapshot = (snapshot = {}) => ({
  profile: { fleetName: text(snapshot.profile?.fleetName) || null, legalEntity: text(snapshot.profile?.legalEntity) || null },
  finance: {},
  financeTransactions: list(snapshot.financeTransactions).filter(isRecord).map(transaction),
  vehicles: pickList(snapshot.vehicles, DEMO_REPORT_FIELDS.vehicles),
  dailyCashUps: list(snapshot.dailyCashUps).filter(isRecord).map(cashUp),
  deposits: pickList(snapshot.deposits, DEMO_REPORT_FIELDS.deposits),
  routes: pickList(snapshot.routes, DEMO_REPORT_FIELDS.routes),
  verificationQueue: pickList(snapshot.verificationQueue, DEMO_REPORT_FIELDS.verificationQueue),
  drivers: list(snapshot.drivers).filter(isRecord).map(person),
  appUsers: list(snapshot.appUsers).filter(isRecord).map(person),
});
