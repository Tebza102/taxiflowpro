#!/usr/bin/env node
// Apply the tenant release files 01-05 to a database, in the tested order, each
// in its own transaction, then print the access and mapping checks.
//   node scripts/hosted/apply-release.mjs --target <local|project-ref> [--env-file <outside-repo>]
// * Hosted targets use the same guarded connection as the backup tool
//   (backup.env outside the repo, host/user bound to the ref, TLS) and need an
//   interactive terminal and the typed project ref.
// * Safe to re-run: a file whose objects already exist is skipped, so after a
//   failure the next run continues with the failed file. Stops at the first error
//   (that file rolls back on its own; earlier files stay applied).
// * Prints only object names, counts and check results (no data).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { resolveBackupTarget } from "../backup/lib/backupTarget.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOSTED_PSQL_IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.004";
export const RELEASE_FILES = [
  { label: "01 tenant foundation", file: "supabase/release/tenant-pilot/01_tenant_foundation.sql", marker: "select to_regclass('public.businesses') is not null;" },
  { label: "02 finance actions", file: "scripts/localdb/migrations/20261010063144_finance_actions.sql", marker: "select to_regclass('public.finance_action_requests') is not null;" },
  { label: "03 pilot onboarding", file: "scripts/localdb/migrations/20261010113000_pilot_onboarding.sql", marker: "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_business_with_owner');" },
  { label: "04 assign initial owner", file: "scripts/localdb/migrations/20261011090000_assign_initial_owner.sql", marker: "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'assign_initial_owner');" },
  { label: "05 platform admins", file: "scripts/localdb/migrations/20261018090000_platform_admins.sql", marker: "select to_regclass('public.platform_admins') is not null;" },
];

export const POST_CHECKS_SQL = `select json_build_object(
  'businesses', (select count(*) from public.businesses),
  'legacy_business_name', (select name from public.businesses where slug = 'taxiflow-legacy'),
  'snapshots', (select count(*) from public.workspace_snapshots),
  'unmapped_snapshots', (select count(*) from public.workspace_snapshots where business_id is null),
  'active_memberships', (select count(*) from public.business_memberships where active),
  'active_owners', (select count(*) from public.business_memberships where active and role = 'Owner'),
  'policies_on_workspace_snapshots', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'workspace_snapshots'),
  'browser_table_grants', (select coalesce(json_agg(distinct grantee || ':' || table_name || ':' || privilege_type), '[]'::json) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')),
  'tables_without_rls', (select coalesce(json_agg(c.relname), '[]'::json) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'browser_executable_functions', (select coalesce(json_agg(p.proname), '[]'::json) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
)::text;`;

const option = (argv, name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const runPsql = (args, sql, env) => {
  const result = spawnSync("docker", args, { input: sql, encoding: "utf8", env, maxBuffer: 64 << 20, timeout: 900_000 });
  if (result.error) throw new Error(`psql could not run: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const psqlFor = async (target) => {
  if (target.kind === "local") {
    const { DB_CONTAINER, assertLocalDatabase, assertLoopbackOnlyOrStop } = await import("../localdb/lib/exec.mjs");
    return (sql) => {
      assertLoopbackOnlyOrStop();
      assertLocalDatabase();
      return runPsql(["exec", "-i", DB_CONTAINER, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], sql, process.env);
    };
  }
  const passNames = Object.keys(target.connection).flatMap((name) => ["-e", name]);
  return (sql) => runPsql(["run", "--rm", "-i", ...passNames, HOSTED_PSQL_IMAGE, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-q"], sql, { ...process.env, ...target.connection });
};

const confirm = async (target) => {
  if (target.kind !== "hosted") return;
  console.log(`Target project: ${target.ref} (${target.connection.PGHOST})\nOperation     : apply tenant release files 01-05 (writes)`);
  if (!process.stdin.isTTY) throw new Error("A hosted target needs an interactive terminal for confirmation.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Type the project ref (${target.ref}) to apply: `, resolve));
  rl.close();
  if (answer.trim() !== target.ref) throw new Error("Confirmation did not match; nothing was applied.");
};

const lastLines = (text) => String(text || "").trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400);

export const main = async (argv) => {
  const target = resolveBackupTarget({ target: option(argv, "target"), envFile: option(argv, "env-file") });
  await confirm(target);
  const psql = await psqlFor(target);
  for (const step of RELEASE_FILES) {
    const probe = psql(step.marker);
    if (probe.status !== 0) throw new Error(`${step.label}: state check failed: ${lastLines(probe.stderr)}`);
    if (probe.stdout.trim() === "t") {
      console.log(`SKIP    ${step.label} (already applied)`);
      continue;
    }
    const started = Date.now();
    const sql = readFileSync(path.join(REPO_ROOT, step.file), "utf8");
    const result = psql(`begin;\n${sql}\ncommit;\n`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.status !== 0) {
      console.log(`FAILED  ${step.label} after ${seconds}s (rolled back): ${lastLines(result.stderr)}`);
      console.log("STOP: later files were not applied. Keep maintenance up; fix and re-run.");
      return 1;
    }
    const after = psql(step.marker);
    if (after.stdout.trim() !== "t") {
      console.log(`FAILED  ${step.label}: committed, but its objects are not present`);
      return 1;
    }
    console.log(`APPLIED ${step.label} in ${seconds}s`);
  }
  const checks = psql(POST_CHECKS_SQL);
  if (checks.status !== 0) throw new Error(`post-checks failed: ${lastLines(checks.stderr)}`);
  const c = JSON.parse(checks.stdout.trim());
  const expectedGrants = ["authenticated:business_memberships:SELECT", "authenticated:businesses:SELECT"];
  const results = {
    "every snapshot mapped to a business": c.unmapped_snapshots === 0 && c.snapshots > 0,
    "an active Owner exists": c.active_owners >= 1,
    "no policies on workspace_snapshots": c.policies_on_workspace_snapshots === 0,
    "browser grants are exactly authenticated SELECT on businesses and business_memberships": JSON.stringify([...c.browser_table_grants].sort()) === JSON.stringify(expectedGrants),
    "RLS on every public table": c.tables_without_rls.length === 0,
    "no browser-executable public function": c.browser_executable_functions.length === 0,
  };
  console.log(`counts: businesses=${c.businesses} snapshots=${c.snapshots} activeMemberships=${c.active_memberships} activeOwners=${c.active_owners} legacyBusinessName="${c.legacy_business_name}"`);
  for (const [name, ok] of Object.entries(results)) console.log(`${ok ? "PASS" : "FAIL"}    ${name}`);
  if (!results["browser grants are exactly authenticated SELECT on businesses and business_memberships"]) console.log(`        grants: ${JSON.stringify(c.browser_table_grants)}`);
  if (c.tables_without_rls.length) console.log(`        tables without RLS: ${JSON.stringify(c.tables_without_rls)}`);
  if (c.browser_executable_functions.length) console.log(`        browser-executable functions: ${JSON.stringify(c.browser_executable_functions)}`);
  const ok = Object.values(results).every(Boolean);
  console.log(ok ? "RELEASE FILES APPLIED AND CHECKED: PASS" : "CHECKS FAILED: keep maintenance up");
  return ok ? 0 : 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
