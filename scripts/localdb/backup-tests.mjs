#!/usr/bin/env node
// Operator backup tool proof on the LOCAL synthetic stack (scripts/backup).
// Requires a fresh `node scripts/localdb/setup.mjs reset`.
// Proves, through the real CLI:
// * export -> encrypted file + manifest + PASS; no plaintext on disk or in Git;
// * a failing export (database error) never reports PASS and leaves no file;
// * check alerts on FAIL and on a stale PASS; verify rejects tampered,
//   truncated and wrong-passphrase files;
// * a full restore is refused into a non-empty database, and into a rebuilt
//   empty database restores Auth, businesses, memberships, snapshots and the
//   request log consistently: every user signs in, tenant isolation holds, and a
//   retried request is "replayed", not applied twice;
// * a one-business restore puts back that business's snapshot together with its
//   request log, and leaves other businesses, memberships and Auth unchanged.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { EXPORT_SQL, sha256, stableStringify } from "../backup/lib/backupCore.mjs";
import { REPO_ROOT, WORKDIR, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD, SEED_USERS, TENANT_USERS } from "./seed-data.mjs";
import { rebuild } from "./setup.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;
const { default: handler } = await import("../../api/business/finance-actions.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};

const DIR = path.join(WORKDIR, "backup-tests", new Date().toISOString().replace(/[:.]/g, "-"));
const OUT = path.join(DIR, "out");
mkdirSync(OUT, { recursive: true });
const PASS_FILE = path.join(DIR, "passphrase.txt");
writeFileSync(PASS_FILE, randomBytes(24).toString("base64url"), { mode: 0o600 });
const WRONG_PASS_FILE = path.join(DIR, "wrong-passphrase.txt");
writeFileSync(WRONG_PASS_FILE, randomBytes(24).toString("base64url"), { mode: 0o600 });

const cli = (...args) => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/backup/backup.mjs"), ...args], { encoding: "utf8", cwd: REPO_ROOT, timeout: 600_000 });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};
const backups = () => readdirSync(OUT).filter((name) => name.endsWith(".tfbk")).sort();
const strays = () => readdirSync(OUT).filter((name) => name.endsWith(".partial") || (!name.endsWith(".tfbk") && !name.endsWith(".manifest.json") && name !== "backup-log.txt"));
const lastLog = () => readFileSync(path.join(OUT, "backup-log.txt"), "utf8").trim().split(/\r?\n/).pop();
const dbState = () => JSON.parse(psql(EXPORT_SQL).stdout.trim());
const hashRows = (rows) => sha256(rows.map(stableStringify).sort().join("\n"));
const tableHashes = (bundle) => ({
  businesses: hashRows(bundle.businesses),
  memberships: hashRows(bundle.memberships),
  snapshots: hashRows(bundle.workspaces),
  requestLog: hashRows(bundle.requests),
  authUsers: hashRows(bundle.users),
  authIdentities: hashRows(bundle.identities),
});
const forBusiness = (bundle, id) => ({
  snapshot: hashRows(bundle.workspaces.filter((w) => w.business_id === id)),
  requestLog: hashRows(bundle.requests.filter((q) => q.business_id === id)),
});

const version = (businessId) => psql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${businessId}';`).stdout.trim();
const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return data.session.access_token;
};
const send = async (token, businessId, body) => {
  assertLoopbackOnlyOrStop();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${token}` }, query: { business: businessId }, body }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* */ }
  return { status: res.statusCode, json };
};
const expenseBody = (businessId, description) => ({
  action: "capture.expense",
  requestId: randomUUID(),
  expectedVersion: version(businessId),
  fields: { expenseKind: "operational", category: "Fuel", description, expenseDate: "2026-10-20", amount: 75, cashExpense: false },
});
const countDescription = (businessId, description) =>
  Number(psql(`select count(*) from public.workspace_snapshots w, jsonb_array_elements(w.snapshot->'financeTransactions') t where w.business_id = '${businessId}' and t->>'description' = '${description}';`).stdout.trim());

// 1. Activity so the request log has fresh rows in both businesses ---------------
let driverA = await tokenFor("driver@example.com");
const r1 = expenseBody(BUSINESS_A_ID, "backup-r1");
let res = await send(driverA, BUSINESS_A_ID, r1);
record(res.status === 200 && res.json.replayed === false, "setup: a finance action in business A is committed", res.json.error);
const driverBToken = await tokenFor("driver.b@example.com");
res = await send(driverBToken, BUSINESS_B_ID, expenseBody(BUSINESS_B_ID, "backup-b0"));
record(res.status === 200, "setup: a finance action in business B is committed", res.json.error);

// Owner-set responsibilities (release file 06) that differ from the role
// defaults: an emptied Admin and a Manager limited to fleet. A restore must
// bring back exactly these, never re-grant the defaults.
const permissionsOf = () => psql(`select string_agg(role || '=' || array_to_string(permissions, '+'), ' ' order by role) from public.business_memberships where business_id = '${BUSINESS_A_ID}' and role in ('Admin', 'Manager') and active;`).stdout.trim();
psql(`update public.business_memberships set permissions = '{}' where business_id = '${BUSINESS_A_ID}' and role = 'Admin';
update public.business_memberships set permissions = array['fleet.manage'] where business_id = '${BUSINESS_A_ID}' and role = 'Manager' and active;`);
const permissionsBefore = permissionsOf();
record(permissionsBefore === "Admin= Manager=fleet.manage", "setup: Owner-set responsibilities differ from the role defaults", permissionsBefore);

// 2. Export ---------------------------------------------------------------------
const original = dbState();
let run = cli("export", "--target", "local", "--out-dir", OUT, "--passphrase-file", PASS_FILE);
const [firstBackup] = backups();
record(run.code === 0 && /PASS backup verified/.test(run.out) && lastLog().includes(" PASS ") && firstBackup, "export: PASS only after the written file was decrypted and checked", run.out.trim().split("\n")[0]);
const encrypted = readFileSync(path.join(OUT, firstBackup));
const manifestText = readFileSync(path.join(OUT, firstBackup.replace(/\.tfbk$/, ".manifest.json")), "utf8");
record(!/example\.com|workspace_key|encrypted_password|backup-r1/.test(encrypted.toString("latin1")), "the backup file holds no readable account, snapshot or finance data");
record(!manifestText.includes("@") && !manifestText.includes("backup-r1"), "the manifest holds counts, ids and hashes only (no emails or finance data)");
const manifest = JSON.parse(manifestText);
record(manifest.counts.requestLog === original.requests.length && manifest.counts.authUsers === original.users.length && manifest.counts.snapshots === original.workspaces.length, "manifest counts match the database (Auth, snapshots, request log)", JSON.stringify(manifest.counts));
record(strays().length === 0, "no partial or plaintext files are left in the backup folder", strays().join(","));

run = cli("verify", "--file", path.join(OUT, firstBackup), "--passphrase-file", PASS_FILE);
record(run.code === 0 && /PASS decrypts/.test(run.out), "verify: the backup decrypts, is complete and matches its manifest");
run = cli("check", "--out-dir", OUT);
record(run.code === 0 && /^OK/.test(run.out), "check: a recent PASS is OK", run.out.trim());
run = cli("check", "--out-dir", OUT, "--max-age-hours", "0");
record(run.code === 1 && /ALERT/.test(run.out), "check: a PASS older than the limit raises an ALERT", run.out.trim());

// 3. Failed export never reports PASS -------------------------------------------------
psql("alter table public.finance_action_requests rename to finance_action_requests_hidden;");
run = cli("export", "--target", "local", "--out-dir", OUT, "--passphrase-file", PASS_FILE);
psql("alter table public.finance_action_requests_hidden rename to finance_action_requests;");
record(run.code === 1 && !/PASS/.test(run.out) && backups().length === 1 && strays().length === 0 && /FAIL/.test(lastLog()), "a database failure during export: exit 1, FAIL logged, no backup file left", lastLog().slice(25, 120));
run = cli("check", "--out-dir", OUT);
record(run.code === 1 && /ALERT/.test(run.out), "check: the newest entry is a FAIL, so the morning check alerts", run.out.trim().slice(0, 100));
run = cli("export", "--target", "local", "--out-dir", OUT, "--passphrase-file", path.join(REPO_ROOT, "package.json"));
record(run.code === 1 && backups().length === 1 && /outside the repository/.test(run.out), "a passphrase file inside the repository is refused", run.out.trim().slice(0, 100));
run = cli("export", "--target", "local", "--out-dir", path.join(REPO_ROOT, "tmp-backups"), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /outside the repository/.test(run.out), "an output folder inside the repository is refused");

// 4. Damaged files and wrong passphrase are rejected ----------------------------------
const tampered = Buffer.from(encrypted);
tampered[Math.floor(tampered.length / 2)] ^= 0xff;
writeFileSync(path.join(DIR, "tampered.tfbk"), tampered);
writeFileSync(path.join(DIR, "truncated.tfbk"), encrypted.subarray(0, encrypted.length - 100));
for (const [label, file, passFile] of [["a tampered file", "tampered.tfbk", PASS_FILE], ["a truncated file", "truncated.tfbk", PASS_FILE], ["a wrong passphrase", null, WRONG_PASS_FILE]]) {
  run = cli("verify", "--file", file ? path.join(DIR, file) : path.join(OUT, firstBackup), "--passphrase-file", passFile);
  record(run.code === 1 && /FAIL/.test(run.out) && !/PASS/.test(run.out), `verify rejects ${label}`, run.out.trim().slice(0, 100));
}
copyFileSync(path.join(OUT, firstBackup), path.join(DIR, "renamed.tfbk"));
writeFileSync(path.join(DIR, "renamed.manifest.json"), manifestText.replace(manifest.ciphertextSha256, "0".repeat(64)));
run = cli("verify", "--file", path.join(DIR, "renamed.tfbk"), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /manifest/.test(run.out), "verify rejects a file whose manifest hash differs");

// 5. Full restore: refused into a non-empty database -----------------------------------
const beforeRefusal = tableHashes(dbState());
run = cli("restore", "--target", "local", "--file", path.join(OUT, firstBackup), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /TARGET NOT EMPTY/.test(run.out) && stableStringify(tableHashes(dbState())) === stableStringify(beforeRefusal), "a full restore into a non-empty database is refused and changes nothing", run.out.trim().slice(0, 100));
run = cli("restore", "--target", "local", "--file", path.join(OUT, firstBackup), "--passphrase-file", WRONG_PASS_FILE);
record(run.code === 1 && stableStringify(tableHashes(dbState())) === stableStringify(beforeRefusal), "a restore with the wrong passphrase is refused and changes nothing");

// 6. Full restore into a rebuilt, empty database ---------------------------------------
rebuild({ seed: false });
const empty = dbState();
record(empty.users.length === 0 && empty.workspaces.length === 0 && empty.requests.length === 0, "the database was rebuilt empty from the repo migrations", `users=${empty.users.length} snapshots=${empty.workspaces.length}`);
run = cli("restore", "--target", "local", "--file", path.join(OUT, firstBackup), "--passphrase-file", PASS_FILE);
record(run.code === 0 && /RESTORED full/.test(run.out), "full restore: the tool re-reads the database and every table matches", run.out.trim().split("\n").pop());
const restored = dbState();
const want = tableHashes(original);
const got = tableHashes(restored);
record(Object.keys(want).every((key) => want[key] === got[key]), "independent comparison: Auth users, identities, businesses, memberships, snapshots and request log equal the pre-backup database", JSON.stringify(Object.fromEntries(Object.keys(want).map((key) => [key, want[key] === got[key] ? "MATCH" : "DIFF"]))));
record(permissionsOf() === permissionsBefore, "responsibilities restore exactly (an emptied list is not re-granted)", permissionsOf());

const signIns = [];
for (const user of [...SEED_USERS, ...TENANT_USERS]) {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: LOCAL_TEST_PASSWORD });
  signIns.push({ client, email: user.email, ok: !error });
}
record(signIns.every((s) => s.ok), `all ${signIns.length} synthetic accounts sign in with their original passwords after the restore`);
const signedIn = Object.fromEntries(signIns.map((s) => [s.email, s.client]));
const seesA = await signedIn["owner@example.com"].from("businesses").select("id");
const seesB = await signedIn["owner.b@example.com"].from("businesses").select("id");
record(!seesA.error && seesA.data.length === 1 && seesA.data[0].id === BUSINESS_A_ID && !seesB.error && seesB.data.length === 1 && seesB.data[0].id === BUSINESS_B_ID, "business isolation holds after the restore (each Owner sees only their business)");
const direct = await signedIn["driver@example.com"].from("workspace_snapshots").select("workspace_key");
record(Boolean(direct.error) || direct.data.length === 0, "browsers still cannot read snapshots directly after the restore", direct.error?.code ?? `${direct.data?.length} rows`);

driverA = await tokenFor("driver@example.com");
const versionBeforeReplay = version(BUSINESS_A_ID);
res = await send(driverA, BUSINESS_A_ID, r1);
record(res.status === 200 && res.json.replayed === true && version(BUSINESS_A_ID) === versionBeforeReplay && countDescription(BUSINESS_A_ID, "backup-r1") === 1, "retry protection survives: the pre-backup request is replayed, not applied twice", `${res.status} replayed=${res.json.replayed}`);

// 7. One-business restore (snapshot + request log together) ----------------------------
const r2 = expenseBody(BUSINESS_A_ID, "backup-r2");
res = await send(driverA, BUSINESS_A_ID, r2);
const driverB = await tokenFor("driver.b@example.com");
res = await send(driverB, BUSINESS_B_ID, expenseBody(BUSINESS_B_ID, "backup-r3"));
const beforeBusinessRestore = dbState();
record(countDescription(BUSINESS_A_ID, "backup-r2") === 1 && countDescription(BUSINESS_B_ID, "backup-r3") === 1, "setup: later changes exist in both businesses");
run = cli("restore", "--target", "local", "--file", path.join(OUT, firstBackup), "--business", BUSINESS_A_ID, "--passphrase-file", PASS_FILE);
const afterBusinessRestore = dbState();
record(run.code === 0 && /RESTORED business/.test(run.out) && stableStringify(forBusiness(afterBusinessRestore, BUSINESS_A_ID)) === stableStringify(forBusiness(original, BUSINESS_A_ID)), "business A's snapshot and request log are back to the backup together", run.out.trim().split("\n").pop());
record(stableStringify(forBusiness(afterBusinessRestore, BUSINESS_B_ID)) === stableStringify(forBusiness(beforeBusinessRestore, BUSINESS_B_ID)) && countDescription(BUSINESS_B_ID, "backup-r3") === 1, "business B is untouched (its later change remains)");
const unchanged = (key) => hashRows(afterBusinessRestore[key]) === hashRows(beforeBusinessRestore[key]);
record(unchanged("memberships") && unchanged("users") && unchanged("identities") && unchanged("businesses"), "memberships, Auth and businesses are not touched by a one-business restore");
res = await send(driverA, BUSINESS_A_ID, r2);
record(res.status === 200 && res.json.replayed === false && countDescription(BUSINESS_A_ID, "backup-r2") === 1, "a request whose change was rolled back is applied again once (never reported as already applied)", `${res.status} replayed=${res.json.replayed} ${res.json.error ?? ""}`);
run = cli("restore", "--target", "local", "--file", path.join(OUT, firstBackup), "--business", randomUUID(), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /not in the backup/.test(run.out), "a business that is not in the backup is refused");

// 8. Hosted targets are refused before any connection without their guards --------------
run = cli("export", "--target", "vfxftviwteypasredjgm", "--out-dir", OUT, "--passphrase-file", PASS_FILE);
record(run.code === 1 && /env-file/.test(run.out) && backups().length === 1, "a hosted target without an env file outside the repo is refused before any connection", run.out.trim().slice(0, 100));

// 9. Nothing in Git ------------------------------------------------------------------------
const gitStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;
record(!/\.tfbk|backup-log|passphrase|\.partial/.test(gitStatus), "no backup, log or passphrase file appears in the repository");

const failed = results.filter((x) => !x.ok).length;
console.log(`\nevidence folder (outside the repo): ${DIR}`);
console.log(`${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
