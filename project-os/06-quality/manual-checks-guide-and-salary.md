# Manual checks still outstanding: in-app guide and driver salaries

Status (2026-10-28): **NOT PERFORMED.** Record the date, the person, the device and the result under each check when done. These cover what the automated tests cannot: a real low-spec Android phone and a real spreadsheet app.

## Where to run them (demo data, no real business data)

Use the demo build on the office computer, opened from the phone over the same Wi-Fi. It uses built-in demo data only and never connects to Supabase.

1. On the computer, in the `taxiflowpro` folder, on branch `agent/driver-salary`: `npm run dev -- --host 0.0.0.0 --port 5173`
2. Find the computer's Wi-Fi address (PowerShell: `ipconfig`, the "IPv4 Address", e.g. `192.168.1.20`).
3. On the phone, open Chrome at `http://<that address>:5173`. If it does not load, allow Node.js through the Windows firewall for private networks.
4. Demo sign-ins (demo data only; password `TaxiFlow.123`): `owner@taxiflow.local` (Owner), `driver.one@taxiflow.local` (Driver).
5. To see the first-time guide again on the phone: Chrome menu > Settings > Site settings > All sites > the computer's address > Clear & reset.

## A. Real low-spec Android phone

Phone used (model, Android version, RAM): ______  Date: ______  Checked by: ______

| # | Steps | Expected result | Result |
|---|---|---|---|
| A1 | Sign in as `owner@taxiflow.local`. | Within a few seconds the "How to use TaxiFlow" guide opens over the app. No freezing or blank screen. | |
| A2 | Scroll the guide to the bottom with a finger. | It scrolls smoothly inside the sheet; the page behind does not scroll; "Skip for now" and "Start: Capture the day" stay visible at the bottom. | |
| A3 | Tap "Skip for now". | The guide closes. Signing out and in again does not reopen it. | |
| A4 | Tap "Help" (top right). | The guide reopens. Tap the X: it closes. All buttons are easy to hit with a thumb (no mis-taps). | |
| A5 | Sign in as `driver.one@taxiflow.local` (after clearing site data, see step 5). | The guide shows driver steps: check your vehicle, add trips, add costs, send for checking, report problems. No Money or Reports steps. | |
| A6 | As Owner: Drivers > Edit profile on Sizwe Mokoena > Salary: tick "Set a salary", R 300, Daily, starts 2 days ago, Save driver. Then Money > Expenses > Driver salaries. | "... Salary schedule saved ... No expense was added." The row shows "Next payment: ..." and "Due now: 3 periods, R 900,00". | |
| A7 | Tap "Record payment". Leave Bank transfer. Tap "Record payment". | "Salary payment recorded ... added to expenses once." The payment appears under "Salary payments". | |
| A8 | Tap "Record payment" again and set the period to the one just paid. | A warning "Already recorded ..." appears and the Record payment button is disabled. | |
| A9 | Tap "Record a manual payment": Driver Sizwe Mokoena, Daily, amount 250, Cash, "Driver's takings for the day". | The yellow note says it lowers Sizwe Mokoena's cash to hand in for that day. After saving, the payment shows "pending". | |
| A10 | Sign in as `driver.one@taxiflow.local`, open Overview. | "Day cash activity": Cash expenses shows R 250. The R 300 bank salary is not there. | |
| A11 | As Owner, Money > Expenses > "Download expense report (CSV)". | The phone downloads `taxiflow-expenses-YYYY-MM.csv` and can open or share it. | |
| A12 | Throughout: rotate the phone once, and use the back button. | Layout stays usable; nothing is cut off sideways; back does not lose a saved payment. | |

## B. Opening the CSV in a spreadsheet app

App used (Excel version / Google Sheets): ______  Date: ______  Checked by: ______

Use the CSV from A11, or download it on the computer (same steps in a desktop browser).

| # | Steps | Expected result | Result |
|---|---|---|---|
| B1 | Open the CSV in Excel (double-click) and in Google Sheets (File > Import > Upload). | Columns: Date, Category, Description, Vehicle, Paid by, Paid from, Status, Reference, Salary driver, Salary period, Scheduled salary, Amount (R). Text is in separate columns (no whole line in column A). | |
| B2 | Look at the salary lines. | Each salary appears once: category Salary; "Driver salary / <name> / <period>"; Paid by bank or cash; Paid from (e.g. "Driver's takings for the day"); scheduled amount or "manual". | |
| B3 | Check the Amount column is numeric: select the expense amounts. | The status bar SUM works (amounts are numbers, e.g. 300.00, not text). Dates show as dates or YYYY-MM-DD text. | |
| B4 | Add the expense line amounts with `=SUM(...)`. | Equals the "Total expenses" row. | |
| B5 | Add only the salary line amounts. | Equals the "Driver salaries" row; "of which paid from drivers' takings" equals the takings-funded lines. | |
| B6 | Check "Driver salaries" + "Other expenses". | Equals "Total expenses"; the last row says "Reconciles, yes ...". | |
| B7 | Look for a description that contains a comma (if any). | It stays in one cell (not split). | |

If any check fails, write down what happened, the device or app, and a screenshot; do not mark the PR ready.

