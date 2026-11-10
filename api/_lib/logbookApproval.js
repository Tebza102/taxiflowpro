import { randomUUID } from "node:crypto";

import { getDriverCashUpWorkflowStatus, summarizeDriverDayCash } from "../../src/lib/cashUpContract.js";
import {
  LOGBOOK_EXPENSE_FIELDS,
  hasLogbookErrors,
  hasLogbookWarnings,
  parseLogbookDate,
  toCents,
  validateLogbookRow,
} from "../../src/lib/logbookContract.js";
import { normalizeTripFinanceTransactions } from "../../src/lib/tripHistory.js";
import { sastTimestamp } from "./financeCapture.js";
import { createHttpError } from "./tenantAuth.js";

// Pure: an approved logbook row -> the ordinary finance records the rest of
// TaxiFlow already understands (same shapes as financeCapture.js), added to the
// business snapshot. Nothing here talks to the database.
//
// - Revenue becomes one income record for that driver, vehicle and day.
// - Each expense above zero becomes a vehicle cash expense paid from that
//   driver's takings (so the day's expected cash is revenue less expenses).
// - Records start "pending", exactly like captured work: the import never counts,
//   verifies or banks cash. The banked figure from the paper is kept on the
//   income record for reference; deposits still come only from deposit.lock.
// - Record ids come from the row hash, so one logbook row can never produce a
//   second set of records.

const text = (value) => String(value ?? "").trim();

export const logbookRecordIds = (rowHash) => {
  const stem = `txn-logbook-${rowHash.slice(0, 24)}`;
  return { income: `${stem}-inc`, expense: (key) => `${stem}-exp-${key}` };
};

const closedDayStatus = (stored, driverStaffId, workDate) => {
  const normalized = normalizeTripFinanceTransactions(stored.financeTransactions ?? [], {
    source: stored,
    routes: stored.routes ?? [],
    vehicles: stored.vehicles ?? [],
    drivers: stored.drivers ?? [],
  });
  const summary = summarizeDriverDayCash({ financeTransactions: normalized, dailyCashUps: stored.dailyCashUps ?? [] }, { driverStaffId, workDate });
  const cashUp = summary.cashUpRecord;
  if (!cashUp) return null;
  const status = getDriverCashUpWorkflowStatus(cashUp, summary);
  return ["counted", "verified", "banked"].includes(status) || cashUp.status === "banked" ? status : null;
};

// Returns { snapshot, liveRecordIds, issues }. Throws 409 when the row cannot be
// approved as it stands (the message says what the admin must do).
export const applyLogbookApproval = (storedSnapshot, row, requester, { acknowledgeWarnings = false, now = new Date().toISOString() } = {}) => {
  const stored = storedSnapshot ?? {};
  const fields = row.fields;
  // Validated again at approval, against the business as it is NOW.
  const { issues, vehicleId, driverStaffId } = validateLogbookRow(fields, stored);
  if (hasLogbookErrors(issues)) {
    const error = createHttpError(409, "This row still has problems. Correct the highlighted fields before approving.");
    error.issues = issues;
    throw error;
  }
  if (hasLogbookWarnings(issues) && !acknowledgeWarnings) {
    const error = createHttpError(409, "This row has warnings. Check them against the page and confirm before approving.");
    error.issues = issues;
    error.needsAcknowledgement = true;
    throw error;
  }

  const date = parseLogbookDate(fields.date.value);
  const vehicle = (stored.vehicles ?? []).find((item) => text(item.id) === vehicleId);
  const driver = (stored.drivers ?? []).find((item) => text(item.staffId) === driverStaffId);
  const closed = closedDayStatus(stored, driverStaffId, date);
  if (closed) {
    throw createHttpError(409, `The day checking for ${text(driver.name)} on ${date} is already ${closed}; logbook figures cannot be added to a closed day.`);
  }

  const ids = logbookRecordIds(row.rowHash);
  const logbookImport = {
    batchId: row.batchId,
    rowId: row.id,
    rowHash: row.rowHash,
    bankedAmount: fields.banked.value,
    approvedBy: requester.id,
    approvedAt: now,
  };
  const meta = {
    createdAt: now,
    createdBy: requester.id,
    createdByRole: requester.role,
    updatedAt: null,
    updatedBy: null,
    updatedByRole: null,
    source: "logbook-import",
    requestId: null,
  };
  const common = {
    vehicleId,
    vehicle: vehicle.registration,
    driverStaffId,
    driverName: text(driver.name) || null,
    status: "pending",
    timestamp: sastTimestamp(date),
    ...meta,
    depositId: null,
    logbookImport,
  };

  const records = [];
  if (toCents(fields.revenue.value) > 0) {
    records.push({
      id: ids.income,
      type: "income",
      incomeKind: "standard",
      route: vehicle.route ?? driver.route ?? "",
      tripDate: date,
      notes: "Imported from the paper logbook (day total; no trip lines).",
      amountClaimed: fields.revenue.value,
      actualCashReceived: null,
      amount: fields.revenue.value,
      discrepancy: false,
      isSpecial: false,
      verifiedAt: null,
      verifiedBy: null,
      verifiedByRole: null,
      ...common,
    });
  }
  for (const { key, category, description } of LOGBOOK_EXPENSE_FIELDS) {
    if (toCents(fields[key].value) <= 0) continue;
    records.push({
      id: ids.expense(key),
      type: "expense",
      expenseKind: "asset",
      category,
      description,
      expenseDate: date,
      reference: null,
      amount: fields[key].value,
      cashExpense: true,
      ...common,
    });
  }

  const existing = new Set((stored.financeTransactions ?? []).map((item) => text(item.id)));
  if (records.some((record) => existing.has(record.id))) {
    throw createHttpError(409, "This logbook row has already been recorded.");
  }

  const total = records.reduce((sum, record) => sum + (record.type === "expense" ? toCents(record.amount) : 0), 0) / 100;
  const audit = {
    id: `audit-${randomUUID()}`,
    timestamp: now,
    scope: "finance",
    actorId: requester.id,
    actorRole: requester.role,
    source: "server",
    requestId: null,
    action: "create",
    entityType: "logbook-import",
    entityId: row.id,
    title: `Logbook row approved / ${vehicle.registration}`,
    detail: `${date} / ${text(driver.name)} / revenue ${fields.revenue.value} / expenses ${total} / banked on paper ${fields.banked.value}`,
  };

  return {
    snapshot: {
      ...stored,
      financeTransactions: [...records, ...(stored.financeTransactions ?? [])],
      auditTrail: [audit, ...(stored.auditTrail ?? [])],
    },
    liveRecordIds: records.map((record) => record.id),
    issues,
  };
};
