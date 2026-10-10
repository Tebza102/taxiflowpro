# Hosted Rehearsal Decision Pack (final amendments 2026-10-10)

> **SUPERSEDED 2026-10-10 (Task 25):** no separate hosted rehearsal and no extra spend. The release now follows `pilot-release-checklist.md` on the existing platform. Kept for history only.

Gathered **read-only**:
- the Supabase connector's account, project and price lookups;
- the Vercel CLI's reads of the team and projects;
- Supabase docs (via the connector) and Vercel's own documentation pages (fetched 2026-10-10).

**Nothing was created, purchased, paused, deployed or changed.**

## 1. Rehearsal options and estimated costs

**Facts**
- **Supabase organisation "Apprigate":** Free plan. Active: **TaxiFlow production** (`vfxftviwteypasredjgm`) and **Birdie Squad Golf Club** (`ydrrhlpvblwgwboyuwkj`); three older projects are paused.
  - **Free rule** (Supabase "About billing", "Billing FAQ"): each Owner or Admin gets **2 active free projects across all organisations**; paused projects don't count. Both are in use.
  - **Plans can't be mixed inside one organisation.** Upgrading "Apprigate" changes the plan and billing of every project in it, including Birdie Squad.
- **Vercel team `apprigate`:** **Hobby** plan, **23 projects**, including `taxiflowpro`, `birdiesgc` and `birdiesgc-pilot`. Upgrading this team would change Birdie Squad's hosting plan.

### 1a. Vercel commercial-use eligibility (authoritative source)

**Source:** Vercel *Fair Use Guidelines*, "Commercial usage" (vercel.com/docs/limits/fair-use-guidelines, last updated 2026-09-14). It says Hobby is restricted to "non-commercial personal use only", and "all commercial usage of the platform requires either a Pro or Enterprise plan".
- Commercial use covers any deployment used for the financial gain of anyone involved in **any part of the production**, "including a paid employee or consultant writing the code". Its examples include "receiving payment to create, update, or host the site".
- The *Hobby plan* page (last updated 2026-09-14) repeats the same restriction.

