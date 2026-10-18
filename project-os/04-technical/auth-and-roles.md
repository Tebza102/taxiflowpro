# Auth and Roles

Updated 2026-10-18 for platform administration. Details: `tenant-design.md`. Release procedure: `05-build/platform-admin-release.md`.

## Auth Provider
Supabase Auth (email and password; password setup and recovery by email through `notifications@taxiflow.co.za`). Nobody else chooses or sees a user's password. An account is never reset when it gains access to another company.

## User Types
- **Platform admin:** an operator-granted row in `public.platform_admins`. Sees the Companies console.
- **Company member:** an active row in `public.business_memberships` for one company. One account can belong to several companies; each membership has its own role.
- **Viewer:** demo/mock data only. It is not a membership role.

## Roles
| Role | Can do | Cannot do |
|---|---|---|
| Platform admin | List companies (metadata only: name, slug, Owners, member count). Create a company with its initial Owner (setup email, or an existing account reused unchanged). | Read any company's workspace, members, finance or reports without a membership. Make themselves Owner through the console. Grant platform admin (operator SQL only). Change Owners of existing companies. |
| Owner | Everything in their company. Grant, update, remove or restore Admin, Manager and Driver access. Driver profiles. Own driver link (owner-driver). | Create or change Owners. Change their own access. Act in another company. Platform actions. |
| Admin | View business access; record hand-ins (pending → counted); module access as granted by the Owner. | Grant access; verify (counted → verified); bank. |
| Manager | Verify (counted → verified); bank (verified → banked) with finance edit. | Grant or view access; record hand-ins. |
| Driver | Own records only (capture, edits with a reason, own day cash-up submit). | See other drivers, the directory, members or reports. |

## Protected Routes
Every `/api/business/*` and `/api/admin/daily-log/*` route needs a valid token **and** an active membership in the selected company. `/api/platform/businesses` needs a valid token **and** an active `platform_admins` row.

## Public Routes
The sign-in, password-setup and password-recovery screens, and the static app shell.

## Role Enforcement
- **Database:** RLS and grants.
  - The browser has no access to snapshots, the request log or `platform_admins`; it can only select its own memberships and businesses.
  - Membership changes go through service-role RPCs that check the actor is Owner, with a last-Owner guard and tenant-reassignment triggers.
- **Server:**
  - `api/_lib/tenantAuth.js`: `authorizeBusinessRequest` for company data; `authorizePlatformRequest` for platform actions.
  - Roles come only from database rows, never from request input, token metadata or `snapshot.appUsers`.
  - The service role is used only after authorization, pinned to the authorized company (or, for platform actions, limited to company metadata).
- **Frontend:** it only hides what the server would refuse. No permission is decided in the browser.

## Auth Risks
- **Inactive memberships** block access immediately (each request re-checks the membership), even with a still-valid token.
- **Platform grants** are removed with `update public.platform_admins set active = false` (immediate) or the release-file rollback (fail closed).
- **DKIM:** until it passes, setup emails can land in Spam (`05-build/email-dkim-hosting-ticket.md`).

## Debug Notes
Before fixing auth, use `/project-os/09-agent-skills/auth-debug-skill.md`.
