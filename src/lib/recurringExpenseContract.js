// Recurring fixed expenses (rent, insurance, tracking, licences...). Pure rules
// shared by the browser and the server actions (api/_lib/recurringActions.js).
//
// A schedule is a plan, never proof of payment: it only says which occurrences
// fall due. Occurrences are CALCULATED from the schedule whenever TaxiFlow loads
// or a report is built; nothing runs in the background and no expense is created
// until someone records a payment. Each payment is one ordinary expense with a
// fixed id per schedule and period, so it can exist only once.
//
// Periods reuse the salary period rules (salaryContract.js): daily = the date;
// weekly = the Monday of the week; fortnightly = 14-day blocks from the Monday
// of the start date; monthly = YYYY-MM. The due date keeps the start date's
// position: the same weekday, the same day of the fortnight, or the same day of
// the month (moved to the month's last day when that month is shorter, e.g. a
// schedule starting 31 Jan is due 28/29 Feb, 31 Mar, 30 Apr).

import {
  SALARY_FREQUENCIES,
  SALARY_FREQUENCY_LABELS,
  SALARY_METHODS,
  SALARY_SOURCES,
  SALARY_SOURCE_LABELS,
  assertTakingsDayOpen,
  formatRand,
  formatSalaryPeriod,
  nextSalaryPeriod,
  salaryPeriodForDate,
  salaryPeriodStart,
} from "./salaryContract.js";

export const RECURRING_FREQUENCIES = SALARY_FREQUENCIES;
export const RECURRING_FREQUENCY_LABELS = SALARY_FREQUENCY_LABELS;
export const RECURRING_STATUSES = Object.freeze(["active", "paused", "stopped"]);
export const RECURRING_OCCURRENCE_LABELS = Object.freeze({ paid: "Paid", due: "Due", overdue: "Overdue", upcoming: "Upcoming" });
const MAX_OCCURRENCES = 800;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();
const toDate = (value) => new Date(`${value}T00:00:00Z`);
const toKey = (date) => date.toISOString().slice(0, 10);
const validDate = (value) => DATE.test(value) && !Number.isNaN(toDate(value).getTime()) && toKey(toDate(value)) === value;
const addDays = (value, days) => toKey(new Date(toDate(value).getTime() + days * 86_400_000));
const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86_400_000);
const mondayOf = (value) => addDays(value, -((toDate(value).getUTCDay() + 6) % 7));
const lastDayOfMonth = (period) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export class RecurringRuleError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
const bad = (message) => new RecurringRuleError(400, message);
const conflict = (message) => new RecurringRuleError(409, message);
const missing = (message) => new RecurringRuleError(404, message);

const money = (value, label) => {
  const amount = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw bad(`Enter a valid ${label}.`);
  }
  return Math.round(amount * 100) / 100;
};

export const getRecurringExpenses = (snapshot) =>
  Array.isArray(snapshot?.finance?.recurringExpenses) ? snapshot.finance.recurringExpenses : [];
export const findRecurringExpense = (snapshot, scheduleId) => getRecurringExpenses(snapshot).find((item) => item.id === text(scheduleId)) ?? null;
export const isRecurringPayment = (record) => record?.type === "expense" && Boolean(record?.recurringPayment);
export const recurringPaymentRecordId = (scheduleId, period) => `txn-${scheduleId}-${period}`;
export const recurringRevision = (schedule) => (Number.isInteger(schedule?.revision) ? schedule.revision : 1);

// --- Occurrences -----------------------------------------------------------------

export const recurringDueDate = (schedule, period) => {
  const { frequency, startDate } = schedule;
  if (frequency === "daily") return period;
  if (frequency === "monthly") return `${period}-${String(Math.min(Number(startDate.slice(8)), lastDayOfMonth(period))).padStart(2, "0")}`;
  return addDays(period, daysBetween(mondayOf(startDate), startDate));
};

const isPaused = (schedule, dueDate) =>
  (schedule.pauses ?? []).some((pause) => text(pause.from) <= dueDate && (!pause.to || dueDate < text(pause.to)));

export const recurringVersionFor = (schedule, dueDate) => {
  const versions = [...(schedule.versions ?? [])].sort((a, b) => text(a.effectiveFrom).localeCompare(text(b.effectiveFrom)));
  return versions.filter((version) => text(version.effectiveFrom) <= dueDate).at(-1) ?? versions[0] ?? schedule;
};

