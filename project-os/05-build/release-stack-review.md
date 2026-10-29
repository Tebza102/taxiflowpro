# Release review: stack PR #6 to #12 (prepared 2026-10-29, prerequisites revised the same day; nothing released)

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
| #12 | `agent/phone-fixes` (app code `cf75549`; later commits tests, scripts and docs only) | #11 | Compact mobile menu (`38b1b93`); honest download status and retry (`582cdac`); PDF handed over as a generic file for Android browsers, report error logging (`5110069`) |

App code at the release head is identical to `cf75549` (`src`, `api`, `package*.json`, `vercel.json`, `vite.config.js`, `public`, `index.html`: no changes since). Against `main`: 38 app files, 36 commits.

## 2. Evidence

**Automated (local).** `node scripts/verify-all.mjs` on `5110069`, run `2026-10-29T14-50-43-880Z`: node 426/426, sync guards, build, mock browser 69/69, tenant browser 31/31 on a fresh reset of the isolated local test stack. One earlier run had a tenant-onboarding timing flake (30/31) that passed on a fresh re-run (31/31); recorded, not fixed.

**Hosted (isolated).** 2026-10-29, Preview `taxiflowpro-lawb32hou-apprigate.vercel.app`, built from `0bd07d2` (app = `cf75549`), backend `taxiflow-preview-test` (`sxoonhovoqgcpflhqirb`) only, synthetic accounts: **16/16 passed**.
- Target guards before any sign-in: the bundle carries the test project and not production; unauthenticated 401.
- Release-06 journey: 6 tests.
- Release-stack journey: 6 tests.
  - Driver-profile salary.
  - Partial-save retry.
  - Recurring expense: paid once; duplicates refused on repeat, retry and concurrent requests.
  - Permissions and business isolation.
  - Business and vehicle reports with custom dates: screen, CSV and PDF agree.
- Salary journey: 4 tests, including cash from takings.

Cleanup:
- bypass back to 0;
- branch variables removed;
- the test project is paused.

**Manual (real phone, Tebogo, Android 16, Firefox 158).** Section F passed 2026-10-29: the menu in portrait and landscape; business, vehicle and daily A4 PDFs.

**Outstanding (kept unconfirmed).** Manual rows A-E and the spreadsheet-app check (section 10). Hosted Part B (section 4).

## 3. Database: what release file 06 changes (corrected)

Earlier wording called file 06 "additive" and implied existing data is untouched. That was incomplete: it **writes to every existing membership row**. Exactly:

| Object | Change to existing data |
|---|---|
| `business_memberships.permissions` (new column, text[], NOT NULL) | Added to **every** existing row. Backfill: **Admin -> `{cash.count}`**, **Manager -> `{cash.verify, cash.bank}`**, **Owner and Driver -> `{}`**. These equal what each role could already do, so effective access is unchanged. |
| other `business_memberships` columns (role, active, driver link, `updated_at`, ...) | Unchanged. No trigger touches `updated_at`: the only existing membership triggers forbid reassignment and keep an active Owner, and neither modifies values. |
| new constraints, trigger and functions on `business_memberships` | Affect **future** writes only: known keys only; only Admin/Manager may hold permissions; a role change resets the list to the new role's defaults; an insert without a list gets the role defaults. |
| `member_permission_changes` (new table) | Created empty; RLS forced; no browser grants. |
| `businesses`, `workspace_snapshots`, `finance_action_requests`, `platform_admins`, Auth | Unchanged. |

The backfill runs only when the column is first added, so re-running file 06 never resets lists an Owner has changed. Order: production has 01-05. Apply 06 **before** the first merge. The new server reads `permissions`, and the old app ignores it.

## 4. Migration verification (what must stay identical, what must change)

