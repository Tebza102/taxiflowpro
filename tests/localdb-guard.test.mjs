import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ALLOWED_BINDINGS,
  CLI_DISABLED_CONFIG,
  LIVE_PROJECT_REF,
  LocalTargetError,
  assertLocalDockerContext,
  assertLocalStatus,
  assertLocalUrl,
  assertLocalWorkdir,
  assertMarkerRow,
  assertPublishedBindings,
  assertSafeCliArgs,
  assertWindowsListeners,
  authManifest,
  snapshotManifest,
} from "../scripts/localdb/lib/localTarget.mjs";
import { signLocalJwt } from "../scripts/localdb/lib/exec.mjs";
import { SEED_USERS, buildSeedSql, buildSyntheticSnapshot } from "../scripts/localdb/seed-data.mjs";

// Mock-only: no Docker, no database, no network.

test("local guard: accepts the local API and database URLs", () => {
  assert.deepEqual(assertLocalUrl("http://127.0.0.1:54321", { kind: "api" }), { host: "127.0.0.1", port: 54321 });
  assert.deepEqual(assertLocalUrl("http://localhost:54321", { kind: "api" }), { host: "localhost", port: 54321 });
  assert.equal(assertLocalUrl("postgresql://postgres:x@127.0.0.1:54322/postgres", { kind: "db" }).port, 54322);
});

test("local guard: rejects hosted Supabase, the live project and any remote API target", () => {
  for (const url of [
    `https://${LIVE_PROJECT_REF}.supabase.co`,
    "https://abcdefghijklmnopqrst.supabase.co",
    "http://192.168.1.10:54321",
    "http://0.0.0.0:54321",
    "http://example.com:54321",
    "https://127.0.0.1:54321",
    "http://127.0.0.1:8000",
    `http://127.0.0.1:54321/?ref=${LIVE_PROJECT_REF}`,
    "",
  ]) {
    assert.throws(() => assertLocalUrl(url, { kind: "api" }), LocalTargetError, url);
  }
});

test("local guard: rejects remote database targets, poolers and wrong ports", () => {
  for (const url of [
    `postgresql://postgres:x@db.${LIVE_PROJECT_REF}.supabase.co:5432/postgres`,
    "postgresql://postgres.abc:x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
    "postgresql://postgres:postgres@10.0.0.5:54322/postgres",
    "mysql://root@127.0.0.1:54322/db",
  ]) {
    assert.throws(() => assertLocalUrl(url, { kind: "db" }), LocalTargetError, url);
  }
});

test("local guard: status must be local for both API and DB", () => {
  assert.ok(assertLocalStatus({ API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:x@127.0.0.1:54322/postgres" }));
  assert.throws(
    () => assertLocalStatus({ API_URL: `https://${LIVE_PROJECT_REF}.supabase.co`, DB_URL: "postgresql://postgres:x@127.0.0.1:54322/postgres" }),
    LocalTargetError,
  );
  assert.throws(() => assertLocalStatus({}), LocalTargetError);
});

test("local guard: CLI flags that target hosted projects are refused", () => {
  assert.deepEqual(assertSafeCliArgs(["db", "reset", "--local"]), ["db", "reset", "--local"]);
  for (const flag of ["--linked", "--db-url=postgresql://x", "--project-ref", "--project-ref=abc"]) {
    assert.throws(() => assertSafeCliArgs(["db", "reset", flag]), LocalTargetError, flag);
  }
});

test("local guard: Docker must be the local engine (no DOCKER_HOST, local context only)", () => {
  assert.doesNotThrow(() => assertLocalDockerContext({ context: "desktop-linux", dockerHost: "" }));
  assert.throws(() => assertLocalDockerContext({ context: "desktop-linux", dockerHost: "tcp://10.0.0.5:2375" }), /DOCKER_HOST/);
  assert.throws(() => assertLocalDockerContext({ context: "remote-server", dockerHost: undefined }), /not the local engine/);
});

const makeWorkdir = ({ projectName = "taxiflow-localdb", cliConfig = "sentinel", linked = false } = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), "localdb-guard-"));
  mkdirSync(path.join(dir, "compose"), { recursive: true });
  mkdirSync(path.join(dir, "supabase", ".temp"), { recursive: true });
  writeFileSync(path.join(dir, "compose", "docker-compose.yml"), `name: ${projectName}\nservices: {}\n`);
  if (cliConfig === "sentinel") writeFileSync(path.join(dir, "supabase", "config.toml"), CLI_DISABLED_CONFIG);
  if (cliConfig === "active") writeFileSync(path.join(dir, "supabase", "config.toml"), 'project_id = "taxiflow-localdb"\n');
  if (linked) writeFileSync(path.join(dir, "supabase", ".temp", "project-ref"), "abcdefghijklmnopqrst");
  return dir;
};

test("local guard: workdir must be the Compose stack, outside the repo, unlinked, with the CLI disabled", () => {
  assert.ok(assertLocalWorkdir(makeWorkdir(), { repoRoot: process.cwd() }));
  assert.throws(() => assertLocalWorkdir(makeWorkdir({ cliConfig: "active" })), /duplicate stack/);
  assert.throws(() => assertLocalWorkdir(makeWorkdir({ cliConfig: "absent" })), /duplicate stack/);
  assert.throws(() => assertLocalWorkdir(makeWorkdir({ linked: true })), /linked to a hosted project/);
  assert.throws(() => assertLocalWorkdir(makeWorkdir({ projectName: "other" })), /Compose project name/);
  const repoRoot = makeWorkdir();
  const insideRepo = path.join(repoRoot, "nested");
  mkdirSync(path.join(insideRepo, "compose"), { recursive: true });
  writeFileSync(path.join(insideRepo, "compose", "docker-compose.yml"), "name: taxiflow-localdb\n");
  assert.throws(() => assertLocalWorkdir(insideRepo, { repoRoot }), /outside the TaxiFlow repository/);
  assert.throws(() => assertLocalWorkdir(path.join(tmpdir(), "does-not-exist-localdb")), /No compose/);
});

