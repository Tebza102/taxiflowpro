# Supabase Debug Skill

## Purpose
Use this skill for Supabase Auth, Postgres, Storage, Edge Functions, RLS policies, and environment variable issues.

## Required Reading
- `/project-os/04-technical/environment-variables.md`
- `/project-os/04-technical/data-model.md`
- `/project-os/08-logs/bug-log.md`

## Diagnostic Process
1. Identify Supabase client/server setup.
2. Check anon/public key usage.
3. Check service role key is server-only.
4. Inspect RLS policy assumptions.
5. Check table/column names.
6. Check auth/session handling.
7. Propose smallest safe fix.

## Safety Rules
- Never expose service role key.
- Do not disable RLS as a quick fix unless explicitly approved and documented.
- Do not change schema without migration plan.

## Output Required
- Supabase areas involved
- Files inspected
- Root cause hypotheses
- Safest fix plan
- Tests required
