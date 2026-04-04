import { expect, test } from "@playwright/test";

const PASSWORD = "TaxiFlow.123";

const ownerAccount = {
  email: "owner@taxiflow.local",
  role: "Owner",
};

const managementAccounts = [
  { email: "manager@taxiflow.local", role: "Manager" },
  { email: "admin@taxiflow.local", role: "Admin" },
];

const driverAccount = {
  email: "driver.one@taxiflow.local",
  role: "Driver",
};

const attachRuntimeCollectors = (page) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return () => {
    expect.soft(consoleErrors, "browser console errors").toEqual([]);
    expect.soft(pageErrors, "browser page errors").toEqual([]);
  };
};

const primaryNav = (page) => page.getByRole("navigation", { name: "Primary views" });

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

const openModule = async (page, moduleLabel, expectedHeading) => {
  await primaryNav(page).getByRole("button", { name: new RegExp(moduleLabel, "i") }).click();
  await expect(page.getByRole("heading", { name: expectedHeading })).toBeVisible();
};

test("owner can reach every main module and see embedded compliance", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await expect(page.getByText(ownerAccount.role).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily flow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service and document alerts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Expiring documents" })).toBeVisible();

  await openModule(page, "Money", "Daily trip entry");
  await openModule(page, "Fleet", "Fleet overview");
  await openModule(page, "Drivers", "Terminal preview");
  await openModule(page, "Settings", "Roles and rights");

  await signOut(page);
  assertNoRuntimeErrors();
});

test("manager and admin land on overview and keep access to operational modules only", async ({
  page,
}) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  for (const account of managementAccounts) {
    await signIn(page, account.email);
    await expect(page.getByText(account.role).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily flow" })).toBeVisible();
    await expect(
      primaryNav(page).getByRole("button", { name: /^Settings/i }),
    ).toHaveCount(0);

    await openModule(page, "Money", "Daily trip entry");
    await openModule(page, "Fleet", "Fleet overview");
    await openModule(page, "Drivers", "Terminal preview");

    await signOut(page);
  }

  assertNoRuntimeErrors();
});

test("driver lands in the driver terminal and only sees allowed modules", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, driverAccount.email);
  await expect(page.getByText(driverAccount.role).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terminal preview" })).toBeVisible();
  await expect(primaryNav(page).getByRole("button", { name: /Money/i })).toHaveCount(0);
  await expect(primaryNav(page).getByRole("button", { name: /^Settings/i })).toHaveCount(0);

  await openModule(page, "Overview", "Quick actions");
  await expect(page.getByRole("heading", { name: "My alerts" })).toBeVisible();
  await openModule(page, "Fleet", "Fleet overview");
  await openModule(page, "Drivers", "Terminal preview");

  await signOut(page);
  assertNoRuntimeErrors();
});
