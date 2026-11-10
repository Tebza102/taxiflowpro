#!/usr/bin/env node
// Extraction check with three SYNTHETIC logbook pages (no real data):
//   clean      a clearly written page
//   blurry     the same layout, out of focus and slightly rotated
//   illegible  a clear page with one amount hidden under an ink blot
// The pages are drawn here (Playwright/Chromium) and written to
// uat-reports/logbook-synthetic/ (ignored by Git). With LOGBOOK_VISION_MODEL and
// ANTHROPIC_API_KEY set, each page goes through the REAL server extraction code
// (prepareLogbookImage + extractLogbookPage) and the results are checked:
//   - clean: every value matches what was written;
//   - illegible: the blotted cell is null with low confidence (never a number);
//   - blurry: no value is both wrong and reported with high confidence.
// Without those two variables it only draws the pages and exits 2 (BLOCKED).
//   node scripts/logbook/extraction-check.mjs [--draw-only]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import { LOGBOOK_FIELDS, normalizeLogbookFields, normalizeRegistration, normalizePersonName } from "../../src/lib/logbookContract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "uat-reports", "logbook-synthetic");

const line = (date, registration, driver, revenue, fuel, wash, marshalFees, otherExpenses, banked) => ({ date, vehicleRegistration: registration, driverName: driver, revenue, fuel, wash, marshalFees, otherExpenses, banked });
export const SYNTHETIC_PAGES = {
  clean: {
    rows: [
      line("2026-11-02", "UAT 101 GP", "Thabo Example", 1650, 480, 60, 30, 0, 1080),
      line("2026-11-03", "UAT 101 GP", "Thabo Example", 1420, 450, 0, 30, 0, 940),
      line("2026-11-04", "UAT 101 GP", "Thabo Example", 1810, 520, 60, 30, 100, 1100),
    ],
  },
  blurry: {
    blur: true,
    rows: [
      line("2026-11-05", "UAT 202 GP", "Lerato Sample", 1530, 460, 0, 30, 0, 1040),
      line("2026-11-06", "UAT 202 GP", "Lerato Sample", 1275, 410, 50, 30, 0, 785),
    ],
  },
  illegible: {
    // Row 2's wash amount is covered by an ink blot.
    blot: { row: 1, field: "wash" },
    rows: [
      line("2026-11-07", "UAT 303 GP", "Sipho Testcase", 1390, 430, 50, 30, 0, 880),
      line("2026-11-08", "UAT 303 GP", "Sipho Testcase", 1705, 500, 70, 30, 0, 1105),
      line("2026-11-09", "UAT 303 GP", "Sipho Testcase", 1240, 400, 0, 30, 0, 810),
    ],
  },
};

const HEADINGS = ["Date", "Vehicle reg", "Driver", "Revenue", "Diesel", "Wash", "Marshal", "Other", "Banked"];
const KEYS = ["date", "vehicleRegistration", "driverName", "revenue", "fuel", "wash", "marshalFees", "otherExpenses", "banked"];
const shown = (key, value) => (key === "date" ? value.split("-").reverse().join("/") : typeof value === "number" ? (value === 0 ? "-" : `R ${value}`) : value);

