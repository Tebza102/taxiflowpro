import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { assertLocalDatabase } from "../../scripts/localdb/lib/exec.mjs";
import { activateViaEmail } from "../../scripts/localdb/lib/mailpit.mjs";
import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";

// Business access role check (2026-10-11 release row 12): the access dropdown
// showed Manager but the grant recorded Admin. Cause: browser automation changed
// the dropdown without the change event a real selection fires. Every role chosen
// as a person does (pointer or keyboard) must save exactly as chosen, persist
// after a reload, and get the matching server permissions.
// LOCAL stack, synthetic @example.com identities only.

test.describe.configure({ mode: "serial" });

const OWNER = "owner.roles@example.com";
const people = {
  Manager: "manager.roles@example.com",
  Admin: "admin.roles@example.com",
  Driver: "driver.roles@example.com",
  // Chosen with the keyboard the way a person does (focus, arrow keys).
  Keyboard: "keyboard.roles@example.com",
};

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
const row = (page, email) => page.getByTestId("tenant-access").getByTestId("access-row").filter({ hasText: email });

// What the server allows the signed-in person to do, by role.
const serverPermissions = (page) =>
  page.evaluate(async () => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const headers = { Authorization: `Bearer ${JSON.parse(raw[1]).access_token}`, "Content-Type": "application/json" };
    const workspace = await fetch("/api/business/workspace", { headers });
    const body = workspace.ok ? await workspace.json() : null;
    const members = await fetch("/api/business/members", { headers });
    const verify = await fetch("/api/business/finance-actions", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "cashup.verify", requestId: crypto.randomUUID(), expectedVersion: body?.version, fields: { cashUpId: "no-such-cashup", actualCashReceived: 1 } }),
    });
    return { role: body?.role, viewAccess: members.status === 200, verifyCashUp: verify.status !== 403 };
  });

test("every assignable role saves as chosen, persists, and gets the matching server permissions", async ({ browser }) => {
  const out = execFileSync(process.execPath, [
    "scripts/localdb/onboard-business.mjs", "--slug", "pilot-roles", "--name", "Pilot Roles Taxis",
    "--owner-email", OWNER, "--owner-name", "Roles Owner",
  ], { encoding: "utf8" });
  expect(JSON.parse(out).status).toBe("created");
  await activate(OWNER);

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, OWNER);
  await openAccess(owner);
  const access = owner.getByTestId("tenant-access");
  const roleSelect = access.getByRole("combobox", { name: "Access", exact: true });
  const grant = async (email, role, choose) => {
    await access.getByLabel("Email", { exact: true }).fill(email);
    await choose();
    if (role === "Driver") await access.getByRole("combobox", { name: /^Driver profile/ }).selectOption({ label: "Roles Driver" });
    await expect(roleSelect).toHaveValue(role);
    await access.getByRole("button", { name: "Grant access" }).click();
    await expect(access.getByRole("status")).toContainText(`${email} can now sign in as ${role}.`);
    await expect(row(owner, email)).toContainText(`${email} / ${role}`);
  };

  await access.getByLabel("Driver name").fill("Roles Driver");
  await access.getByRole("button", { name: "Add driver profile" }).click();
  await expect(access.getByRole("status")).toContainText("Driver profile Roles Driver added.");

  // Manager first: it is not the default, so a stale default cannot pass.
  for (const role of ["Manager", "Admin", "Driver"]) await grant(people[role], role, () => roleSelect.selectOption(role));

  // A person using the keyboard: Admin is the default, ArrowDown moves to Manager.
  await grant(people.Keyboard, "Manager", async () => {
    await roleSelect.focus();
    await owner.keyboard.press("ArrowDown");
  });

  // Persisted: a fresh page load shows the same roles.
  await owner.reload();
  await openAccess(owner);
  for (const [key, email] of Object.entries(people)) await expect(row(owner, email)).toContainText(`${email} / ${key === "Keyboard" ? "Manager" : key}`);

  const expected = {
    Manager: { role: "Manager", viewAccess: false, verifyCashUp: true },
    Admin: { role: "Admin", viewAccess: true, verifyCashUp: false },
    Driver: { role: "Driver", viewAccess: false, verifyCashUp: false },
    Keyboard: { role: "Manager", viewAccess: false, verifyCashUp: true },
  };
  for (const [key, email] of Object.entries(people)) {
    await activate(email);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, email);
    expect(await serverPermissions(page), email).toEqual(expected[key]);
    await context.close();
  }
  await ownerContext.close();
});
