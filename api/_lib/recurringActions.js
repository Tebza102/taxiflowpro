import { randomUUID } from "node:crypto";

import {
  RECURRING_PAYMENT_FIELDS,
  RECURRING_SCHEDULE_FIELDS,
  RECURRING_STATUS_FIELDS,
  RecurringRuleError,
  applyRecurringSchedule,
  applyRecurringStatusChange,
  buildRecurringPaymentRecord,
  parseRecurringPayment,
  parseRecurringSchedule,
  parseRecurringStatusChange,
} from "../../src/lib/recurringExpenseContract.js";
import { sastTimestamp } from "./financeCapture.js";
import { createHttpError } from "./tenantAuth.js";

// Recurring fixed expense actions (rules in src/lib/recurringExpenseContract.js).
// Management with Money edit access (Owner always), like a management expense:
//   recurring.schedule_save   create, or change future occurrences (revision)
//   recurring.schedule_status pause, resume or stop (revision); never removes
//                             the schedule, its history or its payments
//   recurring.payment_record  record one occurrence as one expense; refused if
//                             that occurrence is already recorded
// Duplicates across retries and concurrent requests are refused by the fixed
// record id per schedule and period, the requestId log and the snapshot version
// check in commit_finance_action (finance-actions.js).

const asHttp = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch (error) {
    if (error instanceof RecurringRuleError) throw createHttpError(error.statusCode, error.message);
    throw error;
  }
};

const withAudit = (stored, event) => [event, ...(Array.isArray(stored.auditTrail) ? stored.auditTrail : [])];
const auditEvent = (requester, now, requestId, fields) => ({
  id: `audit-${requestId}`,
  timestamp: now,
  actorId: requester.id,
  actorRole: requester.role,
  source: "server",
  requestId,
  ...fields,
});

const saveSchedule = (stored, fields, requester, now, requestId) => {
  const { finance, schedule, audit } = applyRecurringSchedule(stored, fields, requester, now, randomUUID().slice(0, 12));
  return {
    snapshot: { ...stored, finance, auditTrail: withAudit(stored, auditEvent(requester, now, requestId, audit)) },
    targetId: schedule.id,
    response: { scheduleId: schedule.id, revision: schedule.revision },
  };
};

const changeStatus = (stored, fields, requester, now, requestId) => {
  const { finance, schedule, audit } = applyRecurringStatusChange(stored, fields, requester, now);
  return {
    snapshot: { ...stored, finance, auditTrail: withAudit(stored, auditEvent(requester, now, requestId, audit)) },
    targetId: schedule.id,
    response: { scheduleId: schedule.id, status: schedule.status, revision: schedule.revision },
  };
};

const recordPayment = (stored, fields, requester, now, requestId) => {
  const { record, audit } = buildRecurringPaymentRecord(stored, fields, requester, now, {
    timestamp: sastTimestamp(fields.paidDate),
    source: "server",
    requestId,
  });
  return {
    snapshot: {
      ...stored,
      financeTransactions: [record, ...(Array.isArray(stored.financeTransactions) ? stored.financeTransactions : [])],
      auditTrail: withAudit(stored, auditEvent(requester, now, requestId, audit)),
    },
    targetId: record.id,
    response: { recordId: record.id, status: record.status, period: record.recurringPayment.period },
  };
};

export const RECURRING_ACTIONS = Object.freeze({
  "recurring.schedule_save": { roles: ["Owner", "Admin", "Manager"], fields: RECURRING_SCHEDULE_FIELDS, parse: asHttp(parseRecurringSchedule), apply: asHttp(saveSchedule) },
  "recurring.schedule_status": { roles: ["Owner", "Admin", "Manager"], fields: RECURRING_STATUS_FIELDS, parse: asHttp(parseRecurringStatusChange), apply: asHttp(changeStatus) },
  "recurring.payment_record": { roles: ["Owner", "Admin", "Manager"], fields: RECURRING_PAYMENT_FIELDS, parse: asHttp(parseRecurringPayment), apply: asHttp(recordPayment) },
});
