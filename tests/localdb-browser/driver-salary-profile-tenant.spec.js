import { expect, test } from "@playwright/test";

import { LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Salary settings in the driver profile, tenant mode (LOCAL stack, synthetic
// identities, business B). The server decides: driver.save never carries salary,
// salary.arrangement_save needs Money edit access, and the complete
// profile -> payment -> report flow is read back from the server.

test.describe.configure({ mode: "serial" });

const NAME = "Profile Flow B";
const MONTH = new Date().toLocaleDateString("en-CA").slice(0, 7);

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const api = (page, method, path, body = null) =>
  page.evaluate(async ({ method, path, body }) => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = JSON.parse(raw[1]).access_token;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let payload = body;
    if (body?.action && path.includes("finance-actions")) {
      const workspace = await fetch("/api/business/workspace", { headers }).then((r) => r.json());
      payload = { ...body, requestId: crypto.randomUUID(), expectedVersion: workspace.version };
    }
    const response = await fetch(path, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { method, path, body });
const workspace = async (page) => (await api(page, "GET", "/api/business/workspace")).body;

test("Owner B: new driver with a salary in the profile; no payment; the profile carries no salary", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  const before = await workspace(page);
  const salaryRecordsBefore = before.snapshot.financeTransactions.filter((record) => record.salaryPayment).length;

  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  const form = page.getByTestId("driver-profile-form");
  await form.getByRole("button", { name: "Add driver" }).click();
  await form.getByLabel("Full name").fill(NAME);
  const salary = form.getByTestId("driver-profile-salary");
  await salary.getByTestId("driver-profile-salary-enable").check();
  await salary.getByLabel("Salary amount (R)").fill("4300");
  await salary.getByLabel("Salary starts on").fill(`${MONTH}-01`);
  await salary.getByLabel("When it is paid").selectOption("end");
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`${NAME} added to the driver roster. Salary schedule saved. No expense was added.`)).toBeVisible({ timeout: 30_000 });

  const after = await workspace(page);
  const driver = after.snapshot.drivers.find((item) => item.name === NAME);
  expect(driver).toBeTruthy();
  expect(Object.keys(driver).filter((key) => /salary|pay/i.test(key))).toEqual([]);
  const arrangement = after.snapshot.finance.salaryArrangements.find((item) => item.driverStaffId === driver.staffId);
  expect(arrangement).toMatchObject({ amount: 4300, frequency: "monthly", payTiming: "end", active: true, revision: 1 });
  expect(after.snapshot.financeTransactions.filter((record) => record.salaryPayment).length).toBe(salaryRecordsBefore);

  // The server refuses salary fields on a profile save, and a second "new" schedule.
  const smuggled = await api(page, "POST", "/api/business/finance-actions", { action: "driver.save", fields: { staffId: driver.staffId, name: NAME, salaryAmount: 1 } });
  expect(smuggled.status).toBe(400);
  const overwrite = await api(page, "POST", "/api/business/finance-actions", {
    action: "salary.arrangement_save",
    fields: { driverStaffId: driver.staffId, amount: 1, frequency: "monthly", payMethod: "bank", startDate: `${MONTH}-01` },
  });
  expect(overwrite.status).toBe(409);
  expect((await workspace(page)).snapshot.finance.salaryArrangements.find((item) => item.driverStaffId === driver.staffId).amount).toBe(4300);

  // Editing shows the existing arrangement.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  await page.getByRole("button", { name: `Edit profile: ${NAME}` }).click();
  await expect(page.getByTestId("driver-profile-salary-current")).toContainText("monthly, at the end of each period");
  await expect(page.getByTestId("driver-profile-salary").getByLabel("Salary amount (R)")).toHaveValue("4300");
});