test("bindings: exactly the three loopback mappings pass; wildcard, IPv6 wildcard, extra or missing fail", () => {
  const good = [
    "taxiflow_localdb_kong|127.0.0.1:54321->8000/tcp",
    "taxiflow_localdb_db|127.0.0.1:54322->5432/tcp",
    "taxiflow_localdb_mail|127.0.0.1:54324->8025/tcp",
    "taxiflow_localdb_rest|3000/tcp",
    "taxiflow_localdb_auth|",
  ];
  assert.deepEqual(assertPublishedBindings(good).sort(), [...ALLOWED_BINDINGS].sort());
  assert.throws(() => assertPublishedBindings([...good.slice(1), "taxiflow_localdb_kong|0.0.0.0:54321->8000/tcp, [::]:54321->8000/tcp"]), /wildcard/);
  assert.throws(() => assertPublishedBindings([...good, "taxiflow_localdb_auth|127.0.0.1:9999->9999/tcp"]), /Unexpected/);
  assert.throws(() => assertPublishedBindings([...good, "taxiflow_localdb_db|[::]:54322->5432/tcp"]), /Unexpected/);
  assert.throws(() => assertPublishedBindings(good.slice(1)), /not published/);
});

test("Windows listeners: only loopback on the three ports", () => {
  const ok = [
    { address: "127.0.0.1", port: 54321, process: "com.docker.backend" },
    { address: "::1", port: 54322, process: "wslrelay" },
  ];
  assert.equal(assertWindowsListeners(ok).length, 2);
  for (const bad of [
    { address: "0.0.0.0", port: 54321, process: "com.docker.backend" },
    { address: "::", port: 54322, process: "com.docker.backend" },
    { address: "192.168.1.20", port: 54324, process: "com.docker.backend" },
    { address: "127.0.0.1", port: 2375, process: "com.docker.backend" },
  ]) {
    assert.throws(() => assertWindowsListeners([...ok, bad]), LocalTargetError, JSON.stringify(bad));
  }
});

test("the database must carry the local marker row", () => {
  assert.doesNotThrow(() => assertMarkerRow(["taxiflow-localdb-isolated"]));
  assert.throws(() => assertMarkerRow([]), /not the dedicated local/);
  assert.throws(() => assertMarkerRow(undefined), /not the dedicated local/);
});

test("manifests: canonical (order independent) and change-sensitive", () => {
  const a = snapshotManifest({ b: [1, 2], a: { y: 1, x: 2 } });
  assert.equal(a.sha256, snapshotManifest({ a: { x: 2, y: 1 }, b: [1, 2] }).sha256);
  assert.deepEqual(a.counts, { a: "object", b: 2 });
  assert.notEqual(snapshotManifest({ a: { x: 2, y: 1 }, b: [2, 1] }).sha256, a.sha256);

  const users = [{ id: "2", email: "b@example.com" }, { id: "1", email: "a@example.com", last_sign_in_at: "x" }];
  const identities = [{ user_id: "1", provider: "email", provider_id: "1" }];
  const m = authManifest({ users, identities });
  assert.deepEqual([m.users, m.identities], [2, 1]);
  assert.equal(m.usersSha256, authManifest({ users: [...users].reverse(), identities }).usersSha256);
  assert.notEqual(m.usersSha256, authManifest({ users: users.slice(1), identities }).usersSha256);
});

test("local keys are HS256 JWTs for anon and service_role signed with the local secret", () => {
  const token = signLocalJwt({ role: "anon", iss: "taxiflow-localdb" }, "s".repeat(64));
  const [header, body] = token.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.equal(body.role, "anon");
  assert.notEqual(token, signLocalJwt({ role: "anon", iss: "taxiflow-localdb" }, "t".repeat(64)));
});

test("seed: synthetic only (example.com emails, UAT- vehicles, no live ref), all four statuses present", () => {
  const snapshot = buildSyntheticSnapshot();
  const serialized = JSON.stringify(snapshot);
  assert.ok(SEED_USERS.every((user) => user.email.endsWith("@example.com")));
  assert.ok(snapshot.vehicles.every((vehicle) => vehicle.registration.startsWith("UAT-")));
  assert.doesNotMatch(serialized + buildSeedSql(), new RegExp(LIVE_PROJECT_REF));
  assert.doesNotMatch(serialized, /@(gmail|apprigate)\./i);
  assert.deepEqual([...new Set(snapshot.financeTransactions.map((r) => r.status))].sort(), ["banked", "counted", "pending", "verified"]);
  assert.equal(Object.keys(snapshot).length, 18);
  assert.match(buildSeedSql(), /Refusing to seed: this is not the dedicated local TaxiFlow database/);
});

test("compose template publishes only explicit 127.0.0.1 ports and holds no secrets", () => {
  const compose = readFileSync("scripts/localdb/compose/docker-compose.yml", "utf8");
  const ports = [...compose.matchAll(/^\s+-\s+"([^"]+:\d+)"\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(ports.sort(), ["127.0.0.1:54321:8000", "127.0.0.1:54322:5432", "127.0.0.1:54324:8025"]);
  assert.doesNotMatch(compose, /eyJ[A-Za-z0-9_-]{10,}|sb_secret_/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?\}/);
  const kong = readFileSync("scripts/localdb/compose/kong.template.yml", "utf8");
  assert.match(kong, /__ANON_KEY__/);
  assert.doesNotMatch(kong, /eyJ[A-Za-z0-9_-]{10,}/);
});
