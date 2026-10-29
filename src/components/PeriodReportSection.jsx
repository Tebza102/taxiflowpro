import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BarChart3, Loader2 } from "lucide-react";

import { REPORT_PERIOD_LABELS, REPORT_PERIODS, REPORT_STATUS_LABELS, reportDateOf, sastDateOf } from "../lib/periodReport";

// Reports > Business and vehicle reports. The browser only collects the filters;
// the server builds the report (after its own access check) and the screen, the
// CSV and the PDF are all that one server report for the filters last applied.

const ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const rand = (cents) => ZAR.format((cents ?? 0) / 100);

const describeError = (status, message) => {
  if (status === 401) return "Your session has expired. Sign in again to use reports.";
  if (status === 403) return "Your role does not have access to management reports.";
  if ((status === 400 || status === 404) && message) return message;
  return "The report could not be prepared. Check your connection and try again.";
};

const filenameOf = (response, fallback) =>
  /filename="([^"]+)"/i.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;

const toQuery = (filters) => {
  const params = new URLSearchParams({ scope: filters.scope, period: filters.period });
  if (filters.scope === "vehicle") params.set("vehicle", filters.vehicleId);
  if (filters.period === "custom") {
    params.set("start", filters.start);
    params.set("end", filters.end);
  } else if (filters.period === "monthly") params.set("month", filters.month);
  else params.set("date", filters.date);
  return params.toString();
};

