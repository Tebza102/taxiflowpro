# Agent Rules

These rules apply to every AI agent working in this repository.

## Operation Modes

### Plan Mode
Read first, diagnose, produce a plan. Do not edit code. List exact files to change and risks.
Use `/project-os/07-agent-control/opencode-planner-prompt.md`.

### Build Mode
Execute the approved plan only. Make minimal changes. Do not refactor unrelated code.
Use `/project-os/07-agent-control/opencode-builder-prompt.md`.

### Debug Mode
Diagnose before fixing. Read the bug log. Do not apply repeated random fixes.
Use `/project-os/07-agent-control/anti-loop-debug-prompt.md`.

### Review Mode
After any build, review what changed. Confirm only approved files were touched. Check that no unrelated refactors happened. Update logs.

## General Principles
- Plan before coding.
- Make minimal, focused changes.
- Preserve working functionality.
- Search before creating new files.
- Reuse existing patterns.
- Document all meaningful changes.
- Do not touch features unrelated to the approved task.

## Required Reading Before Work
Before any source-code edit, read:
1. `/project-os/00-start-here/current-status.md`
2. `/project-os/00-start-here/next-action.md`
3. `/project-os/04-technical/architecture.md`
4. `/project-os/07-agent-control/agent-rules.md`
5. `/project-os/08-logs/change-log.md`

## No Random Refactors
Do not refactor unrelated files. Do not change architecture unless the approved task requires it. Do not rewrite working code to match personal preferences.

## No Dependency Changes Without Approval
Do not edit package files, install packages, or change runtime versions unless explicitly approved.

## No Environment Changes Without Approval
Do not edit `.env`, deployment variables, Firebase/Supabase config, or secrets unless explicitly approved.

## Prevent Duplicate Work
Before creating any new component, hook, service, route, utility, file, or schema, search the entire codebase for existing equivalents. If an equivalent exists, reuse it or extend it. Do not create duplicate files.

## Avoid Debugging Loops
- Do not apply repeated random fixes.
- Diagnose root cause first.
- Make one controlled change at a time.
- Record every finding in the bug log.
- If the same issue remains after two attempts, stop and return to Plan Mode.

## Do Not Touch Unrelated Features
Only change files that are directly required by the approved task. If you discover an issue in an unrelated area, log it in the bug log — do not fix it without approval.

## Required Output After Work
Every completed task must include:
- What changed
- Files changed
- Tests run
- Risks remaining
- Logs updated
- Recommended next action
- Confirmation that no environment variables, secrets, or package files were changed without approval
