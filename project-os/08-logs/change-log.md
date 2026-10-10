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
