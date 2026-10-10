# Pilot Business Data: Owner Checklist and Operator Loader

Status 2026-10-10: the loader is built and tested **locally with synthetic data only**. No real owner data has been collected or loaded. Operator: Tebogo.

## 1. Owner checklist (what each pilot Owner supplies)

Collect it on paper or a shared sheet, then turn it into the JSON input below. Don't email it unencrypted. Personal data is limited to driver names and an optional phone number.

**Required:**
1. **Business name.** It must match the name the business was onboarded with (`onboard-business.mjs`).
2. **Routes:** for each, the **start stop** and the **end stop**, written exactly as drivers know them. A route name is optional; by default it is "Start to End".
3. **Vehicle registrations**, each with the **route** it normally works.
4. **Driver names**, and which vehicle each driver normally drives (the assignment). Same-name drivers need a staff number from the operator.

**Optional (defaults apply when not given):**

| Setting | Default when not supplied |
|---|---|
| Legal entity name | the business name (set at onboarding) |
| District | blank (set at onboarding) |
| Banking window (for example "Friday 16:30") | shown as "Set banking window" until supplied |
| Service interval | 10 000 km |
| Vehicle model | "Minibus taxi" |
| Seat capacity | 15 |
| Current odometer | 0 (set it so the first trip's opening odometer matches) |
| Permit and licence-disc expiry dates | not set (no expiry alerts) |
| Driver phone and PrDP expiry | not set |
| Expense presets | the app's built-in vehicle and business cost categories; any extra ones are added to these |

**Not part of this load:** who can sign in. Sign-in access is given separately by the Owner in Settings → Business access (Admin, Manager, Driver linked to a driver profile). It is never given by this loader.

## 2. Input file

The template is `scripts/pilot/business-data.example.json` (synthetic values):

```json
{
  "business": { "name": "<exact onboarded business name>" },
  "profile": { "legalEntity": "...", "district": "...", "nextBankingWindow": "Friday 16:30", "serviceIntervalKm": 10000 },
  "routes": [{ "startStop": "...", "endStop": "...", "code": "ABC", "name": "optional", "id": "optional stable id" }],
  "drivers": [{ "name": "...", "staffId": "optional stable id", "phone": "optional", "prdpExpiryDate": "YYYY-MM-DD", "route": "route name or id" }],
  "vehicles": [{ "registration": "...", "route": "route name or id", "assignedDriverName": "...", "assignedDriverStaffId": "...", "model": "...", "currentOdometer": 0, "seatCapacity": 15, "permitExpiryDate": "YYYY-MM-DD", "discExpiryDate": "YYYY-MM-DD", "id": "optional stable id" }],
  "expensePresets": { "asset": [{ "name": "Fuel", "descriptions": ["Diesel"] }], "operational": [{ "name": "Rank fees" }] }
}
```

## 3. Operator procedure (local stack today)

1. The business exists: `node scripts/localdb/onboard-business.mjs ...` (Task 18).
2. Dry run, which is the default and writes nothing:
   ```
   node scripts/localdb/load-business-data.mjs --slug <slug> --file <input.json>
   ```
   It prints every planned `ADD` and `UPDATE` (with changed fields), unchanged counts, warnings and errors.
3. Review the plan with the Owner if anything is unexpected.
4. Apply:
   ```
   node scripts/localdb/load-business-data.mjs --slug <slug> --file <input.json> --apply
   ```
5. Running the same file again reports "No changes. Nothing to write."

The loader refuses to run unless the target is the local, loopback-only stack. A hosted run needs the reviewed hosted procedure in `release-plan.md` (not built).

## 4. Rules the loader enforces (`scripts/pilot/business-data-plan.mjs`)

**Identity**
- **Routes:** a stable id, from the input or from the app's own `buildRouteReferenceId(name)`. A different id with an existing route's name is refused; supply the existing id instead.
- **Drivers:** a stable `staffId`, from the input or a deterministic id from the business and name. A new `staffId` whose name matches an existing driver is refused. Same-name drivers in one input each need a `staffId`.
- **Vehicles:** an `id`, or the registration after normalization (upper case; spaces and dashes collapsed). The registration identifies a vehicle only when exactly one existing vehicle has it; two matches are refused.

**Links**
- Every route, driver and assignment reference must exist (in the business or the same input).
- Ambiguous driver names in assignments are refused.
- An existing vehicle-driver link is never replaced.

**Stops**
- Explicit start and end stops are required, and they must differ.
- Trip capture still prefills stops from the route name. A name that doesn't read as "Start to End" produces a warning, and drivers then type the stops.

**History**
- Refused: changing the registration of a vehicle that money records or cash-ups reference; renaming a route that money records reference; lowering an odometer.

**Never touched**
- Money records (`financeTransactions`, `dailyCashUps`, `deposits`), the business directory (`appUsers`), Auth users and memberships.
- Nothing is ever deleted.
- Only the `profile` keys listed above can change; the business name cannot.

**Writes**
- One conditional update, applied only while the business is still at the version that was planned. A stale plan is refused, and the operator re-runs.
- Exactly one server-generated audit entry ("Business set-up data loaded by the operator").
- An unchanged repeat writes nothing and adds no audit entry.

## 5. Evidence (2026-10-10, local)

`node scripts/localdb/business-data-load-tests.mjs` (after a reset): **46/46**.
- Three synthetic businesses: the dry run writes nothing; the apply writes the data with one audit entry; the unchanged repeat writes nothing.
- Updates by stable id and normalized registration.
- Ambiguity refusals: route name, driver name, duplicate normalized registrations, ambiguous assignment.
- Same-name drivers with staffIds are allowed.
- Refused: invalid stops, links, registration and odometer; a business rename; money fields sent in the input.
- History protection on the seeded business with money records.
- A stale plan writes nothing; the re-run applies once; a retry is a no-op; the writer refuses any change to money records.
- Businesses A and B, Auth users and memberships are unchanged.
