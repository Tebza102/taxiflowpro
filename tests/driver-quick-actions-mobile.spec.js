import { expect, test } from "@playwright/test";

const PASSWORD = "TaxiFlow.123";

const signIn = async (page, email) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

test("driver quick actions stay usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "driver.one@taxiflow.local");

  await page.getByRole("button", { name: "Add daily earnings" }).click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save trip" })).toBeVisible();
  await expect(page.locator("button.driver-fullscreen-back")).toBeVisible();

  const shiftLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(shiftLayout.scrollWidth).toBeLessThanOrEqual(shiftLayout.clientWidth);

  await page.locator("button.driver-fullscreen-back").click();
  await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.getByRole("button", { name: "Add daily expense" }).click();
  await expect(page.getByRole("heading", { name: "Add daily expense" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save expense" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();

  const expenseLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(expenseLayout.scrollWidth).toBeLessThanOrEqual(expenseLayout.clientWidth);
});
