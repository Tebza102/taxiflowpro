import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Tenant-mode browser proof against the LOCAL synthetic stack with real local
// Auth (playwright.localdb.config.mjs). Requires a fresh
// `node scripts/localdb/setup.mjs reset`. Synthetic @example.com identities only.

const DAY = "2026-10-08";
const DAY_LABEL = "08 Oct 2026";
const TRIP_AMOUNT = 500;
const SAFE_EXPENSE = 120;
const EXPECTED_CASH = TRIP_AMOUNT - SAFE_EXPENSE; // 380
const A_MARKER = "T17 A driver fuel slip";
const A_ONLY = "driver@example.com"; // business A's driver (roster); not in B
const B_OWNER_DRIVER = "UAT Owner B (drives)"; // business B's owner-driver; not in A

test.describe.configure({ mode: "serial" });

const pageErrors = [];
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => pageErrors.push(error.message));
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
const signOut = async (page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
};
const moduleButton = (page, label) => page.locator("button.module-button").filter({ hasText: label }).first();
const openMoney = async (page) => {
  await moduleButton(page, "Money").click();
  await expect(page.getByRole("heading", { name: "Daily trip entry" })).toBeVisible();
};
const openBanking = async (page) => {
  await moduleButton(page, "Money").click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Banking" }).click();
  await expect(page.getByRole("heading", { name: "Admin hand-in and manager verification" })).toBeVisible();
};
const dayCard = (page, driverName) =>
  page.locator("article.queue-card").filter({ hasText: driverName }).filter({ hasText: DAY_LABEL });

// Driver daily-earnings form (driver terminal). The synthetic route has no stops,
// so the stops are entered explicitly.
const captureDriverTrip = async (page, { date = DAY, from = "Rank A", to = "Rank B", passengers = "12", amount = String(TRIP_AMOUNT) } = {}) => {
  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();
  const panel = page.locator(".driver-action-panel");
  await panel.getByLabel("Date").fill(date);
  await panel.getByLabel("Time in").fill("06:00");
  await panel.getByLabel("Time out").fill("10:00");
  await panel.getByLabel("Opening odo").fill("1000");
  await panel.getByLabel("Closing odo").fill("1080");
  await panel.getByLabel("From").first().fill(from);
  await panel.getByLabel("To", { exact: true }).first().fill(to);
  await panel.getByRole("spinbutton", { name: "Passengers" }).first().fill(passengers);
  await panel.getByRole("spinbutton", { name: "Amount collected" }).first().fill(amount);
  await page.getByRole("button", { name: "Save trip" }).click();
};

