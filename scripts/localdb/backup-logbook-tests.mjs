#!/usr/bin/env node
// Logbook recovery proof (release file 07) on the LOCAL synthetic stack, through
// the real backup CLI, the real /api/logbook handler and database functions, and
// a STUBBED vision model (synthetic replies; no network, no key).
// Requires a fresh `node scripts/localdb/setup.mjs reset`.
// Proves:
// * export -> encrypted backup holding all six logbook tables (synthetic page
//   photos, pending/approved/rejected rows, audit events, import keys and their
//   usage), counted in the manifest; verify passes;
// * a full restore into a rebuilt empty database brings every logbook table back
//   row for row (hash match), the photos byte for byte, with access rules intact;
// * after the restore new audit events are written (edit, approve, API import
//   with the restored key) without id collisions, and a re-upload of a restored
//   photo is still recognised;
// * a one-business restore puts that business's logbook queue back together with
//   its snapshot, so approved rows and logbook records stay consistent, leaves
//   import keys and other businesses alone, and accepts new events afterwards;
// * a backup taken before release file 07 (no logbook keys) stays readable:
//   verify passes, a full restore works, and a one-business restore is refused
//   (changing nothing) for a business that has logbook data.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { decryptBackup, encryptBackup } from "../backup/lib/backupCrypto.mjs";
import { REPO_ROOT, WORKDIR, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";
import { rebuild } from "./setup.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
process.env.LOGBOOK_VISION_MODEL = "synthetic-stub-model";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const { default: handler } = await import("../../api/logbook/[action].js");
const { setLogbookVisionClientForTests } = await import("../../api/_lib/logbookVision.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined && detail !== "" ? ` — ${detail}` : ""}`);
};
const sql = (text) => psql(text).stdout.trim();
const LOGBOOK = ["logbook_api_keys", "logbook_api_key_usage", "logbook_batches", "logbook_pages", "logbook_rows", "logbook_row_events"];
const QUEUE = ["logbook_batches", "logbook_pages", "logbook_rows", "logbook_row_events"];
// Order-independent hash of a table's rows (jsonb text is canonical), computed in
// the database so the page photos never have to be pulled through psql output.
const tableHash = (table, where = "true") =>
  sql(`select md5(coalesce(string_agg(h, ',' order by h), '')) || ':' || count(*) from (select md5(to_jsonb(t)::text) h from public.${table} t where ${where}) x;`);
const hashes = (tables, where) => Object.fromEntries(tables.map((table) => [table, tableHash(table, where)]));
const sameHashes = (a, b) => Object.keys(a).every((key) => a[key] === b[key]);
const diffKeys = (a, b) => Object.keys(a).filter((key) => a[key] !== b[key]).join(",") || "none";
const count = (table, where = "true") => Number(sql(`select count(*) from public.${table} where ${where};`));
const snapshotHash = (businessId) => sql(`select md5(snapshot::text) from public.workspace_snapshots where business_id = '${businessId}';`);
const photosIntact = () => count("logbook_pages", "encode(sha256(decode(image_base64, 'base64')), 'hex') <> sha256");
// Approved rows and the logbook records in the snapshot must describe the same rows.
const consistency = (businessId) => {
  const approved = sql(`select coalesce(string_agg(id::text, ',' order by id), '') from public.logbook_rows where business_id = '${businessId}' and status = 'approved';`);
  const recorded = sql(`select coalesce(string_agg(distinct t->'logbookImport'->>'rowId', ',' order by t->'logbookImport'->>'rowId'), '') from public.workspace_snapshots w, jsonb_array_elements(w.snapshot->'financeTransactions') t where w.business_id = '${businessId}' and t->>'source' = 'logbook-import';`);
  return { ok: approved === recorded, approved: approved ? approved.split(",").length : 0, recorded: recorded ? recorded.split(",").length : 0 };
};
const accessRules = () =>
  sql(`select string_agg(c.relname || ':' || c.relrowsecurity || ':' || (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = c.relname and g.grantee in ('anon', 'authenticated', 'PUBLIC')), ' ' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'logbook\\_%' and c.relkind = 'r';`);

// --- Transport: the real handler with local tokens ------------------------------------
let lastGuard = 0;
const guard = () => {
  if (Date.now() - lastGuard < 20_000) return;
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
  lastGuard = Date.now();
};
const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { token: data.session.access_token, client, userId: data.user.id };
};
const call = async (method, action, { token, apiKey, query = {}, body } = {}) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await handler({ method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(apiKey ? { "x-api-key": apiKey } : {}) }, query: { action, ...query }, ...(body !== undefined ? { body } : {}) }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* a file */ }
  return { status: res.statusCode, json, raw: res.body };
};
const get = (action, options) => call("GET", action, options);
const post = (action, options) => call("POST", action, options);

