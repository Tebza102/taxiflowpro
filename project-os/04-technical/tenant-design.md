# Tenant database foundation (design)

Status: implemented and tested on the **local synthetic database only** (2026-10-10, branch `agent/tenant-db-foundation`). Nothing hosted is changed; the API and frontend are not integrated yet.

## Model (smallest compatible change)

| Concept | Implementation |
|---|---|
| Business = tenant | `public.businesses (id uuid, slug unique, name)` |
| Membership (authoritative) | `public.business_memberships (business_id, user_id → auth.users, role, driver_staff_id, active)`, PK `(business_id, user_id)`. Only **active** rows grant anything. |
| Roles | `Owner`, `Admin`, `Manager`, `Driver` (check constraint). **Viewer is not a membership role**: it stays demo/mock-only in the app. |
| Owner who drives | One Auth identity, one membership with `role = Owner` **and** `driver_staff_id` set (driver linkage). No second account. A `Driver` membership must have a `driver_staff_id`; staff ids are unique per business. |
| Snapshot | Unchanged `workspace_snapshots` contract (jsonb snapshot, all existing keys, `updated_at` CAS, `pending→counted→verified→banked`), plus `business_id` **NOT NULL UNIQUE** → one snapshot per business. |
| Existing workspace | Explicit mapping in the migration: `workspace_key 'taxiflow-live'` → business `10000000-0000-4000-8000-00000000000a` (`taxiflow-legacy`). Memberships are backfilled only for snapshot `appUsers` that are active, have an allowed role and an exact email match in `auth.users` (Drivers need a staffId). Anything unmapped gets **no access**. Any other unmapped snapshot row makes the migration fail. There is no shared fallback. |

## Access rules

- **Browser (anon/authenticated):** no privileges at all on `workspace_snapshots` (no select/insert/update/delete/truncate). RLS is on and there are no browser policies, so the whole snapshot never reaches the browser and cannot be overwritten from it.
- **Server API (service role):** reads/writes the business snapshot only after checking the caller's active membership. A Driver gets a role-scoped projection (`api/_lib/scopedWorkspace.js` approach), never the whole snapshot. *(Integration pending.)*
- **businesses / business_memberships:** authenticated users may only **select**. They see businesses where they hold an active membership; they see their own membership, and active Owners/Admins see their business's memberships. No browser insert/update/delete.
- **Membership administration:** `public.set_business_membership(business_id, user_id, role, active, driver_staff_id)` (security definer, fixed `search_path`). The caller must be an active **Owner of that business**. Changing your own membership is refused (no self-assignment). Only Admin/Manager/Driver can be assigned, so there is no Owner minting and no escalation. Existing Owner memberships cannot be changed there. Ownership changes are a server-side/operator action.
- **Tenant reassignment:** triggers refuse any change of `workspace_snapshots.business_id` or of `business_memberships.business_id`/`user_id`, for every role including the service role.
- **Grants:** `anon` has nothing on the tenant or snapshot tables. `authenticated` has only `select` on the two tenant tables. TRUNCATE/REFERENCES/TRIGGER are revoked explicitly, since RLS does not govern them. Default privileges for new `public` tables are revoked from anon/authenticated.

## Rollback

`scripts/localdb/rollback/*_tenant_foundation.down.sql` restores the **pre-tenant access behaviour**, which is the flagged live-mirror policies and grants. It keeps all data: tenant tables, memberships and `business_id` values stay dormant. Re-applying the up migration is idempotent.

## Not in this step (integration gaps)

1. API routes still read the single `taxiflow-live` row. They must resolve `business_id` from the caller's active membership and return role-scoped data.
2. The frontend `dataGateway` still reads/writes `workspace_snapshots` directly. With the hardened policies it will be **denied**, so it must move to server endpoints before this migration can be applied anywhere real.
3. `userLifecycle.js` must manage `business_memberships` (not only `appUsers`). `appUsers` becomes a display mirror.
4. Hosted migration plan, backup, compatibility window and rollback rehearsal on a hosted-like copy.

## Evidence (local synthetic database, 2026-10-10)

Files:
- `scripts/localdb/migrations/20261010003451_tenant_foundation.sql` and `scripts/localdb/rollback/20261010003451_tenant_foundation.down.sql`;
- tenant fixtures in `scripts/localdb/seed-data.mjs`;
- tests in `scripts/localdb/tenant-tests.mjs` and `tests/tenant-foundation-static.test.mjs`.

Before every mutation the tests re-check the local marker, the exact loopback bindings and the Windows listeners.

- **Compatibility:** `setup.mjs reset` applies the pre-tenant baseline, loads the legacy single-workspace seed, *then* the tenant migration on top of that data, then tenant fixtures.
  - `taxiflow-live` is mapped to `taxiflow-legacy`.
  - Backfill gives Owner/Admin/Manager/Driver memberships; the Viewer gets none.
  - Owner B has driver linkage `uat-drv-b-owner`.
- **`tenant-tests.mjs access` — 33/33 PASS** (real sign-ins through the local API):
  - anon and non-members are denied snapshots, businesses, memberships and the admin RPC;
  - **even an Owner cannot read or write any snapshot from the browser** (42501);
  - Owner A cannot overwrite, insert or delete B's snapshot, cannot administer B, cannot insert memberships directly, cannot mint an Owner, and cannot change its own membership;
  - the Driver cannot read snapshots, cannot self-elevate (RPC or direct update), and sees only its own membership;
  - a Manager cannot administer; an inactive member sees nothing;
  - tenant reassignment is refused for postgres and the service role (snapshots and memberships);
  - positive controls: an Owner adds/deactivates a Manager, and the server reads per-business snapshots;
  - no snapshot changed during the tests.
