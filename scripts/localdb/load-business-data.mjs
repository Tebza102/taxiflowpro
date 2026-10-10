#!/usr/bin/env node
// OPERATOR business-data loader (LOCAL synthetic stack only).
//   node scripts/localdb/load-business-data.mjs --slug pilot-one --file data.json          (dry run)
//   node scripts/localdb/load-business-data.mjs --slug pilot-one --file data.json --apply  (write)
// Shows the planned additions and updates first. Writes only with --apply, only
// to an EXISTING business, in one version-checked update with one operator audit
// entry; an unchanged repeat writes nothing. Never touches money records, the
// business directory, Auth users or memberships. Rules: scripts/pilot/business-data-plan.mjs.
// Input format and owner checklist: project-os/05-build/pilot-business-data.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { applyBusinessDataLoad, planBusinessDataLoad } from "../pilot/business-data-plan.mjs";
import { assertLocalDatabase, assertLoopbackOnlyOrStop } from "./lib/exec.mjs";
import { loadAppRuntime } from "./lib/appRuntime.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

export const runLoader = async ({ slugValue, file, apply, service, rt, log = console.log }) => {
  const input = JSON.parse(readFileSync(file, "utf8"));
  const { data: business, error: businessError } = await service.from("businesses").select("id, slug, name").eq("slug", slugValue).maybeSingle();
  if (businessError) throw new Error("The business could not be looked up.");
  if (!business) return { ok: false, status: "no-business", error: `No business with slug "${slugValue}". Onboard it first (onboard-business.mjs).` };
  const { data: row, error: rowError } = await service.from("workspace_snapshots").select("snapshot, updated_at").eq("business_id", business.id).maybeSingle();
  if (rowError || !row) return { ok: false, status: "no-snapshot", error: "The business snapshot could not be read." };

  const plan = planBusinessDataLoad({ input, business, snapshot: row.snapshot, rt });
  log(`Business: ${business.name} (${business.slug})  version ${row.updated_at}`);
  for (const change of plan.changes) log(`  ${change.action === "add" ? "ADD   " : "UPDATE"} ${change.kind} ${change.label} [${change.id}]${change.fields ? ` fields: ${change.fields.join(", ")}` : ""}`);
  log(`  unchanged: ${plan.unchanged.length}`);
  for (const warning of plan.warnings) log(`  WARNING ${warning}`);
  for (const error of plan.errors) log(`  ERROR ${error}`);
  if (plan.errors.length) return { ok: false, status: "invalid", plan };
  if (!plan.changes.length) {
    log("No changes. Nothing to write.");
    return { ok: true, status: "unchanged", plan };
  }
  if (!apply) {
    log(`Dry run: ${plan.changes.length} change(s) planned. Re-run with --apply to write them.`);
    return { ok: true, status: "dry-run", plan };
  }
  const result = await applyBusinessDataLoad({ service, businessId: business.id, expectedVersion: row.updated_at, before: row.snapshot, plan });
  log(result.ok ? `Applied: ${plan.changes.length} change(s), new version ${result.version}.` : `NOT applied: ${result.error}`);
  return { ...result, plan };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const status = assertLocalDatabase();
  assertLoopbackOnlyOrStop();
  const slugValue = option("slug");
  const file = option("file");
  if (!slugValue || !file) {
    console.error("Usage: node scripts/localdb/load-business-data.mjs --slug <business-slug> --file <data.json> [--apply]");
    process.exit(2);
  }
  const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { rt, close } = await loadAppRuntime();
  try {
    assertLoopbackOnlyOrStop();
    const result = await runLoader({ slugValue, file, apply: args.includes("--apply"), service, rt });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await close();
  }
}
