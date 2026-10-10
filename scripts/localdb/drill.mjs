#!/usr/bin/env node
// Synthetic export/restore drill for the isolated LOCAL TaxiFlow database.
//
// 1. Export (encrypted with gpg): the workspace row plus auth.users and
//    auth.identities. Refuses if any account is not @example.com (synthetic only).
// 2. Destroy: brand-new database volume; schema rebuilt from the repo migrations;
//    no seed (auth.users and workspace_snapshots empty).
// 3. Evidence step: restoring the snapshot BEFORE Auth must fail on the
//    updated_by -> auth.users foreign key. That failure shows a snapshot-only
//    backup is an incomplete recovery; it is never counted as a pass.
// 4. Restore Auth users + identities, then the snapshot with its original
//    updated_by.
// 5. Compare: snapshot SHA-256 (canonical), keys, per-key counts, updated_at,
//    updated_by; Auth user/identity counts and hashes; then sign in through the
//    local API as every synthetic user and read the row as an app user.
// Schema, Auth and snapshot recovery are reported separately.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { WORKDIR, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { authManifest, snapshotManifest } from "./lib/localTarget.mjs";
import { LOCAL_TEST_PASSWORD, LOCAL_WORKSPACE_KEY, SEED_USERS } from "./seed-data.mjs";
import { rebuild } from "./setup.mjs";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const DRILL_DIR = path.join(WORKDIR, "drill", stamp);
mkdirSync(DRILL_DIR, { recursive: true });
const PASSPHRASE_FILE = "passphrase.tmp";
const ENCRYPTED_FILE = "export-bundle.json.gpg";

const gpg = (args, input) => {
  const result = spawnSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", PASSPHRASE_FILE, ...args], {
    cwd: DRILL_DIR,
    input,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (result.status !== 0) throw new Error(`gpg failed: ${result.stderr.trim().slice(0, 300)}`);
  return result.stdout;
};

const dollarQuote = (text, tag) => {
  if (text.includes(`$${tag}$`)) throw new Error(`Export contains the quote tag $${tag}$; refusing to build SQL.`);
  return `$${tag}$${text}$${tag}$`;
};

const exportBundle = () => {
  assertLocalDatabase();
  const out = psql(`select json_build_object(
    'workspace', (select json_build_object('workspace_key', workspace_key, 'snapshot', snapshot, 'updated_at', updated_at, 'updated_by', updated_by) from public.workspace_snapshots where workspace_key = '${LOCAL_WORKSPACE_KEY}'),
    'users', (select coalesce(json_agg(to_jsonb(u) order by u.id), '[]'::json) from auth.users u),
    'identities', (select coalesce(json_agg(to_jsonb(i) order by i.id), '[]'::json) from auth.identities i)
  )::text;`).stdout.trim();
  return JSON.parse(out);
};

