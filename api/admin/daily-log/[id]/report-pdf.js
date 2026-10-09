import { buildDailyFinanceReportData } from "../../../_lib/dailyFinanceReport.js";
import { renderDailyFinanceReportPdf } from "../../../_lib/dailyFinanceReportPdf.js";
import { assertReportAccess } from "../../../_lib/reportAccess.js";
import { loadServerSnapshot } from "../../../_lib/snapshotLoader.js";

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload, null, 2));
};

const getQueryValue = (value) => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const toSafeFilenamePart = (value) =>
  String(value ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";

// Pure resolver mirroring report-view.js: same access gate, same enriched
// builder, so the preview and the downloaded PDF can never disagree.
export const resolveReportPdf = async (snapshotResult, reportId) => {
  assertReportAccess(snapshotResult);

  const reportView = buildDailyFinanceReportData(snapshotResult.snapshot, reportId);
  const buffer = await renderDailyFinanceReportPdf(reportView, { source: snapshotResult.source });
  const filename = `taxiflow-daily-finance-${toSafeFilenamePart(reportView.header?.date)}-${toSafeFilenamePart(
    reportView.reportId,
  )}.pdf`;

  return { buffer, filename };
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      error: "Method not allowed. Use GET /api/admin/daily-log/:id/report-pdf.",
    });
  }

  const reportId = String(getQueryValue(req.query?.id) ?? "").trim();

  if (!reportId) {
    return sendJson(res, 400, { error: "A daily log id is required." });
  }

  try {
    const snapshotResult = await loadServerSnapshot({
      req,
      mode: getQueryValue(req.query?.mode),
    });

    const { buffer, filename } = await resolveReportPdf(snapshotResult, reportId);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "no-store");
    return res.end(buffer);
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;

    return sendJson(
      res,
      statusCode,
      statusCode >= 500
        ? { error: "Unable to render the daily finance report PDF." }
        : { error: error instanceof Error ? error.message : "Request could not be completed." },
    );
  }
}
