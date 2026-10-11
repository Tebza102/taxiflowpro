# Change Log

Record every meaningful project change.

## Template

### YYYY-MM-DD HH:MM — Change Title

**Changed by:** Human/Agent/Tool

**Files changed:**
- file path

**Summary:**
What changed and why.

**Tests run:**
- test/check

**Result:**
Pass/Fail/Not run

**Risks remaining:**
- risk

**Next action:**
- action

### 2026-05-31 15:30 - Creative Skills Library Upgrade (Frontend + 3D)

**Changed by:** Codex

**Files changed:**
- project-os/09-agent-skills/frontend-design-skill.md
- project-os/09-agent-skills/3d-design-skill.md
- project-os/09-agent-skills/ui-design-skill.md
- project-os/09-agent-skills/graphic-design-skill.md
- project-os/09-agent-skills/reference-art-direction-skill.md
- project-os/09-agent-skills/video-generation-skill.md
- project-os/09-agent-skills/video-editing-skill.md
- project-os/09-agent-skills/digital-stationery-design-skill.md
- TEMPLATE_MANIFEST.json
- README.md

**Summary:**
Added dedicated frontend design and 3D design skills, updated related creative skills to enforce anti-generic output rules and 3D decision flow, and refreshed template manifest and README metadata.

**Tests run:**
- Verified new skill files exist in `project-os/09-agent-skills`
- Verified `TEMPLATE_MANIFEST.json` version and file count
- Verified no source application code files were added or modified

**Result:**
Pass

**Risks remaining:**
- Existing users of previous verbose skill versions may need a quick review to align wording with this updated concise format.

**Next action:**
- Run a simulated prompt set against the updated skills to validate instruction quality and coverage.

### 2026-05-31 16:05 - Skills Library Upgrade v1.4 (Video-To-Website)

**Changed by:** Codex

**Files changed:**
- project-os/09-agent-skills/video-to-website-skill.md
- project-os/09-agent-skills/frontend-design-skill.md
- project-os/09-agent-skills/video-generation-skill.md
- project-os/09-agent-skills/video-editing-skill.md
- project-os/09-agent-skills/3d-design-skill.md
- project-os/09-agent-skills/reference-art-direction-skill.md
- TEMPLATE_MANIFEST.json
- README.md

**Summary:**
Added a dedicated video-to-website skill for scroll-driven canvas storytelling workflows and cross-referenced it across frontend, video, 3D, and reference skills. Updated template version metadata to v1.4.

**Tests run:**
- Verified new skill file creation
- Verified cross-reference insertion in targeted skill files
- Verified manifest version/file count
- Verified documentation-only scope

**Result:**
Pass

**Risks remaining:**
- `project-os/10-prompts/master-codex-operating-prompt.md` was requested for update in source instructions but does not exist in this template.

**Next action:**
- Add the missing master operating prompt file to `project-os/10-prompts` if future prompt-level integration is required.

### 2026-08-16 15:45 — Apprigate Development Contract Lock

**Changed by:** ChatGPT via GitHub connector

**Files changed:**
- `AGENTS.md`
- `project-os/00-start-here/current-status.md`
- `project-os/00-start-here/next-action.md`
- `project-os/08-logs/change-log.md`

**Summary:**
Locked the Birdie-style contract-driven development pattern into TaxiFlow PR #2 without changing application logic. Added a root agent contract, replaced stale Project OS placeholders with the actual release state from PR #2, and reduced the next task to one explicit release-validation gate. The contract makes Project OS authoritative, requires evidence-based smallest-change execution, limits user interruptions, defines a controlled deviation rule, and requires truthful test/handoff status.

**Tests run:**
- Confirmed the files were written to `agent/owner-first-auth-reset`.
- Cross-checked the recorded status and release gates against the current draft PR #2 description.
- No application source code was changed, so application tests were not rerun for this documentation/control-layer change.

**Result:**
Pass — control layer installed on the TaxiFlow feature branch.

**Risks remaining:**
- The contract is not yet on `main`; it will become the repository default only when an approved branch containing it is merged.
- The effectiveness test still requires the next coding-agent run to follow the short instruction from Project OS and complete the release gate without unnecessary scope expansion or user loops.

**Next action:**
- Give the coding agent a short instruction to finish the current TaxiFlow release gate from Project OS, then compare its execution quality and interruption count with the Birdie workflow.

### 2026-10-09 21:40 — Docs fast-forward and local baseline re-verification

**Changed by:** Claude Code (agent)

**Files changed:**
- `project-os/00-start-here/current-status.md`
- `project-os/00-start-here/next-action.md`
- `project-os/08-logs/change-log.md`
- Git: `git merge --ff-only origin/agent/owner-first-auth-reset` (`bf440dd` → `ad9641e`, docs only, no overlap with uncommitted work)

**Summary:**
Fast-forwarded the inspected docs commits, followed the `AGENTS.md` preflight, and re-ran the local suites against HEAD plus the uncommitted Reports/PDF work. `project-brief.md` and the `04-technical` / `06-quality/test-plan.md` files are still unfilled templates, so code and test evidence were treated as authoritative. No product code, live data or deployment was changed.

**Tests run:**
- `node --test tests/*.test.mjs` — 237/237 pass (163 committed + 74 Reports/PDF/access)
- `npm run test:sync-guards` — pass
- `npm run build` — pass
- `npx playwright test` (4 mock specs) — 24 pass, 3 fail; the same 3 fail on a clean export of committed HEAD
- Preview/live UAT — not run

**Result:**
Partial — Node suite and build pass; 3 browser tests fail (1 product defect, 2 stale tests).

**Risks remaining:**
- Admin Money view crash in mock mode.
- Every authenticated user can read and write the whole snapshot; `anon` holds `TRUNCATE` grants.
- Reports/PDF work still uncommitted (checkpoint exists outside the repo).
- No isolated database for migration or restore testing.

**Next action:**
- See `next-action.md` → Immediate Next Step.

### 2026-10-09 22:00 — Fix mock-mode Money crash and realign driver opt-in tests (uncommitted)

**Changed by:** Claude Code (agent)

**Files changed:**
- `src/App.jsx` (one expression: Delete entry label in the hand-in queue)
- `tests/driver-visibility.spec.js` (new regression test)
- `tests/module-smoke.spec.js` (two add-driver tests)
- `project-os/00-start-here/current-status.md`, `next-action.md`, `08-logs/change-log.md`

**Summary:**
Root cause: driver day cash-ups in the verification queue intentionally have no linked income record (`sourceRecord === null`). The Delete entry label read `sourceRecord.id` without the `isDriverCashUp` guard that the button's `disabled` expression already used, so Money crashed into the error boundary for any role once a cash-up was queued (regression from `d8dd0ba`). Guarded the label with the existing discriminator. Updated the two add-driver tests to the Owner-only explicit login opt-in from `fb5bb9e`; product behaviour unchanged.

**Tests run:**
- New regression test fails on unfixed committed code (`null.id` crash) and passes after the fix.
- `npx playwright test tests/module-smoke.spec.js tests/driver-visibility.spec.js tests/driver-quick-actions-mobile.spec.js tests/reports.spec.js` — 28/28 pass
- `node --test tests/*.test.mjs` — 237/237 pass
- `npm run test:sync-guards` — pass; `npm run build` — pass
- Preview/live UAT — not run

**Result:**
Pass (local, mock mode). Not committed.

**Risks remaining:**
- In mock mode, a profile-only driver can sign in with the shared demo password (product decision needed).
- `src/App.jsx`, `tests/module-smoke.spec.js` and `tests/driver-visibility.spec.js` mix fix hunks with earlier uncommitted work; they must be staged by hunk.

**Next action:**
- `next-action.md` → step 4 (commit groups a–e).

### 2026-10-09 22:35 — Local commits of verified work (not pushed)

**Changed by:** Claude Code (agent)

**Commits (on `ad9641e`):**
- `a424d84` Fix Money crash when a driver day cash-up is in the hand-in queue
- `00df61a` Add Daily Finance Report preview/PDF and server-side module access policy
- `78d44c2` Align module-smoke add-driver tests with the Owner-only login opt-in
- `9cc33fa` Add Preview UAT release-gate tooling and stop tracking generated test output
- Project OS documentation (this entry)

