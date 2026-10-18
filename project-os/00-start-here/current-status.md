# Current Status

## Platform admin and multi-company onboarding (2026-10-18): BUILT and TESTED locally; NOT deployed

Branch `agent/platform-admin-onboarding` (from `a85bde6`). **Pushed** with `6b0b249` and `946861d`; **draft PR** https://github.com/Tebza102/taxiflowpro/pull/3 (2 checks passing).

**Preview** `https://taxiflowpro-kd3l04xjy-apprigate.vercel.app` (`dpl_GVo3AdGULhEfSBViNkRkqYyDnca4`): READY, built from `946861d`. Read-only checks:
- the sign-in screen renders;
- `/api/platform/businesses` returns 401 with no token (GET and POST) and with a garbage token, with `no-store`;
- live `taxiflow.co.za/api/platform/businesses` returns 404 (the route is not deployed).

**Limit:** the Preview environment has **no** `SUPABASE_SERVICE_ROLE_KEY` (it is set for Production only). A signed-in platform request on the Preview therefore fails closed with a 503 configuration error before it reaches `platform_admins`, so the Preview cannot demonstrate the "file 05 absent" denial itself. That denial is proven locally (`platform-admin-tests.mjs`: 403 after the file-05 rollback). Read-only production SQL (2026-10-18) shows `platform_admins` absent, 1 business, 6 active members, 1 Owner, no tables without RLS, and browser grants only `authenticated` SELECT on businesses and memberships.

Production is unchanged: `jng5n1ced` = `e59417a`; the Supabase schema has release files 01–04 only.

| | State |
|---|---|
| Built | Release file 05 `public.platform_admins` (operator-granted, browser-locked) + rollback; `GET/POST /api/platform/businesses` (company metadata, create company + Owner); Companies console in the app. Tenant 1 = the existing "TaxiFlow Pro" business, with no data change. Owners already onboard Admin/Manager/Driver (Task 18, unchanged). |
| Tested | Local synthetic stack, real local Auth. Evidence: change log 2026-10-18. |
| Deployed | **Nothing.** No production SQL, grant, push, merge or promote. |

**Confirmed by Tebogo (2026-10-18):** the platform admin is `apprigate@gmail.com`. It stays an active Admin of TaxiFlow Pro unless the Owner removes it.

**External blocker** (unchanged): DKIM for `taxiflow.co.za`. Inviting real new Owners waits for it, but the release itself does not.

Procedure: `05-build/platform-admin-release.md`.

## Frontend prototype integration (2026-10-12; re-checked 2026-10-18, still blocked)

- **2026-10-18 re-check:** `https://taxiflow-pro-operations.divine-tune-4772.chatgpt.site` still shows only OpenAI's "Log in to access" gate.
  - Every path, including `/`, `/index.html`, `/assets/` and `/manifest.json`, returns **401**.
  - Only OpenAI's own gate assets load (`/_sites/dispatch-assets/*`).
  - The design, source files and assets are not inspectable or downloadable.
- **No exported copy** was found in Downloads, Desktop, Documents, OneDrive or the TaxiFlow Drive folder. The only lead is `Downloads/screencapture-localhost-8000-assets-mockups-working-prototype-v2-index-html-2026-08-30…png`, an older local mockup. It is **not confirmed** as the approved design.
- No frontend code was changed.

- Feature branch: `codex/frontend-prototype-integration`, created from `a85bde66adf9941198685619c02d09303526456c` (current release lineage plus documentation updates). `origin/main` is `e59417a96b6df23b8d0bc0dfe08c03971e9f5da1`; local `main` remains older at `008ce8e`.
- Initial worktree clean; origin is `https://github.com/Tebza102/taxiflowpro`. Recorded unused stash `bd2b25a5d48b34fdf557bacc04b8a9793d8da0f1` preserved without applying or dropping it.
- Reference `https://taxiflow-pro-operations.divine-tune-4772.chatgpt.site` shows “Log in to access”; Continue with ChatGPT leads to `auth.openai.com/log-in` requiring a fresh login. Layout, interactions and desktop/mobile design are not yet inspectable. No exported prototype source provided.
- Application code unchanged; no backend, production, credentials, schema, email, DNS, push or deployment action. Implementation and validation have not started.

## Summary

TaxiFlow Pro is currently in a production-hardening release phase on draft PR #2. The feature branch has replaced premature client-side success reporting for live Supabase mutations with confirmed persistence patterns, hardened Owner-first authentication and user lifecycle handling, standardised the live workspace contract, added password recovery, and preserved the existing finance workflow. Application logic is already substantially implemented; the remaining work is release validation and controlled rollout, not product redesign.

## Release state (2026-10-11, stabilisation closed): secure tenant app LIVE for existing users; new-Owner onboarding ON HOLD (DKIM)

The secure tenant release is live on `https://taxiflow.co.za`. Rows 1–11 and 13 PASS. Row 12 works, but one email criterion fails (DKIM), so **onboarding new Owners is on hold** until the hosting ticket (`05-build/email-dkim-hosting-ticket.md`) is resolved and DKIM passes on a repeat test.

