import { createClient } from "@supabase/supabase-js";

import { mockSnapshot } from "../../src/data/mockData.js";
import { normalizeModuleViewAccess } from "../../src/lib/moduleAccessPolicy.js";
import { resolveServerWorkspaceKey } from "./workspaceKey.js";

// The workspace_snapshots RLS policy grants read/write to any authenticated
// user (`using (true)`) - it is not scoped per caller. That's only safe because
// this app is single-tenant: there is exactly one canonical workspace row,
// resolved server-side via resolveServerWorkspaceKey(). Never resolve the
// workspace key from caller-supplied input (query params, body) - doing so
// would let an authenticated caller target an arbitrary workspace_key with no
// ownership check at all. If this product ever becomes multi-tenant, real
// isolation additionally requires per-user RLS policies keyed to a workspace
// membership table, not just a differently-sourced key.
const LIVE_WORKSPACE_KEY = resolveServerWorkspaceKey();

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeMode = (value) => {
  const normalized = String(value ?? "auto").trim().toLowerCase();

  return ["auto", "live", "mock"].includes(normalized) ? normalized : "auto";
};

const getHeaderValue = (headers, key) => {
  if (!headers) {
    return null;
  }

  const directValue = headers[key] ?? headers[key.toLowerCase()] ?? null;

  if (Array.isArray(directValue)) {
    return directValue[0] ?? null;
  }

  return directValue ?? null;
};

const getBearerToken = (req) => {
  const authorization = String(getHeaderValue(req?.headers, "authorization") ?? "").trim();

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
};

const getSupabaseUrl = () =>
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;

const getSupabaseAnonKey = () =>
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || null;

const createAuthenticatedSnapshotClient = (accessToken) => {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
};

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

// Role comes from the caller's ACTIVE entry in the live account directory
// (snapshot.appUsers), matched on the email Supabase verified for the token -
// the same "valid Auth identity + active membership" rule the user-management
// endpoints use. Token metadata is never trusted for the role: user_metadata is
// editable by the signed-in user, so reading it would let a caller pick a role.
export const resolveRequester = (user, liveSnapshot) => {
  const email = normalizeEmail(user?.email);
  const member = email
    ? (liveSnapshot?.appUsers ?? []).find((entry) => normalizeEmail(entry?.email) === email)
    : null;
  const activeMember = member && member.active !== false ? member : null;

  return {
    id: user?.id ?? null,
    email: user?.email ?? null,
    role: activeMember?.role ?? null,
    activeMember: Boolean(activeMember),
    // Same normalisation the browser applies, so the Owner's per-account toggles
    // (e.g. Money off) mean the same thing here as in the UI.
    moduleAccess: activeMember
      ? normalizeModuleViewAccess(activeMember.moduleAccess, activeMember.role)
      : null,
  };
};

const authenticateAccessToken = async (accessToken) => {
  const supabase = createAuthenticatedSnapshotClient(accessToken);

  if (!supabase) {
    throw createHttpError(
      503,
      "Supabase server configuration is incomplete for the live daily log report view.",
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    throw createHttpError(401, "The supplied Supabase access token is invalid or expired.");
  }

  return { supabase, user };
};

const readLiveWorkspaceSnapshot = async (supabase, workspaceKey) => {
  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", workspaceKey)
    .maybeSingle();

  if (error) {
    throw createHttpError(502, "Unable to load the live workspace snapshot.");
  }

  if (!data?.snapshot) {
    throw createHttpError(404, "The live workspace snapshot could not be found.");
  }

  return data.snapshot;
};

const loadLiveSnapshot = async ({ accessToken, workspaceKey = LIVE_WORKSPACE_KEY } = {}) => {
  if (!accessToken) {
    throw createHttpError(
      401,
      "A Supabase access token is required to load the live daily log report view.",
    );
  }

  const { supabase, user } = await authenticateAccessToken(accessToken);
  const liveSnapshot = await readLiveWorkspaceSnapshot(supabase, workspaceKey);

  return {
    snapshot: cloneSnapshot(liveSnapshot),
    source: "live",
    workspaceKey,
    requestedBy: resolveRequester(user, liveSnapshot),
  };
};

export const loadServerSnapshot = async ({ req, mode } = {}) => {
  const resolvedMode = normalizeMode(mode ?? req?.query?.mode);
  const accessToken = getBearerToken(req);

  if (resolvedMode === "mock") {
    // Demo data is served to a signed-in caller as that caller: membership and
    // role are still resolved from the live directory, so role gates apply.
    // Only an unauthenticated request gets requestedBy null (dev-only, enforced
    // by the report access gate).
    let requestedBy = null;

    if (accessToken) {
      const { supabase, user } = await authenticateAccessToken(accessToken);
      requestedBy = resolveRequester(user, await readLiveWorkspaceSnapshot(supabase, LIVE_WORKSPACE_KEY));
    }

    return {
      snapshot: cloneSnapshot(mockSnapshot),
      source: "mock",
      workspaceKey: null,
      requestedBy,
    };
  }

  if (accessToken) {
    // Always the canonical, server-resolved key - never caller-supplied (see
    // the note above LIVE_WORKSPACE_KEY).
    return loadLiveSnapshot({ accessToken, workspaceKey: LIVE_WORKSPACE_KEY });
  }

  if (resolvedMode === "live") {
    throw createHttpError(
      401,
      "A Supabase access token is required when mode=live is requested for the report view.",
    );
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      snapshot: cloneSnapshot(mockSnapshot),
      source: "mock",
      workspaceKey: null,
      requestedBy: null,
    };
  }

  throw createHttpError(
    401,
    "This report view endpoint requires a Supabase access token in production.",
  );
};

export { createHttpError };
