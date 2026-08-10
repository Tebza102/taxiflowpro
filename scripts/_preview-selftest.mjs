import { createServiceClient } from "../api/_lib/userLifecycle.js";

// TEMPORARY, Preview-only, read-only diagnostic. Reports project-ref match,
// workspace-key match, and a non-secret inventory of every workspace_snapshots row
// (counts only, never full snapshot contents). No writes of any kind.
//
// Hard-gated to Preview + this exact branch; no-ops everywhere else, including
// Production. Always exits 0. Temporary - removed once the result is read.

const log = (...args) => console.log("[preview-diag]", ...args);

const isTargetEnvironment =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "agent/owner-first-auth-reset";

if (!isTargetEnvironment) {
  log(
    `skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}, VERCEL_GIT_COMMIT_REF=${process.env.VERCEL_GIT_COMMIT_REF ?? "unset"})`,
  );
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_WORKSPACE_KEY_RAW = process.env.SUPABASE_WORKSPACE_KEY;

const projectRefOf = (url) => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
};

const main = async () => {
  // --- A. Supabase project consistency ---
  const serverRef = projectRefOf(SUPABASE_URL);
  const frontendRef = projectRefOf(VITE_SUPABASE_URL);
  log(`SERVER_PROJECT_REF: ${serverRef ?? "unresolved"}`);
  log(`FRONTEND_PROJECT_REF: ${frontendRef ?? "unresolved"}`);
  log(`PROJECT_MATCH: ${serverRef && frontendRef && serverRef === frontendRef ? "YES" : "NO"}`);

  // --- B. Workspace-key consistency ---
  const serverKey = String(SUPABASE_WORKSPACE_KEY_RAW ?? "").trim() || "taxiflow-live";
  const clientKey = "taxiflow-live";
  log(`SERVER_WORKSPACE_KEY: ${serverKey}`);
  log(`CLIENT_WORKSPACE_KEY: ${clientKey}`);
  log(`KEY_MATCH: ${serverKey === clientKey ? "YES" : "NO"}`);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    log("C: skipped (no service-role credentials in this build).");
    process.exit(0);
  }

  // --- C. Full non-secret inventory of workspace_snapshots ---
  const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: rows, error } = await supabase
    .from("workspace_snapshots")
    .select("workspace_key, updated_at, updated_by, snapshot");

  if (error) {
    log(`C: FAILED to read workspace_snapshots: ${error.message}`);
    process.exit(0);
  }

  log(`C: total rows in workspace_snapshots: ${rows?.length ?? 0}`);

  for (const row of rows ?? []) {
    const s = row.snapshot ?? {};
    const appUsers = Array.isArray(s.appUsers) ? s.appUsers : [];
    const ownerCount = appUsers.filter((u) => u.role === "Owner").length;
    log(
      JSON.stringify({
        workspace_key: row.workspace_key,
        updated_at: row.updated_at,
        appUsersCount: appUsers.length,
        ownerCount,
        financeTransactionsCount: Array.isArray(s.financeTransactions) ? s.financeTransactions.length : 0,
        vehiclesCount: Array.isArray(s.vehicles) ? s.vehicles.length : 0,
        driversCount: Array.isArray(s.drivers) ? s.drivers.length : 0,
        routesCount: Array.isArray(s.routes) ? s.routes.length : 0,
        dailyCashUpsCount: Array.isArray(s.dailyCashUps) ? s.dailyCashUps.length : 0,
      }),
    );
  }

  log("DIAGNOSTIC COMPLETE");
};

main()
  .catch((error) => log("DIAGNOSTIC FAILED:", error?.message ?? error))
  .finally(() => process.exit(0));
