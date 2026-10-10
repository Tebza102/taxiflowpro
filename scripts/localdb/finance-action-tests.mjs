#!/usr/bin/env node
// Integration proof of POST /api/business/finance-actions against the LOCAL
// synthetic stack with REAL local Auth tokens. Requires a fresh
// `node scripts/localdb/setup.mjs reset`. Local target and loopback-only
// bindings are re-verified before every mutation attempt.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { stableStringify } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

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
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (text) => psql(text).stdout.trim();

const version = (businessId) =>
  sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.workspace_snapshots where business_id = '${businessId}';`);
const snapshotOf = (businessId) => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${businessId}';`));
const rowState = (businessId) => sql(`select md5(snapshot::text) || '|' || business_id || '|' || workspace_key from public.workspace_snapshots where business_id = '${businessId}';`);
const membershipsHash = () => sql("select md5(coalesce(json_agg(m order by business_id, user_id)::text, '')) from public.business_memberships m;");
const businessesHash = () => sql("select md5(coalesce(json_agg(b order by id)::text, '')) from public.businesses b;");
const logCount = (businessId) => Number(sql(`select count(*) from public.finance_action_requests where business_id = '${businessId}';`));

const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { token: data.session.access_token, client, userId: data.user.id };
};

const post = async (token, body, { query = {}, headers = {} } = {}) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await handler({ method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, query, body }, res);
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* not json */ }
  return { status: res.statusCode, json };
};
const action = (name, fields, businessId, extra = {}) => ({ action: name, requestId: randomUUID(), expectedVersion: version(businessId), fields, ...extra });
const unchanged = (businessId, before) => rowState(businessId) === before;

const ownerA = await tokenFor("owner@example.com");
const adminA = await tokenFor("admin@example.com");
const managerA = await tokenFor("manager@example.com");
const driverA = await tokenFor("driver@example.com");
const inactiveA = await tokenFor("inactive.a@example.com");
const outsider = await tokenFor("outsider@example.com");
const ownerB = await tokenFor("owner.b@example.com");
const driverB = await tokenFor("driver.b@example.com");

const initialA = snapshotOf(BUSINESS_A_ID);
const initialB = rowState(BUSINESS_B_ID);
const membersBefore = membershipsHash();
const businessesBefore = businessesHash();

// --- Authentication / membership ------------------------------------------------
let stateA = rowState(BUSINESS_A_ID);
let r = await post(null, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 401, "no token is refused", `${r.status}`);
r = await post("not-a-jwt", action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 401, "invalid token is refused", `${r.status}`);
r = await post(inactiveA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 403, "inactive member is refused", `${r.status} ${r.json.error ?? ""}`);
r = await post(outsider.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 403, "non-member is refused", `${r.status}`);

// --- Role permissions (denied) ------------------------------------------------------
r = await post(driverA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 403, "Driver cannot record a hand-in", `${r.status} ${r.json.error ?? ""}`);
r = await post(managerA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 403, "Manager cannot record a hand-in (existing rule: Owner/Admin)", `${r.status}`);
r = await post(managerA.token, action("cashup.verify", { cashUpId: "uat-cu-1" }, BUSINESS_A_ID));
record(r.status === 409, "verify before hand-in is an invalid transition", `${r.status} ${r.json.error ?? ""}`);

// --- Forged inputs ----------------------------------------------------------------------
r = await post(adminA.token, { ...action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID), snapshot: { appUsers: [] } });
record(r.status === 400, "a browser-supplied snapshot is rejected", `${r.status} ${r.json.error ?? ""}`);
r = await post(adminA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680, role: "Owner" }, BUSINESS_A_ID));
record(r.status === 400, "a forged role field is rejected", `${r.status}`);
r = await post(adminA.token, { ...action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID), businessId: BUSINESS_B_ID });
record(r.status === 400, "a business id in the body is rejected", `${r.status}`);
r = await post(adminA.token, action("membership.set", { role: "Owner" }, BUSINESS_A_ID));
record(r.status === 400, "membership changes are not an action here", `${r.status}`);
await createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } }).auth.admin.updateUserById(driverA.userId, { user_metadata: { role: "Owner" }, app_metadata: { role: "Owner" } });
const driverForged = await tokenFor("driver@example.com");
r = await post(driverForged.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID));
record(r.status === 403, "Driver with Owner in token metadata is still refused", `${r.status}`);

