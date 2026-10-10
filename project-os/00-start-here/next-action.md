# Next Action

## Immediate Next Step (updated 2026-10-09 ~22:35)

The local test gaps are closed and committed locally (`a424d84`, `00df61a`, `78d44c2`, `9cc33fa`, plus the Project OS commit). See `current-status.md` → Local commits not yet pushed.

1. ~~Push~~ — done by Tebogo: `628121b` is on origin; Preview `https://taxiflowpro-lapropkuh-apprigate.vercel.app`; production still `008ce8e`.
1a. ~~Commit the UAT safeguards~~ — done locally: `105e3385ef9f9f6c022bd7aef9c34c7a9e215ee0` (tooling + tests) and `924ec70f9ae41da6ef57cca644ee19691d475cdc` (Project OS). Not pushed.
1c-progress (2026-10-10 01:06): Docker Desktop 4.94.0 installed per-user (WSL 2, Linux containers, Windows containers off). Installer verified by SHA-256 and Authenticode. Terms accepted by Tebogo; engine 29.8.2 running; `docker run --rm hello-world` passed; port 2375 not exposed. **Next:** Supabase local init per `project-os/05-build/local-supabase-setup.md` steps 4–8, on Tebogo's go-ahead (open a new terminal so the Docker PATH entry is loaded).
1d-progress (2026-10-10 02:01): ~~local Supabase binding blocker~~ resolved with option 3 (Compose, explicit 127.0.0.1 ports, CLI disabled by an invalid sentinel config). Verify 14 PASS / 1 WARN; synthetic drill passed for schema, Auth and snapshot. Committed locally; not pushed.
1i (2026-10-10): owner-driver submit and `deposit.lock` done locally; request log retained and backed up (Task 14). **Next (separate task):** standalone count/verify, then capture (`saveStandardIncome`/`saveSpecialIncome`/`saveExpense`) and edit/delete as server actions; actor display names; then the membership-based user lifecycle and frontend integration.
1h (2026-10-10): scoped server writes for day cash-up submit / hand-in / verify done locally (Task 13). **Next (separate task):** extend the same pattern to `lockDeposit` (verified→banked, Owner/Manager), standalone record count/verify, then capture (`saveStandardIncome`/`saveSpecialIncome`/`saveExpense`) and edit/delete; map server actor ids to display names. Then the membership-based user lifecycle, then frontend integration.
1g (2026-10-10): server authorization boundary done locally for snapshot loading and report routes (Task 12). **Next (separate task):** a scoped server **write** endpoint (per-role `mergeScopedChanges`, `updated_at` CAS, pinned to the authorized business; no unrestricted whole-snapshot writes), then move `userLifecycle`/`auth-users`/`bootstrap-workspace` to `business_memberships`, then frontend `dataGateway` integration. All proven locally before any hosted plan.
1f (2026-10-10): ~~1e~~ tenant DB foundation done locally on `agent/tenant-db-foundation` (see `tenant-design.md`). **Next (separate task):** server-side integration. API routes resolve `business_id` from the caller's active membership; snapshot read/write moves behind those routes with role-scoped Driver projections; `dataGateway` stops direct table access; `userLifecycle` manages `business_memberships`. Prove it locally against this database before any hosted migration plan.
1e. ~~Next:~~ use the local stack to design and test the tenant/role isolation migration (replacing the flagged live-mirror policies, revoking anon/TRUNCATE grants, membership-based RLS) against synthetic multi-tenant fixtures, as a separate scoped task. Live UAT prerequisites (UAT- fixture vehicle, Vercel token, encrypted live backup) are unchanged.
1c. **Next (Tebogo, human):** set up the isolated local database per `project-os/05-build/local-supabase-setup.md`: free about 4 GB RAM, install Docker Desktop per-user, confirm `docker run --rm hello-world`, create `C:\Users\appri\taxiflow-localdb` outside the repo, `npx --yes supabase@2.120.0 init`, disable analytics, copy the baseline schema, `supabase start`. Then the agent runs the verification list in that file: reachable, synthetic-only, cannot target live, baseline loads, synthetic export/restore drill.
1b. Before any live UAT run (Tebogo):
   - create a disposable vehicle in the live workspace with a registration starting `UAT-`, unassigned, and note its id;
   - add `UAT_EXPECTED_DEPLOYMENT_HOST`, `UAT_EXPECTED_COMMIT_SHA`, `UAT_FIXTURE_VEHICLE_ID` and a read-only-scoped `VERCEL_TOKEN` to the gitignored `.env.uat.local`;
   - take the encrypted backup (see "Backup before UAT");
   - close other TaxiFlow sessions during the run.
   The runner will still refuse if any check fails.
2. Run the PR #2 Preview acceptance below on that Preview. In addition to the listed gates, check `appUsers` membership and role boundaries per role: Owner, Admin, Manager, Driver (own records only), and Viewer (demo-only). Also check the Reports access rules (Owner/Admin/Manager with Money access; Driver/Viewer never). Supabase Auth succeeding is not enough on its own.
3. Parked, not part of this gate: the mock/demo "profile-only driver can still sign in locally" gap (see `current-status.md`).

Still blocked or out of scope for this gate: tenant/database isolation (not implemented); `workspace_snapshots` open to every authenticated user via `using (true)`; `anon`/`authenticated` `TRUNCATE` and full grants on 9 tables (RLS does not govern `TRUNCATE`; revoke explicitly in a later, reviewed migration); the held `appUsers` migration; no isolated database for migration/restore drills.

### Backup before UAT (approach; not yet executed)

A local Node script (no new packages) reads `SUPABASE_URL` and the service-role key from the gitignored `.env.uat.local` at runtime, never printing them or passing them as arguments. It selects the `taxiflow-live` row (`snapshot`, `updated_at`) and an auth user list (id, email, created_at only). It writes JSON to stdout, piped straight into `gpg --symmetric --cipher-algo AES256` (passphrase at the prompt), producing `C:\Users\appri\taxiflow-recovery\backups\<timestamp>.json.gpg`. Nothing plaintext touches disk; the folder is accessible only to the user, SYSTEM and Administrators. The manifest stores only SHA-256, `updated_at`, top-level key names and per-key item counts. Passwords cannot be exported, so a restore needs password resets.

Isolated-restore blocker: no Docker, Supabase CLI or psql (Windows or WSL); no dedicated test project; the Free org already has 2 active projects; branching is not available on Free. Restore stays unverified until Tebogo provides a slot (pause a project, or upgrade) or installs Docker Desktop.

### Preview acceptance plan (Tebogo, after push and backup)

1. Owner sign-in on the Preview, then hard refresh: still signed in as Owner.
2. Save/refresh: one disposable, clearly named change (e.g. a UAT-tagged route note), then hard refresh: it persists; remove it afterwards.
3. Finance on a disposable R 1 record: pending → counted → verified with a refresh after each step. A second management user verifies if available. Banked only on an isolated workspace, otherwise not run. Delete the record and check residue (finance, audit, vehicle odometer).
4. Password recovery: "Forgot password?" for a test account whose inbox Tebogo controls (not the Owner, unless deliberately). Email arrives, the link returns to an allowed Preview origin, update, sign out, sign in with the new password.
5. Membership and roles (read-only checks): an Auth user without an active `appUsers` record is refused; Admin/Manager see only their granted modules; Reports only for Owner/Admin/Manager with Money; Driver sees own records; Viewer stays demo-only. No destructive or bypass security tests on live.

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