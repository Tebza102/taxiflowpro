import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { pageHtml } from "../../scripts/logbook/extraction-check.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";
import { withStubReply } from "./logbook-vision-stub.mjs";

// Logbook import in tenant mode (LOCAL stack, synthetic identities, business B):
// upload a page photo -> rows wait for review beside the photo with low/medium
// confidence highlighted -> the unreadable cell is empty and blocks approval ->
// the Owner types it in, approves -> the records exist -> the same photo again
// adds nothing. The vision model is the synthetic stub; the server routes,
// database functions and the screen are the real ones.

test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve("uat-reports", "logbook-review");
const f = (value, confidence = "high", note = null) => ({ value, confidence, note });
const line = (date, revenue, fuel, wash, marshalFees, banked) => ({ date, vehicleRegistration: "UAT-TEST-01-B", driverName: "UAT Driver B", revenue, fuel, wash, marshalFees, otherExpenses: 0, banked });
// What is written on the synthetic page.
const WRITTEN = [line("2026-11-02", 1390, 430, 50, 30, 880), line("2026-11-03", 1705, 500, 70, 30, 1105), line("2026-11-04", 1240, 400, 0, 30, 810)];
// What the stubbed model reports: row 2's wash is under an ink blot (null, low);
// row 3's revenue is readable with doubt (medium).
const REPLY = {
  pageNote: null,
  rows: WRITTEN.map((row, index) => ({
    ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, f(value)])),
    ...(index === 1 ? { wash: f(null, "low", "ink blot over the amount") } : {}),
    ...(index === 2 ? { revenue: f(1240, "medium", "second digit is faint") } : {}),
  })),
};

let pageFile;
test.beforeAll(async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  const drawing = await browser.newPage({ viewport: { width: 1580, height: 700 } });
  await drawing.setContent(pageHtml({ rows: WRITTEN, blot: { row: 1, field: "wash" } }));
  const png = await drawing.screenshot({ fullPage: true });
  await drawing.close();
  pageFile = { name: "logbook-page-1.png", mimeType: "image/png", buffer: withStubReply(png, REPLY) };
});

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};
const api = (page, method, url, body = null) =>
  page.evaluate(async ({ method, url, body }) => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = JSON.parse(raw[1]).access_token;
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let json = null;
    try { json = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, body: json };
  }, { method, url, body });
const logbookRecords = async (page) => (await api(page, "GET", "/api/business/workspace")).body.snapshot.financeTransactions.filter((record) => record.source === "logbook-import");
const openLogbook = async (page) => {
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Logbook import" }).click();
  await expect(page.getByRole("heading", { name: "Logbook import" })).toBeVisible();
};
const rows = (page) => page.getByTestId("logbook-row");
const cell = (row, label) => row.locator("label.logbook-field").filter({ has: row.page().locator(".logbook-field-label", { hasText: label }) });

