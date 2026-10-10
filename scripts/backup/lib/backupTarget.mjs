// Where a backup is read from or restored to. Checked before any network or
// database access.
// * "local": the isolated synthetic local stack only (scripts/localdb guards).
// * "<project-ref>": a hosted Supabase database. NOT YET RUN against any hosted
//   project. The connection comes only from --env-file OUTSIDE the repository
//   (TAXIFLOW_BACKUP_PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE). The host must
//   belong to that project (db.<ref>.supabase.co, or the pooler with user
//   postgres.<ref>). An interactive terminal and the typed ref are required.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnvFile } from "../../hosted/lib/hosted-target.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REF = /^[a-z0-9]{20}$/;

export const isInsideRepo = (target, repoRoot = REPO_ROOT) => {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const assertOutsideRepo = (target, what, repoRoot = REPO_ROOT) => {
  if (!target) throw new Error(`${what} is required.`);
  if (isInsideRepo(target, repoRoot)) throw new Error(`${what} must be outside the repository (backups and secrets never go into Git).`);
  return path.resolve(target);
};

export const resolveBackupTarget = ({ target, envFile, repoRoot = REPO_ROOT, readFile = (file) => readFileSync(file, "utf8"), fileExists = existsSync }) => {
  if (target === "local") return { kind: "local", label: "local" };
  if (!target || !REF.test(target)) throw new Error('--target must be "local" or a 20-character project ref.');
  const file = assertOutsideRepo(envFile, "--env-file", repoRoot);
  if (!fileExists(file)) throw new Error("The env file does not exist.");
  const env = parseEnvFile(readFile(file));
  const connection = {
    PGHOST: env.TAXIFLOW_BACKUP_PGHOST,
    PGPORT: env.TAXIFLOW_BACKUP_PGPORT || "5432",
    PGUSER: env.TAXIFLOW_BACKUP_PGUSER,
    PGPASSWORD: env.TAXIFLOW_BACKUP_PGPASSWORD,
    PGDATABASE: env.TAXIFLOW_BACKUP_PGDATABASE || "postgres",
    PGSSLMODE: "require",
  };
  for (const key of ["PGHOST", "PGUSER", "PGPASSWORD"]) {
    if (!connection[key]) throw new Error(`The env file must define TAXIFLOW_BACKUP_${key}.`);
  }
  const host = connection.PGHOST.toLowerCase();
  const direct = host === `db.${target}.supabase.co` && connection.PGUSER === "postgres";
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) && connection.PGUSER === `postgres.${target}`;
  if (!direct && !pooler) throw new Error(`The database host/user do not belong to project ${target}; refusing.`);
  if (!/^\d+$/.test(connection.PGPORT)) throw new Error("TAXIFLOW_BACKUP_PGPORT must be a number.");
  return { kind: "hosted", label: target, ref: target, connection };
};
