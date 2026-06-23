# Deployment Debug Skill

## Purpose
Use this skill when deployment, domain, SSL, build, or environment variables fail.

## Required Reading
- `/project-os/04-technical/architecture.md`
- `/project-os/04-technical/environment-variables.md`
- `/project-os/06-quality/deployment-checklist.md`
- `/project-os/08-logs/deployment-log.md`

## Diagnostic Process
1. Identify hosting platform.
2. Identify branch and deployment target.
3. Check build command and output directory.
4. Check runtime version.
5. Check environment variable availability.
6. Check domain/DNS/SSL if relevant.
7. Read exact build errors.
8. Propose smallest safe fix.

## Output Required
- Deployment platform
- Exact failure point
- Likely root cause
- Files/config involved
- Safest fix plan
- Rollback plan
