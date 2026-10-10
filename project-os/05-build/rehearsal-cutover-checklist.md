# Rehearsal and Cutover Checklist (TaxiFlow tenant pilot)

Status: **draft for review; nothing executed.**
- Part A needs **Authorization A** (rehearsal only).
- Part B needs **Authorization B** (production), which is given separately and only after Part A is signed off.
- No step in Part A touches TaxiFlow production (`vfxftviwteypasredjgm`), the Vercel project `taxiflowpro` or Birdie Squad (`ydrrhlpvblwgwboyuwkj`).

**Conventions**
- "Stop" means halt, leave everything as it is, and record the reason.
- Rehearsal stops don't affect production.
- Production stops keep the maintenance page up, with the legacy keys still deactivated.
- The release files are `supabase/release/tenant-pilot/01_tenant_foundation.sql`, then `scripts/localdb/migrations/20261010063144_finance_actions.sql` (02), `20261010113000_pilot_onboarding.sql` (03) and `20261011090000_assign_initial_owner.sql` (04).

---

## Part A: Hosted rehearsal (Authorization A)

**Authorization A covers:**
- creating a new Supabase organisation on Pro with one Micro project (about **$25**; see the decision pack);
- creating a separate Vercel project for the rehearsal;
- creating rehearsal keys and SMTP sandbox settings;
- restoring the encrypted production backup into the rehearsal project;
- deleting the rehearsal project and downgrading its organisation afterwards.

It does **not** cover any change to production.

**Inputs needed first:** decision-pack section 2, items 3–8 and 10–13 (the rehearsal URL and email inputs), plus the rehearsal date.

| # | Target | Action | Expected result | Stop if |
|---|---|---|---|---|
| A1 | Local repo | `node scripts/localdb/setup.mjs hosted`, then `node scripts/localdb/hosted-rehearsal-tests.mjs`; record the commit SHA | 22/22 | any FAIL, or the SHA is not the reviewed commit |
| A2 | Production DB (read only) | Re-run the inventory queries (`hosted-inventory.md`) | Same relations, policies, grants and mapping counts as recorded | any difference: re-review release file 01 first |
| A3 | Production DB (read only) | Encrypted consistent backup (`release-plan.md` section 3) plus manifest | decrypts; the manifest matches the row counts and hashes | backup fails or the manifest doesn't match |
| A4 | Supabase | Create the org "Apprigate Rehearsal" (Pro, Spend Cap on) and one Micro project in eu-west-1 | the project is active; cost shown as expected | the cost differs from the decision pack |
| A5 | Rehearsal project | Create the publishable `rehearsal-web` and secret `rehearsal-server` keys; **deactivate the legacy anon and service_role keys at once** | legacy-key requests → **401**; new keys work | a legacy key still works |
| A6 | Rehearsal project | Restore the backup (A3): schema copy, data, Auth users | row counts and hashes match the manifest | any mismatch |
| A7 | Rehearsal project | Apply release files 01, 02, 03 and 04, each in its own transaction; record the duration of each | each file commits; 01's assertions pass | any error (the file rolls back): stop and fix forward locally |
| A8 | Rehearsal project | Run the `hosted-rehearsal-tests.mjs` checks as SQL, plus the API checks with anon, Owner and Driver tokens | no browser access to the 10 relations; only `businesses`/`business_memberships` readable by members | any browser access |
| A9 | Rehearsal project | Configure Auth: Site URL = the rehearsal URL; redirect allow-list = the rehearsal URL; custom SMTP (sandbox or test sender) | settings saved | — |
| A10 | Vercel (`taxiflow-rehearsal` project, new) | Set its variables: `VITE_BACKEND_MODE=live`, `VITE_TENANT_MODE=true`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`=`rehearsal-web`, `TAXIFLOW_TENANT_MODE=true`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`=`rehearsal-web`, `SUPABASE_SERVICE_ROLE_KEY`=`rehearsal-server`; deploy the reviewed commit | the build succeeds; `/api/business/*` routes respond (401 without a token) | the build fails or `/api/business/*` returns 404 |
| A11 | Rehearsal app | **New-key compatibility:** sign in as the mapped Owner; load the workspace; one finance action; Business access list; report preview and PDF | all work with only the new keys | any 401/403 caused by the keys |
| A12 | Rehearsal app | Acceptance checks 1–6 (`release-plan.md` section 9): every mapped user's role; the full money flow (capture → submit → count → verify → bank → report); stale-save conflict; closed day; isolation; legacy routes 410 | all pass | any fail |
| A13 | Rehearsal app and email | Operator: `scripts/hosted/onboard-business.mjs` dry run, then apply for one synthetic business (a test mailbox as Owner); the **setup email arrives**, the link works and a password is set; then `assign-initial-owner.mjs` dry run on an owner-less test business, and `load-business-data.mjs` dry run and apply | emails delivered; procedures behave as tested locally | the email isn't delivered, or the link fails |
| A14 | Rehearsal app | **Expense-only rule** (if implemented): decision-pack examples A–D | as specified | wrong totals, or an uncovered amount appears in a deposit |
| A15 | Phones | Install the rehearsal app on Android and iOS; check the home-screen icons (maskable) | icons correct, not clipped | wrong icon |
| A16 | Rehearsal app | Download a Daily Finance Report PDF and inspect the rendered page visually | logo, colours and layout correct | a defect |
| A17 | Rehearsal project | Recovery drills: one-business restore (snapshot plus request log); delete the secret key and confirm the app fails closed; deploy the maintenance page; re-promote the release-candidate deployment | each behaves as documented | any surprise |
| A18 | Supabase and Vercel | Delete the `rehearsal-server` key and the rehearsal project; downgrade the rehearsal org; delete or keep the `taxiflow-rehearsal` Vercel project, as decided | no rehearsal resources left running | — |