**Must be identical before and after file 06.** Run read-only, in a quiet window (no capture, counting or banking for about 15 minutes; normal use legitimately changes snapshots and the request log):
- `scripts/hosted/unchanged-data-release-06.sql` (new) gives counts and hashes of:
  - businesses (all columns);
  - memberships **except `permissions`** (including `updated_at`);
  - workspace snapshots (content and `updated_at`);
  - the finance request log, platform admins and Auth users.
- `scripts/hosted/fingerprint-release-06.sql` (as recorded; it already leaves out `permissions`).

**Must change exactly as intended:** `scripts/hosted/verify-release-06.sql` returns 11 rows, all true:
- the column is NOT NULL with no default;
- both constraints and the trigger are present;
- Admin holds exactly `{cash.count}`;
- Manager holds exactly `{cash.verify, cash.bank}`;
- Owner and Driver hold `{}`;
- the function is executable by service_role only;
- the audit table has RLS forced, no browser grants, and is empty;
- browser grants are unchanged;
- no public function is executable by anon or authenticated.

**Proved 2026-10-29 on the isolated local test stack.** File 06 was undone, both hashes taken, file 06 re-applied, both hashes taken again:
- the new unchanged-data hash and the existing fingerprint were **identical** before and after;
- the backfill produced exactly the role defaults (Admin 3, Manager 8, Owner 5, Driver 5 rows);
- 10 of 11 post-checks were true. Row 9 ("audit table starts empty") was false only because the local undo deliberately keeps the audit table and its seeded rows; in production the table is new.

The stack was reset afterwards.

**Hosted Part B (a restore keeps a deliberately emptied responsibility list).**
- Isolated test project: `taxiflow-preview-test`, ref **`sxoonhovoqgcpflhqirb`**, organization Apprigate (Free plan).
- **Prerequisite:** the project is **paused** (INACTIVE). Restore it first (Supabase dashboard > the project > Restore; no charge on the Free plan), wait for "Healthy", and pause it again afterwards.
- Script: `scripts/preview-test/verify-delta-06.sql`, SHA-256 `68fd6494de1ab2a0377306dbcd3950ab3df665dbe0466426ef7bf4a87c80112a` (unchanged since 2026-10-20). The agent's database tool refused Part B because it contains `delete`; that refusal is not bypassed.

SQL editor steps, in the **test** project only. First check that the URL shows `sxoonhovoqgcpflhqirb`, never `vfxftviwteypasredjgm`.
1. Paste and run **Part A** alone: the `select ... union all select ...` block.
   - Expected: 2 rows, both `ok = true`. It passed on 2026-10-20 and 2026-10-28.
2. Paste and run **Part B** alone: the `do $$ ... end $$;` block.
   - Expected: the editor shows an **error** whose message reads exactly `PASS (rolled back): emptied Admin kept {} after re-insert; omitted list got {cash.count}`.
   - The error is intended: raising it rolls back everything the block did.
3. Any other message means HOLD. That includes `FAIL (rolled back): ...` and "no Admin in preview-company-a". Report the message.
4. Optional check that nothing persisted:
   ```
   select m.role, m.permissions from public.business_memberships m join public.businesses b on b.id = m.business_id where b.slug = 'preview-company-a' order by m.role;
   ```
   It should show the same values as before step 2.

## 5. Production backup and restore verification (for approval; nothing run)

The backup tool has run only against local stacks, so this is its first hosted run (a read-only export). Commands are for **Windows PowerShell** (the terminal Tebogo uses), with quoted forward-slash paths; Node accepts them. Passwords and the passphrase are typed only into Notepad or the tool's hidden prompts, never into chat.

**One-time preparation (Tebogo):**
1. Docker Desktop running. If it is not, start it as in the memory note: `Invoke-CommandInDesktopPackage ... -PreventBreakaway`. The tool runs `psql` from `public.ecr.aws/supabase/postgres:17.11.0.004`.
2. Create the output folder outside the repo:
   ```
   New-Item -ItemType Directory -Force 'C:/Users/appri/taxiflow-backups'
   ```
