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

## Scoped server writes (Task 13, local only)

### Existing finance save operations (src/App.jsx) and the role/action matrix

Roles are the existing workflow's (`src/lib/appRuntime.js`: `canRecordCashHandoverForRole`, `canVerifyCashCheckForRole`, `canFinishDepositForRole`, `canEditModuleUpdates`). No new permissions were created.

| Existing operation | Who (current app rule) | Transition | Server action | Status |
|---|---|---|---|---|
| `submitDriverCashUp` (day checking) | Driver (own staff id) | day → pending (resets unless banked) | `cashup.submit` | **Implemented** |
| `verifyIncome` on a driver day cash-up, pending | Owner, Admin | pending → counted | `cashup.record_handin` | **Implemented** |
| `verifyIncome` on a driver day cash-up, counted | Owner, Manager | counted → verified | `cashup.verify` | **Implemented** |
| `verifyIncome` on a standalone income record | Owner/Admin count; Owner/Manager verify | pending → counted → verified | — | Not yet |
| `lockDeposit` (finish deposit) | Owner, Manager (+ finance edit) | verified → banked | — | Not yet |
| `saveStandardIncome` / `saveSpecialIncome` / `saveExpense` (capture) | Driver (own) and management with finance edit | creates pending records | — | Not yet |
| `deleteTransaction`, edit entry | finance edit permission; never banked | — | — | Not yet |

### Endpoint `POST /api/business/finance-actions`

Files: `api/business/finance-actions.js`, `api/_lib/financeActions.js`, migration `scripts/localdb/migrations/20261010063144_finance_actions.sql` (+ rollback).

- **Body:** `{ action, requestId (UUID, reused on retry), expectedVersion (snapshot updated_at), fields }`. Unknown envelope keys or fields (`snapshot`, `businessId`, `role`, `appUsers`, `driverStaffId`, …) are refused (400).
- **Authorization:** `tenantAuth` (token + active membership + business selection). Service role only afterwards, pinned to that `business_id`.
- **Server-enforced rules:**
  - The role matrix above.
  - Driver ownership comes from the membership's `driver_staff_id`, never from the request.
  - Transitions are computed by the shared `getDriverCashUpWorkflowStatus`, and banked is immutable.
  - Expected cash in comes from the shared `summarizeDriverDayCash`. The response returns signed `variance` (actual − expected) and `shortage`.
- **Atomic commit:** `public.commit_finance_action` (security definer, `search_path=''`, EXECUTE for `service_role` only) does three things in one transaction:
  - replay check on `(business_id, request_id)`;
  - compare-and-swap on `updated_at`;
  - request log in `public.finance_action_requests` (RLS on, no browser grants).

  A stale version returns 409 and changes nothing. A retried request returns the original result (`replayed: true`). A reused request id with different content or a different user returns 409.
- **What can change:** only the target day cash-up, its linked finance records and one server-generated audit event (`actorId` = auth user id, `actorRole`, `source: server`, `requestId`). Memberships, businesses, `appUsers`, business identity and unrelated records cannot change through this endpoint.

### Evidence (2026-10-10)

- `tests/finance-actions.test.mjs` 7/7 (pure rules).
- `node scripts/localdb/finance-action-tests.mjs` **37/37** with real local tokens and two businesses. Denied actions are paired with authorized ones:
  - no/invalid token; inactive and non-member;
  - Driver and Manager denied the hand-in, then Admin succeeds;
  - Admin denied the verify, then Manager succeeds;
  - forged snapshot, role, business and staff-id fields; forged token metadata;
  - cross-business cash-up id (404) and Business B selection (403);
  - stale version and a pre-hand-in version (409, nothing written);
  - retry replayed without a second write; reused request id refused; double hand-in refused;
  - owner-driver denied the Driver-only submit; drivers submit only in their own business;
  - all other snapshot keys, memberships, businesses and business identity unchanged; the request log has exactly the applied actions; the browser cannot read the log or call the commit function.
- Expected 700 / actual 680 / variance −20 / shortage 20.

### Lessons

- Fixtures must follow the real workflow state. The old seed had a cash-up marked "counted" whose linked records were pending, which the shared contract treats as pending.
- The idempotency check must run before applying the action, so a retry after the snapshot has moved on returns the original result instead of a 409.

