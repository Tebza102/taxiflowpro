// Which data path a browser build uses. There are exactly two:
//  - tenant: any build that can reach a real Supabase project, or is configured
//    as live. Data comes only from the membership-authorized /api/business/*
//    routes; the legacy direct workspace_snapshots path is never used.
//  - demo: a build with no real Supabase settings. It runs on local demo data
//    only and has no network data path at all.
// There is no build flag that selects the legacy live path.
export const resolveTenantMode = ({ hasSupabaseConfig = false, configuredBackendMode = "mock" } = {}) =>
  Boolean(hasSupabaseConfig) || configuredBackendMode === "live";

export const LEGACY_LIVE_ACCESS_REFUSED =
  "The legacy workspace path is disabled. Business data loads only through business access.";
