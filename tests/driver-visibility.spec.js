import { expect, test } from "@playwright/test";

const PASSWORD = "TaxiFlow.123";
const DAILY_DATE = "2026-04-03";
const DAILY_DATE_LABEL = "03 Apr 2026";
const ROUTE_TEXT = "JHB 457 GP / Noord to Alexandra";
const PASSENGER_SUMMARY = "21 passengers";
const TRIP_SUMMARY = "2 trips";
const AMOUNT_SUMMARY = "R 920";
const RECORD_SUMMARY = `Daily trip / ${DAILY_DATE_LABEL} / In 06:00 / Out 10:00 / ${TRIP_SUMMARY} / ${PASSENGER_SUMMARY}`;
const ENTRY_AMOUNT = 920;

const managementAccounts = [
  { email: "owner@taxiflow.local", role: "Owner" },
  { email: "manager@taxiflow.local", role: "Manager" },
  { email: "admin@taxiflow.local", role: "Admin" },
];

test.beforeEach(async ({ page }) => {
  page.on("console", (message) => {
    console.log(`[browser:${message.type()}] ${message.text()}`);
  });

  page.on("pageerror", (error) => {
    console.log(`[pageerror] ${error.message}`);
  });
});

const signIn = async (page, email) => {
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

const moduleButton = (page, label) =>
  page.locator("button.module-button").filter({ hasText: label }).first();

const openMoneyModule = async (page) => {
  await moduleButton(page, "Money").click();
  await expect(page.getByRole("heading", { name: "Daily trip entry" })).toBeVisible();
};

const openSettingsModule = async (page) => {
  await moduleButton(page, "Settings").click();
  await expect(page.getByRole("heading", { name: "Roles and rights" })).toBeVisible();
};

const grantOwnerModules = async (page, email, modules) => {
  await signIn(page, "owner@taxiflow.local");
  await openSettingsModule(page);

  const userRow = page.locator("article.person-row").filter({
    hasText: email,
  });
  await userRow.getByRole("button", { name: "Manage" }).click();

  const accessForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save access" }),
  });

  for (const moduleLabel of modules) {
    await accessForm.getByRole("button", { name: moduleLabel }).click();
  }

  await accessForm.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(/updated as/i)).toBeVisible();
  await signOut(page);
};

const openBankingModule = async (page) => {
  await openMoneyModule(page);
  await page
    .locator("button.finance-mode-button")
    .filter({ hasText: "Banking" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Admin hand-in and manager verification" }),
  ).toBeVisible();
};

const readOverviewDailyTotal = async (page) => {
  const totalCard = page.locator("article.insight-card").filter({
    hasText: "Daily total entered",
  });

  await expect(totalCard).toBeVisible();
  const amountText = await totalCard.locator("strong").first().textContent();
  return Number(String(amountText ?? "").replace(/[^\d-]/g, ""));
};

const assertPendingDailyTripVisible = async (page) => {
  const recentIncomePanel = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Waiting, handed in, checked, and deposited" }),
  });
  const record = recentIncomePanel.locator("article").filter({
    hasText: RECORD_SUMMARY,
  });

  await expect(record).toContainText(ROUTE_TEXT);
  await expect(record).toContainText(RECORD_SUMMARY);
  await expect(record).toContainText("Waiting hand-in");
  await expect(record).toContainText(AMOUNT_SUMMARY);
};

test("driver daily trip update is visible to owner, manager, and admin", async ({ page }) => {
  await signIn(page, "driver.one@taxiflow.local");

  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add daily earnings" })).toBeVisible();

  await page.getByLabel("Date").fill(DAILY_DATE);
  await page.getByLabel("Time in").fill("06:00");
  await page.getByLabel("Time out").fill("10:00");
  await page.getByLabel("Opening odo").fill("384120");
  await page.getByLabel("Closing odo").fill("384200");
  const driverActionPanel = page.locator(".driver-action-panel");
  await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).first().fill("12");
  await driverActionPanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .first()
    .fill("500");
  await page.getByRole("button", { name: "Add passenger trip" }).click();
  await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).nth(1).fill("9");
  await driverActionPanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .nth(1)
    .fill("420");
  await page.getByRole("button", { name: "Save trip" }).click();

  await expect(
    page.getByText("Trip saved, added to the daily total, and waiting for admin cash hand-in."),
  ).toBeVisible();
  await signOut(page);

  await grantOwnerModules(page, "manager@taxiflow.local", ["Money"]);
  await grantOwnerModules(page, "admin@taxiflow.local", ["Money"]);

  for (const account of managementAccounts) {
    await signIn(page, account.email);
    await expect(page.getByText(account.role).first()).toBeVisible();
    await openMoneyModule(page);
    await assertPendingDailyTripVisible(page);
    await signOut(page);
  }
});

test("admin records cash hand-in, manager verifies it, and the dashboard total increases", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");
  const baselineDailyTotal = await readOverviewDailyTotal(page);
  await signOut(page);

  await signIn(page, "driver.one@taxiflow.local");
  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add daily earnings" })).toBeVisible();

  await page.getByLabel("Date").fill(DAILY_DATE);
  await page.getByLabel("Time in").fill("06:00");
  await page.getByLabel("Time out").fill("10:00");
  await page.getByLabel("Opening odo").fill("384120");
  await page.getByLabel("Closing odo").fill("384200");
  const driverActionPanel = page.locator(".driver-action-panel");
  await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).first().fill("12");
  await driverActionPanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .first()
    .fill("500");
  await page.getByRole("button", { name: "Add passenger trip" }).click();
  await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).nth(1).fill("9");
  await driverActionPanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .nth(1)
    .fill("420");
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(
    page.getByText("Trip saved, added to the daily total, and waiting for admin cash hand-in."),
  ).toBeVisible();
  await signOut(page);

  await grantOwnerModules(page, "manager@taxiflow.local", ["Money"]);
  await grantOwnerModules(page, "admin@taxiflow.local", ["Money"]);

  await signIn(page, "admin@taxiflow.local");
  await openBankingModule(page);
  const adminQueueCard = page.locator("article.queue-card").filter({
    hasText: RECORD_SUMMARY,
  });
  await expect(adminQueueCard).toContainText("Waiting for admin hand-in");
  await adminQueueCard.getByPlaceholder("Cash handed in").fill(String(ENTRY_AMOUNT));
  await adminQueueCard.getByRole("button", { name: "Record hand-in" }).click();
  await expect(
    page.getByText("Cash hand-in recorded and waiting for manager verification."),
  ).toBeVisible();
  await expect(adminQueueCard).toContainText("Waiting for manager check");
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  await openBankingModule(page);
  const managerQueueCard = page.locator("article.queue-card").filter({
    hasText: RECORD_SUMMARY,
  });
  await expect(managerQueueCard).toContainText("Waiting for manager check");
  await managerQueueCard.getByRole("button", { name: "Verify checking" }).click();
  await expect(
    page.getByText("Cash checking verified and added to cash ready for banking."),
  ).toBeVisible();
  await expect(managerQueueCard).toContainText("Manager checked");
  await signOut(page);

  await signIn(page, "owner@taxiflow.local");
  const updatedDailyTotal = await readOverviewDailyTotal(page);
  expect(updatedDailyTotal).toBe(baselineDailyTotal + ENTRY_AMOUNT);
  await signOut(page);
});
