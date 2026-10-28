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
| A6 | As Owner: Money > Expenses > Driver salaries. Set a schedule for Sizwe Mokoena: R 300, Daily, starts 2 days ago, Save schedule. | "Salary schedule saved ... No expense was added." The row shows "Next payment: ..." and "Due now: 3 periods, R 900,00". | |
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
