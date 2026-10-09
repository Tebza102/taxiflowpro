# Next Action

## Immediate Next Step (updated 2026-10-09 ~22:35)

The local test gaps are closed and committed locally (`a424d84`, `00df61a`, `78d44c2`, `9cc33fa`, plus the Project OS commit). See `current-status.md` → Local commits not yet pushed.

1. **Next (needs Tebogo's go-ahead):** push `agent/owner-first-auth-reset` so PR #2 and its Vercel Preview pick up these commits. Then confirm the Preview build is green before any acceptance testing.
2. Run the PR #2 Preview acceptance below on that Preview. In addition to the listed gates, check `appUsers` membership and role boundaries per role: Owner, Admin, Manager, Driver (own records only), and Viewer (demo-only). Also check the Reports access rules (Owner/Admin/Manager with Money access; Driver/Viewer never). Supabase Auth succeeding is not enough on its own.
3. Parked, not part of this gate: the mock/demo "profile-only driver can still sign in locally" gap (see `current-status.md`).

Still blocked or out of scope for this gate: tenant/database isolation (not implemented); `workspace_snapshots` open to every authenticated user via `using (true)`; `anon`/`authenticated` `TRUNCATE` and full grants on 9 tables (RLS does not govern `TRUNCATE`; revoke explicitly in a later, reviewed migration); the held `appUsers` migration; no isolated database for migration/restore drills.

Then continue with the release validation below. Preview UAT steps that sign in with Tebogo's Owner account or need the recovery email must be done by Tebogo; Preview uses the live Supabase project, so any UAT mutation is a live-data change.

## Current Recommended Action (PR #2 release validation)

Finish TaxiFlow PR #2 as a release-validation pass. Do not add product features or redesign the application.

Use the existing Vercel Preview and current branch implementation to prove the remaining real-browser release gates:

1. Sign in with an authorised non-demo account and verify the session resolves correctly after hard refresh.
2. Perform one representative live persistence flow and confirm the saved state survives hard refresh.
3. Run one finance path through `pending -> counted -> verified -> banked`, confirming canonical remote state after each meaningful step.
4. Trigger `Forgot password?` on Preview and verify Supabase recovery email delivery, redirect back to an allowed Preview origin, password update, sign-out, and subsequent sign-in with the new password.
5. Record exact pass/fail evidence. Fix only concrete defects exposed by these tests.

## If a Defect Appears

- Inspect the exact browser console/network/API/database evidence first.
- Make the smallest reversible fix.
- Rerun only the relevant failing flow plus the closest regression checks.
- After two failed fixes for the same root issue, stop editing and re-diagnose from evidence.
- Do not create a replacement auth, persistence, finance, or workspace architecture.

## Do Not Do Yet

- Do not merge PR #2 to `main` until Preview UAT passes.
- Do not apply `supabase/migrations/20260810_protect_workspace_appusers.sql` before the hardened production deployment is confirmed.
- Do not redesign Viewer behaviour; it intentionally remains demo/mock-data only.
- Do not rename or alter the finance status lifecycle.
- Do not migrate framework, replace Supabase, or introduce unrelated abstractions/packages.
- Do not expand this release into multi-tenant product work; handle that as a separately scoped gate after the hardening release closes.

## Definition of Done

This release-validation action is complete when:

- authenticated access and post-refresh persistence pass on Preview;
- the representative live mutation survives hard refresh;
- the full finance state progression passes on Preview;
- password recovery works end to end against the deployed Preview/Supabase configuration;
- any discovered defects have focused regression proof;
- `npm run build`, behavioural tests, and sync guards still pass after any code change;
- `current-status.md`, this file, and the PR description reflect the actual result.

If all gates pass, the next action is to mark PR #2 ready for review/merge. After the hardened `main` production deployment is confirmed, apply the reviewed `appUsers` RLS migration and run a short production smoke test.