import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { assertLocalDatabase } from "../../scripts/localdb/lib/exec.mjs";
import { activateViaEmail } from "../../scripts/localdb/lib/mailpit.mjs";
import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Pilot onboarding in the browser (Task 18), LOCAL stack with real local Auth:
// operator creates a business + Owner, the Owner sets a password from the
// email, adds a driver profile, grants Driver and Admin access, links their own
// login as an owner-driver, and removes the Admin's access while the Admin is
// still signed in. Synthetic @example.com identities only.

test.describe.configure({ mode: "serial" });

const OWNER = "owner.browser@example.com";
const ADMIN = "admin.browser@example.com";
const DRIVER = "driver.browser@example.com";

const activate = async (email) => {
  const status = assertLocalDatabase();
  const result = await activateViaEmail({ apiUrl: status.apiUrl, anonKey: status.ANON_KEY, email, password: LOCAL_TEST_PASSWORD });
  expect(result.error ?? null).toBeNull();
};
const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};
const openAccess = async (page) => {
  await page.locator("button.module-button").filter({ hasText: "Settings" }).first().click();
  await expect(page.getByTestId("tenant-access")).toBeVisible();
  await expect(page.getByTestId("access-row").first()).toBeVisible({ timeout: 30_000 });
};
const status = (page) => page.getByTestId("tenant-access").getByRole("status");

test("operator onboards a business; the Owner grants, links and removes access in the browser", async ({ browser }) => {
  const out = execFileSync(process.execPath, [
    "scripts/localdb/onboard-business.mjs", "--slug", "pilot-browser", "--name", "Pilot Browser Taxis",
    "--owner-email", OWNER, "--owner-name", "Browser Owner",
  ], { encoding: "utf8" });
  expect(JSON.parse(out).status).toBe("created");
  await activate(OWNER);

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, OWNER);
  await expect(owner.getByTestId("tenant-bar")).toContainText("Pilot Browser Taxis");
  await openAccess(owner);
  const access = owner.getByTestId("tenant-access");

  // A driver profile exists without any sign-in.
  await access.getByLabel("Driver name").fill("Browser Driver");
  await access.getByRole("button", { name: "Add driver profile" }).click();
  await expect(status(owner)).toContainText("Driver profile Browser Driver added.");
  await expect(owner.getByTestId("driver-profile-row").filter({ hasText: "Browser Driver" })).toContainText("No sign-in");

  // Driver access linked to that profile.
  await access.getByLabel("Email", { exact: true }).fill(DRIVER);
  await access.getByRole("combobox", { name: "Access", exact: true }).selectOption("Driver");
  await access.getByRole("combobox", { name: /^Driver profile/ }).selectOption({ label: "Browser Driver" });
  await access.getByRole("button", { name: "Grant access" }).click();
  await expect(status(owner)).toContainText(`${DRIVER} can now sign in as Driver. A password setup email was sent.`);
  await expect(owner.getByTestId("driver-profile-row").filter({ hasText: "Browser Driver" })).toContainText("Has a sign-in");

  // Admin access.
  await access.getByLabel("Email", { exact: true }).fill(ADMIN);
  await access.getByLabel("Name", { exact: true }).fill("Browser Admin");
  await access.getByRole("combobox", { name: "Access", exact: true }).selectOption("Admin");
  await access.getByRole("button", { name: "Grant access" }).click();
  await expect(status(owner)).toContainText(`${ADMIN} can now sign in as Admin.`);

  // Owner-driver: the Owner's own login linked to a new profile.
  await access.getByLabel("Driver name").fill("Browser Owner (drives)");
  await access.getByRole("button", { name: "Add driver profile" }).click();
  await expect(status(owner)).toContainText("added.");
  await access.getByLabel("I also drive as").selectOption({ label: "Browser Owner (drives)" });
  await expect(status(owner)).toContainText("Your login is now linked to that driver profile.");
  await expect(owner.getByTestId("tenant-bar").getByLabel("Capture as")).toBeVisible();

  // The new Driver signs in and gets the driver view of its own profile.
  await activate(DRIVER);
  const driverContext = await browser.newContext();
  const driver = await driverContext.newPage();
  await signIn(driver, DRIVER);
  await expect(driver.getByText("Driver", { exact: true }).first()).toBeVisible();
  await expect(driver.getByText("Browser Driver").first()).toBeVisible();
  await driverContext.close();

  // The Admin signs in; the Owner removes access while the Admin stays signed in.
  await activate(ADMIN);
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN);
  await expect(admin.getByTestId("tenant-bar")).toContainText("Pilot Browser Taxis");

  await access.getByTestId("access-row").filter({ hasText: ADMIN }).getByRole("button", { name: "Remove access" }).click();
  await expect(status(owner)).toContainText(`Access removed for ${ADMIN}.`);
  await expect(access.getByTestId("access-row").filter({ hasText: ADMIN })).toContainText("access removed");

  // Same signed-in Admin session: server reads and writes are refused.
  const refused = await admin.evaluate(async () => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = raw ? JSON.parse(raw[1]).access_token : null;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const read = await fetch("/api/business/workspace", { headers });
    const write = await fetch("/api/business/finance-actions", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "capture.expense", requestId: crypto.randomUUID(), expectedVersion: new Date().toISOString(), fields: { captureAs: "management", expenseKind: "operational", category: "Fuel", description: "after removal", expenseDate: "2026-10-09", amount: 5 } }),
    });
    return { read: read.status, write: write.status, tokenPresent: Boolean(token) };
  });
  expect(refused).toEqual({ read: 403, write: 403, tokenPresent: true });
  await admin.reload();
  await expect(admin.getByText("Account not mapped")).toBeVisible({ timeout: 30_000 });
  await expect(admin.locator("body")).not.toContainText("Pilot Browser Taxis");
  await adminContext.close();
  await ownerContext.close();
});