**Summary:**
Staged by hunk with `git apply --cached` (and a hand-built index blob for `package.json`, whose `pdfkit` and `uat:preview` lines share one hunk). Each code/test commit's staged tree was exported to a temporary directory with `node_modules` linked as a junction (removed link-only after a reparse-point check) and tested there. One grouping was corrected from evidence: the `module-smoke` `setModuleAccess` helper and its call sites belong with the module-access commit. On the old code the Owner's switch-off was OR-ed back on, so the blind clicks only began failing once `00df61a` honours it. Commit A's message was amended locally, with the same tree, to say this accurately. Added a signed-variance short/over report test (−20 / +30). Added `testIgnore: ["**/uat/**"]` to the mock Playwright config so the live UAT spec is never collected.

**Tests run:**
- Per-commit staged trees: A — Node 163/163, build, `driver-visibility` 6/6; B — Node 238/238, sync guards, build, Playwright 24 pass with only the 4 module-smoke tests fixed in later hunks failing (2 after regrouping; both stale since `fb5bb9e`); C — `module-smoke` 12/12; D — `node --check` on UAT files, the default config lists 28 tests in 4 files with no UAT spec.
- Final committed code: `node --test tests/*.test.mjs` 238/238; `npm run test:sync-guards` pass; `npm run build` pass; mock Playwright 4 spec files 28/28.
- Preview/live UAT: not run.

**Result:**
Pass (local). Not pushed.

**Risks remaining:**
- Commits are not on the remote or Preview yet.
- Live access risks (snapshot `using (true)`, anon `TRUNCATE` grants), the held `appUsers` migration, missing tenant isolation and no isolated database are all unchanged.
- The demo-only profile-login gap is parked.

