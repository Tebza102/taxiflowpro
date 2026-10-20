import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  BACKUP_FORMAT,
  END_MARKER,
  EXPORT_SQL,
  EXPORT_SQL_PRE_MIGRATION,
  LEGACY_TABLES,
  PRE_MIGRATION_FORMAT,
  SCHEMA_PROBE_SQL,
  buildBusinessRestoreSql,
  buildPreMigrationRestoreSql,
  evaluateBackupLog,
  exportSqlFor,
  parseAndValidateBundle,
  validateBundle,
} from "../scripts/backup/lib/backupCore.mjs";
import { decryptBackup, encryptBackup } from "../scripts/backup/lib/backupCrypto.mjs";
import { REPO_ROOT, resolveBackupTarget } from "../scripts/backup/lib/backupTarget.mjs";

const B = "10000000-0000-4000-8000-00000000000a";
const U = "20000000-0000-4000-8000-000000000001";
const bundle = () => ({
  format: BACKUP_FORMAT,
  exported_at: "2026-10-10T18:00:00Z",
  businesses: [{ id: B, slug: "a", name: "A" }],
  memberships: [{ business_id: B, user_id: U, role: "Owner", active: true }],
  workspaces: [{ workspace_key: "a", business_id: B, snapshot: { financeTransactions: [] }, updated_at: "2026-10-10T17:00:00Z", updated_by: U }],
  requests: [{ business_id: B, request_id: "r1" }],
  users: [{ id: U, email: "owner@example.com" }],
  identities: [{ id: "i1", user_id: U }],
  end: END_MARKER,
});

test("the export is one read-only repeatable-read transaction covering every recovery table", () => {
  assert.match(EXPORT_SQL, /^begin transaction isolation level repeatable read read only;/);
  for (const table of ["public.businesses", "public.business_memberships", "public.workspace_snapshots", "public.finance_action_requests", "auth.users", "auth.identities"]) {
    assert.ok(EXPORT_SQL.includes(table), table);
  }
  assert.ok(EXPORT_SQL.trim().endsWith("commit;"));
  assert.ok(EXPORT_SQL.indexOf("'end'") > EXPORT_SQL.indexOf("auth.identities"), "the end marker is written last");
});

test("a complete, consistent bundle is accepted", () => {
  assert.equal(parseAndValidateBundle(JSON.stringify(bundle())).businesses.length, 1);
});

test("incomplete or inconsistent exports are rejected", () => {
  const text = JSON.stringify(bundle());
  assert.throws(() => parseAndValidateBundle(""), /no output/);
  assert.throws(() => parseAndValidateBundle(text.slice(0, -40)), /not complete JSON/);
  const cases = [
    [(b) => delete b.end, /end marker/],
    [(b) => delete b.requests, /requests is missing/],
    [(b) => (b.memberships[0].user_id = "missing"), /missing Auth user/],
    [(b) => (b.memberships[0].business_id = "missing"), /missing business/],
    [(b) => (b.workspaces[0].business_id = null), /no backed-up business/],
    [(b) => (b.workspaces = []), /has no snapshot/],
    [(b) => (b.requests[0].business_id = "missing"), /request-log row/],
    [(b) => (b.identities[0].user_id = "missing"), /identity/],
    [(b) => (b.businesses = []), /no businesses/],
  ];
  for (const [mutate, message] of cases) {
    const broken = bundle();
    mutate(broken);
    assert.throws(() => validateBundle(broken), message);
  }
});

test("a one-business restore touches only that business's snapshot and request log", () => {
  const sql = buildBusinessRestoreSql(bundle(), B, { "public.finance_action_requests": "business_id,request_id" });
  assert.match(sql, /update public\.workspace_snapshots/);
  assert.match(sql, /delete from public\.finance_action_requests where business_id =/);
  assert.doesNotMatch(sql, /auth\.|business_memberships|insert into public\.businesses/);
  assert.throws(() => buildBusinessRestoreSql(bundle(), "other", {}), /not in the backup/);
});

