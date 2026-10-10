import {
  calculateDailyAnalytics,
  calculateKmComputed,
  calculateTripDurationMin,
} from "../../src/lib/analytics.js";
import {
  getDriverCashUpWorkflowStatus,
  getExpectedOpeningOdo,
  summarizeDriverDayCash,
} from "../../src/lib/cashUpContract.js";
import { normalizeTripFinanceTransactions } from "../../src/lib/tripHistory.js";
import { createHttpError } from "./tenantAuth.js";

// Server-side finance capture (create only), mirroring src/App.jsx
// saveStandardIncome / saveSpecialIncome / saveExpense. The small field helpers
// below mirror src/lib/appRuntime.js (which cannot load in Node) and are held
// to parity by tests/finance-capture-parity.test.mjs; the trip/day maths is the
// shared src/lib/analytics.js. Timestamps are composed in SAST explicitly (the
// browser uses the device's local time, SAST in practice; servers run in UTC).

const SAST_OFFSET = "+02:00"; // South Africa has no daylight saving.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();
const bad = (message) => createHttpError(400, message);

// --- Parity helpers (see appRuntime.js) ------------------------------------------
export const parseTimeInputValue = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(text(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};
export const getTimeInputMinutes = (value) => {
  const parsed = parseTimeInputValue(value);
  return parsed ? parsed.hour * 60 + parsed.minute : null;
};
const optionalText = (value) => text(value) || null;
const optionalNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
export const buildTripAnalyticsFields = (value = {}) => {
  const timeIn = optionalText(value.timeIn ?? value.time_in);
  const timeOut = optionalText(value.timeOut ?? value.time_out);
  const odometerStart = optionalNumber(value.odometerStart ?? value.odometer_start ?? value.openingOdo ?? value.opening_odo);
  const odometerEnd = optionalNumber(value.odometerEnd ?? value.odometer_end ?? value.closingOdo ?? value.closing_odo);
  return {
    timeIn,
    timeOut,
    odometerStart,
    odometerEnd,
    kmComputed: optionalNumber(value.kmComputed ?? value.km_computed) ?? calculateKmComputed({ odometerStart, odometerEnd }),
    tripDurationMin: optionalNumber(value.tripDurationMin ?? value.trip_duration_min) ?? calculateTripDurationMin({ timeIn, timeOut }),
  };
};
export const buildDailyAnalyticsFields = (value = {}) => ({
  dayStartOdometer: optionalNumber(value.dayStartOdometer ?? value.day_start_odometer ?? value.openingOdo ?? value.opening_odo),
  dayEndOdometer: optionalNumber(value.dayEndOdometer ?? value.day_end_odometer ?? value.closingOdo ?? value.closing_odo),
  notes: optionalText(value.notes),
});
export const getDailyTripLogbookTotals = (entries = []) => {
  const analytics = calculateDailyAnalytics({ trips: Array.isArray(entries) ? entries : [] });
  return { tripCount: analytics.totalTrips, totalPassengers: analytics.totalPassengers, totalAmount: analytics.totalTakingsExpected };
};
// SAST wall-clock date (+ time) -> ISO instant.
export const sastTimestamp = (date, time = "12:00") => new Date(`${date}T${time}:00${SAST_OFFSET}`).toISOString();

// --- Field parsing ------------------------------------------------------------------
const requireDate = (value, label) => {
  const v = text(value);
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw bad(`Select the ${label}.`);
  return v;
};
const money = (value, { label, allowZero }) => {
  const amount = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0) || amount > 10_000_000) {
    throw bad(`Enter a valid ${label}.`);
  }
  return Math.round(amount * 100) / 100;
};
const odometer = (opening, closing) => {
  const open = Number(opening);
  const close = Number(closing);
  if (opening === "" || closing === "" || opening == null || closing == null || !Number.isFinite(open) || !Number.isFinite(close) || open < 0) {
    throw bad("Opening and closing odometer readings are required.");
  }
  if (close - open <= 0) throw bad("Closing odometer must be greater than opening odometer.");
  return { openingOdo: open, closingOdo: close };
};
const shortText = (value, label, max = 200) => {
  const v = text(value);
  if (!v) throw bad(`Enter the ${label}.`);
  if (v.length > max) throw bad(`The ${label} is too long.`);
  return v;
};
const captureAs = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (!["driver", "management"].includes(value)) throw bad("captureAs must be driver or management.");
  return value;
};

