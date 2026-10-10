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
| X3 | **Supabase Free has no automatic backups.** Only Pro and above get daily backups. Free projects are also paused after a low-activity week (restorable for 90 days). | supabase.com/docs/guides/platform/backups and `/free-project-pausing` (checked 2026-10-10) | **Operator daily encrypted backup** (section 4). The backup script is **not built yet**; it must be built and tested locally before go-live. Daily pilot use should prevent pausing. |

## 1. Release rows

| # | Area | Action | Pass | Stop if |
|---|---|---|---|---|
| 1 | Local | Reviewed SHA: `npm run build`; unit tests; `node scripts/localdb/setup.mjs hosted` then `node scripts/localdb/hosted-rehearsal-tests.mjs` | build OK; all pass | any fail |
| 2 | **Backup** | Read-only pre-flight (`hosted-inventory.md` queries); encrypted consistent backup plus manifest (`release-plan.md` section 3) | inventory unchanged; manifest verifies | a difference, or the backup fails |
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
| 13 | Close-out | First post-release encrypted backup; record the SHA and evidence (no secrets) | manifest verifies | — |

## 2. Secure recovery (never weaken access)
- **Before promotion:** keep the maintenance page up, fix forward, redeploy.
- **After promotion:** re-promote the last good tenant deployment; otherwise put up the maintenance page and fix forward.
- **One business's data:** restore its snapshot **together with** its request-log rows from the same backup, or make an operator forward fix.
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

- **Owner:** Tebogo (the operator). Pilot Owners have no backup duties.
- **When:**
  - daily after the working day, around 20:00 SAST;
  - before every release, migration or operator data load.
- **What:** one consistent read (`pg_dump --serializable-deferrable`, run from the local Docker Postgres image) using the database connection, **not API keys**. It covers:
  - `workspace_snapshots`, `businesses`, `business_memberships` and `finance_action_requests`;
  - `auth.users` (id, email, created_at, metadata) and `auth.identities`.
- **Encryption:** stream straight into `gpg --symmetric --cipher-algo AES256`, with the passphrase typed at the prompt. No plaintext touches disk.
- **Storage:**
  - local: `C:\Users\appri\taxiflow-recovery\backups\<date>.sql.gpg` (user-only access);
  - off-machine: a second copy of the **encrypted file only**;
  - retention: 14 days.
- **Manifest:** the SHA-256 of the encrypted file, plus row counts and the newest `updated_at` per business. No personal values.
- **How a failed backup is detected:**
  1. The run ends with one line in `backups\backup-log.txt`: `PASS` or `FAIL <reason>`.
     - FAIL covers: a non-zero exit, an empty or short file, a hash mismatch, or a decrypt test that fails or gives counts different from the manifest.
  2. The operator's **first task each morning** is to confirm that the newest log line is PASS and less than 26 hours old.
  3. The newest `updated_at` in the manifest must not be older than the last day closed in the app (catches stale backups).
  4. Once a week, decrypt the newest file to memory and check that it parses and its counts match.
  - Missing, stale or FAIL: run the backup again the same day, and **pause operator data loads** until a PASS is recorded.
- **Restore rule:** restore one business's snapshot **together with** its request-log rows from the same backup (`release-plan.md` section 3).
- **Recovery point:** up to 24 hours of work can be lost (there is no point-in-time recovery on Free).
- **Gap:** the guarded backup script is **not built yet**. It needs its own authorization: built and tested against the local stack first, with no hosted run until the release window.
