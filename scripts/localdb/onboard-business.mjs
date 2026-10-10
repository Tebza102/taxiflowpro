#!/usr/bin/env node
// OPERATOR procedure (LOCAL synthetic stack): create a business and its initial
// Owner. This is the only way a business or an Owner comes into existence; no
// browser or public route can do it. Safe to repeat: the same slug and Owner
// return "existing" and change nothing.
//
// Usage:
//   node scripts/localdb/onboard-business.mjs --slug pilot-one --name "Pilot One Taxis" \
//     --owner-email owner.one@example.com --owner-name "Pilot Owner One" [--owner-drives]
//
// A new Owner account gets a password-setup email (local Mailpit). An existing
// account is not changed; its other business memberships are untouched.
// Prints ids and outcome only (no keys, tokens or passwords).
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop } from "./lib/exec.mjs";
import { createBusinessWithOwner } from "../../api/_lib/tenantOnboarding.js";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const result = await createBusinessWithOwner(service, {
  slug: option("slug"),
  name: option("name"),
  ownerEmail: option("owner-email"),
  ownerName: option("owner-name"),
  ownerDrives: args.includes("--owner-drives"),
  redirectTo: "http://127.0.0.1:5175/",
});
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
