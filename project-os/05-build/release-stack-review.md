# Release review: stack PR #6 to #12 (prepared 2026-10-29; nothing released)

For Tebogo's approval. Production is unchanged: `taxiflow.co.za` serves `taxiflowpro-dy1a1k761` (`main` `af3e5ad`, bundle `index-2xzkC0xd.js`); production database has release files 01 to 05.

## 1. What is included (exact heads, verified 2026-10-29)

The stack is linear: each branch contains the one below it (checked with `git merge-base --is-ancestor`); local and remote heads match.

| PR | Branch (head) | Base | Contents |
|---|---|---|---|
| #6 | `agent/owner-responsibilities` (`51a0f5d`, 15 commits) | `main` `af3e5ad` | Owner-assigned responsibilities, tenant route/vehicle/driver saves, separation of duties, audit; **release file 06** |
| #7 | `agent/user-guide` (`99cf0c6`, 2) | #6 | In-app "How to use TaxiFlow" guide |
| #8 | `agent/driver-salary` (`c6cf61e`, 8) | #7 | Driver salaries: schedules, payments by method and source, cash from takings, expense CSV |
| #9 | `agent/period-reports` (`33f9fa4`, 1) | #8 | Business and vehicle reports (custom dates, PDF/CSV from one server report) |
| #10 | `agent/driver-salary-profile` (`c47b755`, 4) | #9 | Salary in the driver profile; demo reports from the current demo workspace (`97aee64`, separate); verification script |
| #11 | `agent/recurring-expenses` (`405dc46`, 1) | #10 | Recurring fixed expenses; commitments in reports |
| #12 | `agent/phone-fixes` (`cf75549` app code; later commits tests/docs only) | #11 | Compact mobile menu (`38b1b93`); honest download status and retry (`582cdac`); PDF handed over as a generic file for Android browsers, report error logging (`5110069`) |

App code at the release head is identical to `cf75549` (`src`, `api`, `package*.json`, `vercel.json`, `vite.config.js`, `public`, `index.html`: 0 files changed since). Against `main`: 38 app files, 36 commits.

## 2. Evidence

**Automated (local).** `node scripts/verify-all.mjs` on `5110069`, run `2026-10-29T14-50-43-880Z`: node 426/426, sync guards, build, mock browser 69/69, tenant browser 31/31 on a fresh reset of the isolated local test stack. One earlier run had a tenant-onboarding timing flake (30/31) that passed on a fresh re-run (31/31); recorded, not fixed.

**Hosted (isolated).** 2026-10-29, Preview `taxiflowpro-lawb32hou-apprigate.vercel.app`, built from `0bd07d2` (app = `cf75549`), backend `taxiflow-preview-test` (`sxoonhovoqgcpflhqirb`) only, synthetic `@example.com` accounts: **16/16 passed**.
- Target guards before any sign-in (3x): the bundle carries the test project and not `vfxftviwteypasredjgm`; unauthenticated 401.
- Release-06 journey 6/6: cash workflow, Owner grants, revoked banking blocks the next request, delegated staff limits, separation of duties.
- Release-stack journey 6/6 (new, `tests/preview-test/release-stack-journey.spec.js`):
  - Driver-profile salary: saved with the driver, no payment, Driver refused (403).
  - Partial-save retry: one driver, salary saved once.
  - Recurring expense: paid in the app once; repeat 409, retried request replayed, concurrent 200 and 409.
  - Permissions and isolation: Driver 403 and other business 403 in every format; cross-business schedule 404.
  - Business and vehicle reports with custom dates: screen, CSV and PDF agree; each recurring payment appears once; business costs stay out of the vehicle report.
- Salary journey 4/4: duplicate refused; a takings salary lowers the driver's expected cash once (-250); the driver sees only takings salaries; the expense CSV reconciles.

Isolation procedure followed:
- cost check first (Free plan, only production active, no charge);
- test project restored, then read-only checks (6 tables, RLS on all, 6 synthetic users only, Preview Company A/B);
- 4 Preview variables scoped to `agent/phone-fixes`; Production-only settings untouched;
- temporary bypass (0 -> 1).

Cleanup:
- bypass revoked and back to 0, local copy deleted;
- the 4 branch variables removed (9 records, as before);
- the Preview answers 302 without the bypass;
- the test project is paused again.

**Manual (real phone, Tebogo, Android 16, Firefox 158).** Section F all passed 2026-10-29: mobile menu in portrait and landscape (F1-F3); business PDF (F4); vehicle PDF and daily A4 PDF (F6).

**Outstanding (not marked passed; no evidence).**
- Manual sections A-E of `06-quality/manual-checks-guide-and-salary.md` (earlier phone rows for guide, salaries, reports, profile salary and recurring expenses). These flows are covered by automated mobile-viewport and hosted tests, but not ticked on a device.
- Section B, B-rows of C3 and E5: opening the CSVs in a real spreadsheet app (Excel or Google Sheets).
- Hosted delta Part B (`scripts/preview-test/verify-delta-06.sql`, always rolled back): restore fidelity of the test project's file 06. Part A passed; the same rule is proven locally (backup 43/43, migration 30/30).
- The first production run of the backup tool against a hosted project (it has run only on local stacks).

## 3. Database: migration order and prerequisites

