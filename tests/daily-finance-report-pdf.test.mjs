import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyFinanceReportData } from "../api/_lib/dailyFinanceReport.js";
import { renderDailyFinanceReportPdf } from "../api/_lib/dailyFinanceReportPdf.js";
import { mockSnapshot } from "../src/data/mockData.js";

// pdfkit (compress:false, standard fonts) writes text as WinAnsi hex strings
// inside TJ arrays, split around kerning numbers. Joining the hex chunks in
// order gives back the visible text for substring checks.
const extractText = (buffer) =>
  (buffer.toString("latin1").match(/<[0-9a-fA-F]+>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1"))
    .join("");

const pageCount = (buffer) => (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

const clone = (value) => JSON.parse(JSON.stringify(value));

const snapshotWith = (overrides = {}) => ({
  vehicles: [{ id: "veh-1", registration: "TEST 100 GP" }],
  drivers: [{ staffId: "drv-1", name: "Test Driver", role: "Driver" }],
  financeTransactions: [
    {
      id: "daily-1",
      type: "income",
      incomeKind: "standard",
      vehicleId: "veh-1",
      vehicle: "TEST 100 GP",
      route: "Point A to Point B",
      tripDate: "2026-04-05",
      amountClaimed: 140,
      actualCashReceived: 130,
      status: "verified",
      createdBy: "drv-1",
      createdByRole: "Admin",
      driverStaffId: "drv-1",
      ...overrides,
    },
  ],
  dailyCashUps: [],
  deposits: [],
});

const render = async (snapshot, id = "daily-1", source = "live") =>
  renderDailyFinanceReportPdf(buildDailyFinanceReportData(snapshot, id), {
    source,
    generatedAt: new Date("2026-09-28T12:03:11Z"),
  });

test("renders a single A4 portrait page for a normal record", async () => {
  const buffer = await render(snapshotWith());
  const raw = buffer.toString("latin1");

  assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(pageCount(buffer), 1);
  assert.match(raw, /\/MediaBox \[0 0 595\.28 841\.89\]/);
});

test("prints the generation time in South African time and the snapshot note", async () => {
  const text = extractText(await render(snapshotWith()));

  assert.ok(text.includes("Generated 28 Sep 2026, 14:03:11 SAST"));
  assert.ok(text.includes("reflects the selected record at the time of generation"));
  assert.ok(text.includes("Page 1 of 1"));
  assert.ok(text.includes("LIVE DATA"));
  assert.ok(!text.includes("DEMO DATA"));
});

test("shows the same cash figures as the report data, with a signed variance", async () => {
  const text = extractText(await render(snapshotWith()));

  assert.ok(text.includes("Expected cash hand-in"));
  assert.ok(text.includes("R 140"));
  assert.ok(text.includes("R 130"));
  assert.ok(text.includes("R 10 short"));
});

test("marks a demo report as DEMO DATA on every page", async () => {
  const snapshot = snapshotWith({ notes: "Long note. ".repeat(400) });
  const buffer = await render(snapshot, "daily-1", "mock");
  const text = extractText(buffer);
  const pages = pageCount(buffer);

  assert.ok(pages >= 2, "long notes should flow onto a second page");
  assert.ok(text.includes("not a live financial record"));
  const footerMarks = text.split("DEMO DATA - not a live record").length - 1;
  assert.equal(footerMarks, pages);
});

test("shows Awaiting count instead of a zero bar when cash has not been counted", async () => {
  const text = extractText(await render(snapshotWith({ actualCashReceived: null, status: "pending" })));

  assert.ok(text.includes("Awaiting count"));
  assert.ok(!text.includes("short"));
  assert.ok(!text.includes("over"));
});

test("shows No data recorded rather than a misleading chart when amounts are missing", async () => {
  const text = extractText(
    await render(snapshotWith({ amountClaimed: undefined, actualCashReceived: null, status: "pending" })),
  );

  assert.ok(text.includes("No data recorded"));
  assert.ok(text.includes("Not recorded"));
});

test("stages beyond the current status are labelled Not reached", async () => {
  const text = extractText(await render(snapshotWith({ status: "counted" })));

  assert.equal(text.split("Not reached").length - 1, 2);
});

test("banked seed record renders its linked deposit", async () => {
  const text = extractText(await render(clone(mockSnapshot), "txn-inc-0901"));

  assert.ok(text.includes("TFP-THU-0326"));
  assert.ok(text.includes("Deposited"));
});

test("characters the PDF fonts cannot encode are replaced instead of corrupting the page", async () => {
  const buffer = await render(snapshotWith({ notes: "Seal OK \u{1F690} café “quoted”" }));
  const text = extractText(buffer);

  assert.ok(text.includes("Seal OK ? café"));
  assert.equal(pageCount(buffer), 1);
});