3. Create the connection file outside the repo:
   ```
   notepad 'C:/Users/appri/taxiflow-prod-backup.env.txt'
   ```
   Contents (the values come from Supabase > production project > Connect > **Session pooler**):
   ```
   TAXIFLOW_BACKUP_PGHOST=<session pooler host, e.g. aws-0-eu-west-1.pooler.supabase.com>
   TAXIFLOW_BACKUP_PGPORT=5432
   TAXIFLOW_BACKUP_PGUSER=postgres.vfxftviwteypasredjgm
   TAXIFLOW_BACKUP_PGPASSWORD=<production database password>
   TAXIFLOW_BACKUP_PGDATABASE=postgres
   ```
   - Save it as plain UTF-8. If the tool later says `TAXIFLOW_BACKUP_PGHOST` is missing, re-save without "UTF-8 with BOM".
   - Use the session pooler on port 5432. The direct host is IPv6-only, and the transaction pooler (6543) cannot hold one consistent transaction.
   - The tool refuses any host or user that does not belong to `vfxftviwteypasredjgm`.
4. A passphrase of at least 16 characters, saved in a password manager. Without it the backup cannot be read.

**Export** (in the Terminal panel; the tool asks for the typed project ref, then the passphrase twice, hidden):
```
node scripts/backup/backup.mjs export --target vfxftviwteypasredjgm --env-file 'C:/Users/appri/taxiflow-prod-backup.env.txt' --out-dir 'C:/Users/appri/taxiflow-backups'
```
Expected:
- `PASS backup verified (...)` and a `counts {...}` line;
- `backup-log.txt` gains a PASS line;
- the folder now holds `taxiflow-vfxftviwteypasredjgm-<time>.tfbk` and its `.manifest.json`.

It is one read-only REPEATABLE READ transaction, encrypted in memory, written, read back and compared before PASS. On failure there is no partial file and the log shows FAIL.

**Verify the newest file** (asks for the passphrase once):
```
$f = (Get-ChildItem 'C:/Users/appri/taxiflow-backups/*.tfbk' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName; node scripts/backup/backup.mjs verify --file $f
```
- Expected: `PASS decrypts, complete and consistent: {counts}`, with the same counts as the export.
- The release-day backup is taken inside the quiet window, right before the hashes in section 6 step 2. Its counts must then equal the row counts from `unchanged-data-release-06.sql` (businesses, memberships, snapshots, finance requests, platform admins, Auth users).

**Restore rehearsal (optional; Tebogo decides after reading this).**

Where production data would be stored:
- Decrypted rows go only into the Postgres database of the isolated local test stack: the Docker volume `taxiflow_localdb_test_db`.
- That volume sits inside Docker Desktop's data disk, in the Claude app's package storage on this laptop (`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\...`).
- The tool never writes the decrypted backup as a file.
- The copy includes Auth users: emails and password hashes (not passwords), and business records.

How access is restricted:
- The stack's ports are bound to 127.0.0.1 only (45321 API, 45322 database, 45324 mail). The setup refuses any other binding, so nothing on the hotspot or LAN can reach it.
- Access needs this Windows account (or an administrator) and Docker Desktop.
- No app or dev server is pointed at it. The phone demo on 5173 is demo-mode only.
- It is still a full copy of production personal data on a laptop. Keep the laptop locked during the rehearsal and do not run other work on the test stack until it is removed.

How it is removed:
- `setup.mjs reset` stops the stack, **deletes the volume**, recreates it and loads only synthetic data.
- Check afterwards that no `@example.com`-free accounts remain (command below).
- Freed space inside Docker's virtual disk is not zeroed. For a stronger wipe, delete the volume and compact the disk, or reinstall Docker Desktop.

