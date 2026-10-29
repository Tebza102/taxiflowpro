import { expect, test } from "@playwright/test";
import { skipUserGuideWhenShown } from "./user-guide-helpers.mjs";

// Small screens: compact header (menu button + current page) and a drawer that
// is closed by default, opens on request and closes after choosing a page, on
// the backdrop or on Escape. Desktop keeps the module buttons and no header.

const PASSWORD = "TaxiFlow.123";
const PHONE = { width: 375, height: 812 };
// A phone on its side with the browser toolbar showing.
const LANDSCAPE = { width: 780, height: 320 };

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const drawer = (page) => page.getByTestId("mobile-nav-drawer");
const menuButton = (page) => page.getByRole("button", { name: "Open menu" });
const moduleLabels = async (page) =>
  (await page.locator("button.module-button .module-button-label").allInnerTexts()).map((text) => text.trim());

test("phone: closed by default, nothing over the content, opens deliberately and closes after navigating", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, "owner@taxiflow.local");

  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByTestId("mobile-page-title")).toHaveText("Overview");
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");

  // The lower part of the screen is content, not navigation.
  const bottomHit = await page.evaluate(({ width, height }) => document.elementFromPoint(width / 2, height - 20)?.closest("nav, .mobile-topbar") ?? null, PHONE);
  expect(bottomHit).toBeNull();
  const header = await page.getByTestId("mobile-topbar").boundingBox();
  expect(header.height).toBeLessThanOrEqual(64);
  const firstContent = await page.locator(".app-toolbar").boundingBox();
  expect(firstContent.y).toBeGreaterThanOrEqual(header.y + header.height);

  const menuBox = await menuButton(page).boundingBox();
  expect(menuBox.width).toBeGreaterThanOrEqual(44);
  expect(menuBox.height).toBeGreaterThanOrEqual(44);

  await menuButton(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toHaveAttribute("aria-modal", "true");
  await expect(drawer(page).locator("[aria-current='page']")).toHaveText("Overview");
  await expect(drawer(page).locator("[aria-current='page']")).toBeFocused();
  for (const item of await drawer(page).locator(".mobile-drawer-item").all()) {
    expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }

  await drawer(page).getByRole("button", { name: "Reports" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByTestId("mobile-page-title")).toHaveText("Reports");
  await expect(page.getByRole("heading", { name: "Business and vehicle reports" })).toBeVisible();
  await expect(menuButton(page)).toBeFocused();

  // Escape and the backdrop both close it without changing the page.
  await menuButton(page).click();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await menuButton(page).click();
  await page.getByTestId("mobile-drawer-backdrop").click({ position: { x: 360, y: 400 } });
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByTestId("mobile-page-title")).toHaveText("Reports");
});

test.describe("phone landscape (wider than the narrow breakpoint)", () => {
  test.use({ viewport: LANDSCAPE, isMobile: true, hasTouch: true });

  test("the compact header is shown and the drawer scrolls so every page is reachable", async ({ page }) => {
    await signIn(page, "owner@taxiflow.local");
    await expect(page.getByTestId("mobile-topbar")).toBeVisible();
    await menuButton(page).click();
    const items = drawer(page).locator(".mobile-drawer-item");
    const overflow = await drawer(page).evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(overflow).toBe(true); // six pages do not fit in 320px: the drawer scrolls
    const last = items.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.getByTestId("mobile-page-title")).toHaveText("Settings");
  });
});

test("phone: a Driver's drawer lists exactly the Driver's own pages", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, "driver.one@taxiflow.local");
  const allowed = await moduleLabels(page);
  await menuButton(page).click();
  const listed = (await drawer(page).locator(".mobile-drawer-item").allInnerTexts()).map((text) => text.trim());
  expect(listed).toEqual(allowed);
  expect(listed).not.toContain("Money");
  expect(listed).not.toContain("Settings");
});

test("desktop: no mobile header or drawer; module buttons unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, "owner@taxiflow.local");
  await expect(page.getByTestId("mobile-topbar")).toBeHidden();
  expect(await moduleLabels(page)).toEqual(["Overview", "Money", "Fleet & Operations", "Drivers", "Reports", "Settings"]);
});