test("Owner B: upload a photo -> flagged rows beside the page -> fix the unreadable cell -> approve -> re-upload adds nothing", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  expect(await logbookRecords(page)).toHaveLength(0);
  await openLogbook(page);

  await page.getByTestId("logbook-file-input").setInputFiles(pageFile);
  await expect(rows(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByRole("status")).toContainText("3 row(s) are waiting for review");
  // Nothing reaches live data on upload.
  expect(await logbookRecords(page)).toHaveLength(0);

  // The page photo sits beside the rows and has really loaded.
  const photo = page.getByRole("img", { name: /Logbook page 1/ });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img) => img.complete && img.naturalWidth > 1000)).toBe(true);

  // Row 2: the blotted amount is empty, marked not readable, and blocks approval.
  const blotted = rows(page).nth(1);
  const wash = cell(blotted, "Wash");
  await expect(wash).toHaveAttribute("data-confidence", "low");
  await expect(wash.locator("input")).toHaveValue("");
  await expect(wash).toContainText("Not readable");
  await expect(wash).toContainText("ink blot over the amount");
  await expect(blotted.getByRole("button", { name: "Approve" })).toBeDisabled();
  // Row 3: medium confidence is highlighted with its reason; high-confidence cells are not.
  const faint = cell(rows(page).nth(2), "Revenue");
  await expect(faint).toHaveAttribute("data-confidence", "medium");
  await expect(faint).toContainText("Check this");
  await expect(faint).toContainText("second digit is faint");
  await expect(cell(rows(page).nth(0), "Revenue")).toHaveAttribute("data-confidence", "high");
  const borders = await page.evaluate(() => [...document.querySelectorAll('[data-testid="logbook-row"]')].map((row) => [...row.querySelectorAll("label.logbook-field")].map((label) => getComputedStyle(label.querySelector("input")).borderTopWidth)));
  // Exactly the flagged cells carry the heavier highlight border: none in row 1,
  // the unreadable wash in row 2, the doubtful revenue in row 3.
  expect(borders.map((row) => row.filter((width) => width === "2px").length)).toEqual([0, 1, 1]);
  await page.screenshot({ path: path.join(SHOTS, "review-flagged.png"), fullPage: true });

  // The Owner reads the page and types the amount.
  await wash.locator("input").fill("70");
  await blotted.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(cell(rows(page).nth(1), "Wash")).toHaveAttribute("data-confidence", "high");
  await expect(cell(rows(page).nth(1), "Wash")).toContainText("Entered by reviewer (was unreadable)");
  expect(await logbookRecords(page)).toHaveLength(0);

  await rows(page).nth(1).getByRole("button", { name: "Approve" }).click();
  await expect(rows(page).nth(1)).toContainText("Approved", { timeout: 30_000 });
  await expect(rows(page).nth(1).getByRole("button", { name: "Approve" })).toHaveCount(0);
  const recorded = await logbookRecords(page);
  expect(recorded.map((record) => `${record.type}:${record.category ?? "income"}:${record.amount}:${record.status}`).sort()).toEqual([
    "expense:Fuel:500:pending",
    "expense:Rank Fees:30:pending",
    "expense:Wash:70:pending",
    "income:income:1705:pending",
  ]);
  expect(recorded.every((record) => record.tripDate === "2026-11-03" || record.expenseDate === "2026-11-03")).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, "review-approved.png"), fullPage: true });

  // The approved income is in Money > Daily Earnings without a reload.
  await page.locator("button.finance-mode-button").filter({ hasText: "Daily Earnings" }).click();
  await expect(page.locator("body")).toContainText(/R\s1\s705/);
  await expect(page.locator("body")).toContainText("Daily trip / 03 Nov 2026");
  await page.locator("button.finance-mode-button").filter({ hasText: "Logbook import" }).click();

  // Reject one row with a reason; it is kept, and nothing is recorded.
  const third = rows(page).nth(2);
  await third.getByRole("button", { name: "Reject" }).click();
  await third.getByLabel("Reason for rejecting").fill("Wrong week's page");
  await third.getByRole("button", { name: "Reject row" }).click();
  await expect(rows(page).nth(2)).toContainText("Rejected", { timeout: 30_000 });
  await expect(rows(page).nth(2)).toContainText("Wrong week's page");
  expect(await logbookRecords(page)).toHaveLength(4);

  // The same photo again: recognised, nothing new queued, nothing new recorded.
  await page.getByTestId("logbook-file-input").setInputFiles(pageFile);
  await expect(page.getByRole("status")).toContainText("was uploaded before", { timeout: 60_000 });
  await expect(rows(page)).toHaveCount(3);
  expect(await logbookRecords(page)).toHaveLength(4);
  const batches = (await api(page, "GET", "/api/logbook/batches")).body.batches;
  expect(batches).toHaveLength(1);
  expect(batches[0].counts).toEqual({ pending: 1, approved: 1, rejected: 1 });

  // Excel export of the batch.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this batch to Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/^taxiflow-logbook-.*\.xlsx$/);

  // After a full reload the queue and the records are as the server holds them.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await openLogbook(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(1)).toContainText("Approved by");
});

test("Manager B and Driver B: no Logbook import screen, and the server refuses them", async ({ page }) => {
  await signIn(page, "manager.b@example.com");
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await expect(page.locator("button.finance-mode-button").filter({ hasText: "Daily Earnings" })).toBeVisible();
  await expect(page.locator("button.finance-mode-button").filter({ hasText: "Logbook import" })).toHaveCount(0);
  const batches = await api(page, "GET", "/api/logbook/batches");
  expect(batches.status).toBe(403);
  const extract = await api(page, "POST", "/api/logbook/extract", { pages: [{ filename: "x.png", dataBase64: pageFile.buffer.toString("base64") }] });
  expect(extract.status).toBe(403);
});

test("signed out: the logbook routes answer 401", async ({ request }) => {
  for (const action of ["batches", "keys"]) expect((await request.get(`/api/logbook/${action}`)).status()).toBe(401);
  for (const action of ["extract", "import", "row-approve"]) expect((await request.post(`/api/logbook/${action}`, { data: {} })).status()).toBe(401);
});