// --- Synthetic pages and the stubbed model ---------------------------------------------
// A page is a PNG signature, a marker line and padding (the "large" page is a
// realistic ~1.5 MB photo size); the stub answers by marker.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pageImage = (marker, padding = 64) => Buffer.concat([PNG_SIGNATURE, Buffer.from(`synthetic-logbook-page:${marker}\n`), randomBytes(padding)]);
const f = (value, confidence = "high", note = null) => ({ value, confidence, note });
const line = (date, revenue, fuel, wash, marshal, { vehicle = "UAT-TEST-01", driver = "UAT Driver", ...overrides } = {}) => ({
  date: f(date), vehicleRegistration: f(vehicle), driverName: f(driver), revenue: f(revenue), fuel: f(fuel), wash: f(wash), marshalFees: f(marshal), otherExpenses: f(0), banked: f(revenue - fuel - wash - marshal), ...overrides,
});
const replies = {
  large: [line("2026-11-02", 1390, 430, 50, 30), line("2026-11-03", 1705, 500, 70, 30), line("2026-11-04", 1240, 400, 0, 30, { wash: f(null, "low", "ink blot over the amount") })],
  second: [line("2026-11-05", 1100, 300, 0, 30)],
  "business-b": [line("2026-11-03", 1500, 400, 50, 30, { vehicle: "UAT-TEST-01-B", driver: "UAT Driver B" })],
};
setLogbookVisionClientForTests({
  messages: {
    create: async (request) => {
      const bytes = Buffer.from(request.messages[0].content[0].source.data, "base64").subarray(PNG_SIGNATURE.length);
      const marker = bytes.subarray(0, bytes.indexOf(0x0a)).toString("utf8").replace("synthetic-logbook-page:", "");
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ rows: replies[marker], pageNote: null }) }] };
    },
  },
});
const upload = (filename, image) => ({ filename, mediaType: "image/png", dataBase64: image.toString("base64") });
const batchRows = async (who, batchId) => (await get("batch", { token: who.token, query: { id: batchId } })).json.rows;

// --- Backup CLI --------------------------------------------------------------------------
const DIR = path.join(WORKDIR, "backup-logbook-tests", new Date().toISOString().replace(/[:.]/g, "-"));
const OUT = path.join(DIR, "out");
mkdirSync(OUT, { recursive: true });
const PASS_FILE = path.join(DIR, "passphrase.txt");
const PASSPHRASE = randomBytes(24).toString("base64url");
writeFileSync(PASS_FILE, PASSPHRASE, { mode: 0o600 });
const cli = (...args) => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/backup/backup.mjs"), ...args], { encoding: "utf8", cwd: REPO_ROOT, timeout: 900_000 });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, last: `${result.stdout}${result.stderr}`.trim().split("\n").pop() };
};

// === 1. Synthetic logbook data in both businesses ========================================
let ownerA = await tokenFor("owner@example.com");
let ownerB = await tokenFor("owner.b@example.com");
const largePhoto = pageImage("large", 1_500_000);
let r = await post("extract", { token: ownerA.token, body: { pages: [upload("logbook-large.png", largePhoto)] } });
const batchLarge = r.json.batchId;
record(r.status === 200 && r.json.queuedRows === 3, "setup: Owner A uploads a ~1.5 MB synthetic page photo; 3 rows wait for review", `${r.status} ${r.json.error ?? ""}`);
let rowsLarge = await batchRows(ownerA, batchLarge);
r = await post("row-approve", { token: ownerA.token, body: { rowId: rowsLarge[0].id } });
record(r.status === 200, "setup: row 1 approved (records written to the snapshot)", `${r.status} ${r.json.error ?? ""}`);
r = await post("row-reject", { token: ownerA.token, body: { rowId: rowsLarge[1].id, reason: "Wrong week's page" } });
record(r.status === 200, "setup: row 2 rejected with a reason", `${r.status} ${r.json.error ?? ""}`);
r = await post("extract", { token: ownerA.token, body: { pages: [upload("logbook-second.png", pageImage("second"))] } });
const batchSecond = r.json.batchId;
record(r.status === 200 && r.json.queuedRows === 1, "setup: a second page leaves one more pending row", `${r.status}`);
r = await post("keys", { token: ownerA.token, body: { action: "create", name: "Scanner station" } });
const keyA = r.json.created?.key;
const keyAId = r.json.created?.id;
r = await post("import", { apiKey: keyA, body: { reference: "scanner-run-1", rows: [line("2026-11-06", 900, 200, 0, 30)] } });
record(r.status === 200 && r.json.queuedRows === 1, "setup: an import key is created and imports one pending row (key usage and an API audit event)", `${r.status} ${r.json.error ?? ""}`);
r = await post("keys", { token: ownerA.token, body: { action: "create", name: "Old scanner" } });
const oldKeyId = r.json.created?.id;
r = await post("keys", { token: ownerA.token, body: { action: "revoke", keyId: oldKeyId } });
record(r.status === 200 && count("logbook_api_keys", "revoked_at is not null") === 1, "setup: a second key is created and revoked", `${r.status}`);
r = await post("extract", { token: ownerB.token, body: { pages: [upload("logbook-b.png", pageImage("business-b"))] } });
const batchB = r.json.batchId;
record(r.status === 200 && r.json.queuedRows === 1, "setup: Owner B uploads a page; one pending row in business B", `${r.status}`);

