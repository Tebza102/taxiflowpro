import { authorizeBusinessRequest, createHttpError } from "../_lib/tenantAuth.js";
import { MEMBER_ACTIONS, listMembers, saveDriverProfile } from "../_lib/tenantOnboarding.js";

// GET  /api/business/members[?business=]  -> members + driver profiles (Owner/Admin)
// POST /api/business/members[?business=]  -> { action, fields } (Owner only):
//   member.grant { email, name?, role: Admin|Manager|Driver, driverStaffId?, moduleAccess? }
//   member.update { userId, role?, driverStaffId?, moduleAccess?, name? }
//   member.deactivate { userId } / member.reactivate { userId }
//   member.permissions { userId, permissions: [...] } (Admin/Manager responsibilities)
//   owner.link_driver { driverStaffId | null }   (the Owner's own login)
//   driver.save_profile { staffId?, name, phone? } (a profile, no sign-in;
//     Owner, or staff holding drivers.manage)
// Authorization: tenantAuth (token + ACTIVE membership + explicit business).
// Every change is recomputed from the current server state, so repeating a
// request is safe. A partial failure reports what exists (an Auth account
// without a membership has no access) and the same request can be retried.

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
  if (raw.length > 16_384) throw createHttpError(413, "Request body too large.");
  return raw ? JSON.parse(raw) : null;
};

const setupRedirect = (req) => {
  const host = String(req.headers?.host ?? "").trim();
  if (!host) return undefined;
  const proto = /^(127\.0\.0\.1|localhost)(:|$)/.test(host) ? "http" : "https";
  return `${proto}://${host}/`;
};

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const authorization = await authorizeBusinessRequest(req);
      return sendJson(res, 200, { ok: true, businessId: authorization.businessId, ...(await listMembers(authorization)) });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      throw error?.statusCode ? error : createHttpError(400, "The request body must be valid JSON.");
    }
    const action = String(body?.action ?? "");
    const fields = body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields : {};
    if (action !== "driver.save_profile" && !MEMBER_ACTIONS[action]) throw createHttpError(400, "Unsupported access action.");
    const authorization = await authorizeBusinessRequest(req);
    const result =
      action === "driver.save_profile"
        ? await saveDriverProfile(authorization, fields)
        : await MEMBER_ACTIONS[action](authorization, fields, { redirectTo: setupRedirect(req) });
    return sendJson(res, 200, { ok: true, action, ...result });
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode >= 500 && !error?.statusCode ? "The access change could not be completed." : error.message,
      ...(error?.partial ? { partial: error.partial, recovery: "Nothing was granted. Repeat the same request to finish it; an account without a membership has no access." } : {}),
    });
  }
}
