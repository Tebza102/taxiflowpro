import { createClient } from "@supabase/supabase-js";

// Same construction already used by scripts/reset-production-users.mjs and
// scripts/reconcile-production-users.mjs - a service-role client that never persists
// or auto-refreshes a session, since it only ever performs one-shot admin calls.
export const createUatServiceClient = ({ supabaseUrl, serviceRoleKey }) => {
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

// Only ever used to print/compare the short project-ref segment (e.g. "abcdefgh"
// out of "https://abcdefgh.supabase.co") - never the full URL, and never a key.
export const extractProjectRef = (supabaseUrl) => {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0];
  } catch {
    return null;
  }
};
