import {
  SALARY_ARRANGEMENT_FIELDS,
  SALARY_PAYMENT_FIELDS,
  SalaryRuleError,
  applySalaryArrangement,
  buildSalaryPaymentRecord,
  parseSalaryArrangement,
  parseSalaryPayment,
} from "../../src/lib/salaryContract.js";
import { sastTimestamp } from "./financeCapture.js";
import { createHttpError } from "./tenantAuth.js";

// Driver salary actions (rules in src/lib/salaryContract.js). Management only,
// and only with Money edit access (Owner always), like a management expense:
//   salary.arrangement_save  set or change a driver's salary schedule; changes
//                            finance.salaryArrangements only (no expense)
//   salary.payment_record    record one paid salary as one verified "Salary"
//                            expense; refused if that driver and period is
//                            already recorded
// Neither touches dailyCashUps, deposits or any existing finance record.

const asHttp = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch (error) {
    if (error instanceof SalaryRuleError) throw createHttpError(error.statusCode, error.message);
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

const saveArrangement = (stored, fields, requester, now, requestId) => {
  const { finance, arrangement, audit } = applySalaryArrangement(stored, fields, requester, now);
  return {
    snapshot: { ...stored, finance, auditTrail: withAudit(stored, auditEvent(requester, now, requestId, audit)) },
    targetId: arrangement.id,
    response: { arrangementId: arrangement.id, driverStaffId: arrangement.driverStaffId },
  };
};

const recordPayment = (stored, fields, requester, now, requestId) => {
  const { record, audit } = buildSalaryPaymentRecord(stored, fields, requester, now, {
    // Same rule as the other server captures: the record sorts by its own date.
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
    response: { recordId: record.id, status: record.status, period: record.salaryPayment.period },
  };
};

export const SALARY_ACTIONS = Object.freeze({
  "salary.arrangement_save": {
    roles: ["Owner", "Admin", "Manager"],
    fields: SALARY_ARRANGEMENT_FIELDS,
    parse: asHttp(parseSalaryArrangement),
    apply: asHttp(saveArrangement),
  },
  "salary.payment_record": {
    roles: ["Owner", "Admin", "Manager"],
    fields: SALARY_PAYMENT_FIELDS,
    parse: asHttp(parseSalaryPayment),
    apply: asHttp(recordPayment),
  },
});
