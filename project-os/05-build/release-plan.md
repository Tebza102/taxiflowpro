# Release Plan: Tenant Pilot (hosted), DOCUMENT ONLY

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
| `scripts/localdb/migrations/20261010003451_tenant_foundation.sql` | Businesses, memberships, `business_id` mapping, RLS, grants | **Deploy as a reviewed hosted variant** (see 1a) | live table |
| `scripts/localdb/migrations/20261010063144_finance_actions.sql` | Finance request log plus `commit_finance_action` (service_role only) | Deploy unchanged | foundation |
| `scripts/localdb/migrations/20261010113000_pilot_onboarding.sql` | Last-Owner guard, `create_business_with_owner`, `apply_membership_change`, withdraws `set_business_membership` | Deploy unchanged | foundation |
| `scripts/localdb/rollback/*.down.sql` | Local compatibility proofs | **Never run hosted.** The foundation rollback recreates `using (true)` access. | — |
| `scripts/localdb/compose/db-init/*.sql` | Local stack roles and JWT | **Never deploy.** | — |
| Synthetic seeds (`scripts/localdb/seed-data.mjs`), `two-business-user.mjs`, test scripts | Test data | **Never run hosted.** | — |

**Hosted order:** foundation (hosted variant) → finance_actions → pilot_onboarding. Each runs in its own transaction; a failure rolls that file back completely.

### 1a. Required differences in the hosted foundation variant
1. **Policies:** the local file drops the local `LIVE MIRROR (insecure)` policy names. The live policies have different names (`schema.sql` uses "Authenticated users can … workspace snapshots"), and the exact live names were never recorded. The hosted variant must drop **every** policy on `workspace_snapshots`, by names listed in the pre-flight inventory, and assert afterwards that none remain.
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

## 5. Maintenance and cutover order
1. **T-7 days:** hosted rehearsal (section 9) passes; Tebogo approves this plan, the hosted SQL variant and the merge to `main`.
2. **T-1 day:** announce the window to the pilot Owners; pre-flight (section 2); freeze data changes.
3. **Window opens:** ask users to sign out. Take the encrypted consistent backup (section 3) and verify the manifest.
4. **Apply the hosted migrations** in order (section 1). From this moment old browser clients lose all direct snapshot access and fail closed.
5. **Deploy the tenant build to production**, with the configuration in section 6 (needs the approved merge to `main`).
6. **Lock out the old servers:** rotate the Supabase service-role key (or JWT secret), then update **only** the new production environment.
   - Old deployments (previous production, old Previews) still hold the old key and run the legacy `auth-users`/`bootstrap-workspace` routes against `taxiflow-live`. Rotation removes that path.
   - JWT secret rotation also ends every existing session, so everyone signs in again under memberships.
7. **Clients:** the new build ships service worker cache `taxiflow-pro-v8`. Activation deletes old caches; open tabs need one reload. A stale old tab cannot read or write after step 4.
8. **Production acceptance** (section 9), then reopen. Onboard the pilot businesses and load data with the hosted operator procedures (section 8). Owners grant access in Business access.

**Old-client lockout, three layers:**
- **Database:** no browser grants or policies on snapshots.
- **Servers:** the key rotation.
- **Clients:** the cache version plus mandatory sign-in.

## 6. Compatible configuration

| Setting | Where | Value |
|---|---|---|
| `VITE_BACKEND_MODE` | build | `live` |
| `VITE_TENANT_MODE` | build | `true` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build (browser) | the project URL and anon key |
| `TAXIFLOW_TENANT_MODE` | server functions | `true` (legacy user and bootstrap routes return 410) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | server functions | the project values (service key: server only, rotated in step 6) |
| `SUPABASE_WORKSPACE_KEY` | server | unset (ignored; legacy) |

**Compatibility rules**
- A tenant build against an unmigrated database fails closed (load errors).
- A legacy build against a migrated database fails closed (permission denied).
- Never pair them except behind a maintenance page.
- **Rehearsal check:** confirm that Vercel serves `/api/business/*` (`vercel.json` rewrites only `/api/admin/*` explicitly; filesystem functions should take precedence).

