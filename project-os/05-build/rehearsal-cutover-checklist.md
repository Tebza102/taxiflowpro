# Rehearsal and Cutover Checklist (TaxiFlow tenant pilot)

> **SUPERSEDED 2026-10-10 (Task 25):** no separate hosted rehearsal and no extra spend. The release now follows `pilot-release-checklist.md` on the existing platform. Kept for history only.

Status: **draft for review; nothing executed.** Revised 2026-10-10 for **two bounded approvals**. Scope, spend limits and the **stop conditions** are defined in `rehearsal-decision-pack.md` sections 5–6 and apply to every row. Inside an approval's scope no further per-step approval is needed. Anything outside it is a stop.
- Part A needs **Authorization A** (rehearsal only).
- Part B needs **Authorization B** (production), which is given separately and only after Part A is signed off.
- No step in Part A touches TaxiFlow production (`vfxftviwteypasredjgm`), the Vercel project `taxiflowpro` or Birdie Squad (`ydrrhlpvblwgwboyuwkj`).

**Conventions**
- "Stop" means halt, leave everything as it is, and record the reason.
- Rehearsal stops don't affect production.
- Production stops keep the maintenance page up, with the legacy keys still deactivated.
- The release files are `supabase/release/tenant-pilot/01_tenant_foundation.sql`, then `scripts/localdb/migrations/20261010063144_finance_actions.sql` (02), `20261010113000_pilot_onboarding.sql` (03) and `20261011090000_assign_initial_owner.sql` (04).

---

## Part A: Hosted rehearsal (Approval A)

**Approval A** covers exactly the scope in decision-pack section 5 ("Approval A: hosted rehearsal (final)"):
- **synthetic data only**;
- the Vercel trial team first, then one Supabase Pro rehearsal org with a Micro project;
- a total ceiling of **$30 + tax**;
- evidence retained before clean-up, and clean-up within 48 hours of sign-off and no later than day 10.

Production, Birdie Squad and the `apprigate` Vercel team are out of scope. Real production data is never restored.

**Inputs needed first:** decision-pack section 2, items 3–8 and 10–13, plus the rehearsal date. The synthetic hosted seeding procedure must already be built and tested locally.

| # | Target | Action | Expected result | Stop if |
|---|---|---|---|---|
| A1 | Local repo | `node scripts/localdb/setup.mjs hosted`, then `node scripts/localdb/hosted-rehearsal-tests.mjs`; run the local test of the synthetic hosted seeding procedure; record the commit SHA | 22/22; the seeding test passes | any FAIL, or the SHA is not the reviewed commit |
| A2 | Production DB (read only) | Re-run the inventory queries (`hosted-inventory.md`) | Same relations, policies, grants and mapping counts as recorded | any difference: re-review release file 01 first |
| A3 | Production DB (read only) | Encrypted consistent backup plus manifest (`release-plan.md` section 3); store it encrypted, outside the repo; **do not restore it** | decrypts; the manifest matches | backup or manifest fails |
| A4 | Vercel (new team) | Create a team on the **Pro trial**, with **no payment method** | the trial is active, $0 | the trial is unavailable or asks for a payment method: **stop before any purchase** |
| A5 | Supabase (new org) | Create the org "Apprigate Rehearsal" (Pro, Spend Cap on) with one Micro project in eu-west-1, **no add-ons**; capture the shown price and the Upcoming invoice | the price matches the estimate (Pro $25; Micro compute incurred and offset by the $10 credit); projected total ≤ $30 + tax | a projected total above the ceiling; any add-on outside the spend cap |
| A6 | Rehearsal project | Create the publishable `rehearsal-web` and secret `rehearsal-server` keys; **deactivate the legacy anon and service_role keys** | legacy-key requests → **401**; the new keys work | a legacy key still works |
| A7 | Rehearsal project | Load the **exact live-schema copy plus the synthetic fixtures** with the guarded seeding procedure (synthetic businesses, Auth users and finance records) | the counts match the synthetic manifest | a mismatch; any real data detected |
| A8 | Rehearsal project | Apply release files 01, 02, 03 and 04, each in its own transaction; record the durations | each commits; 01's assertions pass | an error (the file rolls back) |
| A9 | Rehearsal project | Access checks (`hosted-rehearsal-tests.mjs` as SQL, plus the API with anon, Owner and Driver tokens) | no browser access to the 10 relations; only member reads of `businesses`/`business_memberships` | any browser access |
| A10 | Rehearsal project | Auth: Site URL and redirect allow-list = the rehearsal URL; custom test SMTP | saved | — |
| A11 | Vercel (`taxiflow-rehearsal` in the trial team) | Set the variables (as in the decision pack and `release-plan.md` section 6, with the rehearsal keys); deploy the reviewed commit | the build succeeds; `/api/business/*` responds (401 without a token) | the build fails or `/api/business/*` returns 404 |
| A12 | Rehearsal app | **New-key compatibility:** synthetic Owner sign-in, workspace, a finance action, Business access, report preview and PDF | all work with the new keys only | any 401/403 caused by the keys |
| A13 | Rehearsal app | Acceptance checks 1–6 (`release-plan.md` section 9) with synthetic users | all pass | any fail |
| A14 | Rehearsal app and email | Operator scripts (dry run, then apply) for one synthetic business; the **setup email reaches a test mailbox**, the link works and a password is set; `assign-initial-owner` and `load-business-data` | as tested locally; email delivered | email not delivered, or a script misbehaves |
| A15 | Rehearsal app | Expense-only rule (if implemented): examples A–D | indicator, signed variance, "funding source unconfirmed" and no deposit for zero-cash days, as specified | wrong totals; an uncovered amount or a R 0 deposit appears |
| A16 | Phones | Install the rehearsal app on Android and iOS; screenshot the home-screen icons | correct icons, not clipped | a defect |
| A17 | Rehearsal app | Download a PDF; screenshot the rendered page | correct logo, colours and layout | a defect |
| A18 | Rehearsal project | Recovery drills on **synthetic** data: one-business restore (snapshot plus request log); delete a secret key and confirm the app fails closed; maintenance-page deployment; re-promote the release-candidate deployment | as documented | any surprise |
| A19 | Cost (daily) | Check the Supabase Upcoming invoice and usage, and that the Vercel trial still has no payment method | projected total ≤ $30 + tax | the ceiling is exceeded, or a non-capped item appears |
| A20 | Evidence | Export the evidence listed in decision-pack section 5 to `project-os/evidence/rehearsal-<date>/` (no secrets or personal data); raw logs encrypted outside the repo | the evidence is complete and reviewed by Tebogo | evidence missing: don't clean up yet |
| A21 | Clean-up (within 48 hours of sign-off, no later than day 10) | Delete the rehearsal secret key and the project; downgrade the org to Free; leave the Vercel trial with no payment method so it lapses (unless Approval B keeps it) | nothing left running; total spend ≤ ceiling | spend above the ceiling |

