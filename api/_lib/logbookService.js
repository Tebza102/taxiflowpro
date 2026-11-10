import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import {
  LOGBOOK_FIELDS,
  normalizeLogbookField,
  normalizeLogbookFields,
  validateLogbookRow,
} from "../../src/lib/logbookContract.js";
import { annotateActors, loadBusinessActors } from "./actorNames.js";
import { applyLogbookApproval } from "./logbookApproval.js";
import {
  approveBodySchema,
  canonicalLogbookRow,
  describeZodError,
  editBodySchema,
  extractBodySchema,
  importBodySchema,
  keyBodySchema,
  logbookRowHash,
  rejectBodySchema,
} from "./logbookSchema.js";
import { extractLogbookPage, logbookVisionModel, prepareLogbookImage } from "./logbookVision.js";
import {
  authorizeBusinessRequest,
  buildRequester,
  createHttpError,
  getBearerToken,
  getRequestedBusinessId,
  serviceClientFor,
} from "./tenantAuth.js";

// Paper logbook pipeline: extract / import -> validate -> PENDING review queue
// -> an Owner or Admin edits, approves or rejects each row. Every function here
// runs after server authorization and every query is pinned to that business.

export const LOGBOOK_ROLES = Object.freeze(["Owner", "Admin"]);
export const IMPORT_KEY_PREFIX = "tflb_";
export const IMPORT_RATE_LIMIT = 30; // requests per key per window
export const IMPORT_RATE_WINDOW_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseBody = (schema, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw createHttpError(400, `The request is not valid: ${describeZodError(parsed.error)}`);
  return parsed.data;
};

// Owner, or an Admin whose Money access is on (the same rule as every other
// management finance action). Managers and Drivers are refused.
export const assertLogbookAccess = (requester) => {
  if (!LOGBOOK_ROLES.includes(requester?.role)) throw createHttpError(403, "Only an Owner or Admin can work with logbook imports.");
  if (requester.role !== "Owner" && requester.moduleAccess?.finance !== true) {
    throw createHttpError(403, "Money access is turned off for your account.");
  }
};

const loadSnapshotRow = async (service, businessId) => {
  const { data, error } = await service
    .from("workspace_snapshots")
    .select("business_id, snapshot, updated_at")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw createHttpError(502, "Unable to load the business snapshot.");
  if (!data?.snapshot) throw createHttpError(404, "The business snapshot could not be found.");
  return data;
};

// Token -> active membership -> Owner/Admin with Money. Returns the context every
// signed-in logbook action uses.
export const authorizeLogbookRequest = async (req) => {
  const authorization = await authorizeBusinessRequest(req);
  const service = serviceClientFor(authorization);
  const snapshotRow = await loadSnapshotRow(service, authorization.businessId);
  const requester = buildRequester(authorization, snapshotRow.snapshot);
  assertLogbookAccess(requester);
  return { authorization, service, requester, snapshotRow, businessId: authorization.businessId };
};

const rpc = async (service, name, args, failure) => {
  const { data, error } = await service.rpc(name, args);
  if (error) throw createHttpError(502, failure);
  return data;
};

const prepareRows = (rawRows, snapshot, pageIndex = null) =>
  rawRows.map((raw, index) => {
    const { fields, rowHash } = canonicalLogbookRow(raw);
    const { issues } = validateLogbookRow(fields, snapshot);
    return { page_index: pageIndex, row_index: index + 1, fields, issues, row_hash: rowHash };
  });

// Rows that repeat an earlier row in the same request are dropped here (the
// database guards the rest), so the response can say what was skipped.
const dedupeWithinRequest = (rows) => {
  const seen = new Set();
  const unique = [];
  const repeated = [];
  for (const row of rows) {
    if (seen.has(row.row_hash)) repeated.push({ rowIndex: row.row_index, existingStatus: "same-request" });
    else {
      seen.add(row.row_hash);
      unique.push(row);
    }
  }
  return { unique, repeated };
};

