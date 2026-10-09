import {
  findDriverCashUpEntry,
  getCashUpCoverageKey,
  getDriverCashUpWorkflowStatus,
  getFinanceRecordCashUpCoverageKey,
  getFinanceRecordDriverName,
  getFinanceRecordDriverStaffId,
  getFinanceRecordWorkDate,
  isDriverCreatedFinanceRecord,
  normalizeCashUpWorkflowStatus,
  summarizeDriverDayCash,
} from "../../src/lib/cashUpContract.js";
import { normalizeTripFinanceTransactions } from "../../src/lib/tripHistory.js";
import { buildDailyLogReportView } from "./dailyLogReportView.js";
import { createHttpError } from "./snapshotLoader.js";

export const WORKFLOW_STAGES = ["pending", "counted", "verified", "banked"];

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim();

  return normalized || null;
};

const toFiniteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
};

const roundAmount = (value) => {
  const numeric = toFiniteNumber(value);

  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
};

const sumAmounts = (records, selector) =>
  roundAmount(records.reduce((sum, record) => sum + Number(selector(record) ?? 0), 0)) ?? 0;

const incomeAmount = (record) => record.amountClaimed ?? record.amount;

const findStandardRecord = (snapshot, targetId) =>
  (snapshot.financeTransactions ?? []).find(
    (item) => item.id === targetId && item.type === "income" && item.incomeKind === "standard",
  ) ?? null;

const sameVehicle = (left, right) =>
  left.vehicleId && right.vehicleId
    ? left.vehicleId === right.vehicleId
    : normalizeText(left.vehicle) === normalizeText(right.vehicle);

// Names only - an appUsers record may fall back to an email address as its
// name, and emails are not printed on the report.
const resolveActorName = (snapshot, actorId) => {
  const id = normalizeText(actorId);

  if (!id) {
    return null;
  }

  const staff = (snapshot.drivers ?? []).find((person) => person.staffId === id);
  const appUser = (snapshot.appUsers ?? []).find(
    (user) => user.actorId === id || user.staffId === id || user.id === id,
  );
  const name = normalizeText(staff?.name) ?? normalizeText(appUser?.name);

  return name && !name.includes("@") ? name : null;
};

// The record's driver fields as the app normalises them (see normalizeLikeClient),
// a Driver-role creator, or the day cash-up entry. buildDailyLogReportView also
// falls back to the creator of ANY role (naming an Admin as the driver) and to
// route matching, so its header.driver is replaced.
const resolveRecordedDriver = (snapshot, record) => {
  const explicitName = getFinanceRecordDriverName(record);

  if (explicitName) {
    return explicitName;
  }

  const driverStaffId = getFinanceRecordDriverStaffId(record);
  const staffName = driverStaffId ? resolveActorName(snapshot, driverStaffId) : null;

  if (staffName) {
    return staffName;
  }

  const dayEntry = driverStaffId
    ? findDriverCashUpEntry(snapshot.dailyCashUps, {
        driverStaffId,
        workDate: getFinanceRecordWorkDate(record),
      })
    : null;

  return normalizeText(dayEntry?.driverName);
};

const describeActor = (snapshot, actorId, role) => {
  const name = resolveActorName(snapshot, actorId);
  const normalizedRole = normalizeText(role);

  if (!name && !normalizedRole) {
    return null;
  }

  return name ? `${name}${normalizedRole ? ` (${normalizedRole})` : ""}` : normalizedRole;
};

const resolveDeposit = (snapshot, record) => {
  const deposit = (snapshot.deposits ?? []).find(
    (entry) =>
      (record.depositId && entry.depositId === record.depositId) ||
      (Array.isArray(entry.transactionIds) && entry.transactionIds.includes(record.id)),
  );

  if (!deposit) {
    return null;
  }

  return {
    depositId: normalizeText(deposit.depositId),
    reference: normalizeText(deposit.reference),
    batchAmount: roundAmount(deposit.depositAmount),
    recordsInBatch:
      toFiniteNumber(deposit.recordsLocked) ??
      (Array.isArray(deposit.transactionIds) ? deposit.transactionIds.length : null),
    depositedAt: normalizeText(deposit.timestamp),
  };
};

