import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "./user-guide-helpers.mjs";

// Recurring fixed expenses in the demo app: schedule -> overdue/due shown ->
// record payment (prefilled) -> refresh -> business and vehicle reports, CSV
// and PDF; pause, resume and stop keep recorded payments.

const PASSWORD = "TaxiFlow.123";
const moduleButton = (page, label) => page.locator("button.module-button").filter({ hasText: label });
const iso = (date) => date.toLocaleDateString("en-CA");
const TODAY = iso(new Date());
const START = iso(new Date(Date.now() - 62 * 86_400_000)); // about two months ago: missed periods

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};
const openRecurring = async (page) => {
  await moduleButton(page, "Money").first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const panel = page.getByTestId("recurring-expenses");
  await expect(panel.getByRole("heading", { name: "Recurring fixed expenses" })).toBeVisible();
  return panel;
};
const addSchedule = async (page, panel, { description, category, amount, vehicle = null, start = START }) => {
  await panel.getByRole("button", { name: "Add recurring expense" }).click();
  const form = page.getByRole("form", { name: "Recurring expense schedule" });
  await form.getByLabel("Description").fill(description);
  await form.getByLabel("Category").fill(category);
  await form.getByLabel("Amount (R)").fill(String(amount));
  if (vehicle) await form.getByLabel("Applies to").selectOption({ label: vehicle });
  await form.getByLabel("How often").selectOption("monthly");
  await form.getByLabel("First due date").fill(start);
  await form.getByRole("button", { name: "Save schedule" }).click();
  await expect(panel.getByTestId("recurring-feedback")).toContainText(`Recurring expense saved: ${description}. No expense was added.`);
};
const download = async (page, testId) => {
  const promise = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  return readFile(await (await promise).path());
};
const pdfText = (buffer) =>
  (buffer.toString("latin1").match(/<[0-9a-fA-F]+>/g) ?? []).map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1")).join("").replace(/\s+/g, "");

