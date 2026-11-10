import assert from "node:assert/strict";
import test from "node:test";

import { applyLogbookApproval, logbookRecordIds } from "../api/_lib/logbookApproval.js";
import { LOGBOOK_EXPORT_COLUMNS, buildLogbookExportRows, renderLogbookWorkbook } from "../api/_lib/logbookExport.js";
import {
  canonicalLogbookRow,
  editBodySchema,
  extractionSchema,
  importBodySchema,
  logbookRowHash,
} from "../api/_lib/logbookSchema.js";
import { assertLogbookAccess, generateImportKey } from "../api/_lib/logbookService.js";
import {
  LOGBOOK_SYSTEM_PROMPT,
  extractLogbookPage,
  parseExtractionReply,
  prepareLogbookImage,
  sniffImageType,
} from "../api/_lib/logbookVision.js";
import {
  hasLogbookErrors,
  normalizeLogbookFields,
  parseLogbookAmount,
  parseLogbookDate,
  reconcileLogbookRow,
  validateLogbookRow,
} from "../src/lib/logbookContract.js";

// Unit proof of the deterministic logbook layer: schema validation, parsing,
// arithmetic reconciliation, duplicate hashing, approval mapping, the vision
// reply contract (stubbed client, synthetic data) and the Excel export.

const TODAY = "2026-11-10";
const field = (value, confidence = "high", note = null) => ({ value, confidence, note });
const rawRow = (overrides = {}) => ({
  date: field("2026-11-03"),
  vehicleRegistration: field("UAT-TEST-01"),
  driverName: field("UAT Driver"),
  revenue: field(1500),
  fuel: field(400),
  wash: field(50),
  marshalFees: field(30),
  otherExpenses: field(0),
  banked: field(1020),
  ...overrides,
});
const snapshot = () => ({
  profile: { fleetName: "UAT Fleet (synthetic)" },
  drivers: [{ staffId: "uat-drv-01", name: "UAT Driver", route: "UAT Route A" }],
  vehicles: [
    { id: "uat-veh-01", registration: "UAT-TEST-01", route: "UAT Route A", status: "active", archivedAt: null },
    { id: "uat-veh-09", registration: "UAT-OLD-09", status: "archived", archivedAt: "2026-01-01T00:00:00Z" },
  ],
  financeTransactions: [],
  dailyCashUps: [],
  auditTrail: [],
});
const codes = (issues) => issues.map((entry) => `${entry.field}:${entry.code}`);
const validate = (overrides) => validateLogbookRow(normalizeLogbookFields(rawRow(overrides)), snapshot(), { today: TODAY });

// --- Schema validation -----------------------------------------------------------
test("extraction schema accepts a complete row and refuses anything else", () => {
  assert.equal(extractionSchema.safeParse({ rows: [rawRow()], pageNote: null }).success, true);
  assert.equal(extractionSchema.safeParse({ rows: [] }).success, true);
  const missing = rawRow();
  delete missing.banked;
  assert.equal(extractionSchema.safeParse({ rows: [missing] }).success, false, "missing field");
  assert.equal(extractionSchema.safeParse({ rows: [{ ...rawRow(), tip: field(5) }] }).success, false, "unknown field");
  assert.equal(extractionSchema.safeParse({ rows: [rawRow({ revenue: field("1500") })] }).success, false, "amount as text from the model");
  assert.equal(extractionSchema.safeParse({ rows: [rawRow({ revenue: { value: 1500, confidence: "certain", note: null } })] }).success, false, "unknown confidence");
  assert.equal(extractionSchema.safeParse({ rows: [rawRow({ revenue: { value: 1500 } })] }).success, false, "confidence is required");
  assert.equal(extractionSchema.safeParse({ rows: [rawRow()], snapshot: {} }).success, false, "extra top-level key");
});

test("import schema accepts numeric text, and refuses roles, business ids and statuses", () => {
  assert.equal(importBodySchema.safeParse({ rows: [rawRow({ revenue: field("R 1 500,00") })] }).success, true);
  assert.equal(importBodySchema.safeParse({ rows: [] }).success, false, "at least one row");
  assert.equal(importBodySchema.safeParse({ rows: [rawRow()], businessId: "x" }).success, false);
  assert.equal(importBodySchema.safeParse({ rows: [{ ...rawRow(), status: "approved" }] }).success, false);
  assert.equal(editBodySchema.safeParse({ rowId: "10000000-0000-4000-8000-000000000001", values: { wash: "R 50,00", banked: 920 } }).success, true, "an edit may change only some fields");
  assert.equal(editBodySchema.safeParse({ rowId: "10000000-0000-4000-8000-000000000001", values: {} }).success, false, "empty edit");
  assert.equal(editBodySchema.safeParse({ rowId: "10000000-0000-4000-8000-000000000001", values: { status: "approved" } }).success, false, "not a logbook field");
});

