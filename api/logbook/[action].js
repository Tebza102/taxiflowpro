import { renderLogbookWorkbook } from "../_lib/logbookExport.js";
import {
  approveLogbookRow,
  authorizeImportKey,
  authorizeLogbookRequest,
  editLogbookRow,
  extractLogbook,
  importLogbook,
  listLogbookBatches,
  manageImportKeys,
  readLogbookBatch,
  readLogbookPageImage,
  rejectLogbookRow,
} from "../_lib/logbookService.js";
import { createHttpError } from "../_lib/tenantAuth.js";

// /api/logbook/<action> (one Vercel function; the dev route is in vite.config.js)
//   POST extract       page images -> vision model -> validated rows, PENDING review
//   POST import        already-structured rows (automation API key) -> same queue
//   GET  batches       the business's batches with row counts
//   GET  batch?id=     one batch: pages, rows (with checks) and audit events
//   GET  page-image?id= the stored page image
//   POST row-edit | row-approve | row-reject
//   GET  export?id=    Excel export of a batch with confidence flags
//   GET|POST keys      Owner: list, create or revoke automation keys
// Every action authenticates and authorizes on the server before it reads the
// request body: a sign-in token with an active Owner/Admin membership (Money on),
// or, for import only, an automation key. All data is pinned to that business.

const ACTIONS = Object.freeze({
  extract: { methods: ["POST"], maxBody: 72 * 1024 * 1024 },
  import: { methods: ["POST"], maxBody: 1024 * 1024, apiKey: true },
  batches: { methods: ["GET"] },
  batch: { methods: ["GET"] },
  "page-image": { methods: ["GET"] },
  "row-edit": { methods: ["POST"], maxBody: 64 * 1024 },
  "row-approve": { methods: ["POST"], maxBody: 64 * 1024 },
  "row-reject": { methods: ["POST"], maxBody: 64 * 1024 },
  export: { methods: ["GET"] },
  keys: { methods: ["GET", "POST"], maxBody: 64 * 1024 },
});

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const queryValue = (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null);

const readBody = async (req, maxBytes) => {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      if (req.body.length > maxBytes) throw createHttpError(413, "The request is too large.");
      return JSON.parse(req.body || "null");
    }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw createHttpError(413, "The request is too large.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
};

const jsonBody = async (req, maxBytes) => {
  try {
    return await readBody(req, maxBytes);
  } catch (error) {
    throw error?.statusCode ? error : createHttpError(400, "The request body must be valid JSON.");
  }
};

export const handleLogbookRequest = async (req) => {
  const action = String(queryValue(req.query?.action) ?? "");
  const spec = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!spec) throw createHttpError(404, "Unknown logbook action.");
  if (!spec.methods.includes(req.method)) {
    const error = createHttpError(405, `Method not allowed. Use ${spec.methods.join(" or ")} /api/logbook/${action}.`);
    error.allow = spec.methods.join(", ");
    throw error;
  }

  // Authentication and authorization come first, before any body is read.
  if (spec.apiKey) {
    const keyContext = await authorizeImportKey(req);
    return { json: await importLogbook(keyContext, await jsonBody(req, spec.maxBody)) };
  }
  const context = await authorizeLogbookRequest(req);
  const body = req.method === "POST" ? await jsonBody(req, spec.maxBody) : null;

  switch (action) {
    case "extract":
      return { json: await extractLogbook(context, body) };
    case "batches":
      return { json: await listLogbookBatches(context) };
    case "batch":
      return { json: await readLogbookBatch(context, req.query?.id) };
    case "page-image": {
      const image = await readLogbookPageImage(context, req.query?.id);
      return { file: { body: image.buffer, contentType: image.mediaType } };
    }
    case "row-edit":
      return { json: await editLogbookRow(context, body) };
    case "row-approve":
      return { json: await approveLogbookRow(context, body) };
    case "row-reject":
      return { json: await rejectLogbookRow(context, body) };
    case "export": {
      const batch = await readLogbookBatch(context, req.query?.id);
      const profile = context.snapshotRow.snapshot?.profile ?? {};
      const workbook = await renderLogbookWorkbook({ ...batch, businessName: profile.fleetName ?? profile.legalEntity ?? null });
      return {
        file: {
          body: workbook,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          filename: `taxiflow-logbook-${batch.batch.created_at.slice(0, 10)}-${batch.batch.id.slice(0, 8)}.xlsx`,
        },
      };
    }
    case "keys":
      return { json: await manageImportKeys(context, req.method, body) };
    default:
      throw createHttpError(404, "Unknown logbook action.");
  }
};

export default async function handler(req, res) {
  try {
    const result = await handleLogbookRequest(req);
    if (result.file) {
      res.statusCode = 200;
      res.setHeader("Content-Type", result.file.contentType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (result.file.filename) res.setHeader("Content-Disposition", `attachment; filename="${result.file.filename}"`);
      res.setHeader("Content-Length", String(result.file.body.length));
      res.setHeader("Cache-Control", "no-store");
      return res.end(result.file.body);
    }
    return sendJson(res, 200, { ok: true, ...result.json });
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    if (error?.allow) res.setHeader("Allow", error.allow);
    if (error?.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
    if (statusCode >= 500) console.error(`[logbook] ${req.method} ${queryValue(req.query?.action)} failed:`, error?.message);
    // 502/503 messages here are written for the person (no internals); other 5xx are generic.
    const message = statusCode < 500 || statusCode === 502 || statusCode === 503 ? error.message : "Unable to complete the logbook request.";
    return sendJson(res, statusCode, {
      error: message,
      ...(error?.issues ? { issues: error.issues } : {}),
      ...(error?.needsAcknowledgement ? { needsAcknowledgement: true } : {}),
    });
  }
}
