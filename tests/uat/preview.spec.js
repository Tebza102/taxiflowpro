import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { vercelBypassHeaders } from "../../playwright.uat.config.mjs";

// Preview release-gate suite. Runs against a live deployed Preview URL (real
// Supabase Auth, real workspace_snapshots data) - see playwright.uat.config.mjs.
// All inputs come from environment variables set by scripts/uat/run-preview-uat.mjs;
// nothing here is hardcoded to a specific account or record, and nothing is ever
// printed that would leak a password or token into test output.
//
// Test titles are read directly by the orchestrator's JSON-report parser to build
// the release-gate scorecard - do not rename a test without updating
// scripts/uat/run-preview-uat.mjs's TEST_TITLE_TO_SCORECARD_KEY map.

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the Preview UAT suite.`);
  }
  return value;
};

const OWNER_EMAIL = required("UAT_OWNER_EMAIL");
const OWNER_PASSWORD = required("UAT_OWNER_PASSWORD");
const DISPOSABLE_EMAIL = required("UAT_DISPOSABLE_EMAIL");
const DISPOSABLE_PASSWORD = required("UAT_DISPOSABLE_PASSWORD");
const DISPOSABLE_ROLE = process.env.UAT_DISPOSABLE_ROLE || "Manager";
const RECOVERY_NEW_PASSWORD = required("UAT_RECOVERY_NEW_PASSWORD");
const RUN_TAG = required("UAT_RUN_TAG");
// Where this suite writes the captured client-side Supabase project ref for the
// orchestrator to read back and compare against the server-side ref it derived
// from its own SUPABASE_URL - the match decision and printing happen there, not
// here, so this file never needs to know the server-side value at all.
const CLIENT_REF_OUTPUT_PATH = required("UAT_CLIENT_REF_OUTPUT_PATH");

// Minted by the orchestrator right before invoking Playwright via
// supabase.auth.admin.generateLink (see scripts/uat/lib/recoveryLink.mjs) - the same
// GoTrue recovery mechanism a real "Forgot password?" email would point at.
const RECOVERY_ACTION_LINK = required("UAT_RECOVERY_ACTION_LINK");

const capturedClientSupabaseHosts = new Set();

const signIn = async (page, email, password) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const signOut = async (page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
};

const expectSessionIdentity = async (page, { role, email }) => {
  const panel = page.locator(".auth-session-panel");
  await expect(panel.locator(".status-chip").first()).toHaveText(role);
  await expect(panel).toContainText(email);
};

// The primary module nav's accessible label for the Finance module is "Money"
// (see MODULE_VIEW_ACCESS.finance.label in src/lib/appRuntime.js), not "Finance".
const openFinanceModule = async (page) => {
  await page.getByRole("button", { name: "Money" }).click();
};

const openRevenueTab = async (page) => {
  await openFinanceModule(page);
  await page.getByRole("button", { name: "Daily Earnings" }).click();
};

const openBankingTab = async (page) => {
  await openFinanceModule(page);
  await page.getByRole("button", { name: "Banking" }).click();
};

const financeQueueCard = (page, runTag) => page.locator(".queue-card", { hasText: runTag });

const createFinanceUatRecord = async (page, runTag) => {
  await openRevenueTab(page);

  const form = page.locator("article", { hasText: "Extra trip entry" });
  await expect(form).toBeVisible({ timeout: 30_000 });

  // Pick whichever vehicle already exists - this suite never assumes fleet
  // composition, only that at least one vehicle is registered.
  const vehicleSelect = form.getByLabel("Vehicle");
  const firstVehicleValue = await vehicleSelect.locator("option").first().getAttribute("value");
  await vehicleSelect.selectOption(firstVehicleValue);

  const today = new Date().toISOString().slice(0, 10);
  await form.getByLabel("Date").fill(today);
  await form.getByLabel("Opening odo").fill("1000");
  await form.getByLabel("Closing odo").fill("1010");
  await form.getByLabel("From").fill("UAT-PROBE");
  await form.getByLabel("To").fill(runTag);
  await form.getByLabel("Reason").fill(`Preview release-gate UAT ${runTag}`);
  await form.getByLabel("Actual fuel & oil cost").fill("0");
  await form.getByLabel("Actual repairs & maintenance cost").fill("0");
  await form.getByLabel("Amount").fill("1");

  await form.getByRole("button", { name: "Save trip" }).click();

  await openBankingTab(page);
  await expect(financeQueueCard(page, runTag)).toBeVisible({ timeout: 30_000 });
  await expect(financeQueueCard(page, runTag)).toContainText("Pending");
};

const attachSupabaseHostCapture = (page) => {
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname.endsWith(".supabase.co")) {
        capturedClientSupabaseHosts.add(url.hostname);
      }
    } catch {
      // ignore malformed URLs
    }
  });
};

test.describe.serial("Preview release gate", () => {
  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders });
    page = await context.newPage();
    attachSupabaseHostCapture(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("Owner login", async () => {
    await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expectSessionIdentity(page, { role: "Owner", email: OWNER_EMAIL });
  });

  test("Environment ref capture", async () => {
    const hosts = [...capturedClientSupabaseHosts];
    expect(
      hosts.length,
      "expected the Owner login to trigger at least one request to *.supabase.co so the client " +
        "project ref could be captured",
    ).toBeGreaterThan(0);

    const refs = new Set(hosts.map((h) => h.split(".")[0]));
    expect(
      refs.size,
      `client requests hit more than one distinct Supabase project during the session: ${hosts.join(", ")}`,
    ).toBe(1);

    const [clientRef] = refs;
    // The match-vs-server-ref decision and the printed Server/Client/MATCH lines
    // happen in the orchestrator (it derives the server ref itself from its own
    // SUPABASE_URL) - this test only has to prove a single, stable client ref was
    // observed and hand it back.
    await writeFile(CLIENT_REF_OUTPUT_PATH, JSON.stringify({ clientRef }), "utf8");
  });

  test("New-user login", async () => {
    await signOut(page);
    await signIn(page, DISPOSABLE_EMAIL, DISPOSABLE_PASSWORD);
    await expectSessionIdentity(page, { role: DISPOSABLE_ROLE, email: DISPOSABLE_EMAIL });
    await signOut(page);
  });

  test("Recovery application", async () => {
    // Navigate directly to the admin-minted recovery link (same GoTrue verify
    // endpoint a real recovery email points at). The app's onAuthStateChange
    // listener must detect PASSWORD_RECOVERY and switch to PasswordRecoveryShell
    // ahead of normal routing.
    await page.goto(RECOVERY_ACTION_LINK);

    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByLabel("New password").fill(RECOVERY_NEW_PASSWORD);
    await page.getByLabel("Confirm password").fill(RECOVERY_NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();

    // Recovery session is signed out on success and the app returns to normal
    // sign-in - prove the new password actually works end to end.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
    await signIn(page, DISPOSABLE_EMAIL, RECOVERY_NEW_PASSWORD);
    await expectSessionIdentity(page, { role: DISPOSABLE_ROLE, email: DISPOSABLE_EMAIL });
    await signOut(page);
  });

  test("Persistence (fresh context)", async ({ browser }) => {
    await signIn(page, OWNER_EMAIL, OWNER_PASSWORD);
    await createFinanceUatRecord(page, RUN_TAG);

    const freshContext = await browser.newContext({ extraHTTPHeaders: vercelBypassHeaders });
    try {
      const freshPage = await freshContext.newPage();
      await signIn(freshPage, OWNER_EMAIL, OWNER_PASSWORD);
      await openBankingTab(freshPage);
      await expect(financeQueueCard(freshPage, RUN_TAG)).toBeVisible({ timeout: 30_000 });
      await expect(financeQueueCard(freshPage, RUN_TAG)).toContainText("Pending");
    } finally {
      await freshContext.close();
    }
  });

  test("Finance: pending to counted", async () => {
    await openBankingTab(page);
    const card = financeQueueCard(page, RUN_TAG);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.locator(".verification-input").fill("1");
    await card.getByRole("button", { name: "Record hand-in" }).click();
    await expect(card.locator(".status-chip").first()).toHaveText("Counted", { timeout: 30_000 });

    await page.reload();
    await openBankingTab(page);
    await expect(financeQueueCard(page, RUN_TAG).locator(".status-chip").first()).toHaveText(
      "Counted",
    );
  });

  test("Finance: counted to verified", async () => {
    await openBankingTab(page);
    const card = financeQueueCard(page, RUN_TAG);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.locator(".verification-input").fill("1");
    await card.getByRole("button", { name: "Verify checking" }).click();
    await expect(card.locator(".status-chip").first()).toHaveText("Verified", { timeout: 30_000 });

    await page.reload();
    await openBankingTab(page);
    await expect(financeQueueCard(page, RUN_TAG).locator(".status-chip").first()).toHaveText(
      "Verified",
    );
  });

  test("Cleanup: finance UAT record", async () => {
    await openBankingTab(page);
    const card = financeQueueCard(page, RUN_TAG);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Delete entry" }).click();
    await expect(financeQueueCard(page, RUN_TAG)).toHaveCount(0, { timeout: 30_000 });

    await page.reload();
    await openBankingTab(page);
    await expect(financeQueueCard(page, RUN_TAG)).toHaveCount(0);
  });
});