export const pageHtml = ({ rows, blur, blot }) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #f4efe2; font-family: "Segoe Print", "Comic Sans MS", "Bradley Hand", cursive; color: #1b2a55; }
  .sheet { width: 1500px; padding: 48px 40px 64px; ${blur ? "filter: blur(2.2px); transform: rotate(-1.4deg); transform-origin: center;" : ""} }
  h1 { font: 700 30px Georgia, serif; color: #333; margin: 0 0 6px; }
  p { font: 16px Georgia, serif; color: #555; margin: 0 0 22px; }
  table { border-collapse: collapse; width: 100%; background: #fffdf6; }
  th { font: 700 17px Georgia, serif; color: #222; background: #e4dcc6; border: 2px solid #6b6b6b; padding: 10px 8px; }
  td { border: 2px solid #8a8a8a; padding: 16px 10px; font-size: 26px; text-align: center; position: relative; }
  .blot { position: absolute; inset: 3px 6px; background: radial-gradient(ellipse at 45% 50%, #05070d 0 62%, #0b1020 74%, rgba(11,16,32,0.75) 100%); border-radius: 46% 54% 58% 42% / 55% 44% 56% 45%; }
</style></head><body><div class="sheet">
  <h1>DRIVER DAILY LOGBOOK (SYNTHETIC TEST PAGE)</h1><p>Year: 2026 &nbsp; Dates written day/month/year</p>
  <table><thead><tr>${HEADINGS.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
  ${rows.map((r, i) => `<tr>${KEYS.map((key) => `<td>${shown(key, r[key])}${blot && blot.row === i && blot.field === key ? '<span class="blot"></span>' : ""}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div></body></html>`;

export const drawSyntheticPages = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const files = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1580, height: 700 } });
    for (const [name, spec] of Object.entries(SYNTHETIC_PAGES)) {
      await page.setContent(pageHtml(spec));
      files[name] = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: files[name], fullPage: true });
    }
  } finally {
    await browser.close();
  }
  return files;
};

const same = (key, actual, expected) => {
  if (actual === null || actual === undefined) return false;
  if (key === "vehicleRegistration") return normalizeRegistration(actual) === normalizeRegistration(expected);
  if (key === "driverName") return normalizePersonName(actual) === normalizePersonName(expected);
  return actual === expected;
};

const main = async () => {
  const files = await drawSyntheticPages();
  console.log(`Synthetic pages written to ${path.relative(ROOT, OUT)}: ${Object.keys(files).join(", ")}`);
  if (process.argv.includes("--draw-only")) return 0;
  if (!process.env.LOGBOOK_VISION_MODEL || !process.env.ANTHROPIC_API_KEY) {
    console.log("BLOCKED: set LOGBOOK_VISION_MODEL and ANTHROPIC_API_KEY to run the real extraction check. No model was called.");
    return 2;
  }
  const { extractLogbookPage, prepareLogbookImage } = await import("../../api/_lib/logbookVision.js");
  const results = [];
  const record = (ok, name, detail) => {
    results.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const report = {};
  for (const [name, spec] of Object.entries(SYNTHETIC_PAGES)) {
    const image = await prepareLogbookImage({ filename: `${name}.png`, dataBase64: readFileSync(files[name]).toString("base64") });
    const extraction = await extractLogbookPage(image);
    const rows = extraction.rows.map(normalizeLogbookFields);
    report[name] = { attempts: extraction.attempts, pageNote: extraction.pageNote, rows };
    record(rows.length === spec.rows.length, `${name}: ${spec.rows.length} rows returned`, `${rows.length} (attempts ${extraction.attempts})`);
    const wrongHigh = [];
    const mismatched = [];
    rows.forEach((fields, index) => {
      const truth = spec.rows[index];
      if (!truth) return;
      for (const { key } of LOGBOOK_FIELDS) {
        const blotted = spec.blot && spec.blot.row === index && spec.blot.field === key;
        if (blotted) continue;
        if (!same(key, fields[key].value, truth[key])) {
          mismatched.push(`row ${index + 1} ${key}: got ${JSON.stringify(fields[key].value)} (${fields[key].confidence}), written ${JSON.stringify(truth[key])}`);
          if (fields[key].value !== null && fields[key].confidence === "high") wrongHigh.push(`row ${index + 1} ${key}`);
        }
      }
    });
    if (name === "clean") record(mismatched.length === 0, "clean: every value matches what was written", mismatched.join("; "));
    if (name === "blurry") record(wrongHigh.length === 0, "blurry: no value is wrong AND reported with high confidence", `${mismatched.length} value(s) differ or are unread; wrong-with-high: ${wrongHigh.join(", ") || "none"}`);
    if (spec.blot) {
      const cell = rows[spec.blot.row]?.[spec.blot.field];
      record(cell?.value === null && cell?.confidence === "low", "illegible: the blotted cell is null with low confidence", JSON.stringify(cell));
      record(mismatched.length === 0, "illegible: every other value matches what was written", mismatched.join("; "));
    }
  }
  writeFileSync(path.join(OUT, "extraction-report.json"), JSON.stringify(report, null, 2));
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length} (model ${process.env.LOGBOOK_VISION_MODEL})`);
  return failed ? 1 : 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
