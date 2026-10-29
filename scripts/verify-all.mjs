#!/usr/bin/env node
// One verification run, in order, stopping at the first failure:
//   node tests -> sync guards -> build -> demo browser (mock) -> isolated local
//   tenant browser suite after a fresh reset of the TEST stack only.
// Usage: node scripts/verify-all.mjs [--from <step>] [--only <step>]
// Steps: node, guards, build, mock, tenant.
// Every step's full output is kept in uat-reports/verify/<run>/<step>.log and
// each browser suite writes its artifacts to its own folder there, so runs never
// share or overwrite test-results. A lock file prevents overlapping runs.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LOCAL_PROFILES } from "./localdb/lib/localTarget.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "uat-reports", "verify.lock");
const STEPS = ["node", "guards", "build", "mock", "tenant"];

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const only = option("--only");
const from = option("--from");
for (const value of [only, from]) {
  if (value && !STEPS.includes(value)) {
    console.error(`Unknown step "${value}". Steps: ${STEPS.join(", ")}.`);
    process.exit(2);
  }
}
const selected = only ? [only] : STEPS.slice(from ? STEPS.indexOf(from) : 0);

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(ROOT, "uat-reports", "verify", runId);
mkdirSync(runDir, { recursive: true });

// --- overlap guard -----------------------------------------------------------
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (existsSync(LOCK)) {
  const holder = JSON.parse(readFileSync(LOCK, "utf8"));
  if (alive(holder.pid)) {
    console.error(`Another verification run (pid ${holder.pid}, ${holder.runId}) is in progress. Not starting a second one.`);
    process.exit(3);
  }
}
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, runId }));
const release = () => {
  try {
    if (existsSync(LOCK) && JSON.parse(readFileSync(LOCK, "utf8")).pid === process.pid) rmSync(LOCK);
  } catch {
    // Lock already gone.
  }
};
process.on("exit", release);
process.on("SIGINT", () => process.exit(130));

// --- steps -------------------------------------------------------------------
const testProfile = LOCAL_PROFILES.test;
const tenantEnv = { TAXIFLOW_LOCALDB_PROFILE: "test" };

const commands = {
  node: [["node", ["--test", ...listTests()]]],
  guards: [["node", ["tests/liveSyncGuards.test.mjs"]]],
  build: [["npx", ["vite", "build"]]],
  mock: [["npx", ["playwright", "test", "--output", path.join(runDir, "mock-artifacts"), "--reporter", "line"]]],
  tenant: [
    // setup.mjs and its guards refuse anything but a loopback, marked local stack.
    ["node", ["scripts/localdb/setup.mjs", "reset"], tenantEnv],
    ["npx", ["playwright", "test", "-c", "playwright.localdb.config.mjs", "--output", path.join(runDir, "tenant-artifacts"), "--reporter", "line"], tenantEnv],
  ],
};

function listTests() {
  // What tests/*.test.mjs expands to, without relying on a shell glob.
  return readdirSync(path.join(ROOT, "tests")).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `tests/${name}`);
}

const run = (step, [command, commandArgs, extraEnv = {}], log) =>
  new Promise((resolve) => {
    const started = Date.now();
    log.write(`\n$ ${command} ${commandArgs.join(" ")}\n`);
    const child = spawn(command, commandArgs, { cwd: ROOT, shell: process.platform === "win32", env: { ...process.env, ...extraEnv } });
    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));
    child.on("close", (code) => resolve({ code, seconds: Math.round((Date.now() - started) / 1000) }));
  });

const summaryLine = (step, text) => {
  const patterns = {
    node: /ℹ (tests|pass|fail) \d+/g,
    guards: /liveSyncGuards checks passed/g,
    build: /built in [\d.]+m?s/g,
    mock: /\d+ (passed|failed|flaky|skipped)[^\n]*/g,
    tenant: /\d+ (passed|failed|flaky|skipped)[^\n]*/g,
  };
  return [...new Set(text.match(patterns[step]) ?? [])].join(", ");
};

const main = async () => {
  console.log(`Verification run ${runId}: ${selected.join(" -> ")}`);
  console.log(`Logs and artifacts: ${path.relative(ROOT, runDir)}`);
  if (selected.includes("tenant")) console.log(`Tenant step resets ONLY the local test stack ${testProfile.projectId} (127.0.0.1:${testProfile.apiPort}).`);
  const results = [];
  for (const step of selected) {
    const logPath = path.join(runDir, `${step}.log`);
    const log = createWriteStream(logPath);
    let outcome = { code: 0, seconds: 0 };
    for (const command of commands[step]) {
      const result = await run(step, command, log);
      outcome = { code: result.code, seconds: outcome.seconds + result.seconds };
      if (result.code !== 0) break;
    }
    await new Promise((resolve) => log.end(resolve));
    const text = readFileSync(logPath, "utf8");
    const summary = summaryLine(step, text);
    results.push({ step, ...outcome, summary });
    console.log(`${outcome.code === 0 ? "PASS" : "FAIL"} ${step} (${outcome.seconds}s) ${summary}`);
    if (outcome.code !== 0) {
      console.log(`Stopped at ${step}. Full log: ${path.relative(ROOT, logPath)}`);
      writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ runId, results, stoppedAt: step }, null, 2));
      process.exit(1);
    }
  }
  writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ runId, results, stoppedAt: null }, null, 2));
  console.log("All selected steps passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
