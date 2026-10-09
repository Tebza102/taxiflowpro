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