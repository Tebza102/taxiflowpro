# Pilot Release Checklist: Existing TaxiFlow Platform

Status 2026-10-10: **ready for review; nothing executed.** This checklist replaces the hosted-rehearsal route (`rehearsal-decision-pack.md`, `rehearsal-cutover-checklist.md`, both superseded). There is **no separate hosted rehearsal and no extra spend**. The release runs on the existing platform:
- the Supabase project `vfxftviwteypasredjgm` (Free org "Apprigate");
- the Vercel project `taxiflowpro` (Hobby team `apprigate`).

Hosted-only checks (the new keys with the server functions, `/api/business/*` routing, email) are proven on a `--skip-domain` production deployment **behind the maintenance page**, before promotion.

Every row needs Tebogo's authorization for the window. A "stop" leaves the maintenance page up and the database locked. Never revive the legacy build or restore browser access.

## 0. Blockers to clear before the window (no action taken)

| # | Blocker | Evidence | Needed |
|---|---|---|---|
| X1 | **Vercel Hobby is non-commercial only.** A taxi-owner pilot is commercial use. The only Vercel team on the account is `apprigate` (Hobby, no trial; CLI read 2026-10-10). **No existing entitlement covers it.** | Vercel Fair Use Guidelines (verified 2026-09-14, `rehearsal-decision-pack.md` section 1) | Tebogo upgrades the `apprigate` team to Pro (**$20/month**). **Not purchased.** |
| X2 | **Setup emails cannot reach pilot Owners.** Without custom SMTP, Supabase's default sender only delivers to the org's team members and is rate-limited. | supabase.com/docs/guides/auth/auth-smtp (checked 2026-10-10) | Use the **existing `apprigate.com` mail hosting** (section 3). It already has SPF, DKIM, DMARC and valid TLS, so **no DNS change** is needed. |
| X3 | **Supabase Free has no automatic backups.** Only Pro and above get daily backups. Free projects are also paused after a low-activity week (restorable for 90 days). | supabase.com/docs/guides/platform/backups and `/free-project-pausing` (checked 2026-10-10) | **Operator daily encrypted backup** with `scripts/backup/backup.mjs` (section 4). It is built and tested locally (35/35) but **not yet run against production**. Daily pilot use should prevent pausing. |

## 1. Release rows

| # | Area | Action | Pass | Stop if |
|---|---|---|---|---|
| 1 | Local | Reviewed SHA: `npm run build`; unit tests; `node scripts/localdb/setup.mjs hosted` then `node scripts/localdb/hosted-rehearsal-tests.mjs` | build OK; all pass | any fail |
| 2 | **Backup** | Read-only pre-flight (`hosted-inventory.md` queries); then the section 4 **export** and **verify** commands against production (the first hosted run) | inventory unchanged; `PASS backup verified`, then `PASS decrypts` | a difference, or anything but PASS: stop |
| 3 | Keys (prep) | Create the publishable `web` and secret `vercel-production` keys; set the Production variables (`release-plan.md` section 6); no secret in Preview or Development | saved; no build yet | — |
| 4 | **Maintenance** | Build the static maintenance deployment (no keys); disable the Git auto-deploy of `main`; merge the reviewed SHA to `main` | a ready URL; no build triggered | an unexpected build |
| 5 | Window opens | Promote the maintenance page | users see maintenance | promote fails |
| 6 | **Credentials** | Deactivate the legacy anon and service_role keys | legacy-key requests return **401** | a legacy key still works |
| 7 | **Migration** | Apply release files 01, 02, 03 and 04 in that tested order, each in its own transaction. File 04 only **creates** the operator function. | each commits; 01's assertions pass | an error: the file rolls back; stop |
| 7a | Owner check | Run `scripts/hosted/assign-initial-owner.mjs` **only if** row 8 shows no active Owner. The function and planner refuse a business that already has one. | the live inventory maps 1 active Owner, so normally **not run** | — |
| 8 | Access check | Run the `hosted-rehearsal-tests` checks as SQL; API calls with the new publishable key | no browser access to the 10 relations; 5 users mapped, 1 Owner | any browser access |
| 9 | **Deployment** | `vercel deploy --prod --skip-domain` of the reviewed SHA | build OK; `/api/business/*` returns 401 without a token | build fails or returns 404 |
| 10 | **Smoke tests** | On that URL: Owner sign-in, workspace, one finance action, Business access, report preview and PDF, `/api/admin/auth-users` returns 410 | all pass with the new keys | any fail: stay in maintenance; fix forward |
| 11 | Promote | `vercel promote <deployment>`; delete or protect the old production and Preview deployments | the tenant app is live; no legacy deployment is public | promote fails: maintenance stays |
| 12 | Email | Auth Site URL and redirect allow-list = the production URL; custom SMTP (X2); "Forgot password?" for a test inbox | the email arrives; the link works | not delivered: hold onboarding |
| 13 | Close-out | First post-release backup (section 4 export, verify and check); record the SHA and evidence (no secrets) | PASS; `check` says OK | not PASS: back up again before onboarding |

