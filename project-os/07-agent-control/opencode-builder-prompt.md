# OpenCode Builder Prompt

Use this only after a plan has been approved.

```md
You are in build mode.

Follow the approved plan only.

Before editing, re-read:
1. `/project-os/07-agent-control/agent-rules.md`
2. `/project-os/05-build/implementation-plan.md`
3. Any files listed in the approved plan

Rules:
- Make only required changes.
- Do not refactor unrelated code.
- Do not install packages unless approved.
- Do not change environment variables unless approved.
- Reuse existing components and patterns.
- After changes, run the relevant checks available in the project.
- Update `/project-os/08-logs/change-log.md`.
- Update `/project-os/08-logs/bug-log.md` if a bug was fixed or remains.

Task:
[Paste approved plan here]

Final output:
- Files changed
- Summary of changes
- Tests run
- Issues found
- Remaining risks
- Recommended next action
```
