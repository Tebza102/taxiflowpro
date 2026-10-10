# Pilot Release Checklist: Existing TaxiFlow Platform

Status 2026-10-10: **ready for review; nothing executed.** This checklist replaces the hosted-rehearsal route (`rehearsal-decision-pack.md`, `rehearsal-cutover-checklist.md`, both superseded). There is **no separate hosted rehearsal and no extra spend**. The release runs on the existing platform:
- the Supabase project `vfxftviwteypasredjgm` (Free org "Apprigate");
- the Vercel project `taxiflowpro` (Hobby team `apprigate`).

Hosted-only checks (the new keys with the server functions, `/api/business/*` routing, email) are proven on a `--skip-domain` production deployment **behind the maintenance page**, before promotion.

Every row needs Tebogo's authorization for the window. A "stop" leaves the maintenance page up and the database locked. Never revive the legacy build or restore browser access.

## 0. Blockers to clear before the window (no action taken)

| # | Blocker | Evidence | Needed |
|---|---|---|---|
| X1 | **Vercel Hobby is non-commercial only.** A taxi-owner pilot is commercial use. | Vercel Fair Use Guidelines (verified 2026-09-14, `rehearsal-decision-pack.md` section 1) | Tebogo upgrades the `apprigate` team to Pro (**$20/month**) or another eligible plan. **Not purchased.** |
| X2 | **Setup emails cannot reach pilot Owners.** Without custom SMTP, Supabase's default sender only delivers to the org's team members and is rate-limited. | supabase.com/docs/guides/auth/auth-smtp (checked 2026-10-10) | A custom SMTP sender. This needs a sender domain with SPF/DKIM DNS records, which is a **DNS change**. Tebogo chooses the provider and domain. |
| X3 | **Supabase Free has no automatic backups.** Only Pro and above get daily backups. Free projects are also paused after a low-activity week (restorable for 90 days). | supabase.com/docs/guides/platform/backups and `/free-project-pausing` (checked 2026-10-10) | Accept the risk with **operator encrypted backups** (row 2, then daily during the pilot), or upgrade. Daily pilot use should prevent pausing. |

## 1. Release rows

| # | Area | Action | Pass | Stop if |
|---|---|---|---|---|
| 1 | Local | Reviewed SHA: `npm run build`; unit tests; `node scripts/localdb/setup.mjs hosted` then `node scripts/localdb/hosted-rehearsal-tests.mjs` | build OK; all pass | any fail |
| 2 | **Backup** | Read-only pre-flight (`hosted-inventory.md` queries); encrypted consistent backup plus manifest (`release-plan.md` section 3) | inventory unchanged; manifest verifies | a difference, or the backup fails |
| 3 | Keys (prep) | Create the publishable `web` and secret `vercel-production` keys; set the Production variables (`release-plan.md` section 6); no secret in Preview or Development | saved; no build yet | — |
| 4 | **Maintenance** | Build the static maintenance deployment (no keys); disable the Git auto-deploy of `main`; merge the reviewed SHA to `main` | a ready URL; no build triggered | an unexpected build |
| 5 | Window opens | Promote the maintenance page | users see maintenance | promote fails |
| 6 | **Credentials** | Deactivate the legacy anon and service_role keys | legacy-key requests return **401** | a legacy key still works |
| 7 | **Migration** | Apply release files 01, then 02, then 03, each in its own transaction. Apply 04 only if row 2 shows no active Owner (proposal P2). | each commits; 01's assertions pass | an error: the file rolls back; stop |
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
