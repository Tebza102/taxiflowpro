import { createClient } from "@supabase/supabase-js";

import { normalizeModuleViewAccess } from "../../src/lib/moduleAccessPolicy.js";

// Shared server authorization boundary for business (tenant) data.
//
// 1. The caller's Supabase access token is validated by Supabase Auth.
// 2. The caller's ACTIVE business memberships are read from the database with
//    the caller's own token (RLS limits the rows to the caller; the query also
//    filters user_id and active explicitly).
// 3. The business is the explicit selection (?business= or the
//    x-taxiflow-business header) or, only when the caller has exactly one active
//    membership, that one. There is never a fallback to the legacy
//    'taxiflow-live' workspace or to any shared business.
// 4. Roles come ONLY from business_memberships. Browser input, token
//    user/app metadata and snapshot.appUsers never decide a role or a membership.
// 5. Service-role access is used only after 1-3 succeeded, and only for the
//    authorized business.

export const MEMBERSHIP_ROLES = Object.freeze(["Owner", "Admin", "Manager", "Driver"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BUSINESS_HEADER = "x-taxiflow-business";

export const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const headerValue = (headers, key) => {
  if (!headers) return null;
  const value = headers[key] ?? headers[key.toLowerCase()] ?? null;
  return Array.isArray(value) ? value[0] ?? null : value;
};

const queryValue = (value) => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export const getBearerToken = (req) => {
  const authorization = String(headerValue(req?.headers, "authorization") ?? "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice(7).trim() || null;
};

// Explicit business selection from the request. A malformed value is an error,
// not "no selection" (which could silently pick a default).
export const getRequestedBusinessId = (req) => {
  const fromQuery = queryValue(req?.query?.business);
  const fromHeader = headerValue(req?.headers, BUSINESS_HEADER);
  const values = [fromQuery, fromHeader].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (values.length === 0) return null;
  if (new Set(values.map((value) => value.toLowerCase())).size > 1) {
    throw createHttpError(400, "Conflicting business selections were supplied.");
  }
  if (!UUID.test(values[0])) throw createHttpError(400, "The selected business id is not valid.");
  return values[0].toLowerCase();
};

const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
const anonKey = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || null;
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || null;

const callerClient = (accessToken) => {
  if (!supabaseUrl() || !anonKey()) {
    throw createHttpError(503, "Supabase server configuration is incomplete.");
  }
  return createClient(supabaseUrl(), anonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
};

// Pure selection rule (unit-tested): which active membership authorizes this
// request, given the explicit selection.
export const selectMembership = (memberships, requestedBusinessId) => {
  const active = (memberships ?? []).filter((m) => m && m.active === true && MEMBERSHIP_ROLES.includes(m.role));
  if (requestedBusinessId) {
    const match = active.find((m) => String(m.business_id).toLowerCase() === requestedBusinessId);
    if (!match) throw createHttpError(403, "You are not an active member of the selected business.");
    return match;
  }
  if (active.length === 0) throw createHttpError(403, "You do not have an active business membership.");
  if (active.length > 1) {
    throw createHttpError(400, "You belong to more than one business; select one explicitly.");
  }
  return active[0];
};

export const authorizeBusinessRequest = async (req) => {
  const accessToken = getBearerToken(req);
  if (!accessToken) throw createHttpError(401, "A Supabase access token is required.");
  const requestedBusinessId = getRequestedBusinessId(req);

  const client = callerClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser(accessToken);
  if (userError || !user?.id) throw createHttpError(401, "The supplied Supabase access token is invalid or expired.");

  const { data: memberships, error: membershipError } = await client
    .from("business_memberships")
    .select("business_id, role, driver_staff_id, active")
    .eq("user_id", user.id)
    .eq("active", true);
  if (membershipError) throw createHttpError(403, "Business membership could not be verified.");

  const membership = selectMembership(memberships, requestedBusinessId);
  return {
    userId: user.id,
    email: user.email ?? null,
    businessId: String(membership.business_id).toLowerCase(),
    role: membership.role,
    driverStaffId: membership.driver_staff_id ? String(membership.driver_staff_id) : null,
    activeMembershipCount: (memberships ?? []).length,
  };
};

// The caller's active businesses, read with the caller's own token (RLS:
// own active memberships, businesses they belong to). No service role.
export const listCallerBusinesses = async (req) => {
  const accessToken = getBearerToken(req);
  if (!accessToken) throw createHttpError(401, "A Supabase access token is required.");
  const client = callerClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser(accessToken);
  if (userError || !user?.id) throw createHttpError(401, "The supplied Supabase access token is invalid or expired.");
  const { data: memberships, error } = await client
    .from("business_memberships")
    .select("business_id, role, driver_staff_id, active")
    .eq("user_id", user.id)
    .eq("active", true);
  if (error) throw createHttpError(403, "Business membership could not be verified.");
  const ids = (memberships ?? []).filter((m) => MEMBERSHIP_ROLES.includes(m.role)).map((m) => m.business_id);
  const { data: businesses } = ids.length
    ? await client.from("businesses").select("id, name").in("id", ids)
    : { data: [] };
  const names = new Map((businesses ?? []).map((b) => [String(b.id).toLowerCase(), b.name]));
  return {
    userId: user.id,
    email: user.email ?? null,
    businesses: (memberships ?? [])
      .filter((m) => MEMBERSHIP_ROLES.includes(m.role))
      .map((m) => ({ businessId: String(m.business_id).toLowerCase(), name: names.get(String(m.business_id).toLowerCase()) ?? "Business", role: m.role, driverLinked: Boolean(m.driver_staff_id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

// Service role is created only for an already-authorized request, and every
// query it runs is pinned to that request's business.
export const serviceClientFor = (authorization) => {
  if (!authorization?.businessId || !authorization?.role) {
    throw createHttpError(500, "Service access requested without an authorized business.");
  }
  if (!supabaseUrl() || !serviceKey()) {
    throw createHttpError(503, "Supabase server configuration is incomplete.");
  }
  return createClient(supabaseUrl(), serviceKey(), { auth: { autoRefreshToken: false, persistSession: false } });
};

export const readBusinessSnapshot = async (authorization) => {
  const service = serviceClientFor(authorization);
  const { data, error } = await service
    .from("workspace_snapshots")
    .select("workspace_key, business_id, snapshot, updated_at")
    .eq("business_id", authorization.businessId)
    .maybeSingle();
  if (error) throw createHttpError(502, "Unable to load the business snapshot.");
  if (!data?.snapshot) throw createHttpError(404, "The business snapshot could not be found.");
  if (String(data.business_id).toLowerCase() !== authorization.businessId) {
    throw createHttpError(500, "Snapshot business mismatch.");
  }
  return data;
};

// The requester as the rest of the server sees it. Role, business and driver
// linkage come from the membership. The Owner's per-account module toggles in
// the business snapshot can only NARROW what the membership role allows
// (normalizeModuleViewAccess caps every module by role); they never grant.
export const buildRequester = (authorization, storedSnapshot) => {
  const email = String(authorization.email ?? "").trim().toLowerCase();
  const toggles = email
    ? (storedSnapshot?.appUsers ?? []).find((entry) => String(entry?.email ?? "").trim().toLowerCase() === email)?.moduleAccess
    : undefined;
  return {
    id: authorization.userId,
    email: authorization.email,
    role: authorization.role,
    businessId: authorization.businessId,
    driverStaffId: authorization.driverStaffId,
    activeMember: true,
    moduleAccess: normalizeModuleViewAccess(toggles ?? {}, authorization.role),
  };
};