test("driver captures trip + safe expense, survives refresh, submits day checking", async ({ page }) => {
  await signIn(page, "driver@example.com");
  // One business: no selector, the business is named.
  const bar = page.getByTestId("tenant-bar");
  await expect(bar).toContainText(/TaxiFlow Pro/i);
  await expect(bar.getByLabel("Business")).toHaveCount(0);

  await captureDriverTrip(page);
  await expect(page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in.")).toBeVisible();

  await page.getByRole("button", { name: "Add daily expense" }).click();
  const expensePanel = page.locator(".driver-action-panel");
  await expensePanel.getByLabel("Category").selectOption("Other");
  await expensePanel.getByLabel("Description").fill(A_MARKER);
  await expensePanel.getByLabel("Expense date").fill(DAY);
  await expensePanel.getByLabel("Amount").fill(String(SAFE_EXPENSE));
  await expensePanel.getByLabel("Paid from safe").check();
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved and sent to a manager for review.")).toBeVisible();

  // Refresh persistence: the server copy is re-read (no browser snapshot cache).
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  const board = page.locator("article.overview-board").filter({ has: page.getByRole("heading", { name: "My captured takings and expenses" }) });
  await expect(board).toContainText(DAY_LABEL);
  await expect(board).toContainText(A_MARKER);
  const storageKeys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(storageKeys.filter((key) => /snapshot|taxiflow-live/i.test(key))).toEqual([]);

  await moduleButton(page, "Overview").click();
  const cashBoard = page.locator("article.overview-board").filter({ has: page.getByRole("heading", { name: "Day cash activity" }) });
  await expect(cashBoard).toContainText(DAY_LABEL);
  await expect(cashBoard).toContainText(`R ${EXPECTED_CASH}`);
  await cashBoard.getByRole("button", { name: "Checking" }).click();
  await expect(page.getByText("Checking sent. Management can now record one day hand-in for this shift.")).toBeVisible();
  await signOut(page);
});

test("admin counts, manager verifies, closed day refuses driver edits", async ({ page }) => {
  await signIn(page, "admin@example.com");
  await openBanking(page);
  const adminCard = dayCard(page, "UAT Driver");
  await expect(adminCard).toContainText("Waiting for admin hand-in");
  await adminCard.getByPlaceholder("Cash handed in").fill(String(EXPECTED_CASH));
  await adminCard.getByRole("button", { name: "Record hand-in" }).click();
  await expect(page.getByText("Day checking recorded and waiting for manager verification.")).toBeVisible();
  await expect(adminCard).toContainText("Waiting for manager check");
  await signOut(page);

  // Closed day: the counted records are no longer editable by the driver, and a
  // new capture on the counted day is refused by the server with its reason.
  await signIn(page, "driver@example.com");
  const board = page.locator("article.overview-board").filter({ has: page.getByRole("heading", { name: "My captured takings and expenses" }) });
  const countedRow = board.locator("article.ledger-row").filter({ hasText: A_MARKER });
  await expect(countedRow.getByRole("button", { name: "Edit" })).toBeDisabled();
  await captureDriverTrip(page, { amount: "50" });
  await expect(page.getByText(`Your day checking for ${DAY} is counted; new work for that day cannot be added.`)).toBeVisible();
  // The capture sheet stays open with the entry; leave it via a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await signOut(page);

  await signIn(page, "manager@example.com");
  await openBanking(page);
  const managerCard = dayCard(page, "UAT Driver");
  await expect(managerCard).toContainText("Waiting for manager check");
  await managerCard.getByRole("button", { name: "Verify checking" }).click();
  await expect(page.getByText("Day checking verified and added to cash ready for banking.")).toBeVisible();
  await expect(managerCard).toContainText("Manager checked");
  await signOut(page);
});

test("owner banks the verified batch and the report names the actors", async ({ page }) => {
  await signIn(page, "owner@example.com");
  await openBanking(page);
  await page.getByRole("button", { name: "Finish deposit" }).click();
  await expect(page.getByText(/manager-checked records were added to TFP-/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await openBanking(page);
  await expect(page.getByRole("button", { name: "Finish deposit" })).toBeDisabled();

  await moduleButton(page, "Reports").click();
  await expect(page.getByRole("heading", { name: "Management reports" })).toBeVisible();
  const reportView = page.waitForResponse((response) => /report-view/.test(response.url()) && response.status() === 200);
  await page.getByTestId("reports-date").fill(DAY);
  const preview = page.getByTestId("reports-preview");
  await expect(preview.getByText("Expected cash hand-in")).toBeVisible({ timeout: 30_000 });
  await expect(preview).toContainText("UAT Driver");
  await expect(preview).toContainText(`R ${EXPECTED_CASH}`);
  // Server-recorded actors (auth user ids) resolve to names within this business.
  const reportJson = JSON.stringify(await (await reportView).json());
  expect(reportJson).toContain("UAT Admin");
  expect(reportJson).toContain("UAT Manager");
  await signOut(page);
});

test("stale save is refused with the draft kept, then succeeds after refresh", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "owner@example.com");
  await openMoney(owner);
  const tripForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Add passenger trip" }) }).first();
  await tripForm.getByLabel("Date").fill(DAY);
  await tripForm.getByLabel("Time in").fill("12:00");
  await tripForm.getByLabel("Time out").fill("13:00");
  await tripForm.getByLabel("Opening odo").fill("2000");
  await tripForm.getByLabel("Closing odo").fill("2040");
  await tripForm.getByLabel("From").first().fill("Depot");
  await tripForm.getByLabel("To", { exact: true }).first().fill("Mall");
  await tripForm.getByRole("spinbutton", { name: "Passengers" }).first().fill("4");
  await tripForm.getByRole("spinbutton", { name: "Amount collected" }).first().fill("77");

  // Someone else changes the business after the owner loaded it.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, "driver@example.com");
  await captureDriverTrip(other, { date: "2026-10-09", amount: "40" });
  await expect(other.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in.")).toBeVisible();
  await otherContext.close();

  await tripForm.getByRole("button", { name: "Save trip" }).click();
  await expect(owner.getByText(/Someone else saved changes to this business since you loaded it/).first()).toBeVisible();
  // Draft kept.
  await expect(tripForm.getByRole("spinbutton", { name: "Amount collected" }).first()).toHaveValue("77");
  await expect(tripForm.getByLabel("From").first()).toHaveValue("Depot");

  const reloaded = owner.waitForResponse((r) => r.url().includes("/api/business/workspace") && r.status() === 200);
  await owner.getByRole("button", { name: "Refresh live data" }).first().click();
  await reloaded;
  await expect(owner.getByText("Syncing live data...")).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await openMoney(owner);
  const retryForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Add passenger trip" }) }).first();
  await expect(retryForm.getByRole("spinbutton", { name: "Amount collected" }).first()).toHaveValue("77");
  await retryForm.getByRole("button", { name: "Save trip" }).click();
  await expect(owner.getByText(/Trip saved and added to the daily total/)).toBeVisible();
  await ownerContext.close();
});

test("owner-driver captures own work and sends own checking in business B; A data is not visible", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const bar = page.getByTestId("tenant-bar");
  await expect(bar.getByLabel("Capture as")).toBeVisible();
  await bar.getByLabel("Capture as").selectOption("driver");

  // Management trip form, captured as the Owner's own driving.
  await openMoney(page);
  const tripForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add passenger trip" }) }).first();
  await tripForm.getByLabel("Date").fill(DAY);
  await tripForm.getByLabel("Time in").fill("07:00");
  await tripForm.getByLabel("Time out").fill("08:00");
  await tripForm.getByLabel("Opening odo").fill("3000");
  await tripForm.getByLabel("Closing odo").fill("3030");
  await tripForm.getByLabel("From").first().fill("Rank B1");
  await tripForm.getByLabel("To", { exact: true }).first().fill("Rank B2");
  await tripForm.getByRole("spinbutton", { name: "Passengers" }).first().fill("6");
  await tripForm.getByRole("spinbutton", { name: "Amount collected" }).first().fill("150");
  await tripForm.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByText(/Trip saved and added to the daily total/)).toBeVisible();

  await bar.getByRole("button", { name: "Send my day checking" }).click();
  await expect(page.getByText("Checking sent. Management can now record one day hand-in for this shift.")).toBeVisible();
  await openBanking(page);
  await expect(dayCard(page, B_OWNER_DRIVER)).toContainText("Waiting for admin hand-in");

  // Cross-business isolation in the browser and at the API.
  await expect(page.locator("main")).not.toContainText(A_MARKER);
  const crossRead = await page.evaluate(async (businessA) => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = raw ? JSON.parse(raw[1]).access_token : null;
    const response = await fetch(`/api/business/workspace?business=${businessA}`, { headers: { Authorization: `Bearer ${token}` } });
    return response.status;
  }, BUSINESS_A_ID);
  expect(crossRead).toBe(403);
  await signOut(page);
});

