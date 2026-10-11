# Runbook: onboard two independent businesses

Status 2026-10-11: **prepared; not run.** Only existing, tested tooling is used. Development is closed until next week.

**Production:** Supabase `vfxftviwteypasredjgm`, app `https://taxiflow.co.za`.

**Three businesses in total:**

| # | Business | Status |
|---|---|---|
| 1 | TaxiFlow Pro | existing workspace; **unchanged by this runbook** |
| 2 | New business A | onboard first |
| 3 | New business B | onboard only after A passes step 6 |

**Hard rules:**
- **No invitations until DKIM passes.** For an Owner email with no TaxiFlow sign-in yet, creating the business creates the account and immediately sends the password-setup email. (An existing account gets no email; see step 2.) So `--apply` in step 4 waits until the DKIM retest passes (`05-build/email-dkim-hosting-ticket.md`, then `00-start-here/next-action.md`). Before that, only steps 0–3 (inputs, dry run, backup) are allowed.
- **New Owners never join TaxiFlow Pro.** Do not add them in TaxiFlow Pro → Settings → Business access. Each Owner is created only by `onboard-business.mjs`, as Owner of their own business.
- **Passwords:** Owners set their own, privately, from the setup email. The operator never sees, types or sends a password.
- **Typed confirmations:** every `--apply` asks for the typed project ref in an interactive terminal. Tebogo runs those steps.

## 0. Inputs Tebogo supplies (keep outside Git)

Once (operator credentials):
- `C:\Users\appri\taxiflow-recovery\operator.env`, outside the repository, with two lines:
  - `SUPABASE_URL=https://vfxftviwteypasredjgm.supabase.co`
  - `SUPABASE_SECRET_KEY=<a secret key>` (must start `sb_secret_`).
- Recommended: create a separate secret key named `operator` in Supabase → API keys, so it can be revoked without touching the app's `vercel_production` key. Keep this file readable by your user only, like `backup.env`.
- The backup passphrase (typed at the hidden prompt) and the existing `backup.env`.

Per business:
1. **Slug:** short, lower case, unique, for example `pilot-one`.
2. **Business name:** exact. The data file must match it.
3. **Owner name and email:** the Owner's real email. It may be new to TaxiFlow, or already have a TaxiFlow sign-in. Step 2 shows which.
   - If it already has a sign-in, say which business access the person **should** keep. Example: an existing TaxiFlow Pro member who should stay one.
4. **Whether the Owner also drives** (`--owner-drives`).
5. **Set-up data file** `<slug>.json`, from `scripts/pilot/business-data.example.json`; the rules are in `05-build/pilot-business-data.md`:
   - routes (start and end stops);
   - vehicles (registration, route);
   - drivers (names, vehicle);
   - optional profile settings and expense presets.

   Keep it at `C:\Users\appri\taxiflow-recovery\onboarding\<slug>.json`, not in the repository.
6. **Staff to add later:** emails and roles (Admin, Manager or Driver). The Owner adds them in their own Business access after step 6.

## Per business, one at a time

All commands run in PowerShell from `C:\Users\appri\taxiflowpro`. Replace the `<...>` values.

### 1. Read-only baseline (agent)
Read-only SQL on production. Record the counts.

```sql
select b.slug, b.name, count(m.*) filter (where m.active) as active_members,
       count(m.*) filter (where m.active and m.role = 'Owner') as owners
from public.businesses b left join public.business_memberships m on m.business_id = b.id
group by b.slug, b.name order by b.slug;
```

Expected before business A: only TaxiFlow Pro, with 5 active members and 1 Owner.

### 2. Onboarding dry run (allowed now; reads only)
```powershell
node scripts/hosted/onboard-business.mjs --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\operator.env --slug <slug> --name "<business name>" --owner-email <owner email> --owner-name "<owner name>" [--owner-drives]
```

Expected: `business: "new"` and `ownerAccount: "new (password-setup email)"`.

If `ownerAccount` says `existing (unchanged)`, the script supports this safely. Checked in `api/_lib/tenantOnboarding.js` (`createBusinessWithOwner`, `ensureAuthUser`) and the `create_business_with_owner` RPC:
- the existing account is reused unchanged: no password reset and no email;
- an Owner membership is added in the **new** business only;
- memberships in other businesses (for example TaxiFlow Pro) are left exactly as they are, neither added nor removed.

A person with access to more than one business then chooses the business in the app's business picker. This is proven locally (`tests/localdb-browser/tenant-finance.spec.js`, two-business user). It has not yet been exercised on production.

