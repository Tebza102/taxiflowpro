#!/usr/bin/env node
// Integration proof of the logbook pipeline (/api/logbook/*) against the LOCAL
// synthetic stack with REAL local Auth tokens, the REAL handler and database
// functions, and a STUBBED vision client (synthetic replies; no network, no key).
// Requires a fresh `node scripts/localdb/setup.mjs reset`. Local target and
// loopback-only bindings are verified at start and re-verified throughout.
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "./seed-data.mjs";

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
const { logbookRecordIds } = await import("../../api/_lib/logbookApproval.js");
const { IMPORT_RATE_LIMIT } = await import("../../api/_lib/logbookService.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
// The local-target and loopback checks take several seconds each on Windows and
// this suite makes a few hundred requests, so they are repeated at most every 20
// seconds (and always before the first request) instead of before every one.
let lastGuard = 0;
const guard = () => {
  if (Date.now() - lastGuard < 20_000) return;
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
  lastGuard = Date.now();
};
const sql = (text) => psql(text).stdout.trim();
const snapshotOf = (businessId) => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${businessId}';`));
const snapshotState = (businessId) => sql(`select md5(snapshot::text) || '|' || updated_at from public.workspace_snapshots where business_id = '${businessId}';`);
const count = (table, where = "true") => Number(sql(`select count(*) from public.${table} where ${where};`));

const tokenFor = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { token: data.session.access_token, client, userId: data.user.id };
};

const call = async (method, action, { token, apiKey, query = {}, body, headers = {} } = {}) => {
  guard();
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await handler(
    {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(apiKey ? { "x-api-key": apiKey } : {}), ...headers },
      query: { action, ...query },
      ...(body !== undefined ? { body } : {}),
    },
    res,
  );
  let json = {};
  try { json = JSON.parse(res.body); } catch { /* a file */ }
  return { status: res.statusCode, json, raw: res.body, headers: res.headers };
};
const get = (action, options) => call("GET", action, options);
const post = (action, options) => call("POST", action, options);

// --- Synthetic pages and the stubbed model -----------------------------------------
// A "page" is a PNG signature followed by a marker; the stub answers by marker.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pageImage = (marker) => Buffer.concat([PNG_SIGNATURE, Buffer.from(`synthetic-logbook-page:${marker}`)]);
const upload = (marker, filename = `${marker}.png`) => ({ filename, mediaType: "image/png", dataBase64: pageImage(marker).toString("base64") });
const f = (value, confidence = "high", note = null) => ({ value, confidence, note });
const row = (overrides = {}) => ({
  date: f("2026-11-03"),
  vehicleRegistration: f("UAT-TEST-01"),
  driverName: f("UAT Driver"),
  revenue: f(1500),
  fuel: f(400),
  wash: f(50),
  marshalFees: f(30),
  otherExpenses: f(0),
  banked: f(1020),
  ...overrides,
});
const CLEAN_ROWS = [row(), row({ date: f("2026-11-04"), revenue: f(1200), fuel: f(350), wash: f(0), marshalFees: f(30), banked: f(820) })];
const ILLEGIBLE_ROW = row({ date: f("2026-11-05"), wash: f(null, "low", "ink blot over the amount"), revenue: f(1400, "medium", "second digit faint"), banked: f(920) });
const replies = {
  clean: { rows: CLEAN_ROWS, pageNote: null },
  // The same two lines photographed again (different bytes, same figures).
  "clean-rephotographed": { rows: CLEAN_ROWS, pageNote: null },
  illegible: { rows: [ILLEGIBLE_ROW], pageNote: "One cell is covered by an ink blot." },
  unbalanced: { rows: [row({ date: f("2026-11-06"), banked: f(900) })], pageNote: null },
  "unknown-vehicle": { rows: [row({ date: f("2026-11-07"), vehicleRegistration: f("ZZ 99 ZZ GP") })], pageNote: null },
  "to-reject": { rows: [row({ date: f("2026-11-08"), revenue: f(999), fuel: f(0), wash: f(0), marshalFees: f(0), banked: f(999) })], pageNote: null },
  race: { rows: [row({ date: f("2026-11-09"), revenue: f(700), fuel: f(100), wash: f(0), marshalFees: f(0), banked: f(600) })], pageNote: null },
  "business-b": { rows: [row({ date: f("2026-11-03"), vehicleRegistration: f("UAT-TEST-01-B"), driverName: f("UAT Driver B") })], pageNote: null },
  "bad-json-then-good": null, // handled below
};
let modelCalls = 0;
const badThenGood = { calls: 0 };
setLogbookVisionClientForTests({
  messages: {
    create: async (request) => {
      modelCalls += 1;
      const data = request.messages[0].content[0].source.data;
      const marker = Buffer.from(data, "base64").subarray(PNG_SIGNATURE.length).toString("utf8").replace("synthetic-logbook-page:", "");
      if (marker === "bad-json-then-good") {
        badThenGood.calls += 1;
        const text = badThenGood.calls === 1 ? "I think the rows are: {" : JSON.stringify({ rows: [row({ date: f("2026-11-02"), revenue: f(800), fuel: f(100), wash: f(0), marshalFees: f(0), banked: f(700) })] });
        return { stop_reason: "end_turn", content: [{ type: "text", text }] };
      }
      if (marker === "always-bad-json") return { stop_reason: "end_turn", content: [{ type: "text", text: "not json at all" }] };
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(replies[marker]) }] };
    },
  },
});

