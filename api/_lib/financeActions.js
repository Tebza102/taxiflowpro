import { createHash, randomUUID } from "node:crypto";

import {
  getDriverCashUpWorkflowStatus,
  summarizeDriverDayCash,
} from "../../src/lib/cashUpContract.js";
import { normalizeTripFinanceTransactions } from "../../src/lib/tripHistory.js";
import { createHttpError } from "./tenantAuth.js";

// Scoped server-side finance actions. Pure: given the stored business snapshot,
// a validated action and the authorized requester, return the next snapshot.
// Only the target day cash-up, its linked finance records and one appended
// audit event can change; every other key is copied through untouched.
// Permissions are the existing workflow's (src/lib/appRuntime.js):
//   cashup.submit         Driver, or an Owner who drives; requires the membership's
//                         authoritative driver linkage (own records only)
//   cashup.record_handin  Owner, Admin  (canRecordCashHandoverForRole)
//   cashup.verify         Owner, Manager (canVerifyCashCheckForRole)
//   deposit.lock          Owner, Manager with finance edit (canFinishDepositForRole +
//                         hasModuleUpdateAccess("finance")): verified -> banked
// Status values stay pending | counted | verified | banked; expected cash in is
// the shared summarizeDriverDayCash (income less cash expenses).

export const FINANCE_ACTIONS = Object.freeze({
  // Owner-driver: one identity, Owner role kept, driver linkage from the membership.
  "cashup.submit": { roles: ["Driver", "Owner"], fields: ["workDate"], requiresDriverLink: true },
  "cashup.record_handin": { roles: ["Owner", "Admin"], fields: ["cashUpId", "actualCashReceived"] },
  "cashup.verify": { roles: ["Owner", "Manager"], fields: ["cashUpId", "actualCashReceived"] },
  "deposit.lock": { roles: ["Owner", "Manager"], fields: ["cashUpIds", "transactionIds"], requiresFinanceEdit: true },
});

const ENVELOPE_FIELDS = ["action", "requestId", "expectedVersion", "fields"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value) => String(value ?? "").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

// Validates the request envelope and fields. Anything not explicitly allowed
// (a snapshot, appUsers, business ids, roles, extra fields) is rejected.
export const parseFinanceActionRequest = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw createHttpError(400, "A JSON action request is required.");
  const extra = Object.keys(body).filter((key) => !ENVELOPE_FIELDS.includes(key));
  if (extra.length) throw createHttpError(400, `Unsupported request fields: ${extra.join(", ")}.`);

  const action = text(body.action);
  const spec = FINANCE_ACTIONS[action];
  if (!spec) throw createHttpError(400, "Unsupported finance action.");
  const requestId = text(body.requestId);
  if (!UUID.test(requestId)) throw createHttpError(400, "requestId must be a UUID (reuse it when retrying).");
  const expectedVersion = text(body.expectedVersion);
  if (!expectedVersion || Number.isNaN(Date.parse(expectedVersion))) throw createHttpError(400, "expectedVersion (the snapshot updated_at you loaded) is required.");

  const fields = body.fields ?? {};
  if (typeof fields !== "object" || Array.isArray(fields)) throw createHttpError(400, "fields must be an object.");
  const unknown = Object.keys(fields).filter((key) => !spec.fields.includes(key));
  if (unknown.length) throw createHttpError(400, `Unsupported fields for ${action}: ${unknown.join(", ")}.`);

  const parsed = {};
  if (spec.fields.includes("workDate")) {
    if (!DATE.test(text(fields.workDate))) throw createHttpError(400, "workDate must be YYYY-MM-DD.");
    parsed.workDate = text(fields.workDate);
  }
  if (spec.fields.includes("cashUpId")) {
    if (!text(fields.cashUpId) || text(fields.cashUpId).length > 200) throw createHttpError(400, "cashUpId is required.");
    parsed.cashUpId = text(fields.cashUpId);
  }
  if (spec.fields.includes("actualCashReceived") && fields.actualCashReceived !== undefined && fields.actualCashReceived !== null) {
    const amount = Number(fields.actualCashReceived);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) throw createHttpError(400, "actualCashReceived must be a non-negative amount.");
    parsed.actualCashReceived = Math.round(amount * 100) / 100;
  }

  for (const key of ["cashUpIds", "transactionIds"]) {
    if (!spec.fields.includes(key)) continue;
    const list = fields[key];
    if (!Array.isArray(list) || list.length > 500 || list.some((id) => typeof id !== "string" || !text(id) || text(id).length > 200)) {
      throw createHttpError(400, `${key} must be the list of ids you reviewed.`);
    }
    const unique = [...new Set(list.map(text))].sort();
    if (unique.length !== list.length) throw createHttpError(400, `${key} contains duplicates.`);
    parsed[key] = unique;
  }

  return {
    action,
    requestId: requestId.toLowerCase(),
    expectedVersion,
    fields: parsed,
    requestHash: createHash("sha256").update(stable({ action, fields: parsed })).digest("hex"),
  };
};

