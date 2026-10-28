// Driver salaries: shared rules for the browser (demo/legacy saves) and the
// server finance actions (api/_lib/salaryActions.js). Plain JS, no imports.
//
// Rules:
// - A salary arrangement (finance.salaryArrangements) is a schedule only. Saving
//   one never creates an expense and is not proof that anything was paid.
// - Recording a payment creates exactly one "Salary" expense for that driver and
//   pay period. A second payment for the same driver and period is refused.
// - The expense keeps the amount actually paid and the scheduled amount at that
//   time; later changes to the arrangement never rewrite past payments.
// - Salary expenses carry no driverStaffId (the payee is in salaryPayment), so a
//   salary, whether paid by bank or in cash from the business, never changes a
//   driver's day cash hand-in. Bank payments are not cash expenses.

export const SALARY_FREQUENCIES = Object.freeze(["monthly", "weekly"]);
export const SALARY_METHODS = Object.freeze(["bank", "cash"]);
export const SALARY_CATEGORY = "Salary";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));

const text = (value) => String(value ?? "").trim();

export class SalaryRuleError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
const bad = (message) => new SalaryRuleError(400, message);

const validDate = (value) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const money = (value, label) => {
  const amount = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw bad(`Enter a valid ${label}.`);
  }
  return Math.round(amount * 100) / 100;
};

const formatRand = (amount) => `R ${Number(amount ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const getSalaryArrangements = (snapshot) =>
  Array.isArray(snapshot?.finance?.salaryArrangements) ? snapshot.finance.salaryArrangements : [];

export const isSalaryPayment = (record) => record?.type === "expense" && Boolean(record?.salaryPayment);

export const getSalaryPayments = (snapshot) =>
  (Array.isArray(snapshot?.financeTransactions) ? snapshot.financeTransactions : []).filter(isSalaryPayment);

// Pay periods: monthly "YYYY-MM"; weekly = the Monday that starts the week.
export const isValidSalaryPeriod = (frequency, period) => {
  if (frequency === "monthly") return MONTH.test(period) && Number(period.slice(5)) >= 1 && Number(period.slice(5)) <= 12;
  if (frequency === "weekly") return validDate(period) && new Date(`${period}T00:00:00Z`).getUTCDay() === 1;
  return false;
};

export const salaryPeriodForDate = (frequency, date) => {
  if (!validDate(date)) return null;
  if (frequency === "monthly") return date.slice(0, 7);
  const day = new Date(`${date}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
};

