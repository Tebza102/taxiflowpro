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

### 2026-10-11 03:12 SAST — Mail tests E1–E4 passed (Task 33, in progress)

| # | Test | Evidence | Result |
|---|---|---|---|
| E1 | support → Gmail (external send) | relay `delivery.antispam.co.za` delivered (id `1xFhpj-0000000CFIh-3vXH`); Tebogo confirmed receipt in Gmail | **PASS** |
| E2 | Authentication at Gmail ("Show original") | Tebogo: SPF PASS, DKIM PASS for `taxiflow.co.za`, DMARC PASS | **PASS** (aligned) |
| E3 | Gmail → support (external receive via MX) | "Re: TaxiFlow mail test E1" in support at 02:59 (seen by the agent in webmail) | **PASS** |
| E4 | message to `notifications@` copied to support | "TaxiFlow mail test E4" in support at 03:10 (agent, webmail; sent support → notifications) | **PASS** (forwarder rule) |

**Still to test:**
- **E5:** platform (Supabase) email delivery and authentication through `notifications@`. It needs Supabase SMTP configured first.
- **E6:** the real setup and reset flow on `https://taxiflow.co.za`. It awaits the secure deployment (release row 12).

### 2026-10-11 03:25 SAST — Supabase custom SMTP enabled with notifications@taxiflow.co.za (Task 33, in progress)

**Changed by:**
- Claude Code (agent) filled the non-secret fields in Tebogo's signed-in Supabase dashboard (browser pane);
- Tebogo pasted the password and clicked Save.

The agent never saw the password.

**Project:** `vfxftviwteypasredjgm` → Authentication → Emails → SMTP Settings.

| Setting | Before | After (verified after reload) |
|---|---|---|
| Enable custom SMTP | off (Supabase default sender) | **on** |
| Sender email | — | `notifications@taxiflow.co.za` |
| Sender name | — | `TaxiFlow` |
| Host / port | — | `cp24-jhb.za-dns.com` / `465` |
| Minimum interval per user | — | 60 s (default) |
| Username | — | `notifications@taxiflow.co.za` |
| Password | — | stored (masked) |
| Auth email rate limit | default-sender limit | 30 per hour (Supabase default for custom SMTP) |

**URL Configuration** (read only, **unchanged**):
- Site URL `https://taxiflow.apprigate.com`. This host points to shared web hosting, not the app.
- Redirects:
  - `https://taxiflow.apprigate.com/**`;
  - `https://taxiflowpro-git-agent-owner-first-auth-reset-apprigate.vercel.app/**`, and the same URL without `/**`;
  - `https://taxiflowpro.vercel.app/**`.
- These are replaced by `https://taxiflow.co.za` and `https://taxiflow.co.za/**` only, at release row 12.

**Next:** E5, a platform-generated recovery email to an account Tebogo owns.

### 2026-10-11 03:40 SAST — E5 platform SMTP delivery passed; external authentication still open (Task 33)