// --- Cross-business --------------------------------------------------------------------
r = await post(adminA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1-b", actualCashReceived: 1 }, BUSINESS_A_ID));
record(r.status === 404, "Admin A cannot act on a Business B cash-up id (404 in its own business)", `${r.status}`);
r = await post(adminA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1-b", actualCashReceived: 1 }, BUSINESS_B_ID), { query: { business: BUSINESS_B_ID } });
record(r.status === 403, "Admin A selecting Business B is refused", `${r.status}`);
record(unchanged(BUSINESS_A_ID, stateA) && unchanged(BUSINESS_B_ID, initialB), "no denied request changed either business");

// --- Stale version ---------------------------------------------------------------------
const versionBeforeHandIn = version(BUSINESS_A_ID);
r = await post(adminA.token, { ...action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID), expectedVersion: "2026-01-01T00:00:00.000000Z" });
record(r.status === 409 && unchanged(BUSINESS_A_ID, stateA), "stale expectedVersion fails without writing", `${r.status} ${r.json.error ?? ""}`);

// --- Authorized hand-in (paired success) --------------------------------------------------
const handIn = action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 680 }, BUSINESS_A_ID);
r = await post(adminA.token, handIn);
const afterHandIn = snapshotOf(BUSINESS_A_ID);
const cu = afterHandIn.dailyCashUps.find((c) => c.id === "uat-cu-1");
record(
  r.status === 200 && r.json.status === "counted" && r.json.expectedCashIn === 700 && r.json.actualCashReceived === 680 && r.json.variance === -20 && r.json.shortage === 20,
  "Admin A records the hand-in: pending -> counted, expected 700 / actual 680 / variance -20",
  `${r.status} ${JSON.stringify({ status: r.json.status, variance: r.json.variance })}`,
);
record(cu?.status === "counted" && cu.countedBy === adminA.userId && cu.countedByRole === "Admin" && afterHandIn.auditTrail[0].actorId === adminA.userId && afterHandIn.auditTrail[0].source === "server", "actor and audit event generated server-side");
record(["uat-fin-1", "uat-fin-2"].every((id) => afterHandIn.financeTransactions.find((t) => t.id === id).status === "counted"), "linked finance records moved to counted");
const versionAfterHandIn = version(BUSINESS_A_ID);

// --- Retry / idempotency -----------------------------------------------------------------
stateA = rowState(BUSINESS_A_ID);
const auditCount = afterHandIn.auditTrail.length;
r = await post(adminA.token, handIn);
record(r.status === 200 && r.json.replayed === true && unchanged(BUSINESS_A_ID, stateA) && snapshotOf(BUSINESS_A_ID).auditTrail.length === auditCount, "retrying the same request returns the original result without a second write", `${r.status} replayed=${r.json.replayed}`);
r = await post(adminA.token, { ...handIn, fields: { cashUpId: "uat-cu-1", actualCashReceived: 1 } });
record(r.status === 409 && unchanged(BUSINESS_A_ID, stateA), "reusing a requestId with different content is refused", `${r.status}`);
r = await post(managerA.token, { ...handIn, action: "cashup.verify", fields: { cashUpId: "uat-cu-1" } });
record(r.status === 409, "another user cannot reuse a requestId", `${r.status}`);
r = await post(adminA.token, action("cashup.record_handin", { cashUpId: "uat-cu-1", actualCashReceived: 1 }, BUSINESS_A_ID));
record(r.status === 409 && unchanged(BUSINESS_A_ID, stateA), "a second hand-in on a counted checking is an invalid transition", `${r.status}`);

// --- Concurrent stale save ------------------------------------------------------------------
r = await post(managerA.token, { ...action("cashup.verify", { cashUpId: "uat-cu-1" }, BUSINESS_A_ID), expectedVersion: versionBeforeHandIn });
record(r.status === 409 && unchanged(BUSINESS_A_ID, stateA), "a verify based on the pre-hand-in version is rejected (no lost update)", `${r.status}`);

