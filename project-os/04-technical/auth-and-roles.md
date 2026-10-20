# Auth and Roles

Updated 2026-10-19 for Owner-assigned responsibilities (release file 06, branch `agent/owner-responsibilities`, NOT in production); 2026-10-18 for platform administration. Details: `tenant-design.md`. Release procedure: `05-build/platform-admin-release.md`.

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
| Owner | Everything in their company. Grant, update, remove or restore Admin, Manager and Driver access. Set each Admin's and Manager's responsibilities. Driver profiles. Own driver link (owner-driver). | Create or change Owners. Change their own access. Act in another company. Platform actions. |
| Admin | View business access. The responsibilities the Owner gives (default: receive and count cash). Module access as granted by the Owner. | Grant access, change roles or sign-ins. Change responsibilities unless given *Manage staff responsibilities* (then only within its limits). |
| Manager | The responsibilities the Owner gives (default: verify and bank). | Grant access, change roles or sign-ins. View access or change responsibilities unless given *Manage staff responsibilities*. |
| Driver | Own records only (capture, edits with a reason, own day cash-up submit). | See other drivers, the directory, members or reports. |

## Responsibilities (release file 06; local and Preview only until released)
Stored per membership in `business_memberships.permissions` and changed only by an active Owner (`member.permissions` -> `public.set_member_permissions`, service role only). The server re-reads them from the membership on every request.

| Responsibility | Key | Actions | Needs module |
|---|---|---|---|
| Receive and count cash | `cash.count` | `cashup.record_handin`, `income.count` | Money |
| Verify counted cash | `cash.verify` | `cashup.verify`, `income.verify` | Money |
| Bank verified cash | `cash.bank` | `deposit.lock` (also needs Money edit) | Money |
| Manage driver profiles and assignments | `drivers.manage` | `driver.save`, `driver.save_profile`, changing a vehicle's driver | Drivers |
| Manage routes and vehicles | `fleet.manage` | `route.save`, `vehicle.save` | Fleet & Operations |
| Manage staff responsibilities | `staff.manage` | `member.permissions` for other Admins/Managers; view the access list | Settings |

- Owner holds all; Driver none (database constraint). Admin/Manager defaults equal the pre-06 fixed rules (Admin: count; Manager: verify + bank). A role change resets to the new role's defaults.
- A responsibility works only while its module is on for that person; it never bypasses module access.
- Not a responsibility: granting sign-ins, changing roles or removing access. These stay with the Owner. `drivers.manage` never creates a sign-in; driver profile saves accept no email, password or login fields.
- **Delegation limits for `staff.manage`** (server and database function): only the Owner gives or removes `staff.manage`; a holder may add or remove only responsibilities it currently holds (effective, so a switched-off module also limits it); never its own entry, an Owner, a Driver, or another holder of `staff.manage`; only within its own business. Every change (Owner or delegate) is one row in `public.member_permission_changes` (business, actor, actor role, target, before, after; no browser access) and an audit entry in that business's snapshot.
- **Separation of duties:** whoever recorded a hand-in count (`countedBy`) cannot verify it (`cashup.verify`, `income.verify`), whatever they hold, the Owner included. Another person with *Verify counted cash* must verify. A business where the Owner works alone therefore needs a second person to verify counts the Owner made. **Confirmed by Tebogo 2026-10-19: keep it for everyone; the workflow requires a second authorized person to verify a count.**
- Before file 06 the server falls back to the role defaults (undefined column 42703), so the code can be deployed before the migration without changing anyone's access.

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

## Sign-out (documented 2026-10-19; unchanged by decision)
Signing out ends that user's sessions on every device (Supabase global sign-out); access tokens issued earlier stop working, so other devices must sign in again. Tebogo decided to keep this behaviour.

## Auth Risks
- **Inactive memberships** block access immediately (each request re-checks the membership), even with a still-valid token.
- **Platform grants** are removed with `update public.platform_admins set active = false` (immediate) or the release-file rollback (fail closed).
- **DKIM:** until it passes, setup emails can land in Spam (`05-build/email-dkim-hosting-ticket.md`).

## Debug Notes
Before fixing auth, use `/project-os/09-agent-skills/auth-debug-skill.md`.
