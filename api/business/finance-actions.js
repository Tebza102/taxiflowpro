import { applyFinanceAction, parseFinanceActionRequest } from "../_lib/financeActions.js";
import { authorizeBusinessRequest, buildRequester, createHttpError, serviceClientFor } from "../_lib/tenantAuth.js";

// POST /api/business/finance-actions
// Body: { action, requestId (UUID, reused on retry), expectedVersion (the
// snapshot updated_at the caller loaded), fields: {...} }.
// Flow: validate request -> authorize (tenantAuth: token + active membership +
// business selection) -> load the authorized business row -> apply the scoped
// action -> atomic commit (replay check + updated_at compare-and-swap + request
// log) via public.commit_finance_action. A browser-supplied snapshot is never
// accepted; stale versions fail without writing; retries return the original
// result instead of applying twice.

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body || "null") : req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length > 32_768) throw createHttpError(413, "Request body too large.");
  return raw ? JSON.parse(raw) : null;
};

export const handleFinanceAction = async (req) => {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    throw error?.statusCode ? error : createHttpError(400, "The request body must be valid JSON.");
  }
  const request = parseFinanceActionRequest(body);
  const authorization = await authorizeBusinessRequest(req);
  const service = serviceClientFor(authorization);

  const { data: row, error: readError } = await service
    .from("workspace_snapshots")
    .select("business_id, snapshot, updated_at")
    .eq("business_id", authorization.businessId)
    .maybeSingle();
  if (readError) throw createHttpError(502, "Unable to load the business snapshot.");
  if (!row) throw createHttpError(404, "The business snapshot could not be found.");

  const requester = buildRequester(authorization, row.snapshot);

  // A retry of an already-applied request must return the stored result even
  // though the snapshot has moved on, so check the log before applying.
  const { data: prior } = await service
    .from("finance_action_requests")
    .select("response, request_hash, user_id")
    .eq("business_id", authorization.businessId)
    .eq("request_id", request.requestId)
    .maybeSingle();
  if (prior) {
    if (prior.request_hash !== request.requestHash || prior.user_id !== authorization.userId) {
      throw createHttpError(409, "This requestId was already used for a different request.");
    }
    return { statusCode: 200, payload: { ok: true, replayed: true, ...prior.response } };
  }

  const { snapshot, targetId, response } = applyFinanceAction(row.snapshot, request, requester);

  const { data: result, error: commitError } = await service.rpc("commit_finance_action", {
    p_business_id: authorization.businessId,
    p_expected_updated_at: request.expectedVersion,
    p_snapshot: snapshot,
    p_updated_by: authorization.userId,
    p_request_id: request.requestId,
    p_action: request.action,
    p_target_id: targetId,
    p_request_hash: request.requestHash,
    p_response: response,
  });
  if (commitError) throw createHttpError(502, "The finance action could not be saved.");
  if (result?.status === "conflict") throw createHttpError(409, "The workspace changed since you loaded it. Reload and try again; nothing was saved.");
  if (result?.status === "request_id_reused") throw createHttpError(409, "This requestId was already used for a different request.");
  if (result?.status === "replayed") return { statusCode: 200, payload: { ok: true, replayed: true, ...result.response } };
  return { statusCode: 200, payload: { ok: true, replayed: false, ...result.response } };
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed. Use POST /api/business/finance-actions." });
  }
  try {
    const { statusCode, payload } = await handleFinanceAction(req);
    return sendJson(res, statusCode, payload);
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    return sendJson(res, statusCode, statusCode >= 500 ? { error: "Unable to complete the finance action." } : { error: error.message });
  }
}
