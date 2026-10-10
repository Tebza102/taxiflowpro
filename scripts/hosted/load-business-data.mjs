#!/usr/bin/env node
// HOSTED operator procedure (NOT YET RUN): load one business's set-up data.
//   node scripts/hosted/load-business-data.mjs --target <ref> --env-file <outside-repo> \
//     --slug <slug> --file <input.json> [--apply]
// Prints the plan first (dry run by default); --apply needs a terminal and the
// typed project ref. Logic and rules: scripts/pilot/business-data-plan.mjs (the
// same tested planner as scripts/localdb/load-business-data.mjs).
import { createClient } from "@supabase/supabase-js";

import { loadAppRuntime } from "../localdb/lib/appRuntime.mjs";
import { runLoader } from "../localdb/load-business-data.mjs";
import { confirmApply, describeTarget, resolveHostedTarget } from "./lib/hosted-target.mjs";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

let close = async () => {};
try {
  const target = resolveHostedTarget({ argv });
  const slugValue = option("slug");
  const file = option("file");
  if (!slugValue || !file) throw new Error("--slug and --file are required.");
  console.log(describeTarget(target, `load business data into "${slugValue}"`));
  const service = createClient(target.url, target.key, { auth: { autoRefreshToken: false, persistSession: false } });
  const runtime = await loadAppRuntime();
  close = runtime.close;
  const plan = await runLoader({ slugValue, file, apply: false, service, rt: runtime.rt });
  if (!plan.ok || plan.status !== "dry-run" || !target.apply) process.exit(plan.ok ? 0 : 1);
  await confirmApply(target);
  // Apply only what was shown: re-plan and refuse if anything differs.
  const recheck = await runLoader({ slugValue, file, apply: false, service, rt: runtime.rt, log: () => {} });
  const shown = JSON.stringify(plan.plan.changes);
  if (JSON.stringify(recheck.plan?.changes) !== shown) throw new Error("The business changed after the plan was shown; nothing was written. Run again.");
  const result = await runLoader({ slugValue, file, apply: true, service, rt: runtime.rt });
  if (result.ok && JSON.stringify(result.plan?.changes) !== shown) console.error("WARNING: the applied changes differ from the plan shown; review the audit entry.");
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`REFUSED: ${error.message}`);
  process.exitCode = 2;
} finally {
  await close();
}
