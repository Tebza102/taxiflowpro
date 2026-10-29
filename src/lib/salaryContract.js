// Driver salaries: shared rules for the browser (demo/legacy saves) and the
// server finance actions (api/_lib/salaryActions.js). Plain JS.
//
// Rules:
// - A salary arrangement (finance.salaryArrangements) is a schedule only. Saving
//   one never creates an expense and is not proof that anything was paid. It
//   gives the next payment date and the scheduled and due amounts.
// - A payment may be recorded with or without a schedule (manual payment). It
//   creates exactly one "Salary" expense for that driver, frequency and pay
//   period; a second one for the same period is refused.
// - The expense keeps the amount actually paid and the scheduled amount for that
//   period; later schedule changes never rewrite past payments.
// - Method (how) and source (where the money came from) are separate:
//     bank -> business_bank          not a cash expense; no driver hand-in change
//     cash -> business_cash          cash expense of the business; no hand-in change
//     cash -> driver_takings         paid out of that driver's takings on the paid
//                                    date: linked to that driver day (driverStaffId),
//                                    so it lowers that day's expected cash once and
//                                    goes through that day's checking (pending).
//   Each is one expense record, so expense totals count it once.

import {
  findDriverCashUpEntry,
  getDriverCashUpWorkflowStatus,
  isClosedWithoutDeposit,
  summarizeDriverDayCash,
} from "./cashUpContract.js";

export const SALARY_FREQUENCIES = Object.freeze(["daily", "weekly", "fortnightly", "monthly"]);
export const SALARY_METHODS = Object.freeze(["bank", "cash"]);
export const SALARY_SOURCES = Object.freeze(["business_bank", "business_cash", "driver_takings"]);
export const SALARY_SOURCE_LABELS = Object.freeze({
  business_bank: "Business bank account",
  business_cash: "Business cash (safe or office)",
  driver_takings: "Driver's takings for the day",
});
export const SALARY_FREQUENCY_LABELS = Object.freeze({ daily: "Daily", weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly" });
// When in its period a salary falls due: "end" (in arrears, the default and the
// rule before timing existed) or "start" (in advance).
export const SALARY_PAY_TIMINGS = Object.freeze(["end", "start"]);
export const SALARY_PAY_TIMING_LABELS = Object.freeze({ end: "At the end of each period", start: "At the start of each period" });
export const SALARY_CATEGORY = "Salary";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));
const MAX_TRACKED_PERIODS = 400;

const text = (value) => String(value ?? "").trim();

export class SalaryRuleError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
const bad = (message) => new SalaryRuleError(400, message);
const conflict = (message) => new SalaryRuleError(409, message);

const validDate = (value) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const toDate = (value) => new Date(`${value}T00:00:00Z`);
const toKey = (date) => date.toISOString().slice(0, 10);
const addDays = (value, days) => {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toKey(date);
};
const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86_400_000);
const mondayOf = (value) => addDays(value, -((toDate(value).getUTCDay() + 6) % 7));

const money = (value, label) => {
  const amount = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw bad(`Enter a valid ${label}.`);
  }
  return Math.round(amount * 100) / 100;
};

