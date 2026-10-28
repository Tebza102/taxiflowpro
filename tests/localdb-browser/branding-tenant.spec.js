import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Branding in tenant mode (Task 19), LOCAL stack: business picker, finance
// (Money) and Business access show the approved logo at its own proportions,
// on desktop and mobile. Screenshots: test-results/branding-tenant/.

const LOGO_RATIO = 1268 / 735;
const SHOTS = "test-results/branding-tenant";
mkdirSync(SHOTS, { recursive: true });

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};
const expectLogo = async (page, selector) => {
  const info = await page.locator(selector).first().evaluate((img) => {
    const box = img.getBoundingClientRect();
    return { src: new URL(img.currentSrc).pathname, loaded: img.complete && img.naturalWidth === 1268, ratio: box.width / box.height, left: box.left, right: box.right, viewport: window.innerWidth };
  });
  expect(info.src).toBe("/brand/taxiflow-logo.png");
  expect(info.loaded).toBe(true);
  expect(Math.abs(info.ratio - LOGO_RATIO) / LOGO_RATIO).toBeLessThan(0.02);
  expect(info.left >= 0 && info.right <= info.viewport).toBe(true);
};

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 375, height: 812 }]) {
  test(`tenant screens carry the approved logo (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    execFileSync(process.execPath, ["scripts/localdb/two-business-user.mjs"], { stdio: "ignore" });

    // Business picker.
    await signIn(page, "newhire.a@example.com");
    await expect(page.getByTestId("tenant-picker")).toBeVisible();
    await expectLogo(page, "[data-testid=tenant-picker] img.auth-logo");
    await page.screenshot({ path: `${SHOTS}/picker-${viewport.name}.png` });
    await page.getByTestId("tenant-picker").getByLabel("Business").selectOption(BUSINESS_A_ID);

    // Finance screen (Money).
    await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
    await expect(page.getByRole("heading", { name: "Daily trip entry" })).toBeVisible({ timeout: 30_000 });
    await expectLogo(page, "img.toolbar-logo");
    await page.screenshot({ path: `${SHOTS}/money-${viewport.name}.png` });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });

    // Business access (Owner).
    await signIn(page, "owner@example.com");
    await page.locator("button.module-button").filter({ hasText: "Settings" }).first().click();
    await expect(page.getByTestId("access-row").first()).toBeVisible({ timeout: 30_000 });
    await expectLogo(page, "img.toolbar-logo");
    await page.screenshot({ path: `${SHOTS}/access-${viewport.name}.png` });
  });
}