| Item | Value |
|---|---|
| Deployed code | `origin/main` = `e59417a96b6df23b8d0bc0dfe08c03971e9f5da1` (code fix `288e3f2`; later commits are Project OS only) |
| Live deployment | `taxiflowpro-jng5n1ced` (`dpl_FruSfHfKnvUv8Gv367g6wzeduEpv`), promoted; `taxiflow.co.za` stays attached |
| Other deployments | `cmlp6fmww` (maintenance fallback) and `301dw9v3b` (branch Preview) only; bypass secrets: 0; auto-assign off |
| Supabase | `vfxftviwteypasredjgm`; release files 01–04 applied, all post-checks PASS; legacy JWT keys disabled; publishable `web_app` and secret `vercel_production` only |
| Data | 1 business "TaxiFlow Pro"; **6 active memberships** (re-read 2026-10-18); 1 active Owner (`owner@apprigate.com`). **Correction:** `apprigate@gmail.com` is an **active Admin**, not inactive. It was removed at 14:18 UTC and restored by the Owner at 16:40 UTC on 2026-10-11 (snapshot audit trail), after the 18:00 SAST note. |
| Backups (all in `C:\Users\appri\taxiflow-recovery\backups` and `G:\My Drive\TaxiFlow backups`, SHA-256 matches; Drive for Desktop reported 0 pending uploads at 17:51 SAST) | final pre-migration `…T07-38-37-806Z` (`390a7d12…`); after-release `…T15-15-11-698Z` tenant format (`7ce304fb…`) |
| Auth URLs | Site URL `https://taxiflow.co.za`; redirects `https://taxiflow.co.za/**` only |
| Email | SMTP `notifications@taxiflow.co.za` as "TaxiFlow"; delivered, but to Gmail **Spam**; SPF and DMARC pass, DKIM `taxiflow.co.za` **fail**. Proven: the only Message-ID was added by the relay after the cPanel signature. Hypothesis: that addition breaks the signature. Ticket drafted, not sent |

**Open findings:**
1. Grant-access role: **closed, no code change.** Normal selection (pointer and keyboard) saves Admin, Manager and Driver exactly, persists after reload, and gives the matching server permissions (`tests/localdb-browser/tenant-access-roles.spec.js`, 1/1). The row 12 mismatch came only from browser automation that changed the dropdown without a change event.
2. DKIM / Spam (above): **the single outstanding blocker** for new-Owner onboarding.

