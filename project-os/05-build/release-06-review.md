# Release 06 review: Owner-assigned responsibilities (pre-release; production unchanged)

Prepared 2026-10-19 for Tebogo's go/no-go. Nothing here has been applied to production.

## What is being released
- **App:** branch `agent/owner-responsibilities`, PR #6 (draft). App code tested on hosted infrastructure: commit `e78e4b3`. `src/`, `api/`, `package.json`, the lockfile, `vercel.json` and `vite.config.js` are identical at the release head (later commits change tests, operator scripts, release file 06 and docs only).
- **Database:** release file 06 `scripts/localdb/migrations/20261019090000_member_permissions.sql`, version 20261019090000, final content committed in `ac10ed1`, **SHA-256 `09dd1e33112108f0a17d8645ec9fb3294c8139ba56fc391508ab8699d676b30c`** (rollback file `6ab9f6367c2f071653cc5475eef80d44e6c447e5053ef36eae42c46e4c1e8a51`). **Correction 2026-10-29:** "additive" is incomplete. File 06 backfills `permissions` on every existing membership: Admin `{cash.count}`, Manager `{cash.verify, cash.bank}`, Owner and Driver `{}`. No other column or table changes. Verification: `release-stack-review.md` sections 3-4. Applied with `scripts/hosted/apply-release.mjs` ("06 member permissions"; 01-05 are skipped by their markers). Additive. Post-checks: `scripts/hosted/fingerprint-release-06.sql` (`a12924a2…`), `scripts/hosted/verify-release-06.sql` (`6893af16…`).
- **Behaviour:** per-person responsibilities (count, verify, bank, manage drivers, manage routes and vehicles, manage staff responsibilities); route, vehicle and driver-profile saves in the business workspace; Business access controls; separation of duties; tenant-scoped audit of responsibility changes.

## Business rules confirmed by Tebogo (2026-10-19)
- **Separation of duties binds everyone, the Owner included.** Whoever recorded a hand-in count cannot verify it. **The cash workflow therefore needs a second authorized person (holding "Verify counted cash") to verify every count.** A business where one person both counts and verifies cannot complete verification alone.
- **Sign-out stays as it is:** signing out ends that user's sessions on every device (Supabase global sign-out). Other devices must sign in again.
- Custom roles: out of scope.

