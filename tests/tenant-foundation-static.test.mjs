import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { BUSINESS_A_ID, BUSINESS_B_ID, TENANT_USERS, buildBusinessBSnapshot, buildTenantSeedSql } from "../scripts/localdb/seed-data.mjs";
import { LIVE_PROJECT_REF } from "../scripts/localdb/lib/localTarget.mjs";

// Static guarantees for the local tenant foundation. The behavioural proof is
// scripts/localdb/tenant-tests.mjs against the local database.
const up = readFileSync("scripts/localdb/migrations/20261010003451_tenant_foundation.sql", "utf8");
const down = readFileSync("scripts/localdb/rollback/20261010003451_tenant_foundation.down.sql", "utf8");
const code = up.replace(/--.*$/gm, "");

test("tenant migration: browser loses all snapshot privileges and TRUNCATE is revoked explicitly", () => {
  assert.match(code, /revoke all on table public\.workspace_snapshots from anon, authenticated;/);
  assert.match(code, /revoke all on table public\.businesses from anon, authenticated;/);
  assert.match(code, /revoke all on table public\.business_memberships from anon, authenticated;/);
  assert.doesNotMatch(code, /grant [^;]*on table public\.workspace_snapshots to (anon|authenticated)/i);
  assert.doesNotMatch(code, /grant [^;]*(insert|update|delete|truncate)[^;]*to (anon|authenticated)/i);
  assert.match(code, /alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;/);
});

test("tenant migration: insecure live-mirror policies are dropped and no permissive policy is created", () => {
  for (const name of ["authenticated read", "authenticated insert", "authenticated update"]) {
    assert.match(code, new RegExp(`drop policy if exists "LIVE MIRROR \\(insecure\\): ${name}" on public\\.workspace_snapshots;`));
  }
  assert.doesNotMatch(code, /create policy[^;]*on public\.workspace_snapshots/i);
  assert.doesNotMatch(code, /using \(true\)|with check \(true\)/i);
});

test("tenant migration: roles exclude Viewer, Drivers need a staff id, mapping is explicit with no fallback", () => {
  assert.match(code, /check \(role in \('Owner', 'Admin', 'Manager', 'Driver'\)\)/);
  assert.doesNotMatch(code, /'Viewer'/);
  assert.match(code, /check \(role <> 'Driver' or driver_staff_id is not null\)/);
  assert.match(code, /where workspace_key = 'taxiflow-live' and business_id is null/);
  assert.match(code, /Unmapped workspace_snapshots rows exist/);
  assert.match(code, /alter column business_id set not null/);
  assert.match(code, /workspace_snapshots_business_unique unique \(business_id\)/);
});

test("membership RPC: security definer with fixed search_path, Owner-only, no self-assignment, no Owner minting", () => {
  const rpc = code.slice(code.indexOf("create or replace function public.set_business_membership"));
  assert.match(rpc, /security definer\s+set search_path = ''/);
  assert.match(rpc, /is_active_member\(p_business_id, array\['Owner'\]\)/);
  assert.match(rpc, /p_user_id = caller/);
  assert.match(rpc, /p_role not in \('Admin', 'Manager', 'Driver'\)/);
  assert.match(rpc, /existing\.role = 'Owner'/);
  assert.match(code, /revoke all on function public\.set_business_membership\([^)]*\) from public, anon, authenticated;/);
});

test("tenant reassignment triggers cover snapshots and memberships", () => {
  assert.match(code, /before update on public\.workspace_snapshots[\s\S]*forbid_tenant_reassignment/);
  assert.match(code, /before update on public\.business_memberships[\s\S]*forbid_tenant_reassignment/);
});

test("rollback keeps tenant data (no drop table / drop column) and is explicit about restoring insecure access", () => {
  const downCode = down.replace(/--.*$/gm, "");
  assert.doesNotMatch(downCode, /drop table|drop column|delete from|truncate/i);
  assert.match(down, /known insecure/i);
});

test("tenant seed: synthetic only, two businesses, owner-driver linkage, inactive and non-member identities", () => {
  const seed = buildTenantSeedSql();
  assert.ok(TENANT_USERS.every((user) => user.email.endsWith("@example.com")));
  assert.doesNotMatch(seed + JSON.stringify(buildBusinessBSnapshot()), new RegExp(LIVE_PROJECT_REF));
  assert.notEqual(BUSINESS_A_ID, BUSINESS_B_ID);
  const ownerB = TENANT_USERS.find((user) => user.email === "owner.b@example.com");
  assert.equal(ownerB.role, "Owner");
  assert.ok(ownerB.staffId, "Owner B drives: same identity with a driver linkage");
  assert.ok(TENANT_USERS.some((user) => user.active === false));
  assert.ok(TENANT_USERS.some((user) => user.business === null));
  assert.equal(Object.keys(buildBusinessBSnapshot()).length, 18);
  assert.match(seed, /Refusing to seed: this is not the dedicated local TaxiFlow database/);
});