const STANDARD_FIELDS = ["captureAs", "vehicleId", "tripDate", "timeIn", "timeOut", "openingOdo", "closingOdo", "tripLogbook", "notes"];
const LEG_FIELDS = ["fromLocation", "toLocation", "departingFromPoint", "goingToPoint", "passengerCount", "amountCollected", "timeIn", "timeOut", "odometerStart", "odometerEnd"];
const SPECIAL_FIELDS = ["captureAs", "vehicleId", "tripDate", "openingOdo", "closingOdo", "fromLocation", "toLocation", "travelReason", "fuelOilCost", "repairMaintenanceCost", "amount", "timeIn", "timeOut"];
const EXPENSE_FIELDS = ["captureAs", "expenseKind", "category", "description", "expenseDate", "amount", "cashExpense", "reference", "vehicleId"];

export const parseStandardIncome = (fields) => {
  const tripDate = requireDate(fields.tripDate, "trip date");
  const timeIn = text(fields.timeIn);
  const timeOut = text(fields.timeOut);
  if (!parseTimeInputValue(timeIn) || !parseTimeInputValue(timeOut)) throw bad("Enter a valid time in and time out.");
  if (getTimeInputMinutes(timeOut) <= getTimeInputMinutes(timeIn)) throw bad("Time out must be later than time in.");
  const { openingOdo, closingOdo } = odometer(fields.openingOdo, fields.closingOdo);
  if (!Array.isArray(fields.tripLogbook) || fields.tripLogbook.length === 0) throw bad("Add at least one trip to the daily logbook.");
  const tripLogbook = fields.tripLogbook.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw bad(`Trip ${index + 1} is not valid.`);
    const unknown = Object.keys(entry).filter((key) => !LEG_FIELDS.includes(key));
    if (unknown.length) throw bad(`Unsupported trip fields: ${unknown.join(", ")}.`);
    const fromLocation = text(entry.fromLocation);
    const toLocation = text(entry.toLocation);
    if (!fromLocation || !toLocation) throw bad(`Complete the from and to stops for trip ${index + 1}.`);
    if (fromLocation.toLowerCase() === toLocation.toLowerCase()) throw bad(`Trip ${index + 1} must use two different stops.`);
    if (text(entry.passengerCount) === "") throw bad(`Enter the passenger count for trip ${index + 1}.`);
    const passengerCount = Number(entry.passengerCount);
    if (!Number.isInteger(passengerCount) || passengerCount < 0) throw bad(`Passenger count for trip ${index + 1} must be zero or more.`);
    if (text(entry.amountCollected) === "") throw bad(`Enter the amount collected for trip ${index + 1}.`);
    const amountCollected = money(entry.amountCollected, { label: `amount collected for trip ${index + 1}`, allowZero: true });
    return {
      id: `trip-leg-${index + 1}`,
      fromLocation,
      toLocation,
      departingFromPoint: text(entry.departingFromPoint) || fromLocation,
      goingToPoint: text(entry.goingToPoint) || toLocation,
      passengerCount,
      amountCollected,
      ...buildTripAnalyticsFields(entry),
    };
  });
  return { captureAs: captureAs(fields.captureAs), vehicleId: shortText(fields.vehicleId, "vehicle"), tripDate, timeIn, timeOut, openingOdo, closingOdo, tripLogbook, notes: optionalText(fields.notes) };
};