- Only PR #6 changes the schema: release file 06 `scripts/localdb/migrations/20261019090000_member_permissions.sql`.
  - SHA-256 `09dd1e33…b676b30c`; rollback file `6ab9f636…a51`.
  - Additive: a permissions column on memberships, the insert rule, and the `member_permission_changes` audit table.
  - #7 to #12 need no migration (they store their data in the existing workspace snapshot).
- Order: production has 01-05. Apply 06 **before** the new app is promoted (the new server reads `permissions`). Files 01-05 are skipped by their markers.
- Prerequisites:
  - the production server key in an env file **outside the repo**;
  - the backup passphrase typed by Tebogo;
  - an interactive terminal (the tools ask for the typed project ref);
  - Tebogo available for the live checks.
- Business rule already confirmed (2026-10-19): separation of duties binds the Owner too, so a business needs a second person holding "Verify counted cash" to verify counts.

## 4. Production backup and restore verification

1. `node scripts/backup/backup.mjs export --target vfxftviwteypasredjgm --out-dir <outside repo> --env-file <outside repo>` (Tebogo types the ref and the passphrase).
   - It is one read-only transaction, encrypted in memory, read back and compared before "PASS" is logged.
2. `node scripts/backup/backup.mjs verify --file <backup.tfbk>`: PASS required.
3. Restore rehearsal (proves the file is usable, not just readable).
   - Reset the isolated local test stack to an empty database. Then run `backup.mjs restore --target local --file <backup.tfbk>`; the tool re-reads the target and compares.
   - Then delete the local stack's data again.
   - This puts production personal data on this laptop for the rehearsal; if that is not acceptable, skip it and rely on step 2.
4. Keep the backup outside the repository until the after-release backup also verifies.

## 5. Merge and retarget sequence

- Use **"Create a merge commit"** for every PR. Do not squash: each branch contains the commits of the one below, so a squash would make the next PR re-show or conflict on those commits.
- Order: #6 -> `main`; retarget #7 to `main`, merge; then #8, #9, #10, #11, #12 the same way.
  - Branches are not auto-deleted on merge, so each next PR must be retargeted to `main` by hand: GitHub > PR > Edit > base `main`.
  - Before merging each one, confirm the PR shows only its own commits.
- Mark each PR "Ready for review" just before its merge.
- `main` is not protected and production domains are **not** auto-assigned (`autoAssignCustomDomains: false`). Each merge builds a production deployment but `taxiflow.co.za` keeps serving `af3e5ad` until a deployment is promoted. Promote **once**, after #12.

## 6. Deployment, smoke checks, rollback

**Steps (each only on Tebogo's go):**
1. Pre-release backup, verify and (optional) restore rehearsal (section 4).
2. Read-only `scripts/hosted/fingerprint-release-06.sql` in production; record the hashes.
3. `node scripts/hosted/apply-release.mjs --target vfxftviwteypasredjgm --env-file <outside repo>`. Expected: SKIP 01-05, APPLIED 06, every post-check PASS.
4. Read-only `scripts/hosted/verify-release-06.sql`: all 11 rows true; re-run the fingerprint, which must be identical to step 2.
   - The old app keeps working on file 06 (additive).
5. Merge #6 to #12 (section 5). Wait for the production build of the final `main` head; confirm its commit.
6. Promote that deployment (Vercel > Deployments > Promote, or `vercel promote <url>`).
7. Smoke checks on `taxiflow.co.za`:
   - the bundle contains `vfxftviwteypasredjgm.supabase.co` and not `sxoonhovoqgcpflhqirb`;
   - unauthenticated `/api/business/workspace` and `/api/admin/reports/period` answer 401;
   - Owner sign-in: Business access shows responsibilities; Reports shows Business and vehicle reports; a custom-date report downloads PDF and CSV;
   - Money > Expenses shows Recurring fixed expenses and Driver salaries;
   - on the phone: the menu opens and closes, and the PDF saves;
   - a Driver account sees only Driver pages;
   - no test data entered in production unless Tebogo chooses a named check record.
8. After-release backup and verify PASS.

**Rollback:**
- App: re-promote `taxiflowpro-dy1a1k761` (`af3e5ad`). It is instant, and the old app ignores the new column and any new snapshot fields.
- Database, only if needed after the app rollback: run `scripts/localdb/rollback/20261019090000_member_permissions.down.sql`.
  - It keeps businesses, memberships, snapshots and the audit table, and loses the per-person responsibility lists (the fixed role rules apply again).
- Data entered after release (salaries, recurring schedules) stays in the snapshot and is simply not shown by the old app. A full data rollback means restoring the pre-release backup; that loses everything entered since.
- Code: revert the merge commits on `main` if the release is abandoned.

## 7. Recommendation: **GO** (conditional on Tebogo's approval and the pre-release backup)

Reasons:
- Every automated gate passes on the exact app code (local 426/69/31; hosted 16/16 on isolated infrastructure).
- The real phone confirmed the two issues found in phone testing are fixed.
- The only schema change is additive, with a proven rollback.
- The domain moves only on an explicit promote, so the app rollback is a single re-promote.

The outstanding checks are covered by automated or local evidence and do not change the data model:
- the spreadsheet-app check (CSV content asserted by tests, opened on the phone);
- the device ticks in A-E;
- hosted delta Part B.

**Switch to HOLD if:**
- the pre-release backup does not verify;
- the fingerprint differs between steps 2 and 4;
- any apply-release post-check fails;
- or Tebogo wants the spreadsheet check (section B) or the device rows A-E done first.
