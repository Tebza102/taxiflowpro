import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";

import {
  RECURRING_FREQUENCIES,
  RECURRING_FREQUENCY_LABELS,
  RECURRING_OCCURRENCE_LABELS,
  describeRecurringExpense,
  getRecurringExpenses,
  recurringRevision,
  recurringVersionFor,
} from "../lib/recurringExpenseContract";
import { SALARY_SOURCE_LABELS, formatRand } from "../lib/salaryContract";

// Money > Expenses > Recurring fixed expenses. A schedule is a plan, not a
// payment: what is due or overdue is worked out from the schedule each time
// TaxiFlow opens (no background process), and an expense exists only once a
// payment is recorded here (rules: src/lib/recurringExpenseContract.js).

const today = () => new Date().toLocaleDateString("en-CA");
const STATUS_TONE = { paid: "success", due: "warning", overdue: "danger", upcoming: "info" };
const SCHEDULE_TONE = { active: "success", paused: "warning", stopped: "neutral" };
const SCHEDULE_LABEL = { active: "Active", paused: "Paused", stopped: "Stopped" };

const emptyForm = () => ({
  scheduleId: null,
  description: "",
  category: "",
  amount: "",
  vehicleId: "",
  frequency: "monthly",
  startDate: today(),
  endDate: "",
  payMethod: "bank",
  effectiveFrom: today(),
  revision: null,
});