export const parseSpecialIncome = (fields) => {
  const tripDate = requireDate(fields.tripDate, "travel date");
  const { openingOdo, closingOdo } = odometer(fields.openingOdo, fields.closingOdo);
  const timeIn = optionalText(fields.timeIn);
  const timeOut = optionalText(fields.timeOut);
  if ((timeIn && !parseTimeInputValue(timeIn)) || (timeOut && !parseTimeInputValue(timeOut))) throw bad("Enter a valid time in and time out.");
  return {
    captureAs: captureAs(fields.captureAs),
    vehicleId: shortText(fields.vehicleId, "vehicle"),
    tripDate,
    openingOdo,
    closingOdo,
    fromLocation: shortText(fields.fromLocation, "from location"),
    toLocation: shortText(fields.toLocation, "to location"),
    travelReason: shortText(fields.travelReason, "travel reason", 500),
    fuelOilCost: money(fields.fuelOilCost ?? 0, { label: "fuel and oil cost", allowZero: true }),
    repairMaintenanceCost: money(fields.repairMaintenanceCost ?? 0, { label: "repairs and maintenance cost", allowZero: true }),
    amount: money(fields.amount, { label: "amount earned for the extra trip", allowZero: false }),
    timeIn,
    timeOut,
  };
};

export const parseExpense = (fields) => {
  const expenseKind = text(fields.expenseKind);
  if (!["asset", "operational"].includes(expenseKind)) throw bad("expenseKind must be asset or operational.");
  if (fields.cashExpense !== undefined && typeof fields.cashExpense !== "boolean") throw bad("cashExpense must be true or false.");
  return {
    captureAs: captureAs(fields.captureAs),
    expenseKind,
    category: shortText(fields.category, "expense category"),
    description: shortText(fields.description, "expense description", 500),
    expenseDate: requireDate(fields.expenseDate, "expense date"),
    amount: money(fields.amount, { label: "expense amount", allowZero: false }),
    cashExpense: Boolean(fields.cashExpense),
    reference: optionalText(fields.reference),
    vehicleId: expenseKind === "asset" ? shortText(fields.vehicleId, "vehicle") : (optionalText(fields.vehicleId) ? (() => { throw bad("Only vehicle (asset) costs take a vehicle."); })() : null),
  };
};

// --- Authorization of the capture mode ---------------------------------------------
// Driver role: always driver capture, own linkage required.
// Owner with linkage: may capture as driver (owner-driver) or management.
// Owner/Admin/Manager: management capture needs finance edit (Owner always).
const resolveMode = (requester, requested) => {
  if (requester.role === "Driver") {
    if (requested === "management") throw createHttpError(403, "Drivers can only capture their own work.");
    if (!text(requester.driverStaffId)) throw createHttpError(403, "Your membership is not linked to a driver record.");
    return "driver";
  }
  if (requested === "driver") {
    if (requester.role !== "Owner" || !text(requester.driverStaffId)) {
      throw createHttpError(403, "Only a driver, or an Owner linked to a driver record, can capture driver work.");
    }
    return "driver";
  }
  if (!["Owner", "Admin", "Manager"].includes(requester.role)) throw createHttpError(403, "Your role cannot capture finance records.");
  if (requester.role !== "Owner" && requester.moduleAccess?.finance !== true) throw createHttpError(403, "Money access is turned off for your account.");
  return "management";
};

const findVehicle = (stored, vehicleId) => {
  const vehicle = (stored.vehicles ?? []).find((item) => text(item.id) === vehicleId);
  if (!vehicle) throw createHttpError(404, "That vehicle does not exist in this business.");
  if (vehicle.archivedAt || text(vehicle.status).toLowerCase() === "archived") throw createHttpError(409, "That vehicle is archived.");
  return vehicle;
};

