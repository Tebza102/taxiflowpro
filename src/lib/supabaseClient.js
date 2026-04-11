import { createClient } from "@supabase/supabase-js";
import { logStartupError, logStartupEvent } from "./runtimeDiagnostics";

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

let supabaseClient = null;

if (hasSupabaseConfig) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    logStartupEvent("api-init", {
      mode: configuredBackendMode,
      provider: "supabase",
      hasSupabaseConfig,
    });
  } catch (error) {
    logStartupError("api-init-failed", error, {
      mode: configuredBackendMode,
      provider: "supabase",
    });
  }
} else {
  logStartupEvent("api-init", {
    mode: configuredBackendMode,
    provider: "local",
    hasSupabaseConfig,
  });
}

export const supabase = supabaseClient;
