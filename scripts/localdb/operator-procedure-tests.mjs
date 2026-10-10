#!/usr/bin/env node
// Operator "assign initial Owner" proof on the LOCAL stack (fresh reset or
// hosted rehearsal build). The hosted CLI (scripts/hosted/assign-initial-owner.mjs)
// uses the same planning/apply code behind its target guards.
import { createClient } from "@supabase/supabase-js";

import { applyAssignInitialOwner, planAssignInitialOwner } from "../pilot/assign-initial-owner.mjs";
import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { activateViaEmail } from "./lib/mailpit.mjs";
import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
const { default: workspaceHandler } = await import("../../api/business/workspace.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (text) => psql(text).stdout.trim();
const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const NO_OWNER_ID = "10000000-0000-4000-8000-0000000000d1";
const membership = (businessId, email) =>
  sql(`select coalesce((select m.role || ':' || m.active from public.business_memberships m join auth.users u on u.id = m.user_id where m.business_id = '${businessId}' and lower(u.email) = lower('${email}')), 'none');`);
const userCount = () => sql("select count(*) from auth.users;");
const workspaceAs = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await workspaceHandler({ method: "GET", headers: { authorization: `Bearer ${data.session.access_token}` }, query: { business: NO_OWNER_ID } }, res);
  return { status: res.statusCode, json: JSON.parse(res.body ?? "{}") };
};

// A mapped business whose directory produced no active Owner (only an Admin).
guard();
psql(`insert into public.businesses (id, slug, name) values ('${NO_OWNER_ID}', 'mapped-no-owner', 'Mapped Without Owner');
insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, business_id) values ('mapped-no-owner', '{"profile":{"fleetName":"Mapped Without Owner"},"appUsers":[],"drivers":[{"staffId":"drv-mo-1","name":"MO Driver"}],"financeTransactions":[{"id":"mo-fin-1","type":"income","status":"banked","amountClaimed":10}]}'::jsonb, now(), '${NO_OWNER_ID}');
insert into public.business_memberships (business_id, user_id, role, active) select '${NO_OWNER_ID}', id, 'Admin', true from auth.users where email = 'admin@example.com';`);
const moneyBefore = sql(`select md5((snapshot->'financeTransactions')::text) from public.workspace_snapshots where business_id = '${NO_OWNER_ID}';`);

// Refusals
let res = await applyAssignInitialOwner(service, { slug: "taxiflow-legacy", ownerEmail: "manager@example.com" });
record(!res.ok && res.status === "refused" && membership(BUSINESS_A_ID, "manager@example.com") === "Manager:true", "a business that already has an active Owner is refused (no Owner added)", res.plan?.problems[0]);
res = await applyAssignInitialOwner(service, { slug: "no-such-slug", ownerEmail: "x@example.com" }).catch((error) => ({ ok: false, status: error.statusCode, error: error.message }));
record(!res.ok && res.status === 404, "an unknown business is refused", res.error);
const usersBefore = userCount();
res = await applyAssignInitialOwner(service, { slug: "mapped-no-owner", ownerEmail: "brand.new.owner@example.com", driverStaffId: "drv-missing" });
record(!res.ok && res.status === "refused" && userCount() === usersBefore, "an unknown driver profile is refused before any account is created", res.plan?.problems[0]);

// Dry run reads only
const plan = await planAssignInitialOwner(service, { slug: "mapped-no-owner", ownerEmail: "brand.new.owner@example.com" });
record(plan.problems.length === 0 && /new/.test(plan.account) && userCount() === usersBefore && membership(NO_OWNER_ID, "brand.new.owner@example.com") === "none", "dry run plans a new account and writes nothing");

// Existing account becomes the initial Owner (other access untouched)
const managerA = membership(BUSINESS_A_ID, "manager@example.com");
res = await applyAssignInitialOwner(service, { slug: "mapped-no-owner", ownerEmail: "manager@example.com", ownerName: "Mapped Owner", driverStaffId: "drv-mo-1" });
record(res.ok && res.status === "assigned" && !res.accountCreated && membership(NO_OWNER_ID, "manager@example.com") === "Owner:true", "an existing account is assigned as the initial Owner (no new account)", res.status);
record(membership(BUSINESS_A_ID, "manager@example.com") === managerA, "that account's access to its other business is unchanged", managerA);
const directory = JSON.parse(sql(`select (snapshot->'appUsers')::text from public.workspace_snapshots where business_id = '${NO_OWNER_ID}';`));
record(directory.length === 1 && directory[0].role === "Owner" && directory[0].staffId === "drv-mo-1" && sql(`select driver_staff_id from public.business_memberships m join auth.users u on u.id = m.user_id where m.business_id = '${NO_OWNER_ID}' and u.email = 'manager@example.com';`) === "drv-mo-1", "membership and directory entry agree, including the owner-driver link");
record(sql(`select md5((snapshot->'financeTransactions')::text) from public.workspace_snapshots where business_id = '${NO_OWNER_ID}';`) === moneyBefore, "money records are untouched");
const view = await workspaceAs("manager@example.com");
record(view.status === 200 && view.json.role === "Owner" && view.json.driverStaffId === "drv-mo-1", "the new Owner signs in to that business as Owner (owner-driver)", `${view.status} ${view.json.role}`);

// Repeat and second Owner
res = await applyAssignInitialOwner(service, { slug: "mapped-no-owner", ownerEmail: "manager@example.com" });
record(res.ok && res.status === "already_owner", "repeating the same assignment is a no-op");
const before = userCount();
res = await applyAssignInitialOwner(service, { slug: "mapped-no-owner", ownerEmail: "second.owner@example.com" });
record(!res.ok && res.status === "refused" && userCount() === before, "a second initial Owner is refused (and no account is created)");

// New account path in another owner-less business: account + setup email + Owner
guard();
psql(`insert into public.businesses (id, slug, name) values ('10000000-0000-4000-8000-0000000000d2', 'mapped-no-owner-two', 'Mapped Two');
insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, business_id) values ('mapped-no-owner-two', '{"appUsers":[]}'::jsonb, now(), '10000000-0000-4000-8000-0000000000d2');`);
res = await applyAssignInitialOwner(service, { slug: "mapped-no-owner-two", ownerEmail: "fresh.owner@example.com", ownerName: "Fresh Owner", redirectTo: "http://127.0.0.1:5175/" });
const activated = res.ok ? await activateViaEmail({ apiUrl: status.apiUrl, anonKey: status.ANON_KEY, email: "fresh.owner@example.com", password: LOCAL_TEST_PASSWORD }) : { error: "not assigned" };
record(res.ok && res.accountCreated && res.setupEmailSent && membership("10000000-0000-4000-8000-0000000000d2", "fresh.owner@example.com") === "Owner:true" && activated.ok, "a new account is created, gets the setup email, sets a password and is Owner", activated.error);

// Database guards
guard();
const viaAnon = await createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } }).rpc("assign_initial_owner", { p_business_id: NO_OWNER_ID, p_user_id: "00000000-0000-4000-8000-000000000001", p_driver_staff_id: null, p_expected_updated_at: new Date().toISOString(), p_snapshot: null });
record(Boolean(viaAnon.error), "the browser cannot call assign_initial_owner", viaAnon.error?.message);
const direct = sql(`select (public.assign_initial_owner('${NO_OWNER_ID}', '00000000-0000-4000-8000-000000000001', null, now(), null))->>'status';`);
record(direct === "has_owner", "the database itself refuses a second Owner", direct);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