export const formatSalaryPeriod = (frequency, period) => {
  if (frequency === "monthly" && MONTH.test(period)) {
    return `${MONTH_NAMES[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  }
  if (frequency === "weekly" && validDate(period)) {
    return `Week of ${Number(period.slice(8))} ${SHORT_MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
  }
  return period;
};

export const findSalaryPayment = (snapshot, driverStaffId, period) =>
  getSalaryPayments(snapshot).find(
    (record) => text(record.salaryPayment.driverStaffId) === text(driverStaffId) && text(record.salaryPayment.period) === text(period),
  ) ?? null;

// --- Arrangement (schedule) ---------------------------------------------------------

export const SALARY_ARRANGEMENT_FIELDS = Object.freeze(["driverStaffId", "amount", "frequency", "payMethod", "startDate", "active"]);

export const parseSalaryArrangement = (fields = {}) => {
  const frequency = text(fields.frequency);
  const payMethod = text(fields.payMethod);
  const startDate = text(fields.startDate);
  if (!text(fields.driverStaffId)) throw bad("Choose the driver.");
  if (!SALARY_FREQUENCIES.includes(frequency)) throw bad("Choose monthly or weekly pay.");
  if (!SALARY_METHODS.includes(payMethod)) throw bad("Choose bank or cash as the usual way of paying.");
  if (!validDate(startDate)) throw bad("Select the date the salary starts.");
  if (fields.active !== undefined && typeof fields.active !== "boolean") throw bad("active must be true or false.");
  return {
    driverStaffId: text(fields.driverStaffId),
    amount: money(fields.amount, "salary amount"),
    frequency,
    payMethod,
    startDate,
    active: fields.active !== false,
  };
};

// One arrangement per driver. Each change appends to amountHistory so the
// schedule's past amounts stay visible.
export const applySalaryArrangement = (snapshot, parsed, actor, now) => {
  const driver = (snapshot?.drivers ?? []).find((item) => text(item.staffId) === parsed.driverStaffId);
  if (!driver) throw new SalaryRuleError(404, "That driver does not exist in this business.");
  const arrangements = getSalaryArrangements(snapshot);
  const existing = arrangements.find((item) => text(item.driverStaffId) === parsed.driverStaffId) ?? null;
  const changed =
    !existing ||
    existing.amount !== parsed.amount ||
    existing.frequency !== parsed.frequency ||
    existing.startDate !== parsed.startDate;
  const arrangement = {
    ...(existing ?? {}),
    id: existing?.id ?? `salary-${parsed.driverStaffId}`,
    driverStaffId: parsed.driverStaffId,
    driverName: text(driver.name) || parsed.driverStaffId,
    amount: parsed.amount,
    frequency: parsed.frequency,
    payMethod: parsed.payMethod,
    startDate: parsed.startDate,
    active: parsed.active,
    amountHistory: [
      ...(existing?.amountHistory ?? []),
      ...(changed
        ? [{ amount: parsed.amount, frequency: parsed.frequency, effectiveFrom: parsed.startDate, recordedAt: now, recordedBy: actor.id }]
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
    detail: `${formatRand(arrangement.amount)} ${arrangement.frequency} / usually ${arrangement.payMethod} / from ${arrangement.startDate}${arrangement.active ? "" : " / paused"}`,
  };
  return { finance, arrangement, audit };
};

// --- Payment (the expense) -----------------------------------------------------------

export const SALARY_PAYMENT_FIELDS = Object.freeze(["driverStaffId", "period", "paidDate", "amount", "method", "reference"]);

export const parseSalaryPayment = (fields = {}) => {
  const method = text(fields.method);
  const paidDate = text(fields.paidDate);
  const reference = text(fields.reference);
  if (!text(fields.driverStaffId)) throw bad("Choose the driver.");
  if (!text(fields.period)) throw bad("Choose the pay period.");
  if (!validDate(paidDate)) throw bad("Select the date the salary was paid.");
  if (!SALARY_METHODS.includes(method)) throw bad("Choose how the salary was paid: bank or cash.");
  if (reference.length > 200) throw bad("The payment reference is too long.");
  return {
    driverStaffId: text(fields.driverStaffId),
    period: text(fields.period),
    paidDate,
    amount: money(fields.amount, "amount paid"),
    method,
    reference: reference || null,
  };
};

export const salaryPaymentRecordId = (driverStaffId, period) => `txn-salary-${driverStaffId}-${period}`;

// Returns { record, audit } for the one expense this payment creates.
export const buildSalaryPaymentRecord = (snapshot, parsed, actor, now, extra = {}) => {
  const arrangement = getSalaryArrangements(snapshot).find((item) => text(item.driverStaffId) === parsed.driverStaffId);
  if (!arrangement) {
    throw new SalaryRuleError(409, "Set this driver's salary schedule before recording a payment.");
  }
  if (arrangement.active === false) {
    throw new SalaryRuleError(409, `${arrangement.driverName}'s salary schedule is paused. Resume it before recording a payment.`);
  }
  if (!isValidSalaryPeriod(arrangement.frequency, parsed.period)) {
    throw bad(
      arrangement.frequency === "monthly"
        ? "Choose a month for this monthly salary."
        : "Choose the Monday that starts the week for this weekly salary.",
    );
  }
  if (parsed.period < salaryPeriodForDate(arrangement.frequency, arrangement.startDate)) {
    throw bad(`This pay period is before the salary started on ${arrangement.startDate}.`);
  }
  const periodLabel = formatSalaryPeriod(arrangement.frequency, parsed.period);
  const duplicate = findSalaryPayment(snapshot, parsed.driverStaffId, parsed.period);
  if (duplicate) {
    throw new SalaryRuleError(
      409,
      `${arrangement.driverName}'s salary for ${periodLabel} is already recorded (${formatRand(duplicate.amount)} paid ${duplicate.expenseDate}). It was not added again.`,
    );
  }
  const id = salaryPaymentRecordId(parsed.driverStaffId, parsed.period);
  if ((snapshot?.financeTransactions ?? []).some((record) => text(record.id) === id)) {
    throw new SalaryRuleError(409, `${arrangement.driverName}'s salary for ${periodLabel} is already recorded. It was not added again.`);
  }
  const record = {
    id,
    type: "expense",
    expenseKind: "operational",
    category: SALARY_CATEGORY,
    description: `Driver salary / ${arrangement.driverName} / ${periodLabel}`,
    expenseDate: parsed.paidDate,
    reference: parsed.reference,
    vehicleId: null,
    vehicle: "General",
    amount: parsed.amount,
    // Only cash paid out of the business counts as a cash expense. Neither kind
    // is linked to the driver's day cash-up (driverStaffId stays null).
    cashExpense: parsed.method === "cash",
    driverStaffId: null,
    driverName: null,
    salaryPayment: {
      arrangementId: arrangement.id,
      driverStaffId: arrangement.driverStaffId,
      driverName: arrangement.driverName,
      frequency: arrangement.frequency,
      period: parsed.period,
      periodLabel,
      scheduledAmount: arrangement.amount,
      method: parsed.method,
    },
    // Management records with Money edit rights save verified, like any other
    // management expense.
    status: "verified",
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
    title: `Salary paid / ${arrangement.driverName}`,
    detail: `${periodLabel} / ${formatRand(parsed.amount)} by ${parsed.method}${
      parsed.amount !== arrangement.amount ? ` / scheduled ${formatRand(arrangement.amount)}` : ""
    }`,
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

// Every expense dated in the month, salary lines itemised. The totals are summed
// from the same lines, so the salary and other-expense subtotals always add up to
// the expense total.
export const buildMonthlyExpenseReport = (snapshot, month) => {
  if (!MONTH.test(text(month))) throw bad("Choose a month for the expense report.");
  const lines = (Array.isArray(snapshot?.financeTransactions) ? snapshot.financeTransactions : [])
    .filter((record) => record?.type === "expense" && text(record.expenseDate).slice(0, 7) === month)
    .map((record) => ({
      id: record.id,
      date: text(record.expenseDate),
      category: text(record.category) || "Uncategorised",
      description: text(record.description),
      vehicle: text(record.vehicle) || "General",
      paidBy: isSalaryPayment(record) ? record.salaryPayment.method : record.cashExpense ? "cash" : "bank/other",
      status: text(record.status),
      reference: text(record.reference),
      amount: Number(record.amount ?? 0),
      salary: isSalaryPayment(record)
        ? {
            driverName: record.salaryPayment.driverName,
            period: record.salaryPayment.periodLabel ?? record.salaryPayment.period,
            scheduledAmount: record.salaryPayment.scheduledAmount,
          }
        : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const sum = (items) => items.reduce((total, line) => total + cents(line.amount), 0);
  const totalCents = sum(lines);
  const salaryCents = sum(lines.filter((line) => line.salary));
  const otherCents = sum(lines.filter((line) => !line.salary));

  return {
    month,
    monthLabel: formatSalaryPeriod("monthly", month),
    lines,
    totals: {
      expenses: totalCents / 100,
      salaries: salaryCents / 100,
      otherExpenses: otherCents / 100,
      salaryCount: lines.filter((line) => line.salary).length,
      lineCount: lines.length,
      reconciles: salaryCents + otherCents === totalCents,
    },
  };
};

export const monthlyExpenseReportCsv = (report, businessName = "") => {
  const rows = [
    [`TaxiFlow expense report`, businessName, report.monthLabel],
    [],
    ["Date", "Category", "Description", "Vehicle", "Paid by", "Status", "Reference", "Salary driver", "Salary period", "Scheduled salary", "Amount (R)"],
    ...report.lines.map((line) => [
      line.date,
      line.category,
      line.description,
      line.vehicle,
      line.paidBy,
      line.status,
      line.reference,
      line.salary?.driverName ?? "",
      line.salary?.period ?? "",
      line.salary ? fromCents(cents(line.salary.scheduledAmount)) : "",
      fromCents(cents(line.amount)),
    ]),
    [],
    ["Driver salaries", "", "", "", "", "", "", "", "", `${report.totals.salaryCount} payments`, fromCents(cents(report.totals.salaries))],
    ["Other expenses", "", "", "", "", "", "", "", "", "", fromCents(cents(report.totals.otherExpenses))],
    ["Total expenses", "", "", "", "", "", "", "", "", `${report.totals.lineCount} lines`, fromCents(cents(report.totals.expenses))],
    ["Reconciles", report.totals.reconciles ? "yes: salaries + other expenses = total expenses" : "NO - check the lines"],
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
};
