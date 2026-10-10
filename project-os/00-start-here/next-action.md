# Next Action

## Immediate Next Step (updated 2026-10-10 23:35 SAST, Task 32)

**Email on `taxiflow.co.za`** (checklist section 3). Tebogo:
1. Sign in to cPanel in the browser pane.
2. The agent then reads the plan limits and Email Deliverability and prepares each form.
3. Tebogo types the passwords and clicks Create or Save for:
   - `support@`;
   - `notifications@`;
   - the notifications → support forwarder;
   - the SPF edit (remove `+a`);
   - Supabase SMTP.
4. Then tests E1–E5.
- E6 (real setup email on `taxiflow.co.za`) waits for release row 12.
- The Site URL and redirects change only at row 12.

## Immediate Next Step (updated 2026-10-10 22:55 SAST, Task 31)

The domain is live and serves the legacy build until release row 5. Maintenance is prepared and tested; nothing is deployed and no keys are changed. The release actions and inputs are in `05-build/pilot-release-checklist.md` rows 1–13 and sections 3–6.

## URGENT (2026-10-10 ~20:30 UTC, Task 29): stop taxiflow.co.za serving the legacy app

**Tebogo, now:** in Vercel → project `taxiflowpro` → Settings → Domains → `taxiflow.co.za` → **Remove**.
- The domain stays verified in the team, and the DNS records can stay as they are.
- Vercel then answers 404 for this host, and `www` (308) leads to that 404.
- Alternatively, allow the agent to run the detach.

**At activation** (release row 5a, once the maintenance page or the tenant build is in production):
1. Re-attach `taxiflow.co.za` to `taxiflowpro` as a production domain.
2. Re-read Vercel's required values and compare them with the zone.
3. Verify HTTPS and the redirects.

## Immediate Next Step (updated 2026-10-10, Task 28)

`taxiflow.co.za` is in the release scope. The proposed changes are in `05-build/pilot-release-checklist.md` section 5 and are **not applied**.

**Tebogo (in addition to the Task 27 list below):**
1. **X4:** ask Absolute Hosting why `taxiflow.co.za` is on `serverHold` and have it lifted. Confirm the zone exists on the Accelerit nameservers. **Add no records yet.**
2. Approve the proposed Vercel change (`www` redirects 308 to the apex) and the DNS records for row 5a.
3. Decide whether to detach `taxiflow.apprigate.com` from the Vercel project.

## Immediate Next Step (updated 2026-10-10, Task 27)

The local operational safeguards are done: the backup tool is tested (35/35) and the legacy production-user scripts are retired. **Nothing has been run against production.**

**Tebogo:**
1. **X1:** authorize the Vercel Pro upgrade ($20/month).
2. **X2:** create the dedicated `apprigate.com` mailbox and type its password into Supabase SMTP yourself (checklist section 3).
3. **Backup:**
   - choose a backup passphrase (16+ characters, kept in a password manager);
   - create `C:\Users\appri\taxiflow-recovery\backup.env` with the Session pooler settings (checklist section 4);
   - authorize the first production export (checklist row 2).
4. Authorize the release window (rows 1–13).
5. Name the first pilot Owner.

**Agent, after authorization:** run the checklist. The first production export is row 2, after the read-only pre-flight.

## Immediate Next Step (updated 2026-10-10, Task 26)

P1 is applied locally (hosted builds are always tenant). Release file 04 is kept. Release decisions are in `05-build/pilot-release-checklist.md` sections 0, 3 and 4.

**Tebogo:**
1. **X1:** authorize the Vercel Pro upgrade of the `apprigate` team ($20/month). No existing entitlement covers commercial use.
2. **X2:** authorize one dedicated mailbox on the existing `apprigate.com` mail hosting, and type its password into the Supabase SMTP settings yourself (section 3).
3. **X3:** accept the operator daily backup (section 4), and authorize the agent to build and locally test the guarded backup script (no hosted run).
4. Authorize the release window (checklist rows 1–13).
5. Name the first pilot Owner.

**Agent, next (only with authorization):**
- build and locally test the backup script;
- retire the legacy production-user scripts;
- then the release window.