## C. Business and vehicle reports (added 2026-10-29, branch `agent/period-reports`)

Date: ______  Checked by: ______  Device/app: ______

| # | Steps | Expected result | Result |
|---|---|---|---|
| C1 | As Owner: Reports. Overall business, Monthly, March 2026, View report. | "Business report: Overall business" and "Mar 2026 (1 Mar 2026 to 31 Mar 2026)" shown above the figures. | |
| C2 | Download PDF on the phone and open it. | A4, DEMO DATA marked, same scope, dates and Net result as the screen; tables readable, nothing cut off. | |
| C3 | Download CSV and open it in Excel and Google Sheets. | Sections in separate columns; Income, Expenses and Net result equal the screen; amounts are numbers; "Reconciles,yes". | |
| C4 | Individual vehicle, JHB 457 GP, Weekly, 27 Mar 2026. | Only that vehicle's entries; no "Rank Fees" or "No vehicle" lines; drivers named. | |
| C5 | Change the dates without pressing View report. | Yellow warning that the report and downloads are still for the selection shown. | |

## D. Salary settings in the driver profile (added 2026-10-29, branch `agent/driver-salary-profile`)

Date: ______  Checked by: ______  Device: ______

| # | Steps | Expected result | Result |
|---|---|---|---|
| D1 | As Owner: Drivers > Add driver. Name, tick "Set a salary", R 4 000, Monthly, starts the 1st of this month, "At the end of each period". Save driver. | "added to the driver roster. Salary schedule saved ... No expense was added." No new line under Money > Salary payments. | |
| D2 | Edit profile on that driver. | The Salary section shows the current amount, timing, Active, next payment and the amount history. | |
| D3 | Change the amount, "Changes apply from" the 15th; Save. Edit again and open Amount history. | Two entries with their dates; the earlier one is unchanged. | |
| D4 | Money > Driver salaries > Salary settings on that driver. | Opens the driver's profile at Salary. "Record or review salary payments in Money" goes back. | |
| D5 | As a Manager whose Money is off: Drivers > Edit profile. | Profile fields editable (if given driver management); no Salary section anywhere. | |
| D6 | On the phone: the Salary section fields and buttons are easy to tap; nothing cut off sideways. | | |

## E. Recurring fixed expenses (added 2026-10-29, branch `agent/recurring-expenses`)

Date: ______  Checked by: ______  Device/app: ______

| # | Steps | Expected result | Result |
|---|---|---|---|
| E1 | As Owner: Money > Expenses > Recurring fixed expenses > Add recurring expense. "Office rent", Rent, R 1 500, Business-wide, Monthly, first due date two months ago. Save schedule. | "Recurring expense saved ... No expense was added." The row shows Overdue occurrences and the next due date. | |
| E2 | Record payment on the oldest Overdue line. | The form shows R 1 500, today's date, Bank. After saving, that line shows Paid with the amount and date; no Record payment button on it. | |
| E3 | Refresh the page. | Still one Paid line; nothing added twice. | |
| E4 | Pause, then Resume, then Stop (keep today). | Status chip changes Paused / Active / Stopped; the Paid line stays. | |
| E5 | Reports > Overall business > Custom dates covering the two months > View report; download PDF and CSV. | "Scheduled commitments" lists each due date with Paid/Overdue; the rent payment appears once under Transactions; totals unchanged by commitments; the CSV opens in columns and reconciles. | |
| E6 | Add a recurring expense linked to JHB 457 GP; Reports > Individual vehicle > JHB 457 GP. | Its commitments appear there; the business-wide rent does not. | |

## F. Phone fixes: PDF download and compact menu (added 2026-10-29, branch `agent/phone-fixes`)

Open the demo on the phone in Chrome at the address the agent gives (it changes when the laptop reconnects to the hotspot). Demo accounts only.

Date: ______  Checked by: ______  Phone / Chrome version: ______

| # | Steps | Expected result | Result |
|---|---|---|---|
| F1 | Sign in as `owner@taxiflow.local`. Look at the bottom of the screen; scroll to the end of Overview. | No menu bar over the content. A slim dark bar at the top shows the menu button and "Overview". | |
| F2 | Tap the menu button. Tap Reports. | A drawer slides in from the left with your pages; Reports opens and the drawer closes; the top bar says "Reports". | |
| F3 | Open the menu; tap the dimmed area on the right. Turn the phone sideways and open the menu again. | It closes without changing page. Sideways, every page can be reached (the list scrolls if needed). | |
| F4 | Reports > Business and vehicle reports > View report > Download PDF. | "PDF ready: taxiflow-business-....pdf (... KB)" and an Open PDF button. Note what Chrome shows (saved / "can't be downloaded securely" / nothing). | |
| F5 | If the file did not appear in Downloads: tap Open PDF. If Chrome says the file can't be downloaded securely, open Chrome's Downloads and choose Keep. | The PDF opens: DEMO DATA, the same period and Net result as the screen. | |
| F6 | Individual vehicle > View report > Download PDF; then the Daily finance report "Download A4 PDF" above. | Both give "PDF ready" and open as readable PDFs. | |