test("pre-migration backups: schema probe, validation, and a restore guarded to an empty pre-migration schema", () => {
  assert.match(SCHEMA_PROBE_SQL, /to_regclass\('public\.businesses'\)/);
  assert.equal(exportSqlFor("pre-migration"), EXPORT_SQL_PRE_MIGRATION);
  assert.equal(exportSqlFor("tenant"), EXPORT_SQL);
  assert.match(EXPORT_SQL_PRE_MIGRATION, /^begin transaction isolation level repeatable read read only;/);
  assert.doesNotMatch(EXPORT_SQL_PRE_MIGRATION, /public\.businesses|business_memberships|finance_action_requests|business_id/);
  for (const table of LEGACY_TABLES) assert.ok(EXPORT_SQL_PRE_MIGRATION.includes(`public.${table}`), table);
  const pre = () => ({
    format: PRE_MIGRATION_FORMAT,
    exported_at: "2026-10-11T00:00:00Z",
    workspaces: [{ workspace_key: "taxiflow-live", snapshot: { appUsers: [] }, updated_at: "2026-10-10T00:00:00Z", updated_by: U }],
    legacy_tables: Object.fromEntries(LEGACY_TABLES.map((table) => [table, []])),
    users: [{ id: U }],
    identities: [{ id: "i1", user_id: U }],
    end: END_MARKER,
  });
  assert.equal(validateBundle(pre()).format, PRE_MIGRATION_FORMAT);
  for (const [mutate, message] of [
    [(b) => (b.workspaces = []), /no workspace snapshots/],
    [(b) => delete b.legacy_tables.vehicles, /legacy table vehicles/],
    [(b) => (b.workspaces[0].updated_by = "missing"), /missing Auth user/],
    [(b) => delete b.end, /end marker/],
  ]) {
    const broken = pre();
    mutate(broken);
    assert.throws(() => validateBundle(broken), message);
  }
  const sql = buildPreMigrationRestoreSql(pre(), { "auth.users": "id", "auth.identities": "id,user_id" });
  assert.match(sql, /TARGET IS MIGRATED/);
  assert.match(sql, /TARGET NOT EMPTY/);
  assert.doesNotMatch(sql, /business_id/);
  assert.throws(() => buildBusinessRestoreSql(pre(), B, {}), /after the tenant migration/);
});

test("the morning check needs a recent PASS as the newest entry", () => {
  const now = Date.parse("2026-10-11T06:00:00Z");
  assert.equal(evaluateBackupLog("", { now }).ok, false);
  assert.equal(evaluateBackupLog("2026-10-10T18:00:00Z PASS f.tfbk", { now }).ok, true);
  assert.equal(evaluateBackupLog("2026-10-10T18:00:00Z PASS f.tfbk\n2026-10-10T19:00:00Z FAIL psql", { now }).ok, false);
  assert.equal(evaluateBackupLog("2026-10-09T18:00:00Z PASS f.tfbk", { now }).ok, false);
});

test("encryption round-trips and rejects a wrong passphrase, tampering and truncation", () => {
  const pass = "correct horse battery staple";
  const file = encryptBackup(Buffer.from("secret payload"), pass);
  assert.equal(decryptBackup(file, pass).toString(), "secret payload");
  assert.ok(!file.toString("latin1").includes("secret payload"));
  assert.throws(() => decryptBackup(file, "wrong passphrase here!!"), /Decryption failed/);
  const tampered = Buffer.from(file);
  tampered[tampered.length - 20] ^= 1;
  assert.throws(() => decryptBackup(tampered, pass), /Decryption failed/);
  const header = Buffer.from(file.toString("latin1").replace('"p":1', '"p":2'), "latin1");
  assert.throws(() => decryptBackup(header, pass), /Decryption failed/);
  assert.throws(() => decryptBackup(file.subarray(0, 10), pass), /truncated/);
  assert.throws(() => encryptBackup(Buffer.from("x"), "short"), /at least 16/);
});

test("hosted targets are refused unless the connection belongs to that project and lives outside the repo", () => {
  const ref = "vfxftviwteypasredjgm";
  const outside = path.resolve(REPO_ROOT, "..", "backup.env");
  const env = (lines) => ({ target: ref, envFile: outside, fileExists: () => true, readFile: () => lines.join("\n") });
  const ok = ["TAXIFLOW_BACKUP_PGHOST=aws-0-eu-west-1.pooler.supabase.com", `TAXIFLOW_BACKUP_PGUSER=postgres.${ref}`, "TAXIFLOW_BACKUP_PGPASSWORD=x"];
  assert.equal(resolveBackupTarget({ target: "local" }).kind, "local");
  assert.equal(resolveBackupTarget(env(ok)).connection.PGSSLMODE, "require");
  assert.equal(resolveBackupTarget(env([`TAXIFLOW_BACKUP_PGHOST=db.${ref}.supabase.co`, "TAXIFLOW_BACKUP_PGUSER=postgres", "TAXIFLOW_BACKUP_PGPASSWORD=x"])).kind, "hosted");
  assert.throws(() => resolveBackupTarget({ target: ref }), /--env-file is required/);
  assert.throws(() => resolveBackupTarget({ ...env(ok), envFile: path.join(REPO_ROOT, "backup.env") }), /outside the repository/);
  assert.throws(() => resolveBackupTarget(env(["TAXIFLOW_BACKUP_PGHOST=db.ydrrhlpvblwgwboyuwkj.supabase.co", "TAXIFLOW_BACKUP_PGUSER=postgres", "TAXIFLOW_BACKUP_PGPASSWORD=x"])), /do not belong/);
  assert.throws(() => resolveBackupTarget(env(["TAXIFLOW_BACKUP_PGHOST=aws-0-eu-west-1.pooler.supabase.com", "TAXIFLOW_BACKUP_PGUSER=postgres.ydrrhlpvblwgwboyuwkj", "TAXIFLOW_BACKUP_PGPASSWORD=x"])), /do not belong/);
  assert.throws(() => resolveBackupTarget(env(ok.slice(0, 2))), /PGPASSWORD/);
  assert.throws(() => resolveBackupTarget({ target: "prod" }), /20-character/);
});

