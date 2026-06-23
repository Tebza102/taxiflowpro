# Token-Saving Rules

These rules reduce wasted AI usage.

## Before Asking an Agent
- Put context in Project OS files instead of repeating it in every prompt.
- Ask the agent to read exact files.
- Use Plan Mode first.
- Ask for exact files to change before Build Mode.

## During Debugging
- Do not ask different agents to fix the same bug without sharing the bug log.
- Record failed attempts.
- Use anti-loop mode after two failed attempts.

## During Builds
- Keep tasks small.
- Avoid broad prompts like “fix the whole app.”
- Approve one focused plan at a time.

## Best Prompt Pattern
Read these files → diagnose/plan → list files → wait for approval → build → test → log.