const ownerA = await tokenFor("owner@example.com");
const adminA = await tokenFor("admin@example.com");
const managerA = await tokenFor("manager@example.com");
const driverA = await tokenFor("driver@example.com");
const inactiveA = await tokenFor("inactive.a@example.com");
const outsider = await tokenFor("outsider@example.com");
const ownerB = await tokenFor("owner.b@example.com");
const managerB = await tokenFor("manager.b@example.com");

const ANY_ID = "40000000-0000-4000-8000-000000000001";
const SIGNED_IN_ACTIONS = [
  ["POST", "extract", { body: { pages: [upload("clean")] } }],
  ["GET", "batches", {}],
  ["GET", "batch", { query: { id: ANY_ID } }],
  ["GET", "page-image", { query: { id: ANY_ID } }],
  ["POST", "row-edit", { body: { rowId: ANY_ID, values: { wash: 1 } } }],
  ["POST", "row-approve", { body: { rowId: ANY_ID } }],
  ["POST", "row-reject", { body: { rowId: ANY_ID, reason: "test reason" } }],
  ["GET", "export", { query: { id: ANY_ID } }],
  ["GET", "keys", {}],
  ["POST", "keys", { body: { action: "create", name: "x key" } }],
];
const allStatuses = async (options) => {
  const seen = [];
  for (const [method, action, extra] of SIGNED_IN_ACTIONS) seen.push((await call(method, action, { ...extra, ...options, query: { ...(extra.query ?? {}), ...(options.query ?? {}) } })).status);
  return seen;
};
const every = (list, value) => list.every((entry) => entry === value);
const stateA0 = snapshotState(BUSINESS_A_ID);
const stateB0 = snapshotState(BUSINESS_B_ID);

// --- 1. Authentication: 401 ----------------------------------------------------------
let seen = await allStatuses({});
record(every(seen, 401), "no sign-in: every signed-in logbook action is 401", seen.join(","));
seen = await allStatuses({ token: "not-a-real-token" });
record(every(seen, 401), "invalid token: every signed-in logbook action is 401", seen.join(","));
let r = await post("import", { body: { rows: [row()] } });
record(r.status === 401, "import without an API key is 401", `${r.status}`);
r = await post("import", { token: ownerA.token, body: { rows: [row()] } });
record(r.status === 401, "import with a sign-in token instead of an API key is 401 (even the Owner's)", `${r.status}`);
r = await post("import", { apiKey: "tflb_this-key-was-never-issued-000000000000000000", body: { rows: [row()] } });
record(r.status === 401, "import with an unknown API key is 401", `${r.status}`);

// --- 2. Role: 403 ------------------------------------------------------------------
seen = await allStatuses({ token: managerA.token });
record(every(seen, 403), "Manager: every logbook action is 403", seen.join(","));
seen = await allStatuses({ token: driverA.token });
record(every(seen, 403), "Driver: every logbook action is 403", seen.join(","));
seen = await allStatuses({ token: outsider.token });
record(every(seen, 403), "signed-in account with no membership: every action is 403", seen.join(","));
seen = await allStatuses({ token: inactiveA.token });
record(every(seen, 403), "inactive membership: every action is 403", seen.join(","));
seen = await allStatuses({ token: ownerA.token, query: { business: BUSINESS_B_ID } });
record(every(seen, 403), "Owner A selecting Business B: every action is 403", seen.join(","));
seen = await allStatuses({ token: managerB.token, query: { business: BUSINESS_A_ID } });
record(every(seen, 403), "Manager B selecting Business A: every action is 403", seen.join(","));
r = await get("keys", { token: adminA.token });
const adminAllowed = (await get("batches", { token: adminA.token })).status === 200;
record(r.status === 403, "Admin cannot manage import keys (Owner only)", `${r.status}; Admin may use the queue: ${adminAllowed}`);
record(modelCalls === 0 && count("logbook_rows") === 0 && count("logbook_batches") === 0 && count("logbook_api_keys") === 0, "refused requests called no model and stored nothing", `model calls ${modelCalls}`);
record(snapshotState(BUSINESS_A_ID) === stateA0 && snapshotState(BUSINESS_B_ID) === stateB0, "refused requests changed no business data");

