import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { confirmApply, describeTarget, resolveHostedTarget } from "../scripts/hosted/lib/hosted-target.mjs";

// Guards for the hosted operator procedures. No network, no real credentials:
// the env file content is injected. Synthetic values only.
const REF = "abcdefghijklmnopqrst";
const repoRoot = path.resolve("C:/repo");
const outside = path.resolve("C:/secure/taxiflow.env");
const env = (lines) => () => lines.join("\n");
const base = ["--target", REF, "--env-file", outside];
const good = env([`SUPABASE_URL=https://${REF}.supabase.co`, "SUPABASE_SECRET_KEY=sb_secret_synthetic_value"]);
const resolve = (argv, readFile = good) => resolveHostedTarget({ argv, repoRoot, readFile, fileExists: () => true });

test("a matching target, an outside env file and a secret key resolve; dry run is the default", () => {
  const target = resolve(base);
  assert.equal(target.ref, REF);
  assert.equal(target.apply, false);
  assert.match(describeTarget(target, "x"), /DRY RUN/);
  assert.equal(resolve([...base, "--apply"]).apply, true);
});

test("refusals: missing target, bad ref, missing env file, env file inside the repo", () => {
  assert.throws(() => resolve(["--env-file", outside]), /--target/);
  assert.throws(() => resolve(["--target", "Not-A-Ref", "--env-file", outside]), /--target/);
  assert.throws(() => resolve(["--target", REF]), /--env-file/);
  assert.throws(() => resolve(["--target", REF, "--env-file", path.join(repoRoot, ".env.hosted")]), /outside the repository/);
  assert.throws(() => resolveHostedTarget({ argv: base, repoRoot, readFile: good, fileExists: () => false }), /does not exist/);
});

test("refusals: wrong project, local or plain-http URLs, legacy or missing keys", () => {
  assert.throws(() => resolve(base, env(["SUPABASE_URL=https://zzzzzzzzzzzzzzzzzzzz.supabase.co", "SUPABASE_SECRET_KEY=sb_secret_x"])), /does not match/);
  assert.throws(() => resolve(base, env(["SUPABASE_URL=http://127.0.0.1:54321", "SUPABASE_SECRET_KEY=sb_secret_x"])), /https/);
  assert.throws(() => resolve(base, env([`SUPABASE_URL=https://${REF}.supabase.co`, "SUPABASE_SECRET_KEY=eyJhbGciOiJIUzI1NiJ9.legacy.jwt"])), /legacy service_role keys are refused/);
  assert.throws(() => resolve(base, env([`SUPABASE_URL=https://${REF}.supabase.co`])), /SUPABASE_SECRET_KEY/);
});

test("apply needs an interactive terminal; dry run never asks", async () => {
  const target = resolve([...base, "--apply"]);
  await assert.rejects(() => confirmApply(target, { input: { isTTY: false } }), /interactive terminal/);
  assert.equal(await confirmApply(resolve(base)), false);
});
