#!/usr/bin/env node
// TaxiFlow operator backup: encrypted, consistent, verified.
//
//   node scripts/backup/backup.mjs export  --target <local|ref> --out-dir <dir> [--env-file <f>] [--passphrase-file <f>]
//   node scripts/backup/backup.mjs verify  --file <backup.tfbk> [--passphrase-file <f>]
//   node scripts/backup/backup.mjs check   --out-dir <dir> [--max-age-hours 26]
//   node scripts/backup/backup.mjs restore --target <local|ref> --file <backup.tfbk> [--business <uuid>] [--env-file <f>] [--passphrase-file <f>]
//
// export: one read-only REPEATABLE READ transaction (businesses, memberships,
//   snapshots, finance request log, Auth users and identities), validated, then
//   encrypted in memory (AES-256-GCM). The file is written as .partial, read
//   back, decrypted and compared with the export hash and counts; only then is
//   it renamed and "PASS" appended to <out-dir>/backup-log.txt. Any failure
//   removes the partial file and appends "FAIL <reason>". Plaintext never
//   touches disk. Output and secrets must be outside the repository.
// check: the morning check; exit 1 unless the newest log line is a recent PASS.
// restore: full restore into an EMPTY project (Auth, businesses, memberships,
//   snapshots, request log in one transaction), or --business: that business's
//   snapshot together with its request log (memberships and Auth untouched).
//   The target is re-read afterwards and compared with the backup.
//
// Hosted targets (a project ref) have NOT been run yet. They need --env-file
// outside the repo, an interactive terminal and the typed project ref.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  PRE_MIGRATION_FORMAT,
  SCHEMA_PROBE_SQL,
  buildBusinessRestoreSql,
  buildFullRestoreSql,
  buildManifest,
  buildPreMigrationRestoreSql,
  columnTablesFor,
  columnsSql,
  comparableTables,
  evaluateBackupLog,
  exportSqlFor,
  parseAndValidateBundle,
  sameCounts,
  sha256,
  stableStringify,
} from "./lib/backupCore.mjs";
import { assertPassphrase, decryptBackup, encryptBackup } from "./lib/backupCrypto.mjs";
import { assertOutsideRepo, resolveBackupTarget } from "./lib/backupTarget.mjs";

const HOSTED_PSQL_IMAGE = "public.ecr.aws/supabase/postgres:17.11.0.004";
const argv = process.argv.slice(2);
const command = argv[0];
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

// --- Transport (psql over stdin; secrets only via the child environment) --------

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

const runPsql = (args, sql, env) => {
  const result = spawnSync("docker", args, { input: sql, encoding: "utf8", env, maxBuffer: 512 << 20, timeout: 900_000 });
  if (result.error) throw new Error(`psql could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`psql failed (exit ${result.status}): ${(result.stderr || "").trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300)}`);
  return result.stdout;
};

// --- Passphrase -------------------------------------------------------------------

const promptHidden = (question) =>
  new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("No terminal for the passphrase prompt; use an interactive terminal."));
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });

const readPassphrase = async ({ confirm }) => {
  const file = option("passphrase-file");
  if (file) {
    const passphrase = readFileSync(assertOutsideRepo(file, "--passphrase-file"), "utf8").replace(/\r?\n$/, "");
    assertPassphrase(passphrase);
    return passphrase;
  }
  const passphrase = await promptHidden("Backup passphrase: ");
  assertPassphrase(passphrase);
  if (confirm && (await promptHidden("Repeat the passphrase: ")) !== passphrase) throw new Error("The passphrases do not match.");
  return passphrase;
};

const confirmHosted = async (target, action) => {
  if (target.kind !== "hosted") return;
  console.log(`Target project: ${target.ref} (${target.connection.PGHOST})\nOperation     : ${action}`);
  if (!process.stdin.isTTY) throw new Error("A hosted target needs an interactive terminal for confirmation.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Type the project ref (${target.ref}) to continue: `, resolve));
  rl.close();
  if (answer.trim() !== target.ref) throw new Error("Confirmation did not match; nothing was done.");
};