### Remaining gaps after Task 13

1. Server actions for capture (`saveStandardIncome`/`saveSpecialIncome`/`saveExpense`), standalone count/verify, `lockDeposit` (banked) and edit/delete, each with the same pattern.
2. Server actor ids are auth user ids. Report/UI name resolution (`describeActor`) still expects staff/app ids, so names may show as unknown until the display layer maps membership users.
3. The frontend still uses direct table access; no integration yet. `userLifecycle`/bootstrap are still `appUsers`-based.
4. `finance_action_requests` is not part of the drill export; it is an operational log, and losing it only weakens retry protection for in-flight requests.
5. Hosted: nothing applied.

## Owner-driver submit and scoped banking (Task 14, local only)

### Updated action matrix

| Server action | Who | Transition | Notes |
|---|---|---|---|
| `cashup.submit` | Driver **or Owner**, both with an authoritative membership driver linkage | day → pending (unless banked) | Approved owner-driver rule (Task 14): one login, Owner role kept. An Owner without a linkage gets 403. Staff id always comes from the membership, so only the caller's own records are included. |
| `cashup.record_handin` | Owner, Admin | pending → counted | unchanged |
| `cashup.verify` | Owner, Manager | counted → verified | unchanged |
| `deposit.lock` | Owner, Manager with finance edit (Money on) | verified → banked | Existing `lockDeposit` rule. The batch is every verified day cash-up (with linked records) plus every standalone verified record. The caller sends the exact `cashUpIds`/`transactionIds` it reviewed: ids outside the business get 404, unverified ids or a changed batch get 409. Deposit id, reference (`TFP-DAY-MMDD-NN`, SAST), amounts (existing formulas), `lockedBy`/`lockedByRole` and the audit event are generated server-side. The deposit, linked records, cash-ups and request log are written in **one** `commit_finance_action` transaction. |

Still not server actions: capture (`saveStandardIncome`/`saveSpecialIncome`/`saveExpense`), standalone count/verify, edit/delete.

### Request-log retention and recovery

- `public.finance_action_requests` is **retained indefinitely**: no automatic pruning. It is small (one row per applied action), and pruning must be a reviewed operation that keeps at least the longest client retry window.
- **It is part of the backup.** `scripts/localdb/drill.mjs` exports and restores it and checks it matches (5 rows MATCH in the 09:16 drill). Duplicate-request protection therefore survives a restore: a retried request id is recognised and its original result returned.
- **If the log is lost anyway** (an older backup, or a restore that excluded it), the intended behaviour is that a retry carrying its original pre-action `expectedVersion` is still refused. Tested: deleting a banking request's log row and retrying it gives 409 with no duplicate deposit. In that test the "nothing verified left to bank" rule refused it before the version check was reached; either guard alone refuses.
- **Residual risk:** if a restore rolls the snapshot back to *exactly* the version a client last loaded **and** drops the log, a retry of an action applied after that point would apply again. That is the correct outcome only if the restore genuinely removed the original effect. This is one more reason the log is restored together with the snapshots.

### Evidence (2026-10-10)

- `tests/finance-actions.test.mjs`: 9/9.
- `node scripts/localdb/finance-action-tests.mjs`: **56/56** (real local tokens, two businesses):
  - **Owner-driver:** an Owner without a linkage is refused; the owner-driver can't submit another driver's day (409, B unchanged) or pass a staff id (400); Owner B submits its own day (`uat-drv-b-owner`, `checkedByRole` Owner, expected 120); the other driver's records are untouched.
  - **Banking denied:** Admin, Driver, a Business B id in the batch (neither business changes), an unverified record, a mismatched batch, a stale version.
  - **Banking succeeds:** Manager banks 880 for 2 items with every linked record, the cash-up and the audit changed together.
  - **After banking:** the duplicate request is replayed with no second deposit; hand-in, verify, re-submit and re-bank on banked records all give 409 and nothing changes; the log-loss retry is refused.
- `node scripts/localdb/drill.mjs`: PASS, including the request log.
- Regression: 09:20–09:27 on fresh resets: tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26.
- `node --test tests/*.test.mjs` 298/298; build passes.

### Remaining gaps after Task 14

