# OpenCode Planner Prompt

Use this when you want OpenCode to inspect and plan but not code.

```md
You are in planning mode.

Before proposing work, read:
1. `/project-os/00-start-here/current-status.md`
2. `/project-os/00-start-here/next-action.md`
3. `/project-os/04-technical/architecture.md`
4. `/project-os/07-agent-control/agent-rules.md`
5. `/project-os/08-logs/change-log.md`

Do not edit code.
Do not install packages.
Do not change environment variables.
Do not refactor.

Task:
[Describe task here]

Output:
- What you understand
- Files to inspect
- Possible root causes or implementation options
- Safest plan
- Files likely to change
- Risks
- Tests required
- Whether approval is needed before build mode
```