export const formatRand = (amount) =>
  `R ${Number(amount ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDay = (value) => `${Number(value.slice(8))} ${SHORT_MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;

export const getSalaryArrangements = (snapshot) =>
  Array.isArray(snapshot?.finance?.salaryArrangements) ? snapshot.finance.salaryArrangements : [];

export const isSalaryPayment = (record) => record?.type === "expense" && Boolean(record?.salaryPayment);

export const getSalaryPayments = (snapshot) =>
  (Array.isArray(snapshot?.financeTransactions) ? snapshot.financeTransactions : []).filter(isSalaryPayment);

// --- Pay periods ---------------------------------------------------------------------
// daily: the date. weekly: the Monday starting the week. fortnightly: the Monday
// starting a two-week block; with a schedule the blocks are counted from the
// Monday of the schedule's start date. monthly: "YYYY-MM".

export const isValidSalaryPeriod = (frequency, period, anchor = null) => {
  if (frequency === "monthly") return MONTH.test(period) && Number(period.slice(5)) >= 1 && Number(period.slice(5)) <= 12;
  if (!validDate(period)) return false;
  if (frequency === "daily") return true;
  if (toDate(period).getUTCDay() !== 1) return false;
  if (frequency === "weekly") return true;
  if (frequency === "fortnightly") return !anchor || ((daysBetween(mondayOf(anchor), period) % 14) + 14) % 14 === 0;
  return false;
};

export const salaryPeriodForDate = (frequency, date, anchor = null) => {
  if (!validDate(date)) return null;
  if (frequency === "monthly") return date.slice(0, 7);
  if (frequency === "daily") return date;
  const monday = mondayOf(date);
  if (frequency === "weekly") return monday;
  if (frequency === "fortnightly") {
    if (!anchor) return monday;
    const offset = ((daysBetween(mondayOf(anchor), monday) % 14) + 14) % 14;
    return addDays(monday, -offset);
  }
  return null;
};

export const salaryPeriodStart = (frequency, period) => (frequency === "monthly" ? `${period}-01` : period);

export const salaryPeriodEnd = (frequency, period) => {
  if (frequency === "daily") return period;
  if (frequency === "weekly") return addDays(period, 6);
  if (frequency === "fortnightly") return addDays(period, 13);
  const [year, month] = period.split("-").map(Number);
  return toKey(new Date(Date.UTC(year, month, 0)));
};

export const nextSalaryPeriod = (frequency, period) => {
  if (frequency === "monthly") {
    const [year, month] = period.split("-").map(Number);
    return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  }
  return addDays(period, { daily: 1, weekly: 7, fortnightly: 14 }[frequency]);
};

export const formatSalaryPeriod = (frequency, period) => {
  if (frequency === "monthly" && MONTH.test(period)) {
    return `${MONTH_NAMES[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  }
  if (validDate(period)) {
    if (frequency === "daily") return formatDay(period);
    if (frequency === "weekly") return `Week of ${formatDay(period)}`;
    if (frequency === "fortnightly") return `Fortnight of ${formatDay(period)}`;
  }
  return period;
};

export const findSalaryPayment = (snapshot, driverStaffId, frequency, period) =>
  getSalaryPayments(snapshot).find(
    (record) =>
      text(record.salaryPayment.driverStaffId) === text(driverStaffId) &&
      text(record.salaryPayment.frequency) === text(frequency) &&
      text(record.salaryPayment.period) === text(period),
  ) ?? null;

// --- Arrangement (schedule) ---------------------------------------------------------

export const SALARY_ARRANGEMENT_FIELDS = Object.freeze([
  "driverStaffId",
  "amount",
  "frequency",
  "payMethod",
  "startDate",
  "effectiveFrom",
  "active",
  "payTiming",
  "revision",
]);

export const parseSalaryArrangement = (fields = {}) => {
  const frequency = text(fields.frequency);
  const payMethod = text(fields.payMethod);
  const startDate = text(fields.startDate);
  const effectiveFrom = text(fields.effectiveFrom);
  if (!text(fields.driverStaffId)) throw bad("Choose the driver.");
  if (!SALARY_FREQUENCIES.includes(frequency)) throw bad("Choose daily, weekly, fortnightly or monthly pay.");
  if (!SALARY_METHODS.includes(payMethod)) throw bad("Choose bank or cash as the usual way of paying.");
  if (!validDate(startDate)) throw bad("Select the date the salary starts.");
  if (effectiveFrom && !validDate(effectiveFrom)) throw bad("Select the date the change applies from.");
  if (fields.active !== undefined && typeof fields.active !== "boolean") throw bad("active must be true or false.");
  const payTiming = text(fields.payTiming) || "end";
  if (!SALARY_PAY_TIMINGS.includes(payTiming)) throw bad("Choose when the salary is paid: at the start or the end of each period.");
  if (fields.revision !== undefined && fields.revision !== null && (!Number.isInteger(fields.revision) || fields.revision < 1)) {
    throw bad("revision must be the schedule's revision number.");
  }
  return {
    driverStaffId: text(fields.driverStaffId),
    amount: money(fields.amount, "salary amount"),
    frequency,
    payMethod,
    startDate,
    effectiveFrom: effectiveFrom || null,
    active: fields.active !== false,
    payTiming,
    revision: fields.revision ?? null,
  };
};

// A schedule saved before revisions existed counts as revision 1.
export const salaryArrangementRevision = (arrangement) => (Number.isInteger(arrangement?.revision) ? arrangement.revision : 1);
export const salaryArrangementForDriver = (snapshot, driverStaffId) =>
  getSalaryArrangements(snapshot).find((item) => text(item.driverStaffId) === text(driverStaffId)) ?? null;

// Amount the schedule set for the period that starts on periodStart.
export const scheduledAmountFor = (arrangement, periodStart) => {
  const history = [...(arrangement?.amountHistory ?? [])]
    .filter((entry) => entry.frequency === undefined || entry.frequency === arrangement.frequency)
    .sort((a, b) => text(a.effectiveFrom).localeCompare(text(b.effectiveFrom)));
  const applicable = history.filter((entry) => text(entry.effectiveFrom) <= periodStart);
  return (applicable.at(-1) ?? history[0])?.amount ?? arrangement?.amount ?? null;
};

// One arrangement per driver. An amount or frequency change is appended to
// amountHistory from effectiveFrom (default: the start date for a new schedule,
// the day of the change otherwise), so the schedule's past amounts stay known.
export const applySalaryArrangement = (snapshot, parsed, actor, now) => {
  const driver = (snapshot?.drivers ?? []).find((item) => text(item.staffId) === parsed.driverStaffId);
  if (!driver) throw new SalaryRuleError(404, "That driver does not exist in this business.");
  const arrangements = getSalaryArrangements(snapshot);
  const existing = arrangements.find((item) => text(item.driverStaffId) === parsed.driverStaffId) ?? null;
  // Never overwrite silently: a change must name the revision it was based on,
  // and a new schedule must not land on top of one saved meanwhile.
  if (existing && parsed.revision == null) {
    throw conflict(`${text(existing.driverName) || "This driver"} already has a salary schedule. Open it to change it; nothing was saved.`);
  }
  if (existing && parsed.revision !== salaryArrangementRevision(existing)) {
    throw conflict("This salary schedule was changed by someone else since you opened it. Reload it and try again; nothing was saved.");
  }
  if (!existing && parsed.revision != null) {
    throw conflict("This salary schedule no longer exists. Reload and try again; nothing was saved.");
  }
  const changed = !existing || existing.amount !== parsed.amount || existing.frequency !== parsed.frequency;
  const effectiveFrom = existing ? parsed.effectiveFrom ?? text(now).slice(0, 10) : parsed.startDate;
  // Earlier amounts and their dates are kept: a change may not start before the
  // latest recorded change, or the schedule's history would be rewritten.
  const latest = [...(existing?.amountHistory ?? [])].map((entry) => text(entry.effectiveFrom)).sort().at(-1);
  if (changed && existing && latest && effectiveFrom < latest) {
    throw bad(`A change cannot apply before the last change (${latest}). Choose ${latest} or later.`);
  }
  const frequencyChanged = existing && existing.frequency !== parsed.frequency;
  const arrangement = {
    ...(existing ?? {}),
    id: existing?.id ?? `salary-${parsed.driverStaffId}`,
    driverStaffId: parsed.driverStaffId,
    driverName: text(driver.name) || parsed.driverStaffId,
    amount: parsed.amount,
    frequency: parsed.frequency,
    payMethod: parsed.payMethod,
    // A new frequency starts its own periods from the change date.
    startDate: frequencyChanged ? effectiveFrom : parsed.startDate,
    active: parsed.active,
    payTiming: parsed.payTiming,
    revision: existing ? salaryArrangementRevision(existing) + 1 : 1,
    amountHistory: [
      ...(existing?.amountHistory ?? []),
      ...(changed
        ? [{ amount: parsed.amount, frequency: parsed.frequency, effectiveFrom, recordedAt: now, recordedBy: actor.id }]
        : []),
    ],
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actor.id,
    createdByRole: existing?.createdByRole ?? actor.role,
    updatedAt: existing ? now : null,
    updatedBy: existing ? actor.id : null,
    updatedByRole: existing ? actor.role : null,
  };
  const finance = {
    ...(snapshot?.finance ?? {}),
    salaryArrangements: existing
      ? arrangements.map((item) => (item === existing ? arrangement : item))
      : [arrangement, ...arrangements],
  };
  const audit = {
    scope: "finance",
    action: existing ? "update" : "create",
    entityType: "salary-arrangement",
    entityId: arrangement.id,
    title: `Salary schedule ${existing ? "updated" : "set"} / ${arrangement.driverName}`,
    detail: `${formatRand(arrangement.amount)} ${arrangement.frequency} from ${effectiveFrom} / ${arrangement.payTiming === "start" ? "paid in advance" : "paid in arrears"} / usually ${arrangement.payMethod}${arrangement.active ? "" : " / paused"}`,
  };
  return { finance, arrangement, audit };
};

// Where a schedule stands on `today`: the next payment and what is due.
// due = unpaid periods that have ended (on or before today); the current,
// unfinished period is "upcoming". Payments in another frequency do not count.
export const describeSalarySchedule = (snapshot, arrangement, today) => {
  const { frequency } = arrangement;
  const anchor = arrangement.startDate;
  const first = salaryPeriodForDate(frequency, anchor, anchor);
  const current = salaryPeriodForDate(frequency, today, anchor);
  const periods = [];
  let period = first;
  while (period && salaryPeriodStart(frequency, period) <= salaryPeriodStart(frequency, current) && periods.length < MAX_TRACKED_PERIODS) {
    periods.push(period);
    period = nextSalaryPeriod(frequency, period);
  }
  const describe = (item) => ({
    period: item,
    label: formatSalaryPeriod(frequency, item),
    dueDate: arrangement.payTiming === "start" ? salaryPeriodStart(frequency, item) : salaryPeriodEnd(frequency, item),
    scheduledAmount: scheduledAmountFor(arrangement, salaryPeriodStart(frequency, item)),
    payment: findSalaryPayment(snapshot, arrangement.driverStaffId, frequency, item),
  });
  const tracked = periods.map(describe);
  const due = tracked.filter((item) => !item.payment && item.dueDate <= today);
  const unpaid = tracked.filter((item) => !item.payment);
  let next = unpaid[0] ?? null;
  if (!next) {
    let candidate = nextSalaryPeriod(frequency, periods.at(-1) ?? first);
    while (findSalaryPayment(snapshot, arrangement.driverStaffId, frequency, candidate)) candidate = nextSalaryPeriod(frequency, candidate);
    next = describe(candidate);
  }
  return {
    active: arrangement.active !== false,
    current: describe(current),
    next,
    due,
    dueAmount: Math.round(due.reduce((sum, item) => sum + Number(item.scheduledAmount ?? 0), 0) * 100) / 100,
    truncated: periods.length >= MAX_TRACKED_PERIODS,
  };
};

// --- Payment (the expense) -----------------------------------------------------------

export const SALARY_PAYMENT_FIELDS = Object.freeze([
  "driverStaffId",
  "frequency",
  "period",
  "paidDate",
  "amount",
  "method",
  "source",
  "reference",
]);

export const parseSalaryPayment = (fields = {}) => {
  const method = text(fields.method);
  const source = text(fields.source) || (method === "bank" ? "business_bank" : "");
  const frequency = text(fields.frequency);
  const paidDate = text(fields.paidDate);
  const reference = text(fields.reference);
  if (!text(fields.driverStaffId)) throw bad("Choose the driver.");
  if (frequency && !SALARY_FREQUENCIES.includes(frequency)) throw bad("Choose daily, weekly, fortnightly or monthly pay.");
  if (!text(fields.period)) throw bad("Choose the pay period.");
  if (!validDate(paidDate)) throw bad("Select the date the salary was paid.");
  if (!SALARY_METHODS.includes(method)) throw bad("Choose how the salary was paid: bank or cash.");
  if (!SALARY_SOURCES.includes(source)) throw bad("Choose where the money came from.");
  if (method === "bank" && source !== "business_bank") throw bad("A bank payment comes from the business bank account.");
  if (method === "cash" && source === "business_bank") throw bad("A cash payment comes from business cash or the driver's takings.");
  if (reference.length > 200) throw bad("The payment reference is too long.");
  return {
    driverStaffId: text(fields.driverStaffId),
    frequency: frequency || null,
    period: text(fields.period),
    paidDate,
    amount: money(fields.amount, "amount paid"),
    method,
    source,
    reference: reference || null,
  };
};

export const salaryPaymentRecordId = (driverStaffId, frequency, period) => `txn-salary-${driverStaffId}-${frequency}-${period}`;

// The driver day a takings-funded salary is taken from must still be open: a
// counted, verified, banked or closed day cannot change its expected cash.
export const assertTakingsDayOpen = (snapshot, driverStaffId, workDate, driverName, what = "salary") => {
  const summary = summarizeDriverDayCash(snapshot ?? {}, { driverStaffId, workDate });
  const entry = findDriverCashUpEntry(snapshot?.dailyCashUps ?? [], { driverStaffId, workDate });
  if (!entry) return;
  const status = getDriverCashUpWorkflowStatus(entry, summary);
  if (["counted", "verified", "banked"].includes(status) || isClosedWithoutDeposit(entry)) {
    throw conflict(
      `${driverName}'s day checking for ${workDate} is ${isClosedWithoutDeposit(entry) ? "closed" : status}, so its cash can no longer change. Record this ${what} as paid from business cash, or use an open day.`,
    );
  }
};