**Conclusion:** TaxiFlow is built by Apprigate for paying taxi businesses, so it is commercial use.
- **Production needs Vercel Pro (or Enterprise).**
- The rehearsal deployment is part of producing that commercial project, so it should also run on a Pro-eligible team, not on Hobby.
- (Other client projects on the same Hobby team may be affected by the same rule. That's outside this task, but noted.)

**Vercel Pro facts** (vercel.com/docs/plans/pro-plan, last updated 2026-09-15):
- **$20/month platform fee**, which includes one deploying seat and **$20 of monthly usage credit**; extra seats are $20 each, and usage beyond the credit is billed on demand.
- **Spend notifications** are on by default at $200 per cycle. Hard actions must be configured.
- **Pro trial** (vercel.com/docs/plans/pro-plan/trials, last updated 2026-09-14):
  - 14 days, free;
  - **one per user account**, created as a **new team**;
  - **no charge unless a payment method is added**;
  - the trial pauses when it hits its usage limits (16 CPU-hrs, 1,440 GB-hrs, 1M invocations).

### 1b. Options

| Option | Isolation | Touches Birdie Squad or TaxiFlow production? | Estimated cost (USD, before tax) |
|---|---|---|---|
| **A. New Supabase org on Pro + 1 Micro project; new Vercel team on the Pro *trial*** | full | **No** | **≈ $25**: $25 Supabase Pro plan fee (charged upfront for the month) + Micro compute **incurred at ≈ $0.01344/hour (≈ $10 for a full month), offset by the $10 included compute credit**; Vercel trial $0 |
| A′. As A, but the Vercel trial is unavailable or already used: new Vercel team on paid Pro | full | No | **≈ $45** ($25 Supabase + $20 Vercel) |
| B. Upgrade the "Apprigate" Supabase org (+ project) | shared org | **Yes** (Birdie Squad's plan and billing) | ≈ $45/month |
| C. Branch of TaxiFlow production | branch | **Yes** (needs a paid "Apprigate" org) | $25 + $0.01344/hour (connector price; compute credits don't apply) |
| D. Free project | full | **Yes** (needs a pause) | ruled out |
| E. Local exact copy (done) | local | No | $0; can't prove the gateway keys, email or Vercel |

**Recommendation: A.** These are **estimates, not quotes.**
- Micro compute is **charged**, and the included credit **offsets** it. It is not free: if the project ran longer than the credit covers, or more than one project ran, compute would exceed the credit.
- **Total spending ceiling for the rehearsal: $30 plus applicable tax, across Supabase and Vercel combined.** Enforcement is in section 5.
- Supabase charges the Pro plan fee **upfront** for the month. After cancelling, unused time becomes **credit in that organisation, not a refund**.
- Taxes are added where they apply (Supabase and Vercel both bill in USD, before VAT or GST).
- The estimate assumes the rehearsal finishes within the Vercel trial's 14 days. The Supabase project should be deleted, and its organisation downgraded, straight after sign-off.

### 1c. Charges not covered by the Supabase Spend Cap
Source: Supabase "Control your costs". The Spend Cap covers usage items such as egress, disk size, MAU, storage and Realtime. It does **not** cover these opt-in or predictable items:

**Compute** (any project or compute size), **Branching compute**, **Read-replica compute**, **Custom domain**, **extra disk IOPS or throughput**, **IPv4 address**, **Log-drain hours and events**, **MFA phone**, **Point-in-Time Recovery**.

**Rehearsal guard:** use only one Micro project and none of the add-ons above.
- Connect for backup and restore through the Supabase **pooler**, not by buying the IPv4 add-on.
- Any of these items appearing on the usage page is a **stop condition** (section 6).

On Vercel, spend management only notifies by default. The Vercel trial pauses at its limits instead of charging.

**Separate production note (not part of the rehearsal):** TaxiFlow production currently runs in a *Free* Supabase organisation. Supabase says paid organisations' projects are never paused; Free projects can be. Production's Supabase plan is a decision for Approval B.

## 2. Email and domain inputs (none assumed)

| # | Input | Used for |
|---|---|---|
| 1 | **Production app URL** (exact `https://` origin). The project's *name* "taxiflow.apprigate.com" is not taken as approval | Auth Site URL, redirect allow-list, setup links |
| 2 | Whether it is a custom domain on Vercel, and **who controls its DNS** | DNS record (not done now) |
| 3 | **Rehearsal app URL** (on the rehearsal Vercel team) | rehearsal Site URL and redirects |
| 4 | **SMTP provider** and account owner (and its cost) | Supabase Auth custom SMTP |
| 5 | SMTP **host**, **port** (465/587), **username** | SMTP settings |
| 6 | SMTP **password or API key** | entered by Tebogo in the dashboard only; never sent to the agent or put in Git |
| 7 | **Sender address** and **sender name** | setup and recovery emails |
| 8 | **Reply-to** (optional) | the same emails |
| 9 | Sender-domain **SPF, DKIM and DMARC** records (plus optional bounce domain) from the provider | deliverability; added by Tebogo at the DNS host |
| 10 | **Setup-email wording** (the "Reset password" template is used as the account-setup email) | Auth template |
| 11 | **Auth email rate limit** | avoid throttled setup emails |
| 12 | **Three test mailboxes** Tebogo controls | rehearsal email checks |
| 13 | **Rehearsal sender**: the same provider, or its sandbox | rehearsal |

## 3. Expense-only and negative days (revised)

### 3a. Funding source
| Source | Effect on the day |
|---|---|
| Paid from the day's **takings** (business cash the driver carries) | reduces the cash to hand in, up to that day's takings |
| **Personally funded** by the driver | the business may owe the driver; settled outside TaxiFlow for now |
| **Business cash from the safe or float** (management) | standalone management cash expense (reduces the deposit, as today) |
| **Non-cash** business payment (card, EFT, account) | no cash effect |

**Today's data has only one flag**, `cashExpense` ("Paid from safe"). The day maths treats it as "paid from cash on hand". **When cash expenses exceed takings, the excess has no recorded funding source.** TaxiFlow therefore shows it as **"funding source unconfirmed"** and must not assume a driver reimbursement. It is never banked and never deducted from another day.

### 3b. Numbers kept separate (no netting)
- **Expected cash** = income − cash expenses (signed; can be negative).
- **Cash to hand in** = max(expected cash, 0).
- **Uncovered cash expenses** = max(−expected cash, 0), labelled **"funding source unconfirmed"**.
- **Variance** = counted cash − expected cash, **signed and preserved as today**. A positive variance on a day with uncovered expenses is explained by the uncovered amount shown beside it; it is not re-based.
- **Shortage** = max(expected cash − counted cash, 0), as today.

### 3c. Examples
| Day | Income | Expenses | Expected cash | Cash to hand in | Counted | Variance (counted − expected) | Uncovered (funding source unconfirmed) |
|---|---|---|---|---|---|---|---|
| A. Normal | R 500 | R 120 cash | R 380 | **R 380** | R 380 | R 0 | R 0 |
| A2. Short | R 500 | R 120 cash | R 380 | R 380 | R 350 | **−R 30** | R 0 |
| B. Expense-only, cash | R 0 | R 200 cash | −R 200 | **R 0** | R 0 | **+R 200** | **R 200** |
| C. Expenses above takings | R 100 | R 300 cash | −R 200 | **R 0** | R 0 | **+R 200** | **R 200** |
| D. Expense-only, non-cash | R 0 | R 900 card | R 0 | **R 0** | R 0 | R 0 | R 0 |

### 3d. Negative expected cash, signed variance and the zero-cash closure indicator

**Negative expected cash.** Expected cash = income − cash expenses. When a day's cash expenses are larger than its income, expected cash is **below zero**. That means the expenses paid in cash were more than the cash collected that day.
- It does **not** mean the driver must hand in a negative amount.
- It does **not** mean the business owes the driver: the funding source is unconfirmed.
- The day therefore has:
  - **cash to hand in = R 0**;
  - **uncovered cash expenses** = the size of the shortfall, labelled "funding source unconfirmed".

**Signed variance.** Variance = counted − expected, kept with its sign, exactly as today.
- On a normal day a **negative** variance means less cash was counted than expected (a shortage); a **positive** one means more.
- On a negative-expected day where R 0 is counted, the variance is **positive** and equal to the uncovered amount (example B: 0 − (−200) = **+R 200**). That isn't extra cash. The screen shows it **next to** "uncovered cash expenses R 200 (funding source unconfirmed)", so the reason is visible. The variance itself is not changed or re-based.

**Zero-cash closure indicator** (the workflow contract is unchanged)
- **Status values stay exactly `pending | counted | verified | banked`.**
- When a day checking is **verified** and its cash to hand in is R 0, the server records an explicit indicator on the day checking:
  `settlement: { cashToHandIn: 0, uncoveredCashExpenses, closedWithoutDeposit: true, closedAt, closedBy }`.
  The status stays `verified`.
- `closedWithoutDeposit: true` means the day is **final**:
  - the closed-day guard already locks a verified day's records (no edits, deletes or new work);
  - `deposit.lock` **excludes** these days, so they never become `banked`, are never in a deposit, and **no R 0 deposit record is ever created**;
  - the UI and report show "Closed: no cash to bank" instead of "awaiting banking".
- Uncovered amounts are never added to or subtracted from any deposit, and are never reported as banked cash.

### 3e. Smallest safe pilot implementation (recommended; no payables)
1. **Banking queue:** include day checkings with any entry (`entryCount > 0`).
2. **Server:** compute `cashToHandIn` and `uncoveredCashExpenses` on submit, hand-in and verify.
   - On verify with `cashToHandIn = 0`, write the `settlement.closedWithoutDeposit` indicator (section 3d). The status stays `verified`.
   - `deposit.lock` excludes those days.
   - The deposit maths are otherwise unchanged; variance stays signed.
3. **UI:** show "Cash to hand in", "Counted", "Variance (signed)", and when relevant, "Cash expenses above takings: R X, funding source unconfirmed". Zero-cash verified days are labelled "Closed: no cash to bank".
4. **Report:** a separate informational line for uncovered amounts.
5. **Not now:** payables, a reimbursement settlement action, or a new funding-source field.
6. **Tests:**
   - examples A–D on the server and in the browser;
   - the status values are unchanged;
   - the `closedWithoutDeposit` indicator is set only on verified zero-cash days;
   - deposits exclude those days and never include uncovered amounts;
   - no R 0 deposit;
   - the closed-day lock after verify;
   - signed variance preserved.

## 4. Cutover ordering and new keys
- **Production window start:**
  1. the static maintenance page is promoted;
  2. the legacy `anon` and `service_role` keys are deactivated and the 401s verified;
  3. backup and migrations follow (database connection, not API keys);
  4. the tenant build runs `vercel deploy --prod --skip-domain` (Vercel CLI docs), is smoke-tested on its own URL, then `vercel promote`.
- Old privileged deployments are therefore blocked for the **whole** window.
- **New-key proof:** the rehearsal project's legacy keys are deactivated before the app is deployed, so every rehearsal check runs on publishable/secret keys only. Code review: no key is sent as a Bearer token, and there are no raw REST or Auth calls.

## 5. Two bounded approvals (replace the per-step approvals)

### Approval A: hosted rehearsal (final)

**Data:** the first hosted rehearsal uses **synthetic data only**: synthetic businesses, synthetic Auth users (test mailboxes Tebogo controls) and synthetic finance records.
- **No real production data is restored or copied** into the rehearsal under this approval.
- The production encrypted backup may be taken **read-only**, to rehearse the backup procedure. It is stored separately (encrypted, outside the repo) and **is not restored anywhere**.
- **Prerequisite (to be built and tested locally before A6, no hosted change):** a hosted rehearsal seeding procedure. It loads the exact live-schema copy plus the synthetic fixtures on the rehearsal project only; Auth users are created through the Admin API, with target guards.

**Order of spend (trial first):**
1. Create the **Vercel Pro trial team** first, with **no payment method**.
2. Only if the trial is available, create the **Supabase Pro organisation** (the only paid item) with one Micro project in eu-west-1, the Spend Cap on and **no add-ons**.
3. If the trial is unavailable, or asks for a payment method: **stop before any purchase** and ask.

**Scope (all of it, nothing else):** inside the rehearsal org/project and the trial team only:
- create and delete keys (deactivating the legacy keys first);
- configure Auth and test SMTP;
- set variables and deploy the reviewed commit;
- load synthetic data and apply release files 01–04;
- run the checklist (Part A);
- run the operator scripts with synthetic businesses;
- one read-only inventory and an encrypted backup of TaxiFlow production, not restored;
- the evidence export and the clean-up below.

**Spend:** estimate ≈ $25 plus applicable tax. **Total ceiling $30 plus tax across both providers.**
- Before creation: confirm the shown price.
- After creation and daily: check Supabase's "Upcoming invoice" and usage.
- **Stop** if the projected total exceeds the ceiling, or if any item outside the spend cap appears (section 1c). Vercel can't charge without a payment method.

**Clean-up timing and evidence:**
1. **Before deleting anything, retain the evidence:**
   - the Part A results table (pass/fail per row);
   - command outputs and assertion results;
   - migration durations;
   - the inventory comparison;
   - deployment IDs and the commit SHA;
   - screenshots of the PDF page, home-screen icons and email receipt (synthetic addresses only);
   - Supabase usage and invoice-preview captures;
   - catalogue exports (policies and grants after 01–04).
   - Store it in `project-os/evidence/rehearsal-<date>/` (no secrets, keys or personal data). Raw logs that might contain identifiers go to an encrypted folder outside the repo.
2. **Clean up within 48 hours of sign-off, and no later than day 10 after creation** (before the 14-day Vercel trial ends and well inside the Supabase billing month):
   - delete the rehearsal secret key and the project;
   - downgrade the rehearsal org to Free;
   - leave the Vercel trial team with no payment method so it lapses, or keep it only if Approval B decides so.
3. **If the rehearsal fails or stalls:** retain the evidence, then clean up by the same deadline. A later rehearsal needs a new Approval A.

**Out of scope:**
- any write to TaxiFlow production, Birdie Squad, the "Apprigate" Supabase org or the `apprigate` Vercel team;
- restoring or copying real data; DNS changes;
- any purchase other than the rehearsal Supabase Pro org; any paid Vercel plan.

### Approval B: production cutover (only after rehearsal sign-off)
**Scope:**
- the Supabase production plan decision (section 1c note), and Vercel Pro for production at **$20/month** plus usage beyond the credit. The team is chosen at Approval B: convert the rehearsal trial team (add a payment method) or upgrade separately; `taxiflowpro` moves only as approved;
- the merge of the reviewed commit to `main` (with auto-deploy for `main` disabled for the window);
- production keys `web` and `vercel-production`;
- the maintenance window;
- deactivating the legacy keys;
- the backup;
- release files 01–04;
- `deploy --prod --skip-domain`, smoke test and promote;
- deleting or protecting old deployments and removing legacy key values;
- the operator session (a temporary `operator` key, deleted afterwards);
- onboarding the approved pilot businesses.

**Spend:** as approved at Approval B (stated in the approval).

**Out of scope:** reviving the legacy build, restoring the pre-migration database, re-activating legacy keys for an old build, and changes to Birdie Squad.

## 6. Stop conditions (both approvals)

The agent stops, leaves resources as they are (production: maintenance page up, legacy keys stay deactivated) and reports. It does not continue until Tebogo answers.
1. **Unexpected cost:**
   - any price, invoice preview or usage charge above the approved estimate, or a projected total above **$30 + tax** (Approval A);
   - the Vercel trial unavailable (stop before the Supabase purchase);
   - any item outside the spend cap (section 1c) appearing;
   - a request for a payment method on the Vercel trial;
   - the plan fee shown differing from the estimate.
2. **Target mismatch:** the project ref, organisation, Vercel team or project, region or commit SHA differs from the approved target; or a read-only inventory differs from `hosted-inventory.md`.
3. **Failed check:** any expected result in `rehearsal-cutover-checklist.md` not met, including the assertion failures in release file 01, legacy keys still working, a data or manifest mismatch, acceptance failures, email not delivered, or icon or PDF defects.
4. **Out of scope:** any action not listed in the approval's scope, or any need to touch Birdie Squad, DNS or an un-approved resource.

## 7. Open verifications (record until performed)
- Rendered PDF page visual inspection (checklist A16).
- Installed-app icons on real Android and iOS phones (A15).
- Hosted setup-email delivery, link and password set (A13).
- Expense-only rule: decision, implementation and tests (A14).
- Hosted rehearsal seeding procedure (synthetic data): build and test locally before A6.
- Rehearsal with real production data: **not** under Approval A; it would need a separate approval.