const Table = ({ caption, columns, rows, empty = "None in this period.", testId }) => (
  <div className="period-report-table-wrap" data-testid={testId}>
    <table className="period-report-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.label} scope="col" data-align={column.align}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} data-align={columns[cellIndex].align}>
                  {cell}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const Stat = ({ label, value, testId, tone }) => (
  <div className="info-pair" data-testid={testId} data-tone={tone}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export function PeriodReportSection({ snapshot, accessToken, isDemo, modeQuery }) {
  const vehicles = useMemo(
    () => [...(snapshot?.vehicles ?? [])].sort((a, b) => String(a.registration ?? "").localeCompare(String(b.registration ?? ""))),
    [snapshot],
  );
  const latestDate = useMemo(() => {
    const dates = (snapshot?.financeTransactions ?? []).map((record) => reportDateOf(record).date).filter(Boolean).sort();
    return dates.at(-1) ?? sastDateOf(new Date().toISOString());
  }, [snapshot]);

  const [filters, setFilters] = useState(() => ({
    scope: "business",
    vehicleId: vehicles[0]?.id ?? "",
    period: "monthly",
    date: latestDate,
    month: latestDate.slice(0, 7),
    start: `${latestDate.slice(0, 7)}-01`,
    end: latestDate,
  }));
  const [applied, setApplied] = useState(null);
  const [result, setResult] = useState({ status: "idle" });
  const [download, setDownload] = useState({ status: "idle" });
  const requestNumber = useRef(0);

  const set = (field) => (event) => setFilters((current) => ({ ...current, [field]: event.target.value }));
  const filtersReady =
    (filters.scope === "business" || filters.vehicleId) &&
    (filters.period === "custom" ? filters.start && filters.end : filters.period === "monthly" ? filters.month : filters.date);
  const query = filtersReady ? toQuery(filters) : null;
  const appliedQuery = applied ? toQuery(applied) : null;
  const changed = applied && query !== appliedQuery;
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  const viewReport = async (event) => {
    event.preventDefault();
    if (!query) return;
    const current = requestNumber.current + 1;
    requestNumber.current = current;
    setApplied(filters);
    setDownload({ status: "idle" });
    setResult({ status: "loading" });
    try {
      const response = await fetch(`/api/admin/reports/period?${query}&format=json&${modeQuery}`, { headers });
      const body = await response.json().catch(() => ({}));
      if (requestNumber.current !== current) return;
      setResult(response.ok ? { status: "ready", report: body } : { status: "error", message: describeError(response.status, body.error) });
    } catch {
      if (requestNumber.current === current) setResult({ status: "error", message: describeError(0) });
    }
  };

  const downloadFile = async (format) => {
    if (!appliedQuery || download.status === "loading") return;
    setDownload({ status: "loading", format });
    try {
      const response = await fetch(`/api/admin/reports/period?${appliedQuery}&format=${format}&${modeQuery}`, { headers });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setDownload({ status: "error", message: describeError(response.status, body.error) });
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameOf(response, `taxiflow-report.${format}`);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Mobile browsers read the blob after click() returns; revoke later.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownload({ status: "done", filename: link.download });
    } catch {
      setDownload({ status: "error", message: describeError(0) });
    }
  };

  const report = result.status === "ready" ? result.report : null;
  const t = report?.totals;

  return (
    <section className="period-report" aria-labelledby="period-report-title" data-testid="period-report">
      <div className="overview-board-head">
        <p className="eyebrow">Income, expenses and results</p>
        <h3 id="period-report-title">Business and vehicle reports</h3>
      </div>

      <form className="finance-form" onSubmit={viewReport} data-testid="period-report-filters">
        <fieldset className="period-report-choice">
          <legend>Scope</legend>
          {[["business", "Overall business"], ["vehicle", "Individual vehicle"]].map(([value, label]) => (
            <label key={value} className="report-record-option" data-selected={filters.scope === value}>
              <input type="radio" name="period-report-scope" value={value} checked={filters.scope === value} onChange={set("scope")} />
              <span className="report-record-main">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="finance-form-grid">
          {filters.scope === "vehicle" && (
            <label className="finance-field">
              <span>Vehicle</span>
              <select value={filters.vehicleId} onChange={set("vehicleId")} data-testid="period-report-vehicle">
                {vehicles.length === 0 && <option value="">No vehicles on file</option>}
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registration ?? vehicle.id}
                    {vehicle.archivedAt ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="finance-field">
            <span>Period</span>
            <select value={filters.period} onChange={set("period")} data-testid="period-report-period">
              {REPORT_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {REPORT_PERIOD_LABELS[period]}
                </option>
              ))}
            </select>
          </label>
          {filters.period === "monthly" && (
            <label className="finance-field">
              <span>Month</span>
              <input type="month" value={filters.month} onChange={set("month")} data-testid="period-report-month" required />
            </label>
          )}
          {(filters.period === "daily" || filters.period === "weekly") && (
            <label className="finance-field">
              <span>{filters.period === "weekly" ? "Any day in the week (Monday to Sunday)" : "Date"}</span>
              <input type="date" value={filters.date} onChange={set("date")} data-testid="period-report-date" required />
            </label>
          )}
          {filters.period === "custom" && (
            <>
              <label className="finance-field">
                <span>From</span>
                <input type="date" value={filters.start} max={filters.end || undefined} onChange={set("start")} data-testid="period-report-start" required />
              </label>
              <label className="finance-field">
                <span>To</span>
                <input type="date" value={filters.end} min={filters.start || undefined} onChange={set("end")} data-testid="period-report-end" required />
              </label>
            </>
          )}
        </div>
        <div className="finance-form-actions">
          <button className="action-button primary" type="submit" disabled={!filtersReady || result.status === "loading"} data-testid="period-report-view">
            {result.status === "loading" ? <Loader2 size={16} className="spin" /> : <BarChart3 size={16} />}
            {result.status === "loading" ? "Preparing report..." : "View report"}
          </button>
        </div>
      </form>

      {result.status === "error" && (
        <p className="finance-form-note" data-tone="danger" role="alert" data-testid="period-report-error">
          {result.message}
        </p>
      )}

      {report && (
        <div className="report-preview period-report-result" aria-live="polite" data-testid="period-report-result">
          <div className="period-report-selection" data-testid="period-report-selection">
            <p className="eyebrow">{isDemo ? "Demo data" : "Showing"}</p>
            <h3>
              {report.title}: {report.scope.label}
            </h3>
            <p>
              {report.period.kindLabel}: <strong data-testid="period-report-dates">{report.period.label}</strong>
            </p>
            <small>Generated {report.generatedAtLabel}</small>
          </div>
          {changed && (
            <p className="finance-form-note" data-tone="warning" data-testid="period-report-stale">
              You changed the filters. The report and downloads below are still for the selection shown; select View report to update them.
            </p>
          )}

          <div className="finance-form-actions period-report-downloads">
            {["pdf", "csv"].map((format) => (
              <button
                key={format}
                className="action-button primary"
                type="button"
                onClick={() => downloadFile(format)}
                disabled={download.status === "loading"}
                data-testid={`period-report-download-${format}`}
              >
                {download.status === "loading" && download.format === format ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}
                {format === "pdf" ? "Download PDF" : "Download CSV"}
              </button>
            ))}
          </div>
          {download.status === "done" && (
            <p className="finance-form-note" data-tone="success" data-testid="period-report-download-done">
              Downloaded {download.filename}
            </p>
          )}
          {download.status === "error" && (
            <p className="finance-form-note" data-tone="danger" data-testid="period-report-download-error">
              {download.message}
            </p>
          )}

          <div className="queue-stats" data-testid="period-report-summary">
            <Stat label="Income" value={rand(t.incomeCents)} testId="period-report-income" />
            <Stat label="Expenses" value={rand(t.expenseCents)} testId="period-report-expenses" />
            <Stat label={report.netLabel} value={rand(t.netCents)} testId="period-report-net" tone={t.netCents < 0 ? "danger" : undefined} />
            <Stat label="Trip income / special hires" value={`${rand(t.standardIncomeCents)} / ${rand(t.specialIncomeCents)}`} />
            {report.kind === "business" && (
              <>
                <Stat label="Vehicle expenses" value={rand(t.vehicleExpenseCents)} testId="period-report-vehicle-expenses" />
                <Stat label="Business costs without a vehicle" value={rand(t.unallocatedCents)} testId="period-report-unallocated" />
                <Stat label="Driver salaries" value={`${rand(t.salaryCents)} (${t.salaryCount})`} testId="period-report-salaries" />
                <Stat label="Salaries paid from drivers' takings" value={rand(t.salaryFromTakingsCents)} />
              </>
            )}
          </div>

          {report.kind === "vehicle" && (
            <div className="queue-stats" data-testid="period-report-vehicle-details">
              <Stat label="Vehicle" value={`${report.vehicle.registration}${report.vehicle.model ? ` / ${report.vehicle.model}` : ""}`} />
              <Stat label="Route / status" value={`${report.vehicle.route ?? "Not recorded"} / ${report.vehicle.status}`} />
              <Stat label="Trips / special hires" value={`${report.activity.trips} / ${report.activity.specialHires}`} testId="period-report-trips" />
              <Stat label="Days with income" value={report.activity.activeDays} />
              <Stat label="Distance" value={`${report.activity.distanceKm} km`} />
              <Stat label="Drivers" value={report.activity.drivers.join(", ") || "Not recorded"} />
            </div>
          )}

          <Table
            caption="Expense breakdown"
            testId="period-report-breakdown"
            columns={[{ label: "Category" }, { label: "Entries", align: "end" }, { label: "Amount", align: "end" }]}
            rows={report.expenseBreakdown.map((group) => [group.category, group.count, rand(group.amountCents)])}
          />

          {report.kind === "business" && (
            <>
              <Table
                caption="Business costs without a vehicle (not allocated to vehicles)"
                testId="period-report-unallocated-table"
                columns={[{ label: "Category" }, { label: "Entries", align: "end" }, { label: "Amount", align: "end" }]}
                rows={report.unallocatedBreakdown.map((group) => [group.category, group.count, rand(group.amountCents)])}
              />
              <Table
                caption="Driver salaries"
                columns={[{ label: "Date" }, { label: "Payment" }, { label: "Paid by / from" }, { label: "Amount", align: "end" }]}
                rows={report.salaries.map((line) => [line.date, line.description, `${line.paidBy}${line.paidFrom ? ` / ${line.paidFrom}` : ""}`, rand(line.amountCents)])}
              />
              <Table
                caption="By vehicle (own entries only)"
                testId="period-report-by-vehicle"
                columns={[{ label: "Vehicle" }, { label: "Trips", align: "end" }, { label: "Income", align: "end" }, { label: "Expenses", align: "end" }, { label: "Net", align: "end" }]}
                rows={report.vehicles.map((row) => [row.label, row.trips, rand(row.incomeCents), rand(row.expenseCents), rand(row.netCents)])}
              />
              <div className="queue-stats" data-testid="period-report-cash">
                <Stat label="Driver days checked" value={`${report.cashChecking.dayCount} (${report.cashChecking.awaitingCount} awaiting count)`} />
                <Stat label="Expected / counted cash" value={`${rand(report.cashChecking.expectedCents)} / ${rand(report.cashChecking.countedCents)}`} />
                <Stat label="Short / over" value={`${rand(report.cashChecking.shortCents)} / ${rand(report.cashChecking.overCents)}`} />
                <Stat label="Banked" value={`${rand(report.banking.depositCents)} (${report.banking.count} deposits)`} testId="period-report-banked" />
              </div>
              <Table
                caption="Banking (by deposit date)"
                columns={[{ label: "Date" }, { label: "Reference" }, { label: "Entries", align: "end" }, { label: "Deposit", align: "end" }]}
                rows={report.banking.deposits.map((deposit) => [deposit.date, deposit.reference, deposit.recordsLocked, rand(deposit.depositCents)])}
              />
            </>
          )}

          <Table
            caption="Verification status"
            columns={[{ label: "Status" }, { label: "Income", align: "end" }, { label: "Expenses", align: "end" }]}
            rows={report.verification.map((status) => [status.label, `${status.incomeCount} / ${rand(status.incomeCents)}`, `${status.expenseCount} / ${rand(status.expenseCents)}`])}
          />

          <Table
            caption={`Transactions (${report.transactions.length})`}
            testId="period-report-transactions"
            columns={[{ label: "Date" }, { label: "Type" }, { label: "Description" }, { label: "Vehicle" }, { label: "Driver" }, { label: "Status" }, { label: "Amount", align: "end" }]}
            rows={report.transactions.map((line) => [
              line.date,
              `${line.type === "income" ? "Income" : "Expense"}: ${line.category}`,
              line.description,
              line.vehicle ?? "No vehicle",
              line.driver ?? "-",
              REPORT_STATUS_LABELS[line.status],
              `${line.type === "expense" ? "-" : ""}${rand(line.amountCents)}`,
            ])}
          />

          <div className="finance-form-note" data-tone={report.reconciliation.ok ? "info" : "danger"} data-testid="period-report-notes">
            <strong>{report.reconciliation.ok ? "Totals reconcile with the lines." : "Totals do NOT reconcile; check the lines."}</strong>
            <ul>
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