- **`tenant-tests.mjs rollback` — 8/8 PASS:**
  - the rollback restores pre-tenant access (3 live-mirror policies, owner reads) and preserves snapshots, memberships and mapping;
  - the migration refuses an unmapped workspace row;
  - re-apply denies the browser again, is idempotent (data unchanged), and restores exactly `businesses`/`business_memberships` `authenticated:SELECT` grants.
- **`verify.mjs` — 16 PASS, 0 WARN, 0 FAIL** (no permissive policies remain).
- **`drill.mjs` — PASS:**
  - 2 snapshots, 2 businesses, 9 memberships and 11 users exported (gpg), the volume destroyed and the schema rebuilt from migrations;
  - snapshots-before-Auth refused by the FK (incomplete evidence);
  - restored Auth → businesses → memberships → snapshots, with every hash, key, count, `updated_at`, `updated_by`, `business_id`, business, membership and Auth check matching; all 11 sign-ins work; tenant visibility holds; browser denied; server reads.

## Rollback warning

`scripts/localdb/rollback/*_tenant_foundation.down.sql` is **not a production recovery procedure**. It deliberately restores the flagged live-mirror access, where any authenticated user can read and overwrite the whole snapshot. It exists only to prove local compatibility and lossless re-application. A real incident needs a reviewed forward fix or a restore from a verified backup.

## Function privileges (2026-10-10, Task 12)

`public.set_business_membership` and `taxiflow_private.is_active_member` are executable only by `postgres` and `authenticated`. Execute was revoked from `public`, `anon` **and `service_role`**. Verified ACL: `postgres=X/postgres authenticated=X/postgres`, and it still holds after a rollback/re-apply cycle.

## Server authorization boundary (Task 12, `api/_lib/tenantAuth.js`)

1. `Authorization: Bearer <access token>` is required and validated by Supabase Auth (`auth.getUser`). Missing, garbage, tampered or signed-out tokens get 401.
2. Active memberships are read with the **caller's own token** (RLS plus explicit `user_id`/`active` filters). Roles and memberships never come from query/body input, token user/app metadata or `snapshot.appUsers`.
3. Business = explicit `?business=<uuid>` or `x-taxiflow-business` header. Without a selection, it is used only when the caller has exactly one active membership.
   - Two or more memberships without a selection: 400.
   - No membership, inactive, or a business the caller does not belong to: 403.
   - Malformed or conflicting selections (including `taxiflow-live`): 400.
   - There is never a fallback to `taxiflow-live`.
4. Only then a service-role client reads the snapshot **pinned to that business_id**.
5. Role, business and driver linkage come from the membership. The business snapshot's `appUsers.moduleAccess` toggles can only **narrow** within the role (`normalizeModuleViewAccess`).
6. `snapshotLoader.loadServerSnapshot` returns a role-scoped projection (`scopedWorkspace`): Owner → full; Admin/Manager → full or no-finance; Driver → own linked records only. Report preview/PDF keep their role rules: Owner/Admin/Manager with Money on; Driver/Viewer denied. The report routes are GET-only, so no snapshot write path was added.

**Evidence:**
- `node scripts/localdb/server-auth-tests.mjs`: **26/26**, with real local Auth tokens and the real handlers. It covers authorized access, cross-business denial (query and header), no Business B data in A's load, inactive and non-member denial, missing/garbage/tampered/signed-out tokens, forged roles (query, user/app metadata, `appUsers`), the Driver projection, owner-driver linkage, explicit selection with two memberships, and the legacy key rejected.
- `tests/daily-finance-report-http.test.mjs` (stand-in Supabase) also proves **no service-role snapshot read happens for unauthenticated, unauthorized or ambiguous requests**.

**Lesson (defect found in Task 12):** the Task 11 reassignment trigger combined the table-name check and `new.user_id` in one expression. PL/pgSQL resolves every NEW field named in an expression, so **every legitimate `workspace_snapshots` update failed**. Task 11's tests only tried denied updates. Fixed with separate per-table branches, plus regression tests for a legitimate same-business snapshot update and a membership update. Always pair a denial test with a legitimate write of the same object.

## Remaining gaps after Task 12

1. **No server write path yet:** a scoped snapshot save endpoint (`mergeScopedChanges` per role, CAS on `updated_at`, pinned to the authorized business) is still needed. Unrestricted whole-snapshot writes must not be enabled.
2. **Frontend:** `dataGateway` must call server endpoints (with the business selection) instead of the table, and must handle the 400 "select a business" response.
3. **`userLifecycle.js` / `api/admin/auth-users.js` / `bootstrap-workspace.js`:** still `appUsers`/`taxiflow-live` based; they must move to `business_memberships`.
4. **Mock mode:** a signed-in caller is authorized through memberships but still sees demo data. The unauthenticated demo stays non-production only.
5. **Hosted:** migration plan, encrypted live backup, compatibility window, rehearsal on a hosted-like copy. Nothing is applied anywhere hosted.
