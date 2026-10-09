// Pure cash-up rules shared by the browser app (via appRuntime.js) and the
// server report endpoints. No imports, so Node can load it directly. Moving a
// rule here must not change its behaviour: the hand-in queue, the day cash-up
// and the Daily Finance Report all have to agree on the same numbers.

const sumBy = (items, selector) =>
  items.reduce((total, item) => total + Number(selector(item) ?? 0), 0);

export const parseDateInputValue = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  return Number.isNaN(date.getTime()) ? null : date;
};

export const toDateInputValue = (value = new Date()) => {
  const date =
    parseDateInputValue(value) ??
    (value ? new Date(value) : null);

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export const getFinanceRecordWorkDate = (record = {}) => {
  const candidate =
    record.type === "expense"
      ? String(record.expenseDate ?? "").trim()
      : String(record.tripDate ?? "").trim();

  return candidate || toDateInputValue(record.timestamp ?? new Date());
};

export const getFinanceRecordDriverStaffId = (record = {}) => {
  const normalizedDriverStaffId = String(
    record.driverStaffId ??
      record.driver_staff_id ??
      (record.createdByRole === "Driver" ? record.createdBy : ""),
  ).trim();

  return normalizedDriverStaffId || null;
};

export const getFinanceRecordDriverName = (record = {}) => {
  const normalizedDriverName = String(record.driverName ?? record.driver_name ?? "").trim();

  return normalizedDriverName || null;
};

export const normalizeCashUpWorkflowStatus = (status) => {
  const normalized = String(status ?? "").trim().toLowerCase();

  return ["pending", "counted", "verified", "banked"].includes(normalized)
    ? normalized
    : null;
};

export const getFinanceRecordCashUpCoverageKey = (record = {}) => {
  const driverStaffId = String(getFinanceRecordDriverStaffId(record) ?? "").trim();
  const workDate = String(getFinanceRecordWorkDate(record) ?? "").trim();

  return driverStaffId && workDate ? `${driverStaffId}::${workDate}` : null;
};

export const getCashUpCoverageKey = (entry = {}) => {
  const driverStaffId = String(entry.driverStaffId ?? "").trim();
  const workDate = String(entry.workDate ?? "").trim();

  return driverStaffId && workDate ? `${driverStaffId}::${workDate}` : null;
};

export const isDriverCreatedFinanceRecord = (record = {}) => record.createdByRole === "Driver";

// Expected opening odometer for a vehicle: the closing reading of its latest
// standard daily record (any driver), else the vehicle's current odometer. A
// daily record's `discrepancy` flag compares its opening reading against this.
export const getExpectedOpeningOdo = (transactions, vehicles, vehicleId, excludedId = null) => {
  const latestShift = [...transactions]
    .filter(
      (record) =>
        record.type === "income" &&
        record.incomeKind === "standard" &&
        record.vehicleId === vehicleId &&
        record.id !== excludedId,
    )
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

  if (latestShift?.closingOdo != null) {
    return Number(latestShift.closingOdo);
  }

  return Number(vehicles.find((vehicle) => vehicle.id === vehicleId)?.currentOdometer ?? 0);
};

export const findDriverCashUpEntry = (dailyCashUps = [], { driverStaffId, workDate }) =>
  [...(dailyCashUps ?? [])]
    .filter(
      (entry) =>
        String(entry.driverStaffId ?? "").trim() === driverStaffId &&
        String(entry.workDate ?? "").trim() === workDate,
    )
    .sort(
      (left, right) =>
        new Date(right.checkedAt ?? right.updatedAt ?? right.createdAt ?? 0) -
        new Date(left.checkedAt ?? left.updatedAt ?? left.createdAt ?? 0),
    )[0] ?? null;

// Numeric core of a driver's day cash-up. Expected cash in is all of the
// driver's income for the day (standard and special) less *cash* expenses only;
// non-cash expenses never reduce the cash handed in.
export const summarizeDriverDayCash = (
  { financeTransactions = [], dailyCashUps = [] } = {},
  { driverStaffId, workDate },
) => {
  const dayTransactions = [...(financeTransactions ?? [])]
    .filter(
      (record) =>
        ["income", "expense"].includes(record?.type) &&
        getFinanceRecordDriverStaffId(record) === driverStaffId &&
        getFinanceRecordWorkDate(record) === workDate,
    )
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const incomeRecords = dayTransactions.filter((record) => record.type === "income");
  const expenseRecords = dayTransactions.filter((record) => record.type === "expense");
  const totalIncome = sumBy(incomeRecords, (record) => record.amountClaimed ?? record.amount);
  const totalExpenses = sumBy(expenseRecords, (record) => record.amount);
  const cashExpenses = sumBy(
    expenseRecords.filter((record) => record.cashExpense),
    (record) => record.amount,
  );
  const cashUpRecord = findDriverCashUpEntry(dailyCashUps, { driverStaffId, workDate });
  const driverName =
    getFinanceRecordDriverName(dayTransactions[0]) ||
    String(cashUpRecord?.driverName ?? "").trim() ||
    null;

  return {
    workDate,
    driverStaffId,
    driverName,
    dayTransactions,
    entryCount: dayTransactions.length,
    incomeCount: incomeRecords.length,
    expenseCount: expenseRecords.length,
    totalIncome,
    totalExpenses,
    cashExpenses,
    nonCashExpenses: totalExpenses - cashExpenses,
    expectedCashIn: totalIncome - cashExpenses,
    netAfterExpenses: totalIncome - totalExpenses,
    incomeRecords,
    expenseRecords,
    cashUpRecord,
  };
};

export const getDriverCashUpWorkflowStatus = (entry, summary) => {
  const explicitStatus = normalizeCashUpWorkflowStatus(entry?.status);
  const linkedStatuses = [
    ...(summary?.incomeRecords ?? []).map((record) =>
      normalizeCashUpWorkflowStatus(record.status),
    ),
    ...(summary?.expenseRecords ?? []).map((record) =>
      normalizeCashUpWorkflowStatus(record.status),
    ),
  ].filter(Boolean);

  if (linkedStatuses.length === 0) {
    return explicitStatus ?? "pending";
  }

  if (linkedStatuses.every((status) => status === "banked")) {
    return "banked";
  }
  if (linkedStatuses.some((status) => status === "pending")) {
    return "pending";
  }
  if (linkedStatuses.some((status) => status === "counted")) {
    return "counted";
  }
  if (linkedStatuses.some((status) => status === "verified")) {
    return "verified";
  }

  return explicitStatus ?? "pending";
};
