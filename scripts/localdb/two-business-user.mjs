#!/usr/bin/env node
// LOCAL synthetic stack only: gives newhire.a@example.com active Manager
// memberships in business A and business B, so the browser proof can exercise
// explicit business selection and switching. Idempotent.
import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID } from "./seed-data.mjs";

const NEWHIRE_ID = "00000000-0000-4000-8000-0000000000c3";

assertLocalDatabase();
assertLoopbackOnlyOrStop();
psql(
  [BUSINESS_A_ID, BUSINESS_B_ID]
    .map(
      (businessId) =>
        `insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active) values ('${businessId}', '${NEWHIRE_ID}', 'Manager', null, true) on conflict (business_id, user_id) do update set role = 'Manager', active = true;`,
    )
    .join("\n"),
);
console.log("[localdb] newhire.a@example.com: Manager in business A and business B");