test("numbers and dates parse strictly; unreadable values become null with low confidence", () => {
  assert.equal(parseLogbookAmount("R 1 250,50"), 1250.5);
  assert.equal(parseLogbookAmount("1,250.50"), 1250.5);
  assert.equal(parseLogbookAmount("1.250,50"), 1250.5);
  assert.equal(parseLogbookAmount("1,250"), 1250);
  assert.equal(parseLogbookAmount(99.999), 100);
  assert.equal(parseLogbookAmount("12o0"), null);
  assert.equal(parseLogbookAmount(""), null);
  assert.equal(parseLogbookDate("2026-02-28"), "2026-02-28");
  assert.equal(parseLogbookDate("2026-02-30"), null);
  assert.equal(parseLogbookDate("03/11/2026"), null);

  const fields = normalizeLogbookFields(rawRow({ fuel: field("4?0", "high"), wash: field(null, "high", "ink blot") }));
  assert.deepEqual({ value: fields.fuel.value, confidence: fields.fuel.confidence }, { value: null, confidence: "low" });
  assert.match(fields.fuel.note, /Could not read/);
  assert.deepEqual(fields.wash, { value: null, confidence: "low", note: "ink blot" }, "null is always low, whatever was claimed");
});

// --- Deterministic validation ---------------------------------------------------
test("a clean row has no issues and resolves the vehicle and driver", () => {
  const result = validate();
  assert.deepEqual(result.issues, []);
  assert.equal(result.vehicleId, "uat-veh-01");
  assert.equal(result.driverStaffId, "uat-drv-01");
});

test("dates must be valid and plausible", () => {
  assert.deepEqual(codes(validate({ date: field("2026-02-30") }).issues), ["date:invalid_date"]);
  assert.deepEqual(codes(validate({ date: field("2026-11-11") }).issues), ["date:future_date"]);
  assert.deepEqual(codes(validate({ date: field(null, "low") }).issues), ["date:missing"]);
  const old = validate({ date: field("2023-01-05") }).issues;
  assert.deepEqual(old.map((entry) => `${entry.code}:${entry.severity}`), ["old_date:warning"]);
});

test("vehicle registrations and drivers must be known to the business", () => {
  assert.equal(validate({ vehicleRegistration: field("uat test 01") }).vehicleId, "uat-veh-01", "spacing and case are ignored");
  assert.deepEqual(codes(validate({ vehicleRegistration: field("ZZ 99 ZZ GP") }).issues), ["vehicleRegistration:unknown_vehicle"]);
  assert.deepEqual(codes(validate({ vehicleRegistration: field("UAT-OLD-09") }).issues), ["vehicleRegistration:archived_vehicle"]);
  assert.deepEqual(codes(validate({ driverName: field("Nobody Known") }).issues), ["driverName:unknown_driver"]);
  assert.equal(validate({ driverName: field("  uat   DRIVER ") }).driverStaffId, "uat-drv-01");
});

test("amounts must be present, non-negative and plausible", () => {
  assert.deepEqual(codes(validate({ wash: field(null, "low") }).issues), ["wash:missing"]);
  assert.ok(codes(validate({ fuel: field(-5) }).issues).includes("fuel:invalid_amount"));
  assert.ok(codes(validate({ revenue: field(5_000_000) }).issues).includes("revenue:implausible_amount"));
  assert.ok(codes(validate({ revenue: field(0), fuel: field(0), wash: field(0), marshalFees: field(0), banked: field(0) }).issues).includes("revenue:empty_row"));
});

// --- Arithmetic reconciliation ---------------------------------------------------
test("reconciliation: revenue less expenses must equal the banked amount", () => {
  const ok = reconcileLogbookRow(normalizeLogbookFields(rawRow()));
  assert.deepEqual(ok, { expectedBankedCents: 102000, bankedCents: 102000, differenceCents: 0, reconciles: true });

  const short = validate({ banked: field(1000) });
  assert.deepEqual(codes(short.issues), ["banked:not_reconciled"]);
  assert.equal(short.issues[0].severity, "warning");
  assert.match(short.issues[0].message, /1020\.00.*1000\.00.*-20\.00/);
  assert.equal(short.reconciliation.differenceCents, -2000);

  // Cents are compared exactly (no floating point drift).
  const cents = reconcileLogbookRow(normalizeLogbookFields(rawRow({ revenue: field(0.3), fuel: field(0.1), wash: field(0.1), marshalFees: field(0), banked: field(0.1) })));
  assert.equal(cents.reconciles, true);

  // A missing figure is reported as missing, never reconciled against a guess.
  assert.equal(reconcileLogbookRow(normalizeLogbookFields(rawRow({ fuel: field(null, "low") }))), null);
  assert.deepEqual(codes(validate({ fuel: field(null, "low") }).issues), ["fuel:missing"]);
});

