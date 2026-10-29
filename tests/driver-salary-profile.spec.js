import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "./user-guide-helpers.mjs";

// Salary settings in the driver profile (mock backend): create and edit a driver
// with an optional salary, the existing arrangement and its history are shown,
// saving never records a payment, Money links both ways, the complete
// profile -> payment -> report flow, and who may see salary settings.

const PASSWORD = "TaxiFlow.123";
const moduleButton = (page, label) => page.locator("button.module-button").filter({ hasText: label });
const isoToday = () => new Date().toLocaleDateString("en-CA");

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};
const signOut = async (page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
};

const openDrivers = async (page) => {
  await moduleButton(page, "Drivers").first().click();
  await expect(page.getByTestId("driver-profile-form")).toBeVisible();
};
const openSalaries = async (page) => {
  await moduleButton(page, "Money").first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Expenses" }).click();
  const panel = page.getByTestId("driver-salaries");
  await expect(panel.getByRole("heading", { name: "Driver salaries" })).toBeVisible();
  return panel;
};
const salaryExpenseCount = async (page) => {
  const panel = await openSalaries(page);
  return panel.getByTestId("salary-payment-row").count();
};

const createDriverWithSalary = async (page, name, { amount, frequency = "monthly", start, timing = "end" }) => {
  await openDrivers(page);
  const form = page.getByTestId("driver-profile-form");
  await form.getByRole("button", { name: "Add driver" }).click();
  await form.getByLabel("Full name").fill(name);
  const salary = form.getByTestId("driver-profile-salary");
  await salary.getByTestId("driver-profile-salary-enable").check();
  await salary.getByLabel("Salary amount (R)").fill(String(amount));
  await salary.getByLabel("How often").selectOption(frequency);
  await salary.getByLabel("Salary starts on").fill(start);
  await salary.getByLabel("When it is paid").selectOption(timing);
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`${name} added to the driver roster. Salary schedule saved for ${name}. No expense was added.`)).toBeVisible();
};

