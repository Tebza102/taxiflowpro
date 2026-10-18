# Platform admin and company onboarding: release procedure

Status 2026-10-18: **prepared and locally tested; nothing applied to production.** Branch `agent/platform-admin-onboarding`.

**Production:** Supabase `vfxftviwteypasredjgm`; Vercel `apprigate/taxiflowpro`.
- Live deployment `taxiflowpro-jng5n1ced` (`e59417a`) on `taxiflow.co.za`.
- Auto-assign of custom domains is off, so a `main` build reaches the domain only through `vercel promote`.

## What changes

| Layer | Change | Compatible with the live app? |
|---|---|---|
| Database | **Release file 05** `scripts/localdb/migrations/20261018090000_platform_admins.sql`: a new table `public.platform_admins`. RLS is enabled and forced. anon, authenticated and PUBLIC get nothing; the service role gets `select` only; nothing else changes. | Yes. It is additive, and the live build never reads it. |
| Grant | One operator SQL statement (below) for the confirmed platform-admin login. | Yes |
| API | New `GET/POST /api/platform/businesses`. No existing route changes behaviour. | n/a (new build) |
| UI | A "Companies" button for platform admins only, and the Companies console. | n/a (new build) |

Tenant 1 is the existing business "TaxiFlow Pro" (`10000000-0000-4000-8000-00000000000a`, slug `taxiflow-legacy`). It is already a tenant, so **no data migration** is needed.

## Decision before the grant (Tebogo)

Which login becomes platform admin. Assumed: `apprigate@gmail.com`.
- Today it is also an **active Admin** of TaxiFlow Pro: restored 2026-10-11 16:40 UTC, after the earlier "inactive" note.
- The platform grant does not change that membership. Keep it or remove it in Business access as you prefer; the console works either way.
- The platform admin cannot make itself the Owner of a company it creates.

## Steps (in order; stop at the first failure)

1. **Backup:** Tebogo types the passphrase at the hidden prompts.
   ```powershell
   node scripts/backup/backup.mjs export --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\backup.env --out-dir C:\Users\appri\taxiflow-recovery\backups
   node scripts/backup/backup.mjs verify --file C:\Users\appri\taxiflow-recovery\backups\<new file>.tfbk
   node scripts/backup/backup.mjs check --out-dir C:\Users\appri\taxiflow-recovery\backups
   ```
   Expected:
   - export PASS (tenant format), verify PASS, check OK;
   - counts: businesses 1, memberships 6, snapshots 1.

   Copy the backup and its manifest to `G:\My Drive\TaxiFlow backups` and check that the SHA-256 hashes match.
2. **Release file 05:**
   ```powershell
   node scripts/hosted/apply-release.mjs --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\backup.env
   ```
   Type the project ref when asked. Files 01–04 are skipped because they are already present; only 05 is applied.

   Expected post-checks:
   - `tables_without_rls` stays empty;
   - `browser_executable_functions` is unchanged;
   - no new anon or authenticated grants.
3. **Grant** (SQL editor or psql, as the operator):
   ```sql
   insert into public.platform_admins (user_id, granted_by, note)
   select id, 'operator', 'platform admin' from auth.users where lower(email) = lower('apprigate@gmail.com')
   on conflict (user_id) do update set active = true;
   select u.email, p.active from public.platform_admins p join auth.users u on u.id = p.user_id;
   ```
   Expected: exactly one row, `apprigate@gmail.com | true`.
4. **Build:** merge the reviewed PR to `main`. The production build takes **no** domain. Check the build URL:
   - `/` renders;
   - `/api/platform/businesses` without a token returns 401.
5. **Promote:**
   ```powershell
   vercel promote <new-deployment-url> --scope apprigate
   ```
6. **Live checks** (no new Owner invitations until DKIM passes):
   - Tebogo signs in as the platform admin. Expected:
     - TaxiFlow Pro opens with the same role as before;
     - "Companies" lists **Tenant 1: TaxiFlow Pro**, Owner `owner@apprigate.com`, 6 active members.
   - `owner@apprigate.com` signs in. Expected: no Companies button; the same data as before.
   - A Driver signs in. Expected: only their own records.
   - Read-only SQL: `select count(*) from public.businesses` is still 1, and the memberships are unchanged.
7. **After-release backup** (step 1 commands), copied off the machine.

## Onboarding real companies (after DKIM passes)

The platform admin opens **Companies** and enters:
- the company name (the id is derived from it and can be edited);
- the Owner's name and email;
- "The Owner also drives", if it applies.

What happens next:
- **New Owner email:** the Owner receives the password-setup email and sets their own password.
- **Existing sign-in:** the account keeps its password and gets no email. The Owner picks the company in the business picker.
- **Staff:** the Owner adds their Admins, Managers and Drivers in Settings → Business access.
- **Set-up data** (vehicles, routes): still loaded with `scripts/hosted/load-business-data.mjs`, as in `11-client-delivery/independent-owner-onboarding-runbook.md` step 5.

## Rollback

| Situation | Action | Data effect |
|---|---|---|
| The new build misbehaves | `vercel promote https://taxiflowpro-jng5n1ced-apprigate.vercel.app --scope apprigate`. It runs unchanged against the new schema, because file 05 is additive. | none |
| Remove the platform capability | `drop table public.platform_admins;` (rollback file `scripts/localdb/rollback/20261018090000_platform_admins.down.sql`). The platform API then refuses everyone (tested). | Companies, Owners and memberships created through the console are **kept**. Re-applying 05 starts with no grants; re-run step 3. |
| A company was created by mistake | Not reversible in the app. Use a reviewed operator action, or `backup.mjs restore --business <uuid>` only on an explicit decision. | as decided |
| Data damage | Restore from the step 1 backup (`backup.mjs`, section 4 of `pilot-release-checklist.md`). | full restore |

**Backup coverage note:** `backup.mjs` does not export `platform_admins`. A full restore rebuilds the schema from the release files, so after a restore re-run step 3. This is deliberate: grants stay an explicit operator action.
