# Auth and Roles

## Auth Provider
Document the authentication provider.

## User Types
List all user types.

## Roles
| Role | Can Do | Cannot Do |
|---|---|---|
| Admin | Define permissions | Define limits |

## Protected Routes
List pages/routes that require login.

## Public Routes
List pages/routes open to all users.

## Role Enforcement
Document whether role checks happen on frontend, backend, database rules, or all three.

## Auth Risks
List risks such as redirect loops, missing environment variables, exposed admin keys, weak route guards, or broken sessions.

## Debug Notes
Before fixing auth, use `/project-os/09-agent-skills/auth-debug-skill.md`.