// Returns { record, audit } for the one expense this payment creates.
export const buildSalaryPaymentRecord = (snapshot, parsed, actor, now, extra = {}) => {
  const driver = (snapshot?.drivers ?? []).find((item) => text(item.staffId) === parsed.driverStaffId);
  if (!driver) throw new SalaryRuleError(404, "That driver does not exist in this business.");
  const driverName = text(driver.name) || parsed.driverStaffId;
  const schedule = getSalaryArrangements(snapshot).find((item) => text(item.driverStaffId) === parsed.driverStaffId) ?? null;
  const frequency = parsed.frequency ?? schedule?.frequency ?? null;
  if (!frequency) throw bad("Choose how often this salary is paid.");
  // A payment in the schedule's frequency belongs to the schedule; any other is manual.
  const arrangement = schedule && schedule.frequency === frequency ? schedule : null;
  const anchor = arrangement?.startDate ?? null;
  if (!isValidSalaryPeriod(frequency, parsed.period, anchor)) {
    throw bad(
      {
        daily: "Choose the day this salary is for.",
        weekly: "Choose the Monday that starts the week.",
        fortnightly: anchor
          ? `Choose the Monday that starts one of this schedule's fortnights (counted from ${anchor}).`
          : "Choose the Monday that starts the fortnight.",
        monthly: "Choose a month for this monthly salary.",
      }[frequency],
    );
  }
  if (arrangement && salaryPeriodStart(frequency, parsed.period) < salaryPeriodStart(frequency, salaryPeriodForDate(frequency, anchor, anchor))) {
    throw bad(`This pay period is before the salary schedule started on ${anchor}.`);
  }
  const periodLabel = formatSalaryPeriod(frequency, parsed.period);
  const duplicate = findSalaryPayment(snapshot, parsed.driverStaffId, frequency, parsed.period);
  const id = salaryPaymentRecordId(parsed.driverStaffId, frequency, parsed.period);
  if (duplicate || (snapshot?.financeTransactions ?? []).some((record) => text(record.id) === id)) {
    throw conflict(
      `${driverName}'s salary for ${periodLabel} is already recorded${duplicate ? ` (${formatRand(duplicate.amount)} paid ${duplicate.expenseDate})` : ""}. It was not added again.`,
    );
  }
  const fromTakings = parsed.source === "driver_takings";
  if (fromTakings) assertTakingsDayOpen(snapshot, parsed.driverStaffId, parsed.paidDate, driverName);
  const scheduledAmount = arrangement ? scheduledAmountFor(arrangement, salaryPeriodStart(frequency, parsed.period)) : null;

  const record = {
    id,
    type: "expense",
    expenseKind: "operational",
    category: SALARY_CATEGORY,
    description: `Driver salary / ${driverName} / ${periodLabel}`,
    expenseDate: parsed.paidDate,
    reference: parsed.reference,
    vehicleId: null,
    vehicle: "General",
    amount: parsed.amount,
    cashExpense: parsed.method === "cash",
    // Only a salary taken from the driver's takings belongs to that driver day.
    driverStaffId: fromTakings ? parsed.driverStaffId : null,
    driverName: fromTakings ? driverName : null,
    salaryPayment: {
      arrangementId: arrangement?.id ?? null,
      manual: !arrangement,
      driverStaffId: parsed.driverStaffId,
      driverName,
      frequency,
      period: parsed.period,
      periodLabel,
      periodStart: salaryPeriodStart(frequency, parsed.period),
      periodEnd: salaryPeriodEnd(frequency, parsed.period),
      scheduledAmount,
      method: parsed.method,
      source: parsed.source,
    },
    // Management expenses save verified; a takings-funded salary is part of the
    // driver's day, so it waits for that day's checking like the day's other cash.
    status: fromTakings ? "pending" : "verified",
    createdAt: now,
    createdBy: actor.id,
    createdByRole: actor.role,
    updatedAt: null,
    updatedBy: null,
    updatedByRole: null,
    depositId: null,
    ...extra,
  };
  const audit = {
    scope: "finance",
    action: "create",
    entityType: "expense",
    entityId: id,
    title: `Salary paid / ${driverName}`,
    detail: `${periodLabel} / ${formatRand(parsed.amount)} ${parsed.method} from ${SALARY_SOURCE_LABELS[parsed.source].toLowerCase()}${
      scheduledAmount != null && parsed.amount !== scheduledAmount ? ` / scheduled ${formatRand(scheduledAmount)}` : ""
    }${arrangement ? "" : " / manual"}`,
  };
  return { record, audit };
};

