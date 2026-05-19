# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: driver-visibility.spec.js >> driver checking shows running cash activity and gives management an expected cash-in heads up
- Location: tests\driver-visibility.spec.js:260:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Sign out' })
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByRole('button', { name: 'Sign out' })

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - img "TaxiFlow logo" [ref=e6]
  - generic [ref=e7]:
    - paragraph [ref=e8]: Secure access
    - heading "TaxiFlow Pro" [level=1] [ref=e9]
    - paragraph [ref=e10]: Sign in to open the workspace assigned to your designation and access level.
    - generic [ref=e11]: Local setup authentication
  - generic [ref=e12]:
    - generic [ref=e13]:
      - generic [ref=e14]: Email
      - textbox "Email" [ref=e15]: manager@taxiflow.local
    - generic [ref=e16]:
      - generic [ref=e17]: Password
      - textbox "Password" [ref=e18]: TaxiFlow.123
    - generic [ref=e19]:
      - button "Sign in" [active] [ref=e20] [cursor=pointer]
      - button "Forgot password?" [ref=e21] [cursor=pointer]
    - paragraph [ref=e22]: This email is not assigned to a TaxiFlow account.
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | const PASSWORD = "TaxiFlow.123";
  4   | const DAILY_DATE = "2026-04-03";
  5   | const DAILY_DATE_LABEL = "03 Apr 2026";
  6   | const ZERO_ACTIVITY_DATE = "2026-04-04";
  7   | const DRIVER_EDIT_DATE = "2026-04-05";
  8   | const DRIVER_EDIT_DATE_LABEL = "05 Apr 2026";
  9   | const ROUTE_TEXT = "JHB 457 GP / Noord to Alexandra";
  10  | const PASSENGER_SUMMARY = "21 passengers";
  11  | const TRIP_SUMMARY = "2 trips";
  12  | const AMOUNT_SUMMARY = "R 920";
  13  | const RECORD_SUMMARY = `Daily trip / ${DAILY_DATE_LABEL} / In 06:00 / Out 10:00 / ${TRIP_SUMMARY} / ${PASSENGER_SUMMARY}`;
  14  | const ENTRY_AMOUNT = 920;
  15  | const EXPENSE_AMOUNT = 120;
  16  | const EXPECTED_CASH_IN = ENTRY_AMOUNT - EXPENSE_AMOUNT;
  17  | const EXPECTED_CASH_LABEL = "R 800";
  18  | 
  19  | const managementAccounts = [
  20  |   { email: "owner@taxiflow.local", role: "Owner" },
  21  |   { email: "manager@taxiflow.local", role: "Manager" },
  22  |   { email: "admin@taxiflow.local", role: "Admin" },
  23  | ];
  24  | 
  25  | test.beforeEach(async ({ page }) => {
  26  |   page.on("console", (message) => {
  27  |     console.log(`[browser:${message.type()}] ${message.text()}`);
  28  |   });
  29  | 
  30  |   page.on("pageerror", (error) => {
  31  |     console.log(`[pageerror] ${error.message}`);
  32  |   });
  33  | });
  34  | 
  35  | const signIn = async (page, email) => {
  36  |   await page.goto("/");
  37  |   await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  38  |   await page.getByLabel("Email").fill(email);
  39  |   await page.getByLabel("Password").fill(PASSWORD);
  40  |   await page.getByRole("button", { name: "Sign in" }).click();
> 41  |   await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
      |                                                                ^ Error: expect(locator).toBeVisible() failed
  42  | };
  43  | 
  44  | const signOut = async (page) => {
  45  |   await page.getByRole("button", { name: "Sign out" }).click();
  46  |   await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  47  | };
  48  | 
  49  | const moduleButton = (page, label) =>
  50  |   page.locator("button.module-button").filter({ hasText: label }).first();
  51  | 
  52  | const openMoneyModule = async (page) => {
  53  |   await moduleButton(page, "Money").click();
  54  |   await expect(page.getByRole("heading", { name: "Daily trip entry" })).toBeVisible();
  55  | };
  56  | 
  57  | const openSettingsModule = async (page) => {
  58  |   await moduleButton(page, "Settings").click();
  59  |   await expect(page.getByRole("heading", { name: "Roles and rights" })).toBeVisible();
  60  | };
  61  | 
  62  | const grantOwnerModules = async (page, email, modules) => {
  63  |   await signIn(page, "owner@taxiflow.local");
  64  |   await openSettingsModule(page);
  65  | 
  66  |   const userRow = page.locator("article.person-row").filter({
  67  |     hasText: email,
  68  |   });
  69  |   await userRow.getByRole("button", { name: "Manage" }).click();
  70  | 
  71  |   const accessForm = page.locator("form.finance-form").filter({
  72  |     has: page.getByRole("button", { name: "Save access" }),
  73  |   });
  74  | 
  75  |   for (const moduleLabel of modules) {
  76  |     await accessForm.getByRole("button", { name: moduleLabel }).click();
  77  |   }
  78  | 
  79  |   await accessForm.getByRole("button", { name: "Save access" }).click();
  80  |   await expect(page.getByText(/updated as/i)).toBeVisible();
  81  |   await signOut(page);
  82  | };
  83  | 
  84  | const openBankingModule = async (page) => {
  85  |   await openMoneyModule(page);
  86  |   await page
  87  |     .locator("button.finance-mode-button")
  88  |     .filter({ hasText: "Banking" })
  89  |     .click();
  90  |   await expect(
  91  |     page.getByRole("heading", { name: "Admin hand-in and manager verification" }),
  92  |   ).toBeVisible();
  93  | };
  94  | 
  95  | const readOverviewDailyTotal = async (page) => {
  96  |   const totalCard = page.locator("article.insight-card").filter({
  97  |     hasText: "Daily total entered",
  98  |   });
  99  | 
  100 |   await expect(totalCard).toBeVisible();
  101 |   const amountText = await totalCard.locator("strong").first().textContent();
  102 |   return Number(String(amountText ?? "").replace(/[^\d-]/g, ""));
  103 | };
  104 | 
  105 | const assertPendingDailyTripVisible = async (page) => {
  106 |   const recentIncomePanel = page.locator("article").filter({
  107 |     has: page.getByRole("heading", { name: "Waiting, handed in, checked, and deposited" }),
  108 |   });
  109 |   const record = recentIncomePanel.locator("article").filter({
  110 |     hasText: RECORD_SUMMARY,
  111 |   });
  112 | 
  113 |   await expect(record).toContainText(ROUTE_TEXT);
  114 |   await expect(record).toContainText(RECORD_SUMMARY);
  115 |   await expect(record).toContainText("Waiting hand-in");
  116 |   await expect(record).toContainText(AMOUNT_SUMMARY);
  117 | };
  118 | 
  119 | test("driver daily trip update is visible to owner, manager, and admin", async ({ page }) => {
  120 |   await signIn(page, "driver.one@taxiflow.local");
  121 | 
  122 |   await page.getByRole("button", { name: "Add daily earnings" }).click();
  123 |   await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();
  124 | 
  125 |   await page.getByLabel("Date").fill(DAILY_DATE);
  126 |   await page.getByLabel("Time in").fill("06:00");
  127 |   await page.getByLabel("Time out").fill("10:00");
  128 |   await page.getByLabel("Opening odo").fill("384120");
  129 |   await page.getByLabel("Closing odo").fill("384200");
  130 |   const driverActionPanel = page.locator(".driver-action-panel");
  131 |   await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).first().fill("12");
  132 |   await driverActionPanel
  133 |     .getByRole("spinbutton", { name: "Amount collected" })
  134 |     .first()
  135 |     .fill("500");
  136 |   await page.getByRole("button", { name: "Add passenger trip" }).click();
  137 |   await driverActionPanel.getByRole("spinbutton", { name: "Passengers" }).nth(1).fill("9");
  138 |   await driverActionPanel
  139 |     .getByRole("spinbutton", { name: "Amount collected" })
  140 |     .nth(1)
  141 |     .fill("420");
```