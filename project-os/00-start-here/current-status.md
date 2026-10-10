# Current Status

## Summary

TaxiFlow Pro is currently in a production-hardening release phase on draft PR #2. The feature branch has replaced premature client-side success reporting for live Supabase mutations with confirmed persistence patterns, hardened Owner-first authentication and user lifecycle handling, standardised the live workspace contract, added password recovery, and preserved the existing finance workflow. Application logic is already substantially implemented; the remaining work is release validation and controlled rollout, not product redesign.

## Working Branch

`agent/owner-first-auth-reset`

Draft PR: `#2 — Harden production auth and reset to Owner-first access`

Do not merge this branch to `main` until the release gates below are satisfied.

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