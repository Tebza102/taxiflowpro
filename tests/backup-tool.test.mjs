import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { BACKUP_FORMAT, END_MARKER, EXPORT_SQL, buildBusinessRestoreSql, evaluateBackupLog, parseAndValidateBundle, validateBundle } from "../scripts/backup/lib/backupCore.mjs";
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
