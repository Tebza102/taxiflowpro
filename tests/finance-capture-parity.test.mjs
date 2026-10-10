import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

import {
  buildDailyAnalyticsFields,
  buildTripAnalyticsFields,
  getDailyTripLogbookTotals,
  getTimeInputMinutes,
  parseTimeInputValue,
  sastTimestamp,
} from "../api/_lib/financeCapture.js";

// The server capture helpers mirror src/lib/appRuntime.js, which cannot load in
// plain Node. Load the real browser module through Vite's SSR loader and hold
// both to the same outputs, so the server cannot silently drift from the app.

let vite;
let browser;

test.before(async () => {
  vite = await createServer({ logLevel: "silent", server: { middlewareMode: true, hmr: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  browser = await vite.ssrLoadModule("/src/lib/appRuntime.js");
});

test.after(async () => {
  await vite?.close();
});

const tripSamples = [
  { timeIn: "06:00", timeOut: "07:30", odometerStart: 1000, odometerEnd: 1042 },
  { time_in: "05:15", time_out: "05:10", opening_odo: "200", closing_odo: "180" },
  { timeIn: "", timeOut: null, kmComputed: "12.5", tripDurationMin: "30" },
  { openingOdo: 10, closingOdo: 10 },
  {},
];

test("parity: time parsing", () => {
  for (const value of ["06:00", "23:59", "24:00", "6:00", "12:60", "", null, " 07:05 "]) {
    assert.deepEqual(parseTimeInputValue(value), browser.parseTimeInputValue(value), String(value));
    assert.equal(getTimeInputMinutes(value), browser.getTimeInputMinutes(value), String(value));
  }
});

test("parity: trip and day analytics fields", () => {
  for (const sample of tripSamples) {
    assert.deepEqual(buildTripAnalyticsFields(sample), browser.buildTripAnalyticsFields(sample), JSON.stringify(sample));
    assert.deepEqual(buildDailyAnalyticsFields({ ...sample, notes: " note " }), browser.buildDailyAnalyticsFields({ ...sample, notes: " note " }));
  }
});

test("parity: daily logbook totals", () => {
  const legs = [
    { fromLocation: "A", toLocation: "B", passengerCount: 12, amountCollected: 500, timeIn: "06:00", timeOut: "06:40" },
    { fromLocation: "B", toLocation: "A", passengerCount: 9, amountCollected: 420.5 },
    { fromLocation: "A", toLocation: "C", passengerCount: 0, amountCollected: 0 },
  ];
  assert.deepEqual(getDailyTripLogbookTotals(legs), browser.getDailyTripLogbookTotals(legs));
  assert.deepEqual(getDailyTripLogbookTotals([]), browser.getDailyTripLogbookTotals([]));
});

test("parity: SAST timestamps match the browser's local-time composition on an SAST machine", { skip: new Date("2026-06-01T12:00:00Z").getTimezoneOffset() !== -120 }, () => {
  assert.equal(sastTimestamp("2026-10-01", "06:00"), browser.createTimestampFromDateTimeInput("2026-10-01", "06:00", "2026-10-01T10:00:00.000Z"));
  assert.equal(sastTimestamp("2026-10-01", "23:30"), browser.createTimestampFromDateTimeInput("2026-10-01", "23:30", "2026-10-01T10:00:00.000Z"));
});

test("SAST timestamps are explicit (independent of the server's time zone)", () => {
  assert.equal(sastTimestamp("2026-10-01", "06:00"), "2026-10-01T04:00:00.000Z");
  assert.equal(sastTimestamp("2026-10-01"), "2026-10-01T10:00:00.000Z");
});