Commands (run one at a time):
```
$env:TAXIFLOW_LOCALDB_PROFILE = 'test'; node scripts/localdb/setup.mjs schema
$env:TAXIFLOW_LOCALDB_PROFILE = 'test'; node scripts/backup/backup.mjs restore --target local --file $f
$env:TAXIFLOW_LOCALDB_PROFILE = 'test'; node scripts/localdb/setup.mjs reset
docker exec taxiflow_localdb_test_db psql -U postgres -d postgres -Atc "select count(*) from auth.users where email not like '%@example.com'"
```
- Expected after the restore: the tool reports that the local database matches the backup.
- After the reset, the last line prints `0`.
- `schema` builds an empty current schema (including file 06), so the rehearsal also shows pre-06 memberships receiving their role defaults.

**Keep** the backup file and the passphrase until the after-release backup also verifies.

## 6. Deployment steps and smoke checks

Each step runs only on Tebogo's go; stop at the first failure.
1. Section 5: backup, verify, and the optional rehearsal.
2. The quiet window starts (tell staff). Run `unchanged-data-release-06.sql` and `fingerprint-release-06.sql` read-only and record both.
3. `node scripts/hosted/apply-release.mjs --target vfxftviwteypasredjgm --env-file <outside repo>` (typed ref). Expected: SKIP 01-05, APPLIED 06, every post-check PASS.
4. Run `verify-release-06.sql`: 11 rows true. Re-run both hash queries: **identical** to step 2.
   - The quiet window ends.
   - The live app is still `af3e5ad` and works on file 06.
5. Merge #6 (section 7), then the **gate** (section 8). Then merge #7 to #12.
6. Wait for the production build of the final `main` head; confirm its commit and that it is READY. Promote it once: `vercel promote <deployment-url> --scope apprigate`.
7. Smoke checks on `taxiflow.co.za` and `taxiflowpro.vercel.app`:
   - the new bundle contains `vfxftviwteypasredjgm.supabase.co` and not `sxoonhovoqgcpflhqirb`;
   - unauthenticated `/api/business/workspace` and `/api/admin/reports/period` answer 401;
   - Owner:
     - Business access shows responsibilities;
     - Reports > custom dates > PDF and CSV download;
     - Money > Expenses shows Recurring fixed expenses and Driver salaries;
   - phone: the menu opens and closes, and a PDF saves;
   - a Driver sees only Driver pages;
   - no test records in production unless Tebogo names one.
8. After-release backup and verify (section 5).

## 7. Merge and retarget sequence

**Merge method.** Use **"Create a merge commit"** for every PR. Do not squash: each branch contains the commits of the one below, so a squash would make the next PR re-show or conflict on them.

**Order.** #6 -> `main`; retarget #7 to `main` and merge; then #8, #9, #10, #11 and #12 the same way.
- Branches are not deleted on merge, so retarget by hand: GitHub > PR > Edit > base `main`.
- Before merging each PR, confirm it shows only its own commits.
- Mark each PR "Ready for review" just before its merge.

**Gate after merging #6:**
- `taxiflow.co.za` and `taxiflowpro.vercel.app` still serve `index-2xzkC0xd.js`;
- list the new deployment's aliases (section 8).

If either public domain moved, stop and re-promote `taxiflowpro-dy1a1k761`.

**Promote once**, after #12. `main` is not protected.

## 8. Deployment and promotion behaviour (actual configuration, read 2026-10-29)

**Project settings** (Vercel project `apprigate/taxiflowpro`):
- production branch `main`;
- Git deployments enabled (`createDeployments: enabled`; no `git` block in `vercel.json`);
- **`autoAssignCustomDomains: false`**;
- no custom environments, rolling release or ignore-build command;
- protection `all_except_custom_domains`; bypass entries 0.

**Production domains on the project:** `taxiflow.co.za`, `taxiflow.apprigate.com`, `taxiflowpro.vercel.app`.

