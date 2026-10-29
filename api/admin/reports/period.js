import { buildPeriodReport, periodReportCsv, periodReportFilename } from "../../../src/lib/periodReport.js";
import { renderPeriodReportPdf } from "../../_lib/periodReportPdf.js";
import { assertReportAccess } from "../../_lib/reportAccess.js";
import { loadReportSnapshot } from "../../_lib/reportSnapshot.js";

// GET /api/admin/reports/period?scope=business|vehicle&vehicle=<id>
//   &period=daily|weekly|monthly|custom&date=YYYY-MM-DD&start=&end=&format=json|csv|pdf
// One report object per request, built after the same access gate as the
// Daily Finance Report (Owner, or Admin/Manager with Money on, from the
// membership), then sent as JSON for the screen or rendered as CSV or PDF.

const FORMATS = ["json", "csv", "pdf"];

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const queryValue = (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export const readReportRequest = (query = {}) => ({
  scope: queryValue(query.scope) ?? "business",
  vehicleId: queryValue(query.vehicle),
  period: queryValue(query.period),
  date: queryValue(query.date),
  month: queryValue(query.month),
  start: queryValue(query.start),
  end: queryValue(query.end),
});

// Pure resolver (tested directly for every role): access first, then the report.
export const resolvePeriodReport = (snapshotResult, request, { generatedAt } = {}) => {
  assertReportAccess(snapshotResult);
  const snapshot = snapshotResult.snapshot ?? {};
  return buildPeriodReport(snapshot, request, {
    generatedAt,
    businessName: snapshot.profile?.fleetName ?? snapshot.profile?.legalEntity ?? null,
  });
};

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed. Use GET (or POST in demo mode) /api/admin/reports/period." });
  }

  const format = String(queryValue(req.query?.format) ?? "json").toLowerCase();
  if (!FORMATS.includes(format)) return sendJson(res, 400, { error: "format must be json, csv or pdf." });

  try {
    const snapshotResult = await loadReportSnapshot({ req, mode: queryValue(req.query?.mode) });
    const report = resolvePeriodReport(snapshotResult, readReportRequest(req.query));

    if (format === "json") {
      return sendJson(res, 200, { ...report, meta: { source: snapshotResult.source, businessId: snapshotResult.businessId ?? null } });
    }

    const body = format === "csv"
      ? Buffer.from(periodReportCsv(report), "utf8")
      : await renderPeriodReportPdf(report, { source: snapshotResult.source });
    res.statusCode = 200;
    res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${periodReportFilename(report, format)}"`);
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("Cache-Control", "no-store");
    return res.end(body);
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    // The person gets a plain message; the cause goes to the server log.
    if (statusCode >= 500) console.error(`[reports/period] ${format} report failed:`, error);
    return sendJson(res, statusCode, statusCode >= 500 ? { error: "Unable to build the report." } : { error: error.message });
  }
}
