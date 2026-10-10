# Hosted Rehearsal Decision Pack (2026-10-10)

Everything here was gathered **read-only**: the Supabase connector's account, project and price lookups; the Supabase and Vercel docs; and the Vercel CLI team read. **Nothing was created, purchased, paused or changed.**

## 1. Rehearsal options and costs

**Current state**
- **Supabase organisation "Apprigate"** (Free plan) has 5 projects. **Active: TaxiFlow production `vfxftviwteypasredjgm` and "Birdie Squad Golf Club" `ydrrhlpvblwgwboyuwkj`.** Paused: three older projects.
- **Supabase Free rule** (docs, "About billing" and "Billing FAQ"): each Owner or Admin gets **2 active free projects across all organisations**; paused projects don't count. Both slots are in use.
- **Plans can't be mixed inside one organisation.** Upgrading "Apprigate" changes the plan, billing and features of every project in it, including Birdie Squad.
- **Vercel:** account `apprigate` on the **Hobby** plan; project `taxiflowpro`.

| Option | Isolation | Touches Birdie Squad or TaxiFlow production? | Cost (USD, before any tax) |
|---|---|---|---|
| A. **New separate Supabase organisation on Pro with one Micro rehearsal project** | full (own org, keys, Auth, email) | **No** | **$25 for the month.** Pro is $25/month, charged upfront; one Micro project is about $10/month of compute, covered by the included $10 compute credit. After the rehearsal, delete the project and downgrade the org: unused plan time becomes credit in that org, **not a refund**. |
| B. Upgrade "Apprigate" to Pro and add a rehearsal project | full project, shared org | **Yes**: changes Birdie Squad's plan and billing | $25 + 3 × ~$10 compute − $10 credit ≈ **$45/month** |
| C. Branch of TaxiFlow production | branch (no production data copied) | **Yes**: branching needs a paid org, so Apprigate must be upgraded | $25 plan + $0.01344/hour per branch (connector price; compute credits don't apply) |
| D. Free rehearsal project | full | **Yes**: needs Birdie Squad or TaxiFlow paused | $0, **ruled out** |
| E. Local exact copy (already done) | local only | No | $0, but it can't prove the gateway keys, Auth email, Vercel routing or a real-data restore |

**Recommendation: Option A.**
- A new separate organisation (for example "Apprigate Rehearsal") on Pro, with one Micro project in **eu-west-1** (same region as production) and the Spend Cap **on**.
- It is the cheapest option that is isolated and leaves Birdie Squad and TaxiFlow production untouched.
- **Expected cost: $25** plus any tax for one month. Delete the project and downgrade straight after sign-off.
- Run the frontend in a **separate Vercel project** (for example `taxiflow-rehearsal`, $0 on Hobby), so the `taxiflowpro` Preview variables are never pointed at the rehearsal.

**For Tebogo to confirm (not verified here):** Vercel describes Hobby as being for personal, non-commercial use. Check the current Vercel terms and pricing before production carries a paying pilot; Vercel Pro may be needed. That decision is separate from the rehearsal.

## 2. Email and domain inputs (none assumed)

Tebogo to supply. Nothing below is approved yet.

| # | Input | Used for | Notes |
|---|---|---|---|
| 1 | **Production app URL** (exact `https://` origin) | Supabase Auth Site URL, redirect allow-list, setup-email links, production `TAXIFLOW_SETUP_REDIRECT` | The Supabase project is *named* "taxiflow.apprigate.com"; that is not taken as approval |
| 2 | Whether that URL is a custom domain on Vercel, and **who controls its DNS** | DNS record for the domain | DNS changes are not done now |
| 3 | **Rehearsal app URL** | rehearsal Site URL and redirect allow-list | The Vercel URL of the separate rehearsal project |
| 4 | **SMTP provider** and the account owner | Supabase Auth custom SMTP | Cost per plan, to be confirmed by Tebogo |
| 5 | SMTP **host**, **port** (465/587), **username** | Supabase Auth SMTP settings | |
| 6 | SMTP **password or API key** | Supabase Auth SMTP settings | **Entered by Tebogo in the dashboard only**; never sent to the agent or put in Git |
| 7 | **Sender address** (From) and **sender name** | setup and recovery emails | For example a no-reply address on a domain Tebogo controls |
| 8 | **Reply-to address** (optional) | the same emails | |
| 9 | **Sender domain DNS records** from the provider: SPF (TXT), DKIM (CNAME/TXT), DMARC (`_dmarc` TXT), optional bounce/return-path | deliverability | Added at the DNS host by Tebogo |
| 10 | **Email wording** for the "Reset password" template (it is used as the account-setup email) | Auth template | Plain-language setup wording |
| 11 | **Auth email rate limit** setting | avoid throttled setup emails | Supabase applies a default limit with custom SMTP |
| 12 | **Three test mailboxes** Tebogo controls (Owner, Admin, Driver) | rehearsal email checks | Must not be real pilot users |
| 13 | **Rehearsal email sender** | rehearsal | The same provider, or its sandbox |

## 3. Expense-only and negative days (refined)

**Where the cash came from**

| Funding | Meaning | Effect on the day |
|---|---|---|
| **Paid from takings** (business cash the driver is carrying) | the driver paid out of the day's collected fares | reduces the cash to hand in, but **only up to that day's takings** |
| **Personally funded** (the driver's own money) | the driver used their own cash or card | the business owes the driver; it **never** reduces another day's hand-in and is **never** in a bank deposit |
| **Business-funded cash from the safe or float** (management) | an Admin or Manager paid from the business safe | a standalone management cash expense; reduces the deposit as today |
| **Non-cash business payment** (card, EFT, account) | the business paid directly | no effect on cash |

**Today's data has one flag**, `cashExpense` ("Paid from safe"), which the day maths treats as "paid from takings". There is no field for personally funded. In the cases below, cash expenses beyond the takings are treated as **uncovered**: personally funded, so not banked.

**Examples**

| Day | Income | Expenses | Cash to hand in | Uncovered (owed to driver) | Banked |
|---|---|---|---|---|---|
| A. Normal | R 500 | R 120 fuel, cash | **R 380** | R 0 | R 380 |
| B. Expense-only, cash | R 0 | R 200 fuel, cash (driver's money) | **R 0** | **R 200** | R 0 |
| C. Expenses above takings | R 100 | R 300 fuel, cash | **R 0** | **R 200** (R 300 − R 100) | R 0 |
| D. Expense-only, non-cash | R 0 | R 900 tyre, business card | **R 0** | R 0 | R 0 |

**Smallest safe pilot implementation** (recommended; **no payables created automatically**)
1. **Queue:** day checkings with any entry (`entryCount > 0`) appear in Banking, not only days with income. Expense-only and negative days can be counted (R 0), verified and banked, which closes and locks their records.
2. **Display:** each day shows "Cash to hand in = max(income − cash expenses, 0)". Where cash expenses exceed income, it adds a clear flag: "Cash expenses above takings: R X (not banked; settle with the driver outside TaxiFlow)".
3. **Variance:** measured against the cash to hand in, not the negative raw figure, so there's no false "over-collection".
4. **Deposit:** unchanged. It sums counted hand-ins (≥ 0); uncovered amounts never enter or reduce it. The deposit's reported cash-expense total counts only expenses covered by takings.
5. **Report:** the Daily Finance Report shows the uncovered amount as a separate informational line.
6. **No payable record, no settlement action and no new "personally funded" field yet.** The operator tells Owners to settle these amounts outside TaxiFlow during the pilot. A proper reimbursement payable is a later decision.

**Tests needed:** examples A–D on the server and in the browser; deposit totals unchanged; the uncovered amount is never in a deposit; the closed-day lock applies after verification.

## 4. Cutover ordering (re-reviewed)

**Gap in the previous order:** between applying the migrations and deactivating the legacy keys, the **old production deployment still held a working service_role key**. Its legacy `auth-users`/`bootstrap-workspace` functions could have written the snapshot during maintenance.

**Corrected rule:** at the **start** of the window:
1. production serves a static maintenance page;
2. the legacy `anon` and `service_role` keys are deactivated, and the 401s are verified.

**Before** any backup or migration, every old deployment and old browser bundle is therefore blocked for the whole window.
- The backup and migrations use the **database connection** (database password), not API keys, so they are unaffected.
- The tenant build is deployed with the **new** keys using `vercel deploy --prod --skip-domain` (a production build with production variables, no domain change), smoke-tested on its own URL, then `vercel promote`d. These are documented Vercel CLI steps.

**Proving the new keys work:** the rehearsal project uses **only** new keys from the start. Its legacy keys are deactivated before the app is deployed, so every rehearsal check runs with publishable/secret keys.
- Code review (2026-10-10): the app sends only user session tokens as Bearer tokens; keys go through `@supabase/supabase-js` 2.100.0; there are no raw REST or Auth calls.

## 5. Remaining verifications (open until performed)
- **Rendered PDF page visual inspection.** Only the logo geometry and colours have been checked, from the PDF source.
- **Installed-app icons on real phones:** Android (maskable) and iOS home screen.
- **Hosted setup-email delivery:** send, receive, link works, password set.
- **Expense-only rule:** decision, implementation and tests.

The checklist is `rehearsal-cutover-checklist.md`.
