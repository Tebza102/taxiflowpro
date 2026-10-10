import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from "./browserRuntime";
import { supabase } from "./supabaseClient";

// Tenant-aware browser data path (VITE_TENANT_MODE=true). Reads come from
// GET /api/business/workspace (role-scoped, membership-authorized); writes are
// explicit POST /api/business/finance-actions. There is no direct
// workspace_snapshots access, no whole-snapshot save, no snapshot cache in
// browser storage, and no fallback to taxiflow-live or demo data.
//
// Only the SELECTED BUSINESS ID is remembered, per signed-in user. Loaded data,
// the loaded version and pending request ids live in memory and are dropped
// whenever the signed-in user or the selected business changes.

export const isTenantMode = import.meta.env?.VITE_TENANT_MODE === "true";

export const TENANT_UNSUPPORTED_MESSAGE =
  "This change is not available in the business workspace yet. Nothing was saved.";

// Trip legs carry only the fields the server accepts (financeCapture LEG_FIELDS);
// computed analytics are recalculated server-side.
const TRIP_LEG_FIELDS = ["fromLocation", "toLocation", "departingFromPoint", "goingToPoint", "passengerCount", "amountCollected", "timeIn", "timeOut", "odometerStart", "odometerEnd"];
export const toTenantTripLeg = (leg = {}) =>
  Object.fromEntries(TRIP_LEG_FIELDS.filter((key) => leg[key] !== undefined && leg[key] !== null && leg[key] !== "").map((key) => [key, leg[key]]));

const selectionKey = (userId) => `taxiflow-tenant-business:${userId}`;

let context = { userId: null, businessId: null, version: null, role: null };
let pendingRequests = new Map(); // requestKey -> requestId (same request only)
let knownBusinesses = [];

const resetIfContextChanged = (userId, businessId) => {
  if (context.userId !== userId || context.businessId !== businessId) {
    pendingRequests = new Map();
    context = { userId, businessId, version: null, role: null };
  }
};

const getSession = async () => {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ?? null;
};

const apiFetch = async (path, { method = "GET", body, businessId } = {}) => {
  const session = await getSession();
  if (!session?.access_token) return { status: 401, json: { error: "Sign in is required." }, userId: null };
  const url = new URL(path, window.location.origin);
  if (businessId) url.searchParams.set("business", businessId);
  const response = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let json = {};
  try {
    json = await response.json();
  } catch {
    json = {};
  }
  return { status: response.status, json, userId: session.user?.id ?? null };
};

export const getSelectedBusinessId = (userId) => (userId ? safeLocalStorageGet(selectionKey(userId)) : null);
export const getKnownBusinesses = () => knownBusinesses;
export const getActiveBusinessId = () => (isTenantMode ? context.businessId : null);

export const listBusinesses = async () => {
  const { status, json } = await apiFetch("/api/business/memberships");
  if (status !== 200) return { ok: false, error: json.error ?? "Unable to load your businesses.", businesses: [] };
  knownBusinesses = json.businesses ?? [];
  return { ok: true, businesses: knownBusinesses, userId: json.userId };
};

export const selectBusiness = (userId, businessId) => {
  if (!userId) return;
  if (businessId) safeLocalStorageSet(selectionKey(userId), businessId);
  else safeLocalStorageRemove(selectionKey(userId));
  resetIfContextChanged(userId, businessId ?? null);
};

// Returns { ok, snapshot, meta } | { ok:false, needsSelection, businesses } | { ok:false, error }.
export const loadWorkspace = async () => {
  const session = await getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return { ok: false, error: "Sign in is required." };
  const listed = await listBusinesses();
  if (!listed.ok) return { ok: false, error: listed.error };
  if (listed.businesses.length === 0) return { ok: false, error: "Your account has no active business membership." };

  let businessId = getSelectedBusinessId(userId);
  if (businessId && !listed.businesses.some((b) => b.businessId === businessId)) {
    selectBusiness(userId, null);
    businessId = null;
  }
  if (!businessId && listed.businesses.length === 1) businessId = listed.businesses[0].businessId;
  if (!businessId) {
    resetIfContextChanged(userId, null);
    return { ok: false, needsSelection: true, businesses: listed.businesses };
  }

  resetIfContextChanged(userId, businessId);
  const { status, json } = await apiFetch("/api/business/workspace", { businessId });
  if (status !== 200) return { ok: false, error: json.error ?? "Unable to load the business workspace." };
  context = { userId, businessId, version: json.version, role: json.role };
  return {
    ok: true,
    snapshot: json.snapshot,
    meta: {
      source: "tenant-server",
      liveVersion: json.version,
      businessId,
      businessName: listed.businesses.find((b) => b.businessId === businessId)?.name ?? null,
      businesses: listed.businesses,
      role: json.role,
      driverStaffId: json.driverStaffId,
      scope: json.scope,
      actorNames: json.actorNames ?? {},
      tenant: true,
    },
  };
};

const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16));

// requestKey identifies ONE user request (e.g. "capture:<draft key>"). The same
// requestId is reused only when that same request is retried after a network
// failure; any server answer (success or refusal) retires it.
export const runFinanceAction = async (requestKey, action, fields) => {
  if (!context.businessId || !context.version) {
    return { ok: false, error: "The workspace is not loaded. Refresh before saving." };
  }
  const key = `${context.userId}:${context.businessId}:${requestKey}`;
  const requestId = pendingRequests.get(key) ?? newRequestId();
  pendingRequests.set(key, requestId);
  let result;
  try {
    result = await apiFetch("/api/business/finance-actions", {
      method: "POST",
      businessId: context.businessId,
      body: { action, requestId, expectedVersion: context.version, fields },
    });
  } catch {
    return { ok: false, retryable: true, error: "Network error. Your entry was kept; try again to resend the same request." };
  }
  pendingRequests.delete(key);
  if (result.status === 200) return { ok: true, ...result.json };
  const conflict = result.status === 409 && /changed since you loaded|reload/i.test(result.json.error ?? "");
  return {
    ok: false,
    conflict,
    status: result.status,
    error: conflict
      ? "Someone else saved changes to this business since you loaded it. Your entry was kept; refresh the workspace, then save again."
      : result.json.error ?? "The action could not be completed.",
  };
};

export const clearTenantState = () => {
  pendingRequests = new Map();
  knownBusinesses = [];
  context = { userId: null, businessId: null, version: null, role: null };
};