// The browser roles cannot reach the tables directly (no grants, RLS on).
const direct = await ownerA.client.from("logbook_rows").select("id").limit(1);
record(Boolean(direct.error), "a signed-in browser client cannot read logbook_rows directly", direct.error?.code ?? "no error");

// --- 3. Bad uploads -------------------------------------------------------------------
r = await post("extract", { token: ownerA.token, body: { pages: [{ filename: "notes.jpg", mediaType: "image/jpeg", dataBase64: Buffer.from("%PDF-1.7 this is not an image").toString("base64") }] } });
record(r.status === 415, "a non-image file (PDF bytes named .jpg) is refused with 415", `${r.status} ${r.json.error ?? ""}`);
r = await post("extract", { token: ownerA.token, body: { pages: [{ filename: "huge.png", dataBase64: Buffer.concat([PNG_SIGNATURE, Buffer.alloc(10 * 1024 * 1024)]).toString("base64") }] } });
record(r.status === 413, "a file over 10 MB is refused with 413", `${r.status} ${r.json.error ?? ""}`);
r = await post("extract", { token: ownerA.token, body: { pages: [upload("clean")], businessId: BUSINESS_B_ID } });
record(r.status === 400, "extra request fields (a business id) are refused with 400", `${r.status}`);
record(modelCalls === 0 && count("logbook_pages") === 0, "refused uploads called no model and stored nothing");

// --- 4. End to end: upload -> pending review -> approve -> record exists ---------------
r = await post("extract", { token: ownerA.token, body: { pages: [upload("clean")] } });
const batchA = r.json.batchId;
record(r.status === 200 && r.json.queuedRows === 2 && Boolean(batchA) && modelCalls === 1, "Owner uploads a clean page: 2 rows queued", `${r.status} rows ${r.json.queuedRows} ${r.json.error ?? ""}`);
record(snapshotState(BUSINESS_A_ID) === stateA0, "after upload, live business data is unchanged (rows are pending only)");
let batch = (await get("batch", { token: ownerA.token, query: { id: batchA } })).json;
record(batch.rows?.length === 2 && batch.rows.every((x) => x.status === "pending" && x.issues.length === 0) && batch.pages.length === 1, "the batch shows 2 pending rows with no issues and its page");
const firstRow = batch.rows[0];
record(
  firstRow.fields.revenue.value === 1500 && firstRow.fields.revenue.confidence === "high" && firstRow.fields.vehicleRegistration.value === "UAT-TEST-01" && "note" in firstRow.fields.wash,
  "each field carries value, confidence and note",
);
r = await get("page-image", { token: ownerA.token, query: { id: batch.pages[0].id } });
record(r.status === 200 && Buffer.isBuffer(r.raw) && r.raw.equals(pageImage("clean")) && r.headers["content-type"] === "image/png", "the stored page image is served back byte for byte", `${r.status}`);
record(batch.events.length === 2 && batch.events.every((e) => e.action === "extracted" && e.actor_user_id === ownerA.userId && e.actor_role === "Owner"), "the audit log records who extracted each row");

r = await post("row-approve", { token: ownerA.token, body: { rowId: firstRow.id } });
const idsFirst = logbookRecordIds(firstRow.rowHash);
let snap = snapshotOf(BUSINESS_A_ID);
const liveOf = (snapshot, ids) => snapshot.financeTransactions.filter((x) => x.id.startsWith(ids.income.slice(0, -4)));
let live = liveOf(snap, idsFirst);
record(r.status === 200 && r.json.row.status === "approved" && r.json.liveRecordIds.length === 4, "Owner approves the first row", `${r.status} ${r.json.error ?? ""}`);
const income = live.find((x) => x.id === idsFirst.income);
record(
  live.length === 4 && income?.amountClaimed === 1500 && income.tripDate === "2026-11-03" && income.vehicleId === "uat-veh-01" && income.driverStaffId === "uat-drv-01" && income.status === "pending" && income.createdBy === ownerA.userId,
  "the live records exist: 1 income + 3 expenses for the right driver, vehicle and day, status pending",
  `records ${live.length}`,
);
record(
  live.filter((x) => x.type === "expense").map((x) => `${x.category}:${x.amount}:${x.cashExpense}`).sort().join("|") === "Fuel:400:true|Rank Fees:30:true|Wash:50:true",
  "expenses use the existing categories (Fuel, Wash, Rank Fees) as cash expenses",
);
record(snap.deposits.length === 1 && snap.dailyCashUps.length === 1, "approval created no deposit and no cash-up (the banked figure is reference only)");
record(snap.auditTrail[0].entityType === "logbook-import" && snap.auditTrail[0].actorId === ownerA.userId, "the business audit trail names the approver");
batch = (await get("batch", { token: ownerA.token, query: { id: batchA } })).json;
const approvedEvent = batch.events.find((e) => e.action === "approved");
record(approvedEvent?.actor_user_id === ownerA.userId && batch.rows[0].reviewedBy === ownerA.userId && batch.rows[1].status === "pending", "the row log records who approved; the other row is still pending");
const stateAfterApprove = snapshotState(BUSINESS_A_ID);

