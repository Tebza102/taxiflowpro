import { expect, test } from "@playwright/test";

import { BUSINESS_A_ID, BUSINESS_B_ID, LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Business and vehicle reports in tenant mode (LOCAL stack, synthetic
// @example.com identities): the server decides access from the membership, for
// every format, and never serves another business's data. Read-only.

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

// The signed-in session's own token, used for direct requests as that person.
const statuses = (page, business) =>
  page.evaluate(async (businessId) => {
    const raw = Object.entries(window.localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const token = raw ? JSON.parse(raw[1]).access_token : null;
    const result = {};
    for (const format of ["json", "csv", "pdf"]) {
      const response = await fetch(`/api/admin/reports/period?mode=live&business=${businessId}&scope=business&period=custom&start=2026-01-01&end=2026-12-31&format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      result[format] = response.status;
    }
    return result;
  }, business);

test("Owner, Admin and Manager of business A get the report in every format", async ({ page }) => {
  for (const email of ["owner@example.com", "admin@example.com", "manager@example.com"]) {
    await signIn(page, email);
    expect(await statuses(page, BUSINESS_A_ID), email).toEqual({ json: 200, csv: 200, pdf: 200 });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  }
});

test("a Driver is refused by the server in every format", async ({ page }) => {
  await signIn(page, "driver@example.com");
  expect(await statuses(page, BUSINESS_A_ID)).toEqual({ json: 403, csv: 403, pdf: 403 });
});

test("business B's Owner cannot read business A's report", async ({ page }) => {
  await signIn(page, "owner.b@example.com");
  expect(await statuses(page, BUSINESS_A_ID)).toEqual({ json: 403, csv: 403, pdf: 403 });
  expect(await statuses(page, BUSINESS_B_ID)).toEqual({ json: 200, csv: 200, pdf: 200 });
});

test("Owner A generates the business report on screen from the business's own data", async ({ page }) => {
  await signIn(page, "owner@example.com");
  await page.locator("button.module-button").filter({ hasText: "Reports" }).first().click();
  await page.getByTestId("period-report-period").selectOption("custom");
  await page.getByTestId("period-report-start").fill("2026-01-01");
  await page.getByTestId("period-report-end").fill("2026-12-31");
  const response = page.waitForResponse((r) => r.url().includes("/api/admin/reports/period") && r.url().includes("mode=live"));
  await page.getByTestId("period-report-view").click();
  const body = await (await response).json();
  expect((await response).status()).toBe(200);
  expect(body.meta).toEqual({ source: "live", businessId: BUSINESS_A_ID });
  await expect(page.getByTestId("period-report-dates")).toHaveText("1 Jan 2026 to 31 Dec 2026");
  await expect(page.getByTestId("period-report-notes")).toContainText("Totals reconcile with the lines.");
  expect(JSON.stringify(body)).not.toContain("-b\"");
});