const driverContext = (stored, requester, mode, workDate) => {
  if (mode !== "driver") return { driverStaffId: null, driverName: null };
  const driverStaffId = text(requester.driverStaffId);
  const driver = (stored.drivers ?? []).find((item) => text(item.staffId) === driverStaffId);
  if (!driver) throw createHttpError(409, "Your linked driver record does not exist in this business.");
  // Counted, verified or banked days are closed to new driver work (a new record
  // would silently reopen a day whose cash was already counted or deposited).
  const normalized = normalizeTripFinanceTransactions(stored.financeTransactions ?? [], { source: stored, routes: stored.routes ?? [], vehicles: stored.vehicles ?? [], drivers: stored.drivers ?? [] });
  const summary = summarizeDriverDayCash({ financeTransactions: normalized, dailyCashUps: stored.dailyCashUps ?? [] }, { driverStaffId, workDate });
  const cashUp = summary.cashUpRecord;
  if (cashUp) {
    const status = getDriverCashUpWorkflowStatus(cashUp, summary);
    if (["counted", "verified", "banked"].includes(status) || cashUp.status === "banked") {
      throw createHttpError(409, `Your day checking for ${workDate} is ${status}; new work for that day cannot be added.`);
    }
  }
  return { driverStaffId, driverName: text(driver.name) || null };
};

const meta = (requester, now, requestId) => ({
  createdAt: now,
  createdBy: requester.id,
  createdByRole: requester.role,
  updatedAt: null,
  updatedBy: null,
  updatedByRole: null,
  source: "server",
  requestId,
});

// Each builder returns { record, audit } for a NEW record. The record id is
// derived from the requestId, so a retried request can never create a second
// record even if the request log were lost.
export const buildStandardIncome = (stored, f, requester, now, requestId) => {
  const mode = resolveMode(requester, f.captureAs);
  const vehicle = findVehicle(stored, f.vehicleId);
  const { driverStaffId, driverName } = driverContext(stored, requester, mode, f.tripDate);
  const totals = getDailyTripLogbookTotals(f.tripLogbook);
  const expectedOpening = getExpectedOpeningOdo(stored.financeTransactions ?? [], stored.vehicles ?? [], f.vehicleId, null);
  const id = `txn-inc-${requestId}`;
  const record = {
    id,
    type: "income",
    incomeKind: "standard",
    vehicleId: f.vehicleId,
    vehicle: vehicle.registration,
    route: vehicle.route,
    tripDate: f.tripDate,
    timeIn: f.timeIn,
    timeOut: f.timeOut,
    tripLogbook: f.tripLogbook,
    tripCount: totals.tripCount,
    totalPassengers: totals.totalPassengers,
    openingOdo: f.openingOdo,
    closingOdo: f.closingOdo,
    ...buildTripAnalyticsFields({ timeIn: f.timeIn, timeOut: f.timeOut, odometerStart: f.openingOdo, odometerEnd: f.closingOdo }),
    ...buildDailyAnalyticsFields({ dayStartOdometer: f.openingOdo, dayEndOdometer: f.closingOdo, notes: f.notes }),
    amountClaimed: totals.totalAmount,
    actualCashReceived: null,
    amount: totals.totalAmount,
    driverStaffId,
    driverName,
    discrepancy: f.openingOdo !== expectedOpening,
    isSpecial: false,
    status: "pending",
    timestamp: sastTimestamp(f.tripDate, f.timeIn),
    ...meta(requester, now, requestId),
    verifiedAt: null,
    verifiedBy: null,
    verifiedByRole: null,
    depositId: null,
  };
  return { record, audit: { action: "create", entityType: "income", entityId: id, title: `Trip income added / ${vehicle.registration}`, detail: `${vehicle.route} / ${totals.tripCount} trips / ${totals.totalPassengers} passengers / ${totals.totalAmount}` }, extra: { discrepancy: record.discrepancy, expectedOpeningOdo: expectedOpening, amountClaimed: totals.totalAmount, mode } };
};