r = await post("row-approve", { token: ownerA.token, body: { rowId: firstRow.id } });
record(r.status === 409 && snapshotState(BUSINESS_A_ID) === stateAfterApprove, "approving the same row again is refused; nothing changes", `${r.status} ${r.json.error ?? ""}`);

// --- 5. Idempotent re-import: no duplicates ----------------------------------------------
const callsBefore = modelCalls;
const rowsBefore = count("logbook_rows");
r = await post("extract", { token: ownerA.token, body: { pages: [upload("clean")] } });
record(
  r.status === 200 && r.json.queuedRows === 0 && r.json.pages[0].duplicatePage === true && r.json.batchId === batchA && modelCalls === callsBefore,
  "re-uploading the same page: recognised, no model call, nothing queued, the first batch is returned",
  `${r.status} queued ${r.json.queuedRows}`,
);
record(count("logbook_rows") === rowsBefore && count("logbook_pages") === 1 && snapshotState(BUSINESS_A_ID) === stateAfterApprove, "after re-upload: same rows, same page, same live data");
r = await post("extract", { token: ownerA.token, body: { pages: [upload("clean-rephotographed")] } });
record(
  r.status === 200 && r.json.queuedRows === 0 && r.json.skippedDuplicateRows.length === 2 && modelCalls === callsBefore + 1 &&
    r.json.skippedDuplicateRows.map((x) => x.existingStatus).sort().join(",") === "approved,pending",
  "a new photo of the same lines: both rows skipped by their row hash (one approved, one pending)",
  `${r.status} skipped ${r.json.skippedDuplicateRows?.length}`,
);
record(count("logbook_rows") === rowsBefore && liveOf(snapshotOf(BUSINESS_A_ID), idsFirst).length === 4, "after the re-photographed page: no extra rows and no duplicate live records");

// --- 6. Illegible cell: null + low, never guessed; edit then approve ----------------------
r = await post("extract", { token: ownerA.token, body: { pages: [upload("illegible")] } });
const batchIllegible = r.json.batchId;
batch = (await get("batch", { token: ownerA.token, query: { id: batchIllegible } })).json;
const blot = batch.rows[0];
record(
  blot.fields.wash.value === null && blot.fields.wash.confidence === "low" && /ink blot/.test(blot.fields.wash.note) && blot.fields.revenue.confidence === "medium",
  "the illegible cell is stored as null with low confidence and its note; the faint one is medium",
);
record(blot.issues.some((x) => x.field === "wash" && x.code === "missing" && x.severity === "error"), "the unreadable amount is flagged as an error");
const stateBeforeBlot = snapshotState(BUSINESS_A_ID);
r = await post("row-approve", { token: ownerA.token, body: { rowId: blot.id, acknowledgeWarnings: true } });
record(r.status === 409 && Array.isArray(r.json.issues) && snapshotState(BUSINESS_A_ID) === stateBeforeBlot, "a row with an unreadable value cannot be approved (even when acknowledging warnings)", `${r.status}`);
r = await post("row-edit", { token: ownerA.token, body: { rowId: blot.id, values: { wash: "R 50,00", banked: 920 } } });
record(
  r.status === 200 && r.json.row.fields.wash.value === 50 && r.json.row.fields.wash.confidence === "high" && /Entered by reviewer \(was unreadable\)/.test(r.json.row.fields.wash.note) && r.json.row.editedBy === ownerA.userId && r.json.row.rowHash !== blot.rowHash,
  "the Owner types the value from the page: saved, marked as entered by a reviewer, hash recomputed",
  `${r.status} ${r.json.error ?? ""}`,
);
record(snapshotState(BUSINESS_A_ID) === stateBeforeBlot, "editing a pending row does not touch live data");
r = await post("row-edit", { token: ownerA.token, body: { rowId: blot.id, values: { wash: "fifty" } } });
record(r.status === 400, "an edit that is not a number is refused", `${r.status}`);
r = await post("row-approve", { token: ownerA.token, body: { rowId: blot.id } });
record(r.status === 200 && r.json.liveRecordIds.length === 4, "after the correction the row can be approved", `${r.status} ${r.json.error ?? ""}`);
batch = (await get("batch", { token: ownerA.token, query: { id: batchIllegible } })).json;
record(batch.events.map((e) => e.action).join(",") === "extracted,edited,approved" && batch.events.every((e) => e.actor_user_id === ownerA.userId), "the row log shows extracted, edited, approved with the actor each time");

