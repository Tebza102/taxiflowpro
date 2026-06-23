# Agent Permission Levels

Use these levels to control how much freedom an AI agent has.

## Level 0: Read Only
Agent may inspect and summarize. No file changes.

## Level 1: Documentation Only
Agent may edit `/project-os` files only.

## Level 2: Planned Code Change
Agent may edit specific approved files only.

## Level 3: Feature Build
Agent may build approved feature within approved folders.

## Level 4: Refactor
Agent may refactor approved area only after strong justification.

## Level 5: Deployment
Agent may prepare/deploy only after checklist approval.

## Default Rule
Start every new task at Level 0 or Level 1 unless there is a clear approved plan.
