# Release Plan: Tenant Pilot (hosted), DOCUMENT ONLY

> **2026-10-10 (Task 25):** there is no separate hosted rehearsal. The executable release steps are in `pilot-release-checklist.md` (existing platform, blockers X1–X3). Sections 9 and 11 below are kept for reference.

Status 2026-10-10: **plan only. Nothing in this document has been executed against a hosted project, DNS or email.**
- Branch: `agent/tenant-db-foundation` (local commits).
- Production: `main` @ `008ce8e` on the live Supabase project `vfxftviwteypasredjgm`.
- Every hosted step below needs Tebogo's explicit approval at the time it is run.

## 1. Migration inventory (actual files, 2026-10-10)

| File | Kind | Hosted action | Depends on |
|---|---|---|---|
| `supabase/schema.sql` | Original hosted schema: `workspace_snapshots` with 3 permissive policies, plus 8 legacy tables (`fleet_profiles`, `personnel_profiles`, `vehicles`, `shift_reconciliations`, `expense_entries`, `banking_events`, `defect_reports`, `compliance_documents`) | Already live. Do **not** re-run. | — |
| `supabase/migrations/20260405_add_trip_analytics_fields.sql` | Adds columns to `shift_reconciliations`, a table the app no longer uses | Optional and harmless. The pre-flight records whether it is live. Not needed for the pilot. | schema.sql |
| `supabase/migrations/20260810_protect_workspace_appusers.sql` | Held `appUsers` guard trigger | **Do not apply. It is superseded**: after the tenant migration, browsers have no snapshot access at all, and `appUsers` is a directory, not the access source. | schema.sql |
| `scripts/localdb/migrations/20261009232543_baseline_workspace_snapshots.sql` | Local mirror of the live table | **Local only.** Never deploy. | — |
| `scripts/localdb/migrations/20261009232558_local_marker.sql` | Local tooling identity marker | **Never deploy.** A hosted project must never carry it. | — |
| `scripts/localdb/migrations/20261009232610_live_mirror_permissive_policies_known_insecure.sql` | Test-only copy of the insecure live policies | **Never deploy.** | baseline |
| `scripts/localdb/migrations/20261010003451_tenant_foundation.sql` | Local foundation (businesses, memberships, mapping, RLS, grants) | **Not deployed as is.** Its tested core is copied into the hosted variant `supabase/release/tenant-pilot/01_tenant_foundation.sql` (release file 01, see 1a) | live table |
| `scripts/localdb/migrations/20261010063144_finance_actions.sql` | Finance request log plus `commit_finance_action` (service_role only) | Deploy unchanged (release file 02) | foundation |
| `scripts/localdb/migrations/20261010113000_pilot_onboarding.sql` | Last-Owner guard, `create_business_with_owner`, `apply_membership_change`, conditional revoke of `set_business_membership` | Deploy unchanged (release file 03) | foundation |
| `scripts/localdb/migrations/20261011090000_assign_initial_owner.sql` | Operator-only `assign_initial_owner` (first Owner of an existing business) | Deploy unchanged (release file 04) | foundation |
| `scripts/localdb/rollback/*.down.sql` | Local compatibility proofs | **Never run hosted.** The foundation rollback recreates `using (true)` access. | — |
| `scripts/localdb/compose/db-init/*.sql` | Local stack roles and JWT | **Never deploy.** | — |
| Synthetic seeds (`scripts/localdb/seed-data.mjs`), `two-business-user.mjs`, test scripts | Test data | **Never run hosted.** | — |

**Hosted order:** 01 hosted foundation → 02 finance_actions → 03 pilot_onboarding → 04 assign_initial_owner. The live inventory and rehearsal are in `hosted-inventory.md`. Each runs in its own transaction; a failure rolls that file back completely.