// --- Duplicate hashing --------------------------------------------------------------
test("row hash: same driver + vehicle + date + amounts = same hash", () => {
  const base = canonicalLogbookRow(rawRow()).rowHash;
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(canonicalLogbookRow(rawRow()).rowHash, base, "deterministic");
  const cosmetic = rawRow({
    driverName: field("  uat  driver", "medium", "faint"),
    vehicleRegistration: field("uat test 01", "low"),
    revenue: field("R 1 500,00", "medium"),
  });
  assert.equal(canonicalLogbookRow(cosmetic).rowHash, base, "confidence, notes, case, spacing and number format do not matter");

  for (const change of [{ date: field("2026-11-04") }, { driverName: field("Other Driver") }, { vehicleRegistration: field("UAT-TEST-02") }, { revenue: field(1500.01) }, { banked: field(1019.99) }, { wash: field(null, "low") }]) {
    assert.notEqual(canonicalLogbookRow(rawRow(change)).rowHash, base, JSON.stringify(change));
  }
  assert.equal(logbookRowHash(normalizeLogbookFields(rawRow())), base);
});

// --- Approval mapping (pure) --------------------------------------------------------
const owner = { id: "00000000-0000-4000-8000-000000000001", role: "Owner", moduleAccess: {} };
const queuedRow = (overrides) => {
  const { fields, rowHash } = canonicalLogbookRow(rawRow(overrides));
  return { id: "20000000-0000-4000-8000-000000000001", batchId: "30000000-0000-4000-8000-000000000001", fields, rowHash, status: "pending" };
};

test("approval writes pending finance records in the existing shapes and nothing else", () => {
  const before = snapshot();
  const row = queuedRow();
  const { snapshot: after, liveRecordIds } = applyLogbookApproval(before, row, owner, { now: "2026-11-10T08:00:00.000Z" });
  const ids = logbookRecordIds(row.rowHash);
  assert.deepEqual(liveRecordIds, [ids.income, ids.expense("fuel"), ids.expense("wash"), ids.expense("marshalFees")], "zero-value expenses create no record");
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), "no new top-level keys");
  assert.deepEqual(after.drivers, before.drivers);
  assert.deepEqual(after.vehicles, before.vehicles);

  const income = after.financeTransactions.find((record) => record.id === ids.income);
  assert.deepEqual(
    { type: income.type, incomeKind: income.incomeKind, vehicleId: income.vehicleId, vehicle: income.vehicle, tripDate: income.tripDate, amountClaimed: income.amountClaimed, driverStaffId: income.driverStaffId, status: income.status, depositId: income.depositId, actualCashReceived: income.actualCashReceived },
    { type: "income", incomeKind: "standard", vehicleId: "uat-veh-01", vehicle: "UAT-TEST-01", tripDate: "2026-11-03", amountClaimed: 1500, driverStaffId: "uat-drv-01", status: "pending", depositId: null, actualCashReceived: null },
  );
  assert.equal(income.logbookImport.bankedAmount, 1020);
  assert.equal(income.createdBy, owner.id);
  const fuel = after.financeTransactions.find((record) => record.id === ids.expense("fuel"));
  assert.deepEqual(
    { type: fuel.type, expenseKind: fuel.expenseKind, category: fuel.category, expenseDate: fuel.expenseDate, amount: fuel.amount, cashExpense: fuel.cashExpense, driverStaffId: fuel.driverStaffId, status: fuel.status },
    { type: "expense", expenseKind: "asset", category: "Fuel", expenseDate: "2026-11-03", amount: 400, cashExpense: true, driverStaffId: "uat-drv-01", status: "pending" },
  );
  assert.equal(after.deposits, undefined, "the banked figure never creates a deposit");
  assert.equal(after.auditTrail.length, 1);
  assert.equal(after.auditTrail[0].actorId, owner.id);

  // The same row can never be recorded twice.
  assert.throws(() => applyLogbookApproval(after, row, owner), (error) => error.statusCode === 409 && /already been recorded/.test(error.message));
});