**E5:** Supabase "Send password recovery" to `owner@apprigate.com` (Tebogo's account).
- Received from **TaxiFlow `notifications@taxiflow.co.za`** (Tebogo).
- cPanel Track Delivery: 03:27:03 and 03:30:03 SAST, sender `notifications@taxiflow.co.za`.
  - Authenticated as `dovecot_plain`, from `52.210.122.178` (AWS eu-west-1, Supabase).
  - Message ids `1xFiLc-0000000CaZU-3nTn` and `1xFiOv-0000000CcIY-0RUD`.
- Tebogo's headers confirm authenticated TLS SMTP from the Supabase project.
- **Result: SMTP delivery PASS.**

**Not verified:**
- **External authentication of platform mail:** `apprigate.com` mail is on the same cPanel server, so both messages were delivered locally (`dovecot_virtual_delivery`). They never went through the relay or an external SPF/DKIM/DMARC check.
- **End-to-end recovery.**

Both move to release row 12 (E6, external Gmail).

**Recovery link:**
- Tebogo shared it in chat. It is **not stored here and must not be used.**
- Email links expire after 3600 s (Auth setting, read only), so the 03:30 link expires at about 04:30 SAST.
- The Site URL currently points to `taxiflow.apprigate.com`, which does not serve the app.

**Plan change:** the Supabase URL update moves to new row **10a**, before promotion and onboarding. Row 12 is now the external E6 test before onboarding.

### 2026-10-11 04:20 SAST — Pre-migration backup format; backup.env prepared; Preview secret findings (Task 34)

**Changed by:** Claude Code (agent). Local code, tests and docs, plus a local file outside the repo. Read-only checks: Supabase Connect dialog (host only), Vercel API (env names, Preview deployments, protection). No production connection, key change, deploy or release step.

**Defect found and fixed:**
- The backup export expected the tenant tables, which production does not have before release files 01–04. It would have FAILed at rows 2 and 6a.
- Added the `taxiflow-backup-premigration-v1` format, chosen by a schema probe. It covers `workspace_snapshots`, the 8 legacy tables, and Auth.
- Restore only into an empty pre-migration schema; one-business restore is refused.

**Tests:**
- `backup-premigration-tests.mjs` 13/13 (after `setup.mjs hosted-pre`). The restore matches all tables and all accounts sign in. Release files 01–04 then apply to the restored data: 0 unmapped snapshots, 1 active Owner. The tenant export passes after migration.
- `backup-tests.mjs` 35/35 (after reset; no regression).
- Unit tests 334/334.

**backup.env:**
- `C:\Users\appri\taxiflow-recovery\backup.env` created with the Session pooler details: host `aws-1-eu-west-1.pooler.supabase.com`, port 5432, user `postgres.vfxftviwteypasredjgm`, db `postgres`.
- The password line is empty for Tebogo to fill in.
- The folder and file are restricted to the user and SYSTEM (another local group's read access was removed from 89 files).
- Offline validation: NOT VALID until the password is added (expected).

**Database-password dependencies:** none in the hosted app (no Vercel variable or integration, no CI). Do not reset the password unless it is unknown.

**Preview secret:**
- **Not removed.** `SUPABASE_SERVICE_ROLE_KEY` targets Preview and Production.
- **4 Preview deployments** (branch `agent/owner-first-auth-reset`, 2026-08-16 to 2026-10-09) were built with the legacy secret and keep it regardless of later variable changes.
- Deployment Protection covers all URLs except custom domains, **but a protection-bypass secret is configured**.
- Fix: row 3 (remove from Preview), row 6 (deactivate the legacy key), row 11 (delete the Previews, revoke the bypass).

### 2026-10-11 05:26 SAST — First production backup: PASS (release row 2, connection proof; Task 35)

**Authorised by:** Tebogo (read-only export of `vfxftviwteypasredjgm`). Run by Tebogo in the Terminal panel; he typed the project ref, and the passphrase came from a temporary file that the run script deleted.

No restore, key change, deployment deletion, migration, merge or deploy.

**Result:**
- Export: **PASS** (format `taxiflow-backup-premigration-v1`, schema probe = pre-migration).
- Verify: **PASS** (decrypts, complete, consistent).
- Morning check: **OK**.

| Item | Value |
|---|---|
| File | `C:\Users\appri\taxiflow-recovery\backups\taxiflow-vfxftviwteypasredjgm-2026-10-11T03-24-06-317Z.tfbk` (216,093 bytes) |
| Ciphertext SHA-256 | `03f34949210b91c15d83a6a453b4771d56423ebf68bb7c219588a809ea8aca0c` |
| Exported at | 2026-10-11 03:25:40 UTC (one read-only REPEATABLE READ transaction) |
| Counts | snapshots 1 (`taxiflow-live`, last updated 2026-10-10 14:21:55 UTC); legacy rows 0; Auth users 5; identities 5 |
| Matches the read-only inventory | yes (1 workspace, 5 users, legacy tables empty) |

**Connection proven:** Docker `psql` → TLS → Session pooler `aws-1-eu-west-1.pooler.supabase.com:5432` as `postgres.vfxftviwteypasredjgm`.

**Attempts before PASS** (all stopped before any data was read):
1. Confirmation mismatch. A secret-looking value was typed at the ref prompt and was visible in terminal tab "production backup". **Tebogo should change that password wherever it is used.**
2. Passphrases did not match.
3. Passphrase shorter than 16 characters (hidden paste failed). Switched to a temporary passphrase file in the protected folder, deleted by the script in every case.
4–5. Database password rejected. **Tebogo reset the database password**; earlier dependency check: no app, Vercel or CI use. The new password was then saved in `backup.env`.
6. PASS.

**Fix during the run:** passphrase files now ignore an editor byte-order mark and line breaks (`0c2e1db`).

**Open:**
- **The backup passphrase equals the database password** (checked in-process; neither value printed). Re-run the backup with a separate passphrase before the window, then delete this copy.
- An encrypted off-machine copy is not yet made.

### 2026-10-11 05:50 SAST — Production keys prepared (release row 3)

**Changed by:**
- Claude Code (agent) created both Supabase keys by name in Tebogo's signed-in dashboard and never read their values;
- Tebogo copied the values from Supabase into Vercel.

No legacy key change, deploy, migration or merge.

**Supabase** (`vfxftviwteypasredjgm` → API Keys):
- Before: publishable `default`, secret `default`. Both were auto-created and are unused by TaxiFlow.
- Added: publishable **`web_app`** and secret **`vercel_production`**.
- `web` was rejected because names need at least 4 characters of lowercase letters, digits and underscores.
- The legacy anon and service_role keys are unchanged and still active.

**Vercel** (`taxiflowpro`, names/targets/times only):

| Variable | Before | After |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | preview, production (legacy secret) | **production only**, Sensitive, updated 05:48 |
| `VITE_SUPABASE_ANON_KEY` | preview, production (legacy anon) | preview, production, updated 05:48 |
| `SUPABASE_URL`, `VITE_SUPABASE_URL`, `VITE_BACKEND_MODE` | unchanged | unchanged |

- An intermediate save briefly left the secret on Preview and the browser key off Preview. Both were corrected and re-verified. No build ran in between.

**Not verifiable by the agent:** the values of Sensitive variables. They are proven at row 10, when the skip-domain deployment signs in with the new keys.

**Still holding the legacy secret:** the 4 existing Preview deployments, until row 6 (legacy keys off) and row 11 (delete).

**Later clean-up:** the unused `default` secret key can be deleted after go-live.

### 2026-10-11 07:11 SAST — Production backup re-run with a separate passphrase: PASS

**Authorised by:** Tebogo (read-only export of `vfxftviwteypasredjgm`; he typed the project ref).

**Passphrase:**
- Generated locally (24 characters, letters and digits) without being displayed.
- Placed on the clipboard for Tebogo to save in Google Password Manager (entry `backup-passphrase` on `https://taxiflow.co.za`).
- Checked in-process to **differ from the database password**.
- The temporary file was deleted by the run script.

**Result:**
- Export **PASS** (`taxiflow-backup-premigration-v1`).
- Verify **PASS**.
- Check **OK**.

| Item | Value |
|---|---|
| File | `taxiflow-vfxftviwteypasredjgm-2026-10-11T05-08-06-803Z.tfbk` (216,093 bytes) |
| Ciphertext SHA-256 | `8bada8992ee33e60e09ea90a08dd1faa7d601922997ee7fd1c7db6e038baead4` |
| Exported at | 2026-10-11 05:11:06 UTC |
| Counts | snapshots 1, legacy rows 0, Auth users 5, identities 5 (same as the first run) |

**To remove:** the earlier backup `…T03-24-06-317Z.tfbk` and its manifest. It was encrypted with the database password. Tebogo deletes it himself; the agent does not permanently delete data.

**Still open:** an encrypted off-machine copy of the new backup.

### 2026-10-11 07:30 SAST — Backup housekeeping done

- **Removed by Tebogo:** the earlier backup `…T03-24-06-317Z` (`.tfbk` and manifest), which was encrypted with the database password. The local folder now holds `backup-log.txt` and the 05-08 backup only.
- **Off-machine copy:** `G:My DriveTaxiFlow backups` (Google Drive, apprigate@gmail.com) received the 05-08 `.tfbk` and manifest, copied by the agent at Tebogo's request.
  - SHA-256 of both copies matches the originals.
  - The `.tfbk` hash matches the manifest (`8bada899…`).
  - The file is encrypted; the passphrase is only in Tebogo's password manager.

### 2026-10-11 — RELEASE WINDOW OPEN (rows 1–6; Task 36, in progress)

**Authorised by Tebogo:** release steps 4–13 on `vfxftviwteypasredjgm` / Vercel `taxiflowpro`.

**Preconditions confirmed by Tebogo:**
- the 5 existing users were notified;
- the backup `…T05-08-06-803Z` and its manifest are uploaded in Google Drive (apprigate@gmail.com);
- existing business name: **"TaxiFlow Pro"**.

**Reviewed release commit:** `3443c91d5f41e88fab866a82658f3b2cf5bb979d`.
- Release file 01 rebuilt with the name "TaxiFlow Pro" (name line only).
- Added `scripts/hosted/apply-release.mjs`.

| Row | Action | Evidence | Result |
|---|---|---|---|
| 1 | Local checks at the reviewed commit | build OK; unit 334/334; sync guards pass; hosted rehearsal 22/22 (business name "TaxiFlow Pro"); apply-release on the exact pre-migration copy: 01–04 applied, 6/6 checks PASS, re-run skips all four files | **PASS** |
| 2 | Backup connection proof | earlier: `…T05-08-06-803Z` PASS | **PASS** |
| 4a | Vercel `autoAssignCustomDomains` | true → **false** | **DONE** |
| 4b | Maintenance deployment, no domains | `taxiflowpro-cmlp6fmww-apprigate.vercel.app` (`dpl_FHXMuDf19iELaFMadeFdPsgGQ2r3`): / and deep links 200 maintenance; /api/* 503 JSON; /sw.js is the self-removing worker; the legacy asset is not served | **PASS** |
| 4c | Push and fast-forward `main` | **blocked by the agent permission policy; Tebogo runs it** | pending |
| 5 | `vercel promote` maintenance | taxiflow.co.za and taxiflowpro.vercel.app serve maintenance; /api 503 | **PASS** |
| 5a | Domain checks | HTTPS valid for taxiflow.co.za; www 308 → apex; http 308 → https | **PASS** |
| 6 | Supabase "Disable JWT-based API keys" | legacy anon: before 200 (auth) → after **401** on rest/v1 (workspace_snapshots, fleet_profiles) and auth/v1 (after about 1 minute of gateway propagation). Storage bucket list still 200 (Supabase keeps legacy keys valid as JWTs there; TaxiFlow uses no Storage). service_role disabled in the same action. | **PASS** |

**Findings during the window:**
- **Two legacy redeploys:** at 05:46 and 05:48 SAST, Vercel "Redeploy" after the variable edits created `taxiflowpro-qiu4f5l2y` and `taxiflowpro-96cvjgq39`. These are legacy `008ce8e` builds **with the NEW keys** (publishable `web_app`, secret `vercel_production`). They were auto-assigned to taxiflow.co.za at 05:49, before row 4a. Since row 5 they are off the domains, but they still hold the new secret. **They must be deleted before the migration** (Tebogo).
- **Default secret key:** `.env.uat.local` holds an `sb_` secret key (most likely the auto-created `default` secret), which still works. Delete that key after the release; TaxiFlow does not use it.

### 2026-10-11 — Pre-migration access closure (release window, continued)

**Identified:** the `sb_` key in `.env.uat.local` is Supabase secret key **`default`**.
- Matched by SHA-256 of its displayed 5-character prefix (`afa483b2…`); no value was displayed.
- The key ID is not shown in the dashboard UI; it is identified by name, type and prefix hash.
- Dependencies: `.env.uat.local` (old UAT tooling) and most likely the older Vercel deployments. Nothing current uses it.

**Revoked:** secret key `default` (Supabase "Successfully deleted secret key").
- After: `default` → 401 on rest/v1/workspace_snapshots, auth/v1/admin/users and rest/v1/.
- Remaining secret keys: `vercel_production` only.

**Verified refused (tested in the dashboard page, status codes only):**
- legacy `service_role` → 401 on rest/v1/workspace_snapshots, rest/v1/fleet_profiles and auth/v1/admin/users;
- legacy anon → 401 on the same three.

**Still open before migration:**
- `origin/main` is still `008ce8e`: the push and merge are pending (Tebogo).
- The legacy redeploys `taxiflowpro-qiu4f5l2y` and `taxiflowpro-96cvjgq39` still exist with the valid `vercel_production` secret: delete pending (Tebogo).
- Final backup: pending, after those two are gone.

`taxiflow.co.za` still serves maintenance (re-checked).

### 2026-10-11 — Release window: rows 4c, 6b, 6a, 7, 8 done; report routing defect found (rows 9–10)

**Row 4c and the resume script** (`C:\Users\appri\taxiflow-recovery\release-resume.ps1`, run by Tebogo; its dry run was tested by the agent):
- deleted `taxiflowpro-qiu4f5l2y` (`dpl_B1LwD8PWRL1SrLtC9CXyd5p3rwwp`) and `taxiflowpro-96cvjgq39` (`dpl_7qQ4A4a1vAJZC7QwR7mhnwvGBDXp`) by exact ID. Both legacy 008ce8e builds held the new secret and no live aliases; both verified gone.
- `origin/main` fast-forwarded to `51c472ca406e1abb3bd45a142fd675ac02b2005f`. The reviewed code `3443c91` is identical (later commits are Project OS only).
- The `main` build `taxiflowpro-7aibja2g9` (`dpl_3VoKcaB1unkTgs19MXPrQg8xt13L`) is READY and **not assigned** (auto-assign off).

**Row 6a, final pre-migration backup:**
- **PASS**: `taxiflow-vfxftviwteypasredjgm-2026-10-11T07-38-37-806Z.tfbk`, SHA-256 `390a7d12662a33c5dfdfbe1636dc16a26dce801c918aa926f1054bf77229c7e4`.
- Counts: snapshots 1, legacy rows 0, Auth users 5, identities 5. Verify PASS; check OK.
- Copied to `G:\My Drive\TaxiFlow backups\` (SHA-256 matches). Tebogo confirms the cloud upload in drive.google.com. The earlier `…T05-08-06-803Z` backup is kept.

**Row 7, migration** (`scripts/hosted/apply-release.mjs`, typed confirmation by Tebogo; a first attempt with a typo was refused and applied nothing):

| File | Result |
|---|---|
| 01 tenant foundation | APPLIED, 9.6 s |
| 02 finance actions | APPLIED, 6.0 s |
| 03 pilot onboarding | APPLIED, 4.5 s |
| 04 assign initial owner | APPLIED, 3.1 s |

**Post-checks: all PASS.**
- businesses 1 ("TaxiFlow Pro"); snapshots 1, all mapped; active memberships 5; active Owners 1;
- no policies on `workspace_snapshots`;
- browser grants exactly authenticated SELECT on `businesses` and `business_memberships`;
- RLS on every public table;
- no browser-executable public function.

**Row 7a:** an active Owner exists, so `assign-initial-owner` was **not run**.

**Row 8, access** (publishable `web_app` key, no sign-in):
- `workspace_snapshots`, `businesses`, `business_memberships`, `finance_action_requests`, `fleet_profiles`, `vehicles` and `banking_events` all return **401 / 42501**.
- The RPCs `commit_finance_action`, `create_business_with_owner`, `apply_membership_change` and `assign_initial_owner` return **404 PGRST202** (not exposed to the browser).
- The tenant bundle contains the publishable key only (no `sb_secret`, no legacy JWT).

**Rows 9–10, smoke tests on `taxiflowpro-7aibja2g9`** (bypass header; no domain):
- `/` and deep links return 200 (app).
- `/api/business/workspace`, `/memberships` and `/members` return 401 without a token (the functions run).
- `/api/admin/auth-users` and `bootstrap-workspace` return 410.
- **DEFECT:** `/api/admin/daily-log/<id>/report-view` and `/report-pdf` return **200 index.html**. The SPA catch-all rewrite takes precedence over the dynamic `api/admin/daily-log/[id]/*.js` functions on Vercel. Locally, the Vite dev middleware imitated dynamic routing, which hid this.
- **Fix forward (maintenance kept up):**
  - handlers moved to static `api/admin/daily-log/report-view.js` and `report-pdf.js`;
  - explicit rewrites `/api/admin/daily-log/:id/<name>` → `/api/admin/daily-log/<name>?id=:id`;
  - the catch-all now excludes `/api/`;
  - the dev middleware, test imports and `server-auth-tests` were updated;
  - new `tests/vercel-routing.test.mjs`.
  - Unit tests 336/336, build OK.
  - Hosted verification is pending after Tebogo pushes.

### 2026-10-11 — Release window: rows 9–11 (secure app LIVE on taxiflow.co.za)

**Report-routing fix live:**
- Tebogo pushed with `push-fix.ps1`; `origin/main` = `e59417a96b6df23b8d0bc0dfe08c03971e9f5da1` (code = `288e3f2`).
- Build `taxiflowpro-jng5n1ced` (`dpl_FruSfHfKnvUv8Gv367g6wzeduEpv`).
- Report-view and report-pdf now return 401 JSON from the functions without a token (previously index.html).
- Business routes return 401; legacy admin routes return 410.

**Row 10, signed-in smoke test** (Tebogo, `owner@apprigate.com`, on the deployment URL) — **all PASS:**
1. TaxiFlow Pro with existing data;
2. survives a refresh;
3. Business access lists 5 members;
4. report preview and PDF work.

Recorded for later review (out of scope): **the layout looks different from the legacy app; no functional problem.**

**Row 10a, Supabase URL configuration:**
- Site URL `https://taxiflow.apprigate.com` → `https://taxiflow.co.za`.
- Redirect list: removed `taxiflow.apprigate.com/**`, both `taxiflowpro-git-agent-owner-first-auth-reset-apprigate.vercel.app` entries and `taxiflowpro.vercel.app/**`; added `https://taxiflow.co.za/**`, which is now the only entry (verified after reload).

**Row 11, promote:** `vercel promote dpl_FruSfHfKnvUv8Gv367g6wzeduEpv`.
- taxiflow.co.za and taxiflowpro.vercel.app serve the tenant build (`index-K8ghKdHJ.js`).
- /api/business/workspace and report-view return 401; /api/admin/auth-users returns 410.
- www 308 → apex; http 308 → https.
- Alias taxiflow.co.za → `dpl_FruSfHfKnvUv8Gv367g6wzeduEpv`.

**Row 11, clean-up** (`release-cleanup.ps1`; dry run PASS):
- delete 9 deployments by exact ID: 3 legacy production, 4 legacy previews, the superseded tenant build `7aibja2g9` (report bug, production secret) and the superseded tenant preview `75b02lnxh`;
- keep `jng5n1ced` (live), `cmlp6fmww` (maintenance fallback) and `301dw9v3b` (current branch preview, no secret);
- revoke the Deployment Protection bypass secret.
- Run by Tebogo: pending.

### 2026-10-11 — Row 11 clean-up done (verified)

- **Deployments remaining:** `jng5n1ced` (live, `dpl_FruSfHfKnvUv8Gv367g6wzeduEpv`), `cmlp6fmww` (maintenance fallback), `301dw9v3b` (branch preview, no secret). All other deployments were deleted.
- **Protection bypass secrets configured: 0** (revoked).
- taxiflow.co.za still serves the tenant build.
- **Pending (Tebogo):** remove the dead `VERCEL_AUTOMATION_BYPASS_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` lines from `.env.uat.local`.

### 2026-10-11 — Row 12: external email and full password reset — functional PASS; DKIM finding

**Method:**
- Owner (`owner@apprigate.com`) granted temporary access to `apprigate@gmail.com` ("Gmail test") in Business access on taxiflow.co.za (built-in browser).
- Tebogo opened each link in a separate incognito session and set the passwords privately.

**Results:**
- **Setup email:** sent by Supabase as `notifications@taxiflow.co.za` (authenticated, from 52.210.122.178) via relay `delivery.antispam.co.za` (cPanel Track Delivery 15:43:15, accepted). Delivered to Gmail **Spam**. The link opened `https://taxiflow.co.za/`; the password was set.
- **Recovery email** (Forgot password? on taxiflow.co.za): delivered to Gmail **Spam**, subject "Reset Your Password", From "TaxiFlow" <notifications@taxiflow.co.za>. Link `redirect_to=https://taxiflow.co.za`; the reset worked. The one-time token was used and is not recorded here.
- **Gmail authentication:**
  - **SPF pass** (164.160.88.223 za-outgoing-13-6.antispam.co.za);
  - **DMARC pass** (p=none, via SPF alignment);
  - **DKIM `taxiflow.co.za` FAIL**: the outbound relay adds a `Message-ID` header after the cPanel signature (Supabase sends none; the signature covers Message-ID);
  - DKIM `out.zamailgate.com` pass (relay, not aligned).
- **Removal:** the Owner removed access ("Access removed for apprigate@gmail.com.").
  - DB read-only check: membership `active=false` at 14:18:40 UTC; active memberships 5; active Owners 1.
  - The membership list did not refresh immediately in the UI (cosmetic; logged).

**Findings for later review** (no change in this release):
1. **Grant-access role:** the dropdown showed Manager, but the grant recorded **Admin** (selection via keyboard in the built-in browser). Check that the role sent always matches the role displayed.
2. **Platform email DKIM / Spam:**
   - ask Absolute Hosting to stop the relay modifying headers after signing, or to sign taxiflow.co.za after relaying;
   - brand the Supabase email templates;
   - meanwhile, tell Owners to check Spam and mark "Not spam".
3. **Layout:** looks different from the legacy app; no functional problem (Tebogo).
4. **Chrome autofill:** a saved Chrome entry autofills a random value into the taxiflow.co.za **email** field; Tebogo to review the saved entries.

`.env.uat.local`: removed the two revoked lines (`VERCEL_AUTOMATION_BYPASS_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`); no values were printed.

### 2026-10-11 — Row 13: after-release backup PASS; release closed out

- **After-release backup** (`C:\Users\appri\taxiflow-recovery\after-release-backup.ps1`; Tebogo typed the passphrase at the hidden prompts, so it was never in a file, the clipboard or chat):
  - Step 1: the same passphrase opens the final pre-migration backup `…T07-38-37-806Z` (verify PASS).
  - Export: `taxiflow-vfxftviwteypasredjgm-2026-10-11T15-15-11-698Z.tfbk`, format `taxiflow-backup-v1` (tenant), exported at 15:16:19 UTC, SHA-256 `7ce304fb6729ad715006236808f32ea416504193454a0bc034116da4f142aad2`.
  - Counts: businesses 1, memberships 6 (5 active plus the inactive test member), snapshots 1, request log 0, Auth users 6, identities 6.
  - Verify PASS; check OK.
  - Copied with its manifest to `G:\My Drive\TaxiFlow backups\`; SHA-256 matches for both files. Tebogo to confirm the cloud upload.
- **Release result:** rows 1–11 and 13 PASS. Row 12 works (delivery, landing page, password set) but **DKIM `taxiflow.co.za` fails** and mail lands in Spam. Under the row 12 rule, onboarding is **held** pending Tebogo's decision (see `next-action.md`).
- Live: `e59417a` as `dpl_FruSfHfKnvUv8Gv367g6wzeduEpv` on `taxiflow.co.za`.

### 2026-10-11 — Release stabilisation: role check closed (no code change), DKIM ticket drafted, test member and backup confirmed

**1. Business access role mismatch**
- Server path: `members.js` → `parseRole` → `apply_membership_change` passes the role through unchanged and accepts only Admin, Manager or Driver.
- New `tests/localdb-browser/tenant-access-roles.spec.js`, on a fresh `setup.mjs hosted` stack (synthetic `@example.com` users).
- **Run on the unchanged code** (the earlier spec version also had an automation case):
  - Manager, Admin and Driver chosen with `selectOption` saved exactly, and so did Manager chosen with the keyboard (focus, ArrowDown);
  - only the automation case (dropdown value set with no change event) saved **Admin**, reproducing row 12. The success message correctly reported the saved role.
- **Cause:** the row 12 grant was made by browser automation, whose click did not register; the keyboard path then moved the visible value without the change event reaching React. A person's selection does not do this. **No code fix and no deploy.** The candidate FormData fix is kept in `git stash` only.
- **Final spec (normal paths only): 1/1 PASS.** Each role saves exactly, persists after reload, and gets the matching server permissions:
  - Manager: workspace role Manager, no member list, cash-up verify allowed;
  - Admin: member list allowed, verify denied;
  - Driver: both denied.

**2. DKIM:** sanitised ticket drafted in `05-build/email-dkim-hosting-ticket.md`; **not sent**.
- Proven: the cPanel `d=taxiflow.co.za` signature includes Message-ID in `h=`; the only Message-ID, `E1xFuKB-002bmI-N8@server13.antispam.co.za`, matches the relay's queue id; Gmail `dkim=fail` (taxiflow.co.za), `dkim=pass` (out.zamailgate.com), SPF and DMARC pass.
- Passing E1 (webmail, id `1xFhpj-0000000CFIh-3vXH`, Tebogo's Gmail check) is cited; no raw E1 headers were ever recorded.
- **Hypothesis (unconfirmed):** the relay's added Message-ID breaks the signature. Onboarding new Owners stays paused.

**3. Test member and backup**
- Production read-only:
  - `apprigate@gmail.com` membership `active=false` (since 14:18:40 UTC); active memberships 5; Owners 1.
  - One Auth session remains. Acting as that user in a rolled-back read-only transaction: 0 businesses and 0 memberships visible; no snapshot privilege. The API also refuses (`tenantAuth` returns 403 without an active membership).
- Backup `…T15-15-11-698Z`: Drive for Desktop (the account holding both files) reported `active_uploads: 0, operation_queue_size: 0` at 15:51 UTC. The Drive connector here is a different Google account and the browser pane cannot sign in to Google, so this is local sync evidence, not a server listing.

### 2026-10-11 — Release stabilisation CLOSED

- **No app changes and no deploy.** Live code stays `e59417a` (`dpl_FruSfHfKnvUv8Gv367g6wzeduEpv`).
- **Single outstanding blocker for onboarding new Owners:** the DKIM hosting ticket (`05-build/email-dkim-hosting-ticket.md`, draft, Tebogo sends it).
- **Unused stash preserved:** `stash@{0}` (`bd2b25a5d48b34fdf557bacc04b8a9793d8da0f1`, "WIP on agent/tenant-db-foundation: e636df3 …"), the candidate FormData grant-role change to `TenantAccessPanel.jsx`. Do not drop or apply it without a new decision.
- **E1 raw headers:** none were found in the transcripts on this machine; the ticket cites the E1 Exim id and the Gmail pass result.
- **Next week, separate task:** the operator dashboard.

### 2026-10-12 — Frontend prototype integration preflight; reference access blocked

Created codex/frontend-prototype-integration from a85bde6, the current release lineage plus later documentation. Initial worktree clean; origin/main e59417a; local main 008ce8e. Unused stash bd2b25a preserved. Published prototype requires OpenAI sign-in; no accessible design or exported source yet. No application edits or tests; no external changes, push, merge or deployment. Next: user signs in to reference or supplies exported files, then desktop/mobile inspection and scoped synthetic-backend integration.

### 2026-10-18 — Platform admin and multi-company onboarding: built and tested locally; not deployed

Branch `agent/platform-admin-onboarding` (from `a85bde6`), local commits; not pushed.

**Discovery (read-only):**
- Production is `jng5n1ced` = `e59417a`.
- Supabase has 1 business (TaxiFlow Pro, `…00a`) and 6 active memberships.
- `apprigate@gmail.com` is an **active Admin**, restored at 16:40 UTC on 2026-10-11. This corrects the earlier "inactive" note.
- Tenancy, memberships, Owner staff onboarding, scoped Driver payloads, reports and finance actions were already live and were reused unchanged.

**Built:**
- **Release file 05** `scripts/localdb/migrations/20261018090000_platform_admins.sql` and its rollback:
  - RLS enabled and forced;
  - no anon, authenticated or PUBLIC grants; the service role gets select only;
  - no policies and no grant function; writes are operator only.
  - It is registered in `apply-release.mjs` and in the local rehearsal.
- **API:**
  - `authorizePlatformRequest` in `api/_lib/tenantAuth.js`;
  - `api/_lib/platformAdmin.js`;
  - `GET/POST /api/platform/businesses`, which returns company metadata only and runs `company.create` through the existing `createBusinessWithOwner`.
  - The creating platform admin is recorded in the new company's audit trail.
- **UI:** `src/components/PlatformCompaniesPanel.jsx`. The "Companies" button appears only for platform admins: in the tenant bar, the business picker and the no-membership screen.
- **Design decisions:**
  - the platform grant gives no company data access;
  - a platform admin cannot make themselves Owner of a company they create;
  - Tenant 1 is the existing business, with no data change.

**Defect found and fixed during testing:**
- The first version of file 05 had a `using (true)` policy for the service role. It did nothing, because the service role bypasses RLS, but `verify.mjs` flags it as permissive.
- Removed. `verify.mjs` now also expects `platform_admins` and checks RLS on it.

**Evidence** (local synthetic stack, real local Auth, a fresh reset per suite):

| Check | Result |
|---|---|
| `platform-admin-tests.mjs` | 75/75, then 75/75 again on the final file 05 (14:00) |
| Browser `platform-onboarding.spec.js` | 1/1 alone, and within the full localdb browser suite 11/11 on the final file 05 |
| Node unit tests | 342/342 |
| Sync guards | pass |
| Build | pass |
| Mock-backend Playwright | 34/34 |
| `verify.mjs` (final file 05) | 16 PASS, 0 WARN, 0 FAIL |
| Tenant access | 36/36 |
| Tenant rollback | 8/8 |
| Server auth | 26/26 |
| Onboarding | 64/64 |
| Finance actions | 56/56 |
| Finance capture | 43/43 |
| Finance record | 36/36 |
| Expense-only days | 32/32 |
| Backup/restore | 35/35 |
| Hosted rehearsal (exact live-schema copy plus files 01–05) | 22/22 |
| `apply-release.mjs --target local` re-run | already-applied files skipped; post-checks PASS (RLS on every public table; no browser-executable function) |

What `platform-admin-tests.mjs` covers:
- **Who is refused:** no token, garbage token, Owner, Admin, Driver and non-member; forged token metadata; browser and service-role writes to the grant table.
- **Operator grant:** Tenant 1 is listed as Tenant 1; the list is metadata only and no-store.
- **No extra power:** the platform admin keeps exactly Admin in Tenant 1 and has no access to company B or to the companies it creates.
- **Create refusals:** forged fields, invalid input and self-ownership.
- **Create, then a retry:** a no-op with no second email; slug hijack refused.
- **Existing account as Owner:** no reset, and its Tenant 1 membership unchanged.
- **New company:** the Owner sets their own password from the email and sees only company 2; the Owner grants Admin, Manager and Driver, and cannot mint an Owner or act in Tenant 1.
- **Driver:** saves an expense that persists; the payload is driver-scoped; no member list.
- **Manager:** sees the Driver's save; is refused a Tenant 1 report.
- **Unchanged:** Tenant 1 and B snapshot hashes and memberships.
- **Fail closed:** after revocation and after the file-05 rollback; companies are kept; re-applying is idempotent.

**Not done:** no production SQL, grant, push, merge, promote or email. Real Owner invitations still wait for DKIM.

### 2026-10-18 — Platform admin branch pushed; draft PR #3; Preview verified (read-only)

- Tebogo confirmed `apprigate@gmail.com` as the platform admin.
- Pushed `agent/platform-admin-onboarding` (`6b0b249`, `946861d`).
- Draft PR https://github.com/Tebza102/taxiflowpro/pull/3: 2 checks passing.
- **Preview** `taxiflowpro-kd3l04xjy` (`dpl_GVo3AdGULhEfSBViNkRkqYyDnca4`): READY from `946861d`.
  - The sign-in screen renders.
  - The platform route returns 401 with no token (GET and POST) and with a garbage token (validated by production Auth), with `no-store`.
- Live `taxiflow.co.za/api/platform/businesses` returns 404.
- **Finding:** the Preview has no service-role key. A signed-in platform request there fails closed (503) before the `platform_admins` lookup, so the "file 05 absent" denial is proven locally, not on the Preview. Not changed: giving the Preview the production secret would weaken isolation.
- **Production, read-only SQL:**
  - `platform_admins` absent;
  - businesses 1, active memberships 6, active Owners 1;
  - snapshot last updated 2026-10-11 19:18 UTC;
  - no tables without RLS;
  - browser grants only `authenticated` SELECT on businesses and memberships.
- **DKIM DNS** (read-only, public DNS, 2026-10-18):
  - SPF `v=spf1 +mx +ip4:164.160.91.17 include:spf.zamailgate.com ~all` (the `+a` mechanism is gone);
  - DKIM `default._domainkey` RSA key published;
  - DMARC `v=DMARC1; p=none;`;
  - MX `0 mail.taxiflow.co.za` (164.160.91.17);
  - NS `ns3/ns5.za-dns.com`.
  - No DNS change is indicated: webmail mail passed DKIM with the same selector. The ticket is unchanged and not sent.
- No production SQL writes, grants, merge, promote, companies or emails.

### 2026-10-18 — Prototype assessment re-checked: still inaccessible; no frontend change

- The ChatGPT-hosted prototype is still behind the OpenAI sign-in gate: 401 on every path; only gate assets load. No source or assets are available, and no local export was found.
- The older `working-prototype-v2` screenshot (2026-08-30) exists but is not confirmed as the approved design.
- **Smallest scope once inputs exist:** a presentation-only restyle of `SignInShell` (`src/App.jsx`), keeping its handlers (Supabase password sign-in, Forgot password, recovery shell) and the accessible labels the tests use; then only the approved authenticated screens.
- **Release-procedure link:** `project-os/05-build/platform-admin-release.md` — https://github.com/Tebza102/taxiflowpro/blob/agent/platform-admin-onboarding/project-os/05-build/platform-admin-release.md

### 2026-10-18 — Public website prototype assessed from the export (read-only)

- The export was inspected from a scratch copy; the original is unchanged.
- Its checks pass (5/5); it renders at desktop and mobile; **no missing assets**.
- **Finding:** it is a public marketing site with **no Login control**, not an app redesign. This supersedes the earlier note proposing a `SignInShell` restyle.
- **The app owns the `taxiflow.co.za` root** (PWA scope, service worker, recovery links), so the site should be hosted separately (recommended: `www` subdomain) with a "Log in" link to the existing sign-in.
- Details, missing inputs and estimate: `05-build/public-website-assessment.md`. No frontend code changed.

### 2026-10-18 — Public website: separate project and Preview; www unchanged

- `agent/public-website`:
  - the export copied byte-identically (SHA-256 checked; original untouched);
  - Log in added to the nav and the mobile menu, pointing to `https://taxiflow.co.za`;
  - every CTA audited.
- New Vercel project `taxiflow-website`; Preview `dt6j6b4zd` verified in the browser.
- **Incident:** the first deploy was recorded as project-Production with a public `taxiflow-website.vercel.app` alias. Alias removed.
- No domain, DNS, app, Auth or database change.
- Tests: Node 9/9, browser smoke 30/30, app build passes.

### 2026-10-18 15:53 SAST — Public website released on www.taxiflow.co.za

- Released commit `c55b990` as deployment `dpl_CY4Rbhm3LGfcAwZwSDQoogA5TRYd` (promoted from the reviewed Preview; 18/18 files identical by SHA-1).
- All other project URLs are protected (302); `taxiflow-website.vercel.app` returns 404.
- www moved from `taxiflowpro` (308 redirect) to `taxiflow-website`. HTTPS, assets, the mobile menu, Log in and the planner were verified live.
- The app is unchanged. PR #4 is open.
- Rollback: `05-build/public-website.md`.

### 2026-10-18 — Platform admin released to production (PR #3)

- **Pre-release backup:** PASS (`f04778a7…`, off-machine hashes match).
- **File 05:** applied; checks PASS.
- **Grant:** `apprigate@gmail.com`.
- **Merge:** PR #3 merged as `af3e5ad`. The build `dy1a1k761` was verified (sign-in renders; platform and memberships 401 without a token), then promoted at 16:20 SAST.
- **Unchanged:** data (membership and snapshot fingerprints) and www.
- **After-release backup:** PASS (`62345aea…`, off-machine hashes match).
- **Signed-in checks:** still pending; the pane had no session.
- **User-verified** (Tebogo, own browser): the Companies button is visible; only TaxiFlow Pro is listed; the role is still Admin; existing records are visible after a refresh.
- **Unverified in production:** the Owner, Driver, Admin-grant, non-member and Owner-minting restrictions (proven locally only).
- **Remaining rollout blocker:** DKIM, which blocks real Owner invitations.

### 2026-10-19 — Local company-onboarding rehearsal (synthetic, local stack only)

**Changed by:** Claude Code, with Tebogo's go-ahead. Local machine only; no production, repo code or tests changed.

- **Docker fix (local).** Docker Desktop is installed inside the Claude app's package storage, so it only starts in that context: `Invoke-CommandInDesktopPackage -PackageFamilyName Claude_pzs8sxrjxfjjc -AppId Claude -PreventBreakaway -Command "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"`. After the Windows build moved to 26300, `wsl.exe --mount` could no longer reach the data disk at the real path (`ERROR_PATH_NOT_FOUND`). Added a reversible junction `%LOCALAPPDATA%\Docker\wsl` → `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Docker\wsl`; nothing deleted, reset or reinstalled. Rollback: `rmdir "%LOCALAPPDATA%\Docker\wsl"`.
- **Isolation evidence:** `verify.mjs` 14 PASS, 2 FAIL (exact-count baseline only: 16 users, all `@example.com`; 4 snapshots, 0 live traces; extra rows are earlier test data). Auth SMTP is the local Mailpit container, which has no relay configured.
- **Rehearsal (runbook flow), company "Rehearsal Taxis" (Tenant 5):**
  1. platform admin `admin@example.com` created the company and Owner; the console states it gives no access to the company's data;
  2. the Owner set a password from the Mailpit email (the page was branded with the company);
  3. the Owner added a driver profile plus Driver, Manager and Admin logins;
  4. set-up data (route RH-01, vehicle RHL 001 GP) loaded with `scripts/localdb/load-business-data.mjs`: dry run, apply, repeat run showed "No changes";
  5. the Driver captured R300 and sent the day checking;
  6. the Admin counted R300; the Admin cannot verify, edit or delete;
  7. the Manager verified it;
  8. the Manager finished deposit `TFP-MON-1019-01`.
- **Separation:** Driver and Manager tokens get 403 for another company's workspace and for the platform list; the Driver's memberships call returns only its own role. In the database, the record is `banked`, the 4 memberships are in Rehearsal Taxis only, and the other companies' snapshots are unchanged.
- **Findings, all expected or minor:**
  - creating a route in the app's Fleet screen is refused ("not available in the business workspace yet"), so set-up stays loader-only, as Project OS states;
  - the loader requires `business.name` in the file (refused safely without it);
  - in this local company, the Manager can finish the deposit without any extra grant.

### 2026-10-19 — Owner permissions findings (inspection only; no code changed)

**Correction to the rehearsal entry above:** loading routes and vehicles with the loader was a rehearsal workaround, not a fix for Add Route. DKIM passing is not the readiness gate on its own (see next-action).

- **Add Route / Add Vehicle refused (by design, unfinished).** Business-workspace (tenant) mode has no whole-snapshot save: `dataGateway.persistSnapshot`, `commitLiveSnapshotMutation` and `callUserLifecycleApi` return `TENANT_UNSUPPORTED_MESSAGE` (`src/App.jsx` ~1104/1182; `src/lib/tenantWorkspace.js:19`; `tenant-design.md` §344). Writes exist only as explicit server actions: `api/business/finance-actions.js` (finance) and `api/business/members.js` (access). There is no route, vehicle or defect action.
- **Add Driver, local success vs earlier failure.** The code is identical: deployed `af3e5ad` and local `HEAD` differ only in Project OS. Both runs are tenant mode. Two different paths:
  - Settings → Business access → "Add driver profile" (`driver.save_profile`) works, but only for an **Owner** (`assertOwner`, `tenantOnboarding.js:213`);
  - Drivers module → "Save driver" (`saveDriver` → snapshot commit or lifecycle API) is refused.
  - The earlier failure is most likely the Drivers module, or Settings used as an Admin. In production, `apprigate@gmail.com` is an Admin in Tenant 1, so it would get "Only an Owner can manage access". Not yet confirmed with the user's screen or error text.
- **Permissions that exist:** Owner grants, deactivates or reactivates Admin, Manager or Driver; driver profiles; owner-driver link; role-fixed finance rules (`api/_lib/financeActions.js:22-34`):
  - hand-in: Owner, Admin;
  - verify: Owner, Manager;
  - bank (`deposit.lock`): Owner, or Manager with `moduleAccess.finance` = true;
  - module view switches are stored in `snapshot.appUsers`, applied by `tenantAuth.js:226-240`, and can only narrow access.
- **Permissions that are missing:**
  - per-person count, verify and bank switches;
  - a fleet (route/vehicle) management permission, and its server actions;
  - drivers management delegable to a Manager;
  - delegable staff-permission management;
  - any screen for `member.update` (the server accepts module switches; the panel has none).
- **Current Manager banking rule:** a Manager can bank whenever their Money access is on. Since `d3adf04` that is the default, so every Manager can bank unless restricted, and in tenant mode no screen can restrict them.
- **verify.mjs failures fully explained.** Line 48 expects 11 users (`SEED_USERS` + `TENANT_USERS`) and found 16 before the rehearsal. Line 53 expects 2 snapshot rows and found 4. The extras are 5 users and 2 companies created by `scripts/localdb/platform-admin-tests.mjs` (2026-10-18 11:57–11:58, run without a later reset), plus the rehearsal's 4 users and 1 company. The safety parts pass: 0 non-example.com users, 0 live traces, 0 unmapped rows.

### 2026-10-19 — Owner-assigned responsibilities and tenant route/vehicle/driver saves (release file 06; local + Preview only)

**Changed by:** Agent (Claude), branch `agent/owner-responsibilities` (commit `7f1419b` + docs), from `0b02435`; `origin/main` = `af3e5ad` unchanged.

**Files changed:**
- Server: `api/_lib/tenantAuth.js`, `api/_lib/financeActions.js`, `api/_lib/financeRecordActions.js`, `api/_lib/fleetActions.js` (new), `api/_lib/tenantOnboarding.js`, `api/business/members.js`, `api/business/workspace.js`
- Shared: `src/lib/memberPermissions.js` (new), `src/lib/fleetRecordContract.js` (new, verbatim move from `appRuntime.js`, bundle parity proven), `scripts/pilot/business-data-plan.mjs` (shares `normalizeRegistration`)
- UI: `src/App.jsx`, `src/components/TenantAccessPanel.jsx`, `src/lib/tenantWorkspace.js`
- Database: `scripts/localdb/migrations/20261019090000_member_permissions.sql` (release file 06), rollback `scripts/localdb/rollback/20261019090000_member_permissions.down.sql`, `scripts/hosted/apply-release.mjs` (06 entry), `scripts/localdb/setup.mjs`
- Isolated test stack: `scripts/localdb/lib/localTarget.mjs` profiles (`default` = rehearsal 54321-54324/5175; `test` = 55321-55324/5176, own project, volume and containers), `exec.mjs`, `mailpit.mjs`, `dev-tenant.mjs`, `playwright.localdb.config.mjs`
- Tests: `tests/member-permissions.test.mjs`, `scripts/localdb/member-permissions-tests.mjs`, `scripts/localdb/member-permissions-migration-tests.mjs`, `tests/localdb-browser/tenant-fleet-saves.spec.js`; fixture/locator updates in `tests/finance-actions.test.mjs`, `tests/finance-record-actions.test.mjs`, three localdb browser specs (my new checkbox labels contain "driver profiles", so the loose `getByLabel("Driver profile")` became ambiguous; now the combobox); `tests/localdb-guard.test.mjs` (+5 profile tests)
- Docs: `04-technical/auth-and-roles.md`, `04-technical/tenant-design.md`

**Summary:** Membership responsibilities `cash.count`, `cash.verify`, `cash.bank`, `drivers.manage`, `fleet.manage`, enforced by the server from the membership row on every request and capped by module access. Only an active Owner changes them (`member.permissions`), never their own, never Owners/Drivers; roles, sign-ins and responsibilities are not delegable. File 06 backfills the pre-06 rules (Admin count; Manager verify + bank), so nobody's effective access changes on migration; before file 06 the server falls back to those defaults. New tenant server actions `route.save`, `vehicle.save`, `driver.save` (same CAS/replay pipeline; same-business ids only; loader integrity rules; money keys verified unchanged; finance statuses untouched; driver profiles accept no email/password/login). `driver.save_profile` is delegable via `drivers.manage`. Owner controls in Business access; Fleet/Drivers forms wired; Money buttons follow responsibilities. Remaining unsupported actions are labelled in the screens (see tenant-design.md).

**One intentional tightening:** an Admin whose Money module is switched off can no longer record a hand-in by direct request (before, only the screen hid it). Required by "a permission must not bypass module access".

**Tests run (all on the isolated `test` stack, fresh reset before each; the rehearsal stack was never reset):**
- Unit: 36/36 files pass (incl. new `member-permissions.test.mjs` 8/8); `vite build` passes.
- DB/API with real local Auth: `member-permissions-tests` 72/72 (allowed and refused for every responsibility; removing banking refuses the next direct `deposit.lock` and writes nothing; module off blocks; delegated driver management cannot grant/update/remove sign-ins, link drivers or change responsibilities, Auth and memberships unchanged; no self-escalation; cross-company reads/writes and forged route/vehicle/driver ids refused; Business B byte-identical; stale version writes nothing; replay applied once; Owner protections; Driver privacy).
- Migration: `member-permissions-migration-tests` 24/24 (backfill preserves per-role rules, idempotent, stale version, cross-business, role-change reset, service-role-only grants, rollback/re-apply, release-06 code on a database without file 06).
- Regression: finance-action 56/56, finance-record 36/36, finance-capture 43/43, expense-only 32/32, onboarding 64/64, tenant access 36/36, tenant rollback 8/8, server-auth 26/26, business-data-load 46/46, platform-admin 75/75.
- Hosted copy (exact live schema + release files 01-06): hosted-rehearsal 22/22; permissions suite on that database 72/72.
- Browser: localdb suite 12/12 (11 in the full run + the fleet spec rerun after locator fixes); new spec proves the Owner grants in Business access, then a Manager's route, vehicle and driver saves survive a full reload and are in the database, attributed to the Manager, with no sign-in created. Mock-mode suite 34/34.
- Preview `https://taxiflowpro-nifglxqz9-apprigate.vercel.app` (`dpl_3cHiRw19RhdKQ34EyPyXiNWLkJqP`, READY, built from `7f1419b`), read-only via the user's Vercel-authenticated browser: sign-in renders; `/api/business/workspace`, `/members` GET and `finance-actions` `route.save`/`vehicle.save`, `members` `member.permissions` POST return 401 (no token and garbage token), all `no-store`; `driver.save` with an email returns 400 before authorization. Signed-in Preview checks are impossible by design (Preview has no service-role key; fails closed 503).
- Rehearsal database fingerprint (users 20, memberships `edac9fdb…`, 5 snapshots) identical before and after.

**Expected fixture-count differences (not safety findings):** `verify.mjs` exact counts on the rehearsal stack still differ for the reasons logged earlier today (platform-admin test data + rehearsal company). The test stack is reset before each suite, so its counts are the seed's.

**Result:** Pass.

**Risks remaining:**
- Production has file 05 only; file 06 and this code are not deployed. Deploying the code before file 06 is safe (defaults), but the Owner controls return 503 until file 06 is applied.
- No segregation-of-duties rule: the Owner can give one person both counting and verifying.
- Not available in the business workspace yet: archive vehicle, defects (log/resolve), service/document records, shift allocation page, expense presets, settings/profile saves, role change in the UI, custom roles, driver email edits.
- Owner and Driver restrictions remain unverified in production (unchanged).

**Next action:**
- Review the PR; on authorization follow the release steps in next-action.md (backup, file 06, merge, promote, checks).

### 2026-10-19 — Acceptance gaps: delegated staff management, separation of duties, isolated Preview backend (in progress)

**Changed by:** Agent (Claude), branch `agent/owner-responsibilities` (PR #6). Production on hold; nothing deployed or migrated in production.

**Files changed:** release file 06 (`scripts/localdb/migrations/20261019090000_member_permissions.sql`, edited in place: it is unreleased) and its rollback note; `src/lib/memberPermissions.js`; `api/_lib/tenantOnboarding.js`; `api/_lib/financeActions.js`; `api/_lib/financeRecordActions.js`; `src/components/TenantAccessPanel.jsx`; `src/App.jsx`; tests `tests/member-permissions.test.mjs`, `scripts/localdb/member-permissions-tests.mjs`, `scripts/localdb/member-permissions-migration-tests.mjs`; new `scripts/preview-test/` (`build-schema.mjs`, `schema.sql`, `verify-schema.sql`, `seed-hosted-test.mjs`), `tests/preview-test/preview-journey.spec.js`, `playwright.preview-test.config.mjs`; `playwright.config.mjs` (ignores `preview-test`); `04-technical/auth-and-roles.md`, `04-technical/tenant-design.md`.

**Summary:**
1. **Delegated staff management (`staff.manage`, "Manage staff responsibilities").** Given and removed only by the Owner. A holder may add or remove for another Admin/Manager only responsibilities it currently holds (effective, so module switches also limit it); never `staff.manage`, never its own entry, an Owner, a Driver, another holder of `staff.manage`, or another business; never roles or sign-ins. Enforced by the server (current membership, per request) and again inside `set_member_permissions`. Every change writes one row to the new tenant-scoped audit table `public.member_permission_changes` (business, actor, actor role, target, before, after; RLS forced, no browser access, kept on rollback) plus the business audit entry. Holders can read the access list; the Business access screen shows only the checkboxes they may change.
2. **Separation of duties.** `cashup.verify` and `income.verify` refuse (403) when the requester recorded that count (`countedBy`), for every role including the Owner. One person may still hold both counting and verifying. Consequence: a business where the Owner works alone needs a second person to verify the Owner's counts.
3. **Isolated Preview backend.** New free Supabase project `taxiflow-preview-test` (`sxoonhovoqgcpflhqirb`, eu-west-1, Tebogo-approved, quoted $0). Vercel Preview variables scoped to branch `agent/owner-responsibilities` only: `VITE_SUPABASE_URL`, `SUPABASE_URL` (test project) and `VITE_SUPABASE_ANON_KEY` (its public anon key). Production variables untouched. Two connector migrations to the test project returned `{"status":"declined"}` from the Supabase MCP server in 1.7-2.3 s with Claude Code permission "accept" and no prompt recorded (assessed as an automatic rejection of its destructive-statement confirmation). Not retried. The first attempt also inserted synthetic accounts by SQL; Tebogo chose no accounts via SQL, and that approach was removed. Instead: `scripts/preview-test/schema.sql` (schema only, generated from release files 01-06, refuses non-empty projects) for Tebogo to run in the SQL editor, and `scripts/preview-test/seed-hosted-test.mjs` (test sign-ins, companies, set-up data and access through the app's own operator functions; secret key from an env file outside the repo; dry run by default; typed ref to apply).

**Tests run:**
- Unit: all files pass; `member-permissions.test.mjs` 10/10 (delegation limits, separation of duties); `vite build` passes.
- Isolated local test stack (fresh reset each): `member-permissions-tests` 101/101 (adds 29 checks: delegated limits, direct database-function refusal, audit rows tenant-scoped with before/after, browser cannot read the audit table, removing `staff.manage` blocks the next delegated change, self-verification refused for day and standalone income via direct API, another verifier succeeds); `member-permissions-migration-tests` 25/25 (audit table kept on rollback); finance-action 56/56; finance-record 36/36; onboarding 64/64; localdb browser 12/12.
- `schema.sql` on a fresh EMPTY local Supabase (no migrations, no seed): applies cleanly; `verify-schema.sql` 10/10 true (6 tables, permissions column, RLS everywhere, only the two intended authenticated SELECT grants, no browser-executable functions, 5 server functions for service_role, no snapshot policies, RLS forced on platform_admins and the audit table, 0 users/businesses/snapshots, no local-only schema); a second run refuses ("TaxiFlow tables already exist").
- Rehearsal database: not touched.

**Result:** parts 1 and 2 done and proven locally. Part 3 waiting on Tebogo (schema run in the test project's SQL editor; the test project's secret key in an env file outside the repo and in the branch-scoped Vercel variable).

**Risks remaining:** the hosted journey has not run yet. No bypass secret exists yet (to be created for the run and revoked after). Signups are open by default on the new test project (an account without membership has no access).

**Next action:** see next-action.md "Hosted Preview journey".

### 2026-10-19 — Isolated Preview test schema applied (Tebogo) and verified (agent, read-only)

**Changed by:** Tebogo (via ChatGPT) applied `scripts/preview-test/schema.sql` from `cd329d3` to `sxoonhovoqgcpflhqirb` (taxiflow-preview-test) as Supabase migration `preview_test_schema_releases_01_to_06` (version 20261019191640); SHA-256 `e7280981…5431651` matched. Agent: read-only checks only.

**Tests run:** `list_migrations` shows exactly that one migration; `verify-schema.sql` re-run read-only: 10/10 true, users=0 businesses=0 snapshots=0; security advisor: one INFO lint (RLS enabled without policies on finance_action_requests, member_permission_changes, platform_admins, workspace_snapshots — intended: server-only tables).

**Result:** Pass. The schema must not be rerun (it refuses non-empty projects anyway).

**Next action:** Tebogo: the test project's secret key (env file outside the repo; branch-scoped Vercel `SUPABASE_SERVICE_ROLE_KEY`), then `seed-hosted-test.mjs`. Production on hold.

### 2026-10-19 — Authenticated hosted Preview journey on the isolated test backend: PASS

**Changed by:** Agent (Claude), under Tebogo's authorization of 2026-10-19 (test-only seeding, Preview deployment, hosted verification, bypass removal). Branch `agent/owner-responsibilities`. Production untouched (no merge, migration, promotion or onboarding).

**What was done:**
- `seed-hosted-test.mjs`: added `--confirm-ref` (exact `sxoonhovoqgcpflhqirb`, still behind `--apply` and every target/production guard; a wrong ref was proven refused before any write). Other operator scripts unchanged. Seeded test project `sxoonhovoqgcpflhqirb` through the app's own functions: 6 synthetic `@example.com` sign-ins (password only in git-ignored `.env.preview-test.local`), Preview Company A (Owner, Admin, Manager, Driver `pv-drv-01`; route Rank A to Rank B; vehicles PV TEST 01/02) and Preview Company B (Owner, Manager; route, driver profile, vehicle). Database trigger applied role defaults (Admin cash.count; Manager cash.verify, cash.bank).
- Defect found and fixed (configuration): the branch-scoped Preview `SUPABASE_SERVICE_ROLE_KEY` held no usable value (server answered "Supabase server configuration is incomplete", 503). Replaced from the external env file by piping, never displayed; still Preview + this branch only. Redeployed: `taxiflowpro-n8yesi8bq-apprigate.vercel.app`.
- Test fixes (no app code changed): stops on a route with named stops are dropdowns (located by caption); seeded registrations are stored normalized ("PV TEST 01"); the journey re-issues API tokens after each browser sign-out; the fleet test resets the Manager to role defaults so it can be rerun.
- **Incident (found and closed):** the earlier read-only `vercel curl` attempt (17:21:27 UTC) silently created an automation protection-bypass secret on the project (exposed to deployments as an env var). It existed until this run and was used as the run's temporary bypass, then revoked. The Project OS statement "bypass secrets: 0" was untrue between 17:21 and the revocation. Do not use `vercel curl` on this project.
- **Observation (not changed, outside scope):** the app's Sign out ends all of that user's sessions on every device (Supabase global sign-out).

**Tests run (Preview `taxiflowpro-n8yesi8bq-apprigate.vercel.app`, dpl via `vercel redeploy` of `e78e4b3`; isolated backend):**
- Target guard: bundle carries the test project URL and anon key and no production ref; unauthenticated 401; Owner workspace 200; Company B's Manager refused Company A's workspace (403) and a route save into A (403).
- Full cash workflow in the browser: driver trip + safe-paid expense, refresh, checking sent; Admin records hand-in R380; Manager verifies; Owner finishes the deposit; after reload Finish deposit is disabled. PASS (1.4 min).
- Owner gives the Manager fleet and driver management in Business access; the Manager creates a route, a vehicle and a driver profile; all survive a full reload and are read back from the server attributed to the Manager. PASS.
- Owner unticks banking in Business access; the Manager's next direct `deposit.lock` is refused (403, "Bank verified cash") and the version is unchanged. PASS.
- Delegation: Admin without staff.manage refused; after the Owner gives staff.manage, the Admin adds counting to the Manager (200) but cannot remove fleet management (403, not held), pass on staff.manage (403), raise itself (403), change the Owner (403) or grant a sign-in (403); after removal, the next delegated change is refused. Audit table rows in Company A only: Owner 8, Admin 1. PASS.
- Separation of duties via direct API: the driver captures a day; the Manager (count + verify) records the hand-in, its own verification is refused (403); the Owner verifies (200). PASS.
- Totals: 6 hosted tests passed (cash workflow on run 4; the other 5 together on run 7, same deployment).

**Cleanup:** automation bypass secrets now 0 (verified; deployment protection still on); the local bypass copy deleted; Preview without Vercel login now redirects to sign-in (302). Left in place for further testing (Tebogo to decide): test project data, the four branch-scoped Preview variables, the external env file.

**Result:** Pass.

### 2026-10-20 — Release 06 review completed (production on hold)

**Changed by:** Agent (Claude). Branch `agent/owner-responsibilities`, commits `ac10ed1` (file 06 restore-fidelity fix, post-check SQL, review document) and `c3f6eda` (test ports, hosted check).

**Decisions recorded (Tebogo):** separation of duties binds everyone, including the Owner; the cash workflow requires a second authorized person to verify every count. Sign-out (ends that user's sessions on every device) stays unchanged and is documented.

**Defect found and fixed:** file 06's insert trigger gave role defaults to any Admin/Manager row inserted with an empty list, so a full backup restore would have re-granted "Receive and count cash" to an Admin the Owner had emptied. Fixed: no column default after the backfill; defaults only for NULL; add-and-backfill only when the column is new.

**Final release file 06:** `scripts/localdb/migrations/20261019090000_member_permissions.sql`, SHA-256 `09dd1e33112108f0a17d8645ec9fb3294c8139ba56fc391508ab8699d676b30c`; rollback `6ab9f636…a8e51` (full hashes in `05-build/release-06-review.md`).

**Tests on the final file 06 (isolated local stack):** migration 30/30; backup 37/37; permissions 101/101; onboarding 64/64; finance-action 56/56; tenant access 36/36; platform-admin 75/75; backup-premigration 13/13 (second attempt: the first ran after `reset` instead of its required `setup.mjs hosted-pre` and stopped before any assertion); production-path rehearsal 11/11. Production credentials verified by variable names/targets and the live bundle; app source has no test-project reference.

**Interruptions (not code failures):** 2026-10-19 23:37 machine resource exhaustion crashed Docker mid-run (finance-action stopped after 41 passes); after a reboot, Windows reserved ports 55227-55326 so the test stack moved to 45321/45322/45324 (one failed retry where no tests ran). Bypass secrets: 0 throughout this round.

**Hosted alignment:** the hosted test project still runs the earlier file 06 (verified read-only: both `verify-delta-06.sql` Part A checks false). Delta `scripts/preview-test/delta-06-restore-fidelity.sql` (`76bab4d5…724e9`) and targeted check `scripts/preview-test/verify-delta-06.sql` (`68fd6494…0112a`) are ready for Tebogo to run in its SQL editor. Not aligned until verified.

**Known limit:** the backup does not include `member_permission_changes` (audit history) or `platform_admins`; rollback keeps both. Recommended before the first real business: add them to the backup.

**Result:** release review complete; recommendation GO for a controlled release once authorized.

### 2026-10-20 — Release gaps: hosted delta applied; backups cover platform admins and audit history

- Hosted test project `sxoonhovoqgcpflhqirb`: `delta-06-restore-fidelity.sql` applied via the Supabase connector (success). `verify-delta-06.sql` Part A: both true. Part B was automatically declined by the connector (destructive statements) and not run; read-only fingerprint unchanged. Pending: Tebogo runs Part B in the SQL editor (expect "PASS (rolled back)").
- Backup tool (`scripts/backup`): tenant export now includes `platform_admins` and `member_permission_changes` when present (probe; older backups and pre-06 databases stay valid); full restore inserts them in dependency order with empty-target and count guards; restore comparison and manifest cover them; one-business restore unchanged. Tests: `backup-tool.test.mjs` 10/10; `backup-tests.mjs` 43/43 on the isolated test stack (grant and audit row restored exactly; RLS forced and no browser grants after restore; browser read refused 42501).
- Production on hold.

### 2026-10-28 — In-app "How to use TaxiFlow" guide (post-login)

**Changed by:** Agent (Claude). Branch `agent/user-guide` (stacked on `agent/owner-responsibilities`), draft PR #7; PR #6 unchanged.

**Finding:** no onboarding or help guide existed in the app code; only the sign-in "forgot password" help toggle and a "Fleet & Operations onboarding" panel title.

**Files changed:**
- `src/lib/userGuide.js` (new): role/module/permission-aware content; per-user, per-business completion in localStorage via `browserRuntime` helpers.
- `src/components/UserGuideSheet.jsx` (new); `src/components/MobileBottomSheet.jsx` (optional `className`, `closeLabel`).
- `src/App.jsx`: guide key/open state, Help button, sheet render. Role routing, auth, snapshot keys, status values and `dataGateway.js` untouched.
- `src/styles.css`: scoped `.user-guide-*` styles (44px targets, centred on wide screens, reduced motion).
- Tests: `tests/user-guide.spec.js`, `tests/user-guide.test.mjs`, `tests/localdb-browser/user-guide-tenant.spec.js` (new); `tests/user-guide-helpers.mjs` registers a skip handler in every existing suite's sign-in helper so other journeys are unaffected.
- `project-os/11-client-delivery/client-training-notes.md`: what users see, by role.

**Defect found during testing and fixed:** keying the business on `snapshot.meta.businessId` made the guide vanish for Drivers (a local driver-terminal update replaces `snapshot.meta`, so the key went null). Evidence: instrumented sign-ins on the local tenant stack. Fix: key on `tenantMeta.businessId`, the same source as the business bar. One earlier local-suite failure was an artifact clash from a parallel Playwright run (shared `test-results`), not a code fault.

**Tests run:** mock Playwright 43/43; local tenant browser suite (isolated test profile, fresh reset) 15/15; `node --test tests/*.test.mjs` 367/367; `test:sync-guards`; `npm run build`. Visual check by screenshots at 1280px and 360px.

**Result:** Pass locally. Not deployed.

**Risks remaining:** not tried on a physical low-spec Android phone; hosted UAT and preview-test suites not run (they include the skip handler). Completion is per browser, so a new phone shows the guide once more.

**Next action:** review PR #7; merge after #6, then retarget to `main`.

### 2026-10-28 — Repository context corrected; driver salaries (draft PR #8)

**Changed by:** Agent (Claude). Branch `agent/driver-salary`, commit `bd063c5`, draft PR #8 (base `agent/user-guide`). PR #6 / `agent/owner-responsibilities` untouched at `51a0f5d`.

**Context:** a correction suggested PR #6 belonged to a separate client-workspace project. Verified here: `Tebza102/taxiflowpro` PR #6 is TaxiFlow release 06, open draft; no client-workspace branch exists. Tebogo confirmed the repository evidence takes precedence; the stack #6 -> #7 -> #8 stays.

**Files changed:** `src/lib/salaryContract.js` (new, shared rules), `api/_lib/salaryActions.js` (new), `api/_lib/financeActions.js` (registers 2 actions), `src/components/DriverSalaryPanel.jsx` (new), `src/App.jsx` (handlers, panel, edit guard for recorded salaries), `src/styles.css`, `src/lib/userGuide.js` (one sentence), tests `tests/salary.test.mjs`, `tests/driver-salary.spec.js`, `tests/localdb-browser/driver-salary-tenant.spec.js`, `tests/user-guide.test.mjs`; `project-os/04-technical/data-model.md`.

**Financial rules proven:** schedule adds no expense and stays out of totals; one expense per driver and period (form block + server 409); paid and scheduled amounts kept after schedule changes; bank and cash salaries leave a driver's expected cash unchanged; report lines and totals count each payment once and reconcile; drivers and no-Money managers receive no salary data.

**Tests (final code):** Node 381/381; mock Playwright 44 passed + 1 timeout loading the sign-in page on the first test of the run (branding desktop; 6/6 on two reruns); local tenant suite 17/17 (fresh reset, isolated test profile); sync guards; build.

**Result:** Pass locally. Not merged, not deployed.

**Outstanding:** real Android phone; hosted Preview UAT/preview-test; spreadsheet check of the CSV by a real user. The "previously supplied" salary prompt was not available; the rules given on 2026-10-28 were implemented.

### 2026-10-28 — Driver salaries reconciled with the original requirements (`a8dac17`, PR #8)

**Changed by:** Agent (Claude). Branch `agent/driver-salary` (base `agent/user-guide`); PR #6 still `51a0f5d`, PR #7 still `99cf0c6`.

**Gaps closed:** daily and fortnightly frequencies with period start/end/next (leap years, year end, Sunday-to-Monday, fortnight anchoring); payment method separate from source; salary from a driver's takings lowers that day's expected cash exactly once (linked to the driver day, pending, refused on a counted/closed day); manual payments without a schedule; schedule changes with an effective date; next payment date, scheduled and due amounts; salary lines in the daily finance report (PDF and preview) as well as the monthly CSV; `record.edit` refuses salaries.

**Reports/exports checked:** monthly expense CSV (Money > Expenses); daily finance report PDF `/api/admin/daily-log/:id/report-pdf` and preview `/report-view`. No other financial download exists in the app or API (the backup tool is a restore format).

**Tests (final code):** Node 385/385 (17 salary); mock Playwright 47/47 (4 salary); local tenant suite 18/18 on a fresh reset (3 salary, incl. server-side takings hand-in 700 -> 450 and counted-day refusal); sync guards; build.

**Hosted:** not run. General Preview variables use production's sign-in project (only `agent/owner-responsibilities` has the isolated test backend), so the auto-built Previews for `agent/user-guide` and `agent/driver-salary` use production sign-in with no server key and fail closed. The hosted salary spec needs branch-scoped test variables for `agent/driver-salary`: awaiting Tebogo's approval.

**Result:** Pass locally. Not merged, not deployed.

### 2026-10-28 — Hosted Preview check of driver salaries: PASS; cleaned up

**Changed by:** Agent (Claude), under Tebogo's approvals of 2026-10-28 (restore only the isolated test project; branch-scoped Preview variables; temporary bypass; hosted runs; cleanup).

**Cost check before restoring:** organization Apprigate is on the Free plan; Supabase does not bill paused projects or restores; 2 active free projects allowed and only production was active. No plan change, no charge.

**Steps and evidence:**
- Restored `taxiflow-preview-test` (`sxoonhovoqgcpflhqirb`) to ACTIVE_HEALTHY. Read-only checks 13/13: 6 tables, release-06 permissions column, RLS on (forced on the 2 server-only tables), no browser grants, no anon-executable functions, 5 service-role functions, delta-06 rules (no default; defaults only for NULL), only synthetic `@example.com` users (6) and Preview Company A/B.
- Added 4 Preview variables scoped to `agent/driver-salary` (URL x2, public anon key, server key piped from the external env file, never displayed). Redeployed `e46ba96` -> `taxiflowpro-nry1tv6fk`; later auto-build of `4370dce` -> `taxiflowpro-fcuys737n`.
- Temporary automation bypass created from a locally generated value (stored only in the git-ignored `.env.preview-test.local`, never printed); baseline 0 -> 1.
- Target guard first (before any sign-in): bundle carries `sxoonhovoqgcpflhqirb.supabase.co`, no production ref, the salary build; 401 unauthenticated. PASS on both Previews.
- Runs: on `nry1tv6fk` salary 4/4; release-06 journey failed at its fixed day 2026-10-08 ("day checking ... is banked; new work for that day cannot be added", correct app behaviour) and then because the driver board shows the most recent unbanked day. Fixes (test-only): the journey now picks the day after the driver's latest activity. Found and fixed an app gap: server salary records lacked `timestamp` (now 12:00 SAST on the paid date, like other server captures). On `fcuys737n` (`4370dce`): release-06 journey 6/6; salary journey 4/4 after a test-only fix (the driver legitimately sees takings salaries from earlier runs too).
- Cleanup: bypass revoked (0 entries; protection on; Previews 302 to login); local bypass copy deleted; 4 branch variables removed; test project paused.

**Not changed:** production (project `vfxftviwteypasredjgm` only listed, never queried), PR #6/#7 branches, billing. Nothing merged or promoted.

**Outstanding:** real Android phone; a real user opening the CSV in a spreadsheet app; optional Preview-scope decision (general Preview variables equal production sign-in).

### 2026-10-28 — Preview configuration corrected: production Supabase settings are Production-only

**Changed by:** Agent (Claude), approved by Tebogo. Vercel project `taxiflowpro` configuration only; no code, no production deploy.

**Change:** removed the Preview environment from `VITE_SUPABASE_URL` (`GI8rLthQfc03IvSJ`), `VITE_SUPABASE_ANON_KEY` (`vtTUkEj1aZ8NBahD`) and `SUPABASE_URL` (`Wfm4tf0xNpI9a5uy`) via PATCH of `target` only (no values sent). Production scope and values, the production server key, `VITE_BACKEND_MODE` and release 06's four Preview overrides unchanged.

**Verification:** redeployed `agent/user-guide` `99cf0c6` -> `taxiflowpro-6ngbg58jb`; with a temporary bypass: built assets contain no Supabase URL, no production or test ref, no key-like JWT; endpoints 401 unauthenticated and 503 with a token; the browser shows "Secure sign-in is unavailable" with no sign-in form or demo data and contacts no external host; production `taxiflow.co.za` loads its normal sign-in (200). Bypass revoked: 0 remain.

**Kept (Tebogo):** the 18 older Previews inferred (from build times vs variable history) to carry production settings stay behind Vercel login; not deleted.

**Outstanding:** real Android and spreadsheet checks (`06-quality/manual-checks-guide-and-salary.md`).


### 2026-10-29 — Business and vehicle reports (Prompt 1), branch `agent/period-reports`

**Changed by:** Agent (Claude Code)

**Files changed:**
- `src/lib/periodReport.js` (new, shared calculations), `api/admin/reports/period.js` (new endpoint: json/csv/pdf), `api/_lib/periodReportPdf.js` (new PDF), `api/_lib/dailyFinanceReportPdf.js` (exports brand helpers only), `src/components/PeriodReportSection.jsx` (new), `src/components/ReportsPanel.jsx`, `src/styles.css`, `vite.config.js` (dev route)
- Tests: `tests/period-report.test.mjs` (13), `tests/period-reports.spec.js` (7), `tests/localdb-browser/period-reports-tenant.spec.js` (4), `tests/vercel-routing.test.mjs` (+1)
- Project OS: current-status, next-action, `04-technical/data-model.md`, `06-quality/manual-checks-guide-and-salary.md` (section C)

**Summary:**
The monthly expense CSV alone did not meet the reporting requirement. Reports now has Business and vehicle reports (scope Overall business / Individual vehicle; Daily, Weekly Mon-Sun, Monthly, Custom dates; View report; applied scope and dates shown; PDF and CSV of exactly the report shown). One server-built report per request feeds screen, CSV and PDF. Business costs without a vehicle and driver salaries are shown separately and never allocated to vehicles. Net result labelled "recorded income less recorded expenses", not profit. Historical limits disclosed in each report. The daily cash report is kept and its narrower purpose explained. Access is checked server-side before the request is read (Owner, or Admin/Manager with Money on; Driver/Viewer 403; no session 401; other business 403).

**Tests run:**
- Node unit suite: 399/399 (13 new period-report: periods incl. leap year and year-end week, invalid/reversed/over-long refused, first/last-day boundaries, SAST capture-time fallback, cents reconciliation, business expense without a vehicle counted once and in no vehicle report, salaries never in vehicle reports, cash checking/banking, legacy Salary disclosure, CSV figures and formula neutralising, permissions by role and Money access, HTTP 401/400, JSON/CSV/PDF agreement, PDF A4 + DEMO marking).
- Sync guards: pass. Build: pass.
- Mock Playwright: 54/54 (7 new: screen/CSV/PDF agree for the monthly business report; vehicle scope excludes shared costs; custom dates and stale-filter warning; Manager/Admin allowed, Driver/Viewer no Reports; daily cash report kept; endpoint 401 live; 360px width with no sideways scroll and 44px buttons).
- Local tenant suite (isolated test stack, fresh reset): 21/22 on the first run; the failure was the new spec navigating before sign-out finished (test defect, fixed by waiting for the sign-in screen); rerun of the new spec 4/4 (Owner/Admin/Manager 200 in all formats; Driver 403; business B Owner 403 on business A, 200 on B; Owner A's on-screen report is business A's live data).

**Result:** Pass.

**Risks remaining:**
- PDF layout not inspected by eye by the agent (no renderer on this machine); content asserted by tests. Samples sent to Tebogo.
- Not checked on a real phone, in a real spreadsheet app, or on a hosted Preview.

**Next action:**
- Tebogo reviews the sample PDF and the draft PR; Prompt 2 (salary settings in the driver profile) on request.

### 2026-10-29 — Salary settings in the driver profile (Prompt 2) and demo reports from the current demo workspace, branch `agent/driver-salary-profile`

**Changed by:** Agent (Claude Code)

**Summary:**
- Prompt 2: Drivers > Add driver / Edit profile has an optional Salary section on the one existing arrangement model (amount, frequency, start/effective date, payment timing, Active/Paused; shows current arrangement, next/due, amount history). Saving never records a payment. Money keeps payments and history, linked both ways. Arrangement `revision` stops silent overwrites (409); a change cannot start before the last change. Salary access = Money edit, independent of `drivers.manage` (and vice versa); `driver.save` refuses salary fields; projections for Drivers and no-Money managers hold no salary data. A saved profile with a refused salary keeps the form open with the inputs and the exact outcome next to the form; retry updates the same driver. Edits send routes only when the selection changed, so a text-only legacy route is left unchanged (this was a real refusal found by the tenant suite; editing existing drivers was not reachable in the UI before).
- Demo-report correction (separate commit): demo Reports (screen, CSV, PDF; business/vehicle and daily) are built from the current demo workspace through the shared calculations. Posted data is accepted only for `mode=mock`, never on a production server (403), never with a sign-in token (403), shape/size validated (400/413, incl. pre-parsed bodies), reduced to an explicit field allowlist on both sides.
- Verification: `scripts/verify-all.mjs` runs Node -> guards -> build -> demo browser -> fresh-reset isolated test-stack tenant suite, stops on failure, keeps logs and artifacts under `uat-reports/verify/<run>/`, and refuses to overlap (lock file). Reset targets only `taxiflow-localdb-test` (loopback 45321, guarded by `scripts/localdb/lib/localTarget.mjs`).
- Report polish: notes use the en-ZA amount format; the vehicle report no longer points to a Cash checking section it does not have. Report requests time out after 60 s with a clear message.

**Failures found and fixed during verification (evidence kept under `uat-reports/verify/`):**
- Tenant: profile save refused "A selected route does not exist" for a driver whose route is stored only as text (fixed: routes sent only when changed). Permission test signed in before sign-out finished (test fixed).
- Demo browser suite under the pipeline: the PDF request was cut off mid-test (trace: JSON 0.7 s, CSV 1.7 s, PDF no response) because the dev server watched the pipeline's own logs and traces in `uat-reports/` (Vite ignores only `test-results/`). Fixed: `server.watch.ignored` adds `uat-reports`. Run time went from ~10 min back to 5.5 min.
- Endpoint test expected POST to be 405; now PUT is 405 and a business-mode POST is 400 with no report.

**Tests run (final, `scripts/verify-all.mjs`):** Node 416/416; sync guards pass; build pass; demo browser 58/58 (run `2026-10-29T07-10-49-113Z`); tenant 27/27 after a fresh reset of the isolated test stack (same run). New: `tests/salary-profile.test.mjs` (8), `tests/demo-report-snapshot.test.mjs` (8, incl. reduced-vs-full report equality for every demo cash-up and vehicle), `tests/driver-salary-profile.spec.js` (4), `tests/localdb-browser/driver-salary-profile-tenant.spec.js` (5: profile + no payment + no salary in profile; payment -> server report once, no vehicle report; Driver refused; partial save + retry, one driver; salary-only vs driver-management-only Managers).
- Sample PDFs rendered to images (PyMuPDF in the session scratchpad only): 5 pages, 0 text outside the page, 0 overlapping text; visually readable. Sample CSV parsed independently: 21 lines, amounts numeric, lines = totals, split and net reconcile.

**Result:** Pass. Not merged or deployed.

**Risks remaining:** real phone, real spreadsheet app and hosted Preview not checked; a deployed demo (none exists) could not post session data.

**Next action:** review the draft PR; Prompt 3 (recurring fixed expenses) when supplied.

### 2026-10-29 — Recurring fixed expenses (Prompt 3), branch `agent/recurring-expenses`

**Changed by:** Agent (Claude Code)

**Files:** `src/lib/recurringExpenseContract.js` (new rules), `api/_lib/recurringActions.js` (new server actions, registered in `financeActions.js`), `src/components/RecurringExpensesPanel.jsx` (new), `src/App.jsx` (handlers, panel, local edit guard), `src/lib/periodReport.js` + `api/_lib/periodReportPdf.js` + `src/components/PeriodReportSection.jsx` (commitments), `src/lib/demoReportSnapshot.js` + `api/_lib/reportSnapshot.js` (demo allowlist + shape checks), `src/lib/salaryContract.js` (day-open check exported), `api/_lib/financeRecordActions.js` (payments not editable), `src/lib/userGuide.js`, `src/styles.css`; tests `tests/recurring-expenses.test.mjs` (9), `tests/recurring-expenses.spec.js` (3), `tests/localdb-browser/recurring-expenses-tenant.spec.js` (4), guide test (+1); Project OS.

**Summary:** recurring fixed expenses on the existing expense, permission and finance-action workflows (details: `04-technical/data-model.md`). Occurrences are calculated when the app opens or a report is built (no background process, stated in the app and the reports). Record payment is prefilled; each payment is one expense, once. Reports show scheduled commitments separately from recorded expenses.

**Tests run:** `scripts/verify-all.mjs` run `2026-10-29T07-47-49-202Z`: Node 426/426; sync guards pass; build pass; demo browser 61/61; tenant 31/31 after a fresh reset of the isolated test stack. After a one-string PDF wording change: Node 426/426, build, recurring demo spec 3/3 rerun. Sample PDFs (business 3 pages, vehicle 2 pages, `uat-reports/recurring-samples/`) rendered to images: 0 text outside the page, 0 overlaps, inspected visually. Sample CSV parsed independently: lines = totals, split and net reconcile; commitments section sums match its totals and are outside the expense totals.

**Result:** Pass. Not merged or deployed.

**Limitations:** no background job (occurrences appear when TaxiFlow is opened); frequency and first due date cannot be edited (stop and start a new schedule); real phone, spreadsheet app and hosted Preview not checked.

### 2026-10-29 — Phone fixes: report PDF download and compact mobile menu (branch `agent/phone-fixes`)

**Changed by:** Agent

**Files changed:**
- `src/lib/reportDownload.js` (new), `src/components/ReportFileStatus.jsx` (new), `src/components/PeriodReportSection.jsx`, `src/components/ReportsPanel.jsx`
- `src/components/MobileNavDrawer.jsx` (new), `src/App.jsx`, `src/styles.css`
- `tests/report-downloads.spec.js` (new), `tests/mobile-navigation.spec.js` (new)

**Summary:**
Two issues from real-phone testing of the demo over the phone hotspot.

1. *PDF report could not be downloaded.* Evidence: the server path is healthy. A Pixel 7 emulation over the LAN address got POST `/api/admin/reports/period?...format=pdf&mode=mock` 200 `application/pdf` 384 KB and a download; business (3 pages), vehicle (2) and daily (1) PDFs rendered with PyMuPDF. The difference on the real phone is the address: the demo is plain `http://` on a LAN IP, which is not a secure origin, and Chrome on Android warns about or blocks downloads from such pages. The app made this invisible: it always said "Downloaded <file>" after handing the file to the browser, offered no retry, the daily report had no timeout, and a non-PDF body would have been saved as a broken file. The exact message on the phone is not yet known (Tebogo to report; F4). Fix: one shared download path for the business, vehicle and daily PDFs (and the CSV). It uses a 60s timeout, checks the `%PDF-` header and refuses an unreadable body. The screen says "PDF ready: <file> (size)", never "Downloaded", and offers an Open PDF button (a real tap on a link to the kept file). A failure shows the reason and Try again. Filters, scope, permissions and the single server report are unchanged, so screen, PDF and CSV still reconcile.
2. *Mobile menu covered content.* The fixed translucent bottom bar had five columns for six modules, so it wrapped to two rows (about 130px) over the content. Replaced on small screens with a compact top bar (menu button, current page title), which also shows on short touch screens such as a phone turned sideways. The drawer is closed by default and opens only from the button; it closes after choosing a page, on the backdrop or on Escape. It reuses the sheet accessibility hook (focus trap, scroll lock, focus return), has 44px targets, `aria-current`, `aria-expanded` and a scrollable list, and lists exactly the role- and module-filtered pages. The bar is navy at 94% opacity with blur and white text. Desktop module buttons are unchanged.

**Tests run:**
- New `tests/mobile-navigation.spec.js` 4/4 (portrait, landscape 780x320 scrolling, Driver pages only, desktop unchanged) and `tests/report-downloads.spec.js` 4/4 (business, vehicle and daily PDFs complete with `%%EOF`; Open PDF hands over the same bytes; aborted and 500 responses show Try again, which then succeeds; an HTML body is refused and nothing is saved).
- Full `node scripts/verify-all.mjs` run `2026-10-29T13-52-13-750Z`: node 426/426, guards, build, mock 69/69 (61 before + 8 new), tenant 30/31. The one failure was `tenant-onboarding.spec.js:70` on the desktop access screen, which these fixes do not touch: after "Grant access" succeeded, the driver row still read "No sign-in" within the 5s assertion window. Re-run on a fresh test-stack reset `2026-10-29T14-11-12-059Z`: tenant 31/31. Recorded as a timing flake to watch, not fixed here.

**Result:**
Pass in automation. Real-phone check NOT passed until Tebogo confirms (manual checks section F).

**Risks remaining:**
- Over plain http on a hotspot, Chrome may still ask to keep the file; that is the browser, not the app. Production is https and is not affected.
- The desktop module card grid still appears at the top of each page on phones (content, not an overlay); unchanged by request scope.

**Next action:**
- Tebogo runs section F on the phone and reports what Chrome showed at F4.

### 2026-10-29 — Phone PDF still not saving (CSV saves): PDF handed over as a generic file; report errors logged (branch `agent/phone-fixes`)

**Changed by:** Agent

**Files changed:**
- `src/lib/reportDownload.js`, `tests/report-downloads.spec.js`
- `api/admin/reports/period.js`, `api/admin/daily-log/report-pdf.js` (server errors now logged)
- `vite.config.js` (dev server only: one log line per report request)

**Summary:**
Tebogo's retry on the phone: the CSV downloads but the PDF still does not. Both use the same browser download code, so the difference is the file itself.
- *Server excluded:* the period PDF renderer was stress-tested with phone-style demo data and rendered every case, business and vehicle; daily, monthly and wide custom periods. The data included emoji, accents, Chinese text, empty and 400-character fields, string amounts, a recurring schedule and entries without a vehicle. Before this change the handlers swallowed errors without logging; they now log any 500 to the server log (also useful on Vercel).
- *Remaining difference:* the PDF blob was typed `application/pdf` and the CSV `text/csv`. Recent Chrome on Android hands `application/pdf` to its built-in PDF viewer instead of saving a blob download. Fix: the PDF is handed over with the same bytes, typed `application/octet-stream` with the `.pdf` name, so it saves like the CSV and opens as a PDF from Downloads. The CSV is unchanged.
- *Evidence still needed:* no Android debug tools on this laptop, so the real phone could not be inspected directly. The dev server now logs each report request: route, format, status, bytes, time, browser and phone address, never bodies or tokens. Tebogo's next tap shows whether the phone's PDF request reached the server and returned 200.

**Tests run:**
- `report-downloads.spec.js` now also asserts the saved PDF is typed `application/octet-stream` with unchanged bytes; report, period-report and recurring specs 23/23.
- Full `verify-all` run `2026-10-29T14-50-43-880Z`: node 426/426, guards, build, mock 69/69, tenant 31/31.

**Result:**
Pass in automation. Real-phone check NOT passed until Tebogo confirms.

**Next action:**
- Tebogo retries Download PDF on the phone; the agent reads the `[report-dev]` lines for that request.

### 2026-10-29 — Real phone: PDF download CONFIRMED working (Firefox for Android)

**Changed by:** Agent (result reported by Tebogo)

**Summary:**
- The dev-server request log identified the phone's browser as **Firefox 158 on Android 16**, not Chrome as assumed in the previous entry. The phone's PDF requests (`POST /api/admin/reports/period?format=pdf&mode=mock`) returned 200 with complete PDFs (320 KB and 384 KB, about 0.3s), so the server was never the cause.
- With the PDF handed over as a generic file (`5110069`), Tebogo confirmed on the phone: **"the pdf is working now."** The cause was the browser's handling of a blob typed `application/pdf`; Firefox for Android has its own PDF viewer. Code and test comments now name Android browsers generally (Firefox observed), not Chrome only.
- Real-phone result: business report PDF download PASSED (Tebogo, 2026-10-29). Not separately confirmed on the phone: the vehicle and daily PDFs (same download code), and the mobile menu (manual checks F1-F3).

### 2026-10-29 — Hosted verification of the combined stack (#6-#12) and release review

**Changed by:** Agent, under Tebogo's instruction of 2026-10-29. Approved: restore only the isolated test project, branch-scoped test variables, temporary bypass, hosted runs, cleanup.

**Manual (real phone, Tebogo):** section F all PASS (menu portrait and landscape; business, vehicle and daily A4 PDFs) on Android 16 / Firefox 158. Rows A-E and B not marked; no evidence given.

**Repository state:**
- PRs #6-#12 are open drafts. The stack is linear (each branch contains the one below) and local heads equal remote heads.
- Only #6 carries a schema change (release file 06).
- Production deployment `taxiflowpro-dy1a1k761` (`af3e5ad`); `autoAssignCustomDomains: false`; `main` unprotected.

**Hosted:**
- Cost check: Free plan, only production active. Restored `sxoonhovoqgcpflhqirb`. Read-only checks: 6 tables, permissions column, RLS on every table, 6 synthetic users only, Preview Company A/B.
- Added 4 Preview variables for `agent/phone-fixes`; the server key was piped from the external env file after confirming it targets the test project, never shown.
- Pushed `0bd07d2` (adds `tests/preview-test/release-stack-journey.spec.js`; app = `cf75549`) -> Preview `taxiflowpro-lawb32hou`. Bypass 0 -> 1.
- Result: 16/16 on the first run (release-06 6, release stack 6, salaries 4). Target guards before sign-in: test project only, no production ref.

**Cleanup:**
- Bypass revoked; entries 0; local copy deleted.
- 4 branch variables removed (9 records, shared production settings still Production-only).
- Preview 302 without the bypass; test project paused (INACTIVE).

**Release review:** `project-os/05-build/release-stack-review.md`. Recommendation: GO, conditional on Tebogo's approval and a verified pre-release backup.

**Not changed:** production database, data, settings and deployment; no merge; billing.

### 2026-10-29 — Release prerequisites revised (no production change)

**Changed by:** Agent. Files: `project-os/05-build/release-stack-review.md` (rewritten sections 2-11), `release-06-review.md` (correction), new read-only `scripts/hosted/unchanged-data-release-06.sql`.

- **File 06 data change corrected:**
  - It backfills `business_memberships.permissions` on every existing row: Admin `{cash.count}`, Manager `{cash.verify, cash.bank}`, Owner and Driver `{}`.
  - No other column changes (no `updated_at` trigger exists) and no other table changes.
- **Verification defined:**
  - New `unchanged-data-release-06.sql` covers businesses, memberships except `permissions` (including `updated_at`), snapshots, request log, platform admins and Auth users. It must be identical before and after, in a quiet window.
  - `verify-release-06.sql` checks the intended changes.
  - Proved on the isolated local test stack (undo, hash, re-apply, hash): both hash sets identical; backfill exactly the role defaults; post-checks 10/11, with row 9 false only because the local undo keeps the seeded audit table. Stack reset afterwards.
- **Rollback compatibility proved:** a snapshot built by the new code (salary schedule, bank and takings salaries, recurring schedule and payment) was run through `af3e5ad` server code in a temporary worktree:
  - an old write applied and the new records were preserved byte for byte;
  - driver expected cash identical (450 under both apps);
  - old Driver and no-Money views stay scoped.
  - Application rollback, database undo and data restore are now separated; a data restore needs an explicit recovery decision.
- **Vercel configuration read:**
  - `autoAssignCustomDomains: false`; Git deployments on.
  - Production domains: `taxiflow.co.za`, `taxiflow.apprigate.com`, `taxiflowpro.vercel.app`. The current production deployment holds those plus `taxiflowpro-apprigate.vercel.app` and `taxiflowpro-git-main-apprigate.vercel.app`.
  - Public: `taxiflow.co.za` and `taxiflowpro.vercel.app`. The two team aliases need a Vercel login.
  - Whether the `git-main` alias follows `main` before promotion is unconfirmed, so there is a gate after the #6 merge and file 06 goes first.
- **Part B:** the test project is paused, so restore is a prerequisite. SQL-editor steps and the expected message are documented. The tool refusal was not bypassed.
- **Backup:** exact export and verify commands documented. The env file uses the session pooler (direct host is IPv6-only); an optional local restore rehearsal is left to Tebogo's decision.

**Not changed:** production database, data, settings, deployment; no merge; test project left paused; no new hosted runs.

