import { expect, test } from "@playwright/test";

// The "How to use TaxiFlow" guide (mock backend). Deliberately does NOT use
// skipUserGuideWhenShown: these tests drive the guide themselves.

const PASSWORD = "TaxiFlow.123";
const GUIDE_NAME = "How to use TaxiFlow";

const guideDialog = (page) => page.getByRole("dialog", { name: GUIDE_NAME });
const moduleButton = (page, label) =>
  page.locator("button.module-button").filter({ hasText: label });

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

const stepTitles = (page) => guideDialog(page).locator(".user-guide-step > strong").allTextContents();

test("first sign-in opens the guide; Skip is remembered across reload and the next sign-in", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");

  const guide = guideDialog(page);
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute("aria-modal", "true");
  await expect(guide.getByText("Guide for Owner")).toBeVisible();
  await expect(guide.getByText("Do this first")).toBeVisible();
  // Focus starts on the main next action, inside the dialog.
  await expect(guide.getByRole("button", { name: /^Start:/ })).toBeFocused();

  await guide.getByRole("button", { name: "Skip for now" }).click();
  await expect(guide).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(guide).toHaveCount(0);

  await signOut(page);
  await signIn(page, "owner@taxiflow.local");
  await expect(guide).toHaveCount(0);
});

test("Help reopens the guide; Escape and Close dismiss it and return focus to Help", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  const guide = guideDialog(page);
  await guide.getByRole("button", { name: "Close guide" }).click();
  await expect(guide).toHaveCount(0);

  const help = page.getByRole("button", { name: "Help" });
  await help.click();
  await expect(guide).toBeVisible();

  // Keyboard: Tab stays inside the open dialog.
  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press("Tab");
    expect(await guide.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  await expect(help).toBeFocused();

  // Reopening from Help does not reset the remembered completion.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(guide).toHaveCount(0);
});

test("the main next action opens Money and closes the guide for good", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  const guide = guideDialog(page);
  await guide.getByRole("button", { name: "Start: Capture the day" }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Daily trip entry" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(guide).toHaveCount(0);
});

test("completion is per user: a second account in the same browser still gets its own guide", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");
  await guideDialog(page).getByRole("button", { name: "Skip for now" }).click();
  await signOut(page);

  await signIn(page, "admin@taxiflow.local");
  await expect(guideDialog(page)).toBeVisible();
  await expect(guideDialog(page).getByText("Guide for Admin")).toBeVisible();
});

test("management guide follows the role: Owner sees every area, Admin's cash part is counting", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");
  expect(await stepTitles(page)).toEqual([
    "Look at Overview",
    "Capture the day",
    "Review, verify and bank the cash",
    "Record expenses",
    "Keep the fleet ready",
    "Link drivers to vehicles",
    "Check the reports",
    "Give your team access",
  ]);
  await expect(guideDialog(page)).toContainText(
    "Your part: record the cash a driver hands in (count), verify someone else's count, record the bank deposit.",
  );
  await guideDialog(page).getByRole("button", { name: "Skip for now" }).click();
  await signOut(page);

  await signIn(page, "admin@taxiflow.local");
  await expect(guideDialog(page)).toContainText("Your part: record the cash a driver hands in (count).");
  expect(await stepTitles(page)).toContain("See who has access");
});

test("driver guide covers vehicle, trips, costs, checking and defects, and no management screens", async ({
  page,
}) => {
  await signIn(page, "driver.one@taxiflow.local");
  const guide = guideDialog(page);
  await expect(guide.getByText("Guide for Driver")).toBeVisible();
  expect(await stepTitles(page)).toEqual([
    "Check your vehicle",
    "Add your trips",
    "Add costs you paid",
    "Send your day for checking",
    "Report vehicle problems",
  ]);
  await expect(guide).not.toContainText("Money");
  await expect(guide).not.toContainText("Reports");

  // Warnings say what happened, why it matters and what to do.
  const checkingWarning = guide.getByTestId("guide-warning-driver-checking-needs-entries");
  await expect(checkingWarning).toContainText("What happened");
  await expect(checkingWarning).toContainText("Why it matters");
  await expect(checkingWarning).toContainText("What to do");

  await guide.getByRole("button", { name: "Report a problem" }).click();
  await expect(guide).toHaveCount(0);
  await expect(moduleButton(page, "Fleet & Operations").first()).toHaveClass(/\bactive\b/);
});

test("the guide respects module permissions: Manager with Money off is told why and what to do", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");
  await guideDialog(page).getByRole("button", { name: "Skip for now" }).click();
  await moduleButton(page, "Settings").first().click();
  await page
    .locator("article.person-row")
    .filter({ hasText: "manager@taxiflow.local" })
    .getByRole("button", { name: "Manage" })
    .click();
  const accessForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save access" }),
  });
  await accessForm.getByRole("button", { name: "Money", exact: true }).click();
  await accessForm.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(/updated as Manager\./i)).toBeVisible();
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  const guide = guideDialog(page);
  await expect(guide.getByText("Guide for Manager")).toBeVisible();
  const titles = await stepTitles(page);
  expect(titles).not.toContain("Capture the day");
  expect(titles).not.toContain("Check the reports");
  await expect(guide.getByTestId("guide-warning-mgmt-money-off")).toContainText(
    "Ask the Owner to switch on Money for your account in Settings",
  );
  await expect(guide.getByRole("button", { name: /Open Money/ })).toHaveCount(0);
});

test("viewer guide is demo-only", async ({ page }) => {
  await signIn(page, "viewer@taxiflow.local");
  const guide = guideDialog(page);
  expect(await stepTitles(page)).toEqual(["Look around Overview"]);
  await expect(guide.getByTestId("guide-warning-viewer-demo")).toBeVisible();
});

test.describe("narrow mobile viewport", () => {
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

  test("guide scrolls inside the sheet, fits the width and has 44px tap targets", async ({ page }) => {
    await signIn(page, "owner@taxiflow.local");
    const guide = guideDialog(page);
    await expect(guide).toBeVisible();

    const body = guide.locator(".mobile-sheet-body");
    const { scrollable, overflowY } = await body.evaluate((node) => ({
      scrollable: node.scrollHeight > node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(overflowY).toBe("auto");
    expect(scrollable).toBe(true);
    await guide.getByRole("button", { name: "Open Settings" }).scrollIntoViewIfNeeded();
    await expect(guide.getByRole("button", { name: "Open Settings" })).toBeInViewport();

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);

    for (const button of await guide.getByRole("button").all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      expect(box.height, await button.textContent()).toBeGreaterThanOrEqual(44);
    }

    await guide.getByRole("button", { name: "Skip for now" }).tap();
    await expect(guide).toHaveCount(0);
    const helpBox = await page.getByRole("button", { name: "Help" }).boundingBox();
    expect(helpBox.height).toBeGreaterThanOrEqual(44);
  });
});
