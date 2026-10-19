#!/usr/bin/env node
// OPERATOR procedure for the ISOLATED Preview test backend only
// (taxiflow-preview-test). Creates the synthetic test companies through the
// app's own server logic, never raw SQL:
//   * test sign-ins (Supabase Auth admin API; password from the git-ignored
//     .env.preview-test.local, never printed);
//   * two companies with their Owners (createBusinessWithOwner);
//   * set-up data through the operator loader (route, driver profile, vehicles);
//   * Admin, Manager and Driver access (the Owner's member.grant).
//   node scripts/preview-test/seed-hosted-test.mjs --target <ref> --env-file <outside-repo> [--apply [--confirm-ref <ref>]]
// The env file holds SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...) for the
// TEST project; the script refuses production and any ref other than the one in
// .env.preview-test.local. Dry run by default; --apply asks for the typed ref.
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { LIVE_PROJECT_REF } from "../localdb/lib/localTarget.mjs";
import { confirmApply, describeTarget, REPO_ROOT, resolveHostedTarget } from "../hosted/lib/hosted-target.mjs";

const PASSWORD_FILE = path.join(REPO_ROOT, ".env.preview-test.local");
const local = existsSync(PASSWORD_FILE) ? Object.fromEntries(readFileSync(PASSWORD_FILE, "utf8").split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean).map((m) => [m[1], m[2]])) : {};

const COMPANIES = [
  {
    slug: "preview-company-a",
    name: "Preview Company A",
    owner: { email: "owner@example.com", name: "UAT Owner" },
    staff: [
      { email: "admin@example.com", name: "UAT Admin", role: "Admin" },
      { email: "manager@example.com", name: "UAT Manager", role: "Manager" },
      { email: "driver@example.com", name: "UAT Driver", role: "Driver", driverStaffId: "pv-drv-01" },
    ],
    data: {
      routes: [{ startStop: "Rank A", endStop: "Rank B", code: "RAB" }],
      drivers: [{ staffId: "pv-drv-01", name: "UAT Driver", route: "Rank A to Rank B" }],
      vehicles: [
        { registration: "PV-TEST-01", model: "UAT Minibus", route: "Rank A to Rank B", assignedDriverStaffId: "pv-drv-01", currentOdometer: 1000 },
        { registration: "PV-TEST-02", model: "UAT Minibus", route: "Rank A to Rank B", currentOdometer: 2000 },
      ],
    },
  },
  {
    slug: "preview-company-b",
    name: "Preview Company B",
    owner: { email: "owner.b@example.com", name: "UAT Owner B" },
    staff: [{ email: "manager.b@example.com", name: "UAT Manager B", role: "Manager" }],
    data: {
      routes: [{ startStop: "Rank C", endStop: "Rank D", code: "RCD" }],
      drivers: [{ staffId: "pv-drv-b-01", name: "UAT Driver B", route: "Rank C to Rank D" }],
      vehicles: [{ registration: "PV-TEST-B1", model: "UAT Minibus", route: "Rank C to Rank D", currentOdometer: 500 }],
    },
  },
];

try {
  const argv = process.argv.slice(2);
  const target = resolveHostedTarget({ argv });
  if (target.ref === LIVE_PROJECT_REF) throw new Error("That is the production project. This procedure is for the isolated test project only.");
  if (!local.PREVIEW_TEST_REF || target.ref !== local.PREVIEW_TEST_REF) throw new Error("--target must be the test project recorded in .env.preview-test.local.");
  if (!local.PREVIEW_TEST_PASSWORD) throw new Error(".env.preview-test.local has no PREVIEW_TEST_PASSWORD.");
  console.log(describeTarget(target, "seed the synthetic Preview test companies"));

  // The server modules read these; they only ever point at the test project here.
  process.env.SUPABASE_URL = target.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = target.key;
  delete process.env.VITE_SUPABASE_URL;
  const service = createClient(target.url, target.key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { MEMBER_ACTIONS, createBusinessWithOwner, findAuthUserByEmail } = await import("../../api/_lib/tenantOnboarding.js");
  const { runLoader } = await import("../localdb/load-business-data.mjs");
  const { loadAppRuntime } = await import("../localdb/lib/appRuntime.mjs");

  const emails = COMPANIES.flatMap((company) => [company.owner, ...company.staff]);
  const plan = [];
  for (const person of emails) plan.push(`${(await findAuthUserByEmail(service, person.email)) ? "keep" : "create"} sign-in ${person.email}`);
  for (const company of COMPANIES) plan.push(`company ${company.slug} (Owner ${company.owner.email}); ${company.staff.map((s) => `${s.role} ${s.email}`).join(", ")}`);
  console.log(plan.map((line) => `  ${line}`).join("\n"));
  if (!target.apply) {
    console.log("Dry run only. Re-run with --apply to write.");
    process.exit(0);
  }
  // Confirmation: the typed ref in a terminal, or (non-interactive, this
  // test-only script) --confirm-ref with the exact test ref. Both still need
  // --apply and every target guard above.
  const confirmIndex = argv.indexOf("--confirm-ref");
  if (confirmIndex >= 0) {
    if (argv[confirmIndex + 1] !== "sxoonhovoqgcpflhqirb" || argv[confirmIndex + 1] !== target.ref) {
      throw new Error("--confirm-ref must be exactly the isolated test project ref; nothing was written.");
    }
  } else {
    await confirmApply(target);
  }

  for (const person of emails) {
    if (await findAuthUserByEmail(service, person.email)) continue;
    const { error } = await service.auth.admin.createUser({ email: person.email, password: local.PREVIEW_TEST_PASSWORD, email_confirm: true, user_metadata: { name: person.name } });
    if (error) throw new Error(`Could not create ${person.email}: ${error.message}`);
  }
  const runtime = await loadAppRuntime();
  const workDir = mkdtempSync(path.join(tmpdir(), "taxiflow-preview-seed-"));
  for (const company of COMPANIES) {
    const created = await createBusinessWithOwner(service, { slug: company.slug, name: company.name, ownerEmail: company.owner.email, ownerName: company.owner.name });
    if (!created.ok) throw new Error(`${company.slug}: ${created.error}`);
    const file = path.join(workDir, `${company.slug}.json`);
    writeFileSync(file, JSON.stringify({ business: { name: company.name }, ...company.data }));
    const loaded = await runLoader({ slugValue: company.slug, file, apply: true, service, rt: runtime.rt });
    if (!loaded.ok) throw new Error(`${company.slug} set-up data: ${loaded.error ?? loaded.status}`);
    const owner = await findAuthUserByEmail(service, company.owner.email);
    const authorization = { userId: owner.id, email: company.owner.email, businessId: created.businessId, role: "Owner", driverStaffId: null };
    for (const person of company.staff) {
      await MEMBER_ACTIONS["member.grant"](authorization, { email: person.email, name: person.name, role: person.role, ...(person.driverStaffId ? { driverStaffId: person.driverStaffId } : {}) }, {});
    }
    console.log(`  ${company.slug}: ${created.status}; ${company.staff.length} member(s) granted`);
  }
  console.log("Seeded. Passwords were not printed.");
  process.exit(0);
} catch (error) {
  console.error(`REFUSED: ${error.message}`);
  process.exit(2);
}