## Immediate Next Step (updated 2026-10-10, Task 25)

**There is no separate hosted rehearsal and no extra spend.** The release follows `project-os/05-build/pilot-release-checklist.md` on the existing platform. Onboarding follows `project-os/11-client-delivery/first-owner-onboarding.md`.

**Tebogo (decisions and authorizations):**
1. **X1 Vercel:** the Hobby plan is non-commercial only. Authorize the upgrade of the `apprigate` team to Pro ($20/month), or choose another eligible host. No purchase made.
2. **X2 email:** choose the custom SMTP provider and sender domain, and authorize its SPF/DKIM DNS records. Without these, setup emails cannot reach pilot Owners.
3. **X3 backups:** accept Supabase Free (no automatic backups; operator encrypted backups daily during the pilot) or upgrade.
4. **Proposals P1 and P2** (`current-status.md`, Task 25): approve or refuse them. P1 removes the tenant-mode switch. P2 skips release file 04 because an Owner already maps.
5. Authorize the release window: push, merge to `main`, keys, migrations 01–03, deploy, promote.
6. Name the first pilot Owner and collect their set-up data.

**Agent, after authorization:** run the checklist rows 1–13, then onboard the first Owner. Add Owners 2 and 3 only after the first working day succeeds.

## Previous next steps (history)

### 2026-10-09 ~22:35

The local test gaps are closed and committed locally (`a424d84`, `00df61a`, `78d44c2`, `9cc33fa`, plus the Project OS commit). See `current-status.md` → Local commits not yet pushed.

1. ~~Push~~ — done by Tebogo: `628121b` is on origin; Preview `https://taxiflowpro-lapropkuh-apprigate.vercel.app`; production still `008ce8e`.
1a. ~~Commit the UAT safeguards~~ — done locally: `105e3385ef9f9f6c022bd7aef9c34c7a9e215ee0` (tooling + tests) and `924ec70f9ae41da6ef57cca644ee19691d475cdc` (Project OS). Not pushed.
1c-progress (2026-10-10 01:06): Docker Desktop 4.94.0 installed per-user (WSL 2, Linux containers, Windows containers off). Installer verified by SHA-256 and Authenticode. Terms accepted by Tebogo; engine 29.8.2 running; `docker run --rm hello-world` passed; port 2375 not exposed. **Next:** Supabase local init per `project-os/05-build/local-supabase-setup.md` steps 4–8, on Tebogo's go-ahead (open a new terminal so the Docker PATH entry is loaded).
1d-progress (2026-10-10 02:01): ~~local Supabase binding blocker~~ resolved with option 3 (Compose, explicit 127.0.0.1 ports, CLI disabled by an invalid sentinel config). Verify 14 PASS / 1 WARN; synthetic drill passed for schema, Auth and snapshot. Committed locally; not pushed.
1s (2026-10-10): Approval A is final (Task 24).

**Before Part A can run:**
1. **Tebogo grants Approval A** (`rehearsal-decision-pack.md` section 5).
2. The email inputs are supplied.
3. The agent builds and locally tests the **guarded synthetic hosted seeding procedure** (no hosted change).
4. The expense-only rule (with the `closedWithoutDeposit` indicator) is implemented and tested locally if chosen.
1r (2026-10-10): decision pack revised (Task 23).

**Tebogo:**
1. Grant or refuse **Approval A** (rehearsal: ≈ $25 + tax, ceiling $30 + tax; Vercel Pro trial team $0) as scoped in `rehearsal-decision-pack.md` section 5.
2. Supply the email and domain inputs.
3. Choose the expense-only pilot rule (section 3e).

**Agent, next:** implement and test the expense-only rule locally if chosen; then run checklist Part A within Approval A.
1q (2026-10-10): decision pack and checklist ready (Task 22).

**Tebogo:**
1. Approve rehearsal option A (about $25) and give **Authorization A**.
2. Supply the email and domain inputs (decision-pack section 2).
3. Decide the expense-only pilot rule (decision-pack section 3).
4. Check the Vercel Hobby terms for the pilot.

