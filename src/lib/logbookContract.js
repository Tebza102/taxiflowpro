// Paper logbook import: shared, pure rules (browser review screen and server).
// No AI here. A logbook row is one driver's day on one vehicle:
//   date, vehicle registration, driver, revenue (takings), the cash expenses paid
//   out of the takings (fuel/diesel, wash, marshal fees, other) and the amount banked.
// Every field is { value, confidence: high|medium|low, note }. An illegible value
// is null with low confidence; nothing here ever fills one in.

export const LOGBOOK_CONFIDENCE = Object.freeze(["high", "medium", "low"]);
export const LOGBOOK_ROW_STATUSES = Object.freeze(["pending", "approved", "rejected"]);

// Expense fields map onto the existing expense records (financeCapture.buildExpense):
// a vehicle ("asset") cash expense with these category names.
export const LOGBOOK_EXPENSE_FIELDS = Object.freeze([
  { key: "fuel", label: "Diesel / fuel", category: "Fuel", description: "Fuel (paper logbook)" },
  { key: "wash", label: "Wash", category: "Wash", description: "Vehicle wash (paper logbook)" },
  { key: "marshalFees", label: "Marshal fees", category: "Rank Fees", description: "Marshal fees (paper logbook)" },
  { key: "otherExpenses", label: "Other expenses", category: "Other", description: "Other expenses (paper logbook)" },
]);

export const LOGBOOK_FIELDS = Object.freeze([
  { key: "date", label: "Date", kind: "date" },
  { key: "vehicleRegistration", label: "Vehicle", kind: "text" },
  { key: "driverName", label: "Driver", kind: "text" },
  { key: "revenue", label: "Revenue", kind: "amount" },
  ...LOGBOOK_EXPENSE_FIELDS.map(({ key, label }) => ({ key, label, kind: "amount" })),
  { key: "banked", label: "Banked", kind: "amount" },
]);
export const LOGBOOK_FIELD_KEYS = Object.freeze(LOGBOOK_FIELDS.map((field) => field.key));
export const LOGBOOK_AMOUNT_KEYS = Object.freeze(LOGBOOK_FIELDS.filter((field) => field.kind === "amount").map((field) => field.key));

export const LOGBOOK_MAX_AMOUNT = 1_000_000; // per field, in rand
export const LOGBOOK_MAX_AGE_DAYS = 731; // older dates are flagged, not refused
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const text = (value) => String(value ?? "").trim();

export const toCents = (value) => Math.round(Number(value) * 100);

// South African date (no daylight saving) for "today" checks on a UTC server.
export const sastToday = (now = new Date()) => new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);

// Strict calendar date: "2026-02-30" is not a date.
export const parseLogbookDate = (value) => {
  const match = DATE.exec(text(value));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
};

// Accepts 1250, "1250.50", "R 1 250,50", "1,250.50". Anything else is null
// (the caller records that it could not be read; it is never guessed).
export const parseLogbookAmount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string") return null;
  let raw = value.trim().replace(/^r\s*/i, "").replace(/[\s ]/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal point; the other groups thousands.
    raw = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1250,50" is a decimal comma; "1,250" groups thousands.
    raw = /,\d{1,2}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
};

export const normalizeRegistration = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normalizePersonName = (value) => text(value).toLowerCase().replace(/\s+/g, " ");

// One canonical field. A missing value is always low confidence.
export const normalizeLogbookField = (field, kind) => {
  const source = field && typeof field === "object" && !Array.isArray(field) ? field : { value: field };
  let value = source.value ?? null;
  let note = text(source.note) || null;
  if (kind === "amount") {
    const parsed = parseLogbookAmount(value);
    if (parsed === null && value !== null && value !== "") note = note ?? `Could not read "${text(value).slice(0, 40)}" as an amount.`;
    value = parsed;
  } else {
    value = text(value) || null;
    if (value && value.length > 120) value = value.slice(0, 120);
  }
  let confidence = LOGBOOK_CONFIDENCE.includes(source.confidence) ? source.confidence : "low";
  if (value === null) confidence = "low";
  if (note && note.length > 300) note = note.slice(0, 300);
  return { value, confidence, note };
};

export const normalizeLogbookFields = (fields = {}) =>
  Object.fromEntries(LOGBOOK_FIELDS.map(({ key, kind }) => [key, normalizeLogbookField(fields?.[key], kind)]));

// What "the same row" means for duplicate detection: driver + vehicle + date +
// every amount (in cents). Hashing lives on the server (api/_lib/logbookHash.js).
export const logbookRowIdentity = (fields) => ({
  driver: normalizePersonName(fields.driverName?.value),
  vehicle: normalizeRegistration(fields.vehicleRegistration?.value),
  date: parseLogbookDate(fields.date?.value) ?? text(fields.date?.value),
  amounts: Object.fromEntries(
    LOGBOOK_AMOUNT_KEYS.map((key) => [key, fields[key]?.value === null || fields[key]?.value === undefined ? null : toCents(fields[key].value)]),
  ),
});

