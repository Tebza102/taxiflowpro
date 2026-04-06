import {
  calculateDailyAnalytics,
  calculateTripAnalytics,
  parseTimeToMinutes,
} from "../../src/lib/analytics.js";

import { createHttpError } from "./snapshotLoader.js";

const toFiniteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
};

const toPositiveNumber = (value) => {
  const numeric = toFiniteNumber(value);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const roundAmount = (value) => {
  const numeric = toFiniteNumber(value);

  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
};

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim();

  return normalized || null;
};

const toDateKey = (value) => {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return normalized.slice(0, 10);
  }

  const parsedDate = new Date(normalized);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const toTimeValue = (value) => {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{1,2}:\d{2}/.test(normalized)) {
    return normalized.slice(0, 5);
  }

  const parsedDate = new Date(normalized);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return `${String(parsedDate.getHours()).padStart(2, "0")}:${String(
    parsedDate.getMinutes(),
  ).padStart(2, "0")}`;
};

const getRouteStops = (routeValue) => {
  const route = normalizeText(routeValue);

  if (!route) {
    return { fromLocation: null, toLocation: null };
  }

  const toMatch = /^(.+?)\s+to\s+(.+)$/i.exec(route);
  if (toMatch) {
    return {
      fromLocation: normalizeText(toMatch[1]),
      toLocation: normalizeText(toMatch[2]),
    };
  }

  const arrowParts = route
    .split(/\s*(?:->|>)\s*/i)
    .map((part) => normalizeText(part))
    .filter(Boolean);
  if (arrowParts.length >= 2) {
    return {
      fromLocation: arrowParts[0],
      toLocation: arrowParts[arrowParts.length - 1],
    };
  }

  const slashParts = route
    .split("/")
    .map((part) => normalizeText(part))
    .filter(Boolean);
  if (slashParts.length >= 2) {
    return {
      fromLocation: slashParts[0],
      toLocation: slashParts[slashParts.length - 1],
    };
  }

  return {
    fromLocation: route,
    toLocation: null,
  };
};

const buildRouteName = (entry = {}, fallbackRoute = null) => {
  const fromLocation =
    normalizeText(entry.departingFromPoint) ||
    normalizeText(entry.fromLocation) ||
    getRouteStops(fallbackRoute).fromLocation;
  const toLocation =
    normalizeText(entry.goingToPoint) ||
    normalizeText(entry.toLocation) ||
    getRouteStops(fallbackRoute).toLocation;

  if (fromLocation && toLocation) {
    return `${fromLocation} -> ${toLocation}`;
  }

  return normalizeText(fallbackRoute);
};

const resolveVehicleRecord = (snapshot, record) =>
  (snapshot.vehicles ?? []).find(
    (vehicle) =>
      vehicle.id === record.vehicleId ||
      normalizeText(vehicle.registration) === normalizeText(record.vehicle),
  ) ?? null;

const resolveDriverRecord = (snapshot, record, vehicle) => {
  const drivers = snapshot.drivers ?? [];
  const queueDriverName =
    (snapshot.verificationQueue ?? []).find((entry) => entry.id === record.id)?.driver ?? null;

  return (
    drivers.find(
      (driver) => driver.staffId === record.driverId || driver.staffId === record.createdBy,
    ) ??
    drivers.find((driver) => driver.staffId === vehicle?.assignedDriverId) ??
    drivers.find((driver) => normalizeText(driver.name) === normalizeText(queueDriverName)) ??
    drivers.find(
      (driver) =>
        driver.role === "Driver" && normalizeText(driver.route) === normalizeText(record.route),
    ) ??
    null
  );
};

const getExpenseDateKey = (expense) =>
  toDateKey(expense.expenseDate ?? expense.incurredAt ?? expense.timestamp);

const getReportDateKey = (record) => toDateKey(record.tripDate ?? record.timestamp);

const getMatchingDailyExpenses = (snapshot, record) => {
  const reportDateKey = getReportDateKey(record);

  return (snapshot.financeTransactions ?? []).filter((expense) => {
    if (expense.type !== "expense") {
      return false;
    }

    if (!reportDateKey || getExpenseDateKey(expense) !== reportDateKey) {
      return false;
    }

    if (record.vehicleId && expense.vehicleId) {
      return expense.vehicleId === record.vehicleId;
    }

    return normalizeText(expense.vehicle) === normalizeText(record.vehicle);
  });
};

const buildFallbackTripEntry = (record) => {
  const routeStops = getRouteStops(record.route);

  return {
    id: `${record.id}-summary`,
    timeOut: record.timeOut ?? null,
    timeIn: record.timeIn ?? null,
    odometerStart:
      record.dayStartOdometer ?? record.odometerStart ?? record.openingOdo ?? null,
    odometerEnd:
      record.dayEndOdometer ?? record.odometerEnd ?? record.closingOdo ?? null,
    departingFromPoint: routeStops.fromLocation,
    goingToPoint: routeStops.toLocation,
    fromLocation: routeStops.fromLocation,
    toLocation: routeStops.toLocation,
    passengerCount: record.totalPassengers ?? null,
    amountCollected: record.amountClaimed ?? record.amount ?? null,
  };
};

