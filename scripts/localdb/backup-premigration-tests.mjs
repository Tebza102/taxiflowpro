#!/usr/bin/env node
// Pre-migration backup proof on the LOCAL exact copy of the live schema.
// Requires a fresh `node scripts/localdb/setup.mjs hosted-pre` (live schema
// copy + legacy synthetic seed; release files NOT applied), i.e. the shape
// production has before release rows 7-8.
// Proves, through the real CLI:
// * the schema probe picks the pre-migration format; export -> PASS;
// * a full restore is refused into a non-empty database, and a one-business
//   restore is refused for a pre-migration backup;
// * into a rebuilt EMPTY pre-migration schema, the restore brings back Auth,
//   snapshots and legacy tables exactly; every synthetic account signs in;
// * release files 01-04 then apply to the restored data (the workspace maps to
//   the legacy business with an active Owner), and a tenant-format export of
//   the migrated database also passes.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { EXPORT_SQL_PRE_MIGRATION, LEGACY_TABLES, sha256, stableStringify } from "../backup/lib/backupCore.mjs";
import { REPO_ROOT, WORKDIR, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { LOCAL_TEST_PASSWORD, SEED_USERS } from "./seed-data.mjs";
import { HOSTED_RELEASE, rebuild } from "./setup.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
const results = [];
const record = (ok, name, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};

const DIR = path.join(WORKDIR, "backup-premigration-tests", new Date().toISOString().replace(/[:.]/g, "-"));
const OUT = path.join(DIR, "out");
mkdirSync(OUT, { recursive: true });
const PASS_FILE = path.join(DIR, "passphrase.txt");
writeFileSync(PASS_FILE, randomBytes(24).toString("base64url"), { mode: 0o600 });
const cli = (...args) => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/backup/backup.mjs"), ...args], { encoding: "utf8", cwd: REPO_ROOT, timeout: 600_000 });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};
const backups = () => readdirSync(OUT).filter((name) => name.endsWith(".tfbk")).sort();
const hashRows = (rows) => sha256(rows.map(stableStringify).sort().join("\n"));
const state = () => JSON.parse(psql(EXPORT_SQL_PRE_MIGRATION).stdout.trim());
const hashes = (b) => ({
  snapshots: hashRows(b.workspaces),
  authUsers: hashRows(b.users),
  authIdentities: hashRows(b.identities),
  ...Object.fromEntries(LEGACY_TABLES.map((table) => [table, hashRows(b.legacy_tables[table])])),
});

// 0. Precondition: pre-migration schema with data.
const isPre = psql("select to_regclass('public.businesses') is null;").stdout.trim() === "t";
const original = state();
record(isPre && original.workspaces.length > 0 && original.users.length > 0, "setup: pre-migration schema (no tenant tables) with the legacy workspace and Auth users", `snapshots=${original.workspaces.length} users=${original.users.length}`);

// 1. Export picks the pre-migration format.
let run = cli("export", "--target", "local", "--out-dir", OUT, "--passphrase-file", PASS_FILE);
const [file] = backups();
record(run.code === 0 && /PASS backup verified \(taxiflow-backup-premigration-v1\)/.test(run.out) && file, "export: the schema probe chose the pre-migration format and the backup verified", run.out.trim().split("\n")[0]);
const manifest = JSON.parse(readFileSync(path.join(OUT, file.replace(/\.tfbk$/, ".manifest.json")), "utf8"));
record(manifest.format === "taxiflow-backup-premigration-v1" && manifest.counts.snapshots === original.workspaces.length && manifest.counts.authUsers === original.users.length && !JSON.stringify(manifest).includes("@"), "manifest: pre-migration counts, no emails", JSON.stringify(manifest.counts));
const log = readFileSync(path.join(OUT, "backup-log.txt"), "utf8");
record(/PASS .* format=taxiflow-backup-premigration-v1 /.test(log), "the log line records the format");
run = cli("verify", "--file", path.join(OUT, file), "--passphrase-file", PASS_FILE);
record(run.code === 0 && /PASS decrypts/.test(run.out), "verify: decrypts, complete, matches its manifest");

// 2. Refusals.
const before = stableStringify(hashes(state()));
run = cli("restore", "--target", "local", "--file", path.join(OUT, file), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /TARGET NOT EMPTY/.test(run.out) && stableStringify(hashes(state())) === before, "a full restore into a non-empty database is refused and changes nothing", run.out.trim().slice(0, 90));
run = cli("restore", "--target", "local", "--file", path.join(OUT, file), "--business", randomUUID(), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /after the tenant migration/.test(run.out), "a one-business restore is refused for a pre-migration backup");

// 3. Restore into a rebuilt, empty pre-migration schema.
rebuild({ seed: false, hosted: true, releaseFiles: false });
const empty = state();
record(empty.users.length === 0 && empty.workspaces.length === 0, "rebuilt: empty pre-migration schema (live copy, no data)");
run = cli("restore", "--target", "local", "--file", path.join(OUT, file), "--passphrase-file", PASS_FILE);
record(run.code === 0 && /RESTORED full/.test(run.out), "full restore: the tool re-read the database and every table matches", run.out.trim().split("\n").pop());
const restored = state();
const want = hashes(original);
const got = hashes(restored);
record(Object.keys(want).every((key) => want[key] === got[key]), "independent comparison: Auth, snapshots and all 8 legacy tables equal the original", JSON.stringify(Object.fromEntries(Object.keys(want).map((key) => [key, want[key] === got[key] ? "MATCH" : "DIFF"]))));
let signIns = 0;
for (const user of SEED_USERS) {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: LOCAL_TEST_PASSWORD });
  if (!error) signIns += 1;
}
record(signIns === SEED_USERS.length, `all ${SEED_USERS.length} synthetic accounts sign in with their original passwords`);

// 4. The release files apply to the restored data.
assertLoopbackOnlyOrStop();
assertLocalDatabase();
let migrated = true;
for (const releaseFile of HOSTED_RELEASE) {
  const result = psql(`begin;\n${readFileSync(releaseFile, "utf8")}\ncommit;\n`, { allowFailure: true });
  if (result.status !== 0) {
    migrated = false;
    record(false, `release file ${path.basename(releaseFile)} applies to the restored data`, (result.stderr || "").trim().split("\n").pop());
  }
}
const mapped = psql("select (select count(*) from public.workspace_snapshots where business_id is null) || ',' || (select count(*) from public.business_memberships where active and role = 'Owner');").stdout.trim().split(",").map(Number);
record(migrated && mapped[0] === 0 && mapped[1] >= 1, "release files 01-04 apply to the restored data: every snapshot mapped, an active Owner exists", `unmapped=${mapped[0]} activeOwners=${mapped[1]}`);
run = cli("export", "--target", "local", "--out-dir", OUT, "--passphrase-file", PASS_FILE);
record(run.code === 0 && /PASS backup verified \(taxiflow-backup-v1\)/.test(run.out), "after migration, the probe switches to the tenant format and the export passes", run.out.trim().split("\n")[0]);

const failed = results.filter((ok) => !ok).length;
console.log(`\nevidence folder (outside the repo): ${DIR}`);
console.log(`${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
