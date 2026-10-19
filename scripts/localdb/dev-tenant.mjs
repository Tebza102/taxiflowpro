#!/usr/bin/env node
// Runs the Vite dev server in tenant mode against the LOCAL synthetic stack only
// (VITE_BACKEND_MODE=live; hosted builds are always tenant). Keys are read from the local
// stack's env file and passed through the child environment; nothing is printed.
// Usage: node scripts/localdb/dev-tenant.mjs [port]   (default: the profile app port, 127.0.0.1)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertLocalDatabase, assertLoopbackOnlyOrStop } from "./lib/exec.mjs";
import { ACTIVE_PROFILE } from "./lib/localTarget.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
const port = String(Number(process.argv[2]) || ACTIVE_PROFILE.appPort);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const env = {
  ...process.env,
  VITE_BACKEND_MODE: "live",
  VITE_SUPABASE_URL: status.apiUrl,
  VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_URL: status.apiUrl,
  SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
};

const child = spawn(process.execPath, [path.join(repoRoot, "node_modules/vite/bin/vite.js"), "--port", port, "--strictPort"], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