**Aliases.** The current production deployment `dpl_2P2aUep4zsvNYk2LirS4qecRHX3s` (`taxiflowpro-dy1a1k761`, `af3e5ad`) holds all five:
- `taxiflow.co.za`
- `taxiflow.apprigate.com`
- `taxiflowpro.vercel.app`
- `taxiflowpro-apprigate.vercel.app`
- `taxiflowpro-git-main-apprigate.vercel.app`

Older production builds hold none.

**Reachable without a Vercel login:**
- `taxiflow.co.za` and `taxiflowpro.vercel.app`: public, 200, bundle `index-2xzkC0xd.js`.
- `taxiflow.apprigate.com`: 200 but serves no TaxiFlow bundle (served from elsewhere, noted 2026-10-28).
- `taxiflowpro-apprigate.vercel.app` and `taxiflowpro-git-main-apprigate.vercel.app`: 302 to Vercel login.

**What a merge does:**
- Every push to `main` builds a production-environment deployment, with production variables and the production server key.
- With auto-assign off, that deployment is staged. Vercel documents that staged production deployments get production domains only when promoted.
- Direct evidence: after PR #3 was merged (`af3e5ad`), build `dy1a1k761` was checked first and then promoted.

**Not confirmed:** whether `taxiflowpro-git-main-apprigate.vercel.app` (and the team alias `taxiflowpro-apprigate.vercel.app`) follow each `main` build before promotion. Treat them as possibly moving:
- they are behind Vercel login, so only team members could reach them;
- such a build talks to the production database, which is why file 06 is applied **before** the first merge;
- the gate in section 7 checks the actual aliases.

## 9. Rollback (application vs database undo vs data restore)

**Compatibility of `af3e5ad` with snapshots written by the new app: proved 2026-10-29.**

Method: the new code built a snapshot containing:
- a salary schedule;
- a bank salary and a takings salary;
- a recurring schedule with one payment.

The old server code then ran on it from a temporary worktree of `af3e5ad`.

Results:
- An old-app expense write applied normally.
- The salary and recurring schedules and their payment records were **preserved byte for byte**:
  - the old server spreads the stored snapshot and its `finance` object, and returns non-trip records unchanged;
  - the old client normalisation spreads the same objects;
  - the old browser cannot write snapshots, because its database grants are read-only.
- The driver's expected cash for a day with a takings salary was **identical**: 450 under both apps.
- The old Driver view still hides the schedules and shows only the takings salary; the old no-Money Manager view shows no finance data.

**What the old app does not do with the new data:**
- it shows no schedules;
- it treats salary and recurring payments as ordinary expenses, editable or deletable through its normal record actions, without their duplicate protection;
- it ignores per-person responsibilities and applies the fixed role rules (Admin counts; Manager verifies and banks);
- it does not enforce separation of duties.

**Rollback means degraded operation, not normal service.** The old app keeps the data, but it lets anyone with Money access edit or delete salary and recurring payments, and it drops the per-person controls. Users are therefore held out first, and the old app is used only in restricted form until Tebogo has assessed the problem.

**1. Hold users out (first step on any serious fault).**
- Promote the tested maintenance deployment:
  ```
  vercel promote https://taxiflowpro-cmlp6fmww-apprigate.vercel.app --scope apprigate
  ```
  It is `dpl_FHXMuDf19iELaFMadeFdPsgGQ2r3`, READY, and tested at the October cutover.
- Result: `taxiflow.co.za` and `taxiflowpro.vercel.app` show the maintenance page, and every `/api/*` call answers 503, so nobody can write through the public addresses.
- Data stays exactly as it is.
- Then assess, read-only: what failed, since when, and which records are affected (`unchanged-data-release-06.sql` plus the error logs).

