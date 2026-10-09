import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, FileText, Loader2 } from "lucide-react";

import {
  getFinanceRecordDriverName,
  getFinanceRecordDriverStaffId,
  getFinanceRecordWorkDate,
  normalizeCashUpWorkflowStatus,
} from "../lib/cashUpContract";

// Adding a report later means adding an entry here plus its own endpoint pair.
const REPORT_TEMPLATES = [
  {
    id: "daily-finance",
    label: "Daily Finance Report",
    description: "One cash-up: income, expenses, cash control, workflow and banking.",
    previewPath: (recordId) => `/api/admin/daily-log/${encodeURIComponent(recordId)}/report-view`,
    pdfPath: (recordId) => `/api/admin/daily-log/${encodeURIComponent(recordId)}/report-pdf`,
  },
];

const REPORT_ROLES = ["Owner", "Admin", "Manager"];

const STATUS_DISPLAY = {
  pending: { label: "Submitted", tone: "warning" },
  counted: { label: "Counted", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  banked: { label: "Banked", tone: "navy" },
};

const ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const formatRand = (value) => {
  if (value == null || !Number.isFinite(Number(value))) {
    return "Not recorded";
  }

  const numeric = Number(value);

  return Number.isInteger(numeric) ? ZAR.format(numeric).replace(/[,.]00$/, "") : ZAR.format(numeric);
};

const describeVariance = (cashUp) => {
  if (cashUp.cashVariance == null) {
    return cashUp.actualCashReceived == null ? "Awaiting count" : "Not recorded";
  }
  if (cashUp.cashVariance === 0) {
    return `${formatRand(0)}, matched`;
  }

  return `${formatRand(Math.abs(cashUp.cashVariance))} ${cashUp.cashVariance < 0 ? "short" : "over"}`;
};

const describeError = (status) => {
  if (status === 401) {
    return { kind: "auth", message: "Your session has expired. Sign in again to use reports." };
  }
  if (status === 403) {
    return { kind: "denied", message: "Your role does not have access to management reports." };
  }
  if (status === 404) {
    return { kind: "missing", message: "This record could not be found. It may have been removed." };
  }

  return {
    kind: "failed",
    message: "The report could not be prepared. Check your connection and try again.",
  };
};

const resolveDriverLabel = (snapshot, record) => {
  const name = getFinanceRecordDriverName(record);

  if (name) {
    return name;
  }

  const staffId = getFinanceRecordDriverStaffId(record);

  return (snapshot.drivers ?? []).find((driver) => driver.staffId === staffId)?.name ?? "Driver not recorded";
};

const getFilename = (response, fallback) => {
  const match = /filename="([^"]+)"/i.exec(response.headers.get("Content-Disposition") ?? "");

  return match?.[1] ?? fallback;
};