## 2. Secure recovery (never weaken access)
- **Before promotion:** keep the maintenance page up, fix forward, redeploy.
- **After promotion:** re-promote the last good tenant deployment; otherwise put up the maintenance page and fix forward.
- **One business's data:** the section 4 one-business restore (its snapshot **together with** its request log), or an operator forward fix.
- **Leaked key:** create a replacement, update Production, then delete the old key.
- **Never:**
  - `scripts/localdb/rollback/*`;
  - re-creating `using (true)` policies or browser grants;
  - re-activating legacy keys;
  - redeploying `main` @ `008ce8e`;
  - restoring the pre-migration database.

Recovery detail: `release-plan.md` section 7.

## 3. Sender setup (existing apprigate.com mail; no DNS change)

**What is already in place** (read-only checks, 2026-10-10):
- The mail host is `mail.apprigate.com` (Exim on shared hosting).
- SPF includes the host. DKIM selector `default` is published. DMARC is `p=none`.
- Ports 465 (TLS) and 587 (STARTTLS) present a valid Let's Encrypt certificate for `apprigate.com`.

**Steps** (Tebogo; part of the release authorization):
1. In the existing hosting mail panel, create one dedicated mailbox, for example `taxiflow@apprigate.com`, with a long unique password.
2. In the Supabase dashboard, go to Authentication → Emails → SMTP Settings and enter:
   - host `mail.apprigate.com`, port `465`;
   - username: the full mailbox address;
   - sender address: the same mailbox; sender name "TaxiFlow Pro".
3. **Type the password only into that dashboard field.** Never put it in chat, Git, an env file or a ticket.
4. In Authentication → URL Configuration: set the Site URL to the production URL and allow-list only the production URL.
5. Send a test: "Forgot password?" to a mailbox Tebogo controls. Check that it arrives, isn't spam, and that the link works.
6. Keep the default rate limit of 30 auth emails per hour; it is enough for 3 Owners.

**Rotation:** if the mailbox password is ever exposed, change it in the mail panel and re-enter it in Supabase.

## 4. Daily encrypted backup (operator)

**Tool:** `scripts/backup/backup.mjs`. **Tested locally** on synthetic data with `node scripts/localdb/backup-tests.mjs` after `node scripts/localdb/setup.mjs reset` (35/35, 2026-10-10), plus unit tests in `tests/backup-tool.test.mjs`. **Not yet run against production.**

**What it does**
- **Consistent export:** one read-only REPEATABLE READ transaction covering:
  - `businesses`, `business_memberships`, `workspace_snapshots` and `finance_action_requests`;
  - `auth.users` (whole rows, including password hashes, so a restore needs no password resets) and `auth.identities`.
- **Fail-closed checks:** the export must be complete JSON with an end marker, and every membership, snapshot, request-log row and identity must point to a backed-up business or user.
- **Encryption:** in memory, AES-256-GCM with an scrypt-derived key (Node built-in). No plaintext and no passphrase is ever written to disk. GCM rejects a wrong passphrase and any tampered or truncated file.
  - *Deviation:* this replaces the earlier gpg plan. Git's gpg on Windows cannot take a passphrase over a pipe, so it would have needed a passphrase file on disk.
- **PASS only after verification:** the file is written as `.partial`, read back, decrypted, and compared with the export hash and counts. Only then is it renamed and `PASS` appended to `backup-log.txt`.
  - Any failure (database error, incomplete output, encryption or verification failure) removes the partial file, appends `FAIL <reason>` and exits 1.
- **Manifest:** counts, business ids, snapshot versions and hashes only. No emails, names or money.
- **Repository guard:** output folders and passphrase or env files inside the repository are refused. `.gitignore` also excludes backup files.