// --- Helpers ----------------------------------------------------------------------

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const oneLine = (text) => String(text).replace(/\s+/g, " ").slice(0, 300);
const readTargetColumns = (psql, tables) => Object.fromEntries(tables.map((table) => [table, psql(columnsSql(table)).trim()]));
// Which schema the database has: "pre-migration" (before release files 01-04) or "tenant".
const probeSchema = (psql) => {
  const schema = psql(SCHEMA_PROBE_SQL).trim();
  if (schema !== "pre-migration" && schema !== "tenant") throw new Error(`unexpected schema probe result "${schema}".`);
  return schema;
};
const exportFrom = (psql) => {
  const text = psql(exportSqlFor(probeSchema(psql))).trim();
  return { text, bundle: parseAndValidateBundle(text) };
};
const rowsHash = (rows) => sha256(rows.map((row) => stableStringify(row)).sort().join("\n"));

const decryptFile = (file, passphrase) => {
  const encrypted = readFileSync(file);
  const plaintext = decryptBackup(encrypted, passphrase);
  const bundle = parseAndValidateBundle(plaintext.toString("utf8"));
  const manifestFile = `${file.replace(/\.tfbk$/, "")}.manifest.json`;
  if (existsSync(manifestFile)) {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    if (manifest.ciphertextSha256 !== sha256(encrypted)) throw new Error("The file does not match its manifest (hash differs).");
    if (manifest.plaintextSha256 !== sha256(plaintext) || !sameCounts(bundle, manifest)) throw new Error("The decrypted content does not match its manifest.");
  }
  return { bundle, plaintextSha256: sha256(plaintext) };
};

// --- Commands ---------------------------------------------------------------------

const runExport = async () => {
  const target = resolveBackupTarget({ target: option("target"), envFile: option("env-file") });
  const outDir = assertOutsideRepo(option("out-dir"), "--out-dir");
  mkdirSync(outDir, { recursive: true });
  if (!statSync(outDir).isDirectory()) throw new Error("--out-dir is not a directory.");
  const logFile = path.join(outDir, "backup-log.txt");
  const base = `taxiflow-${target.label}-${stamp()}`;
  const finalFile = path.join(outDir, `${base}.tfbk`);
  const partialFile = `${finalFile}.partial`;
  const manifestFile = path.join(outDir, `${base}.manifest.json`);
  const failLine = (reason) => appendFileSync(logFile, `${new Date().toISOString()} FAIL ${oneLine(reason)}\n`);
  try {
    await confirmHosted(target, "encrypted backup export (read-only)");
    const passphrase = await readPassphrase({ confirm: true });
    const psql = await psqlFor(target);

    const { text, bundle } = exportFrom(psql);
    const plaintext = Buffer.from(text, "utf8");
    const plaintextSha256 = sha256(plaintext);
    const encrypted = encryptBackup(plaintext, passphrase);
    writeFileSync(partialFile, encrypted, { mode: 0o600 });

    // Verify what is on disk, not what is in memory.
    const written = readFileSync(partialFile);
    if (written.length !== encrypted.length) throw new Error("the written file is shorter than the encrypted backup.");
    const roundTrip = decryptBackup(written, passphrase);
    if (sha256(roundTrip) !== plaintextSha256) throw new Error("the decrypted file does not match the export.");
    const check = parseAndValidateBundle(roundTrip.toString("utf8"));
    const manifest = buildManifest(bundle, { plaintextSha256, ciphertextSha256: sha256(written), target: target.label, file: path.basename(finalFile) });
    if (!sameCounts(check, manifest)) throw new Error("the decrypted counts differ from the export.");

    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    renameSync(partialFile, finalFile);
    const c = manifest.counts;
    appendFileSync(logFile, `${new Date().toISOString()} PASS ${path.basename(finalFile)} format=${manifest.format} sha256=${manifest.ciphertextSha256} ${Object.entries(c).map(([key, value]) => `${key}=${value}`).join(" ")}\n`);
    console.log(`PASS backup verified (${manifest.format}): ${finalFile}`);
    console.log(`counts ${JSON.stringify(c)}`);
    return 0;
  } catch (error) {
    rmSync(partialFile, { force: true });
    rmSync(manifestFile, { force: true });
    failLine(error.message);
    console.error(`FAIL backup not created: ${oneLine(error.message)}`);
    return 1;
  }
};

