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