1. Capture, standalone count/verify and edit/delete are not yet server actions.
2. Actor ids are auth user ids; report/UI display-name mapping is pending.
3. Frontend integration, membership-based user lifecycle/bootstrap, and the hosted migration plan are all not started.
4. Deposit references use a per-business sequence from the snapshot (`deposits.length + 1`), same as the browser. They are unique in practice but not enforced by a constraint.

## Scoped finance capture (Task 15, local only)

### Existing capture rules (src/App.jsx), as mapped

| Operation | Validation | Calculations | Associations | Permission |
|---|---|---|---|---|
| `saveStandardIncome` | vehicle; trip date; time in/out valid and out > in; opening/closing odometer, closing > opening; ≥ 1 trip leg with different from/to stops, integer passengers ≥ 0, amount ≥ 0 | amount = logbook total (`calculateDailyAnalytics`); trip/day analytics fields; `discrepancy` = opening ≠ `getExpectedOpeningOdo` | vehicle by id; Driver → own staff id; management → no driver | Driver; other roles need finance edit |
| `saveSpecialIncome` | vehicle; date; closing > opening; from, to and reason; fuel/oil and repairs ≥ 0; amount > 0 | businessKm = closing − opening; route "from to to" | as above | as above |
| `saveExpense` | category; description; date; amount > 0; a vehicle cost (`asset`) needs a valid vehicle | `cashExpense` = payment method; status **verified** for management with finance edit, **pending** for drivers | asset → vehicle; operational → "General" | as above |

None of these writes vehicle odometer history: the odometer only drives the discrepancy flag. Capture therefore writes exactly one record plus one audit event.

### Server actions (create only)

| Action | Who | Result |
|---|---|---|
| `capture.standard_income` | Driver (own linkage); Owner with linkage as `captureAs: "driver"`; Owner/Admin/Manager as management (finance edit; Owner always) | pending income, amount from the server-computed logbook total, discrepancy flag |
| `capture.special_income` | same | pending extra-trip income |
| `capture.expense` | same | driver: pending; management: verified (existing rule) |

- Explicit fields only. Unknown fields (`role`, `status`, `driverStaffId`, `amountClaimed` on a leg, …) and whole snapshots get 400.
- Vehicles must exist in the authorized business and not be archived (404/409). A driver capture's linked staff id must exist in that business's `drivers` (409).
- **Closed days:** driver work for a date whose day checking is counted, verified or banked is refused (409). The browser does not check this: it lets such a day silently fall back to pending, which undermines a recorded hand-in or deposit. **Please confirm this rule.**
- The record id is `txn-{inc|sp|exp}-<requestId>`, so a retry can never duplicate the record, even if the request log is lost. Actor (`createdBy` = auth user id, `createdByRole`) and audit are server-generated.
- Timestamps are composed in SAST explicitly. The browser uses device-local time, which is SAST in practice; Vercel runs in UTC.
- The small field helpers mirror `src/lib/appRuntime.js`, which cannot load in Node. `tests/finance-capture-parity.test.mjs` loads the real browser module through Vite's SSR loader and checks identical outputs, so the server cannot drift.
- **Difference from the browser:** trip legs must name from/to stops explicitly. The browser can default them from the vehicle route.

### Evidence (2026-10-10)

- `node scripts/localdb/finance-capture-tests.mjs`: **43/43** with real local tokens and two businesses:
  - 18 forged or invalid inputs all refused (400) with nothing written;
  - associations: a Business B vehicle in A (404), an unknown vehicle, Driver A into B (403);
  - modes: Driver as management refused, Owner without linkage as driver refused, Admin as driver refused; Driver A captures its own income (920, 2 trips, 21 passengers); Manager captures a verified expense; Admin an extra trip (30 km); Owner a vehicle cost;
  - owner-driver: Owner B captures own driver work (`uat-drv-b-owner`) and management work; Driver B cannot use an A vehicle and captures its own expense;
  - closed days refuse new driver work (expense and income);
  - stale save refused; retry replayed with one copy; after log loss the retry is refused with still one copy;
  - other keys and pre-existing records unchanged; no vehicle odometer rewrite.
- Unit 4/4; parity 5/5.
- Regression: 09:55–10:13 on fresh resets: finance actions 56/56, drill PASS (request log 5 rows MATCH), tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26.
- `node --test tests/*.test.mjs` 307/307; build passes.

