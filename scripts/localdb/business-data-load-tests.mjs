#!/usr/bin/env node
// Operator business-data loader proof (LOCAL synthetic stack). Requires a fresh
// `node scripts/localdb/setup.mjs reset`. Three synthetic businesses, dry-run
// default, apply, unchanged repeat, ambiguity, invalid links, history
// protection, stale versions, retries and preservation of unrelated data.
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { applyBusinessDataLoad, planBusinessDataLoad } from "../pilot/business-data-plan.mjs";
import { loadAppRuntime } from "./lib/appRuntime.mjs";
import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { runLoader } from "./load-business-data.mjs";
import { BUSINESS_A_ID, BUSINESS_B_ID } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
process.env.SUPABASE_URL = status.apiUrl;
process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
const { createBusinessWithOwner } = await import("../../api/_lib/tenantOnboarding.js");

const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};
const sql = (t) => psql(t).stdout.trim();
const service = createClient(status.apiUrl, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const dir = mkdtempSync(path.join(os.tmpdir(), "taxiflow-load-"));
const { rt, close } = await loadAppRuntime();
const quiet = () => {};

const snapshotOf = (businessId) => JSON.parse(sql(`select snapshot::text from public.workspace_snapshots where business_id = '${businessId}';`));
const versionOf = (businessId) => sql(`select updated_at::text from public.workspace_snapshots where business_id = '${businessId}';`);
const hashOf = (businessId) => sql(`select md5(snapshot::text) || ':' || updated_at::text from public.workspace_snapshots where business_id = '${businessId}';`);
const protectedHash = (businessId) => sql(`select md5(coalesce(snapshot->'financeTransactions','null')::text || coalesce(snapshot->'dailyCashUps','null')::text || coalesce(snapshot->'deposits','null')::text || coalesce(snapshot->'appUsers','null')::text) from public.workspace_snapshots where business_id = '${businessId}';`);
const authAndMembers = () => sql(`select (select count(*) from auth.users) || '/' || (select md5(coalesce(json_agg(json_build_array(business_id, user_id, role, driver_staff_id, active) order by business_id, user_id)::text, '')) from public.business_memberships);`);
const auditCount = (businessId) => Number(sql(`select jsonb_array_length(coalesce(snapshot->'auditTrail','[]'::jsonb)) from public.workspace_snapshots where business_id = '${businessId}';`));
let fileIndex = 0;
const write = (data) => {
  const file = path.join(dir, `input-${(fileIndex += 1)}.json`);
  writeFileSync(file, JSON.stringify(data));
  return file;
};
const load = async (slugValue, data, apply = false) => {
  guard();
  const lines = [];
  const result = await runLoader({ slugValue, file: write(data), apply, service, rt, log: (line) => lines.push(line) });
  return { ...result, lines };
};
const errorsOf = (result) => result.plan?.errors ?? [];
const hasError = (result, pattern) => errorsOf(result).some((message) => pattern.test(message));

const dataFor = (name, tag) => ({
  business: { name },
  profile: { legalEntity: `${name} (Pty) Ltd`, district: "Synthetic District", nextBankingWindow: "Friday 16:30" },
  routes: [
    { startStop: `${tag} Rank`, endStop: `${tag} Mall`, code: `${tag}M` },
    { startStop: `${tag} Mall`, endStop: `${tag} Station` },
  ],
  drivers: [
    { name: `${tag} Driver One`, route: `${tag} Rank to ${tag} Mall` },
    { name: `${tag} Driver Two`, route: `${tag} Mall to ${tag} Station` },
  ],
  vehicles: [
    { registration: `${tag} 100 GP`, route: `${tag} Rank to ${tag} Mall`, assignedDriverName: `${tag} Driver One`, currentOdometer: 100000 },
    { registration: `${tag} 200 gp`, route: `${tag} Mall to ${tag} Station`, assignedDriverName: `${tag} Driver Two` },
  ],
  expensePresets: { asset: [{ name: "Fuel", descriptions: ["Diesel"] }], operational: [{ name: "Rank fees" }] },
});

try {
  // --- Three synthetic businesses ---------------------------------------------------------
  const pilots = [["pilot-one", "Pilot One Taxis", "PO"], ["pilot-two", "Pilot Two Taxis", "PT"], ["pilot-three", "Pilot Three Taxis", "PH"]];
  const ids = {};
  for (const [slugValue, name] of pilots) {
    const created = await createBusinessWithOwner(service, { slug: slugValue, name, ownerEmail: `owner.${slugValue}@example.com`, ownerName: `Owner ${name}` });
    ids[slugValue] = created.businessId;
  }
  const otherBusinesses = () => [BUSINESS_A_ID, BUSINESS_B_ID].map(hashOf).join("|");
  const baseline = { others: otherBusinesses(), auth: authAndMembers() };

  // --- Guards --------------------------------------------------------------------------------
  let res = await load("no-such-business", dataFor("X", "XX"), true);
  record(!res.ok && res.status === "no-business", "an unknown business is refused (no business is created)", res.error);
  res = await load("pilot-one", dataFor("Wrong Name", "PO"), true);
  record(!res.ok && hasError(res, /does not match the business/) && auditCount(ids["pilot-one"]) === 0, "a business-name mismatch is refused", errorsOf(res)[0]);
  res = await load("pilot-one", { business: { name: "Pilot One Taxis" }, routes: [], vehicles: [] }, true);
  record(!res.ok && hasError(res, /At least one route/) && hasError(res, /At least one vehicle/), "first load requires routes and vehicles");

  // --- Dry run by default, then apply, then unchanged repeat --------------------------------
  for (const [slugValue, name, tag] of pilots) {
    const before = hashOf(ids[slugValue]);
    res = await load(slugValue, dataFor(name, tag));
    record(res.ok && res.status === "dry-run" && hashOf(ids[slugValue]) === before && res.plan.changes.length === 8, `${slugValue}: dry run shows 8 planned changes and writes nothing`, `${res.plan?.changes.length}`);
    res = await load(slugValue, dataFor(name, tag), true);
    const snap = snapshotOf(ids[slugValue]);
    record(
      res.ok && res.status === "applied" && snap.routes.length === 2 && snap.drivers.length === 2 && snap.vehicles.length === 2 && auditCount(ids[slugValue]) === 1,
      `${slugValue}: --apply writes 2 routes, 2 drivers, 2 vehicles and one operator audit entry`,
      res.status,
    );
    const vehicle = snap.vehicles.find((v) => v.registration === `${tag} 100 GP`);
    const driverOne = snap.drivers.find((d) => d.name === `${tag} Driver One`);
    const route = snap.routes.find((r) => r.name === `${tag} Rank to ${tag} Mall`);
    record(
      vehicle?.assignedDriverId === driverOne?.staffId && vehicle?.currentRouteId === route?.id && route?.primaryOrigin === `${tag} Rank` && route?.primaryDestination === `${tag} Mall` && snap.vehicles.some((v) => v.registration === `${tag} 200 GP`),
      `${slugValue}: links and explicit stops stored; registration normalized`,
    );
    const version = versionOf(ids[slugValue]);
    res = await load(slugValue, dataFor(name, tag), true);
    record(res.ok && res.status === "unchanged" && versionOf(ids[slugValue]) === version && auditCount(ids[slugValue]) === 1, `${slugValue}: unchanged repeat writes nothing and adds no audit entry`);
  }
  record(otherBusinesses() === baseline.others, "the existing businesses A and B are untouched by the three loads");
  record(authAndMembers() === baseline.auth, "Auth users and memberships are untouched");

  // --- Updates by stable id ------------------------------------------------------------------
  const p1 = ids["pilot-one"];
  const s1 = snapshotOf(p1);
  const routeId = s1.routes[0].id;
  const driverTwo = s1.drivers.find((d) => d.name === "PO Driver Two");
  res = await load("pilot-one", { business: { name: "Pilot One Taxis" }, routes: [{ id: routeId, name: "PO Rank to PO Mall", startStop: "PO Rank", endStop: "PO Mall", code: "POX" }], drivers: [{ staffId: driverTwo.staffId, name: "PO Driver Two", phone: "000 000 0002" }], vehicles: [{ registration: "po 100 gp", currentOdometer: 100500 }] }, true);
  const s1b = snapshotOf(p1);
  record(
    res.ok && res.status === "applied" && s1b.routes.find((r) => r.id === routeId).code === "POX" && s1b.drivers.find((d) => d.staffId === driverTwo.staffId).phone === "000 000 0002" && s1b.vehicles.find((v) => v.registration === "PO 100 GP").currentOdometer === 100500 && s1b.vehicles.length === 2,
    "updates use stable ids; the registration identifies the vehicle after normalization",
    res.plan?.changes.map((c) => `${c.kind}:${c.fields?.join("+")}`).join(" "),
  );

  // --- Ambiguity -------------------------------------------------------------------------------
  const p2 = ids["pilot-two"];
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, routes: [{ id: "route-other-id", name: "PT Rank to PT Mall", startStop: "PT Rank", endStop: "PT Mall" }] }, true);
  record(!res.ok && hasError(res, /already exists with id/), "a new route id with an existing route name is refused (no silent match)", errorsOf(res)[0]);
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, drivers: [{ name: "PT Driver One", phone: "1" }] }, true);
  const ambiguousDriverNoId = res;
  // Same name supplied without staffId resolves to the same deterministic id -> an update, not a duplicate.
  record(res.ok && snapshotOf(p2).drivers.filter((d) => d.name === "PT Driver One").length === 1, "a repeated driver name without staffId maps to the same deterministic id (no duplicate)", ambiguousDriverNoId.status);
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, drivers: [{ staffId: "drv-different", name: "PT Driver One" }] }, true);
  record(!res.ok && hasError(res, /already exists/), "a new staffId with an existing driver name is refused", errorsOf(res)[0]);
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, drivers: [{ name: "Sam Same" }, { name: "Sam Same" }] }, true);
  record(!res.ok && hasError(res, /give each a staffId/), "two input drivers with the same name and no staffIds are refused");
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, drivers: [{ staffId: "drv-sam-1", name: "Sam Same" }, { staffId: "drv-sam-2", name: "Sam Same" }] }, true);
  record(res.ok && res.status === "applied", "same-name drivers load when each has its own staffId");
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, vehicles: [{ registration: "PT 300 GP", route: "PT Rank to PT Mall", assignedDriverName: "Sam Same" }] }, true);
  record(!res.ok && hasError(res, /is ambiguous; use assignedDriverStaffId/) && !snapshotOf(p2).vehicles.some((v) => v.registration === "PT 300 GP"), "an ambiguous driver name in an assignment is refused");
  guard();
  psql(`update public.workspace_snapshots set snapshot = jsonb_set(snapshot, '{vehicles}', (snapshot->'vehicles') || '[{"id":"veh-dup-a","registration":"PT 900 GP","route":"PT Rank to PT Mall"},{"id":"veh-dup-b","registration":"pt  900 gp","route":"PT Rank to PT Mall"}]'::jsonb), updated_at = now() where business_id = '${p2}';`);
  res = await load("pilot-two", { business: { name: "Pilot Two Taxis" }, vehicles: [{ registration: "PT 900 GP", currentOdometer: 5 }] }, true);
  record(!res.ok && hasError(res, /2 existing vehicles have registration/), "two existing vehicles with the same normalized registration are refused", errorsOf(res)[0]);

  // --- Invalid links and stops -----------------------------------------------------------------
  const p3 = ids["pilot-three"];
  const before3 = hashOf(p3);
  const invalid = [
    [{ routes: [{ startStop: "PH Rank", endStop: "" }] }, /startStop and endStop are required/, "a route without an explicit end stop"],
    [{ routes: [{ startStop: "PH Rank", endStop: "ph rank" }] }, /must be different stops/, "a route whose stops are the same"],
    [{ vehicles: [{ registration: "PH 300 GP", route: "Nowhere to Elsewhere" }] }, /does not exist in this business/, "a vehicle on an unknown route"],
    [{ vehicles: [{ registration: "PH 300 GP", route: "PH Rank to PH Mall", assignedDriverStaffId: "drv-missing" }] }, /drv-missing does not exist/, "a vehicle assigned to an unknown driver"],
    [{ vehicles: [{ registration: "PH 300 GP" }] }, /route is required/, "a new vehicle without a route"],
    [{ vehicles: [{ registration: "!!" }] }, /is not valid/, "an invalid registration"],
    [{ drivers: [{ name: "PH Driver One", route: "Unknown Route" }] }, /does not exist/, "a driver on an unknown route"],
    [{ vehicles: [{ registration: "PH 100 GP", assignedDriverName: "PH Driver Two" }] }, /never reassigns an existing link/, "reassigning an existing vehicle-driver link"],
    [{ vehicles: [{ registration: "PH 100 GP", currentOdometer: 10 }] }, /odometers never go back/, "an odometer decrease"],
    [{ profile: { fleetName: "Renamed" } }, /not supported/, "renaming the business through the loader"],
    [{ financeTransactions: [] }, /Unknown top-level field/, "an attempt to send money records"],
  ];
  for (const [patch, pattern, label] of invalid) {
    res = await load("pilot-three", { business: { name: "Pilot Three Taxis" }, ...patch }, true);
    record(!res.ok && hasError(res, pattern), `refused: ${label}`, errorsOf(res).find((m) => pattern.test(m)) ?? errorsOf(res)[0]);
  }
  record(hashOf(p3) === before3, "no refused load wrote anything to Pilot Three");

  // --- History protection on the seeded business with money records --------------------------
  const before2 = hashOf(BUSINESS_A_ID);
  const aName = sql(`select name from public.businesses where id = '${BUSINESS_A_ID}';`);
  const slugA = sql(`select slug from public.businesses where id = '${BUSINESS_A_ID}';`);
  const moneyBefore = protectedHash(BUSINESS_A_ID);
  res = await load(slugA, { business: { name: aName }, vehicles: [{ id: "uat-veh-01", registration: "UAT RENAMED 1" }] }, true);
  record(!res.ok && hasError(res, /has money records/), "changing the registration of a vehicle with money records is refused", errorsOf(res)[0]);
  res = await load(slugA, { business: { name: aName }, routes: [{ id: "uat-route-a", name: "Renamed Route", startStop: "UAT Start", endStop: "UAT End" }] }, true);
  record(!res.ok && hasError(res, /referenced by money records/), "renaming a route that money records reference is refused", errorsOf(res)[0]);
  res = await load(slugA, { business: { name: aName }, routes: [{ id: "uat-route-a", name: "UAT Route A", startStop: "UAT Start", endStop: "UAT End" }] }, true);
  const routeA = snapshotOf(BUSINESS_A_ID).routes.find((r) => r.id === "uat-route-a");
  record(res.ok && routeA.primaryOrigin === "UAT Start" && res.plan.warnings.some((w) => /does not read as/.test(w)), "adding explicit stops to an existing route keeps its name; a non-matching name is warned about", res.plan?.warnings[0]);
  record(protectedHash(BUSINESS_A_ID) === moneyBefore && before2 !== hashOf(BUSINESS_A_ID), "money records, cash-ups, deposits and the directory are byte-identical after a load that changed the business");

  // --- Stale version and retry ---------------------------------------------------------------------
  const staleRow = { snapshot: snapshotOf(p3), version: sql(`select updated_at::text from public.workspace_snapshots where business_id = '${p3}';`) };
  const stalePlan = planBusinessDataLoad({ input: { business: { name: "Pilot Three Taxis" }, drivers: [{ name: "PH Driver Three" }] }, business: { id: p3, slug: "pilot-three", name: "Pilot Three Taxis" }, snapshot: staleRow.snapshot, rt });
  guard();
  psql(`update public.workspace_snapshots set updated_at = now() where business_id = '${p3}';`);
  const afterBump = hashOf(p3);
  const stale = await applyBusinessDataLoad({ service, businessId: p3, expectedVersion: staleRow.version, before: staleRow.snapshot, plan: stalePlan });
  record(!stale.ok && stale.status === "stale" && hashOf(p3) === afterBump, "a plan made on an older version is refused and writes nothing", stale.error);
  res = await load("pilot-three", { business: { name: "Pilot Three Taxis" }, drivers: [{ name: "PH Driver Three" }] }, true);
  record(res.ok && res.status === "applied" && snapshotOf(p3).drivers.length === 3, "re-running after a stale refusal re-plans and applies once");
  res = await load("pilot-three", { business: { name: "Pilot Three Taxis" }, drivers: [{ name: "PH Driver Three" }] }, true);
  record(res.ok && res.status === "unchanged" && snapshotOf(p3).drivers.length === 3, "retrying the same load again is a no-op");
  const protectedBefore = { ...staleRow.snapshot, financeTransactions: [{ id: "x" }] };
  const refused = await applyBusinessDataLoad({ service, businessId: p3, expectedVersion: versionOf(p3), before: protectedBefore, plan: { errors: [], changes: [{}], nextSnapshot: staleRow.snapshot } });
  record(!refused.ok && refused.status === "refused", "the writer refuses any plan that would change money records", refused.error);

  record(authAndMembers() === baseline.auth, "after every test: Auth users and memberships unchanged");
} finally {
  await close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
