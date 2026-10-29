import { randomUUID } from "node:crypto";

import { getDriverCashUpWorkflowStatus, getFinanceRecordWorkDate, summarizeDriverDayCash } from "../../src/lib/cashUpContract.js";
import { normalizeTripFinanceTransactions } from "../../src/lib/tripHistory.js";
import {
  CAPTURE_ACTIONS,
  buildExpense,
  buildSpecialIncome,
  buildStandardIncome,
  parseExpense,
  parseSpecialIncome,
  parseStandardIncome,
} from "./financeCapture.js";
import { createHttpError } from "./tenantAuth.js";

// Standalone income count/verify and edit/delete of eligible records
// (src/App.jsx verifyIncome standalone branch, save* with draft.id,
// deleteTransaction), on the same authorized, atomic, retry-safe path.
//
// Intentional server rules (stricter than the browser, see tenant-design.md):
// - count/verify apply only to standalone income; driver work goes through the
//   day checking (cashup.* actions), so the cash-up workflow cannot be bypassed.
// - edit/delete apply only to PENDING records, never inside a driver day whose
//   checking is counted, verified or banked (closed-day guard), never banked.
// - edits keep the record id, creator and driver ownership; edited records stay
//   pending (an edit never verifies anything).

const text = (value) => String(value ?? "").trim();
const bad = (message) => createHttpError(400, message);

const findRecord = (stored, recordId) => {
  const record = (stored.financeTransactions ?? []).find((item) => text(item.id) === recordId);
  if (!record) throw createHttpError(404, "That record does not exist in this business.");
  if (record.status === "banked") throw createHttpError(409, "Deposited records are final and cannot be changed.");
  return record;
};

const dayStatus = (stored, driverStaffId, workDate) => {
  if (!text(driverStaffId) || !workDate) return null;
  const normalized = normalizeTripFinanceTransactions(stored.financeTransactions ?? [], { source: stored, routes: stored.routes ?? [], vehicles: stored.vehicles ?? [], drivers: stored.drivers ?? [] });
  const summary = summarizeDriverDayCash({ financeTransactions: normalized, dailyCashUps: stored.dailyCashUps ?? [] }, { driverStaffId: text(driverStaffId), workDate });
  if (!summary.cashUpRecord) return null;
  return summary.cashUpRecord.status === "banked" ? "banked" : getDriverCashUpWorkflowStatus(summary.cashUpRecord, summary);
};

const assertDayOpen = (stored, driverStaffId, workDate) => {
  const status = dayStatus(stored, driverStaffId, workDate);
  if (["counted", "verified", "banked"].includes(status)) {
    throw createHttpError(409, `The day checking for ${workDate} is ${status}; its records cannot be changed.`);
  }
};

const assertFinanceEdit = (requester) => {
  if (!["Owner", "Admin", "Manager"].includes(requester.role)) throw createHttpError(403, "Your role cannot change finance records.");
  if (requester.role !== "Owner" && requester.moduleAccess?.finance !== true) throw createHttpError(403, "Money access is turned off for your account.");
};

const auditEvent = (requester, now, requestId, fields) => ({
  id: `audit-${randomUUID()}`,
  timestamp: now,
  scope: "finance",
  actorId: requester.id,
  actorRole: requester.role,
  source: "server",
  requestId,
  ...fields,
});

const replaceRecord = (stored, id, next) => (stored.financeTransactions ?? []).map((record) => (text(record.id) === id ? next : record));
const money = (value) => Math.round(Number(value) * 100) / 100;

// --- Parsers --------------------------------------------------------------------
const parseRecordId = (fields) => {
  const recordId = text(fields.recordId);
  if (!recordId || recordId.length > 200) throw bad("recordId is required.");
  return recordId;
};
const parseCash = (value, required) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad("Enter the cash received before recording the hand-in.");
    return undefined;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) throw bad("actualCashReceived must be a non-negative amount.");
  return money(amount);
};
const onlyKeys = (fields, allowed) => {
  const extra = Object.keys(fields).filter((key) => !allowed.includes(key));
  if (extra.length) throw bad(`Unsupported fields: ${extra.join(", ")}.`);
};

// --- Standalone count / verify ------------------------------------------------------
const standaloneIncome = (stored, recordId) => {
  const record = findRecord(stored, recordId);
  if (record.type !== "income") throw createHttpError(409, "Only income records have a cash hand-in.");
  if (text(record.driverStaffId)) throw createHttpError(409, "Driver work is counted through the driver's day checking, not record by record.");
  return record;
};