### Remaining after Task 15

1. **Edit and delete** of capture records: `draft.id` updates with the driver edit-reason rule, `buildDriverRecordEditTracking`, `deleteTransaction`, never once banked.
2. **Standalone record count/verify** (`verifyIncome` on a non-day-cash-up record).
3. Actor display names (auth user ids → staff names).
4. Confirm the closed-day capture rule.
5. Frontend integration; membership-based user lifecycle/bootstrap; hosted plan.

## Essential finance server actions complete (Task 16, local only)

### Decisions recorded (Tebogo, 2026-10-10)

- **Closed-day guard kept, intentionally.** Driver capture into, and edits/deletes touching, a driver day whose checking is counted, verified or banked are refused. This intentionally changes the browser's behaviour, where such a day silently fell back to pending.
- **No reopening or adjustment feature** in this phase.
- **Explicit trip stops.** Server requests must name each leg's from/to stops. The frontend must supply the existing route defaults (`getRouteStops` via `createDailyTripLogEntry`) before calling the server.

### Complete server action matrix (POST /api/business/finance-actions)

| Action | Who | Rule |
|---|---|---|
| `capture.standard_income` / `capture.special_income` / `capture.expense` | Driver (own); Owner with linkage as driver; Owner/Admin/Manager management (finance edit) | create pending (management expense: verified); closed-day guard |
| `income.count` | Owner, Admin | standalone income pending → counted; driver work refused (day checking only) |
| `income.verify` | Owner, Manager | standalone income counted → verified |
| `record.edit` | Driver (own record, reason required); Owner/Admin/Manager with finance edit (reason optional) | pending records only; same field list and validation as capture; id, creator and driver ownership preserved; stays pending; edit history when a reason is given; closed-day guard on the old and new dates |
| `record.delete` | Owner/Admin/Manager with finance edit | pending records only; closed-day guard; server audit |
| `cashup.submit` | Driver; Owner with driver linkage | day → pending (not banked) |
| `cashup.record_handin` | Owner, Admin | pending → counted |
| `cashup.verify` | Owner, Manager | counted → verified |
| `deposit.lock` | Owner, Manager (finance edit) | exact reviewed verified batch → banked |

**Intentional differences from the browser:**
- edit/delete only for pending records (the browser deletes counted/verified records);
- management edits of an expense keep it pending (the browser would mark it verified);
- standalone count/verify excludes driver work;
- the edit-history summary text is a server field diff, not the browser's formatted sentence.

### Defect found and fixed during Task 16

`record.edit` passed `changes` straight to the capture parser without the capture field-list check, so an edit carrying `status: "verified"` was accepted. The record still stayed pending because the server forces it, but the request should have been refused. Edits now use the same explicit field list as capture. `tests/finance-record-actions.test.mjs` covers forged `status`, `amountClaimed`, `discrepancy`, `driverStaffId` and `createdBy`.

### Evidence (2026-10-10)

- `node scripts/localdb/finance-record-tests.mjs`: **36/36** (real local tokens, two businesses). The first run gave 32/36: the defect above (with two knock-on failures) plus one test expectation (404 after log loss is a valid refusal).
  - **Standalone:** Driver and Manager hand-in refused, Admin counts (variance −20); Admin verify refused, Manager verifies; driver work refused; Business B id 404 / B selection 403; banked refused; stale refused; retry replayed.
  - **Edit:** driver without a reason refused; forged `status` refused; `captureAs` refused; banked refused; an edit touching a counted day refused; a counted record refused; a driver edits its own pending record (550, history, creator and ownership kept); a Manager edits it (ownership kept, stays pending); Driver B cannot reach an A record.
  - **Owner-driver:** edits its own driver expense with history and the linkage preserved, then deletes it.
  - **Delete:** Driver refused; verified, banked, counted-day and Business B records refused; stale refused; Manager deletes with an audit entry; retry replayed; after log loss the retry is refused and nothing changes.
  - Unrelated keys and records unchanged.
- Unit: `tests/finance-record-actions.test.mjs` 4/4.
- Regression: 10:39–11:04 on fresh resets: capture 43/43, finance actions 56/56, drill PASS (request log MATCH), tenant access 35/35, rollback 8/8, verify 16 PASS/0 WARN, server auth 26/26.
- `node --test tests/*.test.mjs` 311/311; build passes.

