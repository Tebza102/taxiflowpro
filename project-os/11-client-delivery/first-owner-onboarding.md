# First Pilot Owner: Onboarding Plan

Status 2026-10-10: **prepared; not run.** It needs the release (`05-build/pilot-release-checklist.md`) with blockers X1–X3 cleared.

**Order:**
1. Onboard **one** real taxi owner as the pilot tester.
2. Run their first working day end to end.
3. Add pilot Owners 2 and 3, **only after that day succeeds** (definition below).

## 1. Collect from the Owner (operator keeps this outside Git)
- Owner name and email. The email must reach them, so custom SMTP must be live.
- Business name and a short slug (for example `pilot-one`).
- Whether the Owner also drives (owner-driver).
- Set-up data:
  - vehicles (registration, route);
  - routes with stops and fares;
  - drivers' names and emails (and any Admin or Manager);
  - business settings and presets.

The data follows the template in `05-build/pilot-business-data.md`.

## 2. Operator steps
Credentials come from an env file **outside the repository**. The scripts do a dry run by default; `--apply` asks for the typed project ref.
1. `node scripts/hosted/onboard-business.mjs --target vfxftviwteypasredjgm --env-file <outside-repo> --slug <slug> --name "<business>" --owner-email <email> --owner-name "<name>" [--owner-drives]`. Check the dry run, then repeat with `--apply`. The Owner gets the password-setup email.
2. `node scripts/hosted/load-business-data.mjs --target vfxftviwteypasredjgm --env-file <outside-repo> --slug <slug> --file <input.json>`. Check the plan, then `--apply`.
3. The Owner sets a password, signs in and sees only their business.
4. The Owner adds staff in **Business access**:
   - Admin, Manager, Driver, or the Owner as driver;
   - each new person receives a setup email.
5. Take an encrypted backup (the Free plan has no automatic backups).

## 3. First working day: success definition
All of the following, on real data, with no operator data repair:
- A driver (or the owner-driver) captures trips and expenses and submits the day.
- An Admin records the cash hand-in, and a Manager (or the Owner) verifies it.
- The Owner or Manager banks the deposit, and the Daily Finance Report preview and PDF match the cash handed in.
- Everyone sees only what their role allows.
- A day with no cash to bank (expenses only) closes as **"Closed: no cash to bank"**, with no deposit.
- The next morning's backup verifies.

**Then** repeat sections 1–2 for Owners 2 and 3, one at a time.

## 4. Limitations to tell the Owner
- **Operator-managed set-up:**
  - new businesses, vehicles, routes, fares, settings and presets are loaded by the operator;
  - the Owner manages people only (Business access).
- **No reopening:** once a day is counted, verified or closed, it cannot be changed or re-submitted. Corrections are an operator forward fix.
- **No reimbursement tracking:**
  - cash expenses above a day's takings show as **"funding source unconfirmed"**;
  - they are never part of a deposit;
  - settle them outside TaxiFlow.
- **Email:** setup and password emails depend on the custom SMTP sender. If one doesn't arrive, contact the operator.
- **Backups and support:** these are run by the operator. Report problems through the support process (`support-process.md`).