const countIncome = (stored, fields, requester, now, requestId) => {
  const record = standaloneIncome(stored, fields.recordId);
  if (record.status !== "pending") throw createHttpError(409, `This record is ${record.status}; a hand-in can only be recorded while pending.`);
  const amount = fields.actualCashReceived;
  const claimed = Number(record.amountClaimed ?? record.amount ?? 0);
  const next = { ...record, actualCashReceived: amount, status: "counted", countedAt: now, countedBy: requester.id, countedByRole: requester.role, verifiedAt: null, verifiedBy: null, verifiedByRole: null };
  return {
    snapshot: {
      ...stored,
      financeTransactions: replaceRecord(stored, record.id, next),
      auditTrail: [auditEvent(requester, now, requestId, { action: "update", entityType: "income", entityId: record.id, title: `Cash hand-in recorded / ${record.vehicle ?? "General"}`, detail: `${amount} handed in to admin` }), ...(stored.auditTrail ?? [])],
    },
    targetId: record.id,
    response: { recordId: record.id, status: "counted", amountClaimed: claimed, actualCashReceived: amount, variance: money(amount - claimed), shortage: Math.max(claimed - amount, 0) },
  };
};

const verifyIncome = (stored, fields, requester, now, requestId) => {
  const record = standaloneIncome(stored, fields.recordId);
  if (record.status !== "counted") {
    throw createHttpError(409, record.status === "verified" ? "This cash checking has already been verified." : "An administrator must record the cash hand-in before manager verification.");
  }
  // Separation of duties (same rule as cashup.verify): the counter cannot verify.
  if (text(record.countedBy) && text(record.countedBy) === text(requester.id)) {
    throw createHttpError(403, "You counted this hand-in, so another authorized person must verify it.");
  }
  const amount = fields.actualCashReceived ?? Number(record.actualCashReceived);
  if (!Number.isFinite(amount) || amount < 0) throw createHttpError(409, "An administrator must record the cash hand-in before manager verification.");
  const claimed = Number(record.amountClaimed ?? record.amount ?? 0);
  const next = { ...record, actualCashReceived: amount, status: "verified", verifiedAt: now, verifiedBy: requester.id, verifiedByRole: requester.role };
  return {
    snapshot: {
      ...stored,
      financeTransactions: replaceRecord(stored, record.id, next),
      auditTrail: [auditEvent(requester, now, requestId, { action: "verify", entityType: "income", entityId: record.id, title: `Cash checking verified / ${record.vehicle ?? "General"}`, detail: `${amount} manager checked` }), ...(stored.auditTrail ?? [])],
    },
    targetId: record.id,
    response: { recordId: record.id, status: "verified", amountClaimed: claimed, actualCashReceived: amount, variance: money(amount - claimed), shortage: Math.max(claimed - amount, 0) },
  };
};

// --- Edit ---------------------------------------------------------------------------
const KIND = {
  standard: { parse: parseStandardIncome, build: buildStandardIncome, date: "tripDate", fields: CAPTURE_ACTIONS["capture.standard_income"].fields },
  special: { parse: parseSpecialIncome, build: buildSpecialIncome, date: "tripDate", fields: CAPTURE_ACTIONS["capture.special_income"].fields },
  expense: { parse: parseExpense, build: buildExpense, date: "expenseDate", fields: CAPTURE_ACTIONS["capture.expense"].fields },
};
const kindOf = (record) => (record.type === "expense" ? "expense" : record.incomeKind === "special" ? "special" : "standard");

const TRACKED = ["amountClaimed", "amount", "vehicle", "tripDate", "expenseDate", "openingOdo", "closingOdo", "tripCount", "totalPassengers", "route", "travelReason", "category", "description", "cashExpense"];
const changeSummary = (before, after) =>
  TRACKED.filter((key) => key in after && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => `${key} ${before[key] ?? "-"} to ${after[key] ?? "-"}`)
    .join(" / ") || "No tracked values changed.";