### Remaining finance gaps

1. Reopening/adjusting a counted, verified or banked day (deliberately out of scope).
2. Edits to non-pending records and deletion of counted/verified records (the browser allows these; the server refuses them).
3. Actor display names: server actor ids are auth user ids.
4. Expense presets (`saveExpensePreset`) and any other non-finance writes (fleet, drivers, routes, settings) have no server actions yet.
5. Frontend integration (including route-stop defaults and business selection); membership-based user lifecycle/bootstrap; hosted migration plan.

## Tenant-aware frontend finance workflow (Task 17, local only)

Enabled only with `VITE_TENANT_MODE=true` in live mode. Without the flag, the existing app is unchanged; Viewer/demo mode stays on mock data.

### Read path
- `GET /api/business/memberships` lists the caller's active businesses, using the caller's own token.
- `GET /api/business/workspace[?business=]` returns:
  - the role-scoped snapshot, with the caller's own `appUsers` entry overwritten by the authoritative membership role and driver link;
  - `version` (`updated_at`);
  - `actorNames`.
- Actor names: `api/_lib/actorNames.js` resolves auth user ids for members of the authorized business only. It tags directory entries with `authUserId`, and the daily report resolves through it.
- `src/lib/tenantWorkspace.js` keeps in memory only: the loaded version, the role, and pending request ids keyed by user + business + request. These are dropped when the user or business changes.
- Only the selected business id is stored, per user (`taxiflow-tenant-business:<userId>`). No snapshot cache.
- Business selection:
  - one business opens automatically;
  - several businesses show a picker first, then a business selector in the tenant bar;
  - switching clears the displayed data before loading.
- Errors never fall back to `taxiflow-live` or demo data.
- Identity (`appRuntimeSecure.resolveAuthIdentity`) uses the server-confirmed membership role in tenant mode, not JWT metadata.

### Write path
The seven finance handlers in `App.jsx` branch to `POST /api/business/finance-actions` after their existing browser validation:
- `capture.*` and `record.edit`;
- `cashup.submit`, `cashup.record_handin` and `cashup.verify`;
- `income.count` and `income.verify`;
- `record.delete`;
- `deposit.lock`, with the exact reviewed batch.

Each request carries the loaded version and a request id. The id is reused only when the same request is retried after a network failure.

Other write rules:
- Route-stop defaults (`createDailyTripLogEntry`) are sent explicitly. Legs are limited to the server's leg fields.
- Owner-driver: an Owner with a driver link gets a "Capture as" choice (Management or My own driving) and a "Send my day checking" button.
- Conflict (409): nothing is reloaded and the form keeps the entry. The banner says to refresh. "Refresh live data" reloads in place, so the entry survives.
- No whole-snapshot save in tenant mode:
  - `persistSnapshot` refuses;
  - the generic, hidden-tab, page-close and sign-out saves are skipped;
  - `commitLiveSnapshotMutation`, `commitUserAccessSnapshot` and the user-lifecycle API are refused with "not available in the business workspace yet".
  - Fleet, user, settings and preset writes are therefore unavailable, and other local data edits are reverted. Driver-terminal view state may change locally.
- Edit and delete buttons are enabled for pending records only. Closed-day and other server refusals are shown with the server's message.
- Reports send `&business=` for the loaded business.

### Evidence (2026-10-10)
Browser proof: `tests/localdb-browser/tenant-finance.spec.js` via `playwright.localdb.config.mjs` and `scripts/localdb/dev-tenant.mjs`, against the local stack with real local Auth. On a fresh reset: 6/6.
- Capture: trip with explicit stops, plus a safe expense.
- Refresh persistence, with no snapshot in browser storage.
- Submit.
- Admin count.
- Closed-day capture refused, and the counted record's Edit disabled.
- Manager verify.
- Owner banks, then refresh.
- Report for the day, with Admin/Manager names.
- Stale-save 409 with the draft kept, then a retry after refresh succeeds.
- Owner-driver in B: trip captured as own driving, own day checking sent and queued.
- Cross-business workspace read refused with 403.
- Two-business user: picker, then A, then B, with no cross-business data; the selection survives a refresh; the next user starts clean.