export const findRecurringPayment = (snapshot, scheduleId, period) =>
  (Array.isArray(snapshot?.financeTransactions) ? snapshot.financeTransactions : []).find(
    (record) => isRecurringPayment(record) && record.recurringPayment.scheduleId === scheduleId && record.recurringPayment.period === period,
  ) ?? null;

// Every occurrence with a due date up to `until` (inclusive), skipping paused
// dates and anything after the end date. Ordered oldest first.
export const listRecurringOccurrences = (snapshot, schedule, until) => {
  const occurrences = [];
  let period = salaryPeriodForDate(schedule.frequency, schedule.startDate, schedule.startDate);
  while (period && occurrences.length < MAX_OCCURRENCES) {
    const dueDate = recurringDueDate(schedule, period);
    if (dueDate > until || (schedule.endDate && dueDate > schedule.endDate)) break;
    if (dueDate >= schedule.startDate && !isPaused(schedule, dueDate)) {
      const version = recurringVersionFor(schedule, dueDate);
      occurrences.push({
        scheduleId: schedule.id,
        period,
        periodLabel: formatSalaryPeriod(schedule.frequency, period),
        dueDate,
        amount: version.amount,
        description: version.description,
        category: version.category,
        vehicleId: version.vehicleId ?? null,
        vehicle: version.vehicle ?? null,
        payment: findRecurringPayment(snapshot, schedule.id, period),
      });
    }
    period = nextSalaryPeriod(schedule.frequency, period);
  }
  return { occurrences, truncated: occurrences.length >= MAX_OCCURRENCES };
};

export const occurrenceStatus = (occurrence, today) =>
  occurrence.payment ? "paid" : occurrence.dueDate < today ? "overdue" : occurrence.dueDate === today ? "due" : "upcoming";

// Where a schedule stands on `today`: what is overdue or due, and the next date.
export const describeRecurringExpense = (snapshot, schedule, today) => {
  // Look one full period ahead so the next upcoming date is known.
  const horizon = addDays(today, { daily: 1, weekly: 7, fortnightly: 14, monthly: 31 }[schedule.frequency] ?? 31);
  const { occurrences, truncated } = listRecurringOccurrences(snapshot, schedule, horizon);
  const withStatus = occurrences.map((occurrence) => ({ ...occurrence, status: occurrenceStatus(occurrence, today) }));
  const outstanding = withStatus.filter((item) => item.status === "overdue" || item.status === "due");
  const next = withStatus.find((item) => item.status === "upcoming") ?? null;
  return {
    status: schedule.status ?? "active",
    occurrences: withStatus,
    outstanding,
    overdue: outstanding.filter((item) => item.status === "overdue"),
    outstandingAmount: Math.round(outstanding.reduce((sum, item) => sum + Number(item.amount ?? 0), 0) * 100) / 100,
    nextDue: next,
    recentPaid: withStatus.filter((item) => item.status === "paid").slice(-6),
    truncated,
  };
};

// Occurrences falling due within [start, end] for reports: scheduled
// commitments, kept apart from the expenses actually recorded.
export const recurringCommitments = (snapshot, start, end, { vehicleId = null } = {}) =>
  getRecurringExpenses(snapshot)
    .flatMap((schedule) => listRecurringOccurrences(snapshot, schedule, end).occurrences.filter((item) => item.dueDate >= start))
    .filter((item) => (vehicleId ? item.vehicleId === vehicleId : true))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.scheduleId.localeCompare(b.scheduleId));

// --- Saving a schedule ---------------------------------------------------------------

export const RECURRING_SCHEDULE_FIELDS = Object.freeze(["scheduleId", "description", "category", "amount", "vehicleId", "frequency", "startDate", "endDate", "payMethod", "effectiveFrom", "revision"]);

