import { loadServerSnapshot } from "../_lib/snapshotLoader.js";

// GET /api/business/workspace[?business=<uuid>] -> the caller's role-scoped
// business workspace, its version (for compare-and-swap writes) and actor
// names resolved within that business. Tenant authorization runs first
// (snapshotLoader -> tenantAuth). Never falls back to taxiflow-live or demo data.

const text = (value) => String(value ?? "").trim();

// The caller's own directory entry carries the AUTHORITATIVE membership role and
// driver linkage, so the existing UI role logic follows the membership, never a
// stale or edited appUsers value.
export const withAuthoritativeSelf = (snapshot, requester) => {
  const email = text(requester.email).toLowerCase();
  const users = Array.isArray(snapshot.appUsers) ? snapshot.appUsers : [];
  let found = false;
  const appUsers = users.map((user) => {
    if (text(user?.email).toLowerCase() !== email) return user;
    found = true;
    return { ...user, role: requester.role, staffId: requester.driverStaffId ?? null, active: true };
  });
  if (!found && email) appUsers.push({ email: requester.email, name: requester.email, role: requester.role, staffId: requester.driverStaffId ?? null, active: true });
  return { ...snapshot, appUsers };
};

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end(JSON.stringify({ error: "Method not allowed." }));
  }
  try {
    const result = await loadServerSnapshot({ req, mode: "live" });
    const requester = result.requestedBy;
    const snapshot = withAuthoritativeSelf(result.snapshot, requester);
    const actorNames = result.actorNames ?? {};
    res.statusCode = 200;
    return res.end(JSON.stringify({
      businessId: result.businessId,
      role: requester.role,
      driverStaffId: requester.driverStaffId,
      scope: result.scope,
      version: result.version,
      actorNames,
      snapshot,
    }));
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    res.statusCode = statusCode;
    return res.end(JSON.stringify({ error: statusCode >= 500 ? "Unable to load the business workspace." : error.message }));
  }
}