test("Owner B: payment recorded in Money, then the server's business report lists it once and no vehicle report has it", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  await page.getByRole("button", { name: `Edit profile: ${NAME}` }).click();
  await page.getByTestId("driver-profile-salary-payments").click();
  const panel = page.getByTestId("driver-salaries");
  await expect(panel.getByRole("heading", { name: "Driver salaries" })).toBeVisible();
  await panel.getByTestId("salary-schedule-row").filter({ hasText: NAME }).getByRole("button", { name: "Record payment" }).click();
  const paymentForm = page.getByRole("form", { name: "Record salary payment" });
  await expect(paymentForm.getByLabel("Amount paid (R)")).toHaveValue("4300");
  await paymentForm.getByRole("button", { name: "Record payment" }).click();
  await expect(panel.getByText("Salary payment recorded and added to expenses once.")).toBeVisible({ timeout: 30_000 });

  await page.locator("button.module-button").filter({ hasText: "Reports" }).first().click();
  await page.getByTestId("period-report-period").selectOption("monthly");
  await page.getByTestId("period-report-month").fill(MONTH);
  const response = page.waitForResponse((r) => r.url().includes("/api/admin/reports/period") && r.url().includes("format=json"));
  await page.getByTestId("period-report-view").click();
  const report = await (await response).json();
  const lines = report.transactions.filter((line) => line.salary && line.driver === NAME);
  expect(lines).toHaveLength(1);
  expect(lines[0].amountCents).toBe(430000);
  expect(report.reconciliation.ok).toBe(true);
  await expect(page.getByTestId("period-report-transactions").locator("tr").filter({ hasText: `Driver salary / ${NAME}` })).toHaveCount(1);

  for (const vehicle of (await workspace(page)).snapshot.vehicles ?? []) {
    const vehicleReport = await api(page, "GET", `/api/admin/reports/period?mode=live&scope=vehicle&vehicle=${encodeURIComponent(vehicle.id)}&period=monthly&month=${MONTH}`);
    expect(vehicleReport.status).toBe(200);
    expect(vehicleReport.body.transactions.some((line) => line.salary)).toBe(false);
  }
});

test("Driver B cannot change salary settings and receives none", async ({ page }) => {
  await signIn(page, "driver.b@example.com");
  const refused = await api(page, "POST", "/api/business/finance-actions", {
    action: "salary.arrangement_save",
    fields: { driverStaffId: "uat-drv-b-01", amount: 99999, frequency: "monthly", payMethod: "bank", startDate: `${MONTH}-01` },
  });
  expect(refused.status).toBe(403);
  expect((await workspace(page)).snapshot.finance?.salaryArrangements).toBeUndefined();
  await expect(page.getByTestId("driver-profile-salary")).toHaveCount(0);
});

test("partial save: the driver saves, the salary fails; the exact outcome is shown, inputs kept, retry adds no second driver", async ({ page }) => {
  const PARTIAL = "Partial Save B";
  await signIn(page, "owner.b@example.com");
  // Fail only the first salary.arrangement_save; driver.save goes through.
  let failed = false;
  await page.route("**/api/business/finance-actions**", async (route) => {
    const body = route.request().postDataJSON?.() ?? null;
    if (!failed && body?.action === "salary.arrangement_save") {
      failed = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Salary service unavailable (test)." }) });
    }
    return route.continue();
  });

  await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
  const form = page.getByTestId("driver-profile-form");
  await form.getByRole("button", { name: "Add driver" }).click();
  await form.getByLabel("Full name").fill(PARTIAL);
  const salary = form.getByTestId("driver-profile-salary");
  await salary.getByTestId("driver-profile-salary-enable").check();
  await salary.getByLabel("Salary amount (R)").fill("3900");
  await salary.getByLabel("How often").selectOption("weekly");
  await salary.getByLabel("Salary starts on").fill(`${MONTH}-01`);
  await form.getByRole("button", { name: "Save driver" }).click();

  await expect(page.getByText(`${PARTIAL} added to the driver roster. The salary was not saved: Salary service unavailable (test).`)).toBeVisible({ timeout: 30_000 });
  expect(failed).toBe(true);
  // The form stays on the saved driver with the salary inputs as typed.
  await expect(form.getByRole("heading", { name: `Edit driver: ${PARTIAL}` })).toBeVisible();
  await expect(salary.getByLabel("Salary amount (R)")).toHaveValue("3900");
  await expect(salary.getByLabel("How often")).toHaveValue("weekly");
  let ws = await workspace(page);
  expect(ws.snapshot.drivers.filter((driver) => driver.name === PARTIAL)).toHaveLength(1);
  const staffId = ws.snapshot.drivers.find((driver) => driver.name === PARTIAL).staffId;
  expect(ws.snapshot.finance.salaryArrangements.some((item) => item.driverStaffId === staffId)).toBe(false);

  // Retry: the profile is updated (not duplicated) and the salary is saved once.
  await form.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`${PARTIAL} updated in the driver roster. Salary schedule saved. No expense was added.`)).toBeVisible({ timeout: 30_000 });
  ws = await workspace(page);
  expect(ws.snapshot.drivers.filter((driver) => driver.name === PARTIAL)).toHaveLength(1);
  expect(ws.snapshot.finance.salaryArrangements.filter((item) => item.driverStaffId === staffId)).toEqual([
    expect.objectContaining({ amount: 3900, frequency: "weekly", revision: 1 }),
  ]);
});

