import { listCallerBusinesses } from "../_lib/tenantAuth.js";

// GET /api/business/memberships -> the caller's ACTIVE businesses (for the
// browser's business selector). Read with the caller's own token; no service role.
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end(JSON.stringify({ error: "Method not allowed." }));
  }
  try {
    const result = await listCallerBusinesses(req);
    res.statusCode = 200;
    return res.end(JSON.stringify(result));
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    res.statusCode = statusCode;
    return res.end(JSON.stringify({ error: statusCode >= 500 ? "Unable to load your businesses." : error.message }));
  }
}