export function ReportsPanel({ snapshot, activeRole, canAccessReports, accessToken, backendMode }) {
  const [templateId, setTemplateId] = useState(REPORT_TEMPLATES[0].id);
  const template = REPORT_TEMPLATES.find((entry) => entry.id === templateId) ?? REPORT_TEMPLATES[0];
  const isDemo = backendMode !== "live";

  const standardRecords = useMemo(
    () =>
      (snapshot?.financeTransactions ?? []).filter(
        (record) => record.type === "income" && record.incomeKind === "standard",
      ),
    [snapshot],
  );
  const recordDates = useMemo(
    () =>
      [...new Set(standardRecords.map((record) => getFinanceRecordWorkDate(record)).filter(Boolean))].sort(
        (left, right) => right.localeCompare(left),
      ),
    [standardRecords],
  );

  const [operatingDate, setOperatingDate] = useState(() => recordDates[0] ?? "");
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState({ status: "idle" });
  const [download, setDownload] = useState({ status: "idle" });
  const [previewNonce, setPreviewNonce] = useState(0);
  const previewRequest = useRef(0);

  const recordsForDate = useMemo(
    () =>
      standardRecords
        .filter((record) => getFinanceRecordWorkDate(record) === operatingDate)
        .sort((left, right) => String(left.vehicle ?? "").localeCompare(String(right.vehicle ?? ""))),
    [standardRecords, operatingDate],
  );

  useEffect(() => {
    if (!operatingDate && recordDates[0]) {
      setOperatingDate(recordDates[0]);
    }
  }, [operatingDate, recordDates]);

  useEffect(() => {
    if (!recordsForDate.some((record) => record.id === selectedId)) {
      setSelectedId(recordsForDate[0]?.id ?? null);
    }
  }, [recordsForDate, selectedId]);

  const requestInit = useMemo(
    () => ({ headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} }),
    [accessToken],
  );
  const modeQuery = `mode=${isDemo ? "mock" : "live"}`;

  useEffect(() => {
    if (!selectedId) {
      setPreview({ status: "idle" });
      return undefined;
    }

    const requestNumber = previewRequest.current + 1;
    previewRequest.current = requestNumber;
    const controller = new AbortController();
    setPreview({ status: "loading" });
    setDownload({ status: "idle" });

    fetch(`${template.previewPath(selectedId)}?${modeQuery}`, { ...requestInit, signal: controller.signal })
      .then(async (response) => {
        if (previewRequest.current !== requestNumber) return;
        if (!response.ok) {
          setPreview({ status: "error", ...describeError(response.status) });
          return;
        }
        setPreview({ status: "ready", report: await response.json() });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || previewRequest.current !== requestNumber) return;
        setPreview({ status: "error", ...describeError(0) });
      });

    return () => controller.abort();
  }, [selectedId, template, modeQuery, requestInit, previewNonce]);

  const handleDownload = async () => {
    if (!selectedId || download.status === "loading") {
      return;
    }

    setDownload({ status: "loading" });

    try {
      const response = await fetch(`${template.pdfPath(selectedId)}?${modeQuery}`, requestInit);

      if (!response.ok) {
        setDownload({ status: "error", ...describeError(response.status) });
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getFilename(response, `taxiflow-daily-finance-${operatingDate}-${selectedId}.pdf`);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Mobile browsers read the blob after click() returns; revoke later.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownload({ status: "done", filename: link.download });
    } catch {
      setDownload({ status: "error", ...describeError(0) });
    }
  };

  if (!REPORT_ROLES.includes(activeRole) || !canAccessReports) {
    return (
      <section className="panel-card" data-testid="reports-denied">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Reports</p>
            <h2>Management reports</h2>
          </div>
          <div className="panel-icon">
            <FileText size={18} />
          </div>
        </div>
        <p className="finance-form-note" data-tone="danger">
          Reports are available to Owners, and to Admins and Managers whose Money access is on.
        </p>
      </section>
    );
  }

  const report = preview.status === "ready" ? preview.report : null;
  const statusDisplay = (record) =>
    STATUS_DISPLAY[normalizeCashUpWorkflowStatus(record.status) ?? "pending"] ?? STATUS_DISPLAY.pending;
  const blocked = preview.status === "error" && ["denied", "auth"].includes(preview.kind);

  return (
    <section className="panel-card reports-panel" data-testid="reports-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Management reports</h2>
        </div>
        <div className="panel-icon">
          <FileText size={18} />
        </div>
      </div>

      {isDemo && (
        <p className="finance-form-note" data-tone="warning">
          Demo mode: reports use demo data and every PDF is marked DEMO DATA.
        </p>
      )}

      <div className="finance-form">
        <div className="finance-form-grid">
          <label className="finance-field">
            <span>Report</span>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {REPORT_TEMPLATES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="finance-field">
            <span>Operating date</span>
            <input
              type="date"
              value={operatingDate}
              onChange={(event) => setOperatingDate(event.target.value)}
              data-testid="reports-date"
            />
          </label>
        </div>
        <p className="finance-form-note">{template.description}</p>
      </div>

      <fieldset className="report-record-list" data-testid="reports-records">
        <legend>Cash-up</legend>
        {recordsForDate.length === 0 ? (
          <div className="report-empty" data-testid="reports-empty">
            <p>No daily cash-ups were captured for this date.</p>
            {recordDates.length > 0 && (
              <div className="report-date-chips">
                <span>Dates with records:</span>
                {recordDates.slice(0, 5).map((date) => (
                  <button key={date} className="cta-link" type="button" onClick={() => setOperatingDate(date)}>
                    {date}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          recordsForDate.map((record) => {
            const status = statusDisplay(record);

            return (
              <label key={record.id} className="report-record-option" data-selected={record.id === selectedId}>
                <input
                  type="radio"
                  name="report-record"
                  value={record.id}
                  checked={record.id === selectedId}
                  onChange={() => setSelectedId(record.id)}
                />
                <span className="report-record-main">
                  <strong>{record.vehicle ?? "Vehicle not recorded"}</strong>
                  <span>
                    {operatingDate} / {resolveDriverLabel(snapshot, record)}
                  </span>
                  <small>{record.id}</small>
                </span>
                <span className="status-chip" data-tone={status.tone}>
                  {status.label}
                </span>
              </label>
            );
          })
        )}
      </fieldset>

      {selectedId && (
        <div className="report-preview" aria-live="polite" data-testid="reports-preview">
          {preview.status === "loading" && (
            <p className="finance-form-note" data-tone="info">
              <Loader2 size={14} className="spin" /> Loading report summary...
            </p>
          )}
          {preview.status === "error" && (
            <div className="finance-form-note" data-tone="danger" data-testid="reports-preview-error">
              <span>{preview.message}</span>
              {preview.kind === "failed" && (
                <button className="cta-link" type="button" onClick={() => setPreviewNonce((value) => value + 1)}>
                  Try again
                </button>
              )}
            </div>
          )}
          {report && (
            <>
              <div className="overview-board-head">
                <p className="eyebrow">
                  {report.meta?.source === "mock" ? "Demo data preview" : "Preview"} / {report.cashUp.basisLabel}
                </p>
                <h3>
                  {report.header.vehicle ?? "Vehicle not recorded"} / {report.header.date}
                </h3>
              </div>
              <div className="queue-stats">
                <div className="info-pair">
                  <span>Driver</span>
                  <strong>{report.header.driver ?? "Not recorded"}</strong>
                </div>
                <div className="info-pair">
                  <span>Expected cash hand-in</span>
                  <strong>{formatRand(report.cashUp.expectedCashHandIn)}</strong>
                </div>
                <div className="info-pair">
                  <span>Actual cash received</span>
                  <strong>
                    {report.cashUp.actualCashReceived == null
                      ? "Awaiting count"
                      : formatRand(report.cashUp.actualCashReceived)}
                  </strong>
                </div>
                <div className="info-pair">
                  <span>Cash variance</span>
                  <strong data-testid="reports-variance">{describeVariance(report.cashUp)}</strong>
                </div>
                <div className="info-pair">
                  <span>Standard / special income</span>
                  <strong>
                    {formatRand(report.cashUp.standardIncome)} / {formatRand(report.cashUp.specialIncome)}
                  </strong>
                </div>
                <div className="info-pair">
                  <span>Expenses (cash)</span>
                  <strong>
                    {formatRand(report.cashUp.totalExpenses)} ({formatRand(report.cashUp.cashExpenses)})
                  </strong>
                </div>
                <div className="info-pair">
                  <span>Workflow</span>
                  <strong>
                    {STATUS_DISPLAY[report.cashUp.status]?.label ?? report.cashUp.status}
                  </strong>
                </div>
                <div className="info-pair">
                  <span>Deposit</span>
                  <strong>{report.deposit?.reference ?? "Not deposited"}</strong>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="finance-form-actions">
        <button
          className="action-button primary"
          type="button"
          onClick={handleDownload}
          disabled={!selectedId || blocked || download.status === "loading"}
          data-testid="reports-download"
        >
          {download.status === "loading" ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}
          {download.status === "loading" ? "Preparing PDF..." : "Download A4 PDF"}
        </button>
      </div>
      {download.status === "done" && (
        <p className="finance-form-note" data-tone="success" data-testid="reports-download-done">
          Downloaded {download.filename}
        </p>
      )}
      {download.status === "error" && (
        <p className="finance-form-note" data-tone="danger" data-testid="reports-download-error">
          {download.message}
        </p>
      )}
    </section>
  );
}
