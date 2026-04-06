import { createClient } from "@supabase/supabase-js";

import { mockSnapshot } from "../../src/data/mockData.js";

const LIVE_WORKSPACE_KEY = process.env.SUPABASE_WORKSPACE_KEY || "taxiflow-live";

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

const loadLiveSnapshot = async ({ accessToken, workspaceKey = LIVE_WORKSPACE_KEY }) => {
  if (!accessToken) {
    throw createHttpError(
      401,
      "A Supabase access token is required to load the live daily log report view.",
    );
  }

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

  return {
    snapshot: cloneSnapshot(data.snapshot),
    source: "live",
    workspaceKey,
    requestedBy: {
      id: user.id,
      email: user.email ?? null,
    },
  };
};

export const loadServerSnapshot = async ({ req, mode, workspaceKey } = {}) => {
  const resolvedMode = normalizeMode(mode ?? req?.query?.mode);

  if (resolvedMode === "mock") {
    return {
      snapshot: cloneSnapshot(mockSnapshot),
      source: "mock",
      workspaceKey: null,
      requestedBy: null,
    };
  }

  const accessToken = getBearerToken(req);

  if (accessToken) {
    return loadLiveSnapshot({
      accessToken,
      workspaceKey:
        String(workspaceKey ?? req?.query?.workspaceKey ?? LIVE_WORKSPACE_KEY).trim() ||
        LIVE_WORKSPACE_KEY,
    });
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
