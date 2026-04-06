import { buildDailyLogReportView } from "../../../_lib/dailyLogReportView.js";
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      error: "Method not allowed. Use GET /api/admin/daily-log/:id/report-view.",
    });
  }

  const reportId = String(getQueryValue(req.query?.id) ?? "").trim();

  if (!reportId) {
    return sendJson(res, 400, {
      error: "A daily log id is required.",
    });
  }

  try {
    const snapshotResult = await loadServerSnapshot({
      req,
      mode: getQueryValue(req.query?.mode),
      workspaceKey: getQueryValue(req.query?.workspaceKey),
    });
    const reportView = buildDailyLogReportView(snapshotResult.snapshot, reportId);

    return sendJson(res, 200, {
      ...reportView,
      meta: {
        source: snapshotResult.source,
        workspaceKey: snapshotResult.workspaceKey,
        requestedBy: snapshotResult.requestedBy,
        endpoint: `/api/admin/daily-log/${reportId}/report-view`,
      },
    });
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;

    return sendJson(
      res,
      statusCode,
      statusCode >= 500
        ? {
            error: "Unable to build the daily log report view.",
            detail: error instanceof Error ? error.message : "Unknown server error.",
          }
        : {
            error: error instanceof Error ? error.message : "Request could not be completed.",
          },
    );
  }
}