test("permission split: salary-only and driver-management-only Managers each keep exactly their own access", async ({ page }) => {
  const MANAGER_B = "00000000-0000-4000-8000-0000000000b2";
  await signIn(page, "owner.b@example.com");
  const original = (await api(page, "GET", "/api/business/members")).body.members.find((member) => member.userId === MANAGER_B);
  const setAccess = async (permissions, finance) => {
    expect((await api(page, "POST", "/api/business/members", { action: "member.permissions", fields: { userId: MANAGER_B, permissions } })).status).toBe(200);
    expect((await api(page, "POST", "/api/business/members", { action: "member.update", fields: { userId: MANAGER_B, moduleAccess: { ...original.moduleAccess, finance } } })).status).toBe(200);
  };
  const ownerPage = page;

  try {
    // 1. Salary only: Money on, no driver-profile management.
    await setAccess(["cash.verify", "cash.bank"], true);
    await ownerPage.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "manager.b@example.com");
    await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
    await expect(page.getByRole("button", { name: `Edit profile: ${NAME}` })).toHaveCount(0);
    await page.getByRole("button", { name: `Salary settings: ${NAME}` }).click();
    const form = page.getByTestId("driver-profile-form");
    await expect(form.getByLabel("Full name")).toBeDisabled();
    await form.getByTestId("driver-profile-salary").getByLabel("Salary amount (R)").fill("4400");
    await form.getByRole("button", { name: "Save salary" }).click();
    await expect(page.getByText("Salary schedule saved. No expense was added.")).toBeVisible({ timeout: 30_000 });
    const driverStaffId = (await workspace(page)).snapshot.drivers.find((item) => item.name === NAME).staffId;
    expect((await api(page, "POST", "/api/business/finance-actions", { action: "driver.save", fields: { staffId: driverStaffId, name: "Renamed by salary-only" } })).status).toBe(403);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });

    // 2. Driver management only: profiles yes, Money off, no salary anywhere.
    await signIn(page, "owner.b@example.com");
    await setAccess(["drivers.manage"], false);
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "manager.b@example.com");
    await expect(page.locator("button.module-button").filter({ hasText: "Money" })).toHaveCount(0);
    await page.locator("button.module-button").filter({ hasText: "Drivers" }).first().click();
    await page.getByRole("button", { name: `Edit profile: ${NAME}` }).click();
    await expect(page.getByTestId("driver-profile-form").getByLabel("Full name")).toBeEnabled();
    await expect(page.getByTestId("driver-profile-salary")).toHaveCount(0);
    const view = await workspace(page);
    expect(view.snapshot.finance?.salaryArrangements).toBeUndefined();
    expect((view.snapshot.financeTransactions ?? []).some((record) => record.salaryPayment)).toBe(false);
    expect((await api(page, "POST", "/api/business/finance-actions", {
      action: "salary.arrangement_save",
      fields: { driverStaffId, amount: 1, frequency: "monthly", payMethod: "bank", startDate: `${MONTH}-01`, revision: 2 },
    })).status).toBe(403);
    expect((await api(page, "POST", "/api/business/finance-actions", { action: "driver.save", fields: { staffId: driverStaffId, name: NAME } })).status).toBe(200);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  } finally {
    // Restore Manager B exactly as it was for the other suites.
    await signIn(page, "owner.b@example.com");
    await api(page, "POST", "/api/business/members", { action: "member.permissions", fields: { userId: MANAGER_B, permissions: original.permissions ?? ["cash.verify", "cash.bank"] } });
    await api(page, "POST", "/api/business/members", { action: "member.update", fields: { userId: MANAGER_B, moduleAccess: original.moduleAccess } });
  }
});
