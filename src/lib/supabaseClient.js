import { createClient } from "@supabase/supabase-js";

const normalizeBackendMode = (value) => {
  const normalized = String(value ?? "mock").trim().toLowerCase();

  if (["live", "supabase"].includes(normalized)) {
    return "live";
  }

  if (["mock", "dummy", "demo"].includes(normalized)) {
    return "mock";
  }

  return "mock";
};

export const configuredBackendMode = normalizeBackendMode(import.meta.env.VITE_BACKEND_MODE);
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes("your-project-url") &&
  !supabaseAnonKey.includes("your-anon-key");

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