export const buildSpecialIncome = (stored, f, requester, now, requestId) => {
  const mode = resolveMode(requester, f.captureAs);
  const vehicle = findVehicle(stored, f.vehicleId);
  const { driverStaffId, driverName } = driverContext(stored, requester, mode, f.tripDate);
  const businessKm = f.closingOdo - f.openingOdo;
  const id = `txn-sp-${requestId}`;
  const record = {
    id,
    type: "income",
    incomeKind: "special",
    vehicleId: f.vehicleId,
    vehicle: vehicle.registration,
    route: `${f.fromLocation} to ${f.toLocation}`,
    assignedRoute: vehicle.route,
    description: f.travelReason,
    tripDate: f.tripDate,
    openingOdo: f.openingOdo,
    closingOdo: f.closingOdo,
    businessKm,
    ...buildTripAnalyticsFields({ timeIn: f.timeIn, timeOut: f.timeOut, odometerStart: f.openingOdo, odometerEnd: f.closingOdo, kmComputed: businessKm }),
    fromLocation: f.fromLocation,
    toLocation: f.toLocation,
    departingFromPoint: f.fromLocation,
    goingToPoint: f.toLocation,
    travelReason: f.travelReason,
    fuelOilCost: f.fuelOilCost,
    repairMaintenanceCost: f.repairMaintenanceCost,
    amount: f.amount,
    amountClaimed: f.amount,
    actualCashReceived: null,
    driverStaffId,
    driverName,
    discrepancy: false,
    isSpecial: true,
    status: "pending",
    timestamp: sastTimestamp(f.tripDate, f.timeIn ?? "12:00"),
    ...meta(requester, now, requestId),
    verifiedAt: null,
    verifiedBy: null,
    verifiedByRole: null,
    depositId: null,
  };
  return { record, audit: { action: "create", entityType: "income", entityId: id, title: `Extra trip added / ${vehicle.registration}`, detail: `${f.fromLocation} to ${f.toLocation} / ${f.amount}` }, extra: { amountClaimed: f.amount, mode } };
};

export const buildExpense = (stored, f, requester, now, requestId) => {
  const mode = resolveMode(requester, f.captureAs);
  const vehicle = f.expenseKind === "asset" ? findVehicle(stored, f.vehicleId) : null;
  const { driverStaffId, driverName } = driverContext(stored, requester, mode, f.expenseDate);
  const id = `txn-exp-${requestId}`;
  // Existing rule: management with finance edit records verified expenses;
  // driver-captured expenses start pending.
  const status = mode === "management" ? "verified" : "pending";
  const record = {
    id,
    type: "expense",
    expenseKind: f.expenseKind,
    category: f.category,
    description: f.description,
    expenseDate: f.expenseDate,
    reference: f.reference,
    vehicleId: vehicle ? f.vehicleId : null,
    vehicle: vehicle ? vehicle.registration : "General",
    amount: f.amount,
    cashExpense: f.cashExpense,
    driverStaffId,
    driverName,
    status,
    timestamp: sastTimestamp(f.expenseDate),
    ...meta(requester, now, requestId),
    depositId: null,
  };
  return { record, audit: { action: "create", entityType: "expense", entityId: id, title: `Expense added / ${vehicle ? vehicle.registration : "General"}`, detail: `${f.category} / ${f.amount}${f.cashExpense ? " / cash" : ""}` }, extra: { status, mode } };
};

export const CAPTURE_ACTIONS = Object.freeze({
  "capture.standard_income": { fields: STANDARD_FIELDS, parse: parseStandardIncome, build: buildStandardIncome },
  "capture.special_income": { fields: SPECIAL_FIELDS, parse: parseSpecialIncome, build: buildSpecialIncome },
  "capture.expense": { fields: EXPENSE_FIELDS, parse: parseExpense, build: buildExpense },
});