### Remaining after Task 17
1. Fleet/driver/route/settings/user/preset writes have no tenant server actions; they are blocked in tenant mode.
2. Membership-based user lifecycle and bootstrap.
3. Hosted migration plan, and hosted or live UAT (not done).
4. An expense-only driver day is not shown in the existing Banking queue. This is pre-existing UI behaviour, observed in Task 17 and not changed.
5. If Save is clicked while a refresh is still loading, it is refused with "The workspace is not loaded. Refresh before saving." This is safe but abrupt.

## Pilot onboarding (Task 18, local only)

Business memberships are the only source of access. The legacy user and bootstrap routes (`api/admin/auth-users.js`, `api/admin/bootstrap-workspace.js`) return 410 when the server runs with `TAXIFLOW_TENANT_MODE=true`. The frontend already refused them in tenant mode.

### Database (`scripts/localdb/migrations/20261010113000_pilot_onboarding.sql`, local hardened variant)
- **Last-Owner guard:** a trigger on `business_memberships` refuses any update or delete that would leave a business without an active Owner. It locks the business row so concurrent changes are serialized.
- **`create_business_with_owner`** (service_role only): creates the business, its workspace snapshot (`workspace_key` = slug) and the Owner membership in one transaction. It is idempotent by slug; a different Owner trying to reuse a slug gets `slug_taken`.
- **`apply_membership_change`** (service_role only): checks that the actor is an active Owner of the business, then changes the membership and the business directory snapshot (with a version check) in one transaction. Its rules:
  - only Admin, Manager or Driver can be assigned;
  - Owners cannot be changed here, except an Owner's own driver link;
  - nobody can change their own role or active flag.
- **One membership path:** the foundation's browser-callable `set_business_membership` is withdrawn (execute revoked).
- **Rollback:** `rollback/20261010113000_pilot_onboarding.down.sql`.

### Operator procedure (creates businesses and Owners)
`node scripts/localdb/onboard-business.mjs --slug <slug> --name "<name>" --owner-email <email> --owner-name "<name>" [--owner-drives]`

- Local stack only. It uses `createBusinessWithOwner` in `api/_lib/tenantOnboarding.js`.
- It finds or creates the Owner's Auth account. A new account has no password and gets a password-setup (recovery) email. An existing account is not changed.
- `--owner-drives` also creates the Owner's driver profile and link (one login).
- Repeating the command is safe.
- A hosted version needs its own reviewed procedure with explicit target confirmation (not built; see the gaps below).

### Owner access management (`/api/business/members`, Owner; Admin may view)
- `member.grant` finds or creates the person's account (a new one gets the setup email), then sets the membership and directory entry. An existing account keeps its password and its other businesses.
- `member.update` changes a member's role, driver link or module toggles.
- `member.deactivate` and `member.reactivate`. The tenant auth check on every request blocks a removed user's reads and writes immediately, even with a still-valid token.
- `owner.link_driver` sets the Owner's own driver link (owner-driver, one login).
- `driver.save_profile` creates a driver profile with no sign-in; a Driver membership links one login to one profile. The existing unique index prevents two logins on one profile. Removing a sign-in keeps the profile.
- **Retries and partial failures:**
  - every change is recomputed from current server state and is idempotent;
  - validation (for example, an unknown driver profile) happens before any account is created;
  - if the account was created but the membership was refused, the response reports `partial` and a recovery note. That account has no access (no membership), and repeating the corrected request reuses it.
- **Browser:** in tenant mode, Settings shows `src/components/TenantAccessPanel.jsx` (people, grant, remove/restore, driver profiles, "I also drive as") instead of the legacy user tools. After each change the workspace is reloaded so the loaded version stays current.

### Evidence (2026-10-10)
- **`scripts/localdb/onboarding-tests.mjs`:** 64/64 with real local Auth. Password setup was completed through the real local Mailpit email.
  - Three businesses; the operator retry and slug hijack are refused.
  - Public self-appointment refused: the RPCs, a direct insert, and the route for a non-member.
  - Admin (new account), Manager (an existing account that is also Manager in Business A, whose A access and password were unchanged), and a driver profile followed by a linked Driver.
  - Partial failure and retry; role access.
  - Self-escalation and Owner-minting refused; the database refuses to deactivate, demote or delete the last Owner.
  - Owner-driver, both at operator onboarding and by self-link.
  - Cross-business changes and reads refused.
  - Deactivation blocks the same token's read and write; reactivation works again; removing a Driver keeps the profile; removing access in one business keeps another.
  - Legacy routes return 410.
