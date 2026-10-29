// Period reports (Reports > Business / Vehicle). Pure and shared: the server
// endpoint (api/admin/reports/period.js) builds the report once and the screen,
// the CSV and the PDF all render that same object, so they always reconcile.
// Money is summed in cents. Operating dates are calendar dates ("2026-03-27"):
// income uses tripDate, expenses expenseDate; a record without one is dated by
// its capture time in South African time (and the report says so).

import { SALARY_SOURCE_LABELS } from "./salaryContract.js";

export const REPORT_PERIODS = Object.freeze(["daily", "weekly", "monthly", "custom"]);
export const REPORT_PERIOD_LABELS = Object.freeze({ daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom dates" });
export const REPORT_SCOPES = Object.freeze(["business", "vehicle"]);
export const MAX_CUSTOM_DAYS = 731;
const STATUSES = ["pending", "counted", "verified", "banked"];
export const REPORT_STATUS_LABELS = Object.freeze({ pending: "Submitted", counted: "Counted", verified: "Verified", banked: "Banked" });
const GENERAL_VEHICLE_LABELS = new Set(["", "general", "none", "no vehicle"]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SAST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" });

export class ReportRequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const text = (value) => String(value ?? "").trim();
const toDate = (value) => new Date(`${value}T00:00:00Z`);
const validDate = (value) => DATE.test(value) && !Number.isNaN(toDate(value).getTime()) && toDate(value).toISOString().slice(0, 10) === value;
const addDays = (value, days) => new Date(toDate(value).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const dayCount = (start, end) => Math.round((toDate(end) - toDate(start)) / 86_400_000) + 1;
const cents = (value) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
};
const rand = (centsValue) => centsValue / 100;
const sumCents = (items, pick) => items.reduce((total, item) => total + cents(pick(item)), 0);

export const formatReportDate = (value) =>
  DATE.test(text(value)) ? `${Number(value.slice(8))} ${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}` : text(value);

export const sastDateOf = (value) => {
  const time = Date.parse(text(value));
  return Number.isNaN(time) ? null : SAST_DAY.format(time);
};

// --- Period ---------------------------------------------------------------
// daily: that date; weekly: Monday to Sunday containing the date (the salary
// week); monthly: the calendar month; custom: start to end inclusive.
export const resolveReportPeriod = ({ period, date, month, start, end } = {}) => {
  const kind = text(period).toLowerCase();
  if (!REPORT_PERIODS.includes(kind)) throw new ReportRequestError("Choose a period: daily, weekly, monthly or custom.");

  let from;
  let to;
  if (kind === "custom") {
    from = text(start);
    to = text(end);
    if (!validDate(from) || !validDate(to)) throw new ReportRequestError("Choose a valid start and end date.");
    if (from > to) throw new ReportRequestError("The start date must be on or before the end date.");
    if (dayCount(from, to) > MAX_CUSTOM_DAYS) throw new ReportRequestError(`Custom reports cover at most ${MAX_CUSTOM_DAYS} days.`);
  } else if (kind === "monthly") {
    const key = MONTH.test(text(month)) ? text(month) : text(date).slice(0, 7);
    if (!validDate(`${key}-01`)) throw new ReportRequestError("Choose a valid month.");
    from = `${key}-01`;
    const next = toDate(from);
    next.setUTCMonth(next.getUTCMonth() + 1);
    to = addDays(next.toISOString().slice(0, 10), -1);
  } else {
    const day = text(date);
    if (!validDate(day)) throw new ReportRequestError("Choose a valid date.");
    from = kind === "weekly" ? addDays(day, -((toDate(day).getUTCDay() + 6) % 7)) : day;
    to = kind === "weekly" ? addDays(from, 6) : day;
  }

  const label =
    kind === "daily"
      ? formatReportDate(from)
      : kind === "monthly"
        ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)} (${formatReportDate(from)} to ${formatReportDate(to)})`
        : `${formatReportDate(from)} to ${formatReportDate(to)}`;

  return { kind, kindLabel: REPORT_PERIOD_LABELS[kind], start: from, end: to, days: dayCount(from, to), label };
};

// --- Records ----------------------------------------------------------------
export const reportDateOf = (record = {}) => {
  const explicit = text(record.type === "expense" ? record.expenseDate : record.tripDate);
  if (validDate(explicit)) return { date: explicit, fromTimestamp: false };
  const fallback = sastDateOf(record.timestamp ?? record.createdAt);
  return { date: fallback, fromTimestamp: Boolean(fallback) };
};

const incomeAmount = (record) => record.amountClaimed ?? record.amount;
const normalizeStatus = (status) => {
  const value = text(status).toLowerCase();
  return STATUSES.includes(value) ? value : "pending";
};

const findVehicle = (vehicles, record) => {
  const id = text(record.vehicleId);
  if (id) return vehicles.find((vehicle) => vehicle.id === id) ?? null;
  const label = text(record.vehicle).toLowerCase();
  return label ? vehicles.find((vehicle) => text(vehicle.registration).toLowerCase() === label) ?? null : null;
};

// Where a record sits for allocation. A record counts for a vehicle only when it
// names that vehicle; nothing is spread across vehicles.
const allocationOf = (vehicles, record) => {
  const vehicle = findVehicle(vehicles, record);
  if (vehicle) return { vehicleId: vehicle.id, vehicleLabel: text(vehicle.registration) || vehicle.id };
  const label = text(record.vehicle);
  if (!text(record.vehicleId) && GENERAL_VEHICLE_LABELS.has(label.toLowerCase())) return { vehicleId: null, vehicleLabel: null };
  // Names a vehicle that is no longer on file: keep its own label, unmatched.
  return { vehicleId: null, vehicleLabel: label || text(record.vehicleId), unmatched: true };
};

// Names only: an email address is never printed as a driver name.
const driverNameOf = (snapshot, record) => {
  const salaryName = text(record.salaryPayment?.driverName);
  const explicit = salaryName || text(record.driverName ?? record.driver_name);
  const staffId = text(record.driverStaffId ?? record.driver_staff_id ?? (record.createdByRole === "Driver" ? record.createdBy : ""));
  const staff = staffId ? (snapshot.drivers ?? []).find((driver) => driver.staffId === staffId || driver.id === staffId) : null;
  const name = explicit || text(staff?.name);
  return name && !name.includes("@") ? name : null;
};

const toLine = (snapshot, vehicles, record, dated) => {
  const isIncome = record.type === "income";
  const salary = !isIncome && record.salaryPayment ? record.salaryPayment : null;
  const allocation = allocationOf(vehicles, record);
  const category = isIncome
    ? record.incomeKind === "special" ? "Special hire" : "Trip income"
    : salary ? "Salary" : text(record.category) || "Uncategorised";
  const description = isIncome
    ? text(record.route ?? record.description) || (record.incomeKind === "special" ? "Special hire" : "Trip")
    : salary
      ? `Driver salary / ${text(salary.driverName) || "Driver"} / ${text(salary.periodLabel ?? salary.period)}`
      : text(record.description) || text(record.category) || "Expense";
  return {
    id: text(record.id),
    date: dated.date,
    dateFromTimestamp: dated.fromTimestamp,
    type: isIncome ? "income" : "expense",
    category,
    description,
    vehicleId: allocation.vehicleId,
    vehicle: allocation.vehicleLabel,
    vehicleUnmatched: Boolean(allocation.unmatched),
    driver: driverNameOf(snapshot, record),
    status: normalizeStatus(record.status),
    paidBy: isIncome ? "" : salary ? salary.method : record.cashExpense ? "cash" : "bank/other",
    paidFrom: salary ? SALARY_SOURCE_LABELS[salary.source] ?? "" : "",
    asset: !isIncome && record.expenseKind === "asset",
    salary: Boolean(salary),
    salaryFromTakings: salary?.source === "driver_takings",
    special: isIncome && record.incomeKind === "special",
    openingOdo: isIncome ? Number(record.openingOdo) : null,
    closingOdo: isIncome ? Number(record.closingOdo) : null,
    reference: text(record.reference ?? record.depositId),
    amountCents: cents(isIncome ? incomeAmount(record) : record.amount),
  };
};

const collectLines = (snapshot, vehicles, period) => {
  const lines = [];
  let undated = 0;
  for (const record of snapshot.financeTransactions ?? []) {
    if (!["income", "expense"].includes(record?.type)) continue;
    const dated = reportDateOf(record);
    if (!dated.date) {
      undated += 1;
      continue;
    }
    if (dated.date < period.start || dated.date > period.end) continue;
    lines.push(toLine(snapshot, vehicles, record, dated));
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  return { lines, undated };
};

const breakdownOf = (expenseLines) => {
  const groups = new Map();
  for (const line of expenseLines) {
    const group = groups.get(line.category) ?? { category: line.category, count: 0, amountCents: 0 };
    group.count += 1;
    group.amountCents += line.amountCents;
    groups.set(line.category, group);
  }
  return [...groups.values()].sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
};

const statusSummary = (lines) =>
  STATUSES.map((status) => {
    const income = lines.filter((line) => line.status === status && line.type === "income");
    const expenses = lines.filter((line) => line.status === status && line.type === "expense");
    return {
      status,
      label: REPORT_STATUS_LABELS[status],
      incomeCount: income.length,
      incomeCents: sumCents(income, (line) => rand(line.amountCents)),
      expenseCount: expenses.length,
      expenseCents: sumCents(expenses, (line) => rand(line.amountCents)),
    };
  });

const cashCheckingOf = (snapshot, period, driverFilter = null) => {
  const days = (snapshot.dailyCashUps ?? [])
    .filter((entry) => validDate(text(entry.workDate)) && entry.workDate >= period.start && entry.workDate <= period.end)
    .filter((entry) => !driverFilter || driverFilter(entry))
    .map((entry) => {
      const expected = cents(entry.expectedCashIn);
      const hasCount = entry.actualCashReceived != null && entry.actualCashReceived !== "" && Number.isFinite(Number(entry.actualCashReceived));
      const counted = hasCount ? cents(entry.actualCashReceived) : null;
      return {
        id: text(entry.id),
        date: entry.workDate,
        driver: text(entry.driverName) && !text(entry.driverName).includes("@") ? text(entry.driverName) : "Driver",
        status: normalizeStatus(entry.status),
        closedWithoutDeposit: entry?.settlement?.closedWithoutDeposit === true,
        expectedCents: expected,
        countedCents: counted,
        varianceCents: counted == null ? null : counted - expected,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.driver.localeCompare(b.driver));
  const counted = days.filter((day) => day.countedCents != null);
  return {
    days,
    dayCount: days.length,
    byStatus: STATUSES.map((status) => ({ status, label: REPORT_STATUS_LABELS[status], count: days.filter((day) => day.status === status).length })),
    awaitingCount: days.filter((day) => day.countedCents == null).length,
    closedWithoutDeposit: days.filter((day) => day.closedWithoutDeposit).length,
    expectedCents: sumCents(days, (day) => rand(day.expectedCents)),
    countedCents: sumCents(counted, (day) => rand(day.countedCents)),
    expectedOfCountedCents: sumCents(counted, (day) => rand(day.expectedCents)),
    shortCents: counted.reduce((total, day) => total + Math.max(-day.varianceCents, 0), 0),
    overCents: counted.reduce((total, day) => total + Math.max(day.varianceCents, 0), 0),
  };
};

const bankingOf = (snapshot, period) => {
  const deposits = (snapshot.deposits ?? [])
    .map((deposit) => ({ deposit, date: sastDateOf(deposit.timestamp) }))
    .filter(({ date }) => date && date >= period.start && date <= period.end)
    .map(({ deposit, date }) => ({
      id: text(deposit.depositId),
      date,
      reference: text(deposit.reference) || text(deposit.depositId),
      recordsLocked: Number(deposit.recordsLocked ?? (deposit.transactionIds ?? []).length) || 0,
      takingsCents: cents(deposit.verifiedTakings),
      cashExpensesCents: cents(deposit.cashExpenses),
      depositCents: cents(deposit.depositAmount),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  return { deposits, count: deposits.length, depositCents: sumCents(deposits, (deposit) => rand(deposit.depositCents)) };
};

const vehicleIdentity = (vehicle) => ({
  id: vehicle.id,
  registration: text(vehicle.registration) || vehicle.id,
  model: text(vehicle.model) || null,
  route: text(vehicle.route) || null,
  status: vehicle.archivedAt ? "archived" : text(vehicle.status) || "active",
});

const NET_LABEL = "Net result (recorded income less recorded expenses)";
const BASE_NOTES = [
  "Net result is recorded income less recorded expenses for these dates. It is not accounting profit: TaxiFlow does not record depreciation, tax, loan repayments, or opening and closing balances.",
  "Income is the takings recorded on each trip or special hire. Cash actually counted is shown under Cash checking.",
  "Every recorded entry is included whatever its checking status; see Verification status.",
];

const datingNotes = (lines, undated) => {
  const notes = [];
  const fromTimestamp = lines.filter((line) => line.dateFromTimestamp).length;
  if (fromTimestamp) notes.push(`${fromTimestamp} ${fromTimestamp === 1 ? "entry has" : "entries have"} no operating date and ${fromTimestamp === 1 ? "is" : "are"} dated by when ${fromTimestamp === 1 ? "it was" : "they were"} captured (South African time).`);
  if (undated) notes.push(`${undated} ${undated === 1 ? "entry has" : "entries have"} no date at all and ${undated === 1 ? "is" : "are"} not in any period report.`);
  return notes;
};

const SAST_STAMP = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const stamp = (options) => {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  return { generatedAt, generatedAtLabel: `${SAST_STAMP.format(new Date(generatedAt))} SAST`, businessName: text(options.businessName) || null };
};

// Expenses filed under "Salary" before salary payments existed carry no driver
// or period, so they cannot be counted as driver salaries.
const legacySalaryNote = (expenses) => {
  const legacy = expenses.filter((line) => !line.salary && line.category.toLowerCase() === "salary");
  if (!legacy.length) return [];
  return [`${legacy.length} ${legacy.length === 1 ? "expense" : "expenses"} (R ${rand(legacy.reduce((t, l) => t + l.amountCents, 0)).toFixed(2)}) in the category Salary ${legacy.length === 1 ? "was" : "were"} recorded without a driver salary payment, so ${legacy.length === 1 ? "it is" : "they are"} shown under ${legacy[0].vehicleId ? "vehicle expenses" : "business costs without a vehicle"}, not under Driver salaries.`];
};

// --- Business report ---------------------------------------------------------
export const buildBusinessReport = (snapshot = {}, periodInput = {}, options = {}) => {
  const period = periodInput.start ? periodInput : resolveReportPeriod(periodInput);
  const vehicles = Array.isArray(snapshot.vehicles) ? snapshot.vehicles : [];
  const { lines, undated } = collectLines(snapshot, vehicles, period);
  const income = lines.filter((line) => line.type === "income");
  const expenses = lines.filter((line) => line.type === "expense");
  const salaries = expenses.filter((line) => line.salary);
  const vehicleExpenses = expenses.filter((line) => !line.salary && (line.vehicleId || line.vehicleUnmatched));
  const unallocated = expenses.filter((line) => !line.salary && !line.vehicleId && !line.vehicleUnmatched);

  const incomeCents = sumCents(income, (line) => rand(line.amountCents));
  const expenseCents = sumCents(expenses, (line) => rand(line.amountCents));
  const salaryCents = sumCents(salaries, (line) => rand(line.amountCents));
  const vehicleExpenseCents = sumCents(vehicleExpenses, (line) => rand(line.amountCents));
  const unallocatedCents = sumCents(unallocated, (line) => rand(line.amountCents));

  // Per vehicle: only what names that vehicle. Rows exist for every vehicle
  // with activity, plus "No vehicle recorded" income when some exists.
  const byVehicle = new Map();
  const rowFor = (key, label) => {
    if (!byVehicle.has(key)) byVehicle.set(key, { key, label, incomeCents: 0, expenseCents: 0, trips: 0 });
    return byVehicle.get(key);
  };
  for (const line of [...income, ...vehicleExpenses]) {
    const key = line.vehicleId ?? (line.vehicle ? `label:${line.vehicle}` : "none");
    const row = rowFor(key, line.vehicle ?? "No vehicle recorded");
    if (line.type === "income") {
      row.incomeCents += line.amountCents;
      if (!line.special) row.trips += 1;
    } else row.expenseCents += line.amountCents;
  }
  const vehicleRows = [...byVehicle.values()]
    .map((row) => ({ ...row, netCents: row.incomeCents - row.expenseCents }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const assetCents = sumCents(expenses.filter((line) => line.asset), (line) => rand(line.amountCents));
  const notes = [
    ...BASE_NOTES,
    "Business costs without a vehicle and driver salaries are shown separately; they are not spread across vehicles.",
    ...(assetCents ? [`Expenses include R ${rand(assetCents).toFixed(2)} of asset purchases recorded as expenses.`] : []),
    ...legacySalaryNote(expenses),
    "Cash checking lists driver day hand-ins. Entries captured before day hand-ins existed appear only under Verification status.",
    "Deposits are listed by the date they were banked, which can differ from the dates of the entries they contain.",
    ...datingNotes(lines, undated),
  ];

  return {
    kind: "business",
    title: "Business report",
    scope: { type: "business", label: "Overall business", vehicleId: null },
    period,
    ...stamp(options),
    netLabel: NET_LABEL,
    totals: {
      incomeCents,
      standardIncomeCents: sumCents(income.filter((line) => !line.special), (line) => rand(line.amountCents)),
      specialIncomeCents: sumCents(income.filter((line) => line.special), (line) => rand(line.amountCents)),
      expenseCents,
      salaryCents,
      salaryFromTakingsCents: sumCents(salaries.filter((line) => line.salaryFromTakings), (line) => rand(line.amountCents)),
      vehicleExpenseCents,
      unallocatedCents,
      assetCents,
      netCents: incomeCents - expenseCents,
      incomeCount: income.length,
      expenseCount: expenses.length,
      salaryCount: salaries.length,
      unallocatedCount: unallocated.length,
    },
    expenseBreakdown: breakdownOf(expenses),
    unallocatedBreakdown: breakdownOf(unallocated),
    salaries: salaries.map((line) => ({ id: line.id, date: line.date, driver: line.driver, description: line.description, paidBy: line.paidBy, paidFrom: line.paidFrom, amountCents: line.amountCents })),
    vehicles: vehicleRows,
    verification: statusSummary(lines),
    cashChecking: cashCheckingOf(snapshot, period),
    banking: bankingOf(snapshot, period),
    transactions: lines,
    notes,
    reconciliation: reconcile({ lines, incomeCents, expenseCents, salaryCents, vehicleExpenseCents, unallocatedCents, vehicleRows }),
  };
};

const reconcile = ({ lines, incomeCents, expenseCents, salaryCents = 0, vehicleExpenseCents = 0, unallocatedCents = 0, vehicleRows = null }) => {
  const checks = [
    { label: "Transaction lines add up to income", ok: lines.filter((l) => l.type === "income").reduce((t, l) => t + l.amountCents, 0) === incomeCents },
    { label: "Transaction lines add up to expenses", ok: lines.filter((l) => l.type === "expense").reduce((t, l) => t + l.amountCents, 0) === expenseCents },
  ];
  if (vehicleRows) {
    checks.push({ label: "Vehicle expenses + business costs without a vehicle + salaries = expenses", ok: vehicleExpenseCents + unallocatedCents + salaryCents === expenseCents });
    checks.push({
      label: "Vehicle results - business costs without a vehicle - salaries = net result",
      ok: vehicleRows.reduce((t, row) => t + row.netCents, 0) - unallocatedCents - salaryCents === incomeCents - expenseCents,
    });
  }
  return { ok: checks.every((check) => check.ok), checks };
};

// --- Vehicle report ----------------------------------------------------------
export const buildVehicleReport = (snapshot = {}, periodInput = {}, vehicleId, options = {}) => {
  const period = periodInput.start ? periodInput : resolveReportPeriod(periodInput);
  const vehicles = Array.isArray(snapshot.vehicles) ? snapshot.vehicles : [];
  const vehicle = vehicles.find((entry) => entry.id === text(vehicleId));
  if (!vehicle) throw new ReportRequestError("Choose a vehicle on file for this business.", 404);

  const { lines: all, undated } = collectLines(snapshot, vehicles, period);
  const lines = all.filter((line) => line.vehicleId === vehicle.id && !line.salary);
  const income = lines.filter((line) => line.type === "income");
  const expenses = lines.filter((line) => line.type === "expense");
  const incomeCents = sumCents(income, (line) => rand(line.amountCents));
  const expenseCents = sumCents(expenses, (line) => rand(line.amountCents));
  const trips = income.filter((line) => !line.special);
  const distances = trips
    .map((line) => line.closingOdo - line.openingOdo)
    .filter((km) => Number.isFinite(km) && km > 0 && km < 5000);
  const drivers = [...new Set(lines.map((line) => line.driver).filter(Boolean))].sort();
  const assetCents = sumCents(expenses.filter((line) => line.asset), (line) => rand(line.amountCents));
  const assigned = vehicle.assignedDriverId
    ? (snapshot.drivers ?? []).find((driver) => driver.staffId === vehicle.assignedDriverId || driver.id === vehicle.assignedDriverId)
    : null;

  return {
    kind: "vehicle",
    title: "Vehicle report",
    scope: { type: "vehicle", label: text(vehicle.registration) || vehicle.id, vehicleId: vehicle.id },
    vehicle: { ...vehicleIdentity(vehicle), assignedDriver: text(assigned?.name) && !text(assigned?.name).includes("@") ? text(assigned.name) : null },
    period,
    ...stamp(options),
    netLabel: "Vehicle net result (its recorded income less its own expenses)",
    totals: {
      incomeCents,
      standardIncomeCents: sumCents(trips, (line) => rand(line.amountCents)),
      specialIncomeCents: sumCents(income.filter((line) => line.special), (line) => rand(line.amountCents)),
      expenseCents,
      assetCents,
      netCents: incomeCents - expenseCents,
      incomeCount: income.length,
      expenseCount: expenses.length,
    },
    activity: {
      trips: trips.length,
      specialHires: income.length - trips.length,
      activeDays: new Set(income.map((line) => line.date)).size,
      distanceKm: distances.reduce((total, km) => total + km, 0),
      tripsWithDistance: distances.length,
      drivers,
    },
    expenseBreakdown: breakdownOf(expenses),
    verification: statusSummary(lines),
    transactions: lines,
    notes: [
      ...BASE_NOTES,
      "Only entries recorded against this vehicle are included. Business costs without a vehicle and driver salaries are not allocated to vehicles; they are in the Overall business report.",
      "Distance is closing less opening odometer on trips where both were recorded.",
      "Cash checking and banking are per driver day and per deposit, not per vehicle; see the Overall business report.",
      ...(assetCents ? [`Expenses include R ${rand(assetCents).toFixed(2)} of asset purchases recorded as expenses.`] : []),
      ...datingNotes(all.filter((line) => line.vehicleId === vehicle.id), undated),
    ],
    reconciliation: reconcile({ lines, incomeCents, expenseCents }),
  };
};

export const buildPeriodReport = (snapshot, { scope = "business", vehicleId = null, ...periodInput } = {}, options = {}) => {
  const kind = text(scope).toLowerCase();
  if (!REPORT_SCOPES.includes(kind)) throw new ReportRequestError("Choose a scope: overall business or one vehicle.");
  const period = resolveReportPeriod(periodInput);
  return kind === "vehicle" ? buildVehicleReport(snapshot, period, vehicleId, options) : buildBusinessReport(snapshot, period, options);
};

// --- CSV ---------------------------------------------------------------------
const csvCell = (value) => {
  const cell = String(value ?? "");
  // Leading = + - @ would run as a formula in a spreadsheet; numbers stay numeric.
  const safe = /^[=+\-@]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const centsToAmount = (value) => (value / 100).toFixed(2);

export const periodReportFilename = (report, extension) => {
  const scope = report.kind === "vehicle" ? `vehicle-${report.scope.label}` : "business";
  const safe = `${scope}-${report.period.start}-to-${report.period.end}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `taxiflow-${safe}.${extension}`;
};

export const periodReportCsv = (report) => {
  const t = report.totals;
  const rows = [
    [`TaxiFlow ${report.title.toLowerCase()}`, report.businessName ?? ""],
    ["Scope", report.scope.label],
    ["Period", `${report.period.kindLabel}: ${report.period.label}`],
    ["From", report.period.start],
    ["To", report.period.end],
    ["Generated", report.generatedAtLabel],
    [],
    ["Summary", "Amount (R)"],
    ["Income", centsToAmount(t.incomeCents)],
    ["  Trip income", centsToAmount(t.standardIncomeCents)],
    ["  Special hires", centsToAmount(t.specialIncomeCents)],
    ["Expenses", centsToAmount(t.expenseCents)],
  ];
  if (report.kind === "business") {
    rows.push(
      ["  Vehicle expenses", centsToAmount(t.vehicleExpenseCents)],
      ["  Business costs without a vehicle", centsToAmount(t.unallocatedCents)],
      ["  Driver salaries", centsToAmount(t.salaryCents)],
      ["    of which paid from drivers' takings", centsToAmount(t.salaryFromTakingsCents)],
    );
  }
  rows.push([report.netLabel, centsToAmount(t.netCents)]);

  if (report.kind === "vehicle") {
    const v = report.vehicle;
    const a = report.activity;
    rows.push([], ["Vehicle"], ["Registration", v.registration], ["Model", v.model ?? ""], ["Route", v.route ?? ""], ["Status", v.status], ["Assigned driver", v.assignedDriver ?? ""],
      [], ["Activity"], ["Trips", a.trips], ["Special hires", a.specialHires], ["Days with income", a.activeDays], ["Distance (km)", a.distanceKm], ["Trips with odometer readings", a.tripsWithDistance], ["Drivers", a.drivers.join("; ")]);
  }

  rows.push([], ["Expense breakdown", "Entries", "Amount (R)"], ...report.expenseBreakdown.map((g) => [g.category, g.count, centsToAmount(g.amountCents)]));

  if (report.kind === "business") {
    rows.push([], ["Business costs without a vehicle", "Entries", "Amount (R)"], ...report.unallocatedBreakdown.map((g) => [g.category, g.count, centsToAmount(g.amountCents)]));
    rows.push([], ["By vehicle (own entries only)", "Trips", "Income (R)", "Expenses (R)", "Net (R)"],
      ...report.vehicles.map((row) => [row.label, row.trips, centsToAmount(row.incomeCents), centsToAmount(row.expenseCents), centsToAmount(row.netCents)]));
  }

  rows.push([], ["Verification status", "Income entries", "Income (R)", "Expense entries", "Expenses (R)"],
    ...report.verification.map((s) => [s.label, s.incomeCount, centsToAmount(s.incomeCents), s.expenseCount, centsToAmount(s.expenseCents)]));

  if (report.kind === "business") {
    const c = report.cashChecking;
    rows.push([], ["Cash checking (driver day hand-ins)"], ["Days", c.dayCount], ["Awaiting count", c.awaitingCount], ["Closed with no cash to bank", c.closedWithoutDeposit],
      ["Expected cash (all days)", centsToAmount(c.expectedCents)], ["Counted cash", centsToAmount(c.countedCents)], ["Expected cash on counted days", centsToAmount(c.expectedOfCountedCents)],
      ["Short", centsToAmount(c.shortCents)], ["Over", centsToAmount(c.overCents)],
      [], ["Date", "Driver", "Status", "Expected (R)", "Counted (R)", "Variance (R)"],
      ...c.days.map((d) => [d.date, d.driver, REPORT_STATUS_LABELS[d.status], centsToAmount(d.expectedCents), d.countedCents == null ? "" : centsToAmount(d.countedCents), d.varianceCents == null ? "" : centsToAmount(d.varianceCents)]));
    const b = report.banking;
    rows.push([], ["Banking (by deposit date)", "Reference", "Entries", "Takings (R)", "Cash expenses (R)", "Deposit (R)"],
      ...b.deposits.map((d) => [d.date, d.reference, d.recordsLocked, centsToAmount(d.takingsCents), centsToAmount(d.cashExpensesCents), centsToAmount(d.depositCents)]),
      ["Total deposited", "", b.count, "", "", centsToAmount(b.depositCents)]);
  }

  rows.push([], ["Date", "Type", "Category", "Description", "Vehicle", "Driver", "Status", "Paid by", "Paid from", "Reference", "Amount (R)"],
    ...report.transactions.map((l) => [l.date, l.type === "income" ? "Income" : "Expense", l.category, l.description, l.vehicle ?? "No vehicle", l.driver ?? "", REPORT_STATUS_LABELS[l.status], l.paidBy, l.paidFrom, l.reference, centsToAmount(l.amountCents)]));

  rows.push([], ["Reconciles", report.reconciliation.ok ? "yes" : "NO - check the lines"], ...report.reconciliation.checks.map((c) => [`  ${c.label}`, c.ok ? "yes" : "no"]));
  rows.push([], ["Notes"], ...report.notes.map((note) => [note]));
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
};
