import { configuredBackendMode, hasSupabaseConfig, supabase } from "../lib/supabaseClient";
import { StartupFallback } from "./StartupFallback";

export function ProductionAuthGuard({ children }) {
  const liveMode = configuredBackendMode === "live";
  const secureAuthReady = hasSupabaseConfig && Boolean(supabase);

  if (liveMode && !secureAuthReady) {
    return (
      <StartupFallback
        title="Secure sign-in is unavailable."
        message="TaxiFlow live mode requires Supabase authentication. Please contact the system administrator."
        showDiagnostics={false}
      />
    );
  }

  return children;
}