**Rehearsal sign-off:** Tebogo records the pass/fail result per row, the durations from A8 and every open issue. Approval B needs a full pass, or approved exceptions.

---

## Part B: Production cutover (Authorization B, separate)

**Approval B** is given once, only after rehearsal sign-off. It covers exactly the scope in decision-pack section 5:
- the Vercel Pro and Supabase production plans with their spend;
- the merge to `main`;
- production keys;
- the window;
- deactivating the legacy keys;
- the backup;
- release files 01–04;
- skip-domain deploy, smoke test and promote;
- old-deployment clean-up;
- the operator session.

The rows below need no further per-step approval. Any stop condition halts the cutover with the maintenance page up and the legacy keys still deactivated.

**Inputs needed first:** decision-pack section 2, items 1, 2 and 4–11 (production URL, DNS, SMTP and sender, with DNS records in place); the window date; Owner communication; the legacy business name.

| # | Target | Action | Expected result | Stop if |
|---|---|---|---|---|
| B1 | Repo | Merge the reviewed commit to `main` (no auto-deploy during the window; disable the Git auto-deploy for `main` first) | `main` = the reviewed SHA; no production build triggered | an unexpected build starts |
| B2 | Production project | Create the publishable `web` and secret `vercel-production` keys (the legacy keys keep working) | keys exist | — |
| B3 | Vercel `taxiflowpro` | Set the **Production** variables (as in A10, with the production values); **remove** any secret key from Preview and Development | variables saved; no build yet | — |
| B4 | Vercel | Build the static **maintenance page** deployment (no Supabase keys) and keep it ready | a ready deployment URL | — |
| B5 | Production (**window opens**) | Promote the maintenance page to the production domain | users see maintenance | promote fails |
| B6 | Production project | **Deactivate the legacy anon and service_role keys** | requests with the legacy anon key and the legacy service key → **401**; the old production and Preview functions fail | any legacy key still works |
| B7 | Production DB (read only) | Re-run the inventory | unchanged since A2 | a difference |
| B8 | Production DB | Encrypted consistent backup plus manifest (database connection, not API keys) | the manifest verifies | backup or manifest fails |
| B9 | Production DB | Apply release file 01 | commits; assertions pass | an error: stop (it rolls back); maintenance stays up |
| B10 | Production DB | Apply 02, then 03, then 04 | each commits | an error: stop |
| B11 | Production DB | Run the access checks (as A8) with the new publishable key and real tokens | browser access denied; mapping counts as in the inventory (5 users, 1 Owner) | any browser access, or a missing Owner |
| B12 | Vercel | `vercel deploy --prod --skip-domain` for the reviewed SHA | a production build with production variables; domain not assigned | build fails |
| B13 | That deployment's URL | Smoke test (as A11): Owner sign-in, workspace, Business access, report | pass | any fail: keep maintenance up, fix forward |
| B14 | Production domain | `vercel promote <deployment>` | the tenant app is live on the domain | promote fails: maintenance stays |
| B15 | Vercel | Delete or protect the old production and Preview deployments; confirm no legacy key value remains in any Vercel environment | only the tenant build, the maintenance page and the release candidate remain | an old deployment is still public with functions |
| B16 | Production | Acceptance checks (`release-plan.md` section 9) | pass | any fail: maintenance page plus forward fix (never revive the old build) |
| B17 | Production | Operator session with a temporary `operator` secret key: onboard the pilot businesses, load their data, then **delete the `operator` key** | businesses ready; key deleted | any refused step: stop and review |
| B18 | Production | Reopen; tell the Owners; monitor the first day | normal use | — |
| B19 | Backups | First post-cutover encrypted backup | the manifest verifies | — |

**Never in Part B:**
- `scripts/localdb/rollback/*`;
- re-creating `using (true)` policies or browser grants;
- re-activating legacy keys for an old build;
- restoring the pre-migration database. That would reopen the live exposure, and needs an explicit separate emergency decision.
