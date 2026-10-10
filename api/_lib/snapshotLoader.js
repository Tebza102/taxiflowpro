import { mockSnapshot } from "../../src/data/mockData.js";
import { annotateActors, loadBusinessActors } from "./actorNames.js";
import { projectWorkspace, resolveWorkspaceScope } from "./scopedWorkspace.js";
import {
  authorizeBusinessRequest,
  buildRequester,
  createHttpError,
  getBearerToken,
  readBusinessSnapshot,
} from "./tenantAuth.js";

// Loads the caller's business snapshot through the shared tenant authorization
// boundary (tenantAuth.js): token validated, active membership resolved from the
// database, explicit business selection when the caller has more than one, and
// service-role access only after that. There is no fallback to the legacy
// 'taxiflow-live' row. The returned snapshot is role-scoped: a Driver receives
// only the driver projection for their linked staff id, never the whole
// snapshot (scopedWorkspace.projectWorkspace).

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));

const normalizeMode = (value) => {
  const normalized = String(value ?? "auto").trim().toLowerCase();
  return ["auto", "live", "mock"].includes(normalized) ? normalized : "auto";
};

const scopeFor = (requester) =>
  resolveWorkspaceScope({
    email: requester.email,
    role: requester.role,
    staffId: requester.driverStaffId,
    moduleAccess: requester.moduleAccess,
    active: true,
  });

const loadAuthorizedLiveSnapshot = async (req) => {
  const authorization = await authorizeBusinessRequest(req);
  const row = await readBusinessSnapshot(authorization);
  const requester = buildRequester(authorization, row.snapshot);
  const scope = scopeFor(requester);
  if (!scope) throw createHttpError(403, "Your membership does not grant access to this business's workspace.");

  const member = { email: requester.email, role: requester.role, staffId: requester.driverStaffId, active: true };
  // Actor names come from this business's members only, resolved after the
  // role projection so a scoped caller learns no names outside its view.
  const actors = await loadBusinessActors(authorization);
  const annotated = annotateActors(projectWorkspace(cloneSnapshot(row.snapshot), member, scope), actors);
  return {
    snapshot: annotated.snapshot,
    actorNames: annotated.names,
    source: "live",
    workspaceKey: row.workspace_key,
    businessId: authorization.businessId,
    version: row.updated_at,
    scope,
    requestedBy: requester,
  };
};

export const loadServerSnapshot = async ({ req, mode } = {}) => {
  const resolvedMode = normalizeMode(mode ?? req?.query?.mode);
  const accessToken = getBearerToken(req);

  if (resolvedMode === "mock") {
    // Demo data, but a signed-in caller is still authorized through the tenant
    // boundary so role gates apply. Only an unauthenticated request gets
    // requestedBy null (non-production only, enforced by the report gate).
    let requestedBy = null;
    let businessId = null;
    if (accessToken) {
      const authorization = await authorizeBusinessRequest(req);
      requestedBy = buildRequester(authorization, null);
      businessId = authorization.businessId;
    }
    return { snapshot: cloneSnapshot(mockSnapshot), source: "mock", workspaceKey: null, businessId, scope: null, requestedBy };
  }

  if (accessToken) return loadAuthorizedLiveSnapshot(req);

  if (resolvedMode === "live") {
    throw createHttpError(401, "A Supabase access token is required when mode=live is requested.");
  }

  if (process.env.NODE_ENV !== "production") {
    return { snapshot: cloneSnapshot(mockSnapshot), source: "mock", workspaceKey: null, businessId: null, scope: null, requestedBy: null };
  }

  throw createHttpError(401, "This endpoint requires a Supabase access token in production.");
};

export { createHttpError };