// --- POST /api/logbook/extract ---------------------------------------------------
export const extractLogbook = async (context, body) => {
  const { service, requester, snapshotRow, businessId } = context;
  const request = parseBody(extractBodySchema, body);
  const model = logbookVisionModel();

  const pages = [];
  const seenHashes = new Set();
  for (const upload of request.pages) {
    const image = await prepareLogbookImage(upload);
    const page = { filename: upload.filename ?? null, ...image, duplicate: false, existingBatchId: null, rows: [], pageNote: null, attempts: 0 };
    if (seenHashes.has(image.sha256)) {
      page.duplicate = true;
    } else {
      seenHashes.add(image.sha256);
      const { data: existing, error } = await service
        .from("logbook_pages")
        .select("id, batch_id")
        .eq("business_id", businessId)
        .eq("sha256", image.sha256)
        .maybeSingle();
      if (error) throw createHttpError(502, "Unable to check for an earlier upload of this page.");
      if (existing) {
        page.duplicate = true;
        page.existingBatchId = existing.batch_id;
      }
    }
    pages.push(page);
  }

  // The model is called only for pages this business has not uploaded before.
  for (const page of pages.filter((entry) => !entry.duplicate)) {
    const extraction = await extractLogbookPage(page, { model });
    page.rows = extraction.rows;
    page.pageNote = extraction.pageNote;
    page.attempts = extraction.attempts;
  }

  const stored = pages.filter((page) => !page.duplicate && page.rows.length > 0);
  const queuedRows = stored.flatMap((page, index) => prepareRows(page.rows, snapshotRow.snapshot, index));
  const { unique, repeated } = dedupeWithinRequest(queuedRows);
  let queued = { batchId: request.batchId ?? null, insertedRowIds: [], skipped: [] };
  if (stored.length > 0) {
    queued = await rpc(
      service,
      "logbook_queue",
      {
        p_business_id: businessId,
        p_source: "upload",
        p_model: model,
        p_reference: null,
        p_user_id: requester.id,
        p_role: requester.role,
        p_api_key_id: null,
        p_batch_id: request.batchId ?? null,
        p_pages: stored.map((page) => ({
          filename: page.filename,
          media_type: page.mediaType,
          byte_size: page.byteSize,
          sha256: page.sha256,
          image_base64: page.buffer.toString("base64"),
          page_note: page.pageNote,
        })),
        p_rows: unique,
      },
      "The extracted rows could not be saved for review.",
    );
    if (queued.status === "batch_not_found") throw createHttpError(404, "That logbook batch does not exist in this business.");
  }

  return {
    batchId: queued.batchId ?? pages.find((page) => page.existingBatchId)?.existingBatchId ?? null,
    queuedRows: queued.insertedRowIds.length,
    skippedDuplicateRows: [...repeated, ...queued.skipped],
    pages: pages.map((page) => ({
      filename: page.filename,
      duplicatePage: page.duplicate,
      existingBatchId: page.existingBatchId,
      extractedRows: page.rows.length,
      pageNote: page.pageNote,
      attempts: page.attempts,
    })),
  };
};

// --- Automation keys ---------------------------------------------------------------
const hashKey = (key) => createHash("sha256").update(key).digest("hex");