// --- Monthly expense report ----------------------------------------------------------

const csvCell = (value) => {
  const cell = String(value ?? "");
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};
const cents = (amount) => Math.round(Number(amount ?? 0) * 100);
const fromCents = (value) => (value / 100).toFixed(2);

// Every expense dated in the month (one line per expense record), salary lines
// itemised. Schedules are not expenses and never appear. Totals are summed from
// the same lines, so salaries + other expenses = total expenses.
export const buildMonthlyExpenseReport = (snapshot, month) => {
  if (!MONTH.test(text(month))) throw bad("Choose a month for the expense report.");
  const lines = (Array.isArray(snapshot?.financeTransactions) ? snapshot.financeTransactions : [])
    .filter((record) => record?.type === "expense" && text(record.expenseDate).slice(0, 7) === month)
    .map((record) => {
      const salary = isSalaryPayment(record) ? record.salaryPayment : null;
      return {
        id: record.id,
        date: text(record.expenseDate),
        category: text(record.category) || "Uncategorised",
        description: text(record.description),
        vehicle: text(record.vehicle) || "General",
        paidBy: salary ? salary.method : record.cashExpense ? "cash" : "bank/other",
        paidFrom: salary ? SALARY_SOURCE_LABELS[salary.source] ?? "" : "",
        status: text(record.status),
        reference: text(record.reference),
        amount: Number(record.amount ?? 0),
        salary: salary
          ? {
              driverName: salary.driverName,
              period: salary.periodLabel ?? salary.period,
              scheduledAmount: salary.scheduledAmount ?? null,
              manual: Boolean(salary.manual),
              fromTakings: salary.source === "driver_takings",
            }
          : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const sum = (items) => items.reduce((total, line) => total + cents(line.amount), 0);
  const totalCents = sum(lines);
  const salaryCents = sum(lines.filter((line) => line.salary));
  const otherCents = sum(lines.filter((line) => !line.salary));
  const takingsCents = sum(lines.filter((line) => line.salary?.fromTakings));

  return {
    month,
    monthLabel: formatSalaryPeriod("monthly", month),
    lines,
    totals: {
      expenses: totalCents / 100,
      salaries: salaryCents / 100,
      salariesFromTakings: takingsCents / 100,
      otherExpenses: otherCents / 100,
      salaryCount: lines.filter((line) => line.salary).length,
      lineCount: lines.length,
      reconciles: salaryCents + otherCents === totalCents,
    },
  };
};

export const monthlyExpenseReportCsv = (report, businessName = "") => {
  const rows = [
    ["TaxiFlow expense report", businessName, report.monthLabel],
    [],
    ["Date", "Category", "Description", "Vehicle", "Paid by", "Paid from", "Status", "Reference", "Salary driver", "Salary period", "Scheduled salary", "Amount (R)"],
    ...report.lines.map((line) => [
      line.date,
      line.category,
      line.description,
      line.vehicle,
      line.paidBy,
      line.paidFrom,
      line.status,
      line.reference,
      line.salary?.driverName ?? "",
      line.salary?.period ?? "",
      line.salary ? (line.salary.scheduledAmount == null ? "manual" : fromCents(cents(line.salary.scheduledAmount))) : "",
      fromCents(cents(line.amount)),
    ]),
    [],
    ["Driver salaries", "", "", "", "", "", "", "", "", "", `${report.totals.salaryCount} payments`, fromCents(cents(report.totals.salaries))],
    ["  of which paid from drivers' takings", "", "", "", "", "", "", "", "", "", "", fromCents(cents(report.totals.salariesFromTakings))],
    ["Other expenses", "", "", "", "", "", "", "", "", "", "", fromCents(cents(report.totals.otherExpenses))],
    ["Total expenses", "", "", "", "", "", "", "", "", "", `${report.totals.lineCount} lines`, fromCents(cents(report.totals.expenses))],
    ["Reconciles", report.totals.reconciles ? "yes: salaries + other expenses = total expenses" : "NO - check the lines"],
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
};
