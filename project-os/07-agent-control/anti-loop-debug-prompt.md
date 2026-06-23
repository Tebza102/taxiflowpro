# Anti-Loop Debug Prompt

Use this when agents are repeatedly failing to fix the same issue.

```md
Stop all implementation work.

We are in anti-loop diagnosis mode.

Rules:
- Do not write code.
- Do not edit config.
- Do not install dependencies.
- Do not repeat previous fixes.
- Do not guess.

Read:
1. `/project-os/08-logs/bug-log.md`
2. `/project-os/08-logs/change-log.md`
3. `/project-os/04-technical/architecture.md`
4. `/project-os/07-agent-control/agent-rules.md`

Now produce a failure analysis:
- What has already been tried?
- What files were touched?
- What evidence do we have?
- What assumptions may be wrong?
- What is the smallest reproducible test?
- What is the likely true root cause?
- What should be tried once, safely, next?
- What should not be tried again?

Do not change any files.
```