export const parseRecurringSchedule = (fields = {}) => {
  const description = text(fields.description);
  const category = text(fields.category);
  const frequency = text(fields.frequency);
  const startDate = text(fields.startDate);
  const endDate = text(fields.endDate);
  const effectiveFrom = text(fields.effectiveFrom);
  const payMethod = text(fields.payMethod) || "bank";
  if (!description || description.length > 120) throw bad("Enter what this expense is (up to 120 characters).");
  if (!category || category.length > 60) throw bad("Choose a category.");
  if (!RECURRING_FREQUENCIES.includes(frequency)) throw bad("Choose daily, weekly, fortnightly or monthly.");
  if (!validDate(startDate)) throw bad("Select the first due date.");
  if (endDate && !validDate(endDate)) throw bad("Select a valid end date, or leave it empty.");
  if (endDate && endDate < startDate) throw bad("The end date cannot be before the first due date.");
  if (effectiveFrom && !validDate(effectiveFrom)) throw bad("Select the date the change applies from.");
  if (!SALARY_METHODS.includes(payMethod)) throw bad("Choose bank or cash as the usual way of paying.");
  if (fields.revision !== undefined && fields.revision !== null && (!Number.isInteger(fields.revision) || fields.revision < 1)) throw bad("revision must be the schedule's revision number.");
  return {
    scheduleId: text(fields.scheduleId) || null,
    description,
    category,
    amount: money(fields.amount, "amount"),
    vehicleId: text(fields.vehicleId) || null,
    frequency,
    startDate,
    endDate: endDate || null,
    payMethod,
    effectiveFrom: effectiveFrom || null,
    revision: fields.revision ?? null,
  };
};

const vehicleLabel = (snapshot, vehicleId) => {
  if (!vehicleId) return { vehicleId: null, vehicle: "General" };
  const vehicle = (snapshot?.vehicles ?? []).find((item) => item.id === vehicleId);
  if (!vehicle) throw missing("That vehicle does not exist in this business.");
  return { vehicleId: vehicle.id, vehicle: text(vehicle.registration) || vehicle.id };
};

const assertRevision = (existing, revision) => {
  if (revision == null) throw conflict("This schedule already exists. Open it to change it; nothing was saved.");
  if (revision !== recurringRevision(existing)) throw conflict("This schedule was changed by someone else since you opened it. Reload it and try again; nothing was saved.");
};

const stamp = (existing, actor, now) => ({
  createdAt: existing?.createdAt ?? now,
  createdBy: existing?.createdBy ?? actor.id,
  createdByRole: existing?.createdByRole ?? actor.role,
  updatedAt: existing ? now : null,
  updatedBy: existing ? actor.id : null,
  updatedByRole: existing ? actor.role : null,
});

// New schedule, or a change that applies to occurrences due from effectiveFrom
// (default: today). Earlier occurrences, and every recorded payment, keep the
// values they had. How often and the first due date are fixed once created:
// stop the schedule and start a new one to change them.
export const applyRecurringSchedule = (snapshot, parsed, actor, now, newId) => {
  const schedules = getRecurringExpenses(snapshot);
  const existing = parsed.scheduleId ? schedules.find((item) => item.id === parsed.scheduleId) ?? null : null;
  if (parsed.scheduleId && !existing) throw missing("That recurring expense does not exist in this business.");
  const target = vehicleLabel(snapshot, parsed.vehicleId);
  const today = text(now).slice(0, 10);
  let schedule;
  if (existing) {
    assertRevision(existing, parsed.revision);
    if (existing.status === "stopped") throw conflict("This recurring expense is stopped. Start a new one instead; its payments stay recorded.");
    if (parsed.frequency !== existing.frequency || parsed.startDate !== existing.startDate) {
      throw bad("How often and the first due date cannot change. Stop this schedule and start a new one; recorded payments stay as they are.");
    }
    const effectiveFrom = parsed.effectiveFrom ?? today;
    const latest = (existing.versions ?? []).map((version) => text(version.effectiveFrom)).sort().at(-1);
    if (latest && effectiveFrom < latest) throw bad(`A change cannot apply before the last change (${latest}). Choose ${latest} or later.`);
    const version = { effectiveFrom, amount: parsed.amount, description: parsed.description, category: parsed.category, ...target, recordedAt: now, recordedBy: actor.id };
    const current = recurringVersionFor(existing, effectiveFrom);
    const changed = ["amount", "description", "category", "vehicleId"].some((key) => (current[key] ?? null) !== (version[key] ?? null));
    schedule = {
      ...existing,
      ...version,
      payMethod: parsed.payMethod,
      endDate: parsed.endDate,
      versions: [...(existing.versions ?? []), ...(changed ? [version] : [])],
      revision: recurringRevision(existing) + 1,
      ...stamp(existing, actor, now),
    };
  } else {
    if (parsed.revision != null) throw conflict("This schedule no longer exists. Reload and try again; nothing was saved.");
    const version = { effectiveFrom: parsed.startDate, amount: parsed.amount, description: parsed.description, category: parsed.category, ...target, recordedAt: now, recordedBy: actor.id };
    schedule = {
      id: `recurring-${newId}`,
      ...version,
      frequency: parsed.frequency,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      payMethod: parsed.payMethod,
      status: "active",
      pauses: [],
      versions: [version],
      revision: 1,
      ...stamp(null, actor, now),
    };
  }
  const finance = {
    ...(snapshot?.finance ?? {}),
    recurringExpenses: existing ? schedules.map((item) => (item === existing ? schedule : item)) : [schedule, ...schedules],
  };
  const audit = {
    scope: "finance",
    action: existing ? "update" : "create",
    entityType: "recurring-expense",
    entityId: schedule.id,
    title: `Recurring expense ${existing ? "changed" : "set"} / ${schedule.description}`,
    detail: `${formatRand(schedule.amount)} ${schedule.frequency} / ${schedule.vehicle} / from ${existing ? parsed.effectiveFrom ?? today : schedule.startDate}${schedule.endDate ? ` until ${schedule.endDate}` : ""}`,
  };
  return { finance, schedule, audit };
};