**Next action:**
- `next-action.md` → Immediate Next Step 1 (push on Tebogo's go-ahead).
### 2026-10-09 22:53 — Push attempt blocked; Preview UAT inventory and backup plan

**Changed by:** Claude Code (agent)

**Files changed:**
- `project-os/00-start-here/current-status.md`, `next-action.md`, `08-logs/change-log.md` (uncommitted, so a push sends exactly `628121b`)

**Summary:**
Pre-push checks passed: HEAD `628121b`, clean tree, remote `ad9641e`, fast-forward. Vercel `productionBranch` is `main`, and production is `dpl_4jTd32em9vAqNLNvgPe7YpekSefD` @ `008ce8e`. `git push origin agent/owner-first-auth-reset` was refused by the agent's permission policy, so nothing was pushed and no Preview was built. Inspected the UAT runner and spec without running them, documented their live writes and residue gaps, and wrote a backup approach (gpg AES-256, no plaintext on disk) and an acceptance plan.

**Tests run:**
- None (no code change). Live UAT was not run.

**Result:**
Blocked — push needs Tebogo to run it or grant the permission.

**Risks remaining:**
- The Preview's Supabase project is unverified.
- UAT writes to the live project; the residue check is finance-only.
- The production guard only knows `taxiflowpro.vercel.app`.

**Next action:**
- `next-action.md` → Immediate Next Step 1.

### 2026-10-09 23:11 — UAT tooling safeguards (uncommitted)

**Changed by:** Claude Code (agent)

**Files changed:**
- `scripts/uat/lib/safeguards.mjs` (new)
- `scripts/uat/run-preview-uat.mjs` (rewritten around injectable I/O; all writes after the target, baseline and fixture checks)
- `tests/uat/preview.spec.js` (fixture vehicle by id; stop on live conflict or queued save)
- `playwright.uat.config.mjs` (refuses direct runs without the runner's preflight flag)
- `tests/uat-safeguards.test.mjs` (new, 26 mock-only tests)
- Project OS status, next-action and this log

**Summary:**
Recorded the verified push (`628121b` on origin; Preview `taxiflowpro-lapropkuh-apprigate.vercel.app`; production still `008ce8e`). UAT now refuses production hosts and aliases, moving aliases, unverified deployments (Vercel API: target, READY, project, commit, production id and aliases) and non-disposable fixtures before any write. It fingerprints the workspace and Auth ids at each stage, stops on unexpected changes or another writer, sorts the final diff into retained, residue and unexpected, never writes or restores a whole snapshot, and reports banked as NOT TESTED.

**Tests run:**
- `node --test tests/uat-safeguards.test.mjs` — 26/26
- `node --test tests/*.test.mjs` — 264/264
- `npm run test:sync-guards` — pass; `npm run build` — pass
- `npx playwright test --list` — 28 mock tests in 4 files (UAT spec not collected)
- Live UAT — not run

**Result:**
Pass (local, mocks only). Not committed, not pushed.

**Risks remaining:**
- Production detection depends on the Vercel API and a token. Without them the runner refuses (fail-closed); the static host list is only a backstop.
- Mid-suite conflicts are caught through the app's own banners. A writer that changes nothing the UI reports, and the residue it leaves, is caught only by the final diff, after the write.
- Legacy-record normalisation on the first UI save may show up as "unexpected" changes (a real side effect, reported rather than masked).
- The runner's preflight flag guards against accidental direct runs, not deliberate misuse.

**Next action:**
- `next-action.md` → 1a/1b.

### 2026-10-09 23:26 — Safeguards committed; isolated local database prepared (not installed)

**Changed by:** Claude Code (agent)

**Commits (local, not pushed):**
- `105e3385ef9f9f6c022bd7aef9c34c7a9e215ee0` Make Preview UAT refuse unsafe targets and fixtures before any live write
- `924ec70f9ae41da6ef57cca644ee19691d475cdc` Record verified Preview push, UAT inventory and safeguards in Project OS

**Files changed (uncommitted):**
- `project-os/05-build/local-supabase-setup.md` (new), `current-status.md`, `next-action.md`, this log

**Summary:**
Read-only machine check:
- Windows 11 Home 26H2 build 26300; WSL 2.7.10 with Ubuntu on WSL 2; virtualization on.
- 15.3 GB RAM, but only 1.1 GB free at check time; 209.7 GB disk free.
- LanmanServer running/automatic; user is a local admin (not elevated); no pending reboot.
- No Docker or Supabase CLI.

From the official Supabase CLI and Docker Desktop docs, wrote the shortest setup: per-user Docker Desktop on WSL 2, a pinned `npx supabase` CLI in a folder outside the repo, analytics off, baseline schema as a migration. Also wrote the post-setup verification list. Nothing installed.

**Tests run:**
- None new. The committed tooling is byte-identical to the content that passed 264/264 at 23:09.

**Result:**
Prepared. Installation is a human step.

**Risks remaining:**
- Docker's requirement list names Pro/Enterprise/Education. Home is described as Linux-containers-only, which suffices but is not explicitly listed.
- Low free RAM.
- Docker licence eligibility to be confirmed by Tebogo.
- Restore drill still unverified; live access risks and tenant isolation unchanged.

**Next action:**
- `next-action.md` → 1c.

### 2026-10-10 00:58 — Docker Desktop installed per-user (not yet started)

**Changed by:** Claude Code (agent), authorised by Tebogo. Machine change only; no repo code, database or live project touched.

**Steps (times SAST):**
- 2026-10-09 23:41 — Preflight: 15.3 GB RAM, 0.4 GB free, about 5 GB commit headroom. Excel, Word and OneNote were open (possible unsaved work), so nothing was closed and no restart was made.
- 23:42 — Official source: Docker Desktop 4.94.0, build 241994 (release notes, 2026-10-05). Downloaded `https://desktop.docker.com/win/main/amd64/241994/Docker%20Desktop%20Installer.exe` (635,493,296 bytes) and the build's `checksums.txt` into `C:\Users\appri\Downloads\docker-desktop-4.94.0-241994\`.
- 23:45 — Verified: SHA-256 `a9814e31049d66156477a86614e83365669677733014ec72f74229623ff3890a` matches Docker's `checksums.txt`. Authenticode Valid, signer "Docker Inc" (DigiCert Trusted G4 Code Signing CA1), timestamped. File/product version 4.94.0.241994.
- 23:46 — Ran `Docker Desktop Installer.exe install --user --backend=wsl-2 --no-windows-containers`. Deliberately **no** `--accept-license`, no `--always-run-service`, no TCP 2375 exposure.
- 23:48 — Install log `%LOCALAPPDATA%\Docker\install-cli-log.txt`: CLI plugins installed, no errors. The installer then waited on its "Installation succeeded / Close" screen. That screen, not a Windows UAC prompt, held the task open.
- 2026-10-10 00:58 — Installer window closed (not by the agent); exit code 0. Install dir `%LOCALAPPDATA%\Programs\DockerDesktop`; `docker --version` → 29.8.2 (build 7fc2dff).

**Not done yet:**
- Docker Desktop not started.
- Subscription Service Agreement not accepted (Tebogo must review and accept it).
- `docker run --rm hello-world` not run.
- Supabase not initialised; no database changed.

**Risks remaining:**
- About 0.4–0.8 GB free RAM. Starting the WSL 2 VM needs several GB; save open Office work first.

**Next action:**
- Tebogo saves work and confirms. The agent launches Docker Desktop; Tebogo accepts the terms; the agent runs `hello-world` and logs engine status.

### 2026-10-10 01:06 — Docker Desktop started; terms accepted by Tebogo; hello-world passed

**Changed by:** Tebogo (terms acceptance) and Claude Code (launch and checks). Machine only; no repo code, database or live project touched.

**Steps (SAST):**
- 01:03 — Memory check after Tebogo saved work and closed apps: 1.9 GB free, 12 GB commit headroom (was 0.4 / 5 GB).
- 01:03 — Agent launched `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`. The agent did not click anything in the Docker window.
- 01:05:29 — Engine became ready after Tebogo reviewed and accepted the Docker Subscription Service Agreement in the Docker Desktop window. Docker's docs say Desktop does not run until the terms are accepted; the settings file holds no readable acceptance field, so this is behavioural evidence.
- 01:05:49 — First `docker run --rm hello-world` failed (exit 127): `docker-credential-desktop` not on `%PATH%`. Cause: the agent's shell predates the install. The installer had added `...\DockerDesktop\resources\bin` to the user PATH, and the helper exists. No setting was changed.
- 01:06:06 — Re-ran with that folder prepended to PATH for the command only. Pulled `hello-world:latest` (digest `sha256:5e23090353324d887c48ad5e5c56d294eab81588df9605b07d1afe895f9cc8f8`); printed "Hello from Docker!"; exit 0; no leftover containers (`--rm`).

**Engine status:** client and server 29.8.2; context `docker-desktop`; `linux/amd64`; WSL 2 kernel 6.18.33.2-microsoft-standard-WSL2; 8 CPUs; about 7.4 GiB memory to the VM. TCP port 2375 not listening; no TCP-expose setting.

**Not done:** Supabase not initialised; no database changed.

**Next action:**
- `project-os/05-build/local-supabase-setup.md` steps 4–8, on Tebogo's go-ahead. Open a new terminal first so the Docker PATH entry is loaded.

### 2026-10-10 01:39 — Local Supabase initialised; blocked on loopback-only port binding (stack stopped)

**Changed by:** Claude Code (agent). Local machine and repo files only. No hosted database, Auth, DNS, push or deploy.

**Steps (SAST):**
- 01:21 — Preflight; the runner file showed no diff. Docker was down: Desktop had idle-shut down at 01:11 ("efficiency mode"). Restarted once; engine ready 01:22:44.
- 01:22 — Supabase CLI: npm latest = 2.120.0 (pinned); read `init`/`db reset` help and the config docs.
- 01:23 — Read the live table definition only (columns, PK, FK to auth.users, PostgreSQL 17.6). The code uses only `workspace_snapshots`.
- 01:24 — `supabase init --workdir C:\Users\appri\taxiflow-localdb`. Disabled analytics (the generated config had it **on**, despite the docs' default), edge runtime, realtime, storage and Studio. Migrations created with `supabase migration new`.
- 01:28–01:32 — `supabase start` (image pulls about 4 min): 3 migrations and the synthetic seed applied.
- 01:32:53 — `node scripts/localdb/verify.mjs`: 11 PASS / 1 WARN (live-mirror policies) / **1 FAIL (ports on 0.0.0.0/[::])**. Stopped the stack at 01:34:20.
- 01:34 — Created `taxiflow-localdb-loopback` (bridge, `host_binding_ipv4=127.0.0.1`); scripts now pass `--network-id` and refuse to run without it. Restarted 01:35:20: **still 0.0.0.0/[::]**. Stopped 01:36:31.
- 01:37 — Diagnosis with an alpine container: Docker Desktop ignores the network default for an unspecified HostIp; an explicit `127.0.0.1:` binding works. Two failed attempts, so changes stopped. Diagnostic container and image removed.
- 01:38 — `node --test tests/*.test.mjs` 273/273 (includes 9 new local-guard tests); sync guards and build pass. Scan: no keys or live URLs in the new files.

**Drill:** NOT run (stack must stay stopped until the binding decision). Once run, it covers snapshot (phase A) and schema-from-migrations (phase B). Auth is excluded by design: phase B shows the `updated_by` FK fails with no Auth users.

**Files (uncommitted):** `scripts/localdb/**`, `tests/localdb-guard.test.mjs`, `project-os/05-build/local-supabase-setup.md`, `current-status.md`, `next-action.md`, this log.

**Next action:** Tebogo picks a binding option (`local-supabase-setup.md` → Binding blocker).

### 2026-10-10 02:04 — Local Supabase on Docker Compose (loopback-only); synthetic drill passed for schema, Auth and snapshot

**Changed by:** Claude Code (agent). Local machine and repo only. No hosted, live, global Docker or firewall changes.

**Steps (SAST):**
- 01:48 — Preflight: Docker 29.8.2 up; reused the 5 images the CLI pulled; nothing new downloaded.
- 01:49 — Preserved first: `supabase_db_taxiflow-localdb` archived (7.9 MB, 1,521 entries, SHA-256 `07deac3a…5411`) plus a copy of the CLI config. The volume itself is kept.
- 01:50–01:53 — Compose stack (`scripts/localdb/compose`) with explicit `127.0.0.1:54321/54322/54324` ports, Kong template and official-style db-init. Two evidence-based fixes:
  - `supabase_functions_admin` is absent from image 17.11.0.004, so roles.sql now alters only existing roles;
  - the Kong placeholder replace only hit the first occurrence, so it now uses `replaceAll` plus a placeholder guard.
- 01:54 — `setup.mjs reset`: 3 migrations and the seed applied. Bindings: exactly 3 loopback mappings. Windows listeners: 127.0.0.1 only.
- 01:54 — `verify.mjs`: 14 PASS, 1 WARN (flagged policies), 0 FAIL.
- 01:56 — `drill.mjs`: snapshot-before-Auth refused by the FK (incomplete-recovery evidence). Auth users and identities, then the snapshot, restored; all checks MATCH; 5/5 synthetic sign-ins; anon denied.
- 01:58 — Found that the CLI still runs with config.toml merely absent (it falls back to defaults). Fixed with an invalid sentinel config.toml enforced by the guard and `prepare`; `supabase status` now fails with `CliConfigParseError`. Removed the unused `taxiflow-localdb-loopback` network.
- 02:00 — Final drill and verify on the final code: both pass.
- 02:01 — `node --test tests/*.test.mjs` 278/278 (14 local-guard tests); sync guards and build pass; 28 mock specs listed; secret scan clean.

**Coverage:** schema (rebuilt from migrations), Auth (users + identities incl. password hashes), snapshot. **Not covered:** Auth sessions/tokens/MFA/audit, storage, hosted configuration, any live restore.

**Next action:** `next-action.md` → 1e.

### 2026-10-10 02:54 — Tenant database foundation (local synthetic only; branch agent/tenant-db-foundation)

**Changed by:** Claude Code (agent). No hosted, push, deploy or live data.

**Steps (SAST):**
- 02:34 — Preflight; branched `agent/tenant-db-foundation` from `7fe64a7` (the release branch is unchanged).
- 02:35 — Design: `project-os/04-technical/tenant-design.md`.
- 02:36 — Wrote the migration `20261010003451_tenant_foundation.sql` and its rollback; tenant fixtures (business B, owner-driver, inactive, non-member, new-hire identities). `setup.mjs reset` now applies the tenant migration on top of legacy data.
- 02:37 — Reset OK. Confirmed `postgres` has bypassrls and owns the tables, so there is no policy recursion.
- 02:39 — `tenant-tests.mjs access`: 33/33.
- 02:42 — `tenant-tests.mjs rollback`: 7/8. The one failure was a test bug (`order by 1` in `string_agg`); after the fix, 8/8.
- 02:44 — Updated `verify.mjs` (16/16, 0 WARN) and `drill.mjs` (tenant-aware; PASS).
- 02:48–02:53 — Final sequence on the committed code: reset, access 33/33, rollback 8/8, verify 16/0/0.
- 02:53 — `node --test tests/*.test.mjs` 285/285 (7 new static tenant tests); sync guards and build pass; secret scan clean.

**Integration gaps:** API routes, `dataGateway` direct access, `userLifecycle` membership management, hosted migration plan. See `tenant-design.md`.

**Next action:** `next-action.md` → 1f.

### 2026-10-10 08:08 — Tenant-aware server authorization (local only; Task 12)

**Changed by:** Claude Code (agent). Local synthetic environment only; no push, hosted, live or deploy.

**Steps (SAST):**
- 07:46 — Preflight: branch `agent/tenant-db-foundation` @ `248a662`, tree clean.
- 07:47 — Revoked `service_role` (plus `public`/`anon`) EXECUTE on `set_business_membership` and `is_active_member`. After reset the ACL is `postgres=X/postgres authenticated=X/postgres`; `service_role` false. Marked the rollback "NOT A PRODUCTION RECOVERY PROCEDURE".
- 07:48 — `api/_lib/tenantAuth.js`: token validation, caller-token membership read, explicit business selection, service role only after authorization. `snapshotLoader` rebuilt on it with role-scoped projection and no `taxiflow-live` fallback; appUsers-based `resolveRequester` removed; report preview meta includes `businessId`.
- 07:50 — Report tests rewritten (stand-in Supabase serves memberships and gates snapshot reads on the service key): 35/35.
- 07:51 — Synthetic finance records lacked `type`/`incomeKind`, so no report could be built; added them.
- 07:53 — `server-auth-tests.mjs` hit a **real Task 11 defect**: the reassignment trigger named `new.user_id` in a combined expression, so every legitimate snapshot update failed. Fixed with per-table branches; added positive regression tests.
- 07:56 — `server-auth-tests.mjs`: 26/26.
- 07:56–08:04 — Final local sequence: reset, tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, drill PASS. ACL rechecked after re-apply.
- 08:05 — `node --test tests/*.test.mjs` 289/289; sync guards and build pass; `playwright test tests/reports.spec.js` 9/9 (mock); secret scan clean.

**Lessons:** pair every denial test with a legitimate write of the same object; synthetic fixtures must match the real record contract (report lookup needs `type: income`, `incomeKind: standard`).

**Gaps:** server write endpoint, membership-based user lifecycle/bootstrap, frontend gateway, hosted plan. See `tenant-design.md`.

**Next action:** `next-action.md` → 1g.

### 2026-10-10 08:43 — Scoped server finance writes (local only; Task 13)

**Changed by:** Claude Code (agent). Local synthetic environment only; no push, hosted, live or deploy.

**Steps (SAST):**
- 08:30 — Preflight: `agent/tenant-db-foundation` @ `2b18e2f`, tree clean. Mapped the existing finance save operations and roles (`src/App.jsx`, `src/lib/appRuntime.js`).
- 08:31 — Migration `20261010063144_finance_actions.sql`: `finance_action_requests` log plus the atomic `commit_finance_action` (service_role only). Rollback added.
- 08:32 — `api/_lib/financeActions.js` (validation, roles, transitions, server actor/audit) and `api/business/finance-actions.js` (tenantAuth → load → replay check → apply → atomic commit).
- 08:33 — Synthetic fixtures made workflow-consistent (pending day cash-up, expected 700; a second driver day; Business B with its own cash-up and driver), keeping all four statuses present.
- 08:34 — `tests/finance-actions.test.mjs` 7/7.
- 08:35–08:41 — `node scripts/localdb/finance-action-tests.mjs` 37/37 on the first run.
- 08:42 — `node --test tests/*.test.mjs` 296/296; sync guards and build pass; secret scan clean.
- 08:43–08:59 — Regression on fresh resets: finance actions 37/37, tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26, drill PASS (schema, Auth, tenants, snapshots).

**Supported:** `cashup.submit`, `cashup.record_handin`, `cashup.verify`. **Not yet:** capture, standalone count/verify, `lockDeposit`, edit/delete.

**Next action:** `next-action.md` → 1h.

### 2026-10-10 09:27 — Owner-driver submit and scoped banking (local only; Task 14)

**Changed by:** Claude Code (agent). Local synthetic environment only; no push, hosted, live or deploy.

**Steps (SAST):**
- 09:03 — Preflight: `agent/tenant-db-foundation` @ `c39d0ef`, tree clean. Read the existing `lockDeposit` rules.
- 09:04 — `cashup.submit` accepts Driver or Owner and requires the membership driver linkage. `deposit.lock` added (exact reviewed batch, existing amount formulas, server-generated deposit, reference and audit, one atomic commit). Owner-driver fixture added in Business B.
- 09:05 — Unit tests 9/9. A test assumed no standalone verified record existed in the fixtures; the test was corrected, not the code.
- 09:07–09:16 — `finance-action-tests.mjs` on a fresh reset: 56/56.
- 09:16–09:19 — Drill now exports and restores `finance_action_requests`: PASS, request log 5 rows MATCH.
- 09:20 — Node 298/298; sync guards and build pass; secret scan clean.
- Regression: 09:20–09:27 on fresh resets: tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26.

**Next action:** `next-action.md` → 1i.

### 2026-10-10 10:13 — Scoped finance capture (local only; Task 15)

**Changed by:** Claude Code (agent). Local synthetic environment only; no frontend, push, hosted, live or deploy.

**Steps (SAST):**
- 09:39 — Preflight @ `d4cb5c4`; mapped `saveStandardIncome`/`saveSpecialIncome`/`saveExpense` (validation, calculations, associations, permissions).
- 09:41 — `appRuntime.js` cannot load in Node. Wrote `api/_lib/financeCapture.js`: the shared `analytics.js` maths plus mirrored field helpers, SAST timestamps, mode/association/closed-day rules, request-derived record ids. Wired into `financeActions`.
- 09:42 — Removed caps I had added that the app does not have (odometer jump, passenger count, leg count): no invented rules.
- 09:43 — `tests/finance-capture-parity.test.mjs` (Vite SSR loads the real browser helpers): 5/5.
- 09:44–09:53 — `finance-capture-tests.mjs` on a fresh reset: 43/43 on the first run.
- 09:54 — Unit 4/4; Node 307/307; sync guards and build pass; secret scan clean.
- Regression: 09:55–10:13 on fresh resets: finance actions 56/56, drill PASS (request log 5 rows MATCH), tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26.

**Next action:** `next-action.md` → 1j.

### 2026-10-10 11:05 — Essential finance server actions complete (local only; Task 16)

**Changed by:** Claude Code (agent). Local synthetic environment only; no frontend, push, hosted, live or deploy.

**Steps (SAST):**
- 10:16 — Preflight @ `a47202f`. Mapped standalone `verifyIncome`, `deleteTransaction` and `buildDriverRecordEditTracking`.
- 10:18 — Capture builders take an edit context. `api/_lib/financeRecordActions.js`: standalone count/verify, edit, delete. Wired into `financeActions`. Standalone pending fixture added.
- 10:20–10:28 — `finance-record-tests.mjs` 32/36: the edit field-list defect (forged `status` accepted) plus one test expectation.
- 10:29–10:37 — Fixed; 36/36.
- 10:38 — Unit 4/4; Node 311/311; sync guards and build pass; secret scan clean.
- Regression: 10:39–11:04 on fresh resets: capture 43/43, finance actions 56/56, drill PASS (request log MATCH), tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26.

**Next action:** `next-action.md` → 1k.

### 2026-10-10 12:50 — Tenant-aware frontend finance workflow (local only; Task 17)

**Changed by:** Claude Code (agent). Local synthetic environment only. No push, hosted change, live UAT or deploy. The task overran its 60-minute boundary. Tebogo asked for a checkpoint; verification was finished without adding scope.

**Steps (SAST):**
- Preflight @ `9dc79ae`.
- Server read endpoints:
  - `api/business/memberships.js` and `workspace.js` (authoritative self role, version, actor names);
  - `api/_lib/actorNames.js` (members of the authorized business only; `authUserId` tag used by the daily report).
- Browser: `src/lib/tenantWorkspace.js`, plus gateway and App changes behind `VITE_TENANT_MODE`. See `tenant-design.md` → Task 17.
- Defects found in the browser proof, each fixed once from evidence:
  1. The identity gate required a JWT metadata role. It now uses the membership role in tenant mode.
  2. Reverting local edits clashed with the driver-terminal view sync. The view state is now allowed locally.
  3. "Refresh live data" unmounted the form and lost the draft. Tenant mode now refreshes in place.
  4. A multi-business user hit "Account not mapped" before choosing a business. A business picker was added.
- Test-only corrections:
  - widened the source windows and moved the markers in `tests/finance-persistence.test.mjs` (the tenant branches shifted the legacy code);
  - wording and selectors in the new spec;
  - a wait for the reload before the retry save.

**Tests run:**
- Browser proof (`playwright.localdb.config.mjs`) on a fresh reset: 6/6.
- Node 311/311; build pass; demo-mode Playwright 28/28.
- Local-DB suites on fresh resets: server auth 27, finance actions 57, capture 44, record 37, verify 17 (`PASS` line counts, 0 `FAIL`). Tenant access 36, rollback 9.
- Secret scan clean.

**Result:** Pass.

**Risks remaining:** see `tenant-design.md` → Remaining after Task 17.

**Next action:** `next-action.md` → 1l.

### 2026-10-10 14:15 — Pilot onboarding with authoritative memberships (local only; Task 18)

**Changed by:** Claude Code (agent). Local synthetic environment only. No push, hosted change, live UAT or deploy.

**Steps (SAST):**
- 12:55 — Preflight @ `c54c482`.
- Migration `20261010113000_pilot_onboarding.sql` (+ rollback):
  - last-active-Owner trigger;
  - service-only `create_business_with_owner` and `apply_membership_change`;
  - browser `set_business_membership` withdrawn.
- Code:
  - `api/_lib/tenantOnboarding.js` (Auth find-or-create plus setup email, directory upkeep, actions, driver profiles);
  - `api/business/members.js`;
  - legacy `auth-users`/`bootstrap-workspace` return 410 when `TAXIFLOW_TENANT_MODE=true`;
  - operator `scripts/localdb/onboard-business.mjs`;
  - Settings → Business access (`TenantAccessPanel.jsx`).
- 13:08 — `onboarding-tests.mjs` 64/64 on the first run.
- 13:25 — Browser onboarding spec 1/1. It had one selector fix: a select's label text includes its options.
- Tests moved off the withdrawn RPC to the server route: `server-auth-tests.mjs` and `tenant-tests.mjs` (access). The access no-change check now proves that only Business A's directory changed.

**Tests run (fresh resets):**
- Onboarding 64/64; browser 7/7 (Task 17 finance plus onboarding); server auth 26/26; finance actions 56/56; capture 43/43; record 36/36; verify 16 PASS/0 WARN; tenant access 36/36; rollback 8/8; drill MATCH (snapshots, businesses, memberships, request log, Auth).
- Node 313/313; sync guards and build pass; demo-mode Playwright 28/28.

**Result:** Pass.

**Risks remaining:** `tenant-design.md` → Remaining pilot blockers after Task 18.

**Next action:** `next-action.md` → 1m.

### 2026-10-10 14:55 — Approved TaxiFlow branding (local only; Task 19)

**Changed by:** Claude Code (agent). Local only. No push, hosted change or deploy.

**Steps (SAST):**
- 14:20 — Preflight @ `b2472be` (clean tree).
- Originals saved to `assets/brand/source/`. Source resolution inspected: the symbol image is too small for 512 px icons, so icons use the identical, higher-resolution mark from the approved full logo (compared numerically).
- `scripts/brand/generate-brand-assets.mjs` (ffmpeg) generated the logo, favicon.ico (16/32/48), Apple 180, PWA 192/512 and maskable 192/512 on white.
- References updated: `index.html`, `manifest.webmanifest`, `sw.js` (cache v8), `App.jsx` (sign-in, picker, header), `styles.css` (landscape logo sizing, no drop shadow on the opaque logo), PDF header (72×41.7 pt). Old brand files removed.
- Palette proposed with hex values and contrast ratios; awaiting approval and not applied.
- Found by the branding checks and fixed (not branding defects):
  - the Task 18 business picker overflowed at 375 px;
  - Business access rows ran the name and email together;
  - the tenant bar's business chip overflowed on mobile.

**Tests run:**
- `tests/branding.spec.js` 4/4 (logo proportions desktop/mobile, manifest and Apple icon sizes, white corners, favicon frames, logo in the A4 PDF).
- `tests/localdb-browser/branding-tenant.spec.js` 2/2 (picker, Money, Business access; desktop and mobile).
- Demo suite 32/32; tenant browser 9/9; report PDF/endpoint tests 23/23; Node 313/313; build pass.
- PDF geometry was verified from the content stream; the browser pane could not render a zoomed page.

**Not verified:** installation on a real device, and the home-screen icon on Android or iOS.

**Next action:** `next-action.md` → 1n.

### 2026-10-10 15:30 — Approved palette applied (local only; Task 19 follow-up)

**Changed by:** Claude Code (agent), on Tebogo's approval. Continued from `dc212b7`. No push, hosted change or deploy.

**Summary:**
- Theme tokens, gradients, accents, focus rings and tints moved to the approved palette, as listed in `brand-rules.md`.
- Browser and PWA theme colour is `#0A1925`; manifest background is white; PDF navy and orange updated.
- Layouts and status colours are unchanged.
- The hero stripe was changed to yellow→orange, because navy→yellow blended to olive.
- The quick-action focus ring was raised to 3.18:1.

**Tests run:**
- `tests/branding.spec.js` 5/5, including the new palette check (tokens, theme colours, rendered contrast); tenant branding 2/2.
- Demo suite 33/33; Node 313/313; build pass.
- Screenshots reviewed for login, finance (Money), Business access and reports, on desktop and mobile.

**Outstanding:** PDF page visual inspection; installed-app icons on a real device; optional darker warning text tone.

### 2026-10-10 16:25 — Pilot data loader, hosted release plan and warning contrast (local only; Task 20)

**Changed by:** Claude Code (agent). Continued from `2bc9aa9`. No push, hosted change, DNS/email change or deploy.

**Summary:**
- **Warning tone:** `--warning-text #9B5D00` and `--warning-strong #8A5300` are used for warning text, warning chips and warning badges. Measured: note 5.30:1, chip 5.30–6.33:1. The bright `--warning` is kept for bars and strips.
- **Loader:** `scripts/pilot/business-data-plan.mjs` (planner and atomic writer), `scripts/localdb/load-business-data.mjs` (local CLI), `scripts/localdb/lib/appRuntime.mjs` (the app's normalizers through Vite SSR), `scripts/pilot/business-data.example.json`.
- **Proof:** `scripts/localdb/business-data-load-tests.mjs`.
- **Defect found and fixed:** same-name drivers with distinct staffIds in one input were wrongly refused (the ambiguity check now looks only at existing drivers).
- **Docs:** `project-os/05-build/pilot-business-data.md` (owner checklist, defaults, rules, evidence); `project-os/05-build/release-plan.md` (hosted plan, documents only).

**Tests run:**
- Loader 46/46 (fresh reset).
- Onboarding 64/64 (fresh reset). It fails if run right after the loader tests on the same database, because both create the pilot slugs; this is expected state overlap.
- `tests/branding.spec.js` 6/6 (including warning contrast); demo suite 34/34; Node 313/313; build pass.

**Next action:** `next-action.md` → 1o.

### 2026-10-10 17:55 — Release candidate: live inventory, hosted foundation, rehearsal, cutover and operator procedures (Task 21)

**Changed by:** Claude Code (agent). The hosted project was **read only**: catalogue `SELECT`s through the Supabase connector, metadata only. No hosted write, deploy, push, DNS or email change.

**Summary:**
- **Inventory** (`project-os/05-build/hosted-inventory.md`):
  - 10 public relations (9 tables plus a view);
  - legacy tables with RLS off and anon/authenticated ALL including TRUNCATE;
  - 3 `using (true)` snapshot policies; open default privileges;
  - no functions, triggers or migration history; `20260405` and `20260810` were never applied;
  - all 5 users map, including an Owner.
- **Release files** (`supabase/release/tenant-pilot/01_tenant_foundation.sql`, generated from the tested local core plus `scripts/localdb/hosted-copy/hosted-access.sql`):
  - 02/03 unchanged; 03's revoke of the browser RPC is now conditional;
  - new 04 `20261011090000_assign_initial_owner.sql` (+ local rollback).
- **Rehearsal:**
  - `scripts/localdb/hosted-copy/20261009232600_live_schema_copy.sql` (an exact synthetic live schema);
  - `setup.mjs hosted` and `hosted-pre` (negative control);
  - `scripts/localdb/hosted-rehearsal-tests.mjs`.
- **Operator procedures:**
  - `scripts/pilot/assign-initial-owner.mjs`;
  - guarded hosted CLIs `scripts/hosted/{onboard-business,assign-initial-owner,load-business-data}.mjs` with `scripts/hosted/lib/hosted-target.mjs`;
  - `scripts/localdb/operator-procedure-tests.mjs`;
  - `tests/hosted-target.test.mjs`.
- **Release plan:**
  - verified Supabase key method (new publishable/secret keys, then deactivate the legacy keys; the legacy keys cannot be rotated);
  - credential plan; Vercel lockout and clean-up;
  - first-release recovery (no previous tenant build): maintenance page plus forward fix; the old build is never revived.
- **Expense-only days:** `project-os/05-build/expense-only-days.md`. Cause: the `incomeCount > 0` queue filter. Rule R1–R4 recommended; no code change.
- **Test-only change:** `tenant-tests.mjs` treats PGRST202 (function absent) as a refusal.

**Tests run:**
- **Hosted rehearsal database (fresh build each):** rehearsal 22/22 (files 01–04); negative control fails as designed; server auth 26/26; finance actions 56/56; capture 43/43; record 36/36; onboarding 64/64; loader 46/46; tenant access 36/36; operator 14/14; browser 9/9.
- **Local mode:** operator 14/14; tenant access 36/36; rollback 8/8; onboarding 64/64; server auth 26/26; verify 16/0/0; drill MATCH.
- Node 317/317; build pass; secret scan clean.

**Next action:** `next-action.md` → 1p.

### 2026-10-10 18:40 — Hosted rehearsal decision pack and checklist (Task 22)

**Changed by:** Claude Code (agent). Read-only only: Supabase connector account, project and price lookups; Supabase and Vercel docs; Vercel CLI team read. Nothing was created, purchased, paused, deployed or pushed.

**Summary:**
- **Supabase:** "Apprigate" organisation on the Free plan. Active: TaxiFlow and Birdie Squad (both free slots used). New project in that org: $0, but over the free limit; branch: $0.01344/hour, and only on a paid org.
- **Recommendation:** a separate Pro organisation with one Micro project (about $25/month; the $10 compute credit covers Micro), plus a separate Vercel project for the rehearsal.
- **Vercel:** Hobby plan; the commercial-use check is left for Tebogo.
- **Email and domain:** inputs listed; none assumed.
- **Expense-only days:** refined with funding sources and examples A–D; smallest safe pilot implementation; no automatic payables.
- **Cutover gap fixed:** the old production kept its service_role key until after the migrations. Now: maintenance page, then deactivate the legacy keys (401 verified), then backup and migrations, then `deploy --prod --skip-domain`, smoke test and promote.
- **New-key compatibility:** the rehearsal uses only new keys (its legacy keys are deactivated first). Code review: no key in Authorization headers and no raw REST calls.
- **Checklist:** `rehearsal-cutover-checklist.md` (Part A rehearsal, Authorization A; Part B production, Authorization B).

**Tests run:** none needed (documents only); the tree was clean at the start (`9de3997`).

**Next action:** `next-action.md` → 1q.

### 2026-10-10 19:20 — Decision pack revised: verified Vercel terms, estimates, expense-only wording, two approvals (Task 23)

**Changed by:** Claude Code (agent). Read-only only: Vercel docs fetched (Fair Use Guidelines, Hobby, Pro plan, Pro trial; last updated 2026-09-14/15); Vercel CLI project listing (names only); Supabase docs. No purchase, resource creation, hosted change or deploy.

**Summary:**
- **Vercel commercial use:** Hobby is "non-commercial personal use only", and commercial use (including a paid developer) needs Pro or Enterprise. Production therefore needs Vercel Pro ($20/month, which includes $20 of credit). The `apprigate` Hobby team has 23 projects, including Birdie Squad's, so the rehearsal uses a **new Pro-trial team** (14 days, $0 without a payment method, one per account).
- **Rehearsal price:** stated as an estimate (≈ $25 + tax; ceiling $30 + tax); the Supabase charges outside the spend cap are listed.
- **Expense-only days:**
  - "funding source unconfirmed" replaces the assumed reimbursement;
  - signed variance is preserved;
  - cash to hand in and uncovered cash expenses are separated;
  - zero-cash days close at verified, are not banked, and no R 0 deposit is created.
- **Approvals:** two bounded approvals (A rehearsal, B production after sign-off). Stop conditions: unexpected cost, target mismatch, failed checks, out-of-scope actions. The checklist's per-step approval marks are removed.

**Tests run:** none needed (documents only).

**Next action:** `next-action.md` → 1r.

### 2026-10-10 19:45 — Approval A final amendments (Task 24)

**Changed by:** Claude Code (agent). Documents only; no hosted change, purchase or deploy.

**Summary:**
- **Data:** the first rehearsal uses synthetic businesses, Auth users and finance data. The encrypted production backup stays separate and is not restored. The release-plan rehearsal step is corrected to match.
- **Cost:** Micro compute is incurred (≈ $0.01344/hour) and offset by the $10 included credit. Total ceiling $30 + tax across both providers, checked at creation and daily (new checklist row A19).
- **Zero-cash closure:** the `settlement.closedWithoutDeposit` indicator is set on verified R 0 days; `deposit.lock` excludes them; no R 0 deposit; statuses unchanged. Negative expected cash and signed variance are explained.
- **Vercel trial before purchase:** the trial team is created first; if it's unavailable, stop before any purchase.
- **Evidence and clean-up:** evidence is retained before deletion (A20). Clean-up within 48 hours of sign-off, no later than day 10 (A21).
- **Checklist Part A** rewritten (A1–A21).

**Next action:** `next-action.md` → 1s.

### 2026-10-10 19:45 — Simple three-owner pilot: expense-only handling, PDF inspection, existing-platform release checklist (Task 25)

**Changed by:** Claude Code (agent). Local only. Read-only docs lookups (Supabase). No hosted change, purchase, push, deploy or DNS change.

**Files changed:**
- `src/lib/cashUpContract.js`, `api/_lib/financeActions.js`, `src/lib/appRuntime.js`, `src/App.jsx`
- `api/_lib/dailyFinanceReport.js`, `api/_lib/dailyFinanceReportPdf.js`, `src/components/ReportsPanel.jsx`
- `tests/finance-persistence.test.mjs`, `scripts/localdb/expense-only-tests.mjs` (new)
- `project-os/05-build/pilot-release-checklist.md` (new), `project-os/11-client-delivery/first-owner-onboarding.md` (new)
- release-plan, expense-only-days, the superseded rehearsal decision pack and checklist, current-status, next-action

**Summary:**
- **Expense-only days:**
  - every day with entries is reviewed;
  - cash to hand in and uncovered cash expenses ("funding source unconfirmed") are shown separately; the variance stays signed;
  - zero-cash verified days carry `settlement.closedWithoutDeposit`, are excluded from deposits, and no R 0 deposit is created;
  - statuses are unchanged;
  - a counted or verified day refuses re-submission (no reopening);
  - there is no reimbursement feature.
- **PDF:** rendered and inspected; the closed-day wording was fixed (status, deposit status, chart message).
- **Banking card:** the new label is "Signed variance" (it originally collided with the "Counted" test filter).
- **Release route:** the existing platform, with no rehearsal environment. Blockers:
  - X1: Vercel Hobby is non-commercial;
  - X2: the default SMTP only emails team members;
  - X3: Supabase Free has no automatic backups and can pause.
- **Proposals awaiting approval:** P1 (remove the tenant-mode switch) and P2 (defer release file 04).

**Tests run:**
- unit tests 317/317;
- sync guards pass;
- build OK;
- expense-only integration 32/32;
- finance-action 56/56;
- finance-capture 43/43;
- finance-record 36/36;
- tenant browser suite 9/9;
- demo Playwright 33/34, the one failure being the label collision; after the fix, `driver-visibility` passes 6/6;
- rendered PDF: 2 reports, 1 page each.

**Result:** Pass (local).

**Risks remaining:**
- X1–X3;
- the new keys with the server functions, and `/api/business/*` routing, are proven only on the skip-domain production deployment behind the maintenance page;
- installed-app icons on real devices are still unverified.

**Next action:** `next-action.md` (Task 25).

### 2026-10-10 20:50 — P1: hosted builds always use tenant security; release decisions (Task 26)

**Changed by:** Claude Code (agent). Local only. Read-only checks: Vercel team listing (CLI), DNS and SMTP TLS for apprigate.com, Supabase docs. No hosted change, purchase, push, deploy or DNS change.

**Files changed:**
- `src/lib/securityMode.js` (new), `src/lib/tenantWorkspace.js`, `src/lib/dataGateway.js`, `src/App.jsx` (comment)
- `api/admin/auth-users.js`, `api/admin/bootstrap-workspace.js` (unconditional 410)
- `scripts/localdb/dev-tenant.mjs`, `scripts/localdb/onboarding-tests.mjs` (flags removed)
- `tests/tenant-security-mode.test.mjs` (new), `tests/owner-first-auth-guards.test.mjs`
- `project-os/05-build/pilot-release-checklist.md`, `release-plan.md`, current-status, next-action

**Summary:**
- **Tenant rule:** tenant whenever Supabase settings exist or the build is configured live. The demo build is separate.
- **Legacy direct snapshot functions** fail closed in tenant builds.
- **Legacy admin routes** are always 410.
- **Release file 04 and the migration order are kept;** Owner assignment runs only when no active Owner exists.
- **Release decisions recorded:** X1 (Vercel Pro needed), X2 (existing apprigate.com mail), X3 (daily operator backup procedure; script not built).

**Tests run:**
- unit tests 321/321 (4 new);
- sync guards pass;
- build OK;
- onboarding 64/64, including both legacy routes returning 410 with no flag set;
- operator procedures 14/14, including the refusal when an active Owner exists;
- tenant browser suite 9/9, run with no tenant flag;
- **full demo Playwright suite 34/34**, run once after the final changes.

**Result:** Pass (local).

**Risks remaining:**
- X1 and X2 need authorization; the X3 backup script is not built;
- the legacy production-user scripts are still present;
- new keys with the server functions are proven only at the skip-domain deployment.

**Next action:** `next-action.md` (Task 26).

### 2026-10-10 21:30 — Encrypted operator backup tool and retired legacy user scripts (Task 27)

**Changed by:** Claude Code (agent). Local only. No production backup, hosted change, purchase, push or deploy.

**Base:** `24a58f77f735b3d324c1231fea07bf89231aaa54`.

**Commits:**
- `9f90e8a96331eb9d154930e968c8ce6ebf2e71c6`: backup tool and tests;
- `e6634053e9b4c6ba287fe8bbbe304eacff8c0dbf`: legacy scripts retired;
- plus this Project OS commit.

**Files changed:**
- `scripts/backup/backup.mjs`, `scripts/backup/lib/backupCore.mjs`, `backupCrypto.mjs`, `backupTarget.mjs` (new)
- `scripts/localdb/backup-tests.mjs` (new), `tests/backup-tool.test.mjs` (new), `.gitignore`
- `scripts/reset-production-users.mjs`, `scripts/reconcile-production-users.mjs` (retired), `tests/owner-first-auth-guards.test.mjs`
- `project-os/05-build/pilot-release-checklist.md` (section 4 rewritten; rows X3, 2 and 13), `release-plan.md` (section 3 note), current-status, next-action

**Summary:**
- **Consistent export:** covers Auth, businesses, memberships, snapshots and the request log.
- **Fail-closed validation:** completeness (end marker) and referential checks.
- **Encryption and PASS:** in-memory AES-256-GCM; PASS only after the written file is read back, decrypted and matched; FAIL leaves no file.
- **Morning check, verify, and restores:** a full restore into an empty project only, and a one-business restore of snapshot plus request log (memberships and Auth deliberately untouched).
- **Hosted target guards:** env file outside the repo, host and user bound to the project ref, TLS, typed confirmation.
- **Deviation:** AES-256-GCM via Node instead of gpg. Git's gpg on Windows cannot read a passphrase from a pipe (tested: "Bad file descriptor"), so it would have needed a passphrase file on disk.
- **Legacy scripts:** both production-user scripts now exit 2 with a retirement message before any import or connection.

**Tests run:**
- backup-tests 35/35 (fresh reset);
- unit tests 328/328 (8 new backup, 1 replaced retirement test);
- sync guards pass;
- build OK.
- No `src/` or `api/` changes since `c50d984`, so the demo 34/34 and tenant browser 9/9 results from that commit still apply.

**Result:** Pass (local).

**Risks remaining:**
- the hosted backup connection (Session pooler, Docker, TLS) is unproven until its first authorized run;
- the recovery point is up to 24 hours;
- the passphrase must be kept safe (losing it makes backups unrecoverable);
- X1 and X2 still need authorization.

**Next action:** `next-action.md` (Task 27).

### 2026-10-10 21:50 — taxiflow.co.za added to the release scope (Task 28)

**Changed by:** Claude Code (agent). Read-only only: registry WHOIS, DNS (local resolver, 1.1.1.1, 8.8.8.8, co.za and Accelerit nameservers), Vercel CLI/API (domains, domain config, production deployments). No DNS, Vercel, Supabase or registrar change; no purchase.

**Files changed:**
- `project-os/05-build/pilot-release-checklist.md` (X4, rows 5a, 11 and 12, sections 3 and 5)
- current-status, next-action

**Findings:**
- **Registry:** `serverHold`, so the domain resolves nowhere.
- **Nameservers:** `ns1/ns2.accelerit.ltd` serve no zone (REFUSED).
- **Records:** no published records, so there were no email records to preserve (any unpublished panel records are to be kept).
- **Vercel:** apex and `www` are already attached to `taxiflowpro` production with no redirect, and production is still the legacy `008ce8e` build.
- `taxiflow.apprigate.com` is attached but points to the shared host.

**Plan:**
- lift the hold;
- `www` redirects 308 to the apex (Vercel);
- add the DNS records only at row 5a (maintenance page on production);
- set the Supabase Site URL and allow-list to `https://taxiflow.co.za` only;
- HTTPS is issued automatically by Vercel (Let's Encrypt).
- No code change: setup and recovery redirects follow the request host or the Site URL.

**Tests run:** none needed (documents only; no code change).

**Next action:** `next-action.md` (Task 28).

### 2026-10-10 20:30 — taxiflow.co.za delegation: www redirect set; legacy exposure found (Task 29)

**Changed by:** Claude Code (agent), with Tebogo's authorization for Vercel records and the www redirect. No purchase, nameserver change, deploy or zone edit.

**Actual changes:**
- Vercel project `taxiflowpro`: `www.taxiflow.co.za` → redirect to `taxiflow.co.za`, **308**.
- Before: no redirect, production branch. After: redirect 308, production branch.

**Attempted, not applied:**
- Apex `gitBranch=domain-hold-no-deploy`: Vercel 400 (the branch does not exist in Git).
- Detach the apex from the project: blocked by the agent permission policy.

**Findings:**
- WHOIS status `ok`, nameservers `ns3/ns5.za-dns.com`.
- The zone already has A @ `216.198.79.1` and CNAME `www` (Vercel), plus a complete email set (preserved, not touched).
- Production is the legacy `008ce8e`, and the apex serves it via the Vercel edge.
- 1.1.1.1 resolves the apex from about 20:30 UTC.

**Blocker:** the apex must be detached from the project (or the zone's A and CNAME removed) until release row 5a.

**Tests run:**
- DNS queries direct to ns3/ns5, the co.za servers, 1.1.1.1 and 8.8.8.8;
- HTTP probe via the Vercel edge (`--resolve`);
- Vercel API reads before and after the change.

### 2026-10-10 20:28 UTC — Verification after reported removal: taxiflow.co.za STILL serves the legacy app (Task 30)

**Changed by:** Claude Code (agent). Read-only checks only; no change made. Empty-branch workarounds stopped, as instructed.

**Findings:**
- **Vercel API:** project `taxiflowpro` (`prj_vYaxObYXR8imyMKRr951yLJ0XAh7`) still lists `taxiflow.co.za` as a production domain. It was created 2026-09-28 06:51 UTC, last updated 2026-09-28 14:25 UTC, so it has not been removed.
- `www.taxiflow.co.za` still redirects 308 to the apex.
- `http://taxiflow.co.za/` and `http://www.taxiflow.co.za/` return 308 to https.
- `https://www.taxiflow.co.za/` returns 308 to `https://taxiflow.co.za/`.
- `https://taxiflow.co.za/` presents a certificate for the wrong name (SEC_E_WRONG_PRINCIPAL). Ignoring the certificate, it serves **the legacy build** (`index-DguJu-LE.js`).

**Result:** FAIL. The legacy app is still exposed on the domain.

**Required:** remove `taxiflow.co.za` under Vercel → project `taxiflowpro` → Settings → Domains (not the team Domains page), then re-verify. Keep the zone records and the www redirect for reconnection at release row 5a.

### 2026-10-10 22:55 SAST — Domain verified live; maintenance deployment prepared and tested (Task 31)

**Changed by:** Claude Code (agent). Local files and read-only checks only. No deploy, key, DNS or Vercel change; the domains stay attached as instructed.

**Verified:**
- `https://taxiflow.co.za` returns 200 with a valid Let's Encrypt certificate (CN `taxiflow.co.za`, until 2027-01-08). It serves production `taxiflowpro-vq1gbf579` = **legacy `008ce8e`** (bundle `index-DguJu-LE.js`).
- `https://www.taxiflow.co.za` returns 308 to `https://taxiflow.co.za/` (valid certificate for `www`).
- `http://taxiflow.co.za` returns 308 to https.

**Files:**
- `deploy/maintenance/` (`index.html`, `sw.js`, `api-maintenance.json`, `vercel.json`, `brand/` icons);
- `scripts/release/maintenance-tests.mjs`, `scripts/release/lib/staticRoutes.mjs`, `tests/maintenance-page.test.mjs`;
- release checklist: X4, rows 4, 5 and 5a, section 5 update, new section 6;
- current-status, next-action.

**Tests run:**
- maintenance-tests 15/15;
- unit tests 333/333;
- build OK (the maintenance folder is not part of the app's `dist`).

**Findings:**
- Vercel Git auto-deploy for `main` with "Auto-assign custom production domains" on (must be turned off at row 4a).
- Deployment Protection covers all except custom domains.
- The project has no build overrides; the maintenance `vercel.json` skips the build.

**Remaining:** the legacy app stays exposed on the domain until row 5 (the window).

### 2026-10-10 23:35 SAST — Official email moved to taxiflow.co.za: verified mail setup, plan prepared (Task 32, in progress)

**Changed by:** Claude Code (agent). Read-only DNS, TLS and SMTP EHLO checks (no AUTH attempted, no email sent). Project OS only. No mailbox, DNS, Supabase or Vercel change yet.

**Findings:**
- Zone: MX `0 mail.taxiflow.co.za`; SPF `v=spf1 +a +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all`; DKIM `default` RSA 2048; DMARC `p=none`; autodiscover SRV.
- Exim 4.100.1 on `cp24-jhb.za-dns.com` (reverse DNS matches); AUTH PLAIN LOGIN; 50 MB limit.
- TLS covers `cp24-jhb.za-dns.com` (valid) but `mail.taxiflow.co.za` gives a hostname mismatch.
- SPF `+a` now includes the Vercel apex IP 216.198.79.1.

**Plan:**
- support and notifications mailboxes; forwarder notifications → support;
- edit the single SPF record to remove `+a`;
- Supabase SMTP via `cp24-jhb.za-dns.com:465`, sender "TaxiFlow" `notifications@taxiflow.co.za`;
- Site URL and redirects at row 12.

**Files:** `project-os/05-build/pilot-release-checklist.md` (X2, section 3 replaced, section 5 note), current-status, next-action.

### 2026-10-11 02:58 SAST — taxiflow.co.za mailboxes, forwarder and SPF fix (Task 33, in progress)

**Changed by:**
- Claude Code (agent), in Tebogo's signed-in cPanel session for account `taxiflowco` (browser pane);
- Tebogo typed both mailbox passwords and clicked Create.

No purchase or plan change; no website DNS change; no password seen by the agent.

**Plan limits** (read before any change):
- Email accounts 0 / ∞; Forwarders 0 / ∞; Mailing lists 0 / 75;
- Disk 1.39 MB / 4.88 GB (shared by mail and files); Bandwidth 1 TB.
- No charge was shown.

**Actual changes:**

| # | Change | Before | After |
|---|---|---|---|
| 1 | DKIM signing for `taxiflow.co.za` | inactive (despite a valid key) | **enabled automatically by cPanel** when Email Deliverability was opened (the cPanel notice says so) |
| 2 | Mailbox `support@taxiflow.co.za` | none | created, unrestricted, 250 MB |
| 3 | Mailbox `notifications@taxiflow.co.za` | none | created, unrestricted, 250 MB |
| 4 | Forwarder | none | `notifications@taxiflow.co.za` → copy to `support@taxiflow.co.za` |
| 5 | SPF TXT `taxiflow.co.za` (the single SPF record, edited in place) | `v=spf1 +a +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all` | `v=spf1 +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all` |
| — | Zone serial | 2026092803 | 2026101100 |

- 28 zone records before and after the change.
- A @, CNAME `www`, MX, mail A, DKIM and DMARC are unchanged (verified at ns3 and ns5).

**cPanel Email Deliverability:** DKIM VALID, SPF VALID, DMARC VALID, PTR VALID (HELO `cp24-jhb.za-dns.com`).

**Outbound path:** authenticated submission (`dovecot_login`), then smarthost `delivery.antispam.co.za` (148.251.146.168), which is inside `include:spf.zamailgate.com` (148.251.146.160/27).

**Test E1:**
- support → apprigate@gmail.com, 02:54:02, id `1xFhpj-0000000CFIh-3vXH`.
- The relay reported "delivered successfully".
- **Gmail inbox delivery and the SPF/DKIM/DMARC results are pending Tebogo's check.**
