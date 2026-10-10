#!/usr/bin/env node
// Synthetic export/restore drill for the isolated LOCAL TaxiFlow database
// (tenant schema: businesses, business_memberships, one snapshot per business).
//
// 1. Export (encrypted with gpg): every workspace row (with business_id),
//    businesses, business_memberships, auth.users and auth.identities. Refuses
//    if any account is not @example.com (synthetic only).
// 2. Destroy: brand-new database volume; schema rebuilt from the repo migrations;
//    no seed.
// 3. Evidence step: restoring snapshots BEFORE Auth/businesses must fail on a
//    foreign key. That failure shows a snapshot-only backup is an incomplete
//    recovery; it is never counted as a pass.
// 4. Restore in dependency order: Auth users + identities, businesses,
//    memberships, then snapshots with their original updated_by.
// 5. Compare: per-snapshot SHA-256 (canonical), keys, per-key counts,
//    updated_at, updated_by, business_id; businesses and memberships; Auth user
//    and identity counts and hashes. Then sign in through the local API as every
//    synthetic user and check tenant-scoped access.
// Schema, Auth, tenant mapping and snapshot recovery are reported separately.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { WORKDIR, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { authManifest, snapshotManifest, stableStringify } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD, SEED_USERS, TENANT_USERS } from "./seed-data.mjs";
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

const guardedSql = (sql, options) => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
  return psql(sql, options);
};

const exportBundle = () => {
  assertLocalDatabase();
  const out = psql(`select json_build_object(
    'workspaces', (select coalesce(json_agg(json_build_object('workspace_key', workspace_key, 'snapshot', snapshot, 'updated_at', updated_at, 'updated_by', updated_by, 'business_id', business_id) order by workspace_key), '[]'::json) from public.workspace_snapshots),
    'businesses', (select coalesce(json_agg(to_jsonb(b) order by b.id), '[]'::json) from public.businesses b),
    'memberships', (select coalesce(json_agg(to_jsonb(m) order by m.business_id, m.user_id), '[]'::json) from public.business_memberships m),
    'users', (select coalesce(json_agg(to_jsonb(u) order by u.id), '[]'::json) from auth.users u),
    'identities', (select coalesce(json_agg(to_jsonb(i) order by i.id), '[]'::json) from auth.identities i)
  )::text;`).stdout.trim();
  return JSON.parse(out);
};