// --- 7. Arithmetic warning must be acknowledged; unknown vehicle blocks -------------------
r = await post("extract", { token: ownerA.token, body: { pages: [upload("unbalanced"), upload("unknown-vehicle")] } });
batch = (await get("batch", { token: ownerA.token, query: { id: r.json.batchId } })).json;
const unbalanced = batch.rows.find((x) => x.fields.date.value === "2026-11-06");
const unknownVehicle = batch.rows.find((x) => x.fields.date.value === "2026-11-07");
record(r.status === 200 && batch.pages.length === 2 && batch.rows.length === 2, "two pages in one request land in one batch");
record(unbalanced.issues.length === 1 && unbalanced.issues[0].code === "not_reconciled" && unbalanced.issues[0].severity === "warning", "revenue - expenses != banked is flagged on the row");
record(unknownVehicle.issues.some((x) => x.code === "unknown_vehicle" && x.severity === "error"), "an unknown vehicle registration is flagged");
r = await post("row-approve", { token: ownerA.token, body: { rowId: unbalanced.id } });
record(r.status === 409 && r.json.needsAcknowledgement === true, "a row that does not reconcile needs an explicit confirmation", `${r.status}`);
r = await post("row-approve", { token: ownerA.token, body: { rowId: unbalanced.id, acknowledgeWarnings: true } });
record(r.status === 200, "with the confirmation it is approved", `${r.status} ${r.json.error ?? ""}`);
r = await post("row-approve", { token: ownerA.token, body: { rowId: unknownVehicle.id, acknowledgeWarnings: true } });
record(r.status === 409, "a row with an unknown vehicle cannot be approved", `${r.status}`);
r = await post("row-edit", { token: ownerA.token, body: { rowId: unknownVehicle.id, values: { vehicleRegistration: "UAT-TEST-01", date: "2026-11-03" } } });
record(r.status === 409 && /same driver, vehicle, date and amounts/.test(r.json.error ?? ""), "an edit that would duplicate another row is refused", `${r.status} ${r.json.error ?? ""}`);

// --- 8. Reject keeps an audit record -------------------------------------------------------
r = await post("extract", { token: ownerA.token, body: { pages: [upload("to-reject")] } });
const batchReject = r.json.batchId;
batch = (await get("batch", { token: ownerA.token, query: { id: batchReject } })).json;
const toReject = batch.rows[0];
const stateBeforeReject = snapshotState(BUSINESS_A_ID);
r = await post("row-reject", { token: ownerA.token, body: { rowId: toReject.id, reason: "x" } });
record(r.status === 400, "a rejection needs a reason", `${r.status}`);
r = await post("row-reject", { token: ownerA.token, body: { rowId: toReject.id, reason: "Not our vehicle's page" } });
batch = (await get("batch", { token: ownerA.token, query: { id: batchReject } })).json;
const rejectEvent = batch.events.find((e) => e.action === "rejected");
record(
  r.status === 200 && batch.rows[0].status === "rejected" && batch.rows[0].rejectReason === "Not our vehicle's page" && rejectEvent?.actor_user_id === ownerA.userId && rejectEvent.detail === "Not our vehicle's page",
  "reject: the row and its reason are kept, with who rejected it",
  `${r.status}`,
);
record(snapshotState(BUSINESS_A_ID) === stateBeforeReject, "rejecting writes nothing to live data");
r = await post("row-approve", { token: ownerA.token, body: { rowId: toReject.id } });
record(r.status === 409, "a rejected row cannot be approved afterwards", `${r.status}`);
r = await post("row-edit", { token: ownerA.token, body: { rowId: toReject.id, values: { revenue: 1 } } });
record(r.status === 409, "a rejected row cannot be edited afterwards", `${r.status}`);