const openDrivers = async (page) => {
  await moduleButton(page, "Drivers").click();
  await expect(page.getByRole("heading", { name: "Roster and performance" })).toBeVisible();
};

test("a two-business user selects, switches and never sees the other business's data", async ({ page }) => {
  // newhire.a@ gets synthetic Manager memberships in A and B for this check.
  execFileSync(process.execPath, ["scripts/localdb/two-business-user.mjs"], { stdio: "inherit" });
  await signIn(page, "newhire.a@example.com");
  // No business is opened until one is chosen explicitly.
  const picker = page.getByTestId("tenant-picker");
  await expect(picker.getByLabel("Business")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(A_ONLY);
  await expect(page.locator("body")).not.toContainText(B_OWNER_DRIVER);

  await picker.getByLabel("Business").selectOption(BUSINESS_A_ID);
  await openDrivers(page);
  await expect(page.locator("main")).toContainText(A_ONLY, { timeout: 30_000 });
  await expect(page.locator("main")).not.toContainText(B_OWNER_DRIVER);

  await page.getByTestId("tenant-bar").getByLabel("Business").selectOption(BUSINESS_B_ID);
  await openDrivers(page);
  await expect(page.locator("main")).toContainText(B_OWNER_DRIVER, { timeout: 30_000 });
  await expect(page.locator("main")).not.toContainText(A_ONLY);

  // Selection survives refresh; data is re-read for B only.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tenant-bar").getByLabel("Business")).toHaveValue(BUSINESS_B_ID);
  await openDrivers(page);
  await expect(page.locator("main")).not.toContainText(A_ONLY);
  await signOut(page);

  // Another user on the same browser starts clean (no carried-over business data).
  await signIn(page, "driver.b@example.com");
  await expect(page.locator("main")).not.toContainText(A_ONLY);
  await expect(page.locator("main")).not.toContainText(A_MARKER);
  await signOut(page);
  expect(pageErrors).toEqual([]);
});