Unused stash kept on purpose: `stash@{0}` (`bd2b25a5d48b34fdf557bacc04b8a9793d8da0f1`, "WIP on agent/tenant-db-foundation: e636df3 …"), the candidate grant-role change (not applied, not deployed).
3. The layout differs from the legacy app; no functional problem.
4. Chrome autofill puts a random value in the email field (Tebogo's saved entries).

Evidence for each row: `05-build/pilot-release-checklist.md` and `08-logs/change-log.md` (2026-10-11 entries).

## Working Branch

`agent/tenant-db-foundation` (fast-forwarded into `main` for the release). The older sections below are history.

### Local commits not yet pushed (2026-10-09)

On top of `ad9641e`, in order:

1. `a424d84` Fix Money crash when a driver day cash-up is in the hand-in queue
2. `00df61a` Add Daily Finance Report preview/PDF and server-side module access policy
3. `78d44c2` Align module-smoke add-driver tests with the Owner-only login opt-in
4. `9cc33fa` Add Preview UAT release-gate tooling and stop tracking generated test output
5. Project OS documentation (this update)

Each code/test commit was checked on its own staged tree in a temporary export. Final checks on the committed code: `node --test tests/*.test.mjs` 238/238, `npm run test:sync-guards` pass, `npm run build` clean, mock Playwright (`module-smoke`, `driver-visibility`, `driver-quick-actions-mobile`, `reports`) 28/28. Preview/live UAT not run. Nothing pushed; the Vercel Preview does not include these commits yet.

Recovery checkpoints (outside Git, no env files): `C:\Users\appri\taxiflow-recovery\task02-20261009T2107\` and `...\task05-20261009T2205\`.

### Pushed and deployed (2026-10-09, verified by Tebogo)

- `origin/agent/owner-first-auth-reset` = `628121b68908a1e1fc820bde932699ef7703a9af` (confirmed by `git fetch` at 23:03).
- Preview: `https://taxiflowpro-lapropkuh-apprigate.vercel.app`, built from `628121b`.
- Production remains on `008ce8e` (`main`).
- The Preview's Supabase project is still not independently confirmed by the agent; the UAT runner now captures and compares it.

### First production backup PASS (2026-10-11 05:26 SAST)

- Row 2 connection proof: **PASS**.
  - Pre-migration format; 1 snapshot, 5 Auth users, 5 identities, 0 legacy rows.
  - File `taxiflow-vfxftviwteypasredjgm-2026-10-11T03-24-06-317Z.tfbk`; verify PASS; check OK.
- **Before the window:** re-run with a backup passphrase that differs from the database password, and make the off-machine copy.
- Email: E1–E4 PASS, E5 delivery PASS; E6 at rows 10a and 12.
- Production keys (row 3) are next.

### Feature freeze: release sequence only (2026-10-11)

**No new features.** Only the release sequence in `05-build/pilot-release-checklist.md` remains, plus fixes for defects it exposes:
1. finish the email (section 3);
2. production credentials and a backup connection proof (rows 2–3);
3. maintenance and blocking old access (rows 4–6);
4. final backup (row 6a);
5. migrations and deployment (rows 7–11);
6. live verification of login, isolation, saving and reports (rows 10, 12–13);
7. the first Owner.

**Hosted-only unknowns and where they are proven** (each at a point where failure is safe):

| Unknown | Proven at | If it fails |
|---|---|---|
| Backup connection (pooler, TLS, Docker) | row 2 | stop before the window |
| Authenticated SMTP, DKIM and SPF alignment | email tests E1–E5 | stop before the window |
| New keys with the server functions | row 10, on the `--skip-domain` URL behind maintenance | stays in maintenance |
| `/api/business/*` routing | row 10, same | stays in maintenance |
| Setup links on `taxiflow.co.za` | row 12 (E6) | hold onboarding |

**Legacy exposure:** `taxiflow.co.za` serves the legacy build until row 5.

### Official email on taxiflow.co.za (Task 32; IN PROGRESS; nothing created yet)

- The **`apprigate.com` sender plan is replaced.** Official TaxiFlow mail uses `support@taxiflow.co.za` (monitored) and `notifications@taxiflow.co.za` (Supabase sender, "TaxiFlow"). Plan and tests are in `05-build/pilot-release-checklist.md` section 3. Older notes that mention `apprigate.com` mail are superseded.
- **Verified from outside:**
  - the cPanel mail zone is complete (MX, one SPF, DKIM `default`, DMARC `p=none`, autodiscover);
  - Exim on `cp24-jhb.za-dns.com` offers AUTH PLAIN/LOGIN on 465 and 587;
  - the TLS certificate covers `cp24-jhb.za-dns.com` only, so SMTP and IMAP use that host;
  - SPF `+a` currently authorises the Vercel apex IP; the fix is to edit that one record.
- **Not yet verified:** plan limits and charges, mailbox creation, authenticated sending, DKIM signing, delivery.
- **Waiting on Tebogo:** sign in to cPanel in the browser pane (opened at `https://cp24-jhb.za-dns.com:2083`) and type every password.

### Domain live and kept attached; maintenance deployment prepared (Task 31; nothing deployed, no keys changed)

- **Domain:** `taxiflow.co.za` and `www` stay attached to `taxiflowpro` (Tebogo's decision).
  - HTTPS is valid (Let's Encrypt, until 2027-01-08); `www` and `http` both redirect 308 to `https://taxiflow.co.za/`.
  - **Both serve production `taxiflowpro-vq1gbf579` = legacy `008ce8e`** until release row 5.
- **Maintenance build:** `deploy/maintenance/` (static: no build, no functions, no keys).
  - Navigations get 200 no-store, because the legacy service worker shows its cached legacy app on any non-OK navigation.
  - A replacement `/sw.js` deletes caches and unregisters itself; `/api/*` returns 503 JSON.
  - **Proof:** `scripts/release/maintenance-tests.mjs` 15/15 (Chromium, with the real `008ce8e` worker) and `tests/maintenance-page.test.mjs` 5/5.
- **Release mechanics found:** Git auto-deploy is on for `main` with auto-assign of custom domains, so it must be turned off before any merge (row 4a). Deployment Protection covers non-custom URLs.

### taxiflow.co.za delegation: LEGACY EXPOSURE IN PROGRESS (Task 29; 2026-10-10 ~20:30 UTC)

- **Registry:** `serverHold` lifted; status `ok`; nameservers `ns3/ns5.za-dns.com` (updated 20:10 UTC by Tebogo).
- **The za-dns zone already contains app records:**
  - A @ `216.198.79.1`;
  - CNAME `www` → `a1963e84e6a53d28.vercel-dns-017.com`.
- **Email records are present and preserved** (not touched):
  - MX `0 mail.taxiflow.co.za`;
  - SPF `v=spf1 +a +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all`;
  - DKIM `default._domainkey`;
  - DMARC `p=none`;
  - `mail`, `webmail`, `cpanel`, `ftp`, `autodiscover` and `autoconfig` → 164.160.91.17.
- **Vercel production is still the legacy build `008ce8e`.** Via the Vercel edge, `http://taxiflow.co.za` serves it (asset `index-DguJu-LE.js`, identical to `taxiflowpro.vercel.app`).
- **Delegation propagation:** 1.1.1.1 already resolves the apex; 8.8.8.8 not yet. **So the legacy app is publicly reachable on this domain**, and Vercel will issue a certificate automatically.
- **Change made (authorized):** Vercel project `taxiflowpro`: `www.taxiflow.co.za` redirects **308** to `taxiflow.co.za`.
- **Not done (needs Tebogo):**
  - binding the apex to a hold branch was refused by Vercel (the branch must exist; creating it needs a push);
  - **detaching the apex from the project was blocked by the agent permission policy.**

### Domain taxiflow.co.za added to the release scope (Task 28; read-only inspection; nothing changed)

- **Registry:** registered via Absolute Hosting (expires 2027-03-26) but on **`serverHold`**. It resolves nowhere (NXDOMAIN at the co.za registry, 1.1.1.1 and 8.8.8.8).
- **Nameservers:** `ns1/ns2.accelerit.ltd`; they serve no zone for it (REFUSED).
- **Records:** no published records, including no MX or email records.
- **Vercel:** apex and `www` are already attached to `taxiflowpro` as production domains, with no www redirect.
  - **Production is still the legacy build `008ce8e`.** DNS records must therefore be added only once the maintenance page is on production (new checklist row 5a).
- **Plan** (`05-build/pilot-release-checklist.md` section 5; X4; rows 5a, 11 and 12):
  - registrar lifts the hold;
  - Vercel `www` redirects 308 to the apex;
  - at row 5a: A @ `216.198.79.1` and `64.29.17.1`, CNAME `www` `a1963e84e6a53d28.vercel-dns-017.com.`;
  - Supabase Site URL `https://taxiflow.co.za`, allow-list `https://taxiflow.co.za/**` only.
- **No code change needed:** redirects follow the request host or fall back to the Site URL.

### Operational safeguards (Task 27; local only; nothing hosted)

Started from verified HEAD `24a58f77f735b3d324c1231fea07bf89231aaa54` (clean worktree).

- **Backup tool built:** `scripts/backup/backup.mjs`, commit `9f90e8a96331eb9d154930e968c8ce6ebf2e71c6`.
  - Export is one read-only REPEATABLE READ transaction covering Auth users and identities, businesses, memberships, snapshots and the request log.
  - Encryption is in memory (AES-256-GCM, scrypt key).
  - PASS is recorded only after the written file is decrypted and matched; any failure logs FAIL and leaves no file.
  - `check` is the morning alert.
  - `restore` does a full restore into an empty project only, or one business's snapshot together with its request log.
  - **Not run against production.**
- **Proof:** `node scripts/localdb/backup-tests.mjs` 35/35 on a fresh local reset. It covers:
  - export, verify and check;
  - a database failure during export (FAIL, no file, check alerts);
  - tampered, truncated and wrong-passphrase files rejected;
  - full restore refused into a non-empty database;
  - full restore into a rebuilt empty database: all tables match, all 11 accounts sign in with their original passwords, isolation holds, and a retried request is replayed, not re-applied;
  - one-business restore leaves the other business, memberships and Auth untouched;
  - no backup files in Git.
- **Legacy production-user scripts retired:** commit `e6634053e9b4c6ba287fe8bbbe304eacff8c0dbf`. `reset-production-users.mjs` and `reconcile-production-users.mjs` print a retirement message and exit 2 with no imports, settings or connections. A test runs them with the old settings present.
- **Release checklist section 4** now has the tested commands, evidence, recovery steps and limitations.

### P1 applied: hosted builds are always tenant (Task 26; local only; nothing hosted)

- **Rule** (`src/lib/securityMode.js`): a build is a tenant build if it has real Supabase settings **or** is configured live. Only a build with no Supabase settings is the separate demo build (local demo data, no network data path).
  - `VITE_TENANT_MODE` and `TAXIFLOW_TENANT_MODE` are removed; no flag can select the legacy path.
  - This closes two holes in the old rule: a mock-configured build with real Supabase settings, and a live mode stored in the browser, could each reach the legacy path.
- **Client fail-closed:** the three legacy functions that touch `workspace_snapshots` directly (`getLiveSnapshotMeta`, `loadSupabaseLiveSnapshot`, `persistSupabaseLiveSnapshot`) refuse in tenant builds before any network call. A test checks that every direct table access sits inside them.
- **Server:** `/api/admin/auth-users` and `/api/admin/bootstrap-workspace` always return 410, with no environment dependence and no service-role code.
- **Release file 04 kept;** order 01→02→03→04 unchanged. `assign-initial-owner` runs only if the pre-flight shows no active Owner. The function and planner refuse otherwise, which is tested.
- **Release decisions recorded** in `05-build/pilot-release-checklist.md`:
  - X1: no existing Vercel entitlement covers the pilot;
  - X2: send through the existing `apprigate.com` mail, with no DNS change;
  - X3: operator daily encrypted backup, whose script is not built yet.
- **Legacy operator scripts flagged:** `scripts/reset-production-users.mjs` and `scripts/reconcile-production-users.mjs` still target the legacy `taxiflow-live` `appUsers` with a service key. They are not configuration or app paths and are never run in the release, but should be retired before go-live (separate task).

### Simple three-owner pilot (Task 25; local only; nothing hosted)

**No separate hosted rehearsal and no extra spend.** The rehearsal decision pack and checklist are superseded by `05-build/pilot-release-checklist.md`, which covers the existing platform.

**Complexity review**
- **Kept** (each has a workflow or security purpose):
  - release files 01–03;
  - the local live-schema rehearsal tooling;
  - the hosted operator scripts and data loader;
  - the legacy-key lockout order;
  - the business picker;
  - branding.
- **Retired** (documents only): the hosted rehearsal decision pack and checklist.
- **Proposed, awaiting approval (behaviour not changed):**
  - **P1:** remove the `VITE_TENANT_MODE` / `TAXIFLOW_TENANT_MODE` dual mode, so a live build is always tenant. This fails safe because a mis-set variable can no longer select the legacy path.
  - **P2:** defer release file 04 (`assign_initial_owner`), because the live inventory already maps an active Owner. Apply it only if the pre-flight shows none.

**Expense-only days (implemented):**
- Every day with entries reaches Banking.
- "Cash to hand in" and "Cash expenses above takings (funding source unconfirmed)" are shown separately; the variance stays signed.
- A verified day with no cash to bank closes with `settlement.closedWithoutDeposit` (status stays `verified`). It is never banked, and no R 0 deposit is created.
- A counted or verified day refuses re-submission (no reopening).
- There is no reimbursement feature.
- Shared helper `src/lib/cashUpContract.js`, used by the server (`financeActions.js`), the client (`App.jsx`, `appRuntime.js`) and the reports (preview and PDF).

**Rendered PDF inspection: done.** A normal report and a closed zero-cash report were rendered to PNG with the Windows PDF API. Three closed-day labels were corrected:
- status: "Verified, closed: no cash to bank";
- deposit status: "Closed: no cash to bank";
- reconciliation chart: an explicit closed message instead of "No data recorded".

Both reports fit on one page.

**Hosting facts** (checked from the docs, 2026-10-10):
- **Vercel Hobby** is non-commercial only (**X1**).
- **Supabase's default SMTP** only emails org team members (**X2**).
- **Supabase Free** has no automatic backups and pauses after a low-activity week (**X3**).

**Onboarding plan:** one real Owner first, then Owners 2 and 3 after the first working day succeeds (`11-client-delivery/first-owner-onboarding.md`).

**Evidence:** see the Task 25 change-log entry.

### Approval A finalised (Task 24; documents only)

- **Synthetic-only first rehearsal.** The production backup is taken read-only, kept encrypted and separate, and not restored.
- **Cost wording:** Micro compute is incurred and offset by the included credit. **Total ceiling $30 + tax**, checked at creation and daily.
- **Zero-cash closure:** the explicit `settlement.closedWithoutDeposit` indicator on verified days; statuses unchanged; no deposits.
- **Vercel trial first:** availability confirmed before any purchase.
- **Evidence before clean-up:** clean-up within 48 hours of sign-off, and by day 10 at the latest.
- **Prerequisite:** a guarded synthetic hosted seeding procedure, to be built and tested locally.

### Decision pack revised (Task 23; read-only; nothing created or purchased)

- **Vercel commercial use verified** from Vercel's Fair Use Guidelines (2026-09-14): Hobby is non-commercial only, so TaxiFlow needs Pro. The rehearsal uses a new Vercel Pro **trial** team ($0, no payment method).
- **Rehearsal estimate:** about $25 plus tax (Supabase Pro org with Micro), ceiling $30 plus tax. Charges not covered by the spend cap are listed and treated as stop conditions.
- **Expense-only days:** the excess is "funding source unconfirmed"; signed variance is kept; zero-cash days close at verified without a deposit.
- **Approvals:** two bounded approvals (A rehearsal, B production) with stop conditions replace the per-step approvals.

### Hosted rehearsal decision pack (Task 22; read-only; nothing created or purchased)

- `project-os/05-build/rehearsal-decision-pack.md`:
  - **Rehearsal options and costs.** The Free organisation's 2 active slots are used by TaxiFlow and Birdie Squad. Recommended: a **new separate Pro organisation with one Micro project, about $25**; Birdie Squad is untouched. Vercel is on **Hobby** (check commercial-use terms before production).
  - **The exact email and domain inputs.**
  - **Refined expense-only handling** (funding sources, examples, smallest pilot implementation, no automatic payables).
  - **Corrected cutover:** the legacy keys are deactivated at the start of the window.
- `project-os/05-build/rehearsal-cutover-checklist.md`: Part A rehearsal and Part B production, with separate authorisations.
- **Still outstanding:** a rendered PDF page check, phone icons and hosted setup email.

### Release candidate prepared (Task 21; hosted inventory read-only; nothing applied)

- **Read-only live inventory** (metadata only), in `project-os/05-build/hosted-inventory.md`:
  - 10 public relations (9 tables plus a view);
  - the 8 empty legacy tables have **RLS off and anon/authenticated ALL, including TRUNCATE**;
  - `workspace_snapshots` has 3 `using (true)` policies and grants anon TRUNCATE;
  - the default privileges are open;
  - no functions or triggers;
  - all 5 users would map, including an Owner.
- **Release files 01–04** (`release-plan.md` section 1):
  - 01 is the generated hosted foundation;
  - 04 is the new operator-only `assign_initial_owner`.
  - Rehearsed locally on an exact synthetic copy of the live schema: rehearsal checks 22/22, the negative control fails as expected, and every server and browser suite passes on the rehearsal database.
- **Cutover plan corrected:**
  - new publishable/secret keys, then deactivate the legacy keys (verified in the Supabase docs);
  - Vercel clean-up;
  - first-release recovery via a maintenance page and forward fix.
- **Guarded hosted operator procedures** in `scripts/hosted/`. Not run.
- **Expense-only days:** analysed, with rule R1–R4 recommended (`expense-only-days.md`). This needs Tebogo's decision.

### Pilot data-load and hosted release preparation (Task 20, local only)

- **Operator loader:** `scripts/localdb/load-business-data.mjs` (local only).
  - Dry run by default; writes only with `--apply`, only to an existing business, in one version-checked write with one operator audit entry.
  - An unchanged repeat writes nothing.
  - It never touches money records, the directory, Auth users or memberships.
  - Planning rules: `scripts/pilot/business-data-plan.mjs`.
  - Proof: 46/46 locally on three synthetic businesses.
- **Owner checklist and input format:** `project-os/05-build/pilot-business-data.md`. No real owner data has been collected.
- **Hosted release plan (documents only, nothing executed):** `project-os/05-build/release-plan.md`. It covers the actual migration inventory, a hosted foundation variant, backup and recovery, mapping, cutover and old-client lockout, configuration, email and the rehearsal.
- **Warning text:** now uses a darker warning tone (`#9B5D00`, 5.30:1); bright `#F39C12` stays for bars.

### Approved branding applied (Task 19, local only)

- The approved full logo and the TF symbol are stored in `assets/brand/source/`.
- Generated assets are in place: logo, `favicon.ico` (16/32/48), Apple 180, PWA 192/512 and separate maskable icons, all on white.
- They are used on sign-in, the business picker, the app header, the manifest, the service worker (cache v8) and the PDF.
- The UI palette was **approved by Tebogo and applied** (navy `#0A1925`, slate, yellow and orange accents; status colours unchanged; contrast verified).
- Evidence:
  - branding smoke checks: demo 4/4, tenant 2/2;
  - demo suite 32/32, tenant browser 9/9, Node 313/313, build passes;
  - the PDF logo was checked at 72×41.7 pt.
- **Still outstanding:** visual inspection of a rendered PDF page, and installed-app icons on a real device.
- Details: `project-os/03-design/brand-rules.md`.

### Pilot onboarding (Task 18, local only)

Business memberships are now the only source of access, with one server path for changes.
- The operator procedure creates a business and its initial Owner (`scripts/localdb/onboard-business.mjs`; the new Owner sets a password from the setup email).
- Owners grant, remove and restore Admin, Manager and Driver access, keep driver profiles without sign-in, and link their own login as an owner-driver (Settings → Business access).
- The database keeps at least one active Owner per business.
- Legacy user and bootstrap routes return 410 in tenant mode.
- Proof with real local Auth: onboarding 64/64; browser onboarding 1/1. This covers three businesses, role access, owner-driver, deactivation blocking a still-signed-in user, isolation, retries and partial failure.
- Fleet, routes, settings and presets stay outside this task. How they will be supplied for the pilot is in `tenant-design.md` → Task 18. Not pushed; nothing hosted.

### Tenant-aware frontend finance workflow (Task 17, local only)

Behind `VITE_TENANT_MODE=true` (live mode), the browser reads only through the server and writes finance only as explicit server actions.
- Reads: authoritative membership/role, a one-business auto-open or an explicit picker/selector, and state scoped per user + business.
- Writes: version + request id per action, with no whole-snapshot saves.
- A conflict keeps the user's entry and asks for a refresh.
- Fleet, user, settings and preset writes are unavailable in tenant mode.
- Actor names are resolved within the business.
- Browser proof against LOCAL Supabase with real local Auth: 6/6 on a fresh reset (capture → submit → count → verify → bank → report, refresh, owner-driver, business switching, isolation, stale-save conflict).
- Demo mode is unchanged (mock Playwright).
- Details and remaining gaps: `tenant-design.md` → Task 17. Not pushed; nothing hosted.

### Essential finance server actions complete (Task 16, local only)

Standalone `income.count`/`income.verify`, `record.edit` and `record.delete` added on the same authorized, atomic, retry-safe path.
- Edit/delete apply to pending records only, with driver ownership, required driver edit reasons and edit history; never banked; closed-day guard.
- Decisions recorded: closed-day guard kept (intentional change), no reopening, explicit trip stops (the frontend supplies route defaults).
- Evidence: record actions 36/36 with real tokens (an edit field-list defect was found and fixed); Node 311/311.
- **Finance server actions now cover capture, cash-up, standalone, edit/delete and banking.** See `tenant-design.md`.

### Scoped finance capture (Task 15, local only)

`capture.standard_income`, `capture.special_income` and `capture.expense` are server actions (create only) using the existing atomic, version-checked, retry-safe pattern.
- Drivers and linked Owner-drivers capture only their own work; management capture needs finance edit.
- Vehicles and driver records are validated in the business, and days that are counted, verified or banked are closed to new driver work (**please confirm**).
- Evidence: capture 43/43 with real tokens, parity with the browser helpers 5/5, Node 307/307.
- Edit/delete and standalone count/verify remain. See `tenant-design.md`.

### Owner-driver submit and scoped banking (Task 14, local only)

- `cashup.submit` now accepts an active Owner with a membership driver linkage (one login; an Owner without a linkage is refused).
- `deposit.lock` (Owner/Manager with finance edit) banks the exact reviewed verified batch atomically with server-generated deposit and audit data.
- The finance request log is retained and included in backup/restore (drill MATCH); a lost log still cannot cause a duplicate (tested).
- Evidence: finance actions 56/56, drill PASS, Node 298/298, build passes.
- Capture, standalone count/verify and edit/delete remain. See `tenant-design.md`.

### Scoped server finance writes (Task 13, branch `agent/tenant-db-foundation`, local only)

`POST /api/business/finance-actions` supports `cashup.submit` (Driver, own staff id from the membership), `cashup.record_handin` (Owner/Admin, pending→counted) and `cashup.verify` (Owner/Manager, counted→verified).
- Explicit fields only; no browser snapshot.
- tenantAuth, then a service role pinned to the business.
- Atomic replay check + `updated_at` CAS + request log in `public.commit_finance_action`.
- Actor and audit generated server-side.
- Evidence: integration 37/37 with real local tokens; Node 296/296; build passes.
- Capture, standalone count/verify, deposit/banking and edit/delete are **not yet** server actions; no frontend integration. See `project-os/04-technical/tenant-design.md`.

### Tenant server authorization (Task 12, branch `agent/tenant-db-foundation`, local only)

`api/_lib/tenantAuth.js` validates the token, resolves the active membership from the database with the caller's token, requires an explicit business when ambiguous (never falls back to `taxiflow-live`), and uses the service role only after authorization, pinned to that business. `snapshotLoader` and the report preview/PDF routes now use it, with role-scoped projections (Driver: own linked records only).
- Evidence: `server-auth-tests.mjs` 26/26 with real local tokens; Node 289/289; reports Playwright 9/9; tenant access 35/35; rollback 8/8; verify 16/16; drill PASS.
- Fixed a Task 11 trigger defect that blocked every legitimate snapshot update.
- `service_role` EXECUTE on the membership RPC is revoked.
- **No server write path and no frontend integration yet.** See `project-os/04-technical/tenant-design.md`.

### Tenant database foundation (branch `agent/tenant-db-foundation`, local only)

Branched from `7fe64a7`; the hardening release branch `agent/owner-first-auth-reset` is unchanged. Businesses, authoritative memberships (Owner/Admin/Manager/Driver; Viewer demo-only; owner-driver linkage), one snapshot per business with an explicit mapping for `taxiflow-live`, an Owner-only membership RPC, tenant-reassignment triggers, and no browser access to snapshots. Proven on the local synthetic database: access 33/33, rollback/compatibility 8/8, verify 16/16, drill PASS. **Not integrated:** the API and frontend still use the single row with direct browser access and would be denied under these rules. See `project-os/04-technical/tenant-design.md`.

### Local commits after the deployed SHA (not pushed)

- `105e3385ef9f9f6c022bd7aef9c34c7a9e215ee0` — UAT safeguards (tooling + 26 mock tests). The deployed Preview is still `628121b`.
- `924ec70f9ae41da6ef57cca644ee19691d475cdc` — Project OS records.
- Isolated local database (2026-10-10 02:01): **running and verified, loopback-only** (Docker Compose with explicit `127.0.0.1` ports; the Supabase CLI is disabled in the workdir). `verify.mjs` gives 14 PASS and 1 expected WARN (flagged live-mirror policies). The synthetic drill recovered schema (from migrations), Auth (users + identities) and snapshot (hash/keys/counts/updated_at/updated_by match; all synthetic sign-ins work). A snapshot-only restore is refused by the FK, proving it incomplete. Live restore remains unverified. See `project-os/05-build/local-supabase-setup.md`.

### UAT safeguards added 2026-10-09 (committed locally as `105e338`)

`scripts/uat/lib/safeguards.mjs`, `scripts/uat/run-preview-uat.mjs`, `tests/uat/preview.spec.js`, `playwright.uat.config.mjs`, `tests/uat-safeguards.test.mjs`. Before any live write the runner now requires:
- the exact verified immutable Preview host (`UAT_EXPECTED_DEPLOYMENT_HOST`), refusing known production hosts, branch/project aliases and custom domains;
- Vercel API confirmation (`VERCEL_TOKEN`) that the host is a READY, non-production deployment of this project at `UAT_EXPECTED_COMMIT_SHA`, and not the production deployment or any of its aliases;
- a disposable fixture (`UAT_FIXTURE_VEHICLE_ID`): a `UAT-` vehicle that is unassigned, not archived and not referenced by any real record. The spec selects it by id; the first/any real vehicle is never used.

During and after the run:
- the workspace is fingerprinted (keys and hashes only) before writing, after provisioning (only the disposable account may change), immediately before the browser suite (the version must be unchanged), and at the end;
- every difference is classified as retained (run audit entries, fixture vehicle), residue (run records left in finance, cash-ups, users, outbox, Auth) or unexpected (anything else, which fails the run);
- the spec stops at the first "Another device changed this workspace" or "Changes are queued" message;
- no whole-snapshot write or restore exists in the UAT tooling (statically tested);
- banked is always "NOT TESTED";
- running the UAT Playwright config directly is refused unless the runner set its preflight flag.

### Push attempt 2026-10-09 22:50 — refused by the agent's permission policy (superseded: Tebogo pushed)

- Pre-push checks passed: branch `agent/owner-first-auth-reset`, HEAD `628121b68908a1e1fc820bde932699ef7703a9af`, clean tracked tree, origin `Tebza102/taxiflowpro`, remote still `ad9641e` (fast-forward).
- Vercel project `taxiflowpro` (team `apprigate`) has `productionBranch: main`, linked to `Tebza102/taxiflowpro`; Git deployments enabled. Pushing this feature branch can only create a Preview.
- Production was unchanged at 22:50: deployment `dpl_4jTd32em9vAqNLNvgPe7YpekSefD`, commit `008ce8ec21ea71c8e81fd1f4f14cdfc76b1d149e` (`main`).
- `git push origin agent/owner-first-auth-reset` was refused by the agent session's permission policy (auto-mode classifier), not by Git or GitHub. A follow-up read-only Vercel CLI listing was refused the same way. No Preview exists for these commits yet, and the Preview's Supabase project is **unverified**.

### Preview UAT write inventory (from reading `scripts/uat/` and `tests/uat/preview.spec.js`, not run)

- Runner, service role: creates one disposable Auth user plus an `appUsers` entry (`taxiflow-uat+<runId>@<domain>`, default role Manager) through `userLifecycle.createUser`; mints an admin recovery link for it; deletes it at the end. The real Owner's password is never changed.
- Spec, through the app UI as the Owner: creates one R 1 "Extra trip" on the **first registered vehicle** (odo 1000→1010, To = run tag), records the hand-in (counted), verifies it, then deletes it. Banked leg is blocked by design.
- Automatic app writes: every sign-out, `pagehide` and tab-hidden event persists the **whole** snapshot even if nothing changed. Writes are compare-and-swap on `updated_at`, so they don't silently overwrite, but they bump the version and can cause conflicts for other open sessions.
- Residue: the runner checks only `financeTransactions` for the run tag. Audit-trail entries are append-only and remain; vehicle odometer/analytics effects of the 1000→1010 reading and any email-outbox entries are not checked.
- `assertNeverProduction` only blocks `taxiflowpro.vercel.app`; any custom production domain is not covered (unverified).

## What Exists

- Production-oriented Supabase Auth with Owner-first access.
- `appUsers` membership enforced in addition to a valid Auth session.
- Coordinated Auth + workspace user lifecycle for create/update/delete/reset-password operations.
- Canonical `taxiflow-live` workspace contract shared by browser/server code.
- Owner-gated idempotent workspace bootstrap.
- Confirmed live persistence patterns for route, driver, fleet, finance, and reachable password-reset-request mutations.
- Finance workflow preserved as `pending -> counted -> verified -> banked`.
- Supabase native password recovery flow with dedicated password-update UX.
- Viewer role intentionally remains demo/mock-data only.
- Vercel Preview deployment exists for the feature branch.
- Reviewed `appUsers` RLS migration exists at `supabase/migrations/20260810_protect_workspace_appusers.sql` but has intentionally not yet been applied to production.

## What Is Proven

According to the current PR validation record:

- Route persistence tests: 18 passing.
- Driver persistence tests: 28 passing.
- Fleet persistence tests: 21 passing.
- Finance persistence tests: 25 passing.
- User lifecycle/concurrency tests: 17 passing.
- Workspace bootstrap tests: 10 passing.
- Final mutation sweep tests: 6 passing.
- Password recovery tests: 20 passing.
- Total Node behavioural suite: 163/163 passing.
- `npm run build` clean.
- `npm run test:sync-guards` passing.
- No plaintext live password is intended to persist in the workspace snapshot.
- Production and Preview no longer depend on the stale `SUPABASE_WORKSPACE_KEY` environment variable.

These results must be re-checked if implementation changes materially after this status entry.

### Re-verified 2026-10-09 (local, HEAD `ad9641eba02e6121e27bed4b8d45fcf556f53cd3` + uncommitted Reports/PDF work)

- `node --test tests/*.test.mjs`: 237/237 pass (20 files). 163 are the committed suites above; 74 come from uncommitted Reports/PDF/access files (`daily-finance-report-*`, `module-access-policy`, `scoped-workspace`).
- `npm run test:sync-guards`: pass. `npm run build`: clean.
- Playwright (mock backend, 4 specs: `module-smoke`, `driver-visibility`, `driver-quick-actions-mobile`, `reports`): 24 pass, 3 fail. The same 3 fail on a clean export of committed HEAD, so they predate the Reports/PDF work:
  - `driver-visibility` "admin records cash hand-in…": Money view crashes for Admin in mock mode (`TypeError: Cannot read properties of null (reading 'id')` inside `FinancePanel`, caught by `AppErrorBoundary`). Real product defect.
  - `module-smoke` "owner settings rights allow admin to add a driver" and "saved driver.two account…": tests still expect a Password field on the add-driver form; commit `fb5bb9e` made login an explicit opt-in. Stale tests.
- Playwright is no longer blocked: `chromium_headless_shell-1217/1234` are installed under `%LOCALAPPDATA%\ms-playwright`.
- `tests/uat/preview.spec.js` (live Preview UAT) was not run.

### Fixed 2026-10-09 (committed locally as `a424d84` / `78d44c2`)

- Money crash: in the hand-in queue, a driver day cash-up has no linked income record by design (`sourceRecord` is `null`). The Delete entry button's `disabled` expression guarded this case, but its label read `sourceRecord.id` unconditionally. It crashed for any role as soon as a driver cash-up was queued; it came in with `d8dd0ba`. Fix: the label is guarded by the existing `isDriverCashUp` discriminator (`src/App.jsx`, one expression). No cash/status or permission logic changed.
- Regression test `driver-visibility` "admin opens Money with a driver cash-up queued…" checks that no error boundary appears, that Delete/Edit are disabled for the cash-up card, and that a R 900 hand-in against R 920 expected survives reload as Expected R 920 / Counted R 900 / Difference R 20, with the stored cash-up `{status: "counted", actualCashReceived: 900, countedByRole: "Admin"}`. Negative control: the same test fails with the original `null.id` crash on the unfixed committed code.
- The two `module-smoke` add-driver tests now follow the explicit login opt-in from `fb5bb9e`. Admin path: no login checkbox or password field, "Owner manages TaxiFlow login access.", profile-only save. Owner path: login off by default, password field shown and hidden by the checkbox, "Create a password for this driver before saving." for a new login-enabled driver, then driver.two replacement, reload persistence and sign-in with the new password.
- After the fixes: 4 mock Playwright spec files 28/28, Node 237/237, sync guards pass, build clean.
- Variance contract: the report's `cashVariance` is signed actual − expected (900 − 920 = −20; short is negative, over is positive), covered by `daily-finance-report-data` tests including a short/over case added 2026-10-09. The hand-in queue's "Difference" is the unsigned shortfall (expected − counted, floored at 0) by design.
- Parked open finding (not fixed, mock/demo mode only): a "profile-only" driver saved without login can still sign in locally with the shared demo password, because mock sign-in resolves any `appUsers` email and falls back to `LOCAL_AUTH_PASSWORD`. This contradicts the "No login access (profile only)" label. Live mode needs a Supabase Auth user, so it is not affected. Needs a product decision before any change.

## What Is Incomplete

1. Final Preview user-acceptance testing has not been recorded as complete.
2. Password recovery still needs an end-to-end Preview smoke test to confirm Supabase recovery-email delivery and redirect allow-list behaviour.
3. A representative authenticated lifecycle/persistence flow should be verified after hard refresh.
4. The finance workflow should be verified on Preview through `pending -> counted -> verified -> banked` after hard refresh.
5. The reviewed `appUsers` RLS migration must only be applied after the hardened application is merged/deployed and confirmed, followed by a short production smoke test.
6. ~~Playwright E2E blocked by missing `chromium_headless_shell`~~ — resolved locally (2026-10-09); the 3 mock-mode Playwright failures are fixed and committed locally (see Fixed 2026-10-09 above).
7. GitHub Actions is not currently an enforced PR check.
8. Reports/PDF, module access policy and UAT tooling are committed locally (`00df61a`, `9cc33fa`) but not pushed, so neither the PR nor the Preview reflects them yet.
9. No isolated database exists for testing: no local Supabase/Docker/psql (Windows or WSL Ubuntu), no dedicated test project, no branches; the org is on the Free plan.

## Current Blockers

- Human/real-browser Preview UAT is the primary release gate.
- End-to-end recovery email/redirect behaviour depends on live Supabase Auth URL configuration and must be verified in the deployed Preview environment.
- Full Playwright browser automation is unavailable in the recorded environment until the required browser runtime is installed or another browser-validation route is used.

## Known Risks

- Applying the `appUsers` RLS migration before the hardened client is deployed could break the currently deployed pre-PR production client.
- Merging before Preview UAT would promote a security/persistence hardening release without the final real-browser acceptance pass.
- Any future mutation path that reports success before canonical remote verification could reintroduce the persistence defect this PR is designed to eliminate.
- Auth-only identities must never be treated as authorised TaxiFlow users without an active `appUsers` record.
- Live database evidence (read-only, 2026-10-09, project `vfxftviwteypasredjgm`): `workspace_snapshots` RLS policies are `using (true)` / `with check (true)` for every authenticated user, so any signed-in role (including Driver) can read and overwrite the whole snapshot directly from the browser; server-side role gates do not cover this path.
- `anon` and `authenticated` hold full table grants including `TRUNCATE` on `workspace_snapshots` and 8 legacy tables. The legacy tables have RLS off (0 rows today). RLS does not govern `TRUNCATE`; grants must be revoked explicitly.
- Preview UAT runs against the same Supabase project as production, so Preview UAT mutates live data.
- Single hardcoded workspace (`taxiflow-live`); tenant/database isolation is not implemented and is a separate, later scope.
- Supabase Auth alone does not make live access safe: Preview acceptance must check `appUsers` membership and the intended Owner/Admin/Manager/Driver/Viewer boundaries, including the direct-browser snapshot path above.
- `npm run uat:preview` provisions and deletes a disposable account in the Supabase project behind the Preview (currently the live project). Run it only deliberately.

## Non-Negotiables

- Preserve Owner protections against in-app deletion/demotion.
- Preserve the canonical `taxiflow-live` workspace contract.
- Preserve the finance lifecycle exactly as `pending -> counted -> verified -> banked` unless a separately approved business change says otherwise.
- Do not persist live passwords or recovery tokens in workspace data.
- Do not weaken Supabase Auth, appUsers membership checks, RLS, concurrency protection, or server-side lifecycle coordination for convenience.
- Do not merge/deploy production merely because automated Node tests pass; complete the applicable release validation first.

## Last Updated

9 October 2026, ~22:35 SAST — verified work committed locally in 5 commits (not pushed) by Claude Code. ~22:00 SAST — mock-mode browser failures fixed. Earlier the same day, ~21:40 SAST — local re-verification by Claude Code (tests/build/Playwright rerun, read-only database inspection). Previous: 16 August 2026, 15:45 SAST — updated from the actual state recorded on draft PR #2 and locked under the Apprigate Development Contract in root `AGENTS.md`.