// --- 9. Invalid model JSON: reject and retry once -------------------------------------------
let before = modelCalls;
r = await post("extract", { token: ownerA.token, body: { pages: [upload("bad-json-then-good")] } });
record(r.status === 200 && r.json.pages[0].attempts === 2 && modelCalls === before + 2 && r.json.queuedRows === 1, "invalid JSON from the model is rejected and retried once, then accepted", `${r.status} attempts ${r.json.pages?.[0]?.attempts}`);
before = modelCalls;
const rowsBeforeBad = count("logbook_rows");
r = await post("extract", { token: ownerA.token, body: { pages: [upload("always-bad-json")] } });
record(r.status === 502 && modelCalls === before + 2 && count("logbook_rows") === rowsBeforeBad && count("logbook_pages", "filename = 'always-bad-json.png'") === 0, "two invalid replies fail the upload (one retry only) and store nothing", `${r.status}`);

// --- 10. Concurrent approval: exactly one wins ----------------------------------------------
r = await post("extract", { token: ownerA.token, body: { pages: [upload("race")] } });
batch = (await get("batch", { token: ownerA.token, query: { id: r.json.batchId } })).json;
const raceRow = batch.rows[0];
const raced = await Promise.all([1, 2, 3].map(() => post("row-approve", { token: ownerA.token, body: { rowId: raceRow.id } })));
const raceLive = liveOf(snapshotOf(BUSINESS_A_ID), logbookRecordIds(raceRow.rowHash));
record(raced.filter((x) => x.status === 200).length === 1 && raced.filter((x) => x.status === 409).length === 2 && raceLive.length === 2, "three simultaneous approvals: one succeeds, two are refused, records exist once", raced.map((x) => x.status).join(","));

// --- 11. Admin may review when Money is on --------------------------------------------------
if (adminAllowed) {
  r = await post("row-approve", { token: adminA.token, body: { rowId: batchA && (await get("batch", { token: adminA.token, query: { id: batchA } })).json.rows[1].id } });
  const adminBatch = (await get("batch", { token: ownerA.token, query: { id: batchA } })).json;
  record(r.status === 200 && adminBatch.events.some((e) => e.action === "approved" && e.actor_user_id === adminA.userId && e.actor_role === "Admin"), "an Admin with Money access approves a row; the log names the Admin", `${r.status} ${r.json.error ?? ""}`);
} else {
  r = await get("batches", { token: adminA.token });
  record(r.status === 403 && /Money access/.test(r.json.error ?? ""), "an Admin without Money access is refused (403)", `${r.status}`);
}

// --- 12. Automation import: hashed key, import-only scope, same queue -----------------------
r = await post("keys", { token: ownerA.token, body: { action: "create", name: "Scanner station" } });
const keyA = r.json.created?.key;
const keyAId = r.json.created?.id;
const storedKey = sql(`select key_hash || '|' || key_prefix || '|' || scope from public.logbook_api_keys where id = '${keyAId}';`);
record(r.status === 200 && /^tflb_/.test(keyA ?? "") && !storedKey.includes(keyA) && /^[0-9a-f]{64}\|tflb_.{6}\|logbook\.import$/.test(storedKey), "the Owner creates an import key: shown once, stored only as a SHA-256 hash, scope logbook.import");
r = await get("keys", { token: ownerA.token });
record(r.status === 200 && r.json.keys.length === 1 && !JSON.stringify(r.json).includes(keyA) && !("key_hash" in r.json.keys[0]), "listing keys never returns the key or its hash");

const stateBeforeImport = snapshotState(BUSINESS_A_ID);
const importRow = row({ date: f("2026-11-01"), revenue: f("R 1 100,00"), fuel: f("300"), wash: f(0), marshalFees: f(0), banked: f(800) });
r = await post("import", { apiKey: keyA, body: { reference: "scanner-run-1", rows: [importRow, row()] } });
const batchImport = r.json.batchId;
record(
  r.status === 200 && r.json.status === "pending_review" && r.json.queuedRows === 1 && r.json.skippedDuplicateRows.length === 1 && r.json.skippedDuplicateRows[0].existingStatus === "approved",
  "import: the new row is queued for review; the row that was already approved is skipped",
  `${r.status} ${r.json.error ?? ""}`,
);
record(snapshotState(BUSINESS_A_ID) === stateBeforeImport, "import writes nothing to live data");
batch = (await get("batch", { token: ownerA.token, query: { id: batchImport } })).json;
record(
  batch.batch.source === "api" && batch.batch.api_key_id === keyAId && batch.rows.length === 1 && batch.rows[0].status === "pending" && batch.rows[0].fields.revenue.value === 1100 && batch.events[0].action === "imported" && batch.events[0].actor_api_key_id === keyAId,
  "the imported row is pending, parsed (R 1 100,00 -> 1100) and logged against the key",
);
r = await post("import", { apiKey: keyA, body: { reference: "scanner-run-1", rows: [importRow, row()] } });
record(r.status === 200 && r.json.queuedRows === 0 && r.json.batchId === null && r.json.skippedDuplicateRows.length === 2 && count("logbook_batches", `id <> '${batchImport}' and source = 'api'`) === 0, "sending the same import again adds nothing (idempotent)", `${r.status} queued ${r.json.queuedRows}`);
r = await post("import", { apiKey: keyA, body: { rows: [{ ...row(), status: "approved" }] } });
record(r.status === 400, "an import row carrying a status is refused with 400", `${r.status}`);
r = await post("import", { headers: { authorization: `Bearer ${keyA}` }, body: { rows: [row({ date: f("2026-10-31") })] } });
record(r.status === 200 && r.json.queuedRows === 1, "the key also works as a Bearer token on import", `${r.status}`);

