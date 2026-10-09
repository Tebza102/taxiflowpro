import { LIVE_WORKSPACE_KEY } from "../../src/lib/workspaceContract.js";

export { LIVE_WORKSPACE_KEY };

// Server-only resolver. Never silently defers to SUPABASE_WORKSPACE_KEY when it
// diverges from the canonical key - that divergence is exactly what previously
// caused server-side code (API routes, the Owner reset script) to read/write a
// different, nonexistent row than the one the browser client always uses. The
// canonical key always wins; a mismatch is surfaced as a warning so the stray env
// var can be found and removed/corrected in Vercel.
export const resolveServerWorkspaceKey = () => {
  const configured = String(process.env.SUPABASE_WORKSPACE_KEY ?? "").trim();

  if (configured && configured !== LIVE_WORKSPACE_KEY) {
    console.warn(
      `[workspaceKey] SUPABASE_WORKSPACE_KEY is set to "${configured}", which differs from ` +
        `the canonical live workspace key "${LIVE_WORKSPACE_KEY}". Ignoring the override and ` +
        `using the canonical key. Remove or correct SUPABASE_WORKSPACE_KEY to silence this warning.`,
    );
  }

  return LIVE_WORKSPACE_KEY;
};