const getPaperTripTimes = (entry = {}) => {
  const rawTimeOut = toTimeValue(entry.timeOut ?? entry.time_out);
  const rawTimeIn = toTimeValue(entry.timeIn ?? entry.time_in);
  const timeOutMinutes = parseTimeToMinutes(rawTimeOut);
  const timeInMinutes = parseTimeToMinutes(rawTimeIn);

  if (
    Number.isFinite(timeOutMinutes) &&
    Number.isFinite(timeInMinutes) &&
    timeInMinutes < timeOutMinutes
  ) {
    return {
      timeOut: rawTimeIn,
      timeIn: rawTimeOut,
    };
  }

  return {
    timeOut: rawTimeOut,
    timeIn: rawTimeIn,
  };
};

const buildTripsTable = (record) => {
  const storedTripCount = toPositiveNumber(record.tripCount);
  const storedPassengerTotal = toPositiveNumber(record.totalPassengers);
  const storedTakingsTotal = roundAmount(record.amountClaimed ?? record.amount);
  const sourceEntries =
    Array.isArray(record.tripLogbook) && record.tripLogbook.length > 0
      ? record.tripLogbook
      : [buildFallbackTripEntry(record)];

  return sourceEntries
    .map((entry, index) => {
      const tripAnalytics = calculateTripAnalytics(entry);
      const paperTimes = getPaperTripTimes(entry);
      const passengerCount =
        toPositiveNumber(entry.passengerCount ?? entry.passenger_count) ??
        (sourceEntries.length === 1 ? storedPassengerTotal : null);
      const tripAmountExpected =
        roundAmount(
          entry.amountCollected ??
            entry.amount_collected ??
            entry.tripAmountExpected ??
            entry.trip_amount_expected,
        ) ??
        (sourceEntries.length === 1 ? storedTakingsTotal : null);

      return {
        rowId: normalizeText(entry.id) ?? `${record.id}-row-${index + 1}`,
        timeOut: paperTimes.timeOut,
        timeIn: paperTimes.timeIn,
        odometerStart:
          toFiniteNumber(
            entry.odometerStart ??
              entry.odometer_start ??
              entry.openingOdo ??
              entry.opening_odo,
          ) ?? null,
        odometerEnd:
          toFiniteNumber(
            entry.odometerEnd ??
              entry.odometer_end ??
              entry.closingOdo ??
              entry.closing_odo,
          ) ?? null,
        kmComputed: roundAmount(tripAnalytics.kmComputed),
        routeName: buildRouteName(entry, record.route),
        passengerCount,
        tripAmountExpected,
      };
    })
    .slice(0, storedTripCount ?? sourceEntries.length);
};

const buildTotals = (record, tripsTable) => {
  const derivedTotals = calculateDailyAnalytics({
    trips: tripsTable.map((row) => ({
      id: row.rowId,
      passengerCount: row.passengerCount,
      amountCollected: row.tripAmountExpected,
    })),
    totalTakingsExpected: roundAmount(record.amountClaimed ?? record.amount),
  });

  return {
    totalPassengers:
      toPositiveNumber(record.totalPassengers) ?? derivedTotals.totalPassengers ?? 0,
    totalTrips: toPositiveNumber(record.tripCount) ?? derivedTotals.totalTrips ?? tripsTable.length,
    totalTakingsExpected:
      roundAmount(record.amountClaimed ?? record.amount) ??
      roundAmount(derivedTotals.totalTakingsExpected) ??
      0,
  };
};

const buildDailyExpenses = (expenses) =>
  expenses.map((expense) => ({
    category: normalizeText(expense.category) ?? "Uncategorised",
    amount: roundAmount(expense.amount) ?? 0,
    notes: normalizeText(expense.notes ?? expense.description),
    receiptRef: normalizeText(expense.reference ?? expense.receiptRef ?? expense.receipt_ref),
  }));

const buildAnalytics = (record, tripsTable, dailyExpenses, totals) => {
  const analytics = calculateDailyAnalytics({
    trips: tripsTable.map((row) => ({
      id: row.rowId,
      // The report shape follows paper-logbook semantics:
      // timeOut=departure and timeIn=arrival.
      // The shared analytics helper expects timeIn=start and timeOut=finish.
      timeIn: row.timeOut,
      timeOut: row.timeIn,
      odometerStart: row.odometerStart,
      odometerEnd: row.odometerEnd,
      passengerCount: row.passengerCount,
      amountCollected: row.tripAmountExpected,
    })),
    expenses: dailyExpenses,
    totalTakingsExpected: totals.totalTakingsExpected,
    totalExpenses: roundAmount(
      dailyExpenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0),
    ),
    dayRecord: record,
  });

  const avgTripTakings =
    totals.totalTrips > 0
      ? roundAmount(totals.totalTakingsExpected / totals.totalTrips)
      : null;
  const avgPassengers =
    totals.totalTrips > 0 ? roundAmount(totals.totalPassengers / totals.totalTrips) : null;
  const avgTripKm =
    analytics.observedTripKmCount > 0
      ? roundAmount(analytics.avgTripKm)
      : analytics.dayKm != null && totals.totalTrips > 0
        ? roundAmount(analytics.dayKm / totals.totalTrips)
        : null;
  const avgTripDurationMin =
    analytics.observedTripDurationCount > 0 ? roundAmount(analytics.avgTripDurationMin) : null;
  const avgWaitingMin =
    analytics.waitingIntervalCount > 0 ? roundAmount(analytics.avgWaitingMin) : null;

  return {
    avgTripKm,
    avgTripDurationMin,
    avgWaitingMin,
    avgTripTakings,
    avgPassengers,
    kmPerDay: roundAmount(analytics.dayKm),
  };
};

