# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: driver-visibility.spec.js >> driver daily trip update is visible to owner, manager, and admin
- Location: tests\driver-visibility.spec.js:119:1

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.click: Test timeout of 120000ms exceeded.
Call log:
  - waiting for locator('article.person-row').filter({ hasText: 'manager@taxiflow.local' }).getByRole('button', { name: 'Manage' })

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - main [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]:
        - img "TaxiFlow logo" [ref=e8]
        - generic [ref=e9]:
          - heading "TaxiFlow Pro" [level=1] [ref=e10]
          - paragraph [ref=e11]: Apprigate Mobility Operators / Gauteng North
      - generic [ref=e12]:
        - generic [ref=e14]:
          - img [ref=e15]
          - generic [ref=e18]: Banking window Friday 16:30
        - generic [ref=e19]:
          - generic [ref=e20]: Owner
          - generic [ref=e21]:
            - strong [ref=e22]: Owner account
            - generic [ref=e23]: owner@taxiflow.local
          - button "Sign out" [ref=e24] [cursor=pointer]:
            - img [ref=e25]
            - generic [ref=e28]: Sign out
    - navigation "Primary views" [ref=e29]:
      - button "12 Overview Need action" [ref=e30] [cursor=pointer]:
        - generic [ref=e31]:
          - img [ref=e33]
          - strong [ref=e38]: "12"
        - generic [ref=e39]: Overview
        - generic [ref=e40]: Need action
      - button "7 Money Awaiting count" [ref=e41] [cursor=pointer]:
        - generic [ref=e42]:
          - img [ref=e44]
          - strong [ref=e47]: "7"
        - generic [ref=e48]: Money
        - generic [ref=e49]: Awaiting count
      - button "7 Fleet & Operations Visible vehicles" [ref=e50] [cursor=pointer]:
        - generic [ref=e51]:
          - img [ref=e53]
          - strong [ref=e55]: "7"
        - generic [ref=e56]: Fleet & Operations
        - generic [ref=e57]: Visible vehicles
      - button "6 Drivers Active drivers" [ref=e58] [cursor=pointer]:
        - generic [ref=e59]:
          - img [ref=e61]
          - strong [ref=e66]: "6"
        - generic [ref=e67]: Drivers
        - generic [ref=e68]: Active drivers
      - button "10 Settings User access" [active] [ref=e69] [cursor=pointer]:
        - generic [ref=e70]:
          - img [ref=e72]
          - strong [ref=e75]: "10"
        - generic [ref=e76]: Settings
        - generic [ref=e77]: User access
    - generic [ref=e78]:
      - generic [ref=e79]:
        - generic [ref=e80]:
          - generic [ref=e81]:
            - generic [ref=e82]:
              - paragraph [ref=e83]: User access
              - heading "Roles and rights" [level=2] [ref=e84]
            - img [ref=e86]
          - generic [ref=e89]:
            - generic [ref=e90]: 10 mapped users
            - generic [ref=e91]: "Default local password: TaxiFlow.123"
          - button "+ Add new user" [ref=e92] [cursor=pointer]
          - generic [ref=e93]:
            - article [ref=e94]:
              - generic [ref=e95]:
                - heading "Owner account" [level=3] [ref=e96]
                - paragraph [ref=e97]: owner@taxiflow.local
              - generic [ref=e98]:
                - generic [ref=e99]: Owner
                - generic [ref=e100]: 5 modules
                - button "Manage" [ref=e101] [cursor=pointer]
            - article [ref=e102]:
              - generic [ref=e103]:
                - heading "Admin account" [level=3] [ref=e104]
                - paragraph [ref=e105]: admin@taxiflow.local
              - generic [ref=e106]:
                - generic [ref=e107]: Admin
                - generic [ref=e108]: 2 modules
                - button "Manage" [ref=e109] [cursor=pointer]
            - article [ref=e110]:
              - generic [ref=e111]:
                - heading "Lerato Maseko" [level=3] [ref=e112]
                - paragraph [ref=e113]: lerato.maseko@taxiflow.local
              - generic [ref=e114]:
                - generic [ref=e115]: Manager
                - generic [ref=e116]: 2 modules
                - button "Manage" [ref=e117] [cursor=pointer]
            - article [ref=e118]:
              - generic [ref=e119]:
                - heading "Andile Hlatshwayo" [level=3] [ref=e120]
                - paragraph [ref=e121]: driver.two@taxiflow.local
              - generic [ref=e122]:
                - generic [ref=e123]: Driver
                - generic [ref=e124]: 3 modules
                - button "Manage" [ref=e125] [cursor=pointer]
            - article [ref=e126]:
              - generic [ref=e127]:
                - heading "Ayanda Khumalo" [level=3] [ref=e128]
                - paragraph [ref=e129]: ayanda.khumalo@taxiflow.local
              - generic [ref=e130]:
                - generic [ref=e131]: Driver
                - generic [ref=e132]: 3 modules
                - button "Manage" [ref=e133] [cursor=pointer]
            - article [ref=e134]:
              - generic [ref=e135]:
                - heading "Kagiso Baloyi" [level=3] [ref=e136]
                - paragraph [ref=e137]: kagiso.baloyi@taxiflow.local
              - generic [ref=e138]:
                - generic [ref=e139]: Driver
                - generic [ref=e140]: 3 modules
                - button "Manage" [ref=e141] [cursor=pointer]
            - article [ref=e142]:
              - generic [ref=e143]:
                - heading "Neo Masondo" [level=3] [ref=e144]
                - paragraph [ref=e145]: neo.masondo@taxiflow.local
              - generic [ref=e146]:
                - generic [ref=e147]: Driver
                - generic [ref=e148]: 3 modules
                - button "Manage" [ref=e149] [cursor=pointer]
            - article [ref=e150]:
              - generic [ref=e151]:
                - heading "Pule Dlamini" [level=3] [ref=e152]
                - paragraph [ref=e153]: pule.dlamini@taxiflow.local
              - generic [ref=e154]:
                - generic [ref=e155]: Driver
                - generic [ref=e156]: 3 modules
                - button "Manage" [ref=e157] [cursor=pointer]
            - article [ref=e158]:
              - generic [ref=e159]:
                - heading "Sizwe Mokoena" [level=3] [ref=e160]
                - paragraph [ref=e161]: driver.one@taxiflow.local
              - generic [ref=e162]:
                - generic [ref=e163]: Driver
                - generic [ref=e164]: 3 modules
                - button "Manage" [ref=e165] [cursor=pointer]
            - article [ref=e166]:
              - generic [ref=e167]:
                - heading "Demo Viewer" [level=3] [ref=e168]
                - paragraph [ref=e169]: viewer@taxiflow.local
              - generic [ref=e170]:
                - generic [ref=e171]: Viewer
                - generic [ref=e172]: 1 module
                - button "Manage" [ref=e173] [cursor=pointer]
        - generic [ref=e174]:
          - generic [ref=e175]:
            - generic [ref=e176]:
              - paragraph [ref=e177]: Owner control
              - heading "Edit selected user" [level=2] [ref=e178]
            - img [ref=e180]
          - generic [ref=e183]:
            - generic [ref=e184]:
              - generic [ref=e185]:
                - generic [ref=e186]: Name
                - strong [ref=e187]:
                  - textbox [ref=e188]: Owner account
              - generic [ref=e189]:
                - generic [ref=e190]: Original email
                - strong [ref=e191]: owner@taxiflow.local
              - generic [ref=e192]:
                - generic [ref=e193]: Driver link
                - strong [ref=e194]: Not linked
              - generic [ref=e195]:
                - generic [ref=e196]: Current rights
                - strong [ref=e197]: Overview, Money, Fleet & Operations, Drivers, Settings
            - generic [ref=e198]:
              - generic [ref=e199]: Role
              - combobox "Role" [disabled] [ref=e200]:
                - option "Owner" [selected]
                - option "Admin"
                - option "Manager"
                - option "Driver" [disabled]
                - option "Viewer"
            - generic [ref=e201]:
              - generic [ref=e202]:
                - paragraph [ref=e203]: Module rights
                - heading "Access by role" [level=3] [ref=e204]
              - paragraph [ref=e205]: Overview stays on for every user. Management keeps Settings for password resets, and the owner turns Money, Fleet & Operations, and Drivers on only when needed.
              - generic [ref=e206]:
                - button "Money" [disabled] [ref=e207]
                - button "Fleet & Operations" [disabled] [ref=e208]
                - button "Drivers" [disabled] [ref=e209]
            - generic [ref=e210]:
              - generic [ref=e211]: Reset local password
              - textbox "Reset local password" [disabled] [ref=e212]:
                - /placeholder: Leave blank to keep the current password
            - generic [ref=e213]:
              - button "Save access" [disabled] [ref=e214]
              - button "Reset" [ref=e215] [cursor=pointer]
            - paragraph [ref=e216]: The signed-in owner account stays locked while it is in use.
      - generic [ref=e217]:
        - generic [ref=e218]:
          - generic [ref=e219]:
            - generic [ref=e220]:
              - paragraph [ref=e221]: Access support
              - heading "Password reset requests" [level=2] [ref=e222]
            - img [ref=e224]
          - generic [ref=e226]:
            - generic [ref=e227]: 0 pending
            - generic [ref=e228]: 0 logged
          - paragraph [ref=e229]: No password reset requests have been sent from the sign-in screen yet.
          - paragraph [ref=e230]: Reset the account password in the selected user record, or mark the request handled if management completed the reset outside TaxiFlow.
        - generic [ref=e231]:
          - generic [ref=e232]:
            - generic [ref=e233]:
              - paragraph [ref=e234]: Outgoing mail
              - heading "Email outbox" [level=2] [ref=e235]
            - img [ref=e237]
          - generic [ref=e240]:
            - generic [ref=e241]: 0 queued
            - generic [ref=e242]: 0 notices
          - paragraph [ref=e243]: No email notices have been prepared yet.
          - paragraph [ref=e244]: TaxiFlow keeps the management email notice here so the reset trail stays visible inside the workspace.
      - generic [ref=e245]:
        - generic [ref=e246]:
          - generic [ref=e247]:
            - generic [ref=e248]:
              - paragraph [ref=e249]: Workspace control
              - heading "Data mode" [level=2] [ref=e250]
            - img [ref=e252]
          - generic [ref=e255]:
            - generic [ref=e256]:
              - generic [ref=e257]: Current mode
              - strong [ref=e258]: Demo mode
            - generic [ref=e259]:
              - generic [ref=e260]: Storage
              - strong [ref=e261]: Local training workspace
          - group "Data mode toggle" [ref=e262]:
            - button "Demo" [ref=e263] [cursor=pointer]
            - button "Live" [ref=e264] [cursor=pointer]
          - paragraph [ref=e265]: Training and presentation data is active. Reset demo to start from zero.
          - paragraph [ref=e266]: Switching mode reloads the workspace with the selected data source.
        - generic [ref=e267]:
          - generic [ref=e268]:
            - generic [ref=e269]:
              - paragraph [ref=e270]: Owner control
              - heading "Factory reset" [level=2] [ref=e271]
            - img [ref=e273]
          - generic [ref=e275]:
            - generic [ref=e276]:
              - generic [ref=e277]:
                - generic [ref=e278]: Reset target
                - strong [ref=e279]: Demo workspace
              - generic [ref=e280]:
                - generic [ref=e281]: Keeps after reset
                - strong [ref=e282]: Owner sign-in and default factory setup
              - generic [ref=e283]:
                - generic [ref=e284]: Clears
                - strong [ref=e285]: Trips, expenses, fleet, users, documents, and history
              - generic [ref=e286]:
                - generic [ref=e287]: Password check
                - strong [ref=e288]: TaxiFlow local owner password
            - generic [ref=e289]:
              - generic [ref=e290]: Owner password
              - textbox "Owner password" [ref=e291]
            - button "Factory reset" [disabled] [ref=e293]
            - paragraph [ref=e294]: This resets the active demo workspace to factory defaults and removes all captured activity in that workspace.
  - contentinfo [ref=e295]:
    - generic [ref=e296]: Created by Apprigate
    - link "www.apprigate.com" [ref=e297] [cursor=pointer]:
      - /url: https://www.apprigate.com
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
  41  |   await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
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
> 69  |   await userRow.getByRole("button", { name: "Manage" }).click();
      |                                                         ^ Error: locator.click: Test timeout of 120000ms exceeded.
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
  142 |   await page.getByRole("button", { name: "Save trip" }).click();
  143 | 
  144 |   await expect(
  145 |     page.getByText("Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in."),
  146 |   ).toBeVisible();
  147 |   await signOut(page);
  148 | 
  149 |   await grantOwnerModules(page, "manager@taxiflow.local", ["Money"]);
  150 |   await grantOwnerModules(page, "admin@taxiflow.local", ["Money"]);
  151 | 
  152 |   for (const account of managementAccounts) {
  153 |     await signIn(page, account.email);
  154 |     await expect(page.getByText(account.role).first()).toBeVisible();
  155 |     await openMoneyModule(page);
  156 |     await assertPendingDailyTripVisible(page);
  157 |     await signOut(page);
  158 |   }
  159 | });
  160 | 
  161 | test("driver can save a daily trip with zero passengers and zero collected", async ({ page }) => {
  162 |   await signIn(page, "driver.one@taxiflow.local");
  163 | 
  164 |   await page.getByRole("button", { name: "Add daily earnings" }).click();
  165 |   await expect(page.getByRole("heading", { name: "Add Daily Earning" })).toBeVisible();
  166 | 
  167 |   await page.getByLabel("Date").fill(ZERO_ACTIVITY_DATE);
  168 |   await page.getByLabel("Time in").fill("11:00");
  169 |   await page.getByLabel("Time out").fill("11:45");
```