// --- Verify (denied then authorized) ---------------------------------------------------------
r = await post(adminA.token, action("cashup.verify", { cashUpId: "uat-cu-1" }, BUSINESS_A_ID));
record(r.status === 403, "Admin cannot verify (existing rule: Owner/Manager)", `${r.status}`);
r = await post(managerA.token, action("cashup.verify", { cashUpId: "uat-cu-1" }, BUSINESS_A_ID));
const afterVerify = snapshotOf(BUSINESS_A_ID);
record(r.status === 200 && r.json.status === "verified" && afterVerify.dailyCashUps.find((c) => c.id === "uat-cu-1").verifiedBy === managerA.userId, "Manager A verifies: counted -> verified", `${r.status} version ${versionAfterHandIn !== version(BUSINESS_A_ID) ? "advanced" : "SAME"}`);

// --- Driver submit (ownership from membership) ------------------------------------------------
r = await post(driverA.token, action("cashup.submit", { workDate: "2026-10-02", driverStaffId: "uat-drv-b-01" }, BUSINESS_A_ID));
record(r.status === 400, "a driver cannot pass a staff id (ownership comes from the membership)", `${r.status}`);
r = await post(ownerB.token, action("cashup.submit", { workDate: "2026-10-02" }, BUSINESS_B_ID));
record(r.status === 403, "owner-driver (Owner role) cannot use the Driver-only submit (no new permission)", `${r.status}`);
r = await post(driverA.token, action("cashup.submit", { workDate: "2026-10-02" }, BUSINESS_A_ID));
const submitted = snapshotOf(BUSINESS_A_ID).dailyCashUps.find((c) => c.id === r.json.cashUpId);
record(r.status === 200 && submitted?.driverStaffId === "uat-drv-01" && submitted.status === "pending" && r.json.expectedCashIn === 250, "Driver A submits its own day checking", `${r.status} ${r.json.cashUpId}`);
const stateBBefore = rowState(BUSINESS_B_ID);
r = await post(driverB.token, action("cashup.submit", { workDate: "2026-10-02" }, BUSINESS_B_ID));
const subB = snapshotOf(BUSINESS_B_ID).dailyCashUps.find((c) => c.id === r.json.cashUpId);
record(r.status === 200 && subB?.driverStaffId === "uat-drv-b-01" && !unchanged(BUSINESS_B_ID, stateBBefore), "Driver B submits in Business B only", `${r.status} ${r.json.cashUpId}`);

// --- Unrelated data and the request log ---------------------------------------------------------
const finalA = snapshotOf(BUSINESS_A_ID);
const untouched = Object.keys(initialA).filter((key) => !["dailyCashUps", "financeTransactions", "auditTrail"].includes(key));
record(untouched.every((key) => stableStringify(finalA[key]) === stableStringify(initialA[key])), "all other Business A keys (appUsers, vehicles, deposits, …) are unchanged", `${untouched.length} keys`);
const changedFinance = finalA.financeTransactions.filter((t, i) => stableStringify(t) !== stableStringify(initialA.financeTransactions[i])).map((t) => t.id);
record(stableStringify(changedFinance.sort()) === stableStringify(["uat-fin-1", "uat-fin-2", "uat-fin-5"]), "only the linked finance records changed", changedFinance.join(", "));
record(membershipsHash() === membersBefore && businessesHash() === businessesBefore, "memberships and businesses unchanged");
record(sql(`select business_id from public.workspace_snapshots where workspace_key = 'taxiflow-live';`) === BUSINESS_A_ID, "business identity of the snapshot unchanged");
record(logCount(BUSINESS_A_ID) === 3 && logCount(BUSINESS_B_ID) === 1, "request log holds exactly the applied actions", `A=${logCount(BUSINESS_A_ID)} B=${logCount(BUSINESS_B_ID)}`);
const browserLog = await ownerA.client.from("finance_action_requests").select("request_id");
record(Boolean(browserLog.error), "browser cannot read the request log", browserLog.error?.code);
const browserCommit = await ownerA.client.rpc("commit_finance_action", { p_business_id: BUSINESS_A_ID, p_expected_updated_at: version(BUSINESS_A_ID), p_snapshot: {}, p_updated_by: ownerA.userId, p_request_id: randomUUID(), p_action: "x", p_target_id: "x", p_request_hash: "x", p_response: {} });
record(Boolean(browserCommit.error) && unchanged(BUSINESS_A_ID, rowState(BUSINESS_A_ID)) && snapshotOf(BUSINESS_A_ID).appUsers?.length > 0, "browser cannot call the commit function directly", browserCommit.error?.code);

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
