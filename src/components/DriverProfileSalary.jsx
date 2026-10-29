import { Banknote } from "lucide-react";

import {
  SALARY_FREQUENCIES,
  SALARY_FREQUENCY_LABELS,
  SALARY_PAY_TIMINGS,
  SALARY_PAY_TIMING_LABELS,
  describeSalarySchedule,
  formatRand,
  salaryArrangementRevision,
} from "../lib/salaryContract";

// Driver profile > Salary: the place to set or change a driver's salary
// schedule. It edits the one salary arrangement (finance.salaryArrangements via
// salary.arrangement_save); it never records a payment. Payments are recorded
// and reviewed in Money > Expenses > Driver salaries.

const today = () => new Date().toLocaleDateString("en-CA");

export const createSalaryDraft = (arrangement) =>
  arrangement
    ? {
        enabled: true,
        amount: String(arrangement.amount),
        frequency: arrangement.frequency,
        payMethod: arrangement.payMethod,
        payTiming: arrangement.payTiming ?? "end",
        effectiveDate: today(),
        active: arrangement.active !== false,
        revision: salaryArrangementRevision(arrangement),
      }
    : { enabled: false, amount: "", frequency: "monthly", payMethod: "bank", payTiming: "end", effectiveDate: today(), active: true, revision: null };

// Fields for salary.arrangement_save, or null when nothing should be saved.
export const salaryFieldsFromDraft = (draft, arrangement, driverStaffId) => {
  if (!draft?.enabled) return null;
  const fields = {
    driverStaffId,
    amount: Number(draft.amount),
    frequency: draft.frequency,
    payMethod: draft.payMethod,
    payTiming: draft.payTiming,
    active: draft.active,
  };
  if (!arrangement) return { ...fields, startDate: draft.effectiveDate };
  const unchanged =
    Number(arrangement.amount) === fields.amount &&
    arrangement.frequency === fields.frequency &&
    arrangement.payMethod === fields.payMethod &&
    (arrangement.payTiming ?? "end") === fields.payTiming &&
    (arrangement.active !== false) === fields.active;
  if (unchanged) return null;
  return { ...fields, startDate: arrangement.startDate, effectiveFrom: draft.effectiveDate, revision: draft.revision };
};

export function DriverProfileSalary({ snapshot, arrangement, draft, onChange, onOpenPayments, disabled = false }) {
  const set = (field) => (event) =>
    onChange({ ...draft, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value });
  const status = arrangement ? describeSalarySchedule(snapshot, arrangement, today()) : null;
  const history = [...(arrangement?.amountHistory ?? [])].sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));

  return (
    <fieldset className="driver-salary-settings finance-field-wide" id="driver-profile-salary" data-testid="driver-profile-salary">
      <legend>
        <Banknote size={16} aria-hidden="true" /> Salary
      </legend>

      {arrangement ? (
        <div className="driver-salary-current" data-testid="driver-profile-salary-current">
          <strong>
            {formatRand(arrangement.amount)} {SALARY_FREQUENCY_LABELS[arrangement.frequency]?.toLowerCase()},{" "}
            {SALARY_PAY_TIMING_LABELS[arrangement.payTiming ?? "end"].toLowerCase()}
          </strong>
          <span>
            {arrangement.active === false ? "Paused" : "Active"} / usually {arrangement.payMethod === "bank" ? "bank transfer" : "cash"} / since{" "}
            {arrangement.startDate}
          </span>
          {status?.active && (
            <span>
              Next payment: {status.next.label}, due {status.next.dueDate}, {formatRand(status.next.scheduledAmount)}
              {status.due.length > 0 ? ` / due now: ${status.due.length}, ${formatRand(status.dueAmount)}` : ""}
            </span>
          )}
          {history.length > 0 && (
            <details>
              <summary>Amount history ({history.length})</summary>
              <ul data-testid="driver-profile-salary-history">
                {history.map((entry, index) => (
                  <li key={`${entry.effectiveFrom}-${index}`}>
                    From {entry.effectiveFrom}: {formatRand(entry.amount)} {entry.frequency ?? arrangement.frequency}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <label className="salary-choice">
          <input type="checkbox" checked={draft.enabled} onChange={set("enabled")} disabled={disabled} data-testid="driver-profile-salary-enable" />
          Set a salary for this driver (optional)
        </label>
      )}

      {draft.enabled && (
        <div className="finance-form-grid driver-salary-fields">
          <label className="finance-field">
            <span>Salary amount (R)</span>
            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount} onChange={set("amount")} disabled={disabled} required />
          </label>
          <label className="finance-field">
            <span>How often</span>
            <select value={draft.frequency} onChange={set("frequency")} disabled={disabled}>
              {SALARY_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {SALARY_FREQUENCY_LABELS[frequency]}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-field">
            <span>{arrangement ? "Changes apply from" : "Salary starts on"}</span>
            <input type="date" value={draft.effectiveDate} onChange={set("effectiveDate")} disabled={disabled} required />
          </label>
          <label className="finance-field">
            <span>When it is paid</span>
            <select value={draft.payTiming} onChange={set("payTiming")} disabled={disabled}>
              {SALARY_PAY_TIMINGS.map((timing) => (
                <option key={timing} value={timing}>
                  {SALARY_PAY_TIMING_LABELS[timing]}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-field">
            <span>Usually paid by</span>
            <select value={draft.payMethod} onChange={set("payMethod")} disabled={disabled}>
              <option value="bank">Bank transfer</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <label className="finance-field">
            <span>Status</span>
            <select value={draft.active ? "active" : "paused"} onChange={(event) => onChange({ ...draft, active: event.target.value === "active" })} disabled={disabled}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
        </div>
      )}

      <p className="finance-form-note" data-tone="info">
        Saving the profile or the salary never records a payment. Earlier amounts and their dates are kept.
        {onOpenPayments ? " " : ""}
        {onOpenPayments && (
          <button type="button" className="cta-link" onClick={onOpenPayments} data-testid="driver-profile-salary-payments">
            Record or review salary payments in Money
          </button>
        )}
      </p>
    </fieldset>
  );
}