// Which cash-up unit this record's cash was (or will be) handed in through,
// following the hand-in queue in src/lib/appRuntime.js deriveSnapshot:
// - covered by a day cash-up entry -> driver day cash-up;
// - driver-created, still pending and not counted -> driver day not yet
//   submitted (the queue holds it back until the driver submits the day);
// - otherwise a single-record cash-up. This includes older driver records that
//   were counted on the record itself before day cash-ups existed, which is
//   also the value banking used for them (actualCashReceived ?? amountClaimed).
const isDriverDayRecord = (snapshot, record) => {
  const coverageKey = getFinanceRecordCashUpCoverageKey(record);
  const coveredByDayCashUp = Boolean(
    coverageKey &&
      (snapshot.dailyCashUps ?? []).some((entry) => getCashUpCoverageKey(entry) === coverageKey),
  );

  if (coveredByDayCashUp) {
    return true;
  }

  return (
    isDriverCreatedFinanceRecord(record) &&
    record.actualCashReceived == null &&
    (normalizeCashUpWorkflowStatus(record.status) ?? "pending") === "pending"
  );
};

const buildDriverDayCashUp = (snapshot, record) => {
  const driverStaffId = getFinanceRecordDriverStaffId(record);
  const workDate = getFinanceRecordWorkDate(record);
  const summary = summarizeDriverDayCash(snapshot, { driverStaffId, workDate });
  const cashUpEntry = summary.cashUpRecord;
  const standardRecords = summary.incomeRecords.filter((item) => item.incomeKind === "standard");
  const specialRecords = summary.incomeRecords.filter((item) => item.incomeKind === "special");
  const counted = toFiniteNumber(cashUpEntry?.actualCashReceived);

  return {
    basis: "driver-day",
    basisLabel: "Driver day cash-up",
    submitted: Boolean(cashUpEntry),
    status: cashUpEntry
      ? getDriverCashUpWorkflowStatus(cashUpEntry, summary)
      : normalizeCashUpWorkflowStatus(record.status) ?? "pending",
    entryCount: summary.entryCount,
    standardIncome: sumAmounts(standardRecords, incomeAmount),
    specialIncome: sumAmounts(specialRecords, incomeAmount),
    specialIncomeIncluded: true,
    totalExpenses: roundAmount(summary.totalExpenses) ?? 0,
    cashExpenses: roundAmount(summary.cashExpenses) ?? 0,
    nonCashExpenses: roundAmount(summary.nonCashExpenses) ?? 0,
    cashExpensesNetted: true,
    expectedCashHandIn: roundAmount(summary.expectedCashIn),
    actualCashReceived: counted == null ? null : roundAmount(counted),
    stageSource: cashUpEntry ?? record,
    submittedAt: normalizeText(cashUpEntry?.createdAt ?? cashUpEntry?.checkedAt),
  };
};

const buildStandaloneCashUp = (snapshot, record) => {
  const reportDate = getFinanceRecordWorkDate(record);
  const specialRecords = (snapshot.financeTransactions ?? []).filter(
    (item) =>
      item.type === "income" &&
      item.incomeKind === "special" &&
      getFinanceRecordWorkDate(item) === reportDate &&
      sameVehicle(item, record),
  );
  const sameDayExpenses = (snapshot.financeTransactions ?? []).filter(
    (item) =>
      item.type === "expense" &&
      getFinanceRecordWorkDate(item) === reportDate &&
      sameVehicle(item, record),
  );
  const totalExpenses = sumAmounts(sameDayExpenses, (item) => item.amount);
  const cashExpenses = sumAmounts(
    sameDayExpenses.filter((item) => item.cashExpense),
    (item) => item.amount,
  );
  const claimed = toFiniteNumber(incomeAmount(record));
  const counted = toFiniteNumber(record.actualCashReceived);

  return {
    basis: "standalone",
    basisLabel: "Single record cash-up",
    submitted: true,
    status: normalizeCashUpWorkflowStatus(record.status) ?? "pending",
    entryCount: 1,
    standardIncome: claimed == null ? null : roundAmount(claimed),
    specialIncome: sumAmounts(specialRecords, incomeAmount),
    specialIncomeIncluded: false,
    totalExpenses,
    cashExpenses,
    nonCashExpenses: roundAmount(totalExpenses - cashExpenses) ?? 0,
    cashExpensesNetted: false,
    expectedCashHandIn: claimed == null ? null : roundAmount(claimed),
    actualCashReceived: counted == null ? null : roundAmount(counted),
    stageSource: record,
    submittedAt: normalizeText(record.createdAt ?? record.timestamp),
  };
};