**Next (agent, after the decision):** implement and test the expense-only pilot rule locally; then run Part A of `rehearsal-cutover-checklist.md`, with approval at each step.
1p (2026-10-10): release candidate prepared (Task 21). **Decisions for Tebogo before the hosted rehearsal** (`release-plan.md` section 11):
1. The rehearsal project slot.
2. The SMTP provider, domain and production URL.
3. The legacy business name and its pilot role.
4. The maintenance window.
5. The expense-only-day rule (R1–R4) or the interim guidance.
6. Whether to drop the empty legacy tables later.

**Next (after the decisions):**
- implement and test the expense-only rule if accepted;
- then the hosted rehearsal (`release-plan.md` section 9) with approval at each step.

Re-run the local rehearsal:
```
node scripts/localdb/setup.mjs hosted
node scripts/localdb/hosted-rehearsal-tests.mjs
```
1o (2026-10-10): pilot data loader and hosted release plan done (Task 20; plan only, nothing hosted). **Decisions for Tebogo** (`release-plan.md` section 11):
- the rehearsal project slot;
- the SMTP provider, domain and production URL;
- the legacy workspace's business name and pilot role;
- the maintenance window.

**Next (separate tasks):**
1. Hosted foundation SQL variant (drop the actual live policies, revoke all 9 tables' grants, no interim RPC), reviewed locally against the pre-flight inventory.
2. Hosted operator procedures with target confirmation.
3. An operator step to add an Owner to an existing business, if the mapping needs it.
4. The expense-only-day Banking queue decision.
5. Then the hosted rehearsal.
1n-done (2026-10-10): palette approved and applied. Still outstanding: PDF page visual inspection and real-device installed-app icons. Optional follow-up: a darker warning text tone (semantic `#F39C12` text is about 2.2:1 on white).
1n (2026-10-10): branding applied locally (Task 19). **Decision for Tebogo:** approve, or adjust, the UI palette in `project-os/03-design/brand-rules.md` (navy `#0A1925`, slate `#253947`, yellow `#FDB801`, orange `#F58801`, white). Then a small follow-up applies it to the CSS variables and `theme-color`, keeping status colours. Also check installed-app icons on a real Android and iOS device once a Preview carries this branch. Pilot blockers are unchanged (1m).
1m (2026-10-10): pilot onboarding done locally (Task 18). **Next (separate task):** fleet, route (with stops), settings and preset data for the pilot. Either add tenant server actions, or first an operator data-load procedure (see `tenant-design.md` → Task 18). Then a hosted migration and onboarding plan for Tebogo's review (backup and rollback first), and hosted email/redirect settings. Re-run the proof: `node scripts/localdb/setup.mjs reset`, then `node scripts/localdb/onboarding-tests.mjs`; then reset again and run `npx playwright test -c playwright.localdb.config.mjs`.
1l (2026-10-10): tenant-aware frontend finance workflow done locally behind `VITE_TENANT_MODE` (Task 17); browser proof 6/6 on the local stack. **Next (separate task):** the membership-based user lifecycle/bootstrap, then tenant server actions for fleet/driver/route/settings/preset writes (currently blocked in tenant mode), then a hosted migration plan for Tebogo's review. Re-run the proof with `node scripts/localdb/setup.mjs reset` then `npx playwright test -c playwright.localdb.config.mjs`.
1k (2026-10-10): essential finance server actions complete locally (Task 16); closed-day guard confirmed. **Next (separate task):** actor display names, then the membership-based user lifecycle/bootstrap (`userLifecycle`, `auth-users`, `bootstrap-workspace`), then frontend integration of the finance actions (route-stop defaults, business selection, expectedVersion/requestId handling).
1j (2026-10-10): scoped capture done locally (Task 15). **Decision for Tebogo:** confirm that driver work cannot be added to a day already counted, verified or banked. **Next (separate task):** edit/delete of capture records (driver edit reason, never banked) and standalone count/verify; then actor display names, the membership-based user lifecycle and frontend integration.
1i (2026-10-10): owner-driver submit and `deposit.lock` done locally; request log retained and backed up (Task 14). **Next (separate task):** standalone count/verify, then capture (`saveStandardIncome`/`saveSpecialIncome`/`saveExpense`) and edit/delete as server actions; actor display names; then the membership-based user lifecycle and frontend integration.
1h (2026-10-10): scoped server writes for day cash-up submit / hand-in / verify done locally (Task 13). **Next (separate task):** extend the same pattern to `lockDeposit` (verified→banked, Owner/Manager), standalone record count/verify, then capture (`saveStandardIncome`/`saveSpecialIncome`/`saveExpense`) and edit/delete; map server actor ids to display names. Then the membership-based user lifecycle, then frontend integration.
1g (2026-10-10): server authorization boundary done locally for snapshot loading and report routes (Task 12). **Next (separate task):** a scoped server **write** endpoint (per-role `mergeScopedChanges`, `updated_at` CAS, pinned to the authorized business; no unrestricted whole-snapshot writes), then move `userLifecycle`/`auth-users`/`bootstrap-workspace` to `business_memberships`, then frontend `dataGateway` integration. All proven locally before any hosted plan.
1f (2026-10-10): ~~1e~~ tenant DB foundation done locally on `agent/tenant-db-foundation` (see `tenant-design.md`). **Next (separate task):** server-side integration. API routes resolve `business_id` from the caller's active membership; snapshot read/write moves behind those routes with role-scoped Driver projections; `dataGateway` stops direct table access; `userLifecycle` manages `business_memberships`. Prove it locally against this database before any hosted migration plan.
1e. ~~Next:~~ use the local stack to design and test the tenant/role isolation migration (replacing the flagged live-mirror policies, revoking anon/TRUNCATE grants, membership-based RLS) against synthetic multi-tenant fixtures, as a separate scoped task. Live UAT prerequisites (UAT- fixture vehicle, Vercel token, encrypted live backup) are unchanged.
1c. **Next (Tebogo, human):** set up the isolated local database per `project-os/05-build/local-supabase-setup.md`: free about 4 GB RAM, install Docker Desktop per-user, confirm `docker run --rm hello-world`, create `C:\Users\appri\taxiflow-localdb` outside the repo, `npx --yes supabase@2.120.0 init`, disable analytics, copy the baseline schema, `supabase start`. Then the agent runs the verification list in that file: reachable, synthetic-only, cannot target live, baseline loads, synthetic export/restore drill.
1b. Before any live UAT run (Tebogo):
   - create a disposable vehicle in the live workspace with a registration starting `UAT-`, unassigned, and note its id;
   - add `UAT_EXPECTED_DEPLOYMENT_HOST`, `UAT_EXPECTED_COMMIT_SHA`, `UAT_FIXTURE_VEHICLE_ID` and a read-only-scoped `VERCEL_TOKEN` to the gitignored `.env.uat.local`;
   - take the encrypted backup (see "Backup before UAT");
   - close other TaxiFlow sessions during the run.
   The runner will still refuse if any check fails.
2. Run the PR #2 Preview acceptance below on that Preview. In addition to the listed gates, check `appUsers` membership and role boundaries per role: Owner, Admin, Manager, Driver (own records only), and Viewer (demo-only). Also check the Reports access rules (Owner/Admin/Manager with Money access; Driver/Viewer never). Supabase Auth succeeding is not enough on its own.
3. Parked, not part of this gate: the mock/demo "profile-only driver can still sign in locally" gap (see `current-status.md`).

Still blocked or out of scope for this gate: tenant/database isolation (not implemented); `workspace_snapshots` open to every authenticated user via `using (true)`; `anon`/`authenticated` `TRUNCATE` and full grants on 9 tables (RLS does not govern `TRUNCATE`; revoke explicitly in a later, reviewed migration); the held `appUsers` migration; no isolated database for migration/restore drills.

### Backup before UAT (approach; not yet executed)

A local Node script (no new packages) reads `SUPABASE_URL` and the service-role key from the gitignored `.env.uat.local` at runtime, never printing them or passing them as arguments. It selects the `taxiflow-live` row (`snapshot`, `updated_at`) and an auth user list (id, email, created_at only). It writes JSON to stdout, piped straight into `gpg --symmetric --cipher-algo AES256` (passphrase at the prompt), producing `C:\Users\appri\taxiflow-recovery\backups\<timestamp>.json.gpg`. Nothing plaintext touches disk; the folder is accessible only to the user, SYSTEM and Administrators. The manifest stores only SHA-256, `updated_at`, top-level key names and per-key item counts. Passwords cannot be exported, so a restore needs password resets.

Isolated-restore blocker: no Docker, Supabase CLI or psql (Windows or WSL); no dedicated test project; the Free org already has 2 active projects; branching is not available on Free. Restore stays unverified until Tebogo provides a slot (pause a project, or upgrade) or installs Docker Desktop.

### Preview acceptance plan (Tebogo, after push and backup)

1. Owner sign-in on the Preview, then hard refresh: still signed in as Owner.
2. Save/refresh: one disposable, clearly named change (e.g. a UAT-tagged route note), then hard refresh: it persists; remove it afterwards.
3. Finance on a disposable R 1 record: pending → counted → verified with a refresh after each step. A second management user verifies if available. Banked only on an isolated workspace, otherwise not run. Delete the record and check residue (finance, audit, vehicle odometer).
4. Password recovery: "Forgot password?" for a test account whose inbox Tebogo controls (not the Owner, unless deliberately). Email arrives, the link returns to an allowed Preview origin, update, sign out, sign in with the new password.
5. Membership and roles (read-only checks): an Auth user without an active `appUsers` record is refused; Admin/Manager see only their granted modules; Reports only for Owner/Admin/Manager with Money; Driver sees own records; Viewer stays demo-only. No destructive or bypass security tests on live.

Then continue with the release validation below. Preview UAT steps that sign in with Tebogo's Owner account or need the recovery email must be done by Tebogo; Preview uses the live Supabase project, so any UAT mutation is a live-data change.

## Current Recommended Action (PR #2 release validation)

Finish TaxiFlow PR #2 as a release-validation pass. Do not add product features or redesign the application.

Use the existing Vercel Preview and current branch implementation to prove the remaining real-browser release gates:

1. Sign in with an authorised non-demo account and verify the session resolves correctly after hard refresh.
2. Perform one representative live persistence flow and confirm the saved state survives hard refresh.
3. Run one finance path through `pending -> counted -> verified -> banked`, confirming canonical remote state after each meaningful step.
4. Trigger `Forgot password?` on Preview and verify Supabase recovery email delivery, redirect back to an allowed Preview origin, password update, sign-out, and subsequent sign-in with the new password.
5. Record exact pass/fail evidence. Fix only concrete defects exposed by these tests.

## If a Defect Appears

- Inspect the exact browser console/network/API/database evidence first.
- Make the smallest reversible fix.
- Rerun only the relevant failing flow plus the closest regression checks.
- After two failed fixes for the same root issue, stop editing and re-diagnose from evidence.
- Do not create a replacement auth, persistence, finance, or workspace architecture.

## Do Not Do Yet

- Do not merge PR #2 to `main` until Preview UAT passes.
- Do not apply `supabase/migrations/20260810_protect_workspace_appusers.sql` before the hardened production deployment is confirmed.
- Do not redesign Viewer behaviour; it intentionally remains demo/mock-data only.
- Do not rename or alter the finance status lifecycle.
- Do not migrate framework, replace Supabase, or introduce unrelated abstractions/packages.
- Do not expand this release into multi-tenant product work; handle that as a separately scoped gate after the hardening release closes.

## Definition of Done

This release-validation action is complete when:

- authenticated access and post-refresh persistence pass on Preview;
- the representative live mutation survives hard refresh;
- the full finance state progression passes on Preview;
- password recovery works end to end against the deployed Preview/Supabase configuration;
- any discovered defects have focused regression proof;
- `npm run build`, behavioural tests, and sync guards still pass after any code change;
- `current-status.md`, this file, and the PR description reflect the actual result.

If all gates pass, the next action is to mark PR #2 ready for review/merge. After the hardened `main` production deployment is confirmed, apply the reviewed `appUsers` RLS migration and run a short production smoke test.