test("the backup CLI writes only encrypted data, passes secrets via the environment, and logs PASS last", async () => {
  const source = await readFile(new URL("../scripts/backup/backup.mjs", import.meta.url), "utf8");
  const writes = [...source.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(writes, ["partialFile", "manifestFile"]);
  assert.doesNotMatch(source, /PGPASSWORD=|--passphrase |console\.log\([^)]*passphrase/);
  const exportBody = source.slice(source.indexOf("const runExport"), source.indexOf("const runVerify"));
  assert.ok(exportBody.indexOf("decryptBackup(written") < exportBody.indexOf("renameSync"), "verify before rename");
  assert.ok(exportBody.indexOf("renameSync") < exportBody.indexOf("PASS ${path.basename"), "rename before PASS");
  assert.match(exportBody, /catch \(error\) \{\s*rmSync\(partialFile/);
});

test("platform_admins and the permission-audit history are backed up and restored when present", async () => {
  const core = await import("../scripts/backup/lib/backupCore.mjs");
  // Older databases and backups without them stay valid and unchanged.
  assert.equal(core.exportSqlFor("tenant"), EXPORT_SQL);
  assert.doesNotMatch(EXPORT_SQL, /platform_admins|member_permission_changes/);
  assert.match(core.OPTIONAL_TABLES_PROBE_SQL, /to_regclass\('public\.platform_admins'\)/);
  assert.match(core.OPTIONAL_TABLES_PROBE_SQL, /to_regclass\('public\.member_permission_changes'\)/);
  const both = core.exportSqlFor("tenant", ["platform_admins", "permission_changes"]);
  assert.ok(both.includes("from public.platform_admins p") && both.includes("from public.member_permission_changes c"));
  assert.ok(both.indexOf("'end'") > both.indexOf("member_permission_changes"), "the end marker stays last");
  assert.doesNotMatch(core.exportSqlFor("tenant", ["permission_changes"]), /platform_admins/);

  const withOptional = () => ({
    ...bundle(),
    platform_admins: [{ user_id: U, active: true, granted_by: "operator" }],
    permission_changes: [{ id: "c1", business_id: B, actor_user_id: U, actor_role: "Owner", target_user_id: U, permissions_before: ["cash.count"], permissions_after: [] }],
  });
  assert.equal(validateBundle(withOptional()).permission_changes.length, 1);
  assert.equal(validateBundle(bundle()).platform_admins, undefined, "an older backup without the keys is accepted");
  const badAdmin = withOptional();
  badAdmin.platform_admins[0].user_id = "missing";
  assert.throws(() => validateBundle(badAdmin), /platform-admin grant references a missing Auth user/);
  const badAudit = withOptional();
  badAudit.permission_changes[0].business_id = "missing";
  assert.throws(() => validateBundle(badAudit), /permission-audit row references a missing business/);
  const notList = withOptional();
  notList.permission_changes = {};
  assert.throws(() => validateBundle(notList), /permission_changes is not a list/);

  const manifest = core.buildManifest(withOptional(), {});
  assert.equal(manifest.counts.platformAdmins, 1);
  assert.equal(manifest.counts.permissionChanges, 1);
  assert.equal(manifest.businesses[0].permissionChanges, 1);
  assert.equal(core.buildManifest(bundle(), {}).counts.platformAdmins, undefined, "older manifests keep their counts");

  const columns = {
    "auth.users": "id,email", "auth.identities": "id,user_id", "public.businesses": "id,slug,name",
    "public.business_memberships": "business_id,user_id,role,active", "public.finance_action_requests": "business_id,request_id",
    "public.platform_admins": "user_id,active,granted_by", "public.member_permission_changes": "id,business_id,actor_user_id,actor_role,target_user_id,permissions_before,permissions_after",
  };
  const sql = core.buildFullRestoreSql(withOptional(), columns);
  assert.match(sql, /or exists \(select 1 from public\.platform_admins\) or exists \(select 1 from public\.member_permission_changes\) then/);
  assert.ok(sql.indexOf("insert into public.platform_admins") > sql.indexOf("insert into auth.users"), "grants after their Auth users");
  assert.ok(sql.indexOf("insert into public.member_permission_changes") > sql.indexOf("insert into public.businesses"), "audit after its businesses");
  assert.match(sql, /select count\(\*\) from public\.member_permission_changes\) <> 1/);
  assert.doesNotMatch(sql, /grant |revoke |row level security|policy/i, "a restore never changes access rules");
  assert.throws(() => core.buildFullRestoreSql(withOptional(), { ...columns, "public.member_permission_changes": "" }), /apply the release files/);
  assert.doesNotMatch(core.buildFullRestoreSql(bundle(), columns), /platform_admins|member_permission_changes/);
  assert.deepEqual(Object.keys(core.comparableTables(withOptional())).slice(-2), ["platformAdmins", "permissionChanges"]);
  assert.ok(core.columnTablesFor(withOptional()).includes("public.member_permission_changes"));
  // A one-business restore never touches platform grants or audit history.
  assert.doesNotMatch(buildBusinessRestoreSql(withOptional(), B, columns), /platform_admins|member_permission_changes/);
});