export function RecurringExpensesPanel({ snapshot, canEdit, onSaveSchedule, onChangeStatus, onRecordPayment }) {
  const schedules = getRecurringExpenses(snapshot);
  const vehicles = snapshot.vehicles ?? [];
  const drivers = (snapshot.drivers ?? []).filter((driver) => driver.role === "Driver" || !driver.role);
  const categories = useMemo(
    () => {
      // expenseCatalog is { asset: [...], operational: [...] } of names or { name/category } entries.
      const catalog = Object.values(snapshot.finance?.expenseCatalog ?? {}).filter(Array.isArray).flat();
      const names = catalog.map((item) => (typeof item === "string" ? item : item?.category ?? item?.name ?? item?.label));
      return [...new Set([...names, "Rent", "Insurance", "Tracking", "Licences", "Loan repayment"].map((value) => String(value ?? "").trim()).filter(Boolean))];
    },
    [snapshot],
  );
  const [form, setForm] = useState(null);
  const [payment, setPayment] = useState(null);
  const [stopping, setStopping] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const day = today();

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

  const editSchedule = (schedule) => {
    const current = recurringVersionFor(schedule, day);
    setPayment(null);
    setForm({
      scheduleId: schedule.id,
      description: current.description,
      category: current.category,
      amount: String(current.amount),
      vehicleId: current.vehicleId ?? "",
      frequency: schedule.frequency,
      startDate: schedule.startDate,
      endDate: schedule.endDate ?? "",
      payMethod: schedule.payMethod ?? "bank",
      effectiveFrom: day,
      revision: recurringRevision(schedule),
    });
  };

  const saveSchedule = (event) => {
    event.preventDefault();
    const { scheduleId, effectiveFrom, revision, ...fields } = form;
    run(
      () =>
        onSaveSchedule({
          ...fields,
          amount: Number(fields.amount),
          vehicleId: fields.vehicleId || null,
          endDate: fields.endDate || null,
          ...(scheduleId ? { scheduleId, effectiveFrom, revision } : {}),
        }),
      () => setForm(null),
    );
  };

  const startPayment = (schedule, occurrence) => {
    setForm(null);
    setFeedback(null);
    setPayment({
      schedule,
      occurrence,
      fields: {
        scheduleId: schedule.id,
        period: occurrence.period,
        paidDate: day,
        amount: String(occurrence.amount),
        method: schedule.payMethod ?? "bank",
        source: (schedule.payMethod ?? "bank") === "bank" ? "business_bank" : "business_cash",
        driverStaffId: "",
        reference: "",
      },
    });
  };
  const setPaymentField = (field, value) =>
    setPayment((current) => {
      const fields = { ...current.fields, [field]: value };
      if (field === "method") fields.source = value === "bank" ? "business_bank" : fields.source === "driver_takings" ? "driver_takings" : "business_cash";
      return { ...current, fields };
    });
  const savePayment = (event) => {
    event.preventDefault();
    const { reference, driverStaffId, ...fields } = payment.fields;
    run(
      () =>
        onRecordPayment({
          ...fields,
          amount: Number(fields.amount),
          ...(fields.source === "driver_takings" ? { driverStaffId } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        }),
      () => setPayment(null),
    );
  };

  const changeStatus = (schedule, change, date = day) =>
    run(() => onChangeStatus({ scheduleId: schedule.id, change, date, revision: recurringRevision(schedule) }), () => setStopping(null));

  return (
    <section className="content-stack" data-testid="recurring-expenses" aria-labelledby="recurring-expenses-heading">
      <article className="overview-board">
        <div className="overview-board-head">
          <p className="eyebrow">Business costs</p>
          <h3 id="recurring-expenses-heading">
            <Repeat size={16} aria-hidden="true" /> Recurring fixed expenses
          </h3>
        </div>
        <p className="panel-note">
          Rent, insurance, tracking and other fixed costs. A schedule is a plan, not a payment: TaxiFlow works out what is due
          or overdue each time it opens (nothing runs in the background and nothing is recorded automatically). Record each
          payment once, when it is actually paid; it is then added to expenses.
        </p>

        {feedback && (
          <p className="finance-form-note" data-tone={feedback.tone} role="status" data-testid="recurring-feedback">
            {feedback.message}
          </p>
        )}

        {schedules.length === 0 ? (
          <p className="panel-note">No recurring expenses yet.</p>
        ) : (
          <div className="finance-ledger">
            {schedules.map((schedule) => {
              const state = describeRecurringExpense(snapshot, schedule, day);
              const current = recurringVersionFor(schedule, day);
              const status = schedule.status ?? "active";
              const shown = [...state.outstanding, ...state.recentPaid.slice(-3)].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
              return (
                <article key={schedule.id} className="ledger-row recurring-row" data-testid="recurring-row" data-schedule-id={schedule.id}>
                  <div className="ledger-copy">
                    <strong>{current.description}</strong>
                    <span>
                      {formatRand(current.amount)} {RECURRING_FREQUENCY_LABELS[schedule.frequency].toLowerCase()} / {current.category} /{" "}
                      {current.vehicleId ? current.vehicle : "Business-wide"}
                    </span>
                    <span data-testid="recurring-next">
                      {status === "stopped"
                        ? `Stopped${schedule.endDate ? `; last due ${schedule.endDate}` : ""}`
                        : status === "paused"
                          ? "Paused: nothing falls due until it is resumed"
                          : state.nextDue
                            ? `Next due: ${state.nextDue.dueDate} (${state.nextDue.periodLabel}), ${formatRand(state.nextDue.amount)}`
                            : schedule.endDate
                              ? `No more due dates (ends ${schedule.endDate})`
                              : ""}
                    </span>
                    <ul className="recurring-occurrences" aria-label={`${current.description} occurrences`}>
                      {shown.map((occurrence) => (
                        <li key={occurrence.period} data-testid="recurring-occurrence" data-status={occurrence.status}>
                          <span className="status-chip" data-tone={STATUS_TONE[occurrence.status]}>
                            {RECURRING_OCCURRENCE_LABELS[occurrence.status]}
                          </span>{" "}
                          {occurrence.dueDate} / {occurrence.periodLabel} /{" "}
                          {occurrence.payment
                            ? `${formatRand(occurrence.payment.amount)} paid ${occurrence.payment.expenseDate}`
                            : formatRand(occurrence.amount)}
                          {canEdit && !occurrence.payment && (
                            <button type="button" className="cta-link" onClick={() => startPayment(schedule, occurrence)}>
                              Record payment
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {state.truncated && <span>Only the first 800 occurrences are shown.</span>}
                  </div>
                  <div className="ledger-meta">
                    <span className="status-chip" data-tone={SCHEDULE_TONE[status]} data-testid="recurring-status">
                      {SCHEDULE_LABEL[status]}
                    </span>
                    {state.overdue.length > 0 && (
                      <span className="status-chip" data-tone="danger" data-testid="recurring-overdue">
                        Overdue: {state.overdue.length}, {formatRand(state.overdue.reduce((sum, item) => sum + Number(item.amount ?? 0), 0))}
                      </span>
                    )}
                    {canEdit && status !== "stopped" && (
                      <>
                        <button type="button" className="action-button" onClick={() => editSchedule(schedule)}>
                          Edit future
                        </button>
                        {status === "active" ? (
                          <button type="button" className="action-button" disabled={saving} onClick={() => changeStatus(schedule, "pause")}>
                            Pause
                          </button>
                        ) : (
                          <button type="button" className="action-button" disabled={saving} onClick={() => changeStatus(schedule, "resume")}>
                            Resume
                          </button>
                        )}
                        <button type="button" className="action-button" onClick={() => setStopping({ schedule, date: day })}>
                          Stop
                        </button>
                      </>
                    )}
                  </div>
                  {stopping?.schedule.id === schedule.id && (
                    <div className="finance-form recurring-stop" role="group" aria-label={`Stop ${current.description}`}>
                      <label className="finance-field">
                        <span>Last due date to keep</span>
                        <input type="date" value={stopping.date} onChange={(event) => setStopping({ ...stopping, date: event.target.value })} />
                      </label>
                      <p className="finance-form-note" data-tone="info">
                        Nothing falls due after this date. Recorded payments and the schedule's history stay.
                      </p>
                      <div className="finance-form-actions">
                        <button type="button" className="action-button primary" disabled={saving} onClick={() => changeStatus(schedule, "stop", stopping.date)}>
                          Stop schedule
                        </button>
                        <button type="button" className="action-button" onClick={() => setStopping(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {canEdit && !form && (
          <button type="button" className="action-button" onClick={() => { setPayment(null); setForm(emptyForm()); }}>
            Add recurring expense
          </button>
        )}
      </article>

      {canEdit && payment && (
        <form className="finance-form overview-board" onSubmit={savePayment} aria-label="Record recurring expense payment">
          <div className="overview-board-head">
            <p className="eyebrow">Record payment</p>
            <h3>
              {payment.occurrence.description} / {payment.occurrence.periodLabel}
            </h3>
          </div>
          <p className="finance-form-note" data-tone="info">
            Due {payment.occurrence.dueDate}, scheduled {formatRand(payment.occurrence.amount)}
            {payment.occurrence.vehicleId ? ` for ${payment.occurrence.vehicle}` : " (business-wide)"}. Change the amount if a different amount was paid.
          </p>
          <label className="finance-field">
            <span>Date paid</span>
            <input type="date" value={payment.fields.paidDate} onChange={(event) => setPaymentField("paidDate", event.target.value)} required />
          </label>
          <label className="finance-field">
            <span>Amount paid (R)</span>
            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={payment.fields.amount} onChange={(event) => setPaymentField("amount", event.target.value)} required />
          </label>
          <fieldset className="finance-field">
            <legend>How it was paid</legend>
            {[["bank", "Bank transfer or card"], ["cash", "Cash"]].map(([value, label]) => (
              <label key={value} className="salary-choice">
                <input type="radio" name="recurring-method" checked={payment.fields.method === value} onChange={() => setPaymentField("method", value)} />
                {label}
              </label>
            ))}
          </fieldset>
          {payment.fields.method === "cash" && (
            <fieldset className="finance-field">
              <legend>Where the cash came from</legend>
              {["business_cash", "driver_takings"].map((value) => (
                <label key={value} className="salary-choice">
                  <input type="radio" name="recurring-source" checked={payment.fields.source === value} onChange={() => setPaymentField("source", value)} />
                  {SALARY_SOURCE_LABELS[value]}
                </label>
              ))}
            </fieldset>
          )}
          {payment.fields.source === "driver_takings" && (
            <>
              <label className="finance-field">
                <span>Whose takings</span>
                <select value={payment.fields.driverStaffId} onChange={(event) => setPaymentField("driverStaffId", event.target.value)} required>
                  <option value="">Choose the driver</option>
                  {drivers.map((driver) => (
                    <option key={driver.staffId} value={driver.staffId}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="finance-form-note" data-tone="warning" data-testid="recurring-takings-note">
                This lowers that driver's cash to hand in for {payment.fields.paidDate}, once, and waits for that day's checking. A
                day already counted, verified or banked cannot take it.
              </p>
            </>
          )}
          <label className="finance-field">
            <span>Reference (optional)</span>
            <input type="text" maxLength={200} value={payment.fields.reference} onChange={(event) => setPaymentField("reference", event.target.value)} />
          </label>
          <div className="finance-form-actions">
            <button type="submit" className="action-button primary" disabled={saving}>
              {saving ? "Saving..." : "Record payment"}
            </button>
            <button type="button" className="action-button" onClick={() => setPayment(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {canEdit && form && (
        <form className="finance-form overview-board" onSubmit={saveSchedule} aria-label="Recurring expense schedule">
          <div className="overview-board-head">
            <p className="eyebrow">Recurring expense</p>
            <h3>{form.scheduleId ? "Change future occurrences" : "Add a recurring expense"}</h3>
          </div>
          <label className="finance-field">
            <span>Description</span>
            <input type="text" maxLength={120} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
          </label>
          <label className="finance-field">
            <span>Category</span>
            <input type="text" list="recurring-categories" maxLength={60} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required />
            <datalist id="recurring-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>
          <label className="finance-field">
            <span>Amount (R)</span>
            <input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required />
          </label>
          <label className="finance-field">
            <span>Applies to</span>
            <select value={form.vehicleId} onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}>
              <option value="">Business-wide (no vehicle)</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration ?? vehicle.id}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-field">
            <span>How often</span>
            <select value={form.frequency} disabled={Boolean(form.scheduleId)} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
              {RECURRING_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {RECURRING_FREQUENCY_LABELS[frequency]}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-field">
            <span>First due date</span>
            <input type="date" value={form.startDate} disabled={Boolean(form.scheduleId)} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required />
          </label>
          <label className="finance-field">
            <span>End date (optional)</span>
            <input type="date" value={form.endDate} min={form.startDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
          </label>
          <label className="finance-field">
            <span>Usually paid by</span>
            <select value={form.payMethod} onChange={(event) => setForm({ ...form, payMethod: event.target.value })}>
              <option value="bank">Bank transfer or card</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          {form.scheduleId && (
            <label className="finance-field">
              <span>Changes apply from</span>
              <input type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} required />
            </label>
          )}
          <p className="finance-form-note" data-tone="info">
            {form.scheduleId
              ? "Occurrences due from this date use the new details; earlier ones and every recorded payment keep theirs. To change how often or the first due date, stop this schedule and add a new one."
              : "A monthly expense keeps the first due date's day of the month; in shorter months it falls on the last day. Saving adds no expense."}
          </p>
          <div className="finance-form-actions">
            <button type="submit" className="action-button primary" disabled={saving}>
              {saving ? "Saving..." : form.scheduleId ? "Save changes" : "Save schedule"}
            </button>
            <button type="button" className="action-button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