// The key opens nothing else.
seen = [];
for (const [method, action, extra] of SIGNED_IN_ACTIONS) seen.push((await call(method, action, { ...extra, apiKey: keyA, headers: { authorization: `Bearer ${keyA}` } })).status);
record(every(seen, 401), "an import key is refused on every other logbook action (401)", seen.join(","));
r = await post("import", { apiKey: keyA, query: { business: BUSINESS_B_ID }, body: { rows: [row()] } });
record(r.status === 403 && count("logbook_rows", `business_id = '${BUSINESS_B_ID}'`) === 0, "Business A's key cannot import into Business B", `${r.status}`);

// --- 13. Cross-tenant: Business B cannot see or touch Business A's logbook data ---------------
const aPending = (await get("batch", { token: ownerA.token, query: { id: batchImport } })).json.rows[0];
const aPage = (await get("batch", { token: ownerA.token, query: { id: batchA } })).json.pages[0];
const stateABeforeB = snapshotState(BUSINESS_A_ID);
const rowsABeforeB = sql(`select md5(coalesce(json_agg(r order by id)::text, '')) from public.logbook_rows r where business_id = '${BUSINESS_A_ID}';`);
const crossChecks = [
  ["batch", await get("batch", { token: ownerB.token, query: { id: batchA } })],
  ["page-image", await get("page-image", { token: ownerB.token, query: { id: aPage.id } })],
  ["export", await get("export", { token: ownerB.token, query: { id: batchA } })],
  ["row-edit", await post("row-edit", { token: ownerB.token, body: { rowId: aPending.id, values: { revenue: 1 } } })],
  ["row-approve", await post("row-approve", { token: ownerB.token, body: { rowId: aPending.id } })],
  ["row-reject", await post("row-reject", { token: ownerB.token, body: { rowId: aPending.id, reason: "cross tenant attempt" } })],
  ["extract into A's batch", await post("extract", { token: ownerB.token, body: { batchId: batchA, pages: [upload("business-b")] } })],
  ["revoke A's key", await post("keys", { token: ownerB.token, body: { action: "revoke", keyId: keyAId } })],
];
record(crossChecks.every(([, x]) => x.status === 404), "Owner B gets 404 for Business A's batch, page image, export, rows, batch append and key", crossChecks.map(([name, x]) => `${name}=${x.status}`).join(" "));
r = await get("batches", { token: ownerB.token });
record(r.status === 200 && r.json.batches.length === 0, "Owner B's batch list contains none of Business A's batches", `${r.json.batches?.length}`);
r = await get("keys", { token: ownerB.token });
record(r.status === 200 && r.json.keys.length === 0, "Owner B's key list contains none of Business A's keys");
record(
  snapshotState(BUSINESS_A_ID) === stateABeforeB && rowsABeforeB === sql(`select md5(coalesce(json_agg(r order by id)::text, '')) from public.logbook_rows r where business_id = '${BUSINESS_A_ID}';`) && count("logbook_api_keys", `id = '${keyAId}' and revoked_at is null`) === 1,
  "Business A's rows, key and live data are unchanged by Business B's attempts",
);
// Business B's own pipeline works and stays in Business B.
r = await post("extract", { token: ownerB.token, body: { pages: [upload("business-b")] } });
const batchB = r.json.batchId;
const bRow = (await get("batch", { token: ownerB.token, query: { id: batchB } })).json.rows[0];
r = await post("row-approve", { token: ownerB.token, body: { rowId: bRow.id } });
const bLive = liveOf(snapshotOf(BUSINESS_B_ID), logbookRecordIds(bRow.rowHash));
record(r.status === 200 && bLive.length === 4 && bLive[0].vehicle === "UAT-TEST-01-B" && snapshotState(BUSINESS_A_ID) === stateABeforeB, "Owner B's own upload and approval land in Business B only", `${r.status} ${r.json.error ?? ""}`);
r = await get("batch", { token: ownerA.token, query: { id: batchB } });
record(r.status === 404, "Owner A gets 404 for Business B's batch", `${r.status}`);
// The same page bytes are a different page in a different business (no cross-tenant leak by hash).
r = await post("extract", { token: ownerB.token, body: { pages: [upload("clean")] } });
record(r.status === 200 && r.json.pages[0].duplicatePage === false && r.json.batchId !== batchA, "Business A's page hash is not visible to Business B", `${r.status}`);

