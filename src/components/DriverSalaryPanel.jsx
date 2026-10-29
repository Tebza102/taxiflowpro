import { useMemo, useState } from "react";
import { ArrowDownToLine, Banknote } from "lucide-react";
import {
  SALARY_FREQUENCIES,
  SALARY_FREQUENCY_LABELS,
  SALARY_SOURCE_LABELS,
  buildMonthlyExpenseReport,
  describeSalarySchedule,
  findSalaryPayment,
  formatRand,
  formatSalaryPeriod,
  getSalaryArrangements,
  getSalaryPayments,
  monthlyExpenseReportCsv,
  salaryPeriodForDate,
} from "../lib/salaryContract";

// Money > Expenses: where salary payments are recorded and reviewed (scheduled
// or manual) and the monthly expense report. Schedules are set and changed in
// the driver's profile (DriverProfileSalary); here they are shown with what is
// due. A schedule is a plan only; each payment is recorded once, as one "Salary"
// expense, when it is actually paid (rules: src/lib/salaryContract.js).

const today = () => new Date().toLocaleDateString("en-CA");
const methodLabel = (method) => (method === "bank" ? "Bank" : "Cash");

export function DriverSalaryPanel({ snapshot, canEdit, businessName, onOpenDriverSalary, onRecordPayment }) {
  const drivers = snapshot.drivers ?? [];
  const arrangements = getSalaryArrangements(snapshot);
  const payments = useMemo(
    () => [...getSalaryPayments(snapshot)].sort((a, b) => String(b.expenseDate).localeCompare(String(a.expenseDate))),
    [snapshot],
  );
  const [paymentDraft, setPaymentDraft] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reportMonth, setReportMonth] = useState(() => today().slice(0, 7));
  const report = useMemo(() => buildMonthlyExpenseReport(snapshot, reportMonth || today().slice(0, 7)), [snapshot, reportMonth]);

  const arrangementFor = (staffId) => arrangements.find((item) => item.driverStaffId === staffId) ?? null;
  const driverName = (staffId) => drivers.find((driver) => driver.staffId === staffId)?.name ?? staffId;
  const paymentSchedule = paymentDraft ? arrangementFor(paymentDraft.driverStaffId) : null;
  const scheduledPayment = Boolean(paymentSchedule && paymentSchedule.frequency === paymentDraft?.frequency);
  const duplicate = paymentDraft?.period
    ? findSalaryPayment(snapshot, paymentDraft.driverStaffId, paymentDraft.frequency, paymentDraft.period)
    : null;

  const startPayment = (arrangement, period, amount) => {
    setFeedback(null);
    setPaymentDraft({
      driverStaffId: arrangement.driverStaffId,
      frequency: arrangement.frequency,
      period,
      paidDate: today(),
      amount: String(amount ?? arrangement.amount),
      method: arrangement.payMethod,
      source: arrangement.payMethod === "bank" ? "business_bank" : "business_cash",
      reference: "",
    });
  };

  const startManualPayment = () => {
    setFeedback(null);
    const staffId = drivers[0]?.staffId ?? "";
    setPaymentDraft({
      driverStaffId: staffId,
      frequency: "daily",
      period: today(),
      paidDate: today(),
      amount: "",
      method: "cash",
      source: "business_cash",
      reference: "",
    });
  };

  const setMethod = (method) =>
    setPaymentDraft((draft) => ({
      ...draft,
      method,
      source: method === "bank" ? "business_bank" : draft.source === "driver_takings" ? "driver_takings" : "business_cash",
    }));

  const run = async (action, onDone) => {
    setSaving(true);
    try {
      const result = await action();
      setFeedback({ tone: result.ok ? "success" : "danger", message: result.ok ? result.message : result.error });
      if (result.ok) onDone?.();
    } finally {
      setSaving(false);
    }
  };

  const savePayment = (event) => {
    event.preventDefault();
    run(
      () => onRecordPayment({ ...paymentDraft, amount: Number(paymentDraft.amount) }),
      () => setPaymentDraft(null),
    );
  };

  const downloadReport = () => {
    const csv = monthlyExpenseReportCsv(report, businessName);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `taxiflow-expenses-${report.month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const periodInputType = paymentDraft?.frequency === "monthly" ? "month" : "date";
  const periodLabel = {
    daily: "Day this pay is for",
    weekly: "Week starting (Monday)",
    fortnightly: "Fortnight starting (Monday)",
    monthly: "Pay month",
  }[paymentDraft?.frequency ?? "monthly"];

  return (
    <section className="content-stack" data-testid="driver-salaries" aria-labelledby="driver-salaries-heading">
      <article className="overview-board">
        <div className="overview-board-head">
          <p className="eyebrow">Business costs</p>
          <h3 id="driver-salaries-heading">Driver salaries</h3>
        </div>
        <p className="panel-note">
          A salary schedule is a plan, not a payment. When you actually pay a driver, record the payment here: it
          is added to expenses once. Bank and business-cash payments do not change a driver's cash hand-in; a salary
          paid from a driver's takings lowers that day's cash to hand in, once.
        </p>

        {feedback && (
          <p className="finance-form-note" data-tone={feedback.tone} role="status">
            {feedback.message}
          </p>
        )}

        {arrangements.length === 0 ? (
          <p className="panel-note">
            No salary schedules yet.{canEdit ? " Set one in a driver's profile (Drivers > Edit profile), or record a manual payment." : ""}
          </p>
        ) : (
          <div className="finance-ledger">
            {arrangements.map((arrangement) => {
              const status = describeSalarySchedule(snapshot, arrangement, today());
              return (
                <article key={arrangement.id} className="ledger-row" data-testid="salary-schedule-row">
                  <div className="ledger-copy">
                    <strong>{arrangement.driverName}</strong>
                    <span>
                      {formatRand(arrangement.amount)} {arrangement.frequency} / usually {methodLabel(arrangement.payMethod)}
                      {status.active ? "" : " / paused"}
                    </span>
                    {status.active && (
                      <span data-testid="salary-next-payment">
                        Next payment: {status.next.label}, due {status.next.dueDate}, scheduled{" "}
                        {formatRand(status.next.scheduledAmount)}
                      </span>
                    )}
                  </div>
                  <div className="ledger-meta">
                    <span className="status-chip" data-tone={status.current.payment ? "success" : "info"}>
                      {status.current.label}: {status.current.payment ? "paid" : "not paid yet"}
                    </span>
                    {status.active && status.due.length > 0 && (
                      <span className="status-chip" data-tone="warning" data-testid="salary-due">
                        Due now: {status.due.length} {status.due.length === 1 ? "period" : "periods"},{" "}
                        {formatRand(status.dueAmount)}
                      </span>
                    )}
                    {canEdit && (
                      <>
                        {onOpenDriverSalary && (
                          <button
                            type="button"
                            className="action-button"
                            onClick={() => onOpenDriverSalary(arrangement.driverStaffId)}
                            aria-label={`Salary settings in ${arrangement.driverName}'s profile`}
                          >
                            Salary settings
                          </button>
                        )}
                        {status.active && (
                          <button
                            type="button"
                            className="action-button primary"
                            onClick={() => startPayment(arrangement, status.next.period, status.next.scheduledAmount)}
                          >
                            Record payment
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {canEdit && drivers.length > 0 && (
          <button type="button" className="action-button" onClick={startManualPayment}>
            Record a manual payment
          </button>
        )}
      </article>

      {canEdit && paymentDraft && (
        <form className="finance-form overview-board" onSubmit={savePayment} aria-label="Record salary payment">
          <div className="overview-board-head">
            <p className="eyebrow">{scheduledPayment ? "Record payment" : "Manual payment (no schedule needed)"}</p>
            <h3>{driverName(paymentDraft.driverStaffId)}</h3>
          </div>
          {!scheduledPayment && (
            <>
              <label className="finance-field">
                <span>Driver</span>
                <select
                  value={paymentDraft.driverStaffId}
                  onChange={(event) => setPaymentDraft((draft) => ({ ...draft, driverStaffId: event.target.value }))}
                >
                  {drivers.map((driver) => (
                    <option key={driver.staffId} value={driver.staffId}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="finance-field">
                <span>Pay frequency</span>
                <select
                  value={paymentDraft.frequency}
                  onChange={(event) => {
                    const frequency = event.target.value;
                    setPaymentDraft((draft) => ({ ...draft, frequency, period: salaryPeriodForDate(frequency, today()) }));
                  }}
                >
                  {SALARY_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {SALARY_FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="finance-field">
            <span>{periodLabel}</span>
            <input
              type={periodInputType}
              value={paymentDraft.period ?? ""}
              onChange={(event) => setPaymentDraft((draft) => ({ ...draft, period: event.target.value }))}
              required
            />
          </label>
          <label className="finance-field">
            <span>Date paid</span>
            <input
              type="date"
              value={paymentDraft.paidDate}
              onChange={(event) => setPaymentDraft((draft) => ({ ...draft, paidDate: event.target.value }))}
              required
            />
          </label>
          <label className="finance-field">
            <span>Amount paid (R)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={paymentDraft.amount}
              onChange={(event) => setPaymentDraft((draft) => ({ ...draft, amount: event.target.value }))}
              required
            />
          </label>
          <fieldset className="finance-field">
            <legend>Paid by</legend>
            {["bank", "cash"].map((method) => (
              <label key={method} className="salary-choice">
                <input
                  type="radio"
                  name="salary-method"
                  value={method}
                  checked={paymentDraft.method === method}
                  onChange={() => setMethod(method)}
                />
                {method === "bank" ? "Bank transfer" : "Cash"}
              </label>
            ))}
          </fieldset>
          <fieldset className="finance-field">
            <legend>Paid from</legend>
            {(paymentDraft.method === "bank" ? ["business_bank"] : ["business_cash", "driver_takings"]).map((source) => (
              <label key={source} className="salary-choice">
                <input
                  type="radio"
                  name="salary-source"
                  value={source}
                  checked={paymentDraft.source === source}
                  onChange={() => setPaymentDraft((draft) => ({ ...draft, source }))}
                />
                {SALARY_SOURCE_LABELS[source]}
              </label>
            ))}
          </fieldset>
          {paymentDraft.source === "driver_takings" && (
            <p className="finance-form-note" data-tone="warning" data-testid="salary-takings-note">
              This lowers {driverName(paymentDraft.driverStaffId)}'s cash to hand in for {paymentDraft.paidDate} by the
              amount paid, once. It goes through that day's checking, so the day must not be counted yet.
            </p>
          )}
          <label className="finance-field">
            <span>Payment reference (optional)</span>
            <input
              value={paymentDraft.reference}
              onChange={(event) => setPaymentDraft((draft) => ({ ...draft, reference: event.target.value }))}
            />
          </label>
          {scheduledPayment && Number(paymentDraft.amount) > 0 && Number(paymentDraft.amount) !== paymentSchedule.amount && (
            <p className="finance-form-note" data-tone="info">
              The schedule says {formatRand(paymentSchedule.amount)}. The amount you enter is what is recorded as paid.
            </p>
          )}
          {duplicate ? (
            <p className="finance-form-note" data-tone="warning" data-testid="salary-duplicate-warning">
              Already recorded: {driverName(paymentDraft.driverStaffId)}'s salary for{" "}
              {formatSalaryPeriod(paymentDraft.frequency, paymentDraft.period)} was paid on {duplicate.expenseDate} (
              {formatRand(duplicate.amount)}). Recording it again would count the expense twice, so it is blocked. If that
              payment was wrong, correct it before recording a new one.
            </p>
          ) : null}
          <div className="sheet-action-row">
            <button type="button" className="action-button" onClick={() => setPaymentDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="action-button primary" disabled={saving || Boolean(duplicate)}>
              <Banknote size={16} aria-hidden="true" />
              {saving ? "Saving..." : "Record payment"}
            </button>
          </div>
        </form>
      )}

      {canEdit && onOpenDriverSalary && drivers.length > 0 && (
        <p className="finance-form-note" data-tone="info" data-testid="salary-settings-pointer">
          Salary amounts, frequency, timing and pausing are set in each driver's profile.{" "}
          <button type="button" className="cta-link" onClick={() => onOpenDriverSalary(drivers[0].staffId)}>
            Open a driver profile
          </button>
        </p>
      )}

      {payments.length > 0 && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">History</p>
            <h3>Salary payments</h3>
          </div>
          <div className="finance-ledger">
            {payments.slice(0, 10).map((record) => (
              <article key={record.id} className="ledger-row" data-testid="salary-payment-row">
                <div className="ledger-copy">
                  <strong>
                    {record.salaryPayment.driverName} / {record.salaryPayment.periodLabel ?? record.salaryPayment.period}
                  </strong>
                  <span>
                    Paid {record.expenseDate} by {methodLabel(record.salaryPayment.method)} from{" "}
                    {(SALARY_SOURCE_LABELS[record.salaryPayment.source] ?? "").toLowerCase()}
                    {record.salaryPayment.manual ? " / manual" : ""}
                    {record.reference ? ` / Ref ${record.reference}` : ""}
                  </span>
                </div>
                <div className="ledger-meta">
                  <strong>{formatRand(record.amount)}</strong>
                  {record.salaryPayment.scheduledAmount != null && record.amount !== record.salaryPayment.scheduledAmount && (
                    <span>Scheduled {formatRand(record.salaryPayment.scheduledAmount)}</span>
                  )}
                  <span className="status-chip" data-tone={record.status === "pending" ? "info" : "success"}>
                    {record.status}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </article>
      )}

      <article className="overview-board" data-testid="expense-report">
        <div className="overview-board-head">
          <p className="eyebrow">Download</p>
          <h3>Monthly expense report</h3>
        </div>
        <label className="finance-field">
          <span>Month</span>
          <input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
        </label>
        <div className="finance-form-meta">
          <span className="status-chip" data-tone="info">Salaries {formatRand(report.totals.salaries)}</span>
          <span className="status-chip" data-tone="info">Other expenses {formatRand(report.totals.otherExpenses)}</span>
          <span className="status-chip" data-tone="navy" data-testid="expense-report-total">
            Total {formatRand(report.totals.expenses)}
          </span>
        </div>
        <button type="button" className="action-button" onClick={downloadReport} disabled={!reportMonth}>
          <ArrowDownToLine size={16} aria-hidden="true" />
          Download expense report (CSV)
        </button>
      </article>
    </section>
  );
}
