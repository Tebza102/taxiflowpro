import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "./user-guide-helpers.mjs";

// Reports > Business and vehicle reports (demo data). The screen, the CSV and
// the PDF come from one server report for the filters last applied.

const PASSWORD = "TaxiFlow.123";
const moduleButton = (page, label) => page.locator("button.module-button").filter({ hasText: label });

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const openPeriodReports = async (page) => {
  await moduleButton(page, "Reports").first().click();
  await expect(page.getByRole("heading", { name: "Business and vehicle reports" })).toBeVisible();
};

const viewReport = async (page) => {
  await page.getByTestId("period-report-view").click();
  await expect(page.getByTestId("period-report-result")).toBeVisible({ timeout: 30_000 });
};

const download = async (page, format) => {
  const promise = page.waitForEvent("download");
  await page.getByTestId(`period-report-download-${format}`).click();
  const file = await promise;
  return { filename: file.suggestedFilename(), buffer: await readFile(await file.path()) };
};

const pdfText = (buffer) =>
  (buffer.toString("latin1").match(/<[0-9a-fA-F]+>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1"))
    .join("")
    .replace(/\s+/g, "");

const csvValue = (csv, label) => Number(csv.split("\r\n").find((row) => row.startsWith(`${label},`)).split(",").at(-1));
const randOnScreen = async (page, testId) => {
  const value = (await page.getByTestId(testId).locator("strong").innerText()).replace(/[^\d,-]/g, "").replace(",", ".");
  return Number(value);
};

test("owner: monthly business report shows scope and dates; screen, CSV and PDF agree", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "owner@taxiflow.local");
  await openPeriodReports(page);

  await expect(page.getByRole("radio", { name: "Overall business" })).toBeChecked();
  await page.getByTestId("period-report-period").selectOption("monthly");
  await page.getByTestId("period-report-month").fill("2026-03");
  await viewReport(page);

  await expect(page.getByTestId("period-report-selection")).toContainText("Business report: Overall business");
  await expect(page.getByTestId("period-report-dates")).toHaveText("Mar 2026 (1 Mar 2026 to 31 Mar 2026)");
  await expect(page.getByTestId("period-report-net")).toContainText("Net result (recorded income less recorded expenses)");
  await expect(page.getByTestId("period-report-net")).not.toContainText(/profit/i);
  await expect(page.getByTestId("period-report-unallocated-table")).toContainText("Rank Fees");
  await expect(page.getByTestId("period-report-notes")).toContainText("not accounting profit");
  await expect(page.getByTestId("period-report-notes")).toContainText("Totals reconcile with the lines.");

  const income = await randOnScreen(page, "period-report-income");
  const expenses = await randOnScreen(page, "period-report-expenses");
  const net = await randOnScreen(page, "period-report-net");
  const unallocated = await randOnScreen(page, "period-report-unallocated");

  const csv = await download(page, "csv");
  expect(csv.filename).toBe("taxiflow-business-2026-03-01-to-2026-03-31.csv");
  const text = csv.buffer.toString("utf8");
  expect(csvValue(text, "Income")).toBe(income);
  expect(csvValue(text, "Expenses")).toBe(expenses);
  expect(csvValue(text, "  Business costs without a vehicle")).toBe(unallocated);
  expect(csvValue(text, "Net result (recorded income less recorded expenses)")).toBe(net);
  expect(text).toContain("Period,Monthly: Mar 2026 (1 Mar 2026 to 31 Mar 2026)");
  expect(text).toContain("Reconciles,yes");

  const pdf = await download(page, "pdf");
  expect(pdf.filename).toBe("taxiflow-business-2026-03-01-to-2026-03-31.pdf");
  expect(pdf.buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const pdfBody = pdfText(pdf.buffer);
  expect(pdfBody).toContain("DEMODATA");
  expect(pdfBody).toContain("1Mar2026to31Mar2026");
  const netText = (await page.getByTestId("period-report-net").locator("strong").innerText()).replace(/\s+/g, "");
  expect(pdfBody).toContain(netText); // same en-ZA amount as the screen
  await expect(page.getByTestId("period-report-download-done")).toContainText(pdf.filename);
  expect(errors).toEqual([]);
});

test("vehicle report: one vehicle's own entries only; the business cost without a vehicle is not in it", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openPeriodReports(page);
  await page.getByText("Individual vehicle").click();
  await page.getByTestId("period-report-vehicle").selectOption({ label: "JHB 457 GP" });
  await page.getByTestId("period-report-period").selectOption("weekly");
  await page.getByTestId("period-report-date").fill("2026-03-27");
  await viewReport(page);

  await expect(page.getByTestId("period-report-selection")).toContainText("Vehicle report: JHB 457 GP");
  await expect(page.getByTestId("period-report-dates")).toHaveText("23 Mar 2026 to 29 Mar 2026");
  await expect(page.getByTestId("period-report-vehicle-details")).toContainText("Sizwe Mokoena");
  const transactions = page.getByTestId("period-report-transactions");
  await expect(transactions).not.toContainText("No vehicle");
  await expect(transactions).not.toContainText("Rank Fees");
  await expect(transactions).not.toContainText("JHB 931 GP");
  await expect(page.getByTestId("period-report-notes")).toContainText("not allocated to vehicles");

  const csv = (await download(page, "csv")).buffer.toString("utf8");
  expect(csv).toContain("Scope,JHB 457 GP");
  expect(csv).not.toContain("Rank Fees");
  expect(csvValue(csv, "Vehicle net result (its recorded income less its own expenses)")).toBe(await randOnScreen(page, "period-report-net"));
});

