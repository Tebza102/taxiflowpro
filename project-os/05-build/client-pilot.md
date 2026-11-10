# Controlled client pilot (from 2026-10-30)

Release record: `05-build/release-stack-review.md` section 12. Feature development is **frozen** for the pilot: only fixes for the priorities below.

## Live system

- URL: https://taxiflow.co.za (also https://taxiflowpro.vercel.app)
- Deployment `dpl_64rcuDg1DUHW34W4cgSTWrQERB2K` (`taxiflowpro-hf0i0bonz`), commit `f24e71b` on `main` (PRs #6-#12; app code identical to the tested `cf75549`).
- Database: production `vfxftviwteypasredjgm`, release files 01-06.
- Previous build (documented degraded rollback only): `dpl_2P2aUep4zsvNYk2LirS4qecRHX3s` (`af3e5ad`). Maintenance build: `taxiflowpro-cmlp6fmww`.

## Pilot priorities (fix first, in this order)

1. Sign-in or access failures (someone cannot sign in, or sees a business/page they should not).
2. Incorrect money calculations (takings, expected cash, expenses, salaries, report totals).
3. Lost or changed data.
4. Blocked daily workflows (capture, hand-in, count, verify, bank).
5. Report errors (wrong dates or totals, PDF/CSV not produced).

Anything else (wording, layout, new ideas) goes to the backlog, not into the pilot build.

## First-client checklist

**1. Business setup** (platform admin, then Owner)
- [ ] Business created with the client's legal/trading name; one active Owner assigned.
- [ ] Owner signs in, sees only their business, dismisses or reads the guide.
- [ ] Banking window set (Overview > Set banking window).

**2. Roles and responsibilities** (Owner, Settings > Business access)
- [ ] Each person granted the right role: Admin, Manager or Driver.
- [ ] Responsibilities set per person. Defaults: Admin counts cash; Manager verifies and banks.
- [ ] **Cash counts need a second authorised person:** the person who counted a hand-in can never verify it (enforced on the server). Give "Receive and count cash" and "Verify counted cash" to at least two different people, or keep the Owner as the verifier.
- [ ] Each Driver sign-in linked to their driver profile.

**3. Vehicles and drivers**
- [ ] Routes, vehicles (registration, route) and driver profiles captured (Fleet & Operations, Drivers).
- [ ] Each vehicle has its driver set on the vehicle.
- [ ] Licence, PrDP, permit and disc expiry dates entered (document reminders depend on them).
- [ ] Driver salary settings in each driver profile, if salaries are paid (optional).
- [ ] Recurring fixed expenses (rent, insurance, tracking) under Money > Expenses, if any.

**4. Starting position**
- [ ] Agree the pilot start date with the client. TaxiFlow records activity from that date; it has no opening-balance entry.
- [ ] Record the cash on hand and bank balance at the start date outside TaxiFlow (signed by the Owner), so the first reports can be reconciled.
- [ ] Do not back-capture history unless the client asks; if they do, agree the period first.

**5. One full daily workflow** (first pilot day, with Tebogo available)
- [ ] Driver captures the day on the phone (trips and expenses).
- [ ] Admin receives and counts the cash hand-in.
- [ ] A **different** authorised person verifies the count.
- [ ] Manager or Owner banks the verified cash.
- [ ] Owner opens Reports: the daily PDF, and a business report for the day (PDF and CSV); totals match the cash counted.

## Issue log

Record every pilot report here (or in a shared sheet with the same columns). Severity: **P1** = one of priorities 1-3 (respond the same day; consider maintenance mode), **P2** = blocked workflow or report error, **P3** = everything else.

| # | Date | Reported by (role) | Business | What happened / expected | Page | Phone or computer | Severity | Status | Fix / reply |
|---|------|--------------------|----------|--------------------------|------|-------------------|----------|--------|-------------|
| 1 | | | | | | | | | |

## Support contact

Tebogo, Apprigate: the pilot's single support contact for all issues (phone/WhatsApp and email as given to the client in the onboarding pack; not stored in this public repository). Serious faults follow `release-stack-review.md` section 9: maintenance first, then a decision.

## Open limitations at pilot start

- Manual device checks A1-A12, B1-B7 (including the spreadsheet-app check), C1-C5, D1-D6 and E1-E6 are **not confirmed** (`06-quality/manual-checks-guide-and-salary.md`). Section F (phone menu and PDFs) passed on a real phone.
- Production smoke checks covered the Owner only. A Driver-only sign-in was not checked in production (it passed on the hosted Preview, 16/16).
- Salary and recurring-expense saving was not exercised in production (no test records in client data); it passed locally and on the hosted Preview.
- Changing someone's role needs remove-and-grant; custom roles are not available.
- Recurring expenses are calculated when TaxiFlow opens; nothing runs in the background.
