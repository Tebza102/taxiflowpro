import { buildDailyFinanceReportData } from "../../../_lib/dailyFinanceReport.js";
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

// Pure resolver: given an already-resolved snapshotResult (identity + role
// already determined by loadServerSnapshot/Supabase) and a reportId, decides
// whether the request is authorized and, if so, builds the JSON payload. Kept
// separate from the (req, res) glue below so role-gating can be exercised
// directly in tests for every role (including Driver) without needing a real
// Supabase network call.
export const resolveReportViewPayload = (snapshotResult, reportId) => {
  assertReportAccess(snapshotResult);

  const reportView = buildDailyFinanceReportData(snapshotResult.snapshot, reportId);

  return {
    ...reportView,
    meta: {
      source: snapshotResult.source,
      workspaceKey: snapshotResult.workspaceKey,
      requestedBy: snapshotResult.requestedBy ? { role: snapshotResult.requestedBy.role } : null,
      endpoint: `/api/admin/daily-log/${reportId}/report-view`,
    },
  };
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
    });

    const payload = resolveReportViewPayload(snapshotResult, reportId);

    return sendJson(res, 200, payload);
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;

    return sendJson(
      res,
      statusCode,
      statusCode >= 500
        ? { error: "Unable to build the daily log report view." }
        : {
            error: error instanceof Error ? error.message : "Request could not be completed.",
          },
    );
  }
}
