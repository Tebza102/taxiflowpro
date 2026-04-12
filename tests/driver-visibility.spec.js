import { expect, test } from "@playwright/test";

const PASSWORD = "TaxiFlow.123";
const DAILY_DATE = "2026-04-03";
const DAILY_DATE_LABEL = "03 Apr 2026";
const ZERO_ACTIVITY_DATE = "2026-04-04";
const DRIVER_EDIT_DATE = "2026-04-05";
const DRIVER_EDIT_DATE_LABEL = "05 Apr 2026";
const ROUTE_TEXT = "JHB 457 GP / Noord to Alexandra";
const PASSENGER_SUMMARY = "21 passengers";
const TRIP_SUMMARY = "2 trips";
const AMOUNT_SUMMARY = "R 920";
const RECORD_SUMMARY = `Daily trip / ${DAILY_DATE_LABEL} / In 06:00 / Out 10:00 / ${TRIP_SUMMARY} / ${PASSENGER_SUMMARY}`;
const ENTRY_AMOUNT = 920;
const EXPENSE_AMOUNT = 120;
const EXPECTED_CASH_IN = ENTRY_AMOUNT - EXPENSE_AMOUNT;
const EXPECTED_CASH_LABEL = "R 800";

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
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();

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
    page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in."),
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

test("driver can save a daily trip with zero passengers and zero collected", async ({ page }) => {
  await signIn(page, "driver.one@taxiflow.local");

  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();

  await page.getByLabel("Date").fill(ZERO_ACTIVITY_DATE);
  await page.getByLabel("Time in").fill("11:00");
  await page.getByLabel("Time out").fill("11:45");
  await page.getByLabel("Opening odo").fill("384120");
  await page.getByLabel("Closing odo").fill("384150");

  const driverActionPanel = page.locator(".driver-action-panel");
  await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).first().fill("0");
  await driverActionPanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .first()
    .fill("0");

  await expect(driverActionPanel.getByLabel("Total passengers")).toHaveValue("0");
  await expect(driverActionPanel.getByLabel("Total collected")).toHaveValue(/R\s*0/);

  await page.getByRole("button", { name: "Save trip" }).click();

  await expect(
    page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in."),
  ).toBeVisible();
  await signOut(page);
});

test("driver edits takings and expenses with reasons and owner can review the changes", async ({
  page,
}) => {
  await signIn(page, "driver.one@taxiflow.local");

  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();

  await page.getByLabel("Date").fill(DRIVER_EDIT_DATE);
  await page.getByLabel("Time in").fill("07:00");
  await page.getByLabel("Time out").fill("09:00");
  await page.getByLabel("Opening odo").fill("384120");
  await page.getByLabel("Closing odo").fill("384180");
  const incomePanel = page.locator(".driver-action-panel");
  await incomePanel.getByRole("spinbutton", { name: "Passengers" }).first().fill("10");
  await incomePanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .first()
    .fill("400");
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(
    page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add daily expense" }).click();
  await expect(page.getByRole("heading", { name: "Add daily expense" })).toBeVisible();
  const expensePanel = page.locator(".driver-action-panel");
  await expensePanel.getByLabel("Category").selectOption("Other");
  await expensePanel.getByLabel("Description").fill("Edit test fuel slip");
  await expensePanel.getByLabel("Expense date").fill(DRIVER_EDIT_DATE);
  await expensePanel.getByLabel("Amount").fill("90");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved and sent to a manager for review.")).toBeVisible();

  const activityBoard = page.locator("article.overview-board").filter({
    has: page.getByRole("heading", { name: "My captured takings and expenses" }),
  });
  await expect(activityBoard).toContainText(DRIVER_EDIT_DATE_LABEL);

  const incomeRow = activityBoard.locator("article.ledger-row").filter({
    hasText: `Daily trip / ${DRIVER_EDIT_DATE_LABEL} / In 07:00 / Out 09:00`,
  });
  await incomeRow.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Update reason")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Amount collected" }).first().fill("450");
  await page.getByLabel("Update reason").fill("Corrected takings after recount.");
  await page.getByRole("button", { name: "Update trip" }).click();
  await expect(page.getByText("Trip update saved and logged for owner review.")).toBeVisible();

  const expenseRow = activityBoard.locator("article.ledger-row").filter({
    hasText: "Edit test fuel slip",
  });
  await expenseRow.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Update reason")).toBeVisible();
  await page.getByLabel("Amount").fill("120");
  await page.getByLabel("Update reason").fill("Updated expense after checking the receipt.");
  await page.getByRole("button", { name: "Update expense" }).click();
  await expect(page.getByText("Expense update saved and logged for owner review.")).toBeVisible();
  await signOut(page);

  await signIn(page, "owner@taxiflow.local");
  await page.getByRole("heading", { name: "System activity history" }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Corrected takings after recount.")).toBeVisible();
  await expect(page.getByText("Updated expense after checking the receipt.")).toBeVisible();
  await expect(page.getByText("Trip income updated")).toBeVisible();
  await expect(page.getByText("Expense updated")).toBeVisible();
  await signOut(page);
});