test("schedule -> overdue -> record payment -> refresh -> business and vehicle reports with commitments, CSV and PDF", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "owner@taxiflow.local");
  let panel = await openRecurring(page);
  await addSchedule(page, panel, { description: "Office rent", category: "Rent", amount: 1500 });
  await addSchedule(page, panel, { description: "Tracker JHB 457", category: "Tracking", amount: 199, vehicle: "JHB 457 GP" });

  const rent = panel.getByTestId("recurring-row").filter({ hasText: "Office rent" });
  await expect(rent.getByTestId("recurring-status")).toHaveText("Active");
  await expect(rent.getByTestId("recurring-overdue")).toBeVisible();
  const firstOverdue = rent.locator('[data-testid="recurring-occurrence"][data-status="overdue"]').first();
  await expect(firstOverdue).toContainText(START);

  // Record payment: the form is prefilled from the occurrence.
  await firstOverdue.getByRole("button", { name: "Record payment" }).click();
  const paymentForm = page.getByRole("form", { name: "Record recurring expense payment" });
  await expect(paymentForm.getByLabel("Amount paid (R)")).toHaveValue("1500");
  await expect(paymentForm.getByLabel("Date paid")).toHaveValue(TODAY);
  await expect(paymentForm.getByLabel("Bank transfer or card")).toBeChecked();
  await paymentForm.getByRole("button", { name: "Record payment" }).click();
  await expect(panel.getByTestId("recurring-feedback")).toContainText("added to expenses once");
  const paidRow = rent.locator('[data-testid="recurring-occurrence"][data-status="paid"]');
  await expect(paidRow).toHaveCount(1);
  await expect(paidRow.getByRole("button", { name: "Record payment" })).toHaveCount(0);

  // Refresh: the schedule and the one payment are still there.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  panel = await openRecurring(page);
  await expect(panel.getByTestId("recurring-row").filter({ hasText: "Office rent" }).locator('[data-status="paid"]')).toHaveCount(1);

  // Business report for the schedule's dates: one expense line, commitments apart.
  await moduleButton(page, "Reports").first().click();
  await page.getByTestId("period-report-period").selectOption("custom");
  await page.getByTestId("period-report-start").fill(START);
  await page.getByTestId("period-report-end").fill(TODAY);
  await page.getByTestId("period-report-view").click();
  const transactions = page.getByTestId("period-report-transactions");
  await expect(transactions.locator("tr").filter({ hasText: "Office rent /" })).toHaveCount(1);
  const commitments = page.getByTestId("period-report-commitments");
  await expect(commitments.locator("tr").filter({ hasText: "Office rent" }).filter({ hasText: "Paid" })).toHaveCount(1);
  await expect(commitments.locator("tr").filter({ hasText: "Office rent" }).filter({ hasText: "Overdue" }).first()).toBeVisible();
  await expect(page.getByTestId("period-report-unallocated-table")).toContainText("Rent");
  await expect(page.getByTestId("period-report-notes")).toContainText("Totals reconcile with the lines.");

  const csv = (await download(page, "period-report-download-csv")).toString("utf8").split(/\r?\n/);
  expect(csv.filter((row) => row.includes("Office rent /") && row.includes(",Expense,"))).toHaveLength(1);
  expect(csv.some((row) => row.startsWith("Scheduled commitments (not expenses; not in any total)"))).toBe(true);
  expect(csv).toContain("Reconciles,yes");
  const pdf = pdfText(await download(page, "period-report-download-pdf"));
  expect(pdf).toContain("SCHEDULEDCOMMITMENTS(NOTEXPENSES");
  expect(pdf).toContain("Officerent");

  // Vehicle report: only the vehicle's own schedule; the business-wide rent stays out.
  await page.getByText("Individual vehicle").click();
  await page.getByTestId("period-report-vehicle").selectOption({ label: "JHB 457 GP" });
  await page.getByTestId("period-report-view").click();
  await expect(page.getByTestId("period-report-selection")).toContainText("Vehicle report: JHB 457 GP");
  await expect(page.getByTestId("period-report-commitments")).toContainText("Tracker JHB 457");
  await expect(page.getByTestId("period-report-commitments")).not.toContainText("Office rent");
  await expect(page.getByTestId("period-report-transactions")).not.toContainText("Office rent");
  expect(errors).toEqual([]);
});

test("pause, resume and stop: status shown clearly; stopping keeps the recorded payment", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  const panel = await openRecurring(page);
  await addSchedule(page, panel, { description: "Insurance", category: "Insurance", amount: 800 });
  const row = panel.getByTestId("recurring-row").filter({ hasText: "Insurance" });
  await row.locator('[data-status="overdue"]').first().getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("form", { name: "Record recurring expense payment" }).getByRole("button", { name: "Record payment" }).click();
  await expect(panel.getByTestId("recurring-feedback")).toContainText("added to expenses once");

  await row.getByRole("button", { name: "Pause" }).click();
  await expect(row.getByTestId("recurring-status")).toHaveText("Paused");
  await expect(row.getByTestId("recurring-next")).toContainText("Paused");
  await row.getByRole("button", { name: "Resume" }).click();
  await expect(row.getByTestId("recurring-status")).toHaveText("Active");
  await row.getByRole("button", { name: "Stop" }).click();
  await row.getByRole("group", { name: "Stop Insurance" }).getByRole("button", { name: "Stop schedule" }).click();
  await expect(row.getByTestId("recurring-status")).toHaveText("Stopped");
  await expect(row.locator('[data-status="paid"]')).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Pause" })).toHaveCount(0);
});

test("Drivers never see recurring expenses", async ({ page }) => {
  await signIn(page, "driver.one@taxiflow.local");
  await expect(moduleButton(page, "Money")).toHaveCount(0);
  await expect(page.getByTestId("recurring-expenses")).toHaveCount(0);
});
