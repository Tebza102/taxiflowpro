import { DEMO_REPORT_LIST_KEYS, DEMO_REPORT_MAX_RECORDS, sanitizeDemoReportSnapshot } from "../../src/lib/demoReportSnapshot.js";
import { assertReportAccess } from "./reportAccess.js";
import { loadServerSnapshot } from "./snapshotLoader.js";
import { createHttpError, getBearerToken } from "./tenantAuth.js";

// The snapshot a report is built from. GET: the caller's stored business data
// (loadServerSnapshot, unchanged). POST: a LOCAL demo app's current demo
// workspace (src/lib/demoReportSnapshot.js), so demo reports include that
// session's entries. A caller-supplied snapshot is accepted only when ALL hold:
//   - mode=mock (any other mode is 400);
//   - not a production server (NODE_ENV=production is 403): a deployed app, live
//     or demo, never builds a report from data the caller sends;
//   - no sign-in token (403): a business session always reads its stored data,
//     so posting "demo" data can never stand in for, or skip, its checks;
//   - the same report gate as a demo GET (assertReportAccess).
// The posted data is shape- and size-checked and reduced to report fields only
// (no credentials or contact details). Nothing stored is read or written.

export const MAX_DEMO_BODY_BYTES = 4_000_000;

const tooLarge = () => createHttpError(413, "The demo workspace is too large to report on.");

const readJson = async (req) => {
  const declared = Number(req.headers?.["content-length"] ?? 0);
  if (declared > MAX_DEMO_BODY_BYTES) throw tooLarge();
  if (req.body !== undefined) {
    // Already parsed by the platform: measure it the same way.
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
    if (Buffer.byteLength(raw, "utf8") > MAX_DEMO_BODY_BYTES) throw tooLarge();
    return typeof req.body === "string" ? JSON.parse(req.body || "null") : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_DEMO_BODY_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
};

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const readDemoReportSnapshot = (body) => {
  const posted = body?.snapshot;
  if (!isRecord(posted)) throw createHttpError(400, "A demo report needs the demo workspace.");
  if (posted.profile !== undefined && posted.profile !== null && !isRecord(posted.profile)) throw createHttpError(400, "profile must be an object.");
  if (posted.finance !== undefined && posted.finance !== null && !isRecord(posted.finance)) throw createHttpError(400, "finance must be an object.");
  const schedules = posted.finance?.recurringExpenses;
  if (schedules !== undefined) {
    if (!Array.isArray(schedules) || !schedules.every(isRecord)) throw createHttpError(400, "finance.recurringExpenses must be a list of objects.");
    if (schedules.length > DEMO_REPORT_MAX_RECORDS) throw tooLarge();
  }
  for (const key of DEMO_REPORT_LIST_KEYS) {
    if (posted[key] === undefined) continue;
    if (!Array.isArray(posted[key])) throw createHttpError(400, `${key} must be a list.`);
    if (posted[key].length > DEMO_REPORT_MAX_RECORDS) throw tooLarge();
    if (!posted[key].every(isRecord)) throw createHttpError(400, `Every entry in ${key} must be an object.`);
  }
  return sanitizeDemoReportSnapshot(posted);
};

export const loadReportSnapshot = async ({ req, mode }) => {
  if (req?.method !== "POST") return loadServerSnapshot({ req, mode });
  if (String(mode ?? "").trim().toLowerCase() !== "mock") {
    throw createHttpError(400, "Only demo reports can be built from data sent with the request.");
  }
  if (process.env.NODE_ENV === "production") {
    throw createHttpError(403, "Reports on a deployed TaxiFlow are built from stored data only.");
  }
  if (getBearerToken(req)) {
    throw createHttpError(403, "A signed-in business session cannot send report data; its reports use the stored business data.");
  }
  // Same gate as a demo GET without a session (non-production only), checked
  // before the body is read.
  const access = { snapshot: null, source: "mock", workspaceKey: null, businessId: null, scope: null, requestedBy: null };
  assertReportAccess(access);
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    throw error?.statusCode ? error : createHttpError(400, "The request body must be valid JSON.");
  }
  return { ...access, snapshot: readDemoReportSnapshot(body), demoSession: true };
};