Before step 4, confirm the person's existing access is intended. Don't ask the Owner for a different email.

### 3. Backup before any change (Tebogo; hidden passphrase prompts)
```powershell
node scripts/backup/backup.mjs export --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\backup.env --out-dir C:\Users\appri\taxiflow-recovery\backups
node scripts/backup/backup.mjs verify --file C:\Users\appri\taxiflow-recovery\backups\<new file>.tfbk
node scripts/backup/backup.mjs check --out-dir C:\Users\appri\taxiflow-recovery\backups
```

Expected: export PASS (tenant format), verify PASS, check OK.

Copy the `.tfbk` and `.manifest.json` to `G:\My Drive\TaxiFlow backups` and check that the SHA-256 hashes match. **Do not continue without a verified backup.**

### 4. Create the business and Owner (**only after the DKIM retest passes**; sends the invitation)
```powershell
$env:TAXIFLOW_SETUP_REDIRECT = 'https://taxiflow.co.za/'
node scripts/hosted/onboard-business.mjs --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\operator.env --slug <slug> --name "<business name>" --owner-email <owner email> --owner-name "<owner name>" [--owner-drives] --apply
```

Type the project ref when asked. Expected: `ok: true` and `status: "created"`, then either:
- new account: `ownerCreated: true`, `setupEmailSent: true`;
- existing account: `ownerCreated: false`, `setupEmailSent: false`, which is correct because they keep their current password.

Record the `businessId`.

If `setupEmailSent` is false, tell the Owner to use **Forgot password?** on `https://taxiflow.co.za`. Never set a password for them.

A repeat with the same slug and Owner is a no-op. A different Owner for an existing slug is refused.

### 5. Load set-up data (dry run, then apply)
```powershell
node scripts/hosted/load-business-data.mjs --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\operator.env --slug <slug> --file C:\Users\appri\taxiflow-recovery\onboarding\<slug>.json
```

Review every `ADD` and `UPDATE`, and any warnings. Fix the file and re-run until the plan is right. Then:

```powershell
node scripts/hosted/load-business-data.mjs --target vfxftviwteypasredjgm --env-file C:\Users\appri\taxiflow-recovery\operator.env --slug <slug> --file C:\Users\appri\taxiflow-recovery\onboarding\<slug>.json --apply
```

Type the project ref. Then run the dry-run command once more. Expected: "No changes. Nothing to write."

The loader never touches sign-ins, memberships or money records.

### 6. Verify isolation (agent SQL; Owner sign-in)
1. Re-run the step 1 query. Expected:
   - TaxiFlow Pro: **unchanged** (5 active members, 1 Owner);
   - the new business: 1 active member, its Owner.
2. Check that the Owner's memberships match the intended access:
   ```sql
   select b.slug, m.role, m.active from public.business_memberships m
   join public.businesses b on b.id = m.business_id
   join auth.users u on u.id = m.user_id
   where lower(u.email) = lower('<owner email>');
   ```
   Expected:
   - **new account:** exactly one row, `<slug> / Owner / true`;
   - **existing account:** the `<slug> / Owner / true` row, plus **only** the memberships they already had (step 1 / step 2 record), with unchanged roles and active flags.
3. The Owner sets their password privately from the email and signs in at `https://taxiflow.co.za`. Expected:
   - the tenant bar shows **only** their business name;
   - their vehicles, routes and drivers are present;
   - nothing from TaxiFlow Pro (or business A, when doing B) is visible;
   - Business access lists only themselves;
   - an Owner who also belongs to another business sees the business picker. In each business they see only that business's data.
4. TaxiFlow Pro's Owner (`owner@apprigate.com`) opens Business access. Expected: the same 5 active people as before. The new Owner is not added; an existing TaxiFlow Pro member stays listed only as they were.
5. Record the evidence in `08-logs/change-log.md` (no passwords, links or tokens).

**If any check fails:** stop. Do not onboard the next business. Restore the business with `backup.mjs restore --business <uuid>` only on an explicit decision.

### 7. Then
- The Owner adds their own staff in Business access. Each person gets a setup email, so this also waits for DKIM.
- Run the first working day (`first-owner-onboarding.md` §3).
- Repeat steps 1–6 for business B **only after** business A passes step 6.
- The next morning, take a backup with step 3's commands.

**Not in scope:** dashboard, custom roles, layout changes, new tooling, full regression suites.
