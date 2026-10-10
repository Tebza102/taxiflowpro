#!/usr/bin/env node
// HOSTED operator procedure (NOT YET RUN): assign the initial Owner of an existing
// business, e.g. the mapped legacy workspace if no active Owner was mapped.
//   node scripts/hosted/assign-initial-owner.mjs --target <ref> --env-file <outside-repo> \
//     --slug <slug> --owner-email <email> [--owner-name "<name>"] [--driver-staff-id <id>] [--apply]
// Dry run by default; --apply needs a terminal and the typed project ref.
// Guards: scripts/hosted/lib/hosted-target.mjs. Logic: scripts/pilot/assign-initial-owner.mjs.
import { createClient } from "@supabase/supabase-js";

import { applyAssignInitialOwner, planAssignInitialOwner } from "../pilot/assign-initial-owner.mjs";
import { confirmApply, describeTarget, resolveHostedTarget } from "./lib/hosted-target.mjs";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

try {
  const target = resolveHostedTarget({ argv });
  const input = { slug: option("slug"), ownerEmail: option("owner-email"), ownerName: option("owner-name"), driverStaffId: option("driver-staff-id") };
  console.log(describeTarget(target, `assign initial Owner of "${input.slug}"`));
  const service = createClient(target.url, target.key, { auth: { autoRefreshToken: false, persistSession: false } });
  const plan = await planAssignInitialOwner(service, input);
  console.log(JSON.stringify(plan, null, 2));
  if (plan.problems.length) process.exit(1);
  if (!target.apply) {
    console.log("Dry run only. Re-run with --apply to assign.");
    process.exit(0);
  }
  await confirmApply(target);
  const result = await applyAssignInitialOwner(service, { ...input, redirectTo: process.env.TAXIFLOW_SETUP_REDIRECT });
  console.log(JSON.stringify({ ok: result.ok, status: result.status, accountCreated: result.accountCreated, setupEmailSent: result.setupEmailSent, partial: result.partial, error: result.error }, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(`REFUSED: ${error.message}`);
  process.exit(2);
}