// Cash figures follow the hand-in/verification queue exactly:
//   standalone record: expected = amountClaimed; actual = record.actualCashReceived.
//     Special income and expenses are shown for context only - the queue never
//     nets them into a standalone record's cash-up.
//   driver day cash-up: expected = all of the driver's income for the work date
//     (standard + special) - cash expenses; non-cash expenses are not netted.
//     Actual is the amount counted on the day cash-up entry.
// Variance is signed (actual - expected): negative = short, positive = over.
// buildDailyLogReportView's own bankingCheckin.variance nets expenses
// differently and is deliberately not used for any figure on the report.
// The browser's data gateway normalises trip records on load (resolving
// tripDate, amountClaimed, and driverStaffId/driverName from the vehicle's
// assigned driver when a record has none), and the hand-in queue runs on that
// normalised data. Applying the same normaliser here keeps the report on the
// same records - and so the same cash-up unit and driver - as the queue, even
// for older records that have not been re-saved since normalisation existed.
const normalizeLikeClient = (snapshot) => ({
  ...snapshot,
  financeTransactions: normalizeTripFinanceTransactions(snapshot.financeTransactions ?? [], {
    source: snapshot,
    routes: snapshot.routes ?? [],
    vehicles: snapshot.vehicles ?? [],
    drivers: snapshot.drivers ?? [],
  }),
});

export const buildDailyFinanceReportData = (rawSnapshot, reportId) => {
  const targetId = normalizeText(reportId);

  if (!rawSnapshot || !targetId) {
    throw createHttpError(400, "A daily log id is required to build the report.");
  }

  const snapshot = normalizeLikeClient(rawSnapshot);
  const reportView = buildDailyLogReportView(snapshot, targetId);
  const record = findStandardRecord(snapshot, targetId);
  const cashUp = isDriverDayRecord(snapshot, record)
    ? buildDriverDayCashUp(snapshot, record)
    : buildStandaloneCashUp(snapshot, record);
  const { stageSource, submittedAt, ...cashFigures } = cashUp;
  const statusIndex = WORKFLOW_STAGES.indexOf(cashFigures.status);
  const deposit = resolveDeposit(snapshot, record);

  const stages = WORKFLOW_STAGES.map((stage, index) => {
    const reached = stage === "pending" ? cashFigures.submitted : statusIndex >= index;
    const details = {
      pending: { at: submittedAt, by: null },
      counted: {
        at: normalizeText(stageSource.countedAt),
        by: describeActor(snapshot, stageSource.countedBy, stageSource.countedByRole),
      },
      verified: {
        at: normalizeText(stageSource.verifiedAt),
        by: describeActor(snapshot, stageSource.verifiedBy, stageSource.verifiedByRole),
      },
      banked: { at: normalizeText(record.bankedAt ?? deposit?.depositedAt), by: null },
    }[stage];

    return { stage, reached, at: reached ? details.at : null, by: reached ? details.by : null };
  });

  return {
    ...reportView,
    header: { ...reportView.header, driver: resolveRecordedDriver(snapshot, record) },
    route: normalizeText(record.route) ?? reportView.tripsTable?.[0]?.routeName ?? null,
    capturedBy: describeActor(snapshot, record.createdBy, record.createdByRole),
    recordNotes: normalizeText(record.notes),
    cashUp: {
      ...cashFigures,
      cashVariance:
        cashFigures.actualCashReceived != null && cashFigures.expectedCashHandIn != null
          ? roundAmount(cashFigures.actualCashReceived - cashFigures.expectedCashHandIn)
          : null,
    },
    stages,
    deposit,
  };
};
