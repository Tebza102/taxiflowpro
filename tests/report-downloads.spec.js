import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "./user-guide-helpers.mjs";

// Report downloads on a phone-sized screen (demo data): business, vehicle and
// daily PDFs are complete, readable files; the screen says the file is ready
// (never claims it was saved) and offers Open PDF; a failed or unreadable
// response shows the reason and Try again, which then succeeds.

const PASSWORD = "TaxiFlow.123";
const PERIOD_PDF = "**/api/admin/reports/period?*format=pdf*";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const openReportsFromMenu = async (page) => {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByTestId("mobile-nav-drawer").getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Business and vehicle reports" })).toBeVisible();
};

const viewMarch = async (page) => {
  await page.getByTestId("period-report-period").selectOption("monthly");
  await page.getByTestId("period-report-month").fill("2026-03");
  await page.getByTestId("period-report-view").click();
  await expect(page.getByTestId("period-report-result")).toBeVisible({ timeout: 30_000 });
};

const save = async (page, testId) => {
  const promise = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const file = await promise;
  return { filename: file.suggestedFilename(), buffer: await readFile(await file.path()) };
};

// Complete and readable: header, at least one page, cross-reference table and
// end-of-file marker.
const expectReadablePdf = (buffer) => {
  const text = buffer.toString("latin1");
  expect(text.slice(0, 5)).toBe("%PDF-");
  expect(text).toMatch(/\/Type \/Page\b/);
  expect(text).toMatch(/startxref\s+\d+\s+%%EOF\s*$/);
};

test("business and vehicle PDFs: complete files, ready message with Open PDF, selection preserved", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "owner@taxiflow.local");
  await openReportsFromMenu(page);
  await viewMarch(page);

  const business = await save(page, "period-report-download-pdf");
  expect(business.filename).toBe("taxiflow-business-2026-03-01-to-2026-03-31.pdf");
  expectReadablePdf(business.buffer);
  const done = page.getByTestId("period-report-download-done");
  await expect(done).toContainText("PDF ready");
  await expect(done).toContainText(business.filename);
  await expect(done).not.toContainText("Downloaded");
  const open = page.getByTestId("period-report-download-open");
  await expect(open).toHaveText("Open PDF");
  await expect(open).toHaveAttribute("href", /^blob:/);
  await expect(open).toHaveAttribute("download", business.filename);
  expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);

  // Tapping Open PDF hands over the same file again.
  const again = await save(page, "period-report-download-open");
  expect(again.buffer.equals(business.buffer)).toBe(true);

  await page.getByText("Individual vehicle").click();
  await page.getByTestId("period-report-vehicle").selectOption({ label: "JHB 457 GP" });
  await page.getByTestId("period-report-view").click();
  await expect(page.getByTestId("period-report-selection")).toContainText("Vehicle report: JHB 457 GP");
  const vehicle = await save(page, "period-report-download-pdf");
  expect(vehicle.filename).toMatch(/^taxiflow-vehicle-.+-2026-03-01-to-2026-03-31\.pdf$/);
  expectReadablePdf(vehicle.buffer);
  await expect(page.getByTestId("period-report-dates")).toHaveText("Mar 2026 (1 Mar 2026 to 31 Mar 2026)");
  expect(errors).toEqual([]);
});

test("a failed PDF request shows the reason and Try again, which then saves a readable PDF", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openReportsFromMenu(page);
  await viewMarch(page);

  await page.route(PERIOD_PDF, (route) => route.abort("connectionreset"));
  await page.getByTestId("period-report-download-pdf").click();
  const error = page.getByTestId("period-report-download-error");
  await expect(error).toContainText("could not be prepared");
  await expect(page.getByTestId("period-report-download-done")).toHaveCount(0);

  await page.unroute(PERIOD_PDF);
  const retried = await save(page, "period-report-download-retry");
  expectReadablePdf(retried.buffer);
  await expect(page.getByTestId("period-report-download-done")).toContainText(retried.filename);
  await expect(error).toHaveCount(0);
});

test("an unreadable response is not saved as a PDF", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openReportsFromMenu(page);
  await viewMarch(page);

  let downloads = 0;
  page.on("download", () => (downloads += 1));
  await page.route(PERIOD_PDF, (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: "<html>proxy error</html>" }));
  await page.getByTestId("period-report-download-pdf").click();
  await expect(page.getByTestId("period-report-download-error")).toContainText("incomplete or unreadable");
  expect(downloads).toBe(0);
});

test("daily finance PDF on a phone: readable file, ready message, retry after a failure", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openReportsFromMenu(page);
  await expect(page.getByTestId("reports-preview").getByText("Expected cash hand-in")).toBeVisible({ timeout: 30_000 });

  await page.route("**/report-pdf?*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.getByTestId("reports-download").click();
  await expect(page.getByTestId("reports-download-error")).toContainText("could not be prepared");

  await page.unroute("**/report-pdf?*");
  const daily = await save(page, "reports-download-retry");
  expect(daily.filename).toMatch(/^taxiflow-daily-finance-.+\.pdf$/);
  expectReadablePdf(daily.buffer);
  await expect(page.getByTestId("reports-download-done")).toContainText("PDF ready");
  await expect(page.getByTestId("reports-download-open")).toHaveAttribute("href", /^blob:/);
});