const daySummary = (stored, driverStaffId, workDate) => {
  const normalized = normalizeTripFinanceTransactions(stored.financeTransactions ?? [], {
    source: stored,
    routes: stored.routes ?? [],
    vehicles: stored.vehicles ?? [],
    drivers: stored.drivers ?? [],
  });
  return summarizeDriverDayCash({ financeTransactions: normalized, dailyCashUps: stored.dailyCashUps ?? [] }, { driverStaffId, workDate });
};

const linkedIds = (summary) => new Set([...summary.incomeRecords, ...summary.expenseRecords].map((record) => record.id).filter(Boolean));

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

// Returns { snapshot, targetId, response }.
export const applyFinanceAction = (storedSnapshot, request, requester, now = new Date().toISOString()) => {
  const spec = FINANCE_ACTIONS[request.action];
  if (!spec || !spec.roles.includes(requester.role)) {
    throw createHttpError(403, `Your role cannot perform ${request.action}.`);
  }
  if (spec.requiresDriverLink && !text(requester.driverStaffId)) {
    throw createHttpError(403, "Your membership is not linked to a driver record.");
  }
  if (spec.requiresFinanceEdit && requester.role !== "Owner" && requester.moduleAccess?.finance !== true) {
    throw createHttpError(403, "Money access is turned off for your account.");
  }
  const stored = clone(storedSnapshot ?? {});
  const next = { ...stored };
  const cashUps = Array.isArray(stored.dailyCashUps) ? stored.dailyCashUps : [];

  if (request.action === "cashup.submit") {
    const driverStaffId = text(requester.driverStaffId);
    if (!driverStaffId) throw createHttpError(403, "Your membership is not linked to a driver record.");
    const summary = daySummary(stored, driverStaffId, request.fields.workDate);
    if (summary.entryCount === 0) throw createHttpError(409, "Save at least one income or expense entry before sending checking for the day.");
    const existing = cashUps.find((entry) => text(entry.driverStaffId) === driverStaffId && text(entry.workDate) === request.fields.workDate) ?? null;
    if (existing?.status === "banked" || getDriverCashUpWorkflowStatus(existing, summary) === "banked") {
      throw createHttpError(409, "Deposited day checkings can no longer be updated.");
    }
    const id = existing?.id ?? `cashup-${driverStaffId}-${request.fields.workDate}`;
    const cashUp = {
      ...(existing ?? {}),
      id,
      driverStaffId,
      driverName: summary.driverName ?? existing?.driverName ?? "Driver",
      workDate: request.fields.workDate,
      incomeRecordIds: summary.incomeRecords.map((record) => record.id),
      expenseRecordIds: summary.expenseRecords.map((record) => record.id),
      totalIncome: summary.totalIncome,
      totalExpenses: summary.totalExpenses,
      cashExpenses: summary.cashExpenses,
      expectedCashIn: summary.expectedCashIn,
      entryCount: summary.entryCount,
      status: "pending",
      actualCashReceived: null,
      checkedAt: now,
      checkedBy: requester.id,
      checkedByRole: requester.role,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? now : null,
      countedAt: null, countedBy: null, countedByRole: null,
      verifiedAt: null, verifiedBy: null, verifiedByRole: null,
      depositId: null, bankedAt: null,
    };
    const ids = linkedIds(summary);
    next.dailyCashUps = existing ? cashUps.map((entry) => (entry.id === existing.id ? cashUp : entry)) : [cashUp, ...cashUps];
    next.financeTransactions = (stored.financeTransactions ?? []).map((record) =>
      ids.has(record.id)
        ? { ...record, status: "pending", actualCashReceived: null, countedAt: null, countedBy: null, countedByRole: null, verifiedAt: null, verifiedBy: null, verifiedByRole: null, depositId: null, bankedAt: null }
        : record,
    );
    next.auditTrail = [
      auditEvent(requester, now, request.requestId, { action: "submit", entityType: "driver-checking", entityId: id, title: "Day checking sent", detail: `${request.fields.workDate} / expected ${summary.expectedCashIn}` }),
      ...(stored.auditTrail ?? []),
    ];
    return { snapshot: next, targetId: id, response: { action: request.action, cashUpId: id, status: "pending", expectedCashIn: summary.expectedCashIn } };
  }

  if (request.action === "deposit.lock") return lockDeposit(stored, request, requester, now);

  // cashup.record_handin / cashup.verify
  const target = cashUps.find((entry) => text(entry.id) === request.fields.cashUpId);
  if (!target) throw createHttpError(404, "That day checking does not exist in this business.");
  const summary = daySummary(stored, text(target.driverStaffId), text(target.workDate));
  const status = getDriverCashUpWorkflowStatus(target, summary);
  if (status === "banked") throw createHttpError(409, "Deposited day checkings can no longer be changed.");
  const ids = linkedIds(summary);

  if (request.action === "cashup.record_handin") {
    if (status !== "pending") throw createHttpError(409, `This day checking is ${status}; a hand-in can only be recorded while pending.`);
    if (request.fields.actualCashReceived === undefined) throw createHttpError(400, "Enter the cash received before recording the day hand-in.");
    const amount = request.fields.actualCashReceived;
    const cashUp = { ...target, status: "counted", actualCashReceived: amount, countedAt: now, countedBy: requester.id, countedByRole: requester.role, verifiedAt: null, verifiedBy: null, verifiedByRole: null };
    next.dailyCashUps = cashUps.map((entry) => (entry === target ? cashUp : entry));
    next.financeTransactions = (stored.financeTransactions ?? []).map((record) =>
      ids.has(record.id) ? { ...record, status: "counted", countedAt: now, countedBy: requester.id, countedByRole: requester.role, verifiedAt: null, verifiedBy: null, verifiedByRole: null, depositId: null, bankedAt: null } : record,
    );
    next.auditTrail = [
      auditEvent(requester, now, request.requestId, { action: "update", entityType: "driver-checking", entityId: target.id, title: `Day hand-in recorded / ${target.driverName ?? "Driver"}`, detail: `${target.workDate} / ${amount} handed in` }),
      ...(stored.auditTrail ?? []),
    ];
    return {
      snapshot: next,
      targetId: target.id,
      response: { action: request.action, cashUpId: target.id, status: "counted", expectedCashIn: summary.expectedCashIn, actualCashReceived: amount, variance: Math.round((amount - summary.expectedCashIn) * 100) / 100, shortage: Math.max(summary.expectedCashIn - amount, 0) },
    };
  }

  // cashup.verify
  if (status !== "counted") throw createHttpError(409, status === "verified" ? "This day checking has already been verified." : "An administrator must record the day hand-in before manager verification.");
  const amount = request.fields.actualCashReceived ?? Number(target.actualCashReceived);
  if (!Number.isFinite(amount) || amount < 0) throw createHttpError(409, "An administrator must record the day hand-in before manager verification.");
  const cashUp = { ...target, status: "verified", actualCashReceived: amount, verifiedAt: now, verifiedBy: requester.id, verifiedByRole: requester.role };
  next.dailyCashUps = cashUps.map((entry) => (entry === target ? cashUp : entry));
  next.financeTransactions = (stored.financeTransactions ?? []).map((record) =>
    ids.has(record.id) ? { ...record, status: "verified", verifiedAt: now, verifiedBy: requester.id, verifiedByRole: requester.role } : record,
  );
  next.auditTrail = [
    auditEvent(requester, now, request.requestId, { action: "verify", entityType: "driver-checking", entityId: target.id, title: `Day checking verified / ${target.driverName ?? "Driver"}`, detail: `${target.workDate} / ${amount} manager checked` }),
    ...(stored.auditTrail ?? []),
  ];
  return {
    snapshot: next,
    targetId: target.id,
    response: { action: request.action, cashUpId: target.id, status: "verified", expectedCashIn: summary.expectedCashIn, actualCashReceived: amount, variance: Math.round((amount - summary.expectedCashIn) * 100) / 100, shortage: Math.max(summary.expectedCashIn - amount, 0) },
  };
};