test("approval is refused for unreadable values, unknown vehicles and unacknowledged warnings", () => {
  const refuses = (overrides, pattern, options) =>
    assert.throws(() => applyLogbookApproval(snapshot(), queuedRow(overrides), owner, options), (error) => error.statusCode === 409 && pattern.test(error.message));
  refuses({ wash: field(null, "low", "ink blot") }, /still has problems/);
  refuses({ vehicleRegistration: field("ZZ 99 ZZ GP") }, /still has problems/);
  refuses({ banked: field(900) }, /warnings/);
  assert.doesNotThrow(() => applyLogbookApproval(snapshot(), queuedRow({ banked: field(900) }), owner, { acknowledgeWarnings: true }));
  // Acknowledging warnings never overrides an error.
  refuses({ wash: field(null, "low") }, /still has problems/, { acknowledgeWarnings: true });
});

test("approval is refused when that driver's day is already counted", () => {
  const closed = snapshot();
  closed.financeTransactions = [{ id: "uat-fin-x", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-01", driverStaffId: "uat-drv-01", tripDate: "2026-11-03", amountClaimed: 200, status: "counted", actualCashReceived: 200 }];
  closed.dailyCashUps = [{ id: "uat-cu-x", driverStaffId: "uat-drv-01", workDate: "2026-11-03", status: "counted", actualCashReceived: 200, expectedCashIn: 200, incomeRecordIds: ["uat-fin-x"], expenseRecordIds: [] }];
  assert.throws(() => applyLogbookApproval(closed, queuedRow(), owner), (error) => error.statusCode === 409 && /closed day/.test(error.message));
});

// --- Role rule (pure) ----------------------------------------------------------------
test("only an Owner, or an Admin with Money on, may use the logbook pipeline", () => {
  assert.doesNotThrow(() => assertLogbookAccess({ role: "Owner", moduleAccess: {} }));
  assert.doesNotThrow(() => assertLogbookAccess({ role: "Admin", moduleAccess: { finance: true } }));
  for (const requester of [{ role: "Admin", moduleAccess: { finance: false } }, { role: "Manager", moduleAccess: { finance: true } }, { role: "Driver", moduleAccess: {} }, { role: "Viewer" }, null]) {
    assert.throws(() => assertLogbookAccess(requester), (error) => error.statusCode === 403);
  }
});

test("import keys are random, prefixed and stored only as a hash", () => {
  const a = generateImportKey();
  const b = generateImportKey();
  assert.match(a.key, /^tflb_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.key, b.key);
  assert.match(a.keyHash, /^[0-9a-f]{64}$/);
  assert.ok(!a.keyHash.includes(a.key) && a.keyPrefix.length < 12);
});

// --- Uploaded files ------------------------------------------------------------------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

test("uploads: only real JPG/PNG/HEIC bytes up to 10 MB are accepted", async () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)])), "image/heic");
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7 not an image at all")), null);

  const ok = await prepareLogbookImage({ dataBase64: PNG.toString("base64"), filename: "page.png" });
  assert.equal(ok.mediaType, "image/png");
  assert.match(ok.sha256, /^[0-9a-f]{64}$/);

  const rejects = (input, status) => assert.rejects(() => prepareLogbookImage(input), (error) => error.statusCode === status);
  // A PDF renamed to .jpg with an image/jpeg claim is still refused: the bytes decide.
  await rejects({ dataBase64: Buffer.from("%PDF-1.7 not an image at all").toString("base64"), filename: "page.jpg", mediaType: "image/jpeg" }, 415);
  await rejects({ dataBase64: "not base64 !!!" }, 400);
  await rejects({ dataBase64: "" }, 400);
  const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
  await rejects({ dataBase64: big.toString("base64"), filename: "big.jpg" }, 413);
  // A HEIC container that cannot be decoded is refused, never passed on.
  await rejects({ dataBase64: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]).toString("base64") }, 415);
});

// --- Vision reply contract (stubbed client; no network) ------------------------------
const reply = (text, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });
const stubClient = (replies) => {
  const calls = [];
  return { calls, messages: { create: async (request) => (calls.push(JSON.parse(JSON.stringify(request))), replies[calls.length - 1]) } };
};
const image = { buffer: PNG, mediaType: "image/png" };

test("vision: a valid reply is accepted on the first attempt", async () => {
  const client = stubClient([reply(JSON.stringify({ rows: [rawRow({ wash: field(null, "low", "ink blot over the amount") })], pageNote: null }))]);
  const result = await extractLogbookPage(image, { client, model: "synthetic-model" });
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.rows[0].wash, { value: null, confidence: "low", note: "ink blot over the amount" });
  assert.equal(client.calls[0].model, "synthetic-model");
  assert.equal(client.calls[0].messages[0].content[0].type, "image");
  assert.equal(client.calls[0].messages[0].content[0].source.media_type, "image/png");
  assert.match(LOGBOOK_SYSTEM_PROMPT, /Never guess/);
});