const counts0 = Object.fromEntries(LOGBOOK.map((table) => [table, count(table)]));
record(Object.values(counts0).every((n) => n > 0) && count("logbook_rows", "status = 'pending'") === 4 && count("logbook_rows", "status = 'approved'") === 1 && count("logbook_rows", "status = 'rejected'") === 1, "setup: all six tables hold rows (pending, approved and rejected rows; photos; events; keys; usage)", JSON.stringify(counts0));
record(photosIntact() === 0, "setup: every stored photo matches its SHA-256");
record(consistency(BUSINESS_A_ID).ok && consistency(BUSINESS_A_ID).approved === 1, "setup: business A's approved rows and logbook records agree", JSON.stringify(consistency(BUSINESS_A_ID)));
const original = hashes(LOGBOOK);
const originalSnapshotA = snapshotHash(BUSINESS_A_ID);
const accessBefore = accessRules();
record(/logbook_api_keys:true:0/.test(accessBefore) && accessBefore.split(" ").length === 6 && accessBefore.split(" ").every((entry) => entry.endsWith(":true:0")), "setup: all six tables have RLS on and no browser grants", accessBefore);

// === 2. Export and verify ==================================================================
let run = cli("export", "--target", "local", "--out-dir", OUT, "--passphrase-file", PASS_FILE);
const [backupFile] = readdirSync(OUT).filter((name) => name.endsWith(".tfbk"));
record(run.code === 0 && /PASS backup verified/.test(run.out) && Boolean(backupFile), "export: PASS (written file decrypted and checked)", run.out.trim().split("\n")[0]);
const manifest = JSON.parse(readFileSync(path.join(OUT, backupFile.replace(/\.tfbk$/, ".manifest.json")), "utf8"));
const c = manifest.counts;
record(
  c.logbookApiKeys === counts0.logbook_api_keys && c.logbookApiKeyUsage === counts0.logbook_api_key_usage && c.logbookBatches === counts0.logbook_batches && c.logbookPages === counts0.logbook_pages && c.logbookRows === counts0.logbook_rows && c.logbookRowEvents === counts0.logbook_row_events,
  "the manifest counts all six logbook tables",
  JSON.stringify(c),
);
const encrypted = readFileSync(path.join(OUT, backupFile));
record(!encrypted.toString("latin1").includes("synthetic-logbook-page") && !encrypted.toString("latin1").includes("Scanner station"), "the backup file holds no readable photo or logbook data");
record(!JSON.stringify(manifest).includes("Scanner") && !JSON.stringify(manifest).includes("1705"), "the manifest holds counts and ids only");
run = cli("verify", "--file", path.join(OUT, backupFile), "--passphrase-file", PASS_FILE);
record(run.code === 0 && /PASS decrypts/.test(run.out), "verify: the backup decrypts and matches its manifest", run.last);

// A backup in the shape taken before release file 07 (no logbook keys), same
// format; no manifest, as an operator would hold for an older file.
const bundle = JSON.parse(decryptBackup(encrypted, PASSPHRASE).toString("utf8"));
const older = Object.fromEntries(Object.entries(bundle).filter(([key]) => !key.startsWith("logbook_")));
const OLDER_FILE = path.join(DIR, "older-shape.tfbk");
writeFileSync(OLDER_FILE, encryptBackup(Buffer.from(JSON.stringify(older), "utf8"), PASSPHRASE), { mode: 0o600 });
run = cli("verify", "--file", OLDER_FILE, "--passphrase-file", PASS_FILE);
record(run.code === 0 && /PASS decrypts/.test(run.out) && !/logbook/.test(run.out), "an older backup without logbook tables is still readable (verify PASS)", run.last);