## 7. Recovery without restoring unrestricted access
- **Never** run `scripts/localdb/rollback/*` hosted, and never recreate `using (true)` policies or browser grants.
- **App defect:** redeploy the previous *tenant* build; the database is unchanged.
- **Bad data in one business:** using the service role, restore that business's snapshot row together with its request-log rows from the verified backup (section 3 rule); or make an operator forward fix. Access rules stay as they are.
- **A migration fails mid-way:** that file rolls back on its own. Keep the maintenance page up, then forward-fix and re-run. Earlier applied files are compatible on their own.
- **Severe failure:** a static maintenance page plus a read-only, operator-held export for urgent figures. Reopening the old insecure access is not an option without a separate, explicit decision by Tebogo.

## 8. Email, setup-email redirects and hosted onboarding
- **SMTP:** configure a custom SMTP sender in Supabase Auth; the default Supabase sender is rate-limited and not for production. The sender domain needs SPF and DKIM records, which are DNS changes **not done now**. The provider and domain are Tebogo's decision.
- **Auth URL configuration:** Site URL = production URL. The redirect allow-list holds the production URL (plus the rehearsal Preview URL only during the rehearsal).
  - `/api/business/members` derives `redirectTo` from the request host. If the host isn't allow-listed, Supabase falls back to the Site URL.
  - The app already handles the `PASSWORD_RECOVERY` sign-in event.
- **Templates:** check the "Reset password" email wording (it is used as the setup email for new accounts).
- **Hosted operator procedures**, not built and needing review: hosted variants of `onboard-business.mjs` and `load-business-data.mjs` that:
  - read the service key from an env file outside the repo;
  - require `--target <project-ref>` that matches the URL;
  - show the target and ask for typed confirmation;
  - keep dry-run as the default;
  - print ids and outcomes only;
  - share the tested planning code (`scripts/pilot/business-data-plan.mjs`, `api/_lib/tenantOnboarding.js`).

## 9. Hosted rehearsal and acceptance

**Rehearsal**
- On a **separate hosted Supabase project** with a Preview deployment pointed at it. Nothing is restored into production.
- Slot decision: the Free organisation already runs 2 active projects; pause one or upgrade.

**Steps**
1. Restore the encrypted backup; compare the manifest.
2. Run the pre-flight.
3. Apply the hosted variants (record durations).
4. Deploy the Preview with the section 6 configuration.
5. Run the checks below.
6. Practise a one-business restore and a key rotation.

**Acceptance checks**, all on rehearsal and then production:
1. Every mapped user signs in with the expected role; unmapped users see no business; Viewer stays demo-only.
2. Finance: capture → submit → count → verify → bank → report, refresh persistence, a stale-save conflict that keeps the draft, and closed-day refusal.
3. Onboarding: operator creates a business and Owner; the setup email arrives with a working link; the Owner grants Admin, Manager and Driver; owner-driver; removing access blocks a signed-in user.
4. Isolation: a cross-business read or write is 403; direct browser snapshot reads are denied; anon and authenticated grants are as asserted.
5. Legacy routes: `/api/admin/auth-users` and `/api/admin/bootstrap-workspace` return 410; old-key calls fail after rotation.
6. Branding: logo, favicon, manifest icons and theme colours.
7. Backup: the post-cutover encrypted backup decrypts and matches its manifest.

## 10. Open acceptance items (carry into the rehearsal)
- **Expense-only driver day:** not listed in the Banking queue (existing UI behaviour; the server stores it correctly). Needs a product decision or fix before the pilot.
- **Rendered PDF page visual inspection:** not yet done (the logo geometry and colours were checked from the PDF source only).
- **Installed-app icons on real devices** (Android maskable, iOS home screen): not yet verified.
- **Hosted email delivery** of the setup email: not yet verified.

## 11. Decisions needed from Tebogo
1. A rehearsal project slot (pause a project or upgrade).
2. The SMTP provider and sender domain (with DNS records), and the production URL for redirects.
3. The legacy workspace's business name, and whether it is a pilot business.
4. The maintenance window date and Owner communication.
5. Approval of: the hosted foundation SQL variant, the merge to `main`, the production deploy and the key rotation, each at execution time.