test("vision: invalid JSON is rejected and retried exactly once", async () => {
  const good = JSON.stringify({ rows: [rawRow()] });
  const retried = stubClient([reply("Here are the rows: {oops"), reply(good)]);
  const result = await extractLogbookPage(image, { client: retried, model: "synthetic-model" });
  assert.equal(result.attempts, 2);
  assert.equal(retried.calls.length, 2);
  assert.equal(retried.calls[1].messages.length, 3, "the rejected reply and the reason are sent back");
  assert.match(retried.calls[1].messages[2].content, /rejected/);

  // Valid JSON in the wrong shape (a guessed string amount) is rejected the same way.
  const wrongShape = stubClient([reply(JSON.stringify({ rows: [rawRow({ revenue: field("about 1500") })] })), reply("still not json")]);
  await assert.rejects(() => extractLogbookPage(image, { client: wrongShape, model: "synthetic-model" }), (error) => error.statusCode === 502);
  assert.equal(wrongShape.calls.length, 2, "one retry only");
});

test("vision: truncated, refused and wrapped-in-prose replies are not accepted", () => {
  assert.equal(parseExtractionReply(reply("```json\n{\"rows\":[]}\n```")).ok, true, "a bare code fence is unwrapped");
  assert.equal(parseExtractionReply(reply("Sure! {\"rows\":[]}")).ok, false);
  assert.equal(parseExtractionReply(reply("{\"rows\":[]}", "max_tokens")).ok, false);
  assert.equal(parseExtractionReply(reply("", "refusal")).fatal, true);
  assert.equal(parseExtractionReply(reply("{\"rows\":[]}")).ok, true);
});

// --- Excel export ---------------------------------------------------------------------
test("Excel export: fixed columns, confidence flags and shading", async () => {
  const flagged = canonicalLogbookRow(rawRow({ wash: field(null, "low", "ink blot"), revenue: field(1500, "medium", "second digit faint") }));
  const rows = [
    { id: "r1", rowIndex: 1, pageId: "p1", fields: canonicalLogbookRow(rawRow()).fields, issues: [], status: "approved", reviewedBy: "u1", reviewedAt: "2026-11-10T08:00:00Z", rejectReason: null },
    { id: "r2", rowIndex: 2, pageId: "p1", fields: flagged.fields, issues: validateLogbookRow(flagged.fields, snapshot(), { today: TODAY }).issues, status: "pending", reviewedBy: null, reviewedAt: null, rejectReason: null },
  ];
  const pages = [{ id: "p1", page_number: 1 }];
  const lines = buildLogbookExportRows({ pages, rows, actorNames: { u1: "UAT Owner" } });
  assert.equal(lines[0].flags, "");
  assert.equal(lines[0].reviewedBy, "UAT Owner");
  assert.equal(lines[0].difference, 0);
  assert.match(lines[1].flags, /Revenue: medium - second digit faint; Wash: low \(not readable\) - ink blot/);
  assert.match(lines[1].checks, /Wash: This amount could not be read/);
  assert.equal(lines[1].wash, null, "an unreadable value is exported empty");
  assert.equal(lines[1].expectedBanked, null);

  const buffer = await renderLogbookWorkbook({ batch: { id: "30000000-0000-4000-8000-000000000001", source: "upload", created_at: "2026-11-10T08:00:00Z" }, pages, rows, actorNames: { u1: "UAT Owner" }, businessName: "UAT Fleet (synthetic)" });
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Logbook batch");
  assert.deepEqual(sheet.getRow(1).values.slice(1), LOGBOOK_EXPORT_COLUMNS.map((column) => column.header));
  assert.deepEqual(sheet.getRow(1).values.slice(1, 12), ["Row", "Page", "Date", "Vehicle", "Driver", "Revenue", "Diesel / fuel", "Wash", "Marshal fees", "Other expenses", "Banked"]);
  const column = (key) => LOGBOOK_EXPORT_COLUMNS.findIndex((entry) => entry.key === key) + 1;
  assert.equal(sheet.getRow(3).getCell(column("revenue")).fill.fgColor.argb, "FFFFE699", "medium = amber");
  assert.equal(sheet.getRow(3).getCell(column("wash")).fill.fgColor.argb, "FFF8CBAD", "low = red");
  assert.equal(sheet.getRow(3).getCell(column("wash")).value, null);
  assert.notEqual(sheet.getRow(2).getCell(column("revenue")).fill?.pattern, "solid", "high = no shading");
  assert.equal(hasLogbookErrors(rows[1].issues), true);
});