export const generateImportKey = () => {
  const key = `${IMPORT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, keyHash: hashKey(key), keyPrefix: key.slice(0, IMPORT_KEY_PREFIX.length + 6) };
};

const keyVerifierClient = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw createHttpError(503, "Supabase server configuration is incomplete.");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
};

// An automation key authenticates POST /api/logbook/import only. The business is
// the key's own business; nothing in the request can choose another one.
export const authorizeImportKey = async (req) => {
  const header = req?.headers?.["x-api-key"];
  const presented = String((Array.isArray(header) ? header[0] : header) ?? getBearerToken(req) ?? "").trim();
  if (!presented) throw createHttpError(401, "An import API key is required.");
  if (!presented.startsWith(IMPORT_KEY_PREFIX) || presented.length > 200) throw createHttpError(401, "The import API key is not valid.");
  const service = keyVerifierClient();
  const { data: key, error } = await service
    .from("logbook_api_keys")
    .select("id, business_id, scope, revoked_at")
    .eq("key_hash", hashKey(presented))
    .maybeSingle();
  if (error) throw createHttpError(502, "The import API key could not be checked.");
  if (!key || key.revoked_at) throw createHttpError(401, "The import API key is not valid.");
  if (key.scope !== "logbook.import") throw createHttpError(403, "This key cannot import logbook rows.");
  const businessId = String(key.business_id).toLowerCase();
  const requested = getRequestedBusinessId(req);
  if (requested && requested !== businessId) throw createHttpError(403, "This key belongs to a different business.");
  const allowed = await rpc(
    service,
    "logbook_rate_take",
    { p_key_id: key.id, p_limit: IMPORT_RATE_LIMIT, p_window_seconds: IMPORT_RATE_WINDOW_SECONDS },
    "The import rate limit could not be checked.",
  );
  if (allowed !== true) {
    const error429 = createHttpError(429, "Too many import requests. Wait a minute and try again.");
    error429.retryAfter = IMPORT_RATE_WINDOW_SECONDS;
    throw error429;
  }
  return { service, businessId, keyId: key.id };
};

// --- POST /api/logbook/import ---------------------------------------------------
export const importLogbook = async ({ service, businessId, keyId }, body) => {
  const request = parseBody(importBodySchema, body);
  const snapshotRow = await loadSnapshotRow(service, businessId);
  const { unique, repeated } = dedupeWithinRequest(prepareRows(request.rows, snapshotRow.snapshot));
  const queued = await rpc(
    service,
    "logbook_queue",
    {
      p_business_id: businessId,
      p_source: "api",
      p_model: null,
      p_reference: request.reference ?? null,
      p_user_id: null,
      p_role: "api-key",
      p_api_key_id: keyId,
      p_batch_id: null,
      p_pages: [],
      p_rows: unique,
    },
    "The rows could not be saved for review.",
  );
  return {
    batchId: queued.batchId,
    status: "pending_review",
    queuedRows: queued.insertedRowIds.length,
    skippedDuplicateRows: [...repeated, ...queued.skipped],
  };
};

export const manageImportKeys = async ({ service, requester, businessId }, method, body) => {
  // Keys can push data into the review queue, so only the Owner manages them.
  if (requester.role !== "Owner") throw createHttpError(403, "Only the Owner can manage import keys.");
  if (method === "POST") {
    const request = parseBody(keyBodySchema, body);
    if (request.action === "create") {
      const generated = generateImportKey();
      const { data, error } = await service
        .from("logbook_api_keys")
        .insert({ business_id: businessId, name: request.name, key_prefix: generated.keyPrefix, key_hash: generated.keyHash, created_by: requester.id })
        .select("id")
        .single();
      if (error) throw createHttpError(502, "The import key could not be created.");
      // The key itself is shown once and never stored; only its hash is kept.
      return { created: { id: data.id, name: request.name, key: generated.key } };
    }
    const { data, error } = await service
      .from("logbook_api_keys")
      .update({ revoked_at: new Date().toISOString(), revoked_by: requester.id })
      .eq("business_id", businessId)
      .eq("id", request.keyId)
      .is("revoked_at", null)
      .select("id");
    if (error) throw createHttpError(502, "The import key could not be revoked.");
    if (!data?.length) throw createHttpError(404, "That active import key does not exist in this business.");
    return { revoked: request.keyId };
  }
  const { data, error } = await service
    .from("logbook_api_keys")
    .select("id, name, key_prefix, created_at, revoked_at, last_used_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw createHttpError(502, "The import keys could not be loaded.");
  return { keys: data ?? [] };
};

// --- Review queue ------------------------------------------------------------------
const requireUuid = (value, label) => {
  const id = String((Array.isArray(value) ? value[0] : value) ?? "").trim();
  if (!UUID.test(id)) throw createHttpError(400, `${label} is not valid.`);
  return id.toLowerCase();
};

export const listLogbookBatches = async ({ service, businessId }) => {
  const { data: batches, error } = await service
    .from("logbook_batches")
    .select("id, source, model, reference, created_by, api_key_id, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw createHttpError(502, "The logbook batches could not be loaded.");
  const ids = (batches ?? []).map((batch) => batch.id);
  const counts = new Map(ids.map((id) => [id, { pending: 0, approved: 0, rejected: 0 }]));
  if (ids.length) {
    const { data: rows, error: rowError } = await service.from("logbook_rows").select("batch_id, status").eq("business_id", businessId).in("batch_id", ids);
    if (rowError) throw createHttpError(502, "The logbook batches could not be loaded.");
    for (const row of rows ?? []) counts.get(row.batch_id)[row.status] += 1;
  }
  return { batches: (batches ?? []).map((batch) => ({ ...batch, counts: counts.get(batch.id) })) };
};

const toRow = (row) => ({
  id: row.id,
  batchId: row.batch_id,
  pageId: row.page_id,
  rowIndex: row.row_index,
  fields: row.fields,
  issues: row.issues ?? [],
  rowHash: row.row_hash,
  status: row.status,
  editedBy: row.edited_by,
  editedAt: row.edited_at,
  reviewedBy: row.reviewed_by,
  reviewedAt: row.reviewed_at,
  rejectReason: row.reject_reason,
  liveRecordIds: row.live_record_ids,
  createdAt: row.created_at,
});

// One batch with its pages (no image bytes), rows and audit events. Pending rows
// are re-validated against the business as it is now.
export const readLogbookBatch = async (context, batchIdInput) => {
  const { service, businessId, snapshotRow, authorization } = context;
  const batchId = requireUuid(batchIdInput, "The batch id");
  const { data: batch, error } = await service
    .from("logbook_batches")
    .select("id, source, model, reference, created_by, api_key_id, created_at")
    .eq("business_id", businessId)
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw createHttpError(502, "The logbook batch could not be loaded.");
  if (!batch) throw createHttpError(404, "That logbook batch does not exist in this business.");
  const [pages, rows, events] = await Promise.all([
    service.from("logbook_pages").select("id, page_number, filename, media_type, byte_size, page_note").eq("business_id", businessId).eq("batch_id", batchId).order("page_number"),
    service.from("logbook_rows").select("*").eq("business_id", businessId).eq("batch_id", batchId).order("row_index"),
    service.from("logbook_row_events").select("id, row_id, action, actor_user_id, actor_api_key_id, actor_role, detail, created_at").eq("business_id", businessId).eq("batch_id", batchId).order("id"),
  ]);
  if (pages.error || rows.error || events.error) throw createHttpError(502, "The logbook batch could not be loaded.");
  const { names } = annotateActors(snapshotRow.snapshot, await loadBusinessActors(authorization));
  return {
    batch,
    pages: pages.data ?? [],
    rows: (rows.data ?? []).map((row) => {
      const mapped = toRow(row);
      return mapped.status === "pending" ? { ...mapped, issues: validateLogbookRow(mapped.fields, snapshotRow.snapshot).issues } : mapped;
    }),
    events: events.data ?? [],
    actorNames: names,
  };
};

export const readLogbookPageImage = async ({ service, businessId }, pageIdInput) => {
  const pageId = requireUuid(pageIdInput, "The page id");
  const { data, error } = await service
    .from("logbook_pages")
    .select("media_type, image_base64")
    .eq("business_id", businessId)
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw createHttpError(502, "The page image could not be loaded.");
  if (!data) throw createHttpError(404, "That page does not exist in this business.");
  return { mediaType: data.media_type, buffer: Buffer.from(data.image_base64, "base64") };
};

const loadRow = async (service, businessId, rowId) => {
  const { data, error } = await service.from("logbook_rows").select("*").eq("business_id", businessId).eq("id", rowId).maybeSingle();
  if (error) throw createHttpError(502, "The logbook row could not be loaded.");
  if (!data) throw createHttpError(404, "That logbook row does not exist in this business.");
  return toRow(data);
};

const refuseUnlessPending = (result) => {
  if (result.status === "not_found") throw createHttpError(404, "That logbook row does not exist in this business.");
  if (result.status === "not_pending") throw createHttpError(409, `This row is already ${result.rowStatus}; it can no longer be changed.`);
};

export const editLogbookRow = async ({ service, requester, snapshotRow, businessId }, body) => {
  const request = parseBody(editBodySchema, body);
  const row = await loadRow(service, businessId, request.rowId);
  if (row.status !== "pending") throw createHttpError(409, `This row is already ${row.status}; it can no longer be changed.`);
  const kinds = new Map(LOGBOOK_FIELDS.map((field) => [field.key, field.kind]));
  const next = { ...normalizeLogbookFields(row.fields) };
  for (const [key, value] of Object.entries(request.values)) {
    const previous = next[key];
    // A value typed by the reviewer is a person's reading of the page.
    const edited = normalizeLogbookField({ value, confidence: "high", note: null }, kinds.get(key));
    if (edited.value === previous.value) continue;
    if (edited.value === null && value !== null && value !== "") throw createHttpError(400, `"${String(value).slice(0, 40)}" is not a valid ${kinds.get(key) === "amount" ? "amount" : "value"}.`);
    next[key] = { ...edited, note: `Entered by reviewer (was ${previous.value === null ? "unreadable" : previous.value}).` };
  }
  const { issues } = validateLogbookRow(next, snapshotRow.snapshot);
  const result = await rpc(
    service,
    "logbook_edit_row",
    { p_business_id: businessId, p_row_id: row.id, p_user_id: requester.id, p_role: requester.role, p_fields: next, p_issues: issues, p_row_hash: logbookRowHash(next) },
    "The change could not be saved.",
  );
  refuseUnlessPending(result);
  if (result.status === "duplicate") throw createHttpError(409, "Another row in this business already has the same driver, vehicle, date and amounts.");
  return { row: await loadRow(service, businessId, row.id) };
};

export const rejectLogbookRow = async ({ service, requester, businessId }, body) => {
  const request = parseBody(rejectBodySchema, body);
  const result = await rpc(
    service,
    "logbook_reject_row",
    { p_business_id: businessId, p_row_id: request.rowId, p_user_id: requester.id, p_role: requester.role, p_reason: request.reason },
    "The row could not be rejected.",
  );
  refuseUnlessPending(result);
  return { row: await loadRow(service, businessId, request.rowId) };
};

// Approve = the only path from the queue into live records. The snapshot write,
// the row status and the audit event commit together (commit_logbook_approval).
export const approveLogbookRow = async ({ service, requester, businessId }, body) => {
  const request = parseBody(approveBodySchema, body);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const row = await loadRow(service, businessId, request.rowId);
    if (row.status !== "pending") throw createHttpError(409, `This row is already ${row.status}.`);
    const snapshotRow = await loadSnapshotRow(service, businessId);
    const fields = normalizeLogbookFields(row.fields);
    const approval = applyLogbookApproval(snapshotRow.snapshot, { ...row, fields }, requester, {
      acknowledgeWarnings: request.acknowledgeWarnings === true,
    });
    const result = await rpc(
      service,
      "commit_logbook_approval",
      {
        p_business_id: businessId,
        p_row_id: row.id,
        p_expected_row_hash: row.rowHash,
        p_expected_updated_at: snapshotRow.updated_at,
        p_snapshot: approval.snapshot,
        p_user_id: requester.id,
        p_role: requester.role,
        p_live_record_ids: approval.liveRecordIds,
        p_issues: approval.issues,
      },
      "The approval could not be saved. Nothing was recorded.",
    );
    refuseUnlessPending(result);
    if (result.status === "approved") {
      return { row: await loadRow(service, businessId, row.id), liveRecordIds: approval.liveRecordIds, version: result.version };
    }
    // 'conflict' (someone saved to the business meanwhile) or 'row_changed' (the
    // row was edited meanwhile): read both again and retry on the fresh state.
  }
  throw createHttpError(409, "The business data kept changing while approving. Nothing was recorded; try again.");
};
