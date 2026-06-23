# Firebase Debug Skill

## Purpose
Use this skill for Firebase Auth, Firestore, Storage, Functions, Hosting, Admin SDK, rules, and environment variable issues.

## Required Reading
- `/project-os/04-technical/environment-variables.md`
- `/project-os/04-technical/integrations.md`
- `/project-os/08-logs/bug-log.md`
- `/project-os/08-logs/deployment-log.md`

## Diagnostic Process
1. Identify which Firebase services are used.
2. Locate Firebase client config.
3. Locate Firebase admin/server config.
4. Check variable names and where they are used.
5. Check whether private variables are server-only.
6. Check Firestore/Storage rules if relevant.
7. Check deployment logs for Firebase-specific errors.
8. Propose the smallest safe fix.

## Safety Rules
- Do not paste service account secrets into documentation.
- Do not expose private keys to the browser.
- Do not replace working Firebase setup without approval.

## Output Required
- Firebase services used
- Files inspected
- Root cause hypotheses
- Safest fix plan
- Tests required