const buildDiscrepancyReason = ({ record, variance }) => {
  const reasons = [];

  if (variance != null && variance !== 0) {
    reasons.push("Submitted amount differs from expected net takings.");
  }

  if (record.discrepancy) {
    reasons.push("Daily odometer readings need review.");
  }

  if (record.status === "pending" && record.actualCashReceived == null) {
    reasons.push("Cash hand-in not recorded yet.");
  }

  return reasons.length > 0 ? reasons.join(" ") : null;
};

const mapVerificationStatus = (status) =>
  (
    {
      pending: "Waiting for admin hand-in",
      counted: "Admin hand-in recorded",
      verified: "Manager verified",
      banked: "Deposited",
    }[String(status ?? "").trim().toLowerCase()] ?? normalizeText(status)
  ) || "Unknown";

const buildVerificationNotes = (record) => {
  const parts = [];

  if (normalizeText(record.notes)) {
    parts.push(normalizeText(record.notes));
  }

  if (record.countedAt) {
    parts.push(
      `Admin hand-in recorded at ${record.countedAt}${
        normalizeText(record.countedByRole) ? ` by ${record.countedByRole}` : ""
      }.`,
    );
  }

  if (record.verifiedAt) {
    parts.push(
      `Manager verification completed at ${record.verifiedAt}${
        normalizeText(record.verifiedByRole) ? ` by ${record.verifiedByRole}` : ""
      }.`,
    );
  }

  if (record.depositId) {
    parts.push(`Included in deposit ${record.depositId}.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
};

export const buildDailyLogReportView = (snapshot, reportId) => {
  const targetId = normalizeText(reportId);

  if (!snapshot || !targetId) {
    throw createHttpError(400, "A daily log id is required to build the report view.");
  }

  const record = (snapshot.financeTransactions ?? []).find(
    (item) =>
      item.id === targetId && item.type === "income" && item.incomeKind === "standard",
  );

  if (!record) {
    throw createHttpError(404, "The requested daily log could not be found.");
  }

  const vehicle = resolveVehicleRecord(snapshot, record);
  const driver = resolveDriverRecord(snapshot, record, vehicle);
  const tripsTable = buildTripsTable(record);
  const totals = buildTotals(record, tripsTable);
  const matchedExpenses = getMatchingDailyExpenses(snapshot, record);
  const dailyExpenses = buildDailyExpenses(matchedExpenses);
  const expensesTotal =
    roundAmount(dailyExpenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0)) ?? 0;
  const analytics = buildAnalytics(record, tripsTable, dailyExpenses, totals);
  const amountSubmitted = roundAmount(record.actualCashReceived);
  const bankedAmount =
    record.status === "banked" || record.depositId
      ? roundAmount(record.actualCashReceived ?? record.amountClaimed ?? record.amount)
      : null;
  const expectedNet = roundAmount(totals.totalTakingsExpected - expensesTotal) ?? 0;
  const variance =
    amountSubmitted != null ? roundAmount(amountSubmitted - expectedNet) : null;

  return {
    reportType: "DailyLogReportView",
    reportId: record.id,
    header: {
      date: getReportDateKey(record),
      driver: normalizeText(driver?.name) ?? "Unknown driver",
      vehicle: normalizeText(vehicle?.registration ?? record.vehicle) ?? null,
      brandModel: normalizeText(vehicle?.model) ?? null,
      seatingCapacity:
        toPositiveNumber(vehicle?.seatCapacity ?? vehicle?.seat_capacity) ?? 15,
      vehicleNo:
        normalizeText(vehicle?.vehicleNo ?? vehicle?.vehicle_number ?? vehicle?.registration) ??
        normalizeText(record.vehicle),
    },
    tripsTable,
    totals,
    dailyExpenses,
    expensesTotal,
    analytics,
    bankingCheckin: {
      collectedExpected: totals.totalTakingsExpected,
      spentTotal: expensesTotal,
      submitted: amountSubmitted,
      amountSubmitted,
      bankedAmount,
      variance,
      discrepancyReason: buildDiscrepancyReason({ record, variance }),
    },
    verification: {
      adminStatus: mapVerificationStatus(record.status),
      notes: buildVerificationNotes(record),
    },
  };
};
