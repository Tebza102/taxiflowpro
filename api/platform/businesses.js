import { createCompany, listCompanies } from "../_lib/platformAdmin.js";
import { authorizePlatformRequest, createHttpError } from "../_lib/tenantAuth.js";

// GET  /api/platform/businesses -> companies (metadata only: name, slug, Owners,
//      active member count). Platform admin only.
// POST /api/platform/businesses -> { action: "company.create", fields: { name,
//      slug?, ownerEmail, ownerName?, ownerDrives? } }. Platform admin only.
// Authorization: a valid token AND an active public.platform_admins row for the
// caller (operator-granted). Business roles, Owner included, never qualify.
// Repeating the same create is safe (idempotent by slug and Owner).

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
      const authorization = await authorizePlatformRequest(req);
      return sendJson(res, 200, { ok: true, ...(await listCompanies(authorization)) });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(res, 405, { ok: false, error: "Method not allowed." });
    }
    const authorization = await authorizePlatformRequest(req);
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      throw error?.statusCode ? error : createHttpError(400, "The request body must be valid JSON.");
    }
    if (body?.action !== "company.create") throw createHttpError(400, "Unsupported platform action.");
    const fields = body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields : null;
    if (!fields) throw createHttpError(400, "The company details are required.");
    const result = await createCompany(authorization, fields, { redirectTo: setupRedirect(req) });
    return sendJson(res, 200, { ok: true, action: body.action, ...result });
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode >= 500 && !error?.statusCode ? "The platform request could not be completed." : error.message,
      ...(error?.partial ? { partial: error.partial, recovery: "No company access was granted. Repeat the same request to finish it." } : {}),
    });
  }
}