### 1a. Required differences in the hosted foundation variant
1. **Policies:** the live names are recorded in `hosted-inventory.md` ("Authenticated users can read/insert/update workspace snapshots"). The hosted 01 drops every policy on `workspace_snapshots` dynamically and asserts that none remain.
2. **Grants:** live gives anon and authenticated full grants, including TRUNCATE (RLS does not govern TRUNCATE), on 9 public tables. The hosted variant must revoke all anon and authenticated privileges on **all** of them, not only the three tables the local file covers. It must then assert the exact remaining grants (`businesses`/`business_memberships`: authenticated SELECT only).
3. **No interim browser RPC:** `set_business_membership` is created then revoked in the local sequence. The hosted variant should not grant it at all.
4. **Legacy business name:** the local name is "TaxiFlow pilot business (existing workspace)". Tebogo chooses the real name (and decides whether this legacy workspace becomes one of the three pilot businesses).
5. **Unmapped rows:** the existing fail-closed check is kept. Any `workspace_snapshots` row other than `taxiflow-live` stops the migration until it is explicitly mapped.

## 2. Pre-flight (read-only, before the window)

Run read-only SQL as the project owner and save the output to the encrypted evidence folder. Record:
- **Policies:** `pg_policies` for `public`.
- **Grants:** `information_schema.role_table_grants` for anon and authenticated, and `routine_privileges`.
- **Functions and triggers** in `public`, including whether `protect_workspace_appusers` exists.
- **`workspace_snapshots`:** rows (workspace keys), presence of a `business_id` column, `updated_at`.
- **Auth:** user count and confirmed emails.
- **Mapping report** (section 4): who would receive which membership.
- **Settings:** Supabase plan, backup/PITR availability, Auth Site URL, redirect allow-list and SMTP settings (read only).

**Go/no-go:** the mapping report is approved, at least one active Owner maps to the legacy business, and the policy and grant lists are complete.

## 3. Encrypted backup with a consistent snapshot and request log

- **One consistent read:** a single `REPEATABLE READ` (or `pg_dump --serializable-deferrable`) export of:
  - `workspace_snapshots` (all rows);
  - `businesses`, `business_memberships`, `finance_action_requests` (after cutover; before cutover, the snapshot only);
  - `auth.users` (id, email, created_at, metadata) and `auth.identities` (ids, provider, user_id).
  - Passwords cannot be exported; a full restore needs password resets.