**Commands** (the hosted commands are not yet run; the local equivalents are tested)

```
# daily export (about 20:00 SAST) - prompts for the passphrase twice, then the typed project ref
node scripts/backup/backup.mjs export --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\backup.env --out-dir C:\Users\appri\taxiflow-recovery\backups

# weekly (and after every release): the newest file decrypts and matches its manifest
node scripts/backup/backup.mjs verify --file C:\Users\appri\taxiflow-recovery\backups\<file>.tfbk

# every morning, first task: exit 0 only if the newest log line is a PASS under 26 hours old
node scripts/backup/backup.mjs check --out-dir C:\Users\appri\taxiflow-recovery\backups
```

**`backup.env`** (Tebogo creates it outside the repository and restricts it to the user account; never commit or share it). It holds:
- `TAXIFLOW_BACKUP_PGHOST`: the Supabase **Session pooler** host;
- `TAXIFLOW_BACKUP_PGPORT=5432`;
- `TAXIFLOW_BACKUP_PGUSER=postgres.vfxftviwteypasredjgm`;
- `TAXIFLOW_BACKUP_PGPASSWORD`: the database password;
- optionally `TAXIFLOW_BACKUP_PGDATABASE=postgres`.

The tool refuses any host or user that does not belong to the `--target` project, and always uses TLS. The connection settings reach `psql` only through the environment, never the command line. `psql` runs from the already-installed local image `public.ecr.aws/supabase/postgres:17.11.0.004`, so Docker Desktop must be running.

**Passphrase:**
- at least 16 characters;
- kept in a password manager, **never** stored with the backups;
- **losing it makes every backup unrecoverable.**

**Operator responsibility:** Tebogo. Pilot Owners have no backup duties.
- **When:** daily after the working day, and before every release, migration or operator data load.
- **Off-machine copy:** after each PASS, copy the `.tfbk` and its manifest off the machine (encrypted file only). Keep 14 days; the tool does not delete old files.

**How a failed backup is detected**
1. The export exits 1, prints `FAIL`, logs `FAIL <reason>`, and leaves no backup file. (Tested: a database error during export.)
2. The morning `check` exits 1 with `ALERT` when the newest entry is a FAIL, there is no entry, or the newest PASS is older than 26 hours. (Tested.)
3. `verify` rejects a wrong passphrase, a tampered or truncated file, or a file whose manifest differs. (Tested.)
4. On ALERT: back up again the same day, and **pause operator data loads** until a PASS is recorded.

**Recovery steps**
- **One business has bad data** (the likeliest case):
  1. Ask that business's users to stop working.
  2. Run `restore --target <ref> --file <file> --business <business-id>` (typed confirmation). It restores that business's snapshot **together with** its request log in one transaction, then re-reads and compares.
  3. Ask the users to reload.
  - **Memberships and Auth are deliberately not restored.** An old backup could re-grant access an Owner has since removed.
  - A retried request whose change was rolled back is applied again once; it is never reported as "already applied". (Tested.)
- **Project lost** (disaster):
  1. Create a new project. Apply the schema: the baseline `supabase/schema.sql`, then release files 01, 02, 03 and 04.
  2. Run `restore --target <new-ref> --file <file>`. It runs only into an empty project (tested refusal), in one transaction, and compares every table afterwards. (Tested locally: every account signs in with its original password, business isolation holds, and retry protection survives.)
  3. Create new keys, update Vercel, run the smoke tests (rows 9–10).
- **Never:** restore the pre-migration database, or restore into the live project with a full restore (refused because it is not empty).

**Limitations**
- **Not yet run against production:** the hosted connection (Session pooler, TLS, Docker) is proven only on its first authorized run in row 2.
- **Recovery point:** up to 24 hours of work can be lost. There is no point-in-time recovery on Free.
- **Not included in the backup:**
  - Auth sessions, refresh tokens, MFA factors and audit logs (users simply sign in again);
  - Storage objects (TaxiFlow does not use Storage);
  - the empty legacy tables;
  - project settings: Auth URLs, SMTP, keys and Vercel variables. These are recorded in this checklist and re-entered by hand.
- **The backup contains password hashes and all business data.** Treat every copy as highly sensitive, even though it is encrypted.
- **Decrypting needs this repository's `scripts/backup` and Node (tested with v24).** Record the commit SHA with the off-machine copy.
