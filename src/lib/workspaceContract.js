// Single source of truth for the live workspace identity. Both the browser client
// and every server-side script/API route must resolve to this exact same
// workspace_snapshots.workspace_key - a split-brain between them (client hardcoding
// one value, server reading a differently-configured env var) means writes and
// reads silently talk to different rows.
export const LIVE_WORKSPACE_KEY = "taxiflow-live";
