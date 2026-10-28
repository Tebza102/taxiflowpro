import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "./user-guide-helpers.mjs";

// Driver salaries in Money > Expenses (mock backend): a schedule adds no expense,
// a payment adds exactly one, duplicates are blocked, bank salary leaves the
// driver's cash hand-in alone, and the downloaded report reconciles.

const PASSWORD = "TaxiFlow.123";
const DRIVER_NAME = "Sizwe Mokoena";

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const openSalaries = async (page) => {
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const panel = page.getByTestId("driver-salaries");
  await expect(panel.getByRole("heading", { name: "Driver salaries" })).toBeVisible();
  return panel;
};

const reportTotal = async (page) =>
  // en-ZA format: "R 6 500,00" (space thousands, comma decimals).
  Number((await page.getByTestId("expense-report-total").textContent()).replace(/[^\d,]/g, "").replace(",", "."));

const driverExpectedCash = async (page) => {
  const board = page.locator("article.overview-board").filter({ has: page.getByRole("heading", { name: "Day cash activity" }) }).first();
  return board.locator(".status-chip").filter({ hasText: "expected cash in" }).first().textContent();
};

test("schedule adds no expense; payment adds one; duplicate blocked; report reconciles; driver hand-in unchanged", async ({
  page,
}) => {
  await signIn(page, "driver.one@taxiflow.local");
  await page.locator("button.module-button").filter({ hasText: "Overview" }).first().click();
  const driverCashBefore = await driverExpectedCash(page);
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, "owner@taxiflow.local");
  const panel = await openSalaries(page);
  const totalBefore = await reportTotal(page);

  // 1. Schedule only.
  const scheduleForm = page.getByRole("form", { name: "Salary schedule" });
  await scheduleForm.getByLabel("Driver").selectOption({ label: DRIVER_NAME });
  await scheduleForm.getByLabel("Salary amount (R)").fill("6500");
  await scheduleForm.getByLabel("Usually paid by").selectOption("bank");
  await scheduleForm.getByLabel("Starts on").fill("2026-01-01");
  await scheduleForm.getByRole("button", { name: "Save schedule" }).click();
  await expect(panel.getByText(`Salary schedule saved for ${DRIVER_NAME}. No expense was added.`)).toBeVisible();
  const row = panel.getByTestId("salary-schedule-row").filter({ hasText: DRIVER_NAME });
  await expect(row).toContainText("not paid yet");
  expect(await reportTotal(page)).toBe(totalBefore);

  // 2. Record the payment (by bank).
  await row.getByRole("button", { name: "Record payment" }).click();
  const paymentForm = page.getByRole("form", { name: "Record salary payment" });
  await expect(paymentForm.getByLabel("Amount paid (R)")).toHaveValue("6500");
  await paymentForm.getByLabel("Bank transfer").check();
  await paymentForm.getByRole("button", { name: "Record payment" }).click();
  await expect(panel.getByText(`Salary payment recorded for ${DRIVER_NAME} and added to expenses once.`)).toBeVisible();
  await expect(row).toContainText(": paid");
  await expect(panel.getByTestId("salary-payment-row").filter({ hasText: DRIVER_NAME })).toContainText("R 6");
  expect(await reportTotal(page)).toBeCloseTo(totalBefore + 6500, 2);

  // 3. Same period again: blocked with an explanation.
  await row.getByRole("button", { name: "Record payment" }).click();
  await expect(paymentForm.getByTestId("salary-duplicate-warning")).toContainText("Already recorded");
  await expect(paymentForm.getByRole("button", { name: "Record payment" })).toBeDisabled();
  await paymentForm.getByRole("button", { name: "Cancel" }).click();
  expect(await reportTotal(page)).toBeCloseTo(totalBefore + 6500, 2);

  // 4. Downloaded report itemises the salary and reconciles.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download expense report (CSV)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^taxiflow-expenses-\d{4}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain(`Driver salary / ${DRIVER_NAME} /`);
  expect(csv).toMatch(/Driver salaries,.*1 payments,6500\.00/);
  expect(csv).toContain("Reconciles,yes");
  const totalLine = csv.split("\r\n").find((line) => line.startsWith("Total expenses"));
  expect(Number(totalLine.split(",").at(-1))).toBeCloseTo(totalBefore + 6500, 2);

  // 5. The schedule cannot be used to edit history; the driver's hand-in is unchanged.
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "driver.one@taxiflow.local");
  await page.locator("button.module-button").filter({ hasText: "Overview" }).first().click();
  expect(await driverExpectedCash(page)).toBe(driverCashBefore);
  await expect(page.getByText("Driver salary /")).toHaveCount(0);
});

test("salary section follows Money access: driver never sees it", async ({ page }) => {
  await signIn(page, "driver.one@taxiflow.local");
  await expect(page.locator("button.module-button").filter({ hasText: "Money" })).toHaveCount(0);
  await expect(page.getByTestId("driver-salaries")).toHaveCount(0);
});
