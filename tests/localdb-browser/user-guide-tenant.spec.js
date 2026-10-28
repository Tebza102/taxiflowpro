import { expect, test } from "@playwright/test";

import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";

// "How to use TaxiFlow" in the business workspace (tenant mode, LOCAL stack,
// synthetic @example.com identities). Read-only: the guide only touches this
// browser's storage. Does NOT use skipUserGuideWhenShown.

const GUIDE_NAME = "How to use TaxiFlow";
const guideDialog = (page) => page.getByRole("dialog", { name: GUIDE_NAME });

const signIn = async (page, email) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

test("Admin: guide opens once for the business, states the counting step and the second-person rule", async ({
  page,
}) => {
  await signIn(page, "admin@example.com");
  const guide = guideDialog(page);
  await expect(guide).toBeVisible({ timeout: 30_000 });
  await expect(guide.getByText("Guide for Admin")).toBeVisible();
  await expect(guide).toContainText("Your part: record the cash a driver hands in (count).");
  await expect(guide.getByTestId("guide-warning-mgmt-second-person")).toContainText(
    "You cannot verify a cash count that you recorded yourself.",
  );

  await guide.getByRole("button", { name: "Skip for now" }).click();
  await expect(guide).toHaveCount(0);

  // Remembered per user and business: a reload re-reads the server copy but
  // does not reopen the guide.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tenant-bar")).toBeVisible();
  await expect(guide).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  await expect(guide).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
});

test("Owner who also drives is told how to capture their own driving", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const guide = guideDialog(page);
  await expect(guide).toBeVisible({ timeout: 30_000 });
  await expect(guide.locator(".user-guide-step > strong")).toContainText(["Capture your own driving"]);
  await expect(guide).toContainText("Set Capture as to My own driving");
});

test("Driver gets the driver guide only", async ({ page }) => {
  await signIn(page, "driver@example.com");
  const guide = guideDialog(page);
  await expect(guide).toBeVisible({ timeout: 30_000 });
  await expect(guide.getByText("Guide for Driver")).toBeVisible();
  await expect(guide.locator(".user-guide-step > strong").first()).toHaveText("Check your vehicle");
  await expect(guide).not.toContainText("Money");
  await guide.getByRole("button", { name: "Start: Check your vehicle" }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.locator("button.module-button.active")).toContainText("Drivers");
});
