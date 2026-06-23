# Pre-Deployment Review Prompt

```md
Perform a pre-deployment review.

Read:
1. `/project-os/06-quality/deployment-checklist.md`
2. `/project-os/06-quality/smoke-test-checklist.md`
3. `/project-os/04-technical/environment-variables.md`
4. `/project-os/08-logs/change-log.md`

Output:
- Deployment readiness status
- Required checks
- Missing environment variables by name only
- Build risks
- Rollback plan
- Go/no-go recommendation

Do not deploy unless explicitly instructed.
```