- **Encryption:** streamed into `gpg --symmetric --cipher-algo AES256` (passphrase typed at the prompt; no plaintext on disk), stored in `C:\Users\appri\taxiflow-recovery\backups\` (user-only ACL).
- **Manifest:** SHA-256, `updated_at` per row, key names and item counts only. No personal values.
- **Snapshot/request-log rule:** restore a business's snapshot **together with** its request-log rows from the same backup. If only an older snapshot can be restored, delete that business's log rows newer than the restored `updated_at`. Otherwise a retried request id would report "already applied" for a change the snapshot no longer contains. Version checks prevent double application either way (proven locally in Task 14).
- **Verification:** decrypt into a scratch location and compare the manifest. A **full restore rehearsal of real data** needs a hosted rehearsal project (section 9), because the local drill deliberately refuses non-synthetic accounts.

## 4. Existing users and the legacy workspace
- `taxiflow-live` maps to the legacy business (fixed id `10000000-0000-4000-8000-00000000000a`).
- **Memberships are backfilled only for snapshot `appUsers` that are:**
  - active;
  - in the role Owner, Admin, Manager or Driver (Driver also needs a `staffId`);
  - an exact email match to a confirmed Auth user.
- Viewer gets nothing (demo only). Unmatched or inactive entries get **no access** and are listed in the mapping report for follow-up through Business access.
- Existing Auth users keep their passwords. Nothing is deleted from Auth.
- The legacy snapshot keeps all historical money records unchanged, and the loader cannot alter them.
- **Gap:** there is no operator procedure to add an Owner to an *existing* business (`create_business_with_owner` creates new businesses only). If the mapping yields no Owner, stop and add a reviewed operator step before cutover.

## 5. Maintenance and cutover order (corrected 2026-10-10)

**Principle:** old clients and old privileged deployments are locked out by **credentials and database access**, never by service-worker updates.

> **Superseded order (2026-10-10, decision pack section 4):** the order below let the old production keep a working service_role key until step 6. The authoritative order is now `rehearsal-cutover-checklist.md` Part B:
> 1. maintenance page;
> 2. **deactivate the legacy keys (verify the 401s)**;
> 3. backup;
> 4. migrations;
> 5. `deploy --prod --skip-domain`;
> 6. smoke test;
> 7. promote.

**Verified Supabase key method** (supabase.com/docs: "Rotating Anon, Service, and JWT Secrets", "Migrating to publishable and secret API keys", "Understanding API keys", "JWT Signing Keys"; read 2026-10-10):
- The legacy JWT-based `anon` and `service_role` keys **can no longer be rotated**.
- The supported path:
  1. create the new **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys in Settings → API Keys;
  2. move every client and server to them;
  3. confirm with the dashboard's last-used indicators that nothing uses the legacy keys;
  4. **deactivate the legacy `anon` and `service_role` keys** in Settings → API Keys.
- Deactivation is reversible (they can be re-activated). The legacy keys stop working at the end of 2026 anyway.
- Secret keys can be created per component, by name, and **deleted individually**; deletion is irreversible. Secret keys are refused when used from a browser.
- Deactivating the legacy keys doesn't sign users out. User session JWTs stay valid until the separate, optional JWT signing-keys migration, but they are useless without a valid key and with the tenant grants in place.

**Credential plan**

| Key (named) | Holder | Lifetime |
|---|---|---|
| publishable `web` | the tenant production build (`VITE_SUPABASE_ANON_KEY`) and server functions (`SUPABASE_ANON_KEY`) | long-lived |
| secret `vercel-production` | production server functions only (`SUPABASE_SERVICE_ROLE_KEY` variable, Vercel Production environment only) | rotated per incident or yearly |
| secret `operator` | Tebogo's env file outside the repository, for `scripts/hosted/*` | deleted after each onboarding session |
| secret `rehearsal` | the rehearsal project only | deleted after the rehearsal |

Vercel **Preview** environments get **no** production secret key.

**Order**
1. **T-7 days:** the hosted rehearsal passes (section 9). Tebogo approves the plan, the release files 01–04 and the merge to `main`.
2. **T-1 day:**
   - read-only pre-flight (section 2); announce the window;
   - create the publishable `web` and secret `vercel-production` keys (no impact: the legacy keys keep working);
   - store them **only** in Vercel's Production environment, for the not-yet-deployed tenant build.
3. **Window opens:**
   - Owners are told to stop using the app;
   - take the encrypted consistent backup (section 3) and verify its manifest.
4. **Apply release files 01–04** in order, each in its own transaction. From here, old browser bundles and the old production deployment fail closed at the database: no policies, no grants.
5. **Deploy the tenant build to production** with the section 6 configuration. Run the production smoke checks with the new keys.
6. **Lock out everything old:**
   - deactivate the legacy `anon` and `service_role` keys;
   - then verify that a request using the legacy anon key and one using the legacy service key are both rejected with **401**.
   - This disables every old Vercel deployment (production, rollback targets, old Previews) and every old browser bundle, whatever their cached service worker.
7. **Vercel clean-up:**
   - remove the legacy key values from **all** Vercel environments (Production, Preview, Development);
   - delete or protect (Deployment Protection) the old production and Preview deployments, so no old serverless function stays reachable;
   - keep the tenant release-candidate deployment as the documented recovery artifact.
8. **Acceptance checks** on production (section 9).
9. **Onboarding:**
   - onboard the pilot businesses and load their data with `scripts/hosted/*`, using the `operator` key;
   - Owners grant access;
   - **delete the `operator` key** at the end of the session.
10. **Reopen.**

## 6. Compatible configuration

| Setting | Where | Value |
|---|---|---|
| `VITE_BACKEND_MODE` | build | `live` |
| ~~`VITE_TENANT_MODE`~~ | — | **removed (P1, 2026-10-10):** every build with Supabase settings is a tenant build; no flag can select the legacy path |
| `VITE_SUPABASE_URL` | build | the project URL |
| `VITE_SUPABASE_ANON_KEY` | build (browser) | the **publishable** key `web` (the variable name is unchanged in code) |
| ~~`TAXIFLOW_TENANT_MODE`~~ | — | **removed (P1):** the legacy user and bootstrap routes always return 410 |
| `SUPABASE_URL` | server functions | the project URL |
| `SUPABASE_ANON_KEY` | server functions | the publishable key `web` |
| `SUPABASE_SERVICE_ROLE_KEY` | server functions, **Production only** | the secret key `vercel-production` (the variable name is unchanged in code) |
| `SUPABASE_WORKSPACE_KEY` | — | unset (ignored; legacy) |

**Compatibility**
- The code uses `@supabase/supabase-js` 2.100.0. It sends the key as `apikey` and as `Authorization: Bearer` only when there is no user session; that is the documented accepted pattern.
- **Rehearsal check:** the server functions (service client and Auth admin calls) and the browser work with `sb_` keys.
- A tenant build against an unmigrated database fails closed. A legacy build against a migrated database fails closed. After step 6, a legacy build has no valid key at all.
- **Rehearsal check:** Vercel serves `/api/business/*`. `vercel.json` rewrites only `/api/admin/*` explicitly; filesystem functions should take precedence.

## 7. Recovery without restoring unrestricted access (first tenant release)

**There is no previous compatible tenant production build.** The current production (`main` @ `008ce8e`) is a legacy build. It cannot work against the migrated database, and it must not be revived, because that would need the old policies and grants plus the legacy keys.

- **Before reopening (inside the window):** if the tenant build fails its smoke checks, keep the window closed. Deploy the **maintenance page** (a static Vercel deployment with no Supabase keys), then forward-fix and redeploy. The database stays migrated and locked.
- **Recovery artifact:** the tenant release-candidate deployment that passed the rehearsal, built from the exact commit, is kept and can be re-promoted. After go-live, every new release keeps the previous tenant deployment as its rollback target.
- **App defect after reopening:**
  - re-promote the last good tenant deployment, or the release candidate;
  - otherwise show the maintenance page and fix forward.
- **Bad data in one business:** restore that business's snapshot row **together with** its request-log rows from the verified backup (section 3 rule), or make an operator forward fix. The access rules stay as they are.
- **A migration fails:** the failing file rolls back on its own (each runs in a transaction). Keep the maintenance page, fix and re-run. The earlier files are compatible on their own: 01 alone locks browsers out, and the tenant build needs 01–04.
- **Never on hosted:**
  - `scripts/localdb/rollback/*`;
  - re-creating `using (true)` policies or browser grants;
  - re-activating legacy keys for an old build.
  - Restoring the **pre-migration** database would bring back the live exposure (anon TRUNCATE, open policies). That is only an explicit emergency decision by Tebogo, never part of a normal rollback.
- **Leaked or compromised key:** create a replacement secret key, update Production, then **delete** the compromised key (irreversible).

## 8. Email, setup-email redirects and hosted onboarding

- **SMTP:** configure a custom SMTP sender in Supabase Auth; the default sender is rate-limited and not for production. The sender domain needs SPF and DKIM records, which are DNS changes **not done now**. The provider and domain are Tebogo's decision.
- **Auth URL configuration:** Site URL = production URL. The redirect allow-list holds the production URL (plus the rehearsal Preview URL only during the rehearsal).
  - `/api/business/members` derives `redirectTo` from the request host; the hosted operator scripts use `TAXIFLOW_SETUP_REDIRECT`. Hosts that aren't allow-listed fall back to the Site URL.
  - The app handles the `PASSWORD_RECOVERY` sign-in event.
- **Templates:** check the "Reset password" email wording (it is used as the setup email for new accounts).
- **Hosted operator procedures** (built, **not run**), in `scripts/hosted/`, guards in `scripts/hosted/lib/hosted-target.mjs`:
  - `onboard-business.mjs`: a new business plus its initial Owner;
  - `assign-initial-owner.mjs`: the first Owner of an **existing** business (for example the mapped legacy workspace); refused if an active Owner exists;
  - `load-business-data.mjs`: business set-up data; it re-checks the plan after confirmation.
- **Guards (unit-tested):**
  - `--target <project-ref>` must match `SUPABASE_URL`, which must be https on `<ref>.supabase.co`;
  - credentials come only from `--env-file` **outside the repository**, and must be an `sb_secret_` key (legacy keys are refused);
  - keys are never printed;
  - dry run by default; `--apply` requires an interactive terminal and typing the project ref.

## 9. Hosted rehearsal and acceptance

**Rehearsal**
- On a **separate hosted Supabase project** with a Preview deployment pointed at it. Nothing is restored into production.
- Slot decision: the Free organisation already runs 2 active projects; pause one or upgrade.

**Steps**
1. Load the exact live-schema copy plus **synthetic** fixtures (Approval A: synthetic data only; the production backup is taken read-only and **not** restored).
2. Run the pre-flight.
3. Apply release files 01–04 (record durations).
4. Create the `rehearsal` publishable and secret keys, deploy the Preview with the section 6 configuration using them, and **confirm the server functions work with `sb_` keys**.
5. Run the checks below.
6. Practise:
   - a one-business restore;
   - deactivating the legacy keys (confirm the 401s);
   - deleting a secret key;
   - an `assign-initial-owner` dry run and apply;
   - a maintenance-page deployment.

**Already rehearsed locally** (`hosted-inventory.md`): release files 01–04 on an exact synthetic copy of the live schema, with browser-access denial, data preservation, user mapping and the full server and browser suites. This does not replace the hosted rehearsal (real gateway, keys, email, Vercel).

**Acceptance checks**, all on rehearsal and then production:
1. Every mapped user signs in with the expected role; unmapped users see no business; Viewer stays demo-only.
2. Finance: capture → submit → count → verify → bank → report, refresh persistence, a stale-save conflict that keeps the draft, and closed-day refusal.
3. Onboarding: operator creates a business and Owner; the setup email arrives with a working link; the Owner grants Admin, Manager and Driver; owner-driver; removing access blocks a signed-in user.
4. Isolation: a cross-business read or write is 403; direct browser snapshot reads are denied; anon and authenticated grants are as asserted.
5. Legacy access:
   - `/api/admin/auth-users` and `/api/admin/bootstrap-workspace` return 410;
   - after the legacy keys are deactivated, requests with the legacy anon key and the legacy service key get **401**;
   - old deployments are deleted or protected.
6. Branding: logo, favicon, manifest icons and theme colours.
7. Backup: the post-cutover encrypted backup decrypts and matches its manifest.

## 10. Open acceptance items (carry into the rehearsal)
- ~~Expense-only driver day~~: **implemented and tested locally 2026-10-10** (`expense-only-days.md`, top note).
- ~~Rendered PDF page visual inspection~~: **done 2026-10-10.** A normal report and a closed zero-cash report were rendered to PNG and inspected; the closed-day wording was corrected.
- **Installed-app icons on real devices** (Android maskable, iOS home screen): not yet verified.
- **Hosted email delivery** of the setup email: not yet verified.

## 11. Decisions needed from Tebogo (revised 2026-10-10)

Replaced by **two bounded approvals**, defined in `rehearsal-decision-pack.md` sections 5–6 (scope, spend and stop conditions):
- **Approval A (rehearsal):** a new Supabase Pro org with a Micro project (estimate ≈ $25 + tax, ceiling $30 + tax) and a new Vercel Pro *trial* team ($0).
- **Approval B (production):** after rehearsal sign-off.

**Inputs still needed:**
- the email and domain items (decision pack section 2);
- the legacy business name and its pilot role;
- the maintenance window;
- the expense-only pilot rule (decision pack section 3);
- whether to drop the empty legacy tables later.

Vercel commercial use was verified from Vercel's own documentation: **Hobby is non-commercial only, and production needs Vercel Pro.**