// --- Pause, resume, stop -----------------------------------------------------------------

export const RECURRING_STATUS_FIELDS = Object.freeze(["scheduleId", "change", "date", "revision"]);

export const parseRecurringStatusChange = (fields = {}) => {
  const change = text(fields.change);
  const date = text(fields.date);
  if (!text(fields.scheduleId)) throw bad("Choose the recurring expense.");
  if (!["pause", "resume", "stop"].includes(change)) throw bad("Choose pause, resume or stop.");
  if (date && !validDate(date)) throw bad("Select a valid date.");
  if (!Number.isInteger(fields.revision) || fields.revision < 1) throw bad("revision must be the schedule's revision number.");
  return { scheduleId: text(fields.scheduleId), change, date: date || null, revision: fields.revision };
};

// Pause: occurrences due on or after the date are not due until resumed.
// Resume: occurrences due from the date are due again. Stop: nothing is due
// after the date; the schedule, its history and its payments are kept.
export const applyRecurringStatusChange = (snapshot, parsed, actor, now) => {
  const schedules = getRecurringExpenses(snapshot);
  const existing = schedules.find((item) => item.id === parsed.scheduleId);
  if (!existing) throw missing("That recurring expense does not exist in this business.");
  assertRevision(existing, parsed.revision);
  const date = parsed.date ?? text(now).slice(0, 10);
  const status = existing.status ?? "active";
  const pauses = [...(existing.pauses ?? [])];
  let next;
  if (parsed.change === "pause") {
    if (status !== "active") throw conflict(`This recurring expense is ${status}; only an active one can be paused.`);
    next = { status: "paused", pauses: [...pauses, { from: date, to: null, recordedAt: now, recordedBy: actor.id }] };
  } else if (parsed.change === "resume") {
    if (status !== "paused") throw conflict(`This recurring expense is ${status}; only a paused one can be resumed.`);
    const open = pauses.at(-1);
    if (date < text(open.from)) throw bad(`Resume on or after the pause date (${open.from}).`);
    next = { status: "active", pauses: [...pauses.slice(0, -1), { ...open, to: date }] };
  } else {
    if (status === "stopped") throw conflict("This recurring expense is already stopped.");
    if (date < existing.startDate) throw bad("A schedule cannot stop before its first due date.");
    const endDate = existing.endDate && existing.endDate < date ? existing.endDate : date;
    next = { status: "stopped", endDate, stoppedAt: now, stoppedBy: actor.id, pauses: pauses.map((pause) => (pause.to ? pause : { ...pause, to: date })) };
  }
  const schedule = { ...existing, ...next, revision: recurringRevision(existing) + 1, ...stamp(existing, actor, now) };
  return {
    finance: { ...(snapshot?.finance ?? {}), recurringExpenses: schedules.map((item) => (item === existing ? schedule : item)) },
    schedule,
    audit: {
      scope: "finance",
      action: "update",
      entityType: "recurring-expense",
      entityId: schedule.id,
      title: `Recurring expense ${{ pause: "paused", resume: "resumed", stop: "stopped" }[parsed.change]} / ${schedule.description}`,
      detail: `${parsed.change} from ${date}`,
    },
  };
};

// --- Recording a payment (the expense) -------------------------------------------------

export const RECURRING_PAYMENT_FIELDS = Object.freeze(["scheduleId", "period", "paidDate", "amount", "method", "source", "driverStaffId", "reference"]);

export const parseRecurringPayment = (fields = {}) => {
  const method = text(fields.method);
  const source = text(fields.source) || (method === "bank" ? "business_bank" : "");
  const paidDate = text(fields.paidDate);
  const reference = text(fields.reference);
  if (!text(fields.scheduleId)) throw bad("Choose the recurring expense.");
  if (!text(fields.period)) throw bad("Choose the occurrence being paid.");
  if (!validDate(paidDate)) throw bad("Select the date it was paid.");
  if (!SALARY_METHODS.includes(method)) throw bad("Choose how it was paid: bank or cash.");
  if (!SALARY_SOURCES.includes(source)) throw bad("Choose where the money came from.");
  if (method === "bank" && source !== "business_bank") throw bad("A bank payment comes from the business bank account.");
  if (method === "cash" && source === "business_bank") throw bad("A cash payment comes from business cash or a driver's takings.");
  if (source === "driver_takings" && !text(fields.driverStaffId)) throw bad("Choose whose takings paid it.");
  if (reference.length > 200) throw bad("The payment reference is too long.");
  return {
    scheduleId: text(fields.scheduleId),
    period: text(fields.period),
    paidDate,
    amount: money(fields.amount, "amount paid"),
    method,
    source,
    driverStaffId: source === "driver_takings" ? text(fields.driverStaffId) : null,
    reference: reference || null,
  };
};

export const buildRecurringPaymentRecord = (snapshot, parsed, actor, now, extra = {}) => {
  const schedule = findRecurringExpense(snapshot, parsed.scheduleId);
  if (!schedule) throw missing("That recurring expense does not exist in this business.");
  if (!RECURRING_FREQUENCIES.includes(schedule.frequency) || salaryPeriodForDate(schedule.frequency, salaryPeriodStart(schedule.frequency, parsed.period), schedule.startDate) !== parsed.period) {
    throw bad("Choose one of this schedule's occurrences.");
  }
  const dueDate = recurringDueDate(schedule, parsed.period);
  const occurrence = listRecurringOccurrences(snapshot, schedule, dueDate).occurrences.find((item) => item.period === parsed.period);
  if (!occurrence) throw bad("That occurrence is not part of this schedule (before its start, after its end, or while it was paused).");
  const id = recurringPaymentRecordId(schedule.id, parsed.period);
  const duplicate = occurrence.payment ?? (snapshot?.financeTransactions ?? []).find((record) => text(record.id) === id) ?? null;
  if (duplicate) {
    throw conflict(`${occurrence.description} for ${occurrence.periodLabel} is already recorded (${formatRand(duplicate.amount)} paid ${duplicate.expenseDate}). It was not added again.`);
  }
  let driverName = null;
  const fromTakings = parsed.source === "driver_takings";
  if (fromTakings) {
    const driver = (snapshot?.drivers ?? []).find((item) => text(item.staffId) === parsed.driverStaffId);
    if (!driver) throw missing("That driver does not exist in this business.");
    driverName = text(driver.name) || parsed.driverStaffId;
    assertTakingsDayOpen(snapshot, parsed.driverStaffId, parsed.paidDate, driverName, "expense");
  }
  const record = {
    id,
    type: "expense",
    expenseKind: "operational",
    category: occurrence.category,
    description: `${occurrence.description} / ${occurrence.periodLabel}`,
    expenseDate: parsed.paidDate,
    reference: parsed.reference,
    vehicleId: occurrence.vehicleId,
    vehicle: occurrence.vehicle ?? "General",
    amount: parsed.amount,
    cashExpense: parsed.method === "cash",
    // Only an expense paid from a driver's takings belongs to that driver day.
    driverStaffId: fromTakings ? parsed.driverStaffId : null,
    driverName: fromTakings ? driverName : null,
    recurringPayment: {
      scheduleId: schedule.id,
      frequency: schedule.frequency,
      period: parsed.period,
      periodLabel: occurrence.periodLabel,
      dueDate,
      scheduledAmount: occurrence.amount,
      method: parsed.method,
      source: parsed.source,
    },
    // Same rule as salary payments: management payments save verified; one
    // taken from a driver's takings waits for that day's checking.
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
    title: `Recurring expense paid / ${occurrence.description}`,
    detail: `${occurrence.periodLabel} / ${formatRand(parsed.amount)} ${parsed.method} from ${SALARY_SOURCE_LABELS[parsed.source].toLowerCase()}${
      parsed.amount !== occurrence.amount ? ` / scheduled ${formatRand(occurrence.amount)}` : ""
    }`,
  };
  return { record, audit };
};