// --- 14. Excel export -----------------------------------------------------------------------
r = await get("export", { token: ownerA.token, query: { id: batchIllegible } });
const { default: ExcelJS } = await import("exceljs");
let sheetOk = false;
if (r.status === 200 && Buffer.isBuffer(r.raw)) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(r.raw);
  const sheet = workbook.getWorksheet("Logbook batch");
  const header = sheet.getRow(1).values.slice(1);
  const line = sheet.getRow(2).values;
  sheetOk = header[2] === "Date" && header.includes("Confidence flags") && sheet.rowCount === 2 && line[header.indexOf("Wash") + 1] === 50 && /Revenue: medium/.test(line[header.indexOf("Confidence flags") + 1]) && line[header.indexOf("Status") + 1] === "approved";
}
record(r.status === 200 && /spreadsheetml/.test(r.headers["content-type"]) && /\.xlsx"$/.test(r.headers["content-disposition"]) && sheetOk, "Excel export of a batch: columns, values, confidence flags and status", `${r.status}`);

// --- 15. Revoked key and rate limit ----------------------------------------------------------
r = await post("keys", { token: ownerA.token, body: { action: "create", name: "Rate test" } });
const rateKey = r.json.created.key;
const statuses = [];
for (let i = 0; i < IMPORT_RATE_LIMIT + 3; i += 1) statuses.push((await post("import", { apiKey: rateKey, body: { rows: [] } })).status);
const firstLimited = statuses.indexOf(429);
// A minute boundary inside the loop resets the window once; the limit still held if a 429 was seen
// and no more than IMPORT_RATE_LIMIT requests in a row were accepted.
let longestAccepted = 0;
let run = 0;
for (const s of statuses) { run = s === 429 ? 0 : run + 1; longestAccepted = Math.max(longestAccepted, run); }
record(firstLimited >= 0 && longestAccepted <= IMPORT_RATE_LIMIT && statuses.filter((s) => s !== 429).every((s) => s === 400), `import is rate limited: at most ${IMPORT_RATE_LIMIT} requests per minute per key, then 429`, `first 429 at request ${firstLimited + 1}`);
r = await post("import", { apiKey: rateKey, body: { rows: [row()] } });
record(r.status === 429 ? r.headers["retry-after"] === "60" : true, "a limited request carries Retry-After", `${r.status}`);
r = await post("keys", { token: ownerA.token, body: { action: "revoke", keyId: keyAId } });
const afterRevoke = await post("import", { apiKey: keyA, body: { rows: [row({ date: f("2026-10-30") })] } });
record(r.status === 200 && afterRevoke.status === 401, "a revoked key stops working immediately (401)", `${r.status} then ${afterRevoke.status}`);

// --- 16. Final invariants ---------------------------------------------------------------------
const dupHashes = Number(sql("select count(*) from (select business_id, row_hash from public.logbook_rows where status <> 'rejected' group by 1, 2 having count(*) > 1) d;"));
const finalA = snapshotOf(BUSINESS_A_ID);
const logbookIds = finalA.financeTransactions.filter((x) => x.source === "logbook-import").map((x) => x.id);
const approvedRows = count("logbook_rows", `business_id = '${BUSINESS_A_ID}' and status = 'approved'`);
const liveRowIds = new Set(finalA.financeTransactions.filter((x) => x.logbookImport).map((x) => x.logbookImport.rowId));
record(dupHashes === 0 && new Set(logbookIds).size === logbookIds.length, "no duplicate active row hashes and no duplicate live record ids");
record(liveRowIds.size === approvedRows && count("logbook_rows", `business_id = '${BUSINESS_A_ID}' and status <> 'approved' and id::text in (${[...liveRowIds].map((id) => `'${id}'`).join(",") || "''"})`) === 0, "every live logbook record comes from an approved row, and only from approved rows", `${liveRowIds.size} approved rows with live records`);
record(count("logbook_row_events", "actor_user_id is null and actor_api_key_id is null") === 0, "every audit event names a user or an API key");

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
