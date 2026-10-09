# Apprigate Development Contract

This repository uses `project-os` as the authoritative operating context for AI-assisted development.

## Mandatory preflight

Before changing application code, read in this order:

1. `project-os/00-start-here/current-status.md`
2. `project-os/00-start-here/next-action.md`
3. `project-os/00-start-here/project-brief.md`
4. relevant files in `project-os/04-technical/`
5. `project-os/08-logs/change-log.md`
6. any task-specific brief in `project-os/10-prompts/`
7. inspect the actual branch diff, runtime paths, tests, deployment state, and database evidence relevant to the task

Do not trust stale documentation over current code or verified backend evidence. If they disagree, reconcile them before proceeding and update Project OS.

## Default execution rules

- Continue the existing product; do not redesign or restart it unless a proven defect requires it.
- Preserve working architecture, auth, data models, deployment ownership, routes, and client-approved behaviour.
- Prefer the smallest reversible change that satisfies the requirement.
- Do not add product scope, packages, frameworks, abstractions, or refactors merely for taste.
- Never weaken authentication, authorization, RLS, validation, data integrity, or secret handling to make implementation easier.
- Inspect the exact error, log, network response, database result, or failing test before fixing a defect.
- Make one evidence-based fix and rerun the relevant test. After two failed attempts at the same root issue, stop random edits and re-diagnose from evidence.
- Do not create parallel alternate implementations to escape a bug.
- Do not ask the user routine implementation questions that can be answered from the repository, Project OS, connected services, logs, tests, or the approved product contract.
- Ask for user input only when the missing decision materially changes security, cost, data integrity, production ownership, irreversible deployment, or the actual business/product rule.
- Do not merge to the protected/default branch or deploy production unless explicitly authorized.

## Acceptance discipline

A change is not complete because the code was edited. Prove the relevant behaviour through the strongest available evidence: build, automated tests, browser/runtime checks, API/database verification, security checks, and preview validation where applicable.

Never report a pass that was not actually tested. If a test cannot be run, state the exact blocker and the minimum human action required.

## Deviation rule

This contract is the default, not a ritual. A deviation is allowed only when evidence shows the default approach cannot achieve the desired result or creates a material technical/product risk.

When deviating:

1. state the concrete reason;
2. identify what standard rule is being departed from;
3. choose the smallest deviation;
4. preserve a rollback path where practical;
5. prove the deviation produced a better result.

Never deviate merely to do things differently.

## Stop rule

When the approved acceptance criteria are satisfied, stop. Log future opportunities separately instead of silently expanding the current task.

## Required handoff

Before stopping meaningful work:

- update `project-os/00-start-here/current-status.md`;
- update `project-os/00-start-here/next-action.md`;
- update technical docs only if implementation changed them;
- append a meaningful entry to `project-os/08-logs/change-log.md` when appropriate;
- leave the branch/PR in a truthful state.

Return a concise handoff covering only:

- Completed
- Tests/evidence
- Genuine blockers
- Exact next action

The repository should carry the context so routine user prompts can remain short.