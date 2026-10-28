import { useMemo, useState } from "react";
import { ArrowDownToLine, Banknote } from "lucide-react";
import {
  SALARY_METHODS,
  buildMonthlyExpenseReport,
  findSalaryPayment,
  formatSalaryPeriod,
  getSalaryArrangements,
  getSalaryPayments,
  monthlyExpenseReportCsv,
  salaryPeriodForDate,
} from "../lib/salaryContract";

// Money > Expenses: driver salary schedules, salary payments and the monthly
// expense report. A schedule is a plan only; each payment is recorded once, as
// one "Salary" expense, when it is actually paid (rules: src/lib/salaryContract.js).

const today = () => new Date().toLocaleDateString("en-CA");
const rand = (amount) =>
  `R ${Number(amount ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const methodLabel = (method) => (method === "bank" ? "Bank" : "Cash");

const emptySchedule = (driverStaffId = "") => ({
  driverStaffId,
  amount: "",
  frequency: "monthly",
  payMethod: "bank",
  startDate: today(),
  active: true,
});

export function DriverSalaryPanel({ snapshot, canEdit, businessName, onSaveArrangement, onRecordPayment }) {
  const drivers = snapshot.drivers ?? [];
  const arrangements = getSalaryArrangements(snapshot);
  const payments = useMemo(
    () => [...getSalaryPayments(snapshot)].sort((a, b) => String(b.expenseDate).localeCompare(String(a.expenseDate))),
    [snapshot],
  );
  const [scheduleDraft, setScheduleDraft] = useState(() => emptySchedule(drivers[0]?.staffId ?? ""));
  const [paymentDraft, setPaymentDraft] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reportMonth, setReportMonth] = useState(() => today().slice(0, 7));
  const report = useMemo(() => buildMonthlyExpenseReport(snapshot, reportMonth || today().slice(0, 7)), [snapshot, reportMonth]);

  const arrangementFor = (staffId) => arrangements.find((item) => item.driverStaffId === staffId) ?? null;
  const paymentArrangement = paymentDraft ? arrangementFor(paymentDraft.driverStaffId) : null;
  const duplicate = paymentDraft ? findSalaryPayment(snapshot, paymentDraft.driverStaffId, paymentDraft.period) : null;

  const editSchedule = (arrangement) => {
    setPaymentDraft(null);
    setScheduleDraft({
      driverStaffId: arrangement.driverStaffId,
      amount: String(arrangement.amount),
      frequency: arrangement.frequency,
      payMethod: arrangement.payMethod,
      startDate: arrangement.startDate,
      active: arrangement.active !== false,
    });
  };

  const startPayment = (arrangement) => {
    setFeedback(null);
    setPaymentDraft({
      driverStaffId: arrangement.driverStaffId,
      period: salaryPeriodForDate(arrangement.frequency, today()),
      paidDate: today(),
      amount: String(arrangement.amount),
      method: arrangement.payMethod,
      reference: "",
    });
  };

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

  const saveSchedule = (event) => {
    event.preventDefault();
    run(
      () => onSaveArrangement({ ...scheduleDraft, amount: Number(scheduleDraft.amount) }),
    );
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

  return (
    <section className="content-stack" data-testid="driver-salaries" aria-labelledby="driver-salaries-heading">
      <article className="overview-board">
        <div className="overview-board-head">
          <p className="eyebrow">Business costs</p>
          <h3 id="driver-salaries-heading">Driver salaries</h3>
        </div>
        <p className="panel-note">
          A salary schedule is a plan, not a payment. When you actually pay a driver, record the payment
          here: it is added to expenses once. Salaries never change a driver's cash hand-in.
        </p>

        {feedback && (
          <p className="finance-form-note" data-tone={feedback.tone} role="status">
            {feedback.message}
          </p>
        )}

        {arrangements.length === 0 ? (
          <p className="panel-note">No salary schedules yet.{canEdit ? " Set one below." : ""}</p>
        ) : (
          <div className="finance-ledger">
            {arrangements.map((arrangement) => {
              const currentPeriod = salaryPeriodForDate(arrangement.frequency, today());
              const paidNow = findSalaryPayment(snapshot, arrangement.driverStaffId, currentPeriod);
              return (
                <article key={arrangement.id} className="ledger-row" data-testid="salary-schedule-row">
                  <div className="ledger-copy">
                    <strong>{arrangement.driverName}</strong>
                    <span>
                      {rand(arrangement.amount)} {arrangement.frequency} / usually {methodLabel(arrangement.payMethod)}
                      {arrangement.active === false ? " / paused" : ""}
                    </span>
                  </div>
                  <div className="ledger-meta">
                    <span className="status-chip" data-tone={paidNow ? "success" : "info"}>
                      {formatSalaryPeriod(arrangement.frequency, currentPeriod)}: {paidNow ? "paid" : "not paid yet"}
                    </span>
                    {canEdit && (
                      <>
                        <button type="button" className="action-button" onClick={() => editSchedule(arrangement)}>
                          Change schedule
                        </button>
                        {arrangement.active !== false && (
                          <button type="button" className="action-button primary" onClick={() => startPayment(arrangement)}>
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
      </article>

      {canEdit && paymentDraft && paymentArrangement && (
        <form className="finance-form overview-board" onSubmit={savePayment} aria-label="Record salary payment">
          <div className="overview-board-head">
            <p className="eyebrow">Record payment</p>
            <h3>{paymentArrangement.driverName}</h3>
          </div>
          <label className="finance-field">
            <span>{paymentArrangement.frequency === "monthly" ? "Pay month" : "Week starting (Monday)"}</span>
            <input
              type={paymentArrangement.frequency === "monthly" ? "month" : "date"}
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
            {SALARY_METHODS.map((method) => (
              <label key={method} className="salary-choice">
                <input
                  type="radio"
                  name="salary-method"
                  value={method}
                  checked={paymentDraft.method === method}
                  onChange={() => setPaymentDraft((draft) => ({ ...draft, method }))}
                />
                {method === "bank" ? "Bank transfer" : "Cash from the business"}
              </label>
            ))}
          </fieldset>
          <label className="finance-field">
            <span>Payment reference (optional)</span>
            <input
              value={paymentDraft.reference}
              onChange={(event) => setPaymentDraft((draft) => ({ ...draft, reference: event.target.value }))}
            />
          </label>
          {Number(paymentDraft.amount) > 0 && Number(paymentDraft.amount) !== paymentArrangement.amount && (
            <p className="finance-form-note" data-tone="info">
              The schedule says {rand(paymentArrangement.amount)}. The amount you enter is what is recorded as paid.
            </p>
          )}
          {duplicate ? (
            <p className="finance-form-note" data-tone="warning" data-testid="salary-duplicate-warning">
              Already recorded: {paymentArrangement.driverName}'s salary for{" "}
              {formatSalaryPeriod(paymentArrangement.frequency, paymentDraft.period)} was paid on {duplicate.expenseDate} (
              {rand(duplicate.amount)}). Recording it again would count the expense twice, so it is blocked. If that
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

      {canEdit && (
        <form className="finance-form overview-board" onSubmit={saveSchedule} aria-label="Salary schedule">
          <div className="overview-board-head">
            <p className="eyebrow">Salary schedule</p>
            <h3>{arrangementFor(scheduleDraft.driverStaffId) ? "Change a schedule" : "Set a schedule"}</h3>
          </div>
          <label className="finance-field">
            <span>Driver</span>
            <select
              value={scheduleDraft.driverStaffId}
              onChange={(event) => {
                const existing = arrangementFor(event.target.value);
                if (existing) editSchedule(existing);
                else setScheduleDraft(emptySchedule(event.target.value));
              }}
              required
            >
              {drivers.map((driver) => (
                <option key={driver.staffId} value={driver.staffId}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-field">
            <span>Salary amount (R)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={scheduleDraft.amount}
              onChange={(event) => setScheduleDraft((draft) => ({ ...draft, amount: event.target.value }))}
              required
            />
          </label>
          <label className="finance-field">
            <span>How often</span>
            <select
              value={scheduleDraft.frequency}
              onChange={(event) => setScheduleDraft((draft) => ({ ...draft, frequency: event.target.value }))}
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label className="finance-field">
            <span>Usually paid by</span>
            <select
              value={scheduleDraft.payMethod}
              onChange={(event) => setScheduleDraft((draft) => ({ ...draft, payMethod: event.target.value }))}
            >
              <option value="bank">Bank transfer</option>
              <option value="cash">Cash from the business</option>
            </select>
          </label>
          <label className="finance-field">
            <span>Starts on</span>
            <input
              type="date"
              value={scheduleDraft.startDate}
              onChange={(event) => setScheduleDraft((draft) => ({ ...draft, startDate: event.target.value }))}
              required
            />
          </label>
          <label className="salary-choice">
            <input
              type="checkbox"
              checked={scheduleDraft.active}
              onChange={(event) => setScheduleDraft((draft) => ({ ...draft, active: event.target.checked }))}
            />
            Schedule is active
          </label>
          <p className="finance-form-note" data-tone="info">
            Saving a schedule does not add an expense. Past payments keep the amount they were paid.
          </p>
          <button type="submit" className="action-button primary" disabled={saving || drivers.length === 0}>
            {saving ? "Saving..." : "Save schedule"}
          </button>
        </form>
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
                    Paid {record.expenseDate} by {methodLabel(record.salaryPayment.method)}
                    {record.reference ? ` / Ref ${record.reference}` : ""}
                  </span>
                </div>
                <div className="ledger-meta">
                  <strong>{rand(record.amount)}</strong>
                  {record.amount !== record.salaryPayment.scheduledAmount && (
                    <span>Scheduled {rand(record.salaryPayment.scheduledAmount)}</span>
                  )}
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
          <span className="status-chip" data-tone="info">Salaries {rand(report.totals.salaries)}</span>
          <span className="status-chip" data-tone="info">Other expenses {rand(report.totals.otherExpenses)}</span>
          <span className="status-chip" data-tone="navy" data-testid="expense-report-total">
            Total {rand(report.totals.expenses)}
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