const nonGeneratedColumns = (schema, table) =>
  psql(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = '${schema}' and table_name = '${table}' and is_generated = 'NEVER';`).stdout.trim();

// Rows are inserted from the export via jsonb_populate_recordset (generated
// columns excluded). conflict = "do nothing" only for businesses, because the
// tenant migration itself recreates the mapped legacy business.
const restoreRows = (schema, table, rows, conflict = "") => {
  const columns = nonGeneratedColumns(schema, table);
  guardedSql(`insert into ${schema}.${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::${schema}.${table}, ${dollarQuote(JSON.stringify(rows), "j")}::jsonb) ${conflict};`);
};

const restoreSnapshotsSql = (workspaces) =>
  workspaces
    .map(
      (w) =>
        `insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, updated_by, business_id) values (${dollarQuote(w.workspace_key, "k")}, ${dollarQuote(JSON.stringify(w.snapshot), "j")}::jsonb, ${dollarQuote(w.updated_at, "t")}::timestamptz, ${w.updated_by ? `${dollarQuote(w.updated_by, "u")}::uuid` : "null"}, ${dollarQuote(w.business_id, "b")}::uuid);`,
    )
    .join("\n");

const manifests = (bundle) => ({
  snapshots: Object.fromEntries(bundle.workspaces.map((w) => [w.workspace_key, { ...snapshotManifest(w.snapshot), updated_at: new Date(w.updated_at).getTime(), updated_by: w.updated_by, business_id: w.business_id }])),
  businesses: stableStringify(bundle.businesses.map((b) => [b.id, b.slug, b.name])),
  memberships: stableStringify(bundle.memberships.map((m) => [m.business_id, m.user_id, m.role, m.driver_staff_id, m.active])),
  auth: authManifest(bundle),
});

const report = { drillDir: DRILL_DIR, startedAt: new Date().toISOString() };
const ok = (value) => (value ? "MATCH" : "DIFF");

try {
  assertLoopbackOnlyOrStop();
  writeFileSync(path.join(DRILL_DIR, PASSPHRASE_FILE), randomBytes(32).toString("hex"), { mode: 0o600 });

  // 1. Export ------------------------------------------------------------------
  const original = exportBundle();
  if (original.workspaces.length < 2) throw new Error("Expected one snapshot per synthetic business; run setup.mjs reset first.");
  if (original.users.some((user) => !String(user.email).endsWith("@example.com"))) {
    throw new Error("Export contains non-synthetic accounts; refusing to run the drill.");
  }
  const before = manifests(original);
  report.before = { snapshots: Object.keys(before.snapshots), businesses: original.businesses.length, memberships: original.memberships.length, auth: before.auth };
  gpg(["--symmetric", "--cipher-algo", "AES256", "--output", ENCRYPTED_FILE], JSON.stringify(original));
  writeFileSync(path.join(DRILL_DIR, "manifest.json"), JSON.stringify(before, null, 2));
  console.log(`1 export: ${original.workspaces.length} snapshots, ${original.businesses.length} businesses, ${original.memberships.length} memberships, ${original.users.length} users; encrypted`);

  // 2. Destroy: fresh volume, schema from migrations only -------------------------
  rebuild({ seed: false });
  report.afterRebuild = {
    authUsers: Number(psql("select count(*) from auth.users;").stdout.trim()),
    workspaceRows: Number(psql("select count(*) from public.workspace_snapshots;").stdout.trim()),
    memberships: Number(psql("select count(*) from public.business_memberships;").stdout.trim()),
    publicTables: psql("select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'public';").stdout.trim(),
  };
  console.log(`2 rebuilt from migrations: tables=${report.afterRebuild.publicTables}; auth users=${report.afterRebuild.authUsers}; snapshots=${report.afterRebuild.workspaceRows}; memberships=${report.afterRebuild.memberships}`);

  const bundle = JSON.parse(gpg(["--decrypt", ENCRYPTED_FILE]));

  // 3. Evidence: snapshots before Auth/businesses ---------------------------------
  const early = guardedSql(restoreSnapshotsSql(bundle.workspaces), { allowFailure: true });
  report.snapshotsBeforeAuth = early.status === 0 ? "UNEXPECTED: succeeded" : `refused (incomplete recovery): ${(early.stderr || "").trim().split(/\r?\n/)[0]}`;
  if (early.status === 0) guardedSql("delete from public.workspace_snapshots;");
  console.log(`3 snapshots before Auth/businesses: ${report.snapshotsBeforeAuth}`);

  // 4. Restore in dependency order -----------------------------------------------
  restoreRows("auth", "users", bundle.users);
  restoreRows("auth", "identities", bundle.identities);
  restoreRows("public", "businesses", bundle.businesses, "on conflict (id) do nothing");
  restoreRows("public", "business_memberships", bundle.memberships);
  guardedSql(restoreSnapshotsSql(bundle.workspaces));

  // 5. Compare -------------------------------------------------------------------
  const restored = exportBundle();
  const after = manifests(restored);
  report.snapshotChecks = Object.fromEntries(
    Object.entries(before.snapshots).map(([key, m]) => {
      const r = after.snapshots[key] ?? {};
      return [key, {
        sha256: ok(r.sha256 === m.sha256),
        keys: ok(stableStringify(r.keys) === stableStringify(m.keys)),
        counts: ok(stableStringify(r.counts) === stableStringify(m.counts)),
        updated_at: ok(r.updated_at === m.updated_at),
        updated_by: ok(r.updated_by === m.updated_by),
        business_id: ok(r.business_id === m.business_id),
      }];
    }),
  );
  report.tenantChecks = { businesses: ok(after.businesses === before.businesses), memberships: ok(after.memberships === before.memberships) };
  report.authChecks = {
    users: ok(after.auth.users === before.auth.users && after.auth.usersSha256 === before.auth.usersSha256),
    identities: ok(after.auth.identities === before.auth.identities && after.auth.identitiesSha256 === before.auth.identitiesSha256),
  };

  const { apiUrl, ANON_KEY, SERVICE_ROLE_KEY } = assertLocalDatabase();
  report.access = {};
  const signedIn = {};
  for (const user of [...SEED_USERS, ...TENANT_USERS]) {
    const client = createClient(apiUrl, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: user.email, password: LOCAL_TEST_PASSWORD });
    report.access[user.email] = error ? `sign-in FAILED: ${error.message}` : "sign-in ok";
    signedIn[user.email] = client;
  }
  const ownerABiz = await signedIn["owner@example.com"].from("businesses").select("id");
  report.access.ownerASeesOnlyA = !ownerABiz.error && ownerABiz.data.length === 1 && ownerABiz.data[0].id === BUSINESS_A_ID;
  const ownerBBiz = await signedIn["owner.b@example.com"].from("businesses").select("id");
  report.access.ownerBSeesOnlyB = !ownerBBiz.error && ownerBBiz.data.length === 1 && ownerBBiz.data[0].id === BUSINESS_B_ID;
  const direct = await signedIn["driver@example.com"].from("workspace_snapshots").select("workspace_key");
  report.access.driverDirectSnapshotRead = direct.error ? `denied (${direct.error.code})` : `NOT DENIED (${direct.data?.length})`;
  const server = createClient(apiUrl, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const serverRead = await server.from("workspace_snapshots").select("workspace_key");
  report.access.serverReadsSnapshots = serverRead.error ? `FAILED: ${serverRead.error.message}` : `${serverRead.data.length} rows`;
  assertLoopbackOnlyOrStop();

  const allMatch = (obj) => Object.values(obj).every((v) => (typeof v === "object" ? allMatch(v) : v === "MATCH"));
  const signInsOk = [...SEED_USERS, ...TENANT_USERS].every((user) => report.access[user.email] === "sign-in ok");
  report.result = {
    schema: report.afterRebuild.publicTables === "business_memberships,businesses,workspace_snapshots" ? "RECOVERED from repo migrations (not from the backup)" : "FAIL",
    auth: allMatch(report.authChecks) && signInsOk ? "RECOVERED: users + identities from the export; all synthetic sign-ins work" : "FAIL",
    tenants: allMatch(report.tenantChecks) && report.access.ownerASeesOnlyA && report.access.ownerBSeesOnlyB ? "RECOVERED: businesses + memberships match; tenant-scoped visibility holds" : "FAIL",
    snapshots: allMatch(report.snapshotChecks) && report.access.serverReadsSnapshots === `${original.workspaces.length} rows` && report.access.driverDirectSnapshotRead.startsWith("denied") ? "RECOVERED: per-business hash, keys, counts, updated_at, updated_by, business_id match; browser still denied, server reads" : "FAIL",
    snapshotOnlyBackup: report.snapshotsBeforeAuth.startsWith("refused") ? "INCOMPLETE: refused without Auth/businesses (expected evidence)" : "UNEXPECTED",
    notCovered: "Auth sessions/refresh tokens/MFA/audit tables, storage, and any hosted-project configuration",
  };
  console.log("4 snapshot checks:", JSON.stringify(report.snapshotChecks));
  console.log("4 tenant checks:", JSON.stringify(report.tenantChecks), "auth checks:", JSON.stringify(report.authChecks));
  console.log("5 access:", JSON.stringify({ ...report.access, signIns: signInsOk ? "all ok" : "FAILED" }, (k, v) => (k.includes("@") ? undefined : v)));
  console.log("RESULT:", JSON.stringify(report.result, null, 1));
} finally {
  rmSync(path.join(DRILL_DIR, PASSPHRASE_FILE), { force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(DRILL_DIR, "drill-report.json"), JSON.stringify(report, null, 2));
  console.log(`report: ${path.join(DRILL_DIR, "drill-report.json")}`);
}

const failed = Object.values(report.result ?? { missing: "FAIL" }).some((value) => /^(FAIL|UNEXPECTED)/.test(value));
process.exit(failed ? 1 : 0);