test("custom dates: reversed range is prevented; changed filters warn that downloads match the report shown", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openPeriodReports(page);
  await page.getByTestId("period-report-period").selectOption("custom");
  await page.getByTestId("period-report-start").fill("2026-03-27");
  await page.getByTestId("period-report-end").fill("2026-03-27");
  await viewReport(page);
  await expect(page.getByTestId("period-report-dates")).toHaveText("27 Mar 2026 to 27 Mar 2026");

  await page.getByTestId("period-report-end").fill("2026-03-28");
  await expect(page.getByTestId("period-report-stale")).toBeVisible();
  const csv = (await download(page, "csv")).buffer.toString("utf8");
  expect(csv).toContain("To,2026-03-27");

  // A reversed range is refused by the server with a clear message.
  const response = await page.request.get("/api/admin/reports/period?mode=mock&period=custom&start=2026-03-28&end=2026-03-01");
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("start date");
});

test("manager and admin can generate reports; driver and viewer have no Reports", async ({ page }) => {
  for (const email of ["manager@taxiflow.local", "admin@taxiflow.local"]) {
    await signIn(page, email);
    await openPeriodReports(page);
    await viewReport(page);
    await expect(page.getByTestId("period-report-summary")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  }
  for (const email of ["driver.one@taxiflow.local", "viewer@taxiflow.local"]) {
    await signIn(page, email);
    await expect(moduleButton(page, "Reports")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  }
});

test("the daily cash report is still there and explains its narrower purpose", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openPeriodReports(page);
  await expect(page.getByRole("heading", { name: "Daily cash report" })).toBeVisible();
  await expect(page.getByText("covers a single cash-up: one vehicle or driver on one day")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Report" })).toHaveValue("daily-finance");
});

test("the period report endpoint refuses a live request without a session in every format", async ({ request }) => {
  for (const format of ["json", "csv", "pdf"]) {
    const response = await request.get(`/api/admin/reports/period?mode=live&scope=business&period=monthly&month=2026-03&format=${format}`);
    expect(response.status()).toBe(401);
  }
});

test("phone width: no sideways page scroll and the report actions are thumb-sized", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await signIn(page, "owner@taxiflow.local");
  await openPeriodReports(page);
  await viewReport(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const id of ["period-report-view", "period-report-download-pdf", "period-report-download-csv"]) {
    expect((await page.getByTestId(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});
