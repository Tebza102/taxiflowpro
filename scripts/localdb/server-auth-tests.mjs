#!/usr/bin/env node
// Integration proof of the tenant authorization boundary (api/_lib/tenantAuth.js)
// against the LOCAL synthetic Supabase, with REAL local Auth access tokens and
// the REAL report handlers / snapshot loader. Requires a fresh
// `node scripts/localdb/setup.mjs reset`. Local target + loopback bindings are
// re-verified before every mutation.
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, localStatus, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
// The handlers read these at call time; they point ONLY at the local stack.
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const { default: reportViewHandler } = await import("../../api/admin/daily-log/[id]/report-view.js");
const { default: reportPdfHandler } = await import("../../api/admin/daily-log/[id]/report-pdf.js");
const { loadServerSnapshot } = await import("../../api/_lib/snapshotLoader.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};

const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { token: data.session.access_token, client, userId: data.user.id };
};

const call = async (handler, token, query = {}, headers = {}) => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
  await handler({ method: "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, query: { mode: "live", ...query } }, res);
  return res;
};
const view = (token, id, query, headers) => call(reportViewHandler, token, { id, ...query }, headers);
const errorOf = (res) => {
  try {
    return JSON.parse(res.body).error ?? "";
  } catch {
    return "";
  }
};
const load = async (token, query = {}) => {
  try {
    return { ok: true, value: await loadServerSnapshot({ req: { headers: { authorization: `Bearer ${token}` }, query } }) };
  } catch (error) {
    return { ok: false, status: error.statusCode, message: error.message };
  }
};

const ownerA = await tokenFor("owner@example.com");
const managerA = await tokenFor("manager@example.com");
const driverA = await tokenFor("driver@example.com");
const inactiveA = await tokenFor("inactive.a@example.com");
const outsider = await tokenFor("outsider@example.com");
const ownerB = await tokenFor("owner.b@example.com");
const managerB = await tokenFor("manager.b@example.com");

// Authorized access ----------------------------------------------------------------
let res = await view(ownerA.token, "uat-fin-3");
record(res.statusCode === 200 && JSON.parse(res.body).meta.businessId === BUSINESS_A_ID, "Owner A gets Business A's report (business resolved from its only membership)", `${res.statusCode}`);
res = await call(reportPdfHandler, managerA.token, { id: "uat-fin-3" });
record(res.statusCode === 200 && res.body.subarray(0, 5).toString("ascii") === "%PDF-", "Manager A gets the PDF", `${res.statusCode}`);
res = await view(managerB.token, "uat-fin-3-b");
record(res.statusCode === 200 && JSON.parse(res.body).meta.businessId === BUSINESS_B_ID, "Manager B gets Business B's report", `${res.statusCode}`);

// Cross-business denial --------------------------------------------------------------
res = await view(ownerA.token, "uat-fin-3", { business: BUSINESS_B_ID });
record(res.statusCode === 403, "Owner A selecting Business B is refused", `${res.statusCode} ${errorOf(res)}`);
res = await view(managerB.token, "uat-fin-3", {}, { "x-taxiflow-business": BUSINESS_A_ID });
record(res.statusCode === 403, "Manager B selecting Business A by header is refused", `${res.statusCode}`);
res = await view(ownerA.token, "uat-fin-3-b");
record(res.statusCode === 404, "Owner A cannot reach a Business B record id through its own business (404, B never loaded)", `${res.statusCode}`);
const loadedA = await load(ownerA.token);
record(loadedA.ok && loadedA.value.businessId === BUSINESS_A_ID && !JSON.stringify(loadedA.value.snapshot).includes("UAT Business B"), "Owner A's loaded snapshot contains no Business B data");

// Inactive / non-member / invalid tokens ---------------------------------------------
res = await view(inactiveA.token, "uat-fin-3");
record(res.statusCode === 403, "inactive member is refused", `${res.statusCode} ${errorOf(res)}`);
res = await view(outsider.token, "uat-fin-3");
record(res.statusCode === 403, "authenticated non-member is refused", `${res.statusCode} ${errorOf(res)}`);
res = await view(null, "uat-fin-3");
record(res.statusCode === 401, "missing token is refused", `${res.statusCode}`);
res = await view("not-a-jwt", "uat-fin-3");
record(res.statusCode === 401, "garbage token is refused", `${res.statusCode}`);
const [h, p, s] = ownerA.token.split(".");
const claims = JSON.parse(Buffer.from(p, "base64url").toString());
const tampered = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: ownerB.userId, user_metadata: { role: "Owner" } })).toString("base64url")}.${s}`;
res = await view(tampered, "uat-fin-3-b");
record(res.statusCode === 401, "tampered token (swapped sub, forged role) is refused", `${res.statusCode}`);
// An ACTIVE member signs out; the old access token must stop working.
const { error: signOutError } = await managerA.client.auth.signOut();
res = await view(managerA.token, "uat-fin-3");
record(!signOutError && [401, 403].includes(res.statusCode), "an active member's signed-out session token is refused", `${res.statusCode} ${errorOf(res)}`);

// Forged roles -------------------------------------------------------------------------
res = await view(driverA.token, "uat-fin-1", { role: "Owner" });
record(res.statusCode === 403, "Driver with ?role=Owner is still refused reports", `${res.statusCode}`);
guard();
const admin = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
await admin.auth.admin.updateUserById(driverA.userId, { user_metadata: { role: "Owner" }, app_metadata: { role: "Owner" } });
const driverForged = await tokenFor("driver@example.com");
res = await view(driverForged.token, "uat-fin-1");
record(res.statusCode === 403, "Driver with Owner in user/app metadata is still refused", `${res.statusCode}`);
guard();
psql(`update public.workspace_snapshots set snapshot = jsonb_set(snapshot, '{appUsers}', (select jsonb_agg(case when e->>'email' = 'driver@example.com' then e || '{"role":"Owner"}' else e end) from jsonb_array_elements(snapshot->'appUsers') e)) where business_id = '${BUSINESS_A_ID}';`);
res = await view(driverForged.token, "uat-fin-1");
record(res.statusCode === 403, "Driver listed as Owner in snapshot.appUsers is still refused", `${res.statusCode}`);

// Driver scoping (own linked records only) ------------------------------------------
const driverLoad = await load(driverForged.token);
const dv = driverLoad.ok ? driverLoad.value : null;
const ownFinance = (dv?.snapshot.financeTransactions ?? []).every((r) => ["uat-drv-01", "odometer-anchor"].includes(r.driverStaffId));
record(
  dv?.scope === "driver" && ownFinance && dv.snapshot.appUsers.length === 1 && (dv.snapshot.deposits ?? []).length === 0 && (dv.snapshot.dailyCashUps ?? []).every((c) => c.driverStaffId === "uat-drv-01"),
  "Driver receives only the driver projection for its linked staff id",
  dv ? `scope=${dv.scope}, finance=${dv.snapshot.financeTransactions.length}, appUsers=${dv.snapshot.appUsers.length}` : driverLoad.message,
);

// Owner-driver linkage -------------------------------------------------------------------
const ownerDriver = await load(ownerB.token);
record(
  ownerDriver.ok && ownerDriver.value.scope === "full" && ownerDriver.value.requestedBy.role === "Owner" && ownerDriver.value.requestedBy.driverStaffId === "uat-drv-b-owner",
  "Owner-driver: one identity, Owner scope, driver linkage from the membership",
  ownerDriver.ok ? `role=${ownerDriver.value.requestedBy.role}, linkage=${ownerDriver.value.requestedBy.driverStaffId}` : ownerDriver.message,
);
res = await view(ownerB.token, "uat-fin-3-b");
record(res.statusCode === 200, "Owner-driver gets Business B's report", `${res.statusCode}`);

// Explicit selection with two memberships -------------------------------------------------
guard();
const added = await ownerA.client.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: managerB.userId, p_role: "Manager" });
record(!added.error, "setup: Owner A adds Manager B to Business A (second membership)", added.error?.message);
res = await view(managerB.token, "uat-fin-3");
record(res.statusCode === 400 && /select one/.test(errorOf(res)), "two memberships without a selection are refused (no fallback)", `${res.statusCode} ${errorOf(res)}`);
res = await view(managerB.token, "uat-fin-3", { business: BUSINESS_A_ID });
record(res.statusCode === 200 && JSON.parse(res.body).meta.businessId === BUSINESS_A_ID, "explicit selection of Business A works", `${res.statusCode}`);
res = await view(managerB.token, "uat-fin-3-b", { business: BUSINESS_B_ID });
record(res.statusCode === 200 && JSON.parse(res.body).meta.businessId === BUSINESS_B_ID, "explicit selection of Business B works", `${res.statusCode}`);
res = await view(managerB.token, "uat-fin-3", { business: "taxiflow-live" });
record(res.statusCode === 400, "legacy workspace key is not a business selection", `${res.statusCode}`);
guard();
await ownerA.client.rpc("set_business_membership", { p_business_id: BUSINESS_A_ID, p_user_id: managerB.userId, p_role: "Manager", p_active: false });
res = await view(managerB.token, "uat-fin-3", { business: BUSINESS_A_ID });
record(res.statusCode === 403, "after deactivation, Business A is refused again", `${res.statusCode}`);

// No whole-snapshot write path exists for these routes.
res = await call(reportViewHandler, ownerA.token, { id: "uat-fin-3" });
const post = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
await reportViewHandler({ method: "POST", headers: { authorization: `Bearer ${ownerA.token}` }, query: { id: "uat-fin-3" } }, post);
record(post.statusCode === 405, "report routes reject writes (405)", `${post.statusCode}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