// === 3. Full restore =========================================================================
run = cli("restore", "--target", "local", "--file", path.join(OUT, backupFile), "--passphrase-file", PASS_FILE);
record(run.code === 1 && /TARGET NOT EMPTY/.test(run.out) && sameHashes(hashes(LOGBOOK), original), "a full restore into a non-empty database is refused and changes nothing", run.last.slice(0, 100));
rebuild({ seed: false });
record(LOGBOOK.every((table) => count(table) === 0) && count("workspace_snapshots") === 0, "the database was rebuilt empty from the repo migrations (release file 07 included)");
run = cli("restore", "--target", "local", "--file", path.join(OUT, backupFile), "--passphrase-file", PASS_FILE);
const toolChecks = run.last;
record(run.code === 0 && /RESTORED full/.test(run.out) && ["logbookApiKeys", "logbookApiKeyUsage", "logbookBatches", "logbookPages", "logbookRows", "logbookRowEvents"].every((label) => toolChecks.includes(`"${label}":"MATCH"`)), "full restore: the tool re-reads the database and all six logbook tables match", toolChecks.slice(0, 400));
const restored = hashes(LOGBOOK);
record(sameHashes(restored, original), "independent comparison: every logbook table equals the pre-backup database row for row", `differs: ${diffKeys(original, restored)}`);
record(photosIntact() === 0 && count("logbook_pages", "byte_size > 1000000") === 1, "the page photos restore byte for byte (SHA-256 of every image matches)");
record(snapshotHash(BUSINESS_A_ID) === originalSnapshotA && consistency(BUSINESS_A_ID).ok, "business A's snapshot is restored and still agrees with its approved logbook rows", JSON.stringify(consistency(BUSINESS_A_ID)));
record(accessRules() === accessBefore, "after the restore all six tables still have RLS on and no browser grants", accessRules());

// === 4. New writes after the restore ===========================================================
ownerA = await tokenFor("owner@example.com");
ownerB = await tokenFor("owner.b@example.com");
const direct = await ownerA.client.from("logbook_rows").select("id").limit(1);
record(Boolean(direct.error) || (direct.data ?? []).length === 0, "a signed-in browser still cannot read logbook_rows directly", direct.error?.code ?? `${(direct.data ?? []).length} rows`);
const maxEvent = Number(sql("select max(id) from public.logbook_row_events;"));
rowsLarge = await batchRows(ownerA, batchLarge);
const blotted = rowsLarge.find((x) => x.status === "pending");
r = await post("row-edit", { token: ownerA.token, body: { rowId: blotted.id, values: { wash: 70, banked: 740 } } });
const editEvent = sql(`select id || ':' || action from public.logbook_row_events where row_id = '${blotted.id}' order by id desc limit 1;`);
record(r.status === 200 && Number(editEvent.split(":")[0]) > maxEvent && editEvent.endsWith(":edited"), "after the restore a new audit event is written (edit) with a fresh id above the restored ones", `${r.status} event ${editEvent} > ${maxEvent} ${r.json.error ?? ""}`);
r = await post("row-approve", { token: ownerA.token, body: { rowId: blotted.id, acknowledgeWarnings: true } });
record(r.status === 200 && count("logbook_row_events", `row_id = '${blotted.id}' and action = 'approved'`) === 1 && consistency(BUSINESS_A_ID).ok, "a restored pending row is approved: records written, approval event logged, queue and snapshot agree", `${r.status} ${r.json.error ?? ""} ${JSON.stringify(consistency(BUSINESS_A_ID))}`);
r = await post("import", { apiKey: keyA, body: { reference: "scanner-run-2", rows: [line("2026-11-07", 800, 100, 0, 30)] } });
record(r.status === 200 && r.json.queuedRows === 1 && count("logbook_row_events", `actor_api_key_id = '${keyAId}'`) === 2, "the restored import key still works (stored hash restored) and its import is logged", `${r.status} ${r.json.error ?? ""}`);
const oldKeyStillRevoked = count("logbook_api_keys", `id = '${oldKeyId}' and revoked_at is not null`) === 1;
record(oldKeyStillRevoked, "the revoked key is restored as revoked");
r = await post("extract", { token: ownerA.token, body: { pages: [upload("again.png", largePhoto)] } });
record(r.status === 200 && r.json.queuedRows === 0 && r.json.pages?.[0]?.duplicatePage === true && r.json.batchId === batchLarge, "re-uploading a restored photo is recognised (nothing new queued)", `${r.status} queued ${r.json.queuedRows}`);