const nonGeneratedColumns = (table) =>
  psql(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'auth' and table_name = '${table}' and is_generated = 'NEVER';`).stdout.trim();

const restoreAuth = (bundle) => {
  for (const [table, rows] of [["users", bundle.users], ["identities", bundle.identities]]) {
    const columns = nonGeneratedColumns(table);
    psql(`insert into auth.${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::auth.${table}, ${dollarQuote(JSON.stringify(rows), "j")}::jsonb);`);
  }
};

const restoreSnapshotSql = (workspace) =>
  `insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, updated_by) values (${dollarQuote(workspace.workspace_key, "k")}, ${dollarQuote(JSON.stringify(workspace.snapshot), "j")}::jsonb, ${dollarQuote(workspace.updated_at, "t")}::timestamptz, ${workspace.updated_by ? `${dollarQuote(workspace.updated_by, "u")}::uuid` : "null"});`;

const report = { drillDir: DRILL_DIR, startedAt: new Date().toISOString() };
const ok = (value) => (value ? "MATCH" : "DIFF");

try {
  assertLoopbackOnlyOrStop();
  writeFileSync(path.join(DRILL_DIR, PASSPHRASE_FILE), randomBytes(32).toString("hex"), { mode: 0o600 });

  // 1. Export ------------------------------------------------------------------
  const original = exportBundle();
  if (!original.workspace) throw new Error("No workspace row to export; run setup.mjs reset first.");
  const nonSynthetic = original.users.filter((user) => !String(user.email).endsWith("@example.com"));
  if (nonSynthetic.length) throw new Error("Export contains non-synthetic accounts; refusing to run the drill.");
  report.before = { snapshot: snapshotManifest(original.workspace.snapshot), auth: authManifest(original) };
  gpg(["--symmetric", "--cipher-algo", "AES256", "--output", ENCRYPTED_FILE], JSON.stringify(original));
  writeFileSync(path.join(DRILL_DIR, "manifest.json"), JSON.stringify(report.before, null, 2));
  console.log(`1 export: snapshot ${report.before.snapshot.sha256.slice(0, 16)}… keys=${report.before.snapshot.keys.length}; auth users=${report.before.auth.users} identities=${report.before.auth.identities}; encrypted`);

  // 2. Destroy: fresh volume, schema from migrations only -------------------------
  rebuild({ seed: false });
  report.afterRebuild = {
    authUsers: Number(psql("select count(*) from auth.users;").stdout.trim()),
    workspaceRows: Number(psql("select count(*) from public.workspace_snapshots;").stdout.trim()),
    publicTables: psql("select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'public';").stdout.trim(),
  };
  console.log(`2 rebuilt from migrations: tables=${report.afterRebuild.publicTables}; auth users=${report.afterRebuild.authUsers}; rows=${report.afterRebuild.workspaceRows}`);

  const bundle = JSON.parse(gpg(["--decrypt", ENCRYPTED_FILE]));

  // 3. Evidence: snapshot before Auth --------------------------------------------
  assertLocalDatabase();
  const early = psql(restoreSnapshotSql(bundle.workspace), { allowFailure: true });
  report.snapshotBeforeAuth = early.status === 0 ? "UNEXPECTED: succeeded" : `refused (incomplete recovery): ${(early.stderr || "").trim().split(/\r?\n/)[0]}`;
  if (early.status === 0) psql(`delete from public.workspace_snapshots where workspace_key = '${LOCAL_WORKSPACE_KEY}';`);
  console.log(`3 snapshot before Auth: ${report.snapshotBeforeAuth}`);

  // 4. Restore Auth, then snapshot -----------------------------------------------
  assertLocalDatabase();
  restoreAuth(bundle);
  psql(restoreSnapshotSql(bundle.workspace));

  // 5. Compare -------------------------------------------------------------------
  const restored = exportBundle();
  const snapshotAfter = snapshotManifest(restored.workspace.snapshot);
  const authAfter = authManifest(restored);
  report.after = { snapshot: snapshotAfter, auth: authAfter };
  report.snapshotChecks = {
    sha256: ok(snapshotAfter.sha256 === report.before.snapshot.sha256),
    keys: ok(JSON.stringify(snapshotAfter.keys) === JSON.stringify(report.before.snapshot.keys)),
    counts: ok(JSON.stringify(snapshotAfter.counts) === JSON.stringify(report.before.snapshot.counts)),
    updated_at: ok(new Date(restored.workspace.updated_at).getTime() === new Date(original.workspace.updated_at).getTime()),
    updated_by: ok(restored.workspace.updated_by === original.workspace.updated_by),
  };
  report.authChecks = {
    users: ok(authAfter.users === report.before.auth.users && authAfter.usersSha256 === report.before.auth.usersSha256),
    identities: ok(authAfter.identities === report.before.auth.identities && authAfter.identitiesSha256 === report.before.auth.identitiesSha256),
  };

  const { apiUrl, ANON_KEY } = assertLocalDatabase();
  report.access = {};
  for (const user of SEED_USERS) {
    const client = createClient(apiUrl, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: user.email, password: LOCAL_TEST_PASSWORD });
    report.access[user.email] = error ? `sign-in FAILED: ${error.message}` : "sign-in ok";
    if (!error && user.role === "Owner") {
      const read = await client.from("workspace_snapshots").select("workspace_key, updated_at");
      report.access.ownerAppRead = read.data?.length === 1 ? "1 row" : `FAILED: ${read.error?.message ?? "no row"}`;
    }
  }
  const anon = createClient(apiUrl, ANON_KEY, { auth: { persistSession: false } });
  const anonRead = await anon.from("workspace_snapshots").select("workspace_key");
  report.access.anonRead = anonRead.error ? `denied (${anonRead.error.code})` : `NOT DENIED (${anonRead.data?.length} rows)`;
  assertLoopbackOnlyOrStop();

  const signInsOk = SEED_USERS.every((user) => report.access[user.email] === "sign-in ok");
  report.result = {
    schema: report.afterRebuild.publicTables === "workspace_snapshots" ? "RECOVERED from repo migrations (not from the backup)" : "FAIL",
    auth: Object.values(report.authChecks).every((v) => v === "MATCH") && signInsOk ? "RECOVERED: users + identities from the export; all synthetic sign-ins work" : "FAIL",
    snapshot: Object.values(report.snapshotChecks).every((v) => v === "MATCH") && report.access.ownerAppRead === "1 row" ? "RECOVERED: hash, keys, counts, updated_at, updated_by match; app read ok" : "FAIL",
    snapshotOnlyBackup: report.snapshotBeforeAuth.startsWith("refused") ? "INCOMPLETE: refused without Auth (expected evidence)" : "UNEXPECTED",
    notCovered: "Auth sessions/refresh tokens/MFA/audit tables, storage, and any hosted-project configuration",
  };
  console.log("4 snapshot checks:", JSON.stringify(report.snapshotChecks));
  console.log("4 auth checks:", JSON.stringify(report.authChecks));
  console.log("5 access:", JSON.stringify(report.access));
  console.log("RESULT:", JSON.stringify(report.result, null, 1));
} finally {
  rmSync(path.join(DRILL_DIR, PASSPHRASE_FILE), { force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(DRILL_DIR, "drill-report.json"), JSON.stringify(report, null, 2));
  console.log(`report: ${path.join(DRILL_DIR, "drill-report.json")}`);
}

const failed = Object.values(report.result ?? { missing: "FAIL" }).some((value) => /^(FAIL|UNEXPECTED)/.test(value));
process.exit(failed ? 1 : 0);