## Production credentials (verified 2026-10-19, names and targets only)
- Production-target variables (all branches): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BACKEND_MODE`.
- Test-backend variables exist ONLY as Preview + branch `agent/owner-responsibilities`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. A production build never receives them.
- No app source file references the test project (`src/`, `api/`, `public/`, `vercel.json`: 0 matches); the ref appears only in `scripts/preview-test/`, its config and Project OS.
- The live production bundle (`index-2xzkC0xd.js`) references the production project and not the test project.
- Post-release check: the promoted bundle must contain `vfxftviwteypasredjgm.supabase.co` and not `sxoonhovoqgcpflhqirb`.

## Backup and restore
- `scripts/backup/backup.mjs` exports Auth users and identities, businesses, memberships (whole rows, so the `permissions` column is included), snapshots and the finance request log, encrypted; restore re-reads and compares.
- **Defect found in this review and fixed in file 06:** the insert trigger gave role defaults to any Admin/Manager row inserted with an empty list, so a full restore would have re-granted "Receive and count cash" to an Admin the Owner had emptied. Now the column has no default and only a row that omits `permissions` gets defaults; the backfill runs only when the column is first added, so re-applying file 06 never touches stored lists.
- Proof (isolated local test stack): `backup-tests.mjs` 37/37, including a real encrypted export and full restore into a rebuilt empty database where an emptied Admin and a fleet-only Manager come back exactly; `member-permissions-migration-tests.mjs` 30/30 (re-insert keeps an emptied list; re-applying file 06 keeps it; an omitted list gets defaults).
- **Platform admins and permission-audit history are now backed up (2026-10-20):** the export includes `platform_admins` and `member_permission_changes` when the database has them (older backups stay valid); a full restore puts them back row for row and leaves their access rules (RLS forced, no browser grants) unchanged. Proven: `backup-tests.mjs` 43/43 incl. browser still refused (42501) after restore; `backup-tool.test.mjs` 10/10. A one-business restore never touches them.

## Rollback
1. Re-promote the current production deployment `taxiflowpro-dy1a1k761` (`af3e5ad`).
2. Then run `scripts/localdb/rollback/20261019090000_member_permissions.down.sql`.
- Keeps: businesses, memberships (roles, active flags, driver links), snapshots, request log, and the audit table `member_permission_changes` (deliberately kept).
- Loses: the per-person responsibility lists (the previous fixed role rules apply again: Admin counts; Manager verifies and banks).
- Proven locally: rollback keeps memberships unchanged and keeps the audit table; re-applying restores role defaults.
- Data rollback, if ever needed: restore the pre-release backup.

## Release procedure (when authorized; same pattern as file 05)
1. Pre-release encrypted backup (`backup.mjs export`, Tebogo types the passphrase); `verify` PASS.
2. Read-only `scripts/hosted/fingerprint-release-06.sql` in production; record the hashes.
3. `node scripts/hosted/apply-release.mjs --target vfxftviwteypasredjgm --env-file <outside repo>` (typed ref). Expected: `SKIP` 01-05, `APPLIED 06`, every post-check `PASS`.
4. Read-only `scripts/hosted/verify-release-06.sql`: all 11 rows true. Re-run the fingerprint: identical to step 2.
5. Merge PR #6; promote the production build; live checks: Business access shows responsibilities to the Owner; unauthenticated API calls 401; bundle references the production project only.
6. After-release backup; `verify` PASS.
- GitHub has no required checks on `main` (branch not protected); PR #6 shows the Vercel checks only. The release gates are the evidence in this document and the steps above.

## Still not available in the business workspace (labelled in the screens; nothing is saved)
Archive vehicle; log or resolve defects; service and document records; shift allocation from the Drivers page; expense presets; settings and profile saves; changing a member's role in the screens (server action exists); custom roles; editing a driver's email from the profile form.

## Evidence summary
- **App code under test:** `src/`, `api/` and build config identical from `e78e4b3` to the release head; unit tests 36/36 files; `vite build` passes.
- **Hosted** (Preview `taxiflowpro-n8yesi8bq-apprigate.vercel.app`, isolated test project): 6/6: target and isolation incl. cross-company 403s; full cash workflow; Owner grants and Manager saves surviving reload; banking revocation; delegation limits with audit rows; separation of duties by direct API. **Ran against the EARLIER file 06** (schema applied 2026-10-19 from `cd329d3`, `schema.sql` SHA-256 `e7280981…5431651`), see "Hosted alignment" below.
- **Local isolated stack on the FINAL file 06** (each suite after its own reset):

  | Suite | Result |
  |---|---|
  | member-permissions-migration-tests | 30/30 |
  | backup-tests (encrypted export + full restore, responsibilities round-trip) | 37/37 |
  | member-permissions-tests | 101/101 |
  | onboarding-tests | 64/64 |
  | finance-action-tests | 56/56 |
  | tenant-tests access | 36/36 |
  | platform-admin-tests | 75/75 |
  | backup-premigration-tests (needs `setup.mjs hosted-pre`; first attempt ran on the wrong setup and stopped before any assertion) | 13/13 |
  | production-path rehearsal on the live-schema copy (01-05 present → apply-release SKIP 01-05, APPLY 06, PASS; fingerprint unchanged; verify-release-06 11/11; audit row; rollback keeps data and audit; re-apply) | 11/11 |

- Earlier results on the pre-fix file 06 that were NOT re-run (not affected by the membership-insert change, or superseded by the rows above): finance-record 36/36, finance-capture 43/43, expense-only 32/32, server-auth 26/26, business-data-load 46/46, tenant rollback 8/8, hosted-rehearsal 22/22, localdb browser 12/12, mock browser 34/34.

## Hosted alignment (delta applied; behavioural check pending)
- The hosted test project runs the **earlier** file 06: verified read-only 2026-10-20 with `scripts/preview-test/verify-delta-06.sql` Part A, both checks false (column default `'{}'::text[]`; the old insert rule).
- **Reviewed delta:** `scripts/preview-test/delta-06-restore-fidelity.sql` (SHA-256 `76bab4d5bc31260f4ab71fc3cb60d0a92642cbc9ee0b03386abb48b3757724e9`). Refuses projects without file 06 or without the seeded Preview companies; replaces the trigger function with the final rule, re-revokes it from browser roles, drops the column default; one transaction; no data, accounts or credentials.
- **2026-10-20:** delta applied to `sxoonhovoqgcpflhqirb` (migration `preview_test_delta_06_restore_fidelity`); Part A both true. Part B (always rolled back) was declined automatically by the Supabase connector (contains `delete`), not run; membership fingerprint unchanged (`0062eea5…`, audit 9). Tebogo to run Part B in the SQL editor.
- **Smallest targeted check:** `scripts/preview-test/verify-delta-06.sql` (SHA-256 `68fd6494de1ab2a0377306dbcd3950ab3df665dbe0466426ef7bf4a87c80112a`). Part A (read-only): both rows true. Part B (always rolled back): the error message must read `PASS (rolled back): emptied Admin kept {} after re-insert; omitted list got {cash.count}`.
- Until Part A and Part B pass on the hosted project, hosted Preview evidence covers the app on the earlier file 06 only.
- Test environment kept for regression testing (test project, its data, branch-scoped Preview variables, external env file). Local test stack now uses ports 45321/45322/45324 (Windows reserved 55227-55326 after a reboot).