const runVerify = async () => {
  const file = path.resolve(option("file") ?? "");
  if (!existsSync(file)) throw new Error("--file does not exist.");
  const passphrase = await readPassphrase({ confirm: false });
  const { bundle } = decryptFile(file, passphrase);
  console.log(`PASS decrypts, complete and consistent: ${JSON.stringify(buildManifest(bundle, {}).counts)}`);
  return 0;
};

const runCheck = () => {
  const outDir = assertOutsideRepo(option("out-dir"), "--out-dir");
  const logFile = path.join(outDir, "backup-log.txt");
  const result = evaluateBackupLog(existsSync(logFile) ? readFileSync(logFile, "utf8") : "", { maxAgeHours: Number(option("max-age-hours") ?? 26) });
  console.log(`${result.ok ? "OK" : "ALERT"}: ${result.reason}`);
  return result.ok ? 0 : 1;
};

const runRestore = async () => {
  const target = resolveBackupTarget({ target: option("target"), envFile: option("env-file") });
  const file = path.resolve(option("file") ?? "");
  if (!existsSync(file)) throw new Error("--file does not exist.");
  const businessId = option("business");
  await confirmHosted(target, businessId ? `restore business ${businessId} (snapshot + request log)` : "FULL restore into an empty project");
  const passphrase = await readPassphrase({ confirm: false });
  const { bundle } = decryptFile(file, passphrase);
  const psql = await psqlFor(target);
  const columns = readTargetColumns(psql, columnTablesFor(bundle));
  if (businessId) psql(buildBusinessRestoreSql(bundle, businessId, columns));
  else psql(bundle.format === PRE_MIGRATION_FORMAT ? buildPreMigrationRestoreSql(bundle, columns) : buildFullRestoreSql(bundle, columns));

  // Re-read the target and compare with the backup.
  const { bundle: after } = exportFrom(psql);
  if (after.format !== bundle.format) throw new Error(`the restored database is ${after.format}, the backup is ${bundle.format}.`);
  let checks;
  if (businessId) {
    const pick = (b) => ({
      snapshot: b.workspaces.filter((w) => w.business_id === businessId),
      requestLog: b.requests.filter((q) => q.business_id === businessId),
    });
    const [want, got] = [pick(bundle), pick(after)];
    checks = Object.fromEntries(Object.keys(want).map((key) => [key, rowsHash(want[key]) === rowsHash(got[key]) ? "MATCH" : "DIFF"]));
  } else {
    const [want, got] = [comparableTables(bundle), comparableTables(after)];
    checks = Object.fromEntries(Object.keys(want).map((key) => [key, rowsHash(want[key]) === rowsHash(got[key]) ? "MATCH" : "DIFF"]));
  }
  const ok = Object.values(checks).every((value) => value === "MATCH");
  console.log(`${ok ? "RESTORED" : "FAIL"} ${businessId ? `business ${businessId}` : "full"}: ${JSON.stringify(checks)}`);
  return ok ? 0 : 1;
};

const commands = { export: runExport, verify: runVerify, check: runCheck, restore: runRestore };

try {
  if (!commands[command]) throw new Error("Usage: backup.mjs export|verify|check|restore (see the header of this file).");
  process.exitCode = await commands[command]();
} catch (error) {
  console.error(`FAIL ${oneLine(error.message)}`);
  process.exitCode = 1;
}
