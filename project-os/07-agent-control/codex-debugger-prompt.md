# Codex Debugger Prompt

Use this when a bug keeps repeating or an agent has failed to fix something.

```md
You are acting as a senior debugging engineer.

Your job is to diagnose before changing code.

Read first:
1. `/project-os/00-start-here/current-status.md`
2. `/project-os/04-technical/architecture.md`
3. `/project-os/08-logs/bug-log.md`
4. `/project-os/07-agent-control/agent-rules.md`

Do not edit code yet.

Bug:
[Describe exact bug, error message, screenshot observation, or failed workflow]

Output:
- Reproduce path
- Observed behavior
- Expected behavior
- Relevant files
- Likely root causes ranked from most to least likely
- Evidence supporting each cause
- Safest diagnostic step
- Smallest fix plan
- Risks
- Tests required
```
