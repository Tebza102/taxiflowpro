import { readFile } from "node:fs/promises";
import path from "node:path";

// Minimal, dependency-free KEY=VALUE loader for a local, untracked secrets file
// (.env.uat.local). No new package is added for this - the format needed is
// trivial and the project already has a plain-env-var convention (see
// scripts/reconcile-production-users.mjs). Real shell-exported env vars always
// win over the file, so `FOO=x npm run uat:preview` still overrides it.
//
// Contents are never logged, returned, or echoed anywhere by this function - it
// only mutates process.env in place.
export const loadLocalUatEnv = async ({ repoRoot, fileName = ".env.uat.local" }) => {
  const filePath = path.join(repoRoot, fileName);

  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { loaded: false, filePath };
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!key || key in process.env) continue; // real environment always wins
    process.env[key] = value;
  }

  return { loaded: true, filePath };
};