**Rehearsal sign-off:** Tebogo records the pass/fail result per row, the durations from A7, and every open issue. Part B needs a full pass, or approved exceptions.

---

## Part B: Production cutover (Authorization B, separate)

**Authorization B is given only after rehearsal sign-off.** It covers:
- creating the production keys;
- the merge to `main`;
- the maintenance window;
- deactivating the legacy keys;
- applying release files 01–04 to production;
- the production deploy and promote;
- deleting old deployments;
- the hosted operator runs.

**Each row marked ✋ needs a fresh "go" from Tebogo at execution time.**

**Inputs needed first:** decision-pack section 2, items 1, 2 and 4–11 (production URL, DNS, SMTP and sender, with DNS records in place); the window date; Owner communication; the legacy business name.

| # | Target | Action | Expected result | Stop if |
|---|---|---|---|---|
| B1 | Repo | ✋ Merge the reviewed commit to `main` (no auto-deploy during the window; disable the Git auto-deploy for `main` first) | `main` = the reviewed SHA; no production build triggered | an unexpected build starts |
| B2 | Production project | ✋ Create the publishable `web` and secret `vercel-production` keys (the legacy keys keep working) | keys exist | — |
| B3 | Vercel `taxiflowpro` | ✋ Set the **Production** variables (as in A10, with the production values); **remove** any secret key from Preview and Development | variables saved; no build yet | — |
| B4 | Vercel | Build the static **maintenance page** deployment (no Supabase keys) and keep it ready | a ready deployment URL | — |
| B5 | Production (**window opens**) | ✋ Promote the maintenance page to the production domain | users see maintenance | promote fails |
| B6 | Production project | ✋ **Deactivate the legacy anon and service_role keys** | requests with the legacy anon key and the legacy service key → **401**; the old production and Preview functions fail | any legacy key still works |
| B7 | Production DB (read only) | Re-run the inventory | unchanged since A2 | a difference |
| B8 | Production DB | Encrypted consistent backup plus manifest (database connection, not API keys) | the manifest verifies | backup or manifest fails |
| B9 | Production DB | ✋ Apply release file 01 | commits; assertions pass | an error: stop (it rolls back); maintenance stays up |
| B10 | Production DB | ✋ Apply 02, then 03, then 04 | each commits | an error: stop |
| B11 | Production DB | Run the access checks (as A8) with the new publishable key and real tokens | browser access denied; mapping counts as in the inventory (5 users, 1 Owner) | any browser access, or a missing Owner |
| B12 | Vercel | ✋ `vercel deploy --prod --skip-domain` for the reviewed SHA | a production build with production variables; domain not assigned | build fails |
| B13 | That deployment's URL | Smoke test (as A11): Owner sign-in, workspace, Business access, report | pass | any fail: keep maintenance up, fix forward |
| B14 | Production domain | ✋ `vercel promote <deployment>` | the tenant app is live on the domain | promote fails: maintenance stays |
| B15 | Vercel | ✋ Delete or protect the old production and Preview deployments; confirm no legacy key value remains in any Vercel environment | only the tenant build, the maintenance page and the release candidate remain | an old deployment is still public with functions |
| B16 | Production | Acceptance checks (`release-plan.md` section 9) | pass | any fail: maintenance page plus forward fix (never revive the old build) |
| B17 | Production | ✋ Operator session with a temporary `operator` secret key: onboard the pilot businesses, load their data, then **delete the `operator` key** | businesses ready; key deleted | any refused step: stop and review |
| B18 | Production | Reopen; tell the Owners; monitor the first day | normal use | — |
| B19 | Backups | First post-cutover encrypted backup | the manifest verifies | — |

**Never in Part B:**
- `scripts/localdb/rollback/*`;
- re-creating `using (true)` policies or browser grants;
- re-activating legacy keys for an old build;
- restoring the pre-migration database. That would reopen the live exposure, and needs an explicit separate emergency decision.
