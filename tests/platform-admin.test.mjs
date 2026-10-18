import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCompany, slugFromName } from "../api/_lib/platformAdmin.js";
import { authorizePlatformRequest, platformServiceClientFor } from "../api/_lib/tenantAuth.js";
import platformHandler from "../api/platform/businesses.js";

// Platform administration (release file 05): static and pure checks. The full
// proof with real local Auth is scripts/localdb/platform-admin-tests.mjs.
const migration = readFileSync(new URL("../scripts/localdb/migrations/20261018090000_platform_admins.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../scripts/localdb/rollback/20261018090000_platform_admins.down.sql", import.meta.url), "utf8");
const sqlOnly = (text) => text.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

test("platform_admins: RLS forced, no browser grants, no write grant for anyone but the operator", () => {
  const body = sqlOnly(migration);
  assert.match(body, /enable row level security/);
  assert.match(body, /force row level security/);
  assert.match(body, /revoke all on table public\.platform_admins from public, anon, authenticated;/);
  assert.match(body, /revoke all on table public\.platform_admins from service_role;/);
  assert.match(body, /grant select on table public\.platform_admins to service_role;/);
  assert.doesNotMatch(body, /grant\s+(insert|update|delete|all)[^;]*platform_admins/i);
  assert.doesNotMatch(body, /to\s+(anon|authenticated)\b/i);
  assert.doesNotMatch(body, /security definer/i, "no function that could grant it");
  assert.doesNotMatch(body, /create policy/i, "no policies: nothing permissive for verify.mjs to flag");
  assert.match(sqlOnly(rollback), /^drop table if exists public\.platform_admins;\s*$/m);
});

test("release file 05 is in the hosted apply list and the local rehearsal, in order after 04", () => {
  const apply = readFileSync(new URL("../scripts/hosted/apply-release.mjs", import.meta.url), "utf8");
  const setup = readFileSync(new URL("../scripts/localdb/setup.mjs", import.meta.url), "utf8");
  const at04 = apply.indexOf("04 assign initial owner");
  const at05 = apply.indexOf("05 platform admins");
  assert.ok(at04 > 0 && at05 > at04);
  assert.ok(setup.indexOf("20261011090000_assign_initial_owner.sql") < setup.indexOf("20261018090000_platform_admins.sql"));
});

test("slugs derived from company names are valid and stable", () => {
  assert.equal(slugFromName("Second Fleet Taxis"), "second-fleet-taxis");
  assert.equal(slugFromName("  Ndlovu & Sons (Pty) Ltd  "), "ndlovu-sons-pty-ltd");
  assert.equal(slugFromName("Café Taxis"), "cafe-taxis");
  assert.ok(slugFromName("x".repeat(100)).length <= 63);
});

test("create refuses forged fields and self-ownership before any service access", async () => {
  const admin = { platformAdmin: true, userId: "00000000-0000-4000-8000-000000000099", email: "platform@example.com" };
  for (const field of ["role", "businessId", "ownerUserId", "snapshot", "active"]) {
    await assert.rejects(createCompany(admin, { name: "X Taxis", ownerEmail: "o@example.com", [field]: "x" }), (error) => error.statusCode === 400);
  }
  await assert.rejects(createCompany(admin, { name: "X Taxis", ownerEmail: "PLATFORM@example.com" }), (error) => error.statusCode === 403);
  await assert.rejects(createCompany(admin, { name: "X Taxis", ownerEmail: "o@example.com", ownerDrives: "yes" }), (error) => error.statusCode === 400);
});

test("platform service access needs a verified platform admin; a business authorization never qualifies", () => {
  assert.throws(() => platformServiceClientFor(null), (error) => error.statusCode === 500);
  assert.throws(() => platformServiceClientFor({ businessId: "b", role: "Owner", userId: "u" }), (error) => error.statusCode === 500);
});

test("no token: 401 before any database access", async () => {
  await assert.rejects(authorizePlatformRequest({ headers: {} }), (error) => error.statusCode === 401);
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await platformHandler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const post = { ...res, statusCode: 0, headers: {}, setHeader: res.setHeader, end: res.end };
  await platformHandler({ method: "POST", headers: {}, body: { action: "company.create", fields: { name: "X" } } }, post);
  assert.equal(post.statusCode, 401);
});