// === 5. One-business restore keeps the logbook queue consistent with the snapshot ================
const keysBefore = hashes(["logbook_api_keys"]);
r = await post("keys", { token: ownerA.token, body: { action: "create", name: "Key made after the backup" } });
const lateKeyId = r.json.created?.id;
const bBefore = { ...hashes(QUEUE, `business_id = '${BUSINESS_B_ID}'`), snapshot: snapshotHash(BUSINESS_B_ID) };
record(consistency(BUSINESS_A_ID).approved === 2 && Boolean(lateKeyId), "setup: business A has changed since the backup (2 approved rows, new events, a new key)", JSON.stringify(consistency(BUSINESS_A_ID)));
run = cli("restore", "--target", "local", "--file", path.join(OUT, backupFile), "--business", BUSINESS_A_ID, "--passphrase-file", PASS_FILE);
record(run.code === 0 && /RESTORED business/.test(run.out) && QUEUE.every((t) => run.last.includes(`"${t}":"MATCH"`)), "one-business restore: the tool compares the snapshot, request log and logbook queue of business A", run.last.slice(0, 300));
record(snapshotHash(BUSINESS_A_ID) === originalSnapshotA, "business A's snapshot is back to the backup");
record(consistency(BUSINESS_A_ID).ok && consistency(BUSINESS_A_ID).approved === 1 && count("logbook_rows", `id = '${blotted.id}' and status = 'pending'`) === 1, "business A's logbook queue went back with it: the row approved after the backup is pending again, and approved rows and logbook records agree", JSON.stringify(consistency(BUSINESS_A_ID)));
record(count("logbook_row_events", `business_id = '${BUSINESS_A_ID}' and id > ${maxEvent}`) === 0, "business A's audit events are those of the backup point (later events are in later backups)");
record(sameHashes({ ...hashes(QUEUE, `business_id = '${BUSINESS_B_ID}'`), snapshot: snapshotHash(BUSINESS_B_ID) }, bBefore), "business B's snapshot and logbook queue are untouched");
record(count("logbook_api_keys", `id = '${lateKeyId}'`) === 1 && oldKeyStillRevoked && count("logbook_api_keys", `id = '${oldKeyId}' and revoked_at is not null`) === 1 && keysBefore.logbook_api_keys !== tableHash("logbook_api_keys"), "import keys are not rolled back (the key made after the backup remains; the revoked key stays revoked)");
r = await post("row-edit", { token: ownerA.token, body: { rowId: blotted.id, values: { wash: 70, banked: 740 } } });
const nextEvent = Number(sql(`select max(id) from public.logbook_row_events where row_id = '${blotted.id}';`));
r = await post("row-approve", { token: ownerA.token, body: { rowId: blotted.id, acknowledgeWarnings: true } });
record(r.status === 200 && nextEvent > maxEvent && consistency(BUSINESS_A_ID).ok && consistency(BUSINESS_A_ID).approved === 2, "after the one-business restore new events are written and the row approves again exactly once", `${r.status} ${r.json.error ?? ""} ${JSON.stringify(consistency(BUSINESS_A_ID))}`);

// === 6. An older backup against a target with logbook data ==========================================
const beforeOlder = { ...hashes(LOGBOOK), snapshot: snapshotHash(BUSINESS_A_ID) };
run = cli("restore", "--target", "local", "--file", OLDER_FILE, "--business", BUSINESS_A_ID, "--passphrase-file", PASS_FILE);
record(run.code === 1 && /BACKUP HAS NO LOGBOOK DATA/.test(run.out) && sameHashes({ ...hashes(LOGBOOK), snapshot: snapshotHash(BUSINESS_A_ID) }, beforeOlder), "a one-business restore from a pre-logbook backup is refused for a business with logbook data, and changes nothing", run.last.slice(0, 140));
rebuild({ seed: false });
run = cli("restore", "--target", "local", "--file", OLDER_FILE, "--passphrase-file", PASS_FILE);
record(run.code === 0 && /RESTORED full/.test(run.out) && LOGBOOK.every((table) => count(table) === 0), "a full restore of a pre-logbook backup still works (logbook tables stay empty)", run.last.slice(0, 200));
void batchSecond;
void batchB;

const gitStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout;
record(!/\.tfbk|backup-log\.txt|passphrase|\.partial/.test(gitStatus), "no backup, log or passphrase file appears in the repository");

const failed = results.filter((x) => !x.ok).length;
console.log(`\nevidence folder (outside the repo): ${DIR}`);
console.log(`${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
