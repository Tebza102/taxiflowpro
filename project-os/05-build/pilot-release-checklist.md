# Pilot Release Checklist: Existing TaxiFlow Platform

Status 2026-10-10: **ready for review; nothing executed.** This checklist replaces the hosted-rehearsal route (`rehearsal-decision-pack.md`, `rehearsal-cutover-checklist.md`, both superseded). There is **no separate hosted rehearsal and no extra spend**. The release runs on the existing platform:
- the Supabase project `vfxftviwteypasredjgm` (Free org "Apprigate");
- the Vercel project `taxiflowpro` (Hobby team `apprigate`);
- the domain **`taxiflow.co.za`** (canonical), with `www.taxiflow.co.za` redirecting to it (section 5).

Hosted-only checks (the new keys with the server functions, `/api/business/*` routing, email) are proven on a `--skip-domain` production deployment **behind the maintenance page**, before promotion.

Every row needs Tebogo's authorization for the window. A "stop" leaves the maintenance page up and the database locked. Never revive the legacy build or restore browser access.

## 0. Blockers to clear before the window (no action taken)

| # | Blocker | Evidence | Needed |
|---|---|---|---|
| X1 | **Vercel Hobby is non-commercial only.** A taxi-owner pilot is commercial use. The only Vercel team on the account is `apprigate` (Hobby, no trial; CLI read 2026-10-10). **No existing entitlement covers it.** | Vercel Fair Use Guidelines (verified 2026-09-14, `rehearsal-decision-pack.md` section 1) | Tebogo upgrades the `apprigate` team to Pro (**$20/month**). **Not purchased.** |
| X2 | **Setup emails cannot reach pilot Owners.** Without custom SMTP, Supabase's default sender only delivers to the org's team members and is rate-limited. | supabase.com/docs/guides/auth/auth-smtp (checked 2026-10-10) | **Official sender: `notifications@taxiflow.co.za`** on the existing cPanel mail hosting for `taxiflow.co.za` (section 3). Support: `support@taxiflow.co.za`. One mail DNS fix: remove `+a` from the existing SPF record. |
| X4 | **`taxiflow.co.za` and `www` are live and attached to `taxiflowpro` (kept attached by Tebogo's decision), but they serve the current production, which is the LEGACY build `008ce8e`.** HTTPS is valid; `www` redirects 308 to the apex. | Checks 2026-10-10 22:55 SAST (section 5) | Ends at **row 5** (maintenance promoted). Starting the window earlier ends it sooner. |
| X3 | **Supabase Free has no automatic backups.** Only Pro and above get daily backups. Free projects are also paused after a low-activity week (restorable for 90 days). | supabase.com/docs/guides/platform/backups and `/free-project-pausing` (checked 2026-10-10) | **Operator daily encrypted backup** with `scripts/backup/backup.mjs` (section 4). It is built and tested locally (35/35) but **not yet run against production**. Daily pilot use should prevent pausing. |

## 1. Release rows

| # | Area | Action | Pass | Stop if |
|---|---|---|---|---|
| 1 | Local | Reviewed SHA: `npm run build`; unit tests; `node scripts/localdb/setup.mjs hosted` then `node scripts/localdb/hosted-rehearsal-tests.mjs` | build OK; all pass | any fail |
| 2 | **Backup (connection proof)** | Read-only pre-flight (`hosted-inventory.md` queries); then the section 4 **export** and **verify** against production. This is the first hosted run; it proves the pooler, TLS and Docker path before the window. | inventory unchanged; `PASS backup verified`, then `PASS decrypts` | a difference, or anything but PASS: stop, and do not open the window |
| 3 | Keys (prep) | **DONE 2026-10-11 05:48 SAST.** Supabase: publishable `web_app` and secret `vercel_production` created (names must be 4 or more characters of lowercase letters, digits and underscores). Vercel `taxiflowpro`: `SUPABASE_SERVICE_ROLE_KEY` = `vercel_production`, Sensitive, **Production only**; `VITE_SUPABASE_ANON_KEY` = `web_app` (Production and Preview); the URL and mode variables unchanged. The legacy keys still work. | targets verified via the Vercel API (names, targets and times only). The values are proven at row 10 with the new keys. | — |
| 4 | **Maintenance (prepare)** | (a) Vercel → `taxiflowpro` → Settings → Environments/Git: turn **off** "Auto-assign custom production domains" (currently on), so no build reaches `taxiflow.co.za` without `vercel promote`. (b) Deploy `deploy/maintenance` as a production deployment **without domains** (section 6). (c) Merge the reviewed SHA to `main`. | a Ready maintenance deployment URL showing the maintenance page; the `main` build does **not** take the domains | a build takes the domains, or maintenance does not render |
| 5 | Window opens | `vercel promote <maintenance-url> --scope apprigate` | `https://taxiflow.co.za` and `taxiflowpro.vercel.app` show maintenance; `/api/*` returns 503 | promote fails: stop (legacy stays) |
| 5a | **Domain check** | DNS is already live, so only verify, with the section 5 checks | apex: maintenance over valid HTTPS; `www` 308 to the apex; `http` 308 to `https` | not maintenance: stop and re-promote maintenance |
| 6 | **Credentials** | Deactivate the legacy anon and service_role keys | legacy-key requests return **401** | a legacy key still works |
| 6a | **Final backup** | With maintenance up and the legacy keys off (no app can write), run the section 4 **export**, **verify** and **check** again. This is the restore point for the migration. | PASS; the counts match a read-only inventory taken at the same time | anything but PASS: stop before row 7 (the database is still unmigrated and locked) |
| 7 | **Migration** | Apply release files 01, 02, 03 and 04 in that tested order, each in its own transaction. File 04 only **creates** the operator function. | each commits; 01's assertions pass | an error: the file rolls back; stop |
| 7a | Owner check | Run `scripts/hosted/assign-initial-owner.mjs` **only if** row 8 shows no active Owner. The function and planner refuse a business that already has one. | the live inventory maps 1 active Owner, so normally **not run** | — |
| 8 | Access check | Run the `hosted-rehearsal-tests` checks as SQL; API calls with the new publishable key | no browser access to the 10 relations; 5 users mapped, 1 Owner | any browser access |
| 9 | **Deployment** | `vercel deploy --prod --skip-domain` of the reviewed SHA | build OK; `/api/business/*` returns 401 without a token | build fails or returns 404 |
| 10 | **Smoke tests** | On that URL: Owner sign-in, workspace, one finance action, Business access, report preview and PDF, `/api/admin/auth-users` returns 410 | all pass with the new keys | any fail: stay in maintenance; fix forward |
| 10a | **Auth URLs (before promotion)** | Supabase → Authentication → URL Configuration: Site URL `https://taxiflow.co.za`; replace the redirect list with **`https://taxiflow.co.za/**` only**. Remove `taxiflow.apprigate.com`, the `taxiflowpro-git-…` Preview URLs and `taxiflowpro.vercel.app`. | saved; links now point to `taxiflow.co.za` (maintenance until row 11) | — |
| 11 | Promote | `vercel promote <deployment>`; **delete the 4 Preview deployments** (branch `agent/owner-first-auth-reset`, built with the legacy secret) and the old production deployments; **revoke the Deployment Protection bypass secret** used for UAT | the tenant app is live on `https://taxiflow.co.za`; no legacy deployment is public; no bypass secret is active | promote fails: maintenance stays |
| 12 | Email (E6) | After promotion and **before onboarding**: send a password-reset / setup email to an **external** mailbox (Gmail) | arrives from "TaxiFlow" `notifications@taxiflow.co.za`; Gmail shows SPF, DKIM (`taxiflow.co.za`) and DMARC PASS; the link opens `https://taxiflow.co.za/` and the password can be set | not delivered, failing authentication, or a wrong landing page: hold onboarding |
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

## 3. Email: official TaxiFlow addresses on taxiflow.co.za (existing cPanel mail hosting)

Replaces the earlier `apprigate.com` sender plan (2026-10-10, Tebogo's instruction: official TaxiFlow communication uses `taxiflow.co.za`).

### Verified from outside (2026-10-10 23:30 SAST; no login, no authenticated send)

**Zone** (`ns3/ns5.za-dns.com`, cPanel):
- MX `0 mail.taxiflow.co.za`, and `mail` A 164.160.91.17;
- one SPF record: `v=spf1 +a +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all`;
- DKIM `default._domainkey` (RSA 2048);
- DMARC `v=DMARC1; p=none;`;
- `autodiscover`, `autoconfig` and `webmail` → 164.160.91.17;
- SRV `_autodiscover._tcp` → `cpanelemaildiscovery.cpanel.net:443`.

**Mail server:**
- Exim 4.100.1 on `cp24-jhb.za-dns.com` (reverse DNS matches);
- `AUTH PLAIN LOGIN`, 50 MB message limit;
- `spf.zamailgate.com` covers 164.160.91.0/24.

**TLS:**
- The certificate covers `cp24-jhb.za-dns.com` (Let's Encrypt, until 2026-11-21, renews automatically). **It does not cover `mail.taxiflow.co.za`** (hostname mismatch).
- So every client, including Supabase, uses host **`cp24-jhb.za-dns.com`**.

**Problem found:** SPF `+a` authorises the apex A record, which is now **Vercel 216.198.79.1**.

**Not verified by these checks:** mailbox quota and plan limits, whether accounts can be created free, authenticated sending, DKIM signing, and delivery. These need the panel and the test sends below.

### Addresses

| Address | Purpose | Access |
|---|---|---|
| `support@taxiflow.co.za` | monitored support mailbox; receives replies | webmail and phone/desktop (IMAP 993, SMTP 465) |
| `notifications@taxiflow.co.za` | authenticated sender for Supabase setup and password emails (sender name "TaxiFlow") | used only by Supabase SMTP. A **forwarder notifications → support** delivers replies to support (Supabase has no Reply-To setting). |

### Settings (verified host; passwords are entered only by Tebogo)

| Use | Host | Port | Security | Username |
|---|---|---|---|---|
| Outgoing (Supabase, devices) | `cp24-jhb.za-dns.com` | 465 | SSL/TLS | the full address |
| Outgoing (alternative) | `cp24-jhb.za-dns.com` | 587 | STARTTLS | the full address |
| Incoming IMAP | `cp24-jhb.za-dns.com` | 993 | SSL/TLS | the full address |
| Webmail | `https://cp24-jhb.za-dns.com:2096` | — | HTTPS | the full address |

### Steps (Tebogo signs in and types every password; the agent reads and prepares)
1. **cPanel** (`https://cp24-jhb.za-dns.com:2083`): check under Email Accounts that two more accounts fit within the plan (no charge shown) and note the storage quota. **If any charge or upgrade is shown, stop.**
2. **Create `support@taxiflow.co.za`** (quota: the plan default). Choose **"Send login link to an alternate email"** if offered, otherwise type a strong password from the password manager.
3. **Create `notifications@taxiflow.co.za`** (small quota, for example 250 MB). Use a long random password, stored in the password manager only.
4. **Forwarder:** `notifications@taxiflow.co.za` → `support@taxiflow.co.za`.
5. **SPF fix:** edit the **existing** SPF TXT record in place (never add a second one):
   - before: `v=spf1 +a +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all`
   - after: `v=spf1 +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all`
   - Then check **Email Deliverability** in cPanel: DKIM and SPF "valid".
6. **Support access:**
   - **Webmail:** `https://cp24-jhb.za-dns.com:2096`.
   - **Devices:** IMAP and SMTP as in the table above.
   - **2FA:** turn on two-factor authentication if the webmail account offers it.
7. **Supabase** (project `vfxftviwteypasredjgm`) → Authentication → Emails → SMTP Settings:
   - enable custom SMTP;
   - sender email `notifications@taxiflow.co.za`, sender name `TaxiFlow`;
   - host `cp24-jhb.za-dns.com`, port `465`, username `notifications@taxiflow.co.za`;
   - password typed by Tebogo;
   - keep the default rate limit (30 per hour).
8. **URL configuration:** this changes **at release row 10a** (after the smoke tests pass, before promotion and onboarding), so setup links land on the compatible app:
   - Site URL `https://taxiflow.co.za`;
   - redirect allow-list `https://taxiflow.co.za/**` only.
   - Until then, the existing URL settings are left unchanged.

### Tests

| # | Test | Who and when | Pass |
|---|---|---|---|
| E1 | support → external mailbox (Tebogo's Gmail) | after step 6 | delivered to the inbox |
| E2 | Gmail "Show original" on the E1 message | after E1 | **SPF pass, DKIM pass `d=taxiflow.co.za`, DMARC pass** (alignment) |
| E3 | external → support; reply from support | after step 6 | both directions delivered |
| E4 | external → notifications | after step 4 | arrives in support (forwarder) |
| E5 | Supabase "Send password recovery" to a controlled account Tebogo owns | **Done 2026-10-11:** authenticated TLS SMTP from Supabase delivered (see log). External authentication is **not** covered, because the recipient is on the same server. | **SMTP delivery PASS.** External SPF/DKIM/DMARC for platform mail is verified at row 12 (E6). |
| E6 | Platform email to an **external** mailbox, plus the real setup/reset flow end to end on `https://taxiflow.co.za` | **awaits the secure deployment (rows 10a and 12)** | external SPF, DKIM and DMARC PASS; the link opens `https://taxiflow.co.za/`, and the password is set |

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

**Two formats (chosen automatically by a schema probe):**
- `taxiflow-backup-premigration-v1`: production **before** release files 01–04 (rows 2 and 6a). It holds `workspace_snapshots`, the 8 legacy tables, and Auth users and identities.
  - Restore is only into an **empty pre-migration** schema; one-business restore is refused.
  - Proof: `node scripts/localdb/backup-premigration-tests.mjs` after `setup.mjs hosted-pre`, 13/13 (2026-10-11). Release files 01–04 apply to the restored data: all snapshots mapped, an active Owner exists.
  - The legacy tables were empty in the fixtures (as in the live inventory), so restoring non-empty legacy rows is not exercised.
- `taxiflow-backup-v1`: after the migration (the tenant format; proof `backup-tests.mjs`).

**Database-password dependencies** (checked 2026-10-11): none in the hosted app. No Vercel variable or integration, and no CI. Only `backup.env` uses it. Do not reset it unless it is unknown.

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

## 5. Domain: taxiflow.co.za (canonical) and www redirect

### Update 2026-10-10 22:55 SAST (supersedes the state below)
- **Delegation:** registry status `ok`; nameservers `ns3/ns5.za-dns.com`.
- **Zone (za-dns):**
  - A @ `216.198.79.1`;
  - CNAME `www` → `a1963e84e6a53d28.vercel-dns-017.com` (these match Vercel's values read today);
  - email records preserved: MX `mail.taxiflow.co.za`, SPF, DKIM, DMARC, and mail/webmail/autodiscover → 164.160.91.17.
- **Vercel:** both names attached to `taxiflowpro`; `www` redirects 308 to the apex.
- **Certificates:** Let's Encrypt for `taxiflow.co.za` and `www.taxiflow.co.za`, valid until 2027-01-08.
- **Served build:** both names serve production `taxiflowpro-vq1gbf579`, which is **legacy `008ce8e`**, until row 5.
- No re-attachment is needed at activation; row 5a only verifies.
- `taxiflow.apprigate.com` is invalid (points to the shared host) and is left as it is.

### Current state (read-only checks, 2026-10-10)

**Registry** (WHOIS `whois.registry.net.za`):
- registered via **Absolute Hosting** on 2026-03-26; expires 2027-03-26;
- status **`serverHold`**;
- nameservers `ns1.accelerit.ltd` (196.11.178.134) and `ns2.accelerit.ltd` (196.11.178.135).

**Public DNS:**
- the `co.za` registry servers, 1.1.1.1 and 8.8.8.8 all return **NXDOMAIN** for `taxiflow.co.za` and `www`;
- both Accelerit nameservers answer **REFUSED** (no zone served).
- So there are **no published records today, including no MX, SPF, DKIM or DMARC**. Email on this domain can't be working now.
- If the registrar's DNS panel holds unpublished records (for example MX), they are kept unchanged.

**DNS provider:** the registrar's DNS (Absolute Hosting, published on the Accelerit nameservers). Changes are made in that panel.

**Vercel** (team `apprigate`, read-only CLI/API):
- `taxiflow.co.za` and `www.taxiflow.co.za` are **already attached to the project `taxiflowpro` as production domains**. Both are "verified" and "misconfigured" (no DNS yet), and there is **no www redirect**.
- **Production is still the legacy build** (`main` @ `008ce8e`, deployment of 2026-08-10).
- **Risk:** if the hold is lifted and records are added before row 5, the domain would serve the legacy build. Hence row 5a: records only once the maintenance page is on production.
- `taxiflow.apprigate.com` is also attached, but its DNS points to the shared host (164.160.91.17), not Vercel, so it does not serve the app.

### Proposed changes (not applied; part of the release authorization)

**A. Registrar (before the window; safe at any time because no records exist):**
- lift the `serverHold`;
- confirm the zone exists on the Accelerit nameservers, i.e. `Resolve-DnsName taxiflow.co.za -Type SOA -Server ns1.accelerit.ltd` answers.
- Keep the nameservers unchanged.

**B. Vercel project `taxiflowpro` → Domains (before the window; no effect until DNS exists):**
- `taxiflow.co.za`: production domain (canonical), unchanged;
- `www.taxiflow.co.za`: **Redirect to `taxiflow.co.za`, 308 (permanent)**;
- `taxiflow.apprigate.com`: remove it from the project, or leave it (it does not reach Vercel). Its DNS on `apprigate.com` is **not** changed.

**C. Registrar DNS records (row 5a only, with the maintenance page on production):**

| Name | Type | Value | TTL |
|---|---|---|---|
| `taxiflow.co.za` (@) | A | `216.198.79.1` | 300 |
| `taxiflow.co.za` (@) | A | `64.29.17.1` | 300 |
| `www.taxiflow.co.za` | CNAME | `a1963e84e6a53d28.vercel-dns-017.com.` | 300 |

The values are Vercel's rank-1 recommendation for this project, read 2026-10-10. Re-read them at row 5a from Vercel → Domains, and use whatever Vercel shows then.
- **Remove** any other A, AAAA or CNAME records on @ or `www` (for example registrar parking pages). They would break HTTPS issuance or send users elsewhere.
- **Keep unchanged** any MX, SPF/TXT, DKIM, DMARC or mail-host records.
- **Do not add** any MX or email records. The mail records already exist; the only mail DNS change is the SPF `+a` removal in section 3.
- **CAA:** none exist. If any are ever added, they must allow `letsencrypt.org`, which Vercel uses.
- After 24 hours of stable operation, the TTL can go up to 3600.

### HTTPS and checks at row 5a, then again after row 11

| Check | Expected |
|---|---|
| `Resolve-DnsName taxiflow.co.za -Server 1.1.1.1` | A 216.198.79.1 and 64.29.17.1 |
| Vercel → Domains | both domains "Valid Configuration"; certificate issued (Let's Encrypt, automatic) |
| `curl -sI https://taxiflow.co.za` | 200, valid certificate for `taxiflow.co.za`; maintenance page at row 5a, tenant app after row 11 |
| `curl -sI https://www.taxiflow.co.za` | 308, `location: https://taxiflow.co.za/` |
| `curl -sI http://taxiflow.co.za` | redirect to `https://` |
| "Forgot password?" on `https://taxiflow.co.za` (row 12) | the email link opens `https://taxiflow.co.za/` |
| Operator setup emails | run the hosted operator scripts with `TAXIFLOW_SETUP_REDIRECT=https://taxiflow.co.za/`. If it is unset, Supabase uses the Site URL, which is also `https://taxiflow.co.za`. |

**Code:** no change needed.
- The app's "Forgot password?" and Business-access setup emails use the host the request came from.
- Supabase only honours allow-listed hosts and otherwise falls back to the Site URL.

### Recovery for the domain (never point users to the old build)
- **Records wrong, or certificate not issued:**
  - fix the records, or remove the @ and `www` records (the domain stops resolving);
  - the tenant app stays reachable to the operator at its deployment URL;
  - hold onboarding.
- **Never** promote, alias or re-attach a legacy deployment (`008ce8e`) to `taxiflow.co.za`. App failures follow section 2 (maintenance page, then fix forward).

## 6. Maintenance deployment (existing project `taxiflowpro`; prepared, not deployed)

**Files:** `deploy/maintenance/`
- `index.html`: static, no scripts, noindex;
- `sw.js`;
- `api-maintenance.json`;
- `brand/` icons;
- `vercel.json`: no install, no build, output `.`, routes.

There is no `api/` folder, so there are **no functions and no keys**.

**Why it is built this way** (tested):
- The legacy service worker serves its **cached legacy app** whenever a navigation is not OK. So the maintenance page answers **200 with no-store**, never 503.
- `/sw.js` is a replacement worker. It deletes every cache, reloads open pages, and unregisters itself, so installed legacy apps cannot reopen offline.
- `/api/*` answers 503 JSON. Legacy asset URLs only get the maintenance page.

**Evidence:**
- `node scripts/release/maintenance-tests.mjs` 15/15, in Chromium with the real legacy worker from `008ce8e`:
  - an installed legacy client switches to maintenance about 3 seconds after its first maintenance page load;
  - then 0 workers and 0 caches remain;
  - offline, no legacy app is left;
  - it also confirms that a 503 page *would* have shown the cached legacy app.
- `tests/maintenance-page.test.mjs` 5/5.

**Commands** (row 4b and row 5; not run). Run from the repository root at the reviewed SHA:
```
mkdir -p deploy/maintenance/.vercel && cp .vercel/project.json deploy/maintenance/.vercel/project.json
vercel deploy --cwd deploy/maintenance --prod --skip-domain --scope apprigate
# check the printed URL while signed in to Vercel (Deployment Protection covers non-custom URLs):
#   the page shows "We are upgrading TaxiFlow Pro"; <url>/api/business/workspace returns 503 JSON
vercel promote <maintenance-url> --scope apprigate        # row 5: the window opens
```
`deploy/maintenance/.vercel/` is git-ignored.

**After row 11:**
- The tenant build replaces maintenance on the domains. Its own `/sw.js` registers fresh.
- Keep the maintenance deployment, as the re-promote target for section 2.
