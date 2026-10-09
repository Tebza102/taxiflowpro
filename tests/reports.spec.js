import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const PASSWORD = "TaxiFlow.123";
const FILENAME_PATTERN = /^taxiflow-daily-finance-\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\.pdf$/;

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

const pdfText = (buffer) =>
  (buffer.toString("latin1").match(/<[0-9a-fA-F]+>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1"))
    .join("");

const openReports = async (page) => {
  await moduleButton(page, "Reports").first().click();
  await expect(page.getByRole("heading", { name: "Management reports" })).toBeVisible();
  await expect(page.getByTestId("reports-preview").getByText("Expected cash hand-in")).toBeVisible({
    timeout: 30_000,
  });
};

const downloadPdf = async (page) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("reports-download").click();
  const download = await downloadPromise;
  const buffer = await readFile(await download.path());

  return { filename: download.suggestedFilename(), buffer };
};

test("owner downloads a demo Daily Finance Report as a real A4 PDF", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await signIn(page, "owner@taxiflow.local");
  await openReports(page);

  await expect(page.getByText("every PDF is marked DEMO DATA")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Report" })).toHaveValue("daily-finance");
  await expect(page.getByTestId("reports-records").locator("label.report-record-option").first()).toBeVisible();

  const { filename, buffer } = await downloadPdf(page);

  expect(filename).toMatch(FILENAME_PATTERN);
  expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(buffer.toString("latin1")).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  expect(pdfText(buffer)).toContain("DEMO DATA");
  await expect(page.getByTestId("reports-download-done")).toContainText(filename);
  expect(pageErrors).toEqual([]);
});

test("the preview and the PDF show the same variance", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openReports(page);

  const previewVariance = (await page.getByTestId("reports-variance").innerText()).trim();
  const { buffer } = await downloadPdf(page);

  expect(pdfText(buffer).replace(/ /g, " ")).toContain(previewVariance.replace(/ /g, " "));
});

test("manager and admin can open Reports", async ({ page }) => {
  for (const email of ["manager@taxiflow.local", "admin@taxiflow.local"]) {
    await signIn(page, email);
    await openReports(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  }
});

test("driver and viewer never see Reports", async ({ page }) => {
  for (const email of ["driver.one@taxiflow.local", "viewer@taxiflow.local"]) {
    await signIn(page, email);
    await expect(moduleButton(page, "Reports")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  }
});

test("the report endpoints refuse a direct live request without a signed-in session", async ({ request }) => {
  for (const name of ["report-pdf", "report-view"]) {
    const response = await request.get(`/api/admin/daily-log/txn-inc-0901/${name}?mode=live`);
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("application/json");
  }
});

test("a date with no cash-ups shows an empty state and disables download", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await openReports(page);

  await page.getByTestId("reports-date").fill("2020-01-01");

  await expect(page.getByTestId("reports-empty")).toContainText("No daily cash-ups were captured for this date.");
  await expect(page.getByTestId("reports-download")).toBeDisabled();

  await page.getByTestId("reports-empty").locator("button.cta-link").first().click();
  await expect(page.getByTestId("reports-download")).toBeEnabled({ timeout: 30_000 });
});

test("Money banking view links to Reports for management", async ({ page }) => {
  await signIn(page, "owner@taxiflow.local");
  await moduleButton(page, "Money").first().click();
  await page.getByRole("button", { name: /Banking/ }).first().click();
  await page.getByRole("button", { name: "Download reports" }).click();

  await expect(page.getByRole("heading", { name: "Management reports" })).toBeVisible();
});

test("when the Owner switches a Manager's Money off, Money and Reports disappear and stay off", async ({
  page,
}) => {
  await signIn(page, "owner@taxiflow.local");
  await moduleButton(page, "Settings").first().click();
  await expect(page.getByRole("heading", { name: "Roles and rights" })).toBeVisible();
  await page
    .locator("article.person-row")
    .filter({ hasText: "manager@taxiflow.local" })
    .getByRole("button", { name: "Manage" })
    .click();

  const accessForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save access" }),
  });
  const moneyPill = accessForm.getByRole("button", { name: "Money", exact: true });
  await expect(moneyPill).toHaveClass(/\bactive\b/);
  await moneyPill.click();
  await expect(moneyPill).not.toHaveClass(/\bactive\b/);
  await accessForm.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(/updated as Manager\./i)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, "manager@taxiflow.local");
  await expect(moduleButton(page, "Money")).toHaveCount(0);
  await expect(moduleButton(page, "Reports")).toHaveCount(0);
  await expect(moduleButton(page, "Fleet & Operations").first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await expect(moduleButton(page, "Money")).toHaveCount(0);
  await expect(moduleButton(page, "Reports")).toHaveCount(0);
});

test.describe("narrow mobile viewport", () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  test("owner downloads the PDF without horizontal scrolling", async ({ page }) => {
    await signIn(page, "owner@taxiflow.local");
    await openReports(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const { filename, buffer } = await downloadPdf(page);
    expect(filename).toMatch(FILENAME_PATTERN);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