const editRecord = (stored, fields, requester, now, requestId) => {
  const record = findRecord(stored, fields.recordId);
  if (record.status !== "pending") throw createHttpError(409, `Only pending records can be edited; this one is ${record.status}.`);
  // A salary keeps the amount and period it was paid for; correct a pending one
  // by deleting it and recording the payment again.
  if (record.salaryPayment) throw createHttpError(409, "Salary payments cannot be edited. Delete the pending payment and record it again.");
  const kind = KIND[kindOf(record)];

  const isDriverEdit = requester.role === "Driver";
  if (isDriverEdit) {
    if (!text(requester.driverStaffId) || text(record.driverStaffId) !== text(requester.driverStaffId)) {
      throw createHttpError(403, "Drivers can only edit their own records.");
    }
    if (!fields.editReason) throw bad("Add a note explaining why you are updating this record.");
  } else {
    assertFinanceEdit(requester);
  }

  if ("captureAs" in fields.changes) throw bad("captureAs cannot be changed on an edit.");
  // Same explicit field list as capture: status, ids, roles or computed values
  // (amountClaimed, discrepancy, ...) can never be supplied by the caller.
  const unknown = Object.keys(fields.changes).filter((key) => !kind.fields.includes(key));
  if (unknown.length) throw bad(`Unsupported fields: ${unknown.join(", ")}.`);
  const parsed = kind.parse(fields.changes);
  const workDateBefore = getFinanceRecordWorkDate(record);
  assertDayOpen(stored, record.driverStaffId, workDateBefore);
  assertDayOpen(stored, record.driverStaffId, parsed[kind.date]);

  const built = kind.build(stored, parsed, requester, now, requestId, {
    id: record.id,
    driverStaffId: text(record.driverStaffId) || null,
    driverName: record.driverName ?? null,
    mode: text(record.driverStaffId) ? "driver" : "management",
  });
  const history = Array.isArray(record.editHistory) ? record.editHistory : [];
  const summary = changeSummary(record, built.record);
  const editEntry = fields.editReason
    ? { id: `edit-${randomUUID()}`, timestamp: now, reason: fields.editReason, summary, actorId: requester.id, actorRole: requester.role }
    : null;
  const next = {
    ...record,
    ...built.record,
    id: record.id,
    createdAt: record.createdAt ?? built.record.createdAt,
    createdBy: record.createdBy ?? built.record.createdBy,
    createdByRole: record.createdByRole ?? built.record.createdByRole,
    updatedAt: now,
    updatedBy: requester.id,
    updatedByRole: requester.role,
    status: "pending",
    requestId,
    editHistory: editEntry ? [editEntry, ...history] : history,
    lastEditReason: editEntry ? editEntry.reason : record.lastEditReason ?? null,
    lastEditSummary: editEntry ? editEntry.summary : record.lastEditSummary ?? null,
    lastEditedAt: editEntry ? now : record.lastEditedAt ?? null,
    lastEditedBy: editEntry ? requester.id : record.lastEditedBy ?? null,
    lastEditedByRole: editEntry ? requester.role : record.lastEditedByRole ?? null,
  };
  return {
    snapshot: {
      ...stored,
      financeTransactions: replaceRecord(stored, record.id, next),
      auditTrail: [auditEvent(requester, now, requestId, { action: "update", entityType: record.type, entityId: record.id, title: `${record.type === "expense" ? "Expense" : "Trip income"} updated / ${next.vehicle ?? "General"}`, detail: `${summary}${editEntry ? ` / note: ${editEntry.reason}` : ""}` }), ...(stored.auditTrail ?? [])],
    },
    targetId: record.id,
    response: { recordId: record.id, status: "pending", summary, editHistoryLength: next.editHistory.length },
  };
};

// --- Delete -------------------------------------------------------------------------
const deleteRecord = (stored, fields, requester, now, requestId) => {
  assertFinanceEdit(requester);
  const record = findRecord(stored, fields.recordId);
  if (record.status !== "pending") throw createHttpError(409, `Only pending records can be deleted; this one is ${record.status}.`);
  assertDayOpen(stored, record.driverStaffId, getFinanceRecordWorkDate(record));
  return {
    snapshot: {
      ...stored,
      financeTransactions: (stored.financeTransactions ?? []).filter((item) => text(item.id) !== record.id),
      auditTrail: [auditEvent(requester, now, requestId, { action: "delete", entityType: record.type, entityId: record.id, title: `${record.type === "expense" ? "Expense" : record.isSpecial ? "Extra trip" : "Trip income"} removed / ${record.vehicle ?? "General"}`, detail: `${record.amountClaimed ?? record.amount ?? 0}${fields.reason ? ` / ${fields.reason}` : ""}` }), ...(stored.auditTrail ?? [])],
    },
    targetId: record.id,
    response: { recordId: record.id, deleted: true },
  };
};

export const RECORD_ACTIONS = Object.freeze({
  "income.count": {
    roles: ["Owner", "Admin", "Manager"],
    permission: "cash.count",
    fields: ["recordId", "actualCashReceived"],
    parse: (f) => (onlyKeys(f, ["recordId", "actualCashReceived"]), { recordId: parseRecordId(f), actualCashReceived: parseCash(f.actualCashReceived, true) }),
    apply: countIncome,
  },
  "income.verify": {
    roles: ["Owner", "Admin", "Manager"],
    permission: "cash.verify",
    fields: ["recordId", "actualCashReceived"],
    parse: (f) => (onlyKeys(f, ["recordId", "actualCashReceived"]), { recordId: parseRecordId(f), actualCashReceived: parseCash(f.actualCashReceived, false) }),
    apply: verifyIncome,
  },
  "record.edit": {
    roles: ["Owner", "Admin", "Manager", "Driver"],
    fields: ["recordId", "editReason", "changes"],
    parse: (f) => {
      onlyKeys(f, ["recordId", "editReason", "changes"]);
      if (!f.changes || typeof f.changes !== "object" || Array.isArray(f.changes)) throw bad("changes must be an object with the record's fields.");
      const editReason = text(f.editReason);
      if (editReason.length > 500) throw bad("The edit reason is too long.");
      return { recordId: parseRecordId(f), editReason: editReason || null, changes: f.changes };
    },
    apply: editRecord,
  },
  "record.delete": {
    roles: ["Owner", "Admin", "Manager"],
    fields: ["recordId", "reason"],
    parse: (f) => (onlyKeys(f, ["recordId", "reason"]), { recordId: parseRecordId(f), reason: text(f.reason).slice(0, 500) || null }),
    apply: deleteRecord,
  },
});