- **`tests/localdb-browser/tenant-onboarding.spec.js`:** 1/1. Operator → Owner sets a password from the email → driver profile → Driver grant → Admin grant → owner-driver self-link (the "Capture as" bar appears) → Driver signs in → the Owner removes the Admin while the Admin is signed in: the Admin's browser read and write get 403, and a reload shows no business.
- **`tests/tenant-onboarding.test.mjs`:** 2/2.

### Fleet, routes, settings and presets for the pilot (outside this task)
In tenant mode these writes are still blocked. Before go-live, the operator collects each Owner's vehicles, routes (with stops, so trip capture can prefill them), expense presets and banking details. The operator loads them with a reviewed operator procedure: the same service-role, validated, version-checked pattern as `onboard-business.mjs`, not yet written. During the pilot, changes go through operator requests until tenant server actions for fleet, routes, settings and presets exist (the next task). Until then, routes without stops still work: the stops are typed in (proven in Task 17).

### Remaining pilot blockers after Task 18
1. Tenant server actions for fleet, routes, driver details beyond name, settings and presets (or the operator data-load procedure above).
2. A hosted onboarding procedure, plus a hosted migration plan for the foundation, finance actions and onboarding migrations. Review, backup and rollback first; nothing hosted has been done.
3. Hosted email: the Supabase project's SMTP and redirect URLs for the password-setup email (local uses Mailpit).
4. Live or hosted UAT of the pilot flows.
5. A removed user sees the generic "Account not mapped" screen; clearer wording is optional.

## Platform administration and company onboarding (2026-10-18, release file 05)

Branch `agent/platform-admin-onboarding`. Local only; nothing hosted. Release procedure: `05-build/platform-admin-release.md`.

### Model
- **`public.platform_admins (user_id → auth.users, active, granted_at, granted_by, note)`:**
  - RLS is enabled and forced;
  - anon, authenticated and PUBLIC get nothing; the service role gets `select` only;
  - rows are written only by the operator (postgres);
  - there is no grant RPC, so no app or API path can grant it.
- **A platform grant is not a membership.** It gives no company data access, and a platform admin's role in any company stays exactly their membership role.
- **Tenant 1** is the existing mapped business "TaxiFlow Pro" (`…00a`, slug `taxiflow-legacy`). The console numbers companies by creation order. Data is unchanged.

### Server (`api/platform/businesses.js`, `api/_lib/platformAdmin.js`)
- **`authorizePlatformRequest`:**
  - token validated by Supabase Auth (401 otherwise);
  - then the caller's own active `platform_admins` row (403 otherwise);
  - any read error, including a missing table, refuses.
- **`GET`:** company metadata only (name, slug, created, Owner emails, active member count). Never snapshots. `Cache-Control: no-store`.
- **`POST company.create`** reuses `createBusinessWithOwner`: one transaction, idempotent by slug, slug hijack refused.
  - Fields allowed: `name`, `slug?`, `ownerEmail`, `ownerName?`, `ownerDrives?`. Any other field gets 400.
  - The platform admin's own email as Owner gets 403 (separation of duties).
  - The new company's audit trail records "Company created" with the platform admin as actor.
- **Owner account:**
  - a new account is created with no known password and gets the setup email;
  - an existing account is reused unchanged: no reset, no email, other memberships untouched.

### Frontend
- After sign-in, `loadPlatformCompanies` decides whether the "Companies" button appears (tenant bar, business picker and the no-membership screen). A 403 hides it.
- `PlatformCompaniesPanel` lists companies and creates a company with its Owner.
- No company data is loaded there, and nothing is cached: `/api/*` bypasses the service worker, and the responses are no-store.

### Evidence
See the 2026-10-18 change-log entry:
- `scripts/localdb/platform-admin-tests.mjs`;
- `tests/platform-admin.test.mjs`;
- `tests/localdb-browser/platform-onboarding.spec.js`.
