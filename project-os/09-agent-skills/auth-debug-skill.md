# Auth Debug Skill

## Purpose
Use this skill when login, signup, protected routes, roles, sessions, or redirects are broken.

## Required Reading
- `/project-os/04-technical/auth-and-roles.md`
- `/project-os/04-technical/environment-variables.md`
- `/project-os/08-logs/bug-log.md`
- `/project-os/07-agent-control/agent-rules.md`

## Diagnostic Process
1. Identify auth provider.
2. Identify auth config files.
3. Identify protected-route logic.
4. Check redirect logic.
5. Check environment variable names.
6. Check browser console and server logs.
7. Identify whether bug is frontend, backend, config, database rules, or deployment.

## Safety Rules
- Do not expose secrets.
- Do not replace auth system without approval.
- Do not rename env variables unless confirmed.
- Do not change database rules blindly.

## Output Required
- Auth system identified
- Relevant files
- Root-cause hypotheses
- Safest fix plan
- Risks
- Tests required