test("driver checking shows running cash activity and gives management an expected cash-in heads up", async ({
  page,
}) => {
  await signIn(page, "driver.one@taxiflow.local");

  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();

  await page.getByLabel("Date").fill(DAILY_DATE);
  await page.getByLabel("Time in").fill("06:00");
  await page.getByLabel("Time out").fill("10:00");
  await page.getByLabel("Opening odo").fill("384120");
  await page.getByLabel("Closing odo").fill("384200");
  const incomePanel = page.locator(".driver-action-panel");
  await incomePanel.getByRole("spinbutton", { name: "Passengers" }).first().fill("12");
  await incomePanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .first()
    .fill("500");
  await page.getByRole("button", { name: "Add passenger trip" }).click();
  await incomePanel.getByRole("spinbutton", { name: "Passengers" }).nth(1).fill("9");
  await incomePanel
    .getByRole("spinbutton", { name: "Amount collected" })
    .nth(1)
    .fill("420");
  await page.getByRole("button", { name: "Save trip" }).click();

  await expect(
    page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add daily expense" }).click();
  await expect(page.getByRole("heading", { name: "Add daily expense" })).toBeVisible();

  const expensePanel = page.locator(".driver-action-panel");
  await expensePanel.getByLabel("Expense date").fill(DAILY_DATE);
  await expensePanel.getByLabel("Amount").fill(String(EXPENSE_AMOUNT));
  await expensePanel.getByLabel("Paid from safe").check();
  await page.getByRole("button", { name: "Save expense" }).click();

  await expect(page.getByText("Expense saved and sent to a manager for review.")).toBeVisible();

  await moduleButton(page, "Overview").click();
  await expect(page.getByRole("heading", { name: "Day cash activity" })).toBeVisible();

  const driverExpectedCashCard = page.locator("article.insight-card").filter({
    hasText: "Expected cash in",
  });
  await expect(driverExpectedCashCard).toContainText(EXPECTED_CASH_LABEL);

  const driverCashBoard = page.locator("article.overview-board").filter({
    has: page.getByRole("heading", { name: "Day cash activity" }),
  });
  await expect(driverCashBoard).toContainText("R 920");
  await expect(driverCashBoard).toContainText("R 120");
  await expect(driverCashBoard).toContainText(EXPECTED_CASH_LABEL);
  await driverCashBoard.getByRole("button", { name: "Checking" }).click();

  await expect(
    page.getByText("Checking sent. Management can now record one day hand-in for this shift."),
  ).toBeVisible();
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  const managementExpectedCashCard = page.locator("article.insight-card").filter({
    hasText: "Expected cash in",
  });
  await expect(managementExpectedCashCard).toContainText(EXPECTED_CASH_LABEL);

  const managementHeadsUpBoard = page.locator("article.overview-board").filter({
    has: page.getByRole("heading", { name: "Driver checking heads up" }),
  });
  await expect(managementHeadsUpBoard).toContainText("Sizwe Mokoena");
  await expect(managementHeadsUpBoard).toContainText(DAILY_DATE_LABEL);
  await expect(managementHeadsUpBoard).toContainText(EXPECTED_CASH_LABEL);
  await signOut(page);

  expect(EXPECTED_CASH_IN).toBe(800);
});

test("admin records cash hand-in, manager verifies it, and the dashboard total increases", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");
  const baselineDailyTotal = await readOverviewDailyTotal(page);
  await signOut(page);

  await signIn(page, "driver.one@taxiflow.local");
  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();

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
    page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in."),
  ).toBeVisible();
  await moduleButton(page, "Overview").click();
  await page
    .locator("article.overview-board")
    .filter({ has: page.getByRole("heading", { name: "Day cash activity" }) })
    .getByRole("button", { name: "Checking" })
    .click();
  await expect(
    page.getByText("Checking sent. Management can now record one day hand-in for this shift."),
  ).toBeVisible();
  await signOut(page);

  await grantOwnerModules(page, "manager@taxiflow.local", ["Money"]);
  await grantOwnerModules(page, "admin@taxiflow.local", ["Money"]);

  await signIn(page, "admin@taxiflow.local");
  await openBankingModule(page);
  const adminQueueCard = page
    .locator("article.queue-card")
    .filter({ hasText: "Sizwe Mokoena" })
    .filter({ hasText: DAILY_DATE_LABEL });
  await expect(page.locator("article.queue-card").filter({ hasText: RECORD_SUMMARY })).toHaveCount(0);
  await expect(adminQueueCard).toContainText("Waiting for admin hand-in");
  await adminQueueCard.getByPlaceholder("Cash handed in").fill(String(ENTRY_AMOUNT));
  await adminQueueCard.getByRole("button", { name: "Record hand-in" }).click();
  await expect(
    page.getByText("Day checking recorded and waiting for manager verification."),
  ).toBeVisible();
  await expect(adminQueueCard).toContainText("Waiting for manager check");
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  await openBankingModule(page);
  const managerQueueCard = page
    .locator("article.queue-card")
    .filter({ hasText: "Sizwe Mokoena" })
    .filter({ hasText: DAILY_DATE_LABEL });
  await expect(managerQueueCard).toContainText("Waiting for manager check");
  await managerQueueCard.getByRole("button", { name: "Verify checking" }).click();
  await expect(
    page.getByText("Day checking verified and added to cash ready for banking."),
  ).toBeVisible();
  await expect(managerQueueCard).toContainText("Manager checked");
  await expect(page.getByRole("button", { name: "Finish deposit" })).toBeEnabled();
  await signOut(page);

  await signIn(page, "admin@taxiflow.local");
  await openBankingModule(page);
  await expect(page.getByRole("button", { name: "Finish deposit" })).toBeDisabled();
  await signOut(page);

  await signIn(page, "owner@taxiflow.local");
  const updatedDailyTotal = await readOverviewDailyTotal(page);
  expect(updatedDailyTotal).toBe(baselineDailyTotal + ENTRY_AMOUNT);
  await signOut(page);
});
