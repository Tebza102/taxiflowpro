#!/usr/bin/env node
// HOSTED operator procedure (NOT YET RUN): create a business and its initial Owner.
//   node scripts/hosted/onboard-business.mjs --target <ref> --env-file <outside-repo> \
//     --slug <slug> --name "<business name>" --owner-email <email> --owner-name "<name>" [--owner-drives] [--apply]
// Dry run by default (reads only); --apply needs a terminal and the typed project ref.
// Logic: api/_lib/tenantOnboarding.js createBusinessWithOwner (idempotent by slug).
import { createClient } from "@supabase/supabase-js";

import { createBusinessWithOwner, findAuthUserByEmail, normalizeEmail } from "../../api/_lib/tenantOnboarding.js";
import { confirmApply, describeTarget, resolveHostedTarget } from "./lib/hosted-target.mjs";

const argv = process.argv.slice(2);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

try {
  const target = resolveHostedTarget({ argv });
  const input = { slug: option("slug"), name: option("name"), ownerEmail: option("owner-email"), ownerName: option("owner-name"), ownerDrives: argv.includes("--owner-drives") };
  console.log(describeTarget(target, `onboard business "${input.slug}"`));
  const service = createClient(target.url, target.key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: existing } = await service.from("businesses").select("id, name").eq("slug", String(input.slug ?? "").toLowerCase()).maybeSingle();
  const account = input.ownerEmail ? await findAuthUserByEmail(service, normalizeEmail(input.ownerEmail)) : null;
  console.log(JSON.stringify({
    business: existing ? `exists (${existing.name}); a repeat with the same Owner is a no-op, another Owner is refused` : "new",
    ownerAccount: account ? "existing (unchanged)" : "new (password-setup email)",
    ownerDrives: input.ownerDrives,
  }, null, 2));
  if (!target.apply) {
    console.log("Dry run only. Re-run with --apply to create.");
    process.exit(0);
  }
  await confirmApply(target);
  const result = await createBusinessWithOwner(service, { ...input, redirectTo: process.env.TAXIFLOW_SETUP_REDIRECT });
  console.log(JSON.stringify({ ok: result.ok, status: result.status, businessId: result.businessId, ownerCreated: result.ownerCreated, setupEmailSent: result.setupEmailSent, partial: result.partial, error: result.error }, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(`REFUSED: ${error.message}`);
  process.exit(2);
}