const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const incomeCashValue = (record) => Number(record.actualCashReceived ?? record.amountClaimed ?? record.amount ?? 0);
const sameSet = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

// Same reference shape as the browser (appRuntime.buildDepositReference),
// computed in South African time.
export const buildDepositReference = (sequence, value) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", month: "2-digit", day: "2-digit" })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  const day = String(parts.weekday).replace(".", "").toUpperCase();
  return `TFP-${day}-${parts.month}${parts.day}-${String(sequence).padStart(2, "0")}`;
};

// Existing lockDeposit rule: the batch is every verified driver day cash-up (with
// its linked records) plus every standalone verified record. The caller must send
// exactly the batch it reviewed; ids outside this business are refused (404), and
// a batch that no longer matches the current verified set is refused (409).
const lockDeposit = (stored, request, requester, now) => {
  const cashUps = Array.isArray(stored.dailyCashUps) ? stored.dailyCashUps : [];
  const transactions = Array.isArray(stored.financeTransactions) ? stored.financeTransactions : [];
  const knownCashUps = new Set(cashUps.map((entry) => text(entry.id)));
  const knownTransactions = new Set(transactions.map((record) => text(record.id)));
  const foreign = [
    ...request.fields.cashUpIds.filter((id) => !knownCashUps.has(id)),
    ...request.fields.transactionIds.filter((id) => !knownTransactions.has(id)),
  ];
  if (foreign.length) throw createHttpError(404, `These records do not exist in this business: ${foreign.join(", ")}.`);

  const verified = cashUps
    .map((entry) => ({ entry, summary: daySummary(stored, text(entry.driverStaffId), text(entry.workDate)) }))
    .filter(({ entry, summary }) => getDriverCashUpWorkflowStatus(entry, summary) === "verified");
  const cashUpTransactionIds = new Set(verified.flatMap(({ summary }) => [...linkedIds(summary)]));
  const standalone = transactions.filter((record) => record.status === "verified" && !cashUpTransactionIds.has(record.id));
  const batchCashUpIds = verified.map(({ entry }) => text(entry.id)).sort();
  const batchTransactionIds = [...new Set([...cashUpTransactionIds, ...standalone.map((record) => record.id)])].map(text).sort();

  if (batchCashUpIds.length + standalone.length === 0) throw createHttpError(409, "No manager-checked records are ready to finalise.");
  const notVerified = request.fields.transactionIds.filter((id) => !batchTransactionIds.includes(id));
  if (notVerified.length) throw createHttpError(409, `These records are not verified and cannot be banked: ${notVerified.join(", ")}.`);
  if (!sameSet(request.fields.cashUpIds, batchCashUpIds) || !sameSet(request.fields.transactionIds, batchTransactionIds)) {
    throw createHttpError(409, "The verified batch has changed since you reviewed it. Reload and try again; nothing was banked.");
  }

  const depositId = `dep-${randomUUID()}`;
  const reference = buildDepositReference((stored.deposits?.length ?? 0) + 1, new Date(now));
  const standaloneIncome = standalone.filter((record) => record.type === "income");
  const standaloneCashExpenses = standalone.filter((record) => record.type === "expense" && record.cashExpense);
  const deposit = {
    depositId,
    reference,
    timestamp: now,
    recordsLocked: verified.length + standalone.length,
    verifiedTakings: sum(verified, ({ summary }) => summary.totalIncome) + sum(standaloneIncome, incomeCashValue),
    cashExpenses: sum(standaloneCashExpenses, (record) => record.amount) + sum(verified, ({ summary }) => summary.cashExpenses),
    depositAmount:
      sum(verified, ({ entry, summary }) => entry.actualCashReceived ?? summary.expectedCashIn) +
      sum(standaloneIncome, incomeCashValue) -
      sum(standaloneCashExpenses, (record) => record.amount),
    transactionIds: batchTransactionIds,
    cashUpIds: batchCashUpIds,
    lockedBy: requester.id,
    lockedByRole: requester.role,
    source: "server",
    requestId: request.requestId,
  };
  const bankedIds = new Set(batchTransactionIds);
  const bankedCashUps = new Set(batchCashUpIds);
  const next = {
    ...stored,
    deposits: [deposit, ...(stored.deposits ?? [])],
    dailyCashUps: cashUps.map((entry) => (bankedCashUps.has(text(entry.id)) ? { ...entry, status: "banked", depositId, bankedAt: now } : entry)),
    financeTransactions: transactions.map((record) => (bankedIds.has(text(record.id)) ? { ...record, status: "banked", depositId, bankedAt: now } : record)),
    auditTrail: [
      auditEvent(requester, now, request.requestId, { action: "lock", entityType: "deposit", entityId: depositId, title: `Deposit finished / ${reference}`, detail: `${deposit.recordsLocked} records / ${deposit.depositAmount}` }),
      ...(stored.auditTrail ?? []),
    ],
  };
  return {
    snapshot: next,
    targetId: depositId,
    response: { action: request.action, depositId, reference, status: "banked", recordsLocked: deposit.recordsLocked, depositAmount: deposit.depositAmount, verifiedTakings: deposit.verifiedTakings, cashUpIds: batchCashUpIds, transactionIds: batchTransactionIds },
  };
};