test("create a driver with a salary, then edit: the existing arrangement and history are shown; no payment is recorded", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "owner@taxiflow.local");
  const paymentsBefore = await salaryExpenseCount(page);
  const month = isoToday().slice(0, 7);

  await createDriverWithSalary(page, "Profile Test Driver", { amount: 5200, start: `${month}-01` });
  expect(await salaryExpenseCount(page)).toBe(paymentsBefore);
  const panel = page.getByTestId("driver-salaries");
  await expect(panel.getByTestId("salary-schedule-row").filter({ hasText: "Profile Test Driver" })).toContainText("R 5");

  // Money -> "Salary settings" opens that driver's profile at its salary.
  await panel.getByRole("button", { name: "Salary settings in Profile Test Driver's profile" }).click();
  const form = page.getByTestId("driver-profile-form");
  await expect(form.getByRole("heading", { name: "Edit driver: Profile Test Driver" })).toBeVisible();
  const salary = form.getByTestId("driver-profile-salary");
  await expect(salary.getByTestId("driver-profile-salary-current")).toContainText("monthly, at the end of each period");
  await expect(salary.getByTestId("driver-profile-salary-current")).toContainText("Active");
  await expect(salary.getByLabel("Salary amount (R)")).toHaveValue("5200");

  // Change the amount from a later date, and pause.
  const later = `${month}-15`;
  await salary.getByLabel("Salary amount (R)").fill("5500");
  await salary.getByLabel("Changes apply from").fill(later);
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText("Profile Test Driver updated in the driver roster. Salary schedule saved for Profile Test Driver. No expense was added.")).toBeVisible();
  await page.getByRole("button", { name: "Edit profile: Profile Test Driver" }).click();
  await salary.locator("summary").click();
  const history = (await salary.getByTestId("driver-profile-salary-history").locator("li").allInnerTexts()).map((line) => line.replace(/\s+/g, " "));
  expect(history).toEqual([`From ${later}: R 5 500,00 monthly`, `From ${month}-01: R 5 200,00 monthly`]);
  await salary.getByLabel("Status").selectOption("paused");
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(/Salary schedule saved for Profile Test Driver/)).toBeVisible();

  const after = await openSalaries(page);
  await expect(after.getByTestId("salary-schedule-row").filter({ hasText: "Profile Test Driver" })).toContainText("paused");
  expect(await after.getByTestId("salary-payment-row").count()).toBe(paymentsBefore);

  // Profile -> "Record or review salary payments in Money" lands on the salary payments.
  await openDrivers(page);
  await page.getByRole("button", { name: "Edit profile: Profile Test Driver" }).click();
  await page.getByTestId("driver-profile-salary-payments").click();
  await expect(page.getByTestId("driver-salaries").getByRole("heading", { name: "Driver salaries" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("profile -> payment -> expense report: one salary, recorded in Money, listed once", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  const month = isoToday().slice(0, 7);
  await createDriverWithSalary(page, "Flow Driver", { amount: 4100, start: `${month}-01` });

  const panel = await openSalaries(page);
  const row = panel.getByTestId("salary-schedule-row").filter({ hasText: "Flow Driver" });
  await row.getByRole("button", { name: "Record payment" }).click();
  const paymentForm = page.getByRole("form", { name: "Record salary payment" });
  await expect(paymentForm.getByLabel("Amount paid (R)")).toHaveValue("4100");
  await paymentForm.getByRole("button", { name: "Record payment" }).click();
  await expect(panel.getByText("Salary payment recorded for Flow Driver and added to expenses once.")).toBeVisible();
  // Duplicate protection is unchanged.
  await row.getByRole("button", { name: "Record payment" }).click();
  await paymentForm.getByLabel("Pay month").fill(month);
  await expect(paymentForm.getByTestId("salary-duplicate-warning")).toContainText("Already recorded");
  await paymentForm.getByRole("button", { name: "Cancel" }).click();

  // The month's expense report (built in the browser from the same records)
  // lists the salary once. Reports > Business report reads the server copy, so
  // that step is proven in tenant mode (localdb-browser/driver-salary-profile-tenant.spec.js);
  // demo-mode Reports use the fixed demo data.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download expense report (CSV)" }).click();
  const csv = await readFile(await (await downloadPromise).path(), "utf8");
  expect(csv.split(/\r?\n/).filter((line) => line.includes("Driver salary / Flow Driver /"))).toHaveLength(1);
  expect(csv).toContain("Reconciles,yes");
});

test("a Manager with driver-profile management but Money off edits profiles without seeing any salary settings", async ({ page }) => {
  // Owner switches the Manager's Money off (Drivers stays on).
  await signIn(page, "owner@taxiflow.local");
  await moduleButton(page, "Settings").first().click();
  await page.locator("article.person-row").filter({ hasText: "manager@taxiflow.local" }).getByRole("button", { name: "Manage" }).click();
  const accessForm = page.locator("form.finance-form").filter({ has: page.getByRole("button", { name: "Save access" }) });
  await accessForm.getByRole("button", { name: "Money", exact: true }).click();
  await accessForm.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(/updated as Manager\./i)).toBeVisible();
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  await openDrivers(page);
  await page.getByRole("button", { name: "Edit profile: Sizwe Mokoena" }).click();
  await expect(page.getByTestId("driver-profile-form").getByLabel("Full name")).toBeEnabled();
  await expect(page.getByTestId("driver-profile-salary")).toHaveCount(0);
  await expect(page.getByText("Record or review salary payments in Money")).toHaveCount(0);
});

test("a Driver has no salary settings and no profile editing", async ({ page }) => {
  await signIn(page, "driver.one@taxiflow.local");
  await expect(moduleButton(page, "Money")).toHaveCount(0);
  await expect(page.getByTestId("driver-profile-salary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Edit profile:|Salary settings/ })).toHaveCount(0);
});
