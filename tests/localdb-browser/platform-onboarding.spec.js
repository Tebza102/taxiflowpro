
import { expect, test } from "@playwright/test";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "../../scripts/localdb/lib/exec.mjs";
import { activateViaEmail } from "../../scripts/localdb/lib/mailpit.mjs";
import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";

// Platform onboarding in the browser, LOCAL stack with real local Auth:
// the operator grants platform admin to an existing login (an Admin of the
// existing business, Tenant 1); that login opens Companies, sees Tenant 1 and
// creates a second company with its Owner; the Owner sets their own password
// from the email, onboards a Manager and a Driver; each person sees only their
// own company, and the Tenant 1 Owner sees no Companies console.
// Synthetic @example.com identities only. Requires a fresh `setup.mjs reset`.

test.describe.configure({ mode: "serial" });

const PLATFORM = "admin@example.com"; // Admin of Tenant 1 in the seed
const OWNER = "owner.fleet@example.com";
const MANAGER = "manager.fleet@example.com";
const DRIVER = "driver.fleet@example.com";

const activate = async (email) => {
  const status = assertLocalDatabase();
  const result = await activateViaEmail({ apiUrl: status.apiUrl, anonKey: status.ANON_KEY, email, password: LOCAL_TEST_PASSWORD });
  expect(result.error ?? null).toBeNull();
};
const signIn = async (page, email) => {
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

test("platform admin creates a company and its Owner onboards staff; companies stay isolated", async ({ browser }) => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
  psql(`insert into public.platform_admins (user_id, note) select id, 'local browser test' from auth.users where email = '${PLATFORM}' on conflict (user_id) do update set active = true;`);

  // The Tenant 1 Owner is not a platform admin: no Companies button.
  const tenantOwnerContext = await browser.newContext();
  const tenantOwner = await tenantOwnerContext.newPage();
  await signIn(tenantOwner, "owner@example.com");
  await expect(tenantOwner.getByTestId("tenant-bar")).toContainText("TaxiFlow Pro");
  await tenantOwner.waitForTimeout(1500);
  await expect(tenantOwner.getByTestId("tenant-bar").getByRole("button", { name: "Companies" })).toHaveCount(0);

  // Platform admin: still Admin in Tenant 1, plus the Companies console.
  const platformContext = await browser.newContext();
  const platform = await platformContext.newPage();
  await signIn(platform, PLATFORM);
  await expect(platform.getByTestId("tenant-bar")).toContainText("TaxiFlow Pro");
  await platform.getByTestId("tenant-bar").getByRole("button", { name: "Companies" }).click();
  const consoleCard = platform.getByTestId("platform-console");
  await expect(consoleCard).toBeVisible();
  await expect(platform.getByTestId("platform-company-row").first()).toContainText("Tenant 1: TaxiFlow Pro");
  await expect(platform.getByTestId("platform-company-row").first()).toContainText("owner@example.com");

  const form = platform.getByTestId("platform-create-company");
  await form.getByLabel("Company name").fill("Browser Fleet Taxis");
  await expect(form.getByLabel("Company id (slug)")).toHaveValue("browser-fleet-taxis");
  await form.getByLabel("Owner name").fill("Fleet Owner");
  await form.getByLabel("Owner email").fill(OWNER);
  await form.getByRole("button", { name: "Create company and invite Owner" }).click();
  await expect(consoleCard.getByRole("status")).toContainText(`Browser Fleet Taxis created. A password-setup email was sent to ${OWNER}.`);
  await expect(platform.getByTestId("platform-company-row").filter({ hasText: "Browser Fleet Taxis" })).toContainText("Tenant 3");
  await expect(platform.getByTestId("platform-company-row").filter({ hasText: "Browser Fleet Taxis" })).toContainText(OWNER);

  // Self-ownership is refused; the same details again change nothing.
  await form.getByLabel("Company name").fill("Self Owned Taxis");
  await form.getByLabel("Owner email").fill(PLATFORM);
  await form.getByRole("button", { name: "Create company and invite Owner" }).click();
  await expect(consoleCard.getByRole("status")).toContainText("cannot make themselves the Owner");
  await form.getByLabel("Company name").fill("Browser Fleet Taxis");
  await form.getByLabel("Owner email").fill(OWNER);
  await form.getByRole("button", { name: "Create company and invite Owner" }).click();
  await expect(consoleCard.getByRole("status")).toContainText("already exists with this Owner. Nothing was changed.");
  await expect(platform.getByTestId("platform-company-row")).toHaveCount(3);

  // Back to the business: the platform admin has no access to the new company.
  await consoleCard.getByRole("button", { name: "Back to my business" }).click();
  await expect(platform.getByTestId("tenant-bar")).toContainText("TaxiFlow Pro");
  await expect(platform.getByTestId("tenant-bar")).not.toContainText("Browser Fleet Taxis");

  // The new Owner sets their own password from the email and onboards staff.
  await activate(OWNER);
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, OWNER);
  await expect(owner.getByTestId("tenant-bar")).toContainText("Browser Fleet Taxis");
  await expect(owner.locator("body")).not.toContainText("TaxiFlow Pro (");
  await owner.waitForTimeout(1500);
  await expect(owner.getByTestId("tenant-bar").getByRole("button", { name: "Companies" })).toHaveCount(0);
  await openAccess(owner);
  const access = owner.getByTestId("tenant-access");
  const status = access.getByRole("status");
  await access.getByLabel("Driver name").fill("Fleet Driver");
  await access.getByRole("button", { name: "Add driver profile" }).click();
  await expect(status).toContainText("Driver profile Fleet Driver added.");
  await access.getByLabel("Email", { exact: true }).fill(DRIVER);
  await access.getByRole("combobox", { name: "Access", exact: true }).selectOption("Driver");
  await access.getByRole("combobox", { name: /^Driver profile/ }).selectOption({ label: "Fleet Driver" });
  await access.getByRole("button", { name: "Grant access" }).click();
  await expect(status).toContainText(`${DRIVER} can now sign in as Driver. A password setup email was sent.`);
  await access.getByLabel("Email", { exact: true }).fill(MANAGER);
  await access.getByLabel("Name", { exact: true }).fill("Fleet Manager");
  await access.getByRole("combobox", { name: "Access", exact: true }).selectOption("Manager");
  await access.getByRole("button", { name: "Grant access" }).click();
  await expect(status).toContainText(`${MANAGER} can now sign in as Manager.`);
  await owner.reload();
  await openAccess(owner);
  await expect(owner.getByTestId("access-row")).toHaveCount(3);

  // The Driver and Manager each see only the new company.
  await activate(DRIVER);
  await activate(MANAGER);
  for (const email of [DRIVER, MANAGER]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, email);
    await expect(page.getByTestId("tenant-bar")).toContainText("Browser Fleet Taxis");
    await expect(page.locator("body")).not.toContainText("TaxiFlow Pro (");
    const crossRead = await page.evaluate(async () => {
      const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
      const token = raw ? JSON.parse(raw[1]).access_token : null;
      const headers = { Authorization: `Bearer ${token}` };
      const tenant1 = await fetch("/api/business/workspace?business=10000000-0000-4000-8000-00000000000a", { headers });
      const platformList = await fetch("/api/platform/businesses", { headers });
      return { tenant1: tenant1.status, platform: platformList.status };
    });
    expect(crossRead).toEqual({ tenant1: 403, platform: 403 });
    await context.close();
  }

  // The Tenant 1 Owner still sees exactly their own business and people.
  await tenantOwner.reload();
  await expect(tenantOwner.getByTestId("tenant-bar")).toContainText("TaxiFlow Pro");
  await expect(tenantOwner.locator("body")).not.toContainText("Browser Fleet Taxis");
  await openAccess(tenantOwner);
  await expect(tenantOwner.getByTestId("access-row").filter({ hasText: "fleet@example.com" })).toHaveCount(0);

  for (const context of [tenantOwnerContext, platformContext, ownerContext]) await context.close();
});