export const findLogbookVehicle = (snapshot, registration) => {
  const wanted = normalizeRegistration(registration);
  if (!wanted) return null;
  return (snapshot?.vehicles ?? []).find((vehicle) => normalizeRegistration(vehicle?.registration) === wanted) ?? null;
};

export const findLogbookDrivers = (snapshot, name) => {
  const wanted = normalizePersonName(name);
  if (!wanted) return [];
  return (snapshot?.drivers ?? []).filter((driver) => text(driver?.staffId) && normalizePersonName(driver?.name) === wanted);
};

// Revenue less the expenses should equal what was banked. Returns null when a
// figure is missing (nothing to compare), otherwise the difference in cents.
export const reconcileLogbookRow = (fields) => {
  const values = LOGBOOK_AMOUNT_KEYS.map((key) => fields[key]?.value);
  if (values.some((value) => value === null || value === undefined)) return null;
  const expenses = LOGBOOK_EXPENSE_FIELDS.reduce((sum, { key }) => sum + toCents(fields[key].value), 0);
  const expected = toCents(fields.revenue.value) - expenses;
  const banked = toCents(fields.banked.value);
  return { expectedBankedCents: expected, bankedCents: banked, differenceCents: banked - expected, reconciles: banked === expected };
};

const issue = (field, code, severity, message) => ({ field, code, severity, message });

// Deterministic checks. "error" blocks approval until an admin corrects the row;
// "warning" must be acknowledged. Returns { issues, vehicleId, driverStaffId, reconciliation }.
export const validateLogbookRow = (fields, snapshot, { today = sastToday() } = {}) => {
  const issues = [];
  let vehicleId = null;
  let driverStaffId = null;

  const rawDate = fields.date?.value;
  const date = parseLogbookDate(rawDate);
  if (rawDate === null || rawDate === undefined) issues.push(issue("date", "missing", "error", "The date could not be read. Enter it from the page."));
  else if (!date) issues.push(issue("date", "invalid_date", "error", "This is not a valid date (use YYYY-MM-DD)."));
  else if (date > today) issues.push(issue("date", "future_date", "error", "The date is in the future."));
  else {
    const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    if (ageDays > LOGBOOK_MAX_AGE_DAYS) issues.push(issue("date", "old_date", "warning", "The date is more than two years ago. Check the year."));
  }

  const registration = fields.vehicleRegistration?.value;
  if (!registration) issues.push(issue("vehicleRegistration", "missing", "error", "The vehicle registration could not be read."));
  else {
    const vehicle = findLogbookVehicle(snapshot, registration);
    if (!vehicle) issues.push(issue("vehicleRegistration", "unknown_vehicle", "error", "No vehicle in this business has this registration."));
    else if (vehicle.archivedAt || text(vehicle.status).toLowerCase() === "archived") issues.push(issue("vehicleRegistration", "archived_vehicle", "error", "This vehicle is archived."));
    else vehicleId = text(vehicle.id);
  }

  const driverName = fields.driverName?.value;
  if (!driverName) issues.push(issue("driverName", "missing", "error", "The driver name could not be read."));
  else {
    const drivers = findLogbookDrivers(snapshot, driverName);
    if (drivers.length === 0) issues.push(issue("driverName", "unknown_driver", "error", "No driver in this business has this name."));
    else if (drivers.length > 1) issues.push(issue("driverName", "ambiguous_driver", "error", "More than one driver has this name."));
    else driverStaffId = text(drivers[0].staffId);
  }

  for (const key of LOGBOOK_AMOUNT_KEYS) {
    const value = fields[key]?.value;
    if (value === null || value === undefined) {
      issues.push(issue(key, "missing", "error", "This amount could not be read. Enter it from the page (0 if there was none)."));
    } else if (!Number.isFinite(value) || value < 0) {
      issues.push(issue(key, "invalid_amount", "error", "Amounts cannot be negative."));
    } else if (value > LOGBOOK_MAX_AMOUNT) {
      issues.push(issue(key, "implausible_amount", "error", "This amount is too large to be a daily logbook figure."));
    }
  }

  const reconciliation = reconcileLogbookRow(fields);
  if (reconciliation && !reconciliation.reconciles) {
    const difference = (reconciliation.differenceCents / 100).toFixed(2);
    const expected = (reconciliation.expectedBankedCents / 100).toFixed(2);
    issues.push(
      issue("banked", "not_reconciled", "warning", `Revenue less expenses is ${expected}, but ${Number(fields.banked.value).toFixed(2)} was banked (difference ${difference}).`),
    );
  }
  if (reconciliation && toCents(fields.revenue.value) === 0 && LOGBOOK_EXPENSE_FIELDS.every(({ key }) => toCents(fields[key].value) === 0)) {
    issues.push(issue("revenue", "empty_row", "error", "This row has no revenue and no expenses, so there is nothing to record."));
  }

  return { issues, vehicleId, driverStaffId, reconciliation };
};

export const hasLogbookErrors = (issues) => (issues ?? []).some((entry) => entry.severity === "error");
export const hasLogbookWarnings = (issues) => (issues ?? []).some((entry) => entry.severity === "warning");