**2. Choose one, with Tebogo:**
- **(a) Fix forward (preferred).** Stay in maintenance, fix, test on a Preview, promote the fixed build.
- **(b) Old app in restricted, degraded mode.**
  - Command: `vercel promote https://taxiflowpro-dy1a1k761-apprigate.vercel.app --scope apprigate`.
  - Allowed only under these written restrictions, announced to staff before the promote:
    - **Owner-only finance.** Admins and Managers do not count, verify or bank. The old app would apply the fixed role rules and ignore the responsibilities Owners set, so an Owner may need to switch staff Money access off in Business access first.
    - **No edits or deletions** of any expense whose description starts with "Driver salary /" or belongs to a recurring schedule. The old app does not protect them.
    - **No new salary or recurring payments.** The old app has no duplicate protection and no schedules.
    - Separation of duties is **not enforced**. The Owner must not verify a count they recorded.
  - Leave this mode by re-promoting the new (or fixed) deployment. All records written under the new app are still there.
- **(c) Remain in maintenance** until (a) is ready, when the restrictions in (b) are not acceptable.

**3. Database undo (only if file 06 itself is faulty; with users held out, and with Tebogo's approval).**
- How: `scripts/localdb/rollback/20261019090000_member_permissions.down.sql`.
- Removes the `permissions` column, its constraints, trigger and functions.
- **Loses any responsibility lists Owners set since release.**
- Keeps businesses, memberships, snapshots, the request log and the audit table.
- Re-applying file 06 later gives role defaults, not the lost lists.

**4. Data restore (exceptional; never part of the normal rollback).**
- Restoring the pre-release backup replaces the database with its state at backup time.
- Every transaction, cash-up, salary and expense entered after that is lost.
- It needs an explicit recovery decision by Tebogo that names what will be lost, and a fresh backup taken first.

## 10. Readiness checklist

**Done:**
- [x] Stack heads and order verified; the only migration is file 06.
- [x] Local `verify-all` all green on the release app code.
- [x] Hosted 16/16 on the isolated Preview; cleanup done (bypass 0, variables removed, test project paused).
- [x] Real phone, section F, passed (Firefox 158 / Android 16).
- [x] File 06 data changes documented (section 3); unchanged-data hash added and proved locally (section 4).
- [x] Rollback compatibility of `af3e5ad` with the new records proved (section 9).
- [x] Vercel aliases and promotion behaviour read from the configuration (section 8).

**Manual checks still open** (kept unconfirmed; `06-quality/manual-checks-guide-and-salary.md`):
- [ ] A1-A12, phone:
  - the guide: open, scroll, Skip, Help;
  - the driver's guide;
  - salary schedule, recording a payment and the duplicate warning;
  - a takings salary and the driver's view of it;
  - the expense CSV;
  - rotating the phone and the back button.
- [ ] B1-B7: the expense CSV in Excel **and** Google Sheets (columns, numeric amounts, sums reconcile, commas kept).
- [ ] C1, C2, C4, C5 on the phone (period reports); C3, the report CSV in a spreadsheet app.
- [ ] D1-D6: salary in the driver profile, history, links, the no-Money Manager, phone layout.
- [ ] E1-E4 and E6 on the phone; E5, the recurring report PDF and CSV (the CSV opened in a spreadsheet app).

**Before GO (Tebogo):**
- [ ] Hosted Part B in the test project's SQL editor (section 4; restore the project first, pause it after).
- [ ] Production backup connection file and output folder outside the repo (section 5).
- [ ] Decide on the restore rehearsal.
- [ ] Agree a quiet window and who is available for the smoke checks.

**On GO:** sections 5, 6 and 7 in order, with the gate after #6.

## 11. Recommendation

**GO is still recommended once the "Before GO" items are done:**
- the schema change writes only the backfilled `permissions` column, proven to leave all other data identical;
- application rollback is a single re-promote, proven to read and keep the new records;
- the public domains move only on promote.

**Switch to HOLD if:**
- Part B does not return its PASS message;
- the backup does not verify;
- any section 4 hash differs or any post-check is false;
- a public domain moves after the #6 merge;
- or Tebogo wants the open manual checks done first.
