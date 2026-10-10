#!/usr/bin/env node
// Hosted-release rehearsal checks on the LOCAL exact copy of the live schema.
// Requires a fresh `node scripts/localdb/setup.mjs hosted`. Proves: the live
// insecure access is gone (policies, grants incl. TRUNCATE, defaults, RLS, the
// view), the legacy tables and the workspace data are preserved, existing users
// are mapped, and browsers (anon and signed-in) are denied every direct path.
// Authorized server access is proven by running the existing suites on the same
// rehearsal database (see project-os/05-build/hosted-inventory.md).
import { createClient } from "@supabase/supabase-js";

import { assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD, buildSyntheticSnapshot } from "./seed-data.mjs";

const status = assertLocalDatabase();
assertLoopbackOnlyOrStop();
const results = [];
const record = (ok, name, detail) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sql = (text) => psql(text).stdout.trim();
const guard = () => {
  assertLoopbackOnlyOrStop();
  assertLocalDatabase();
};

const LIVE_RELATIONS = ["workspace_snapshots", "fleet_profiles", "personnel_profiles", "vehicles", "banking_events", "shift_reconciliations", "expense_entries", "defect_reports", "compliance_documents", "compliance_dashboard"];
const LEGACY_TABLES = LIVE_RELATIONS.filter((name) => !["workspace_snapshots", "compliance_dashboard"].includes(name));

// --- Catalog state after the hosted release files ---------------------------------------
record(sql("select count(*) from pg_policies where schemaname='public' and tablename='workspace_snapshots';") === "0", "no policy remains on workspace_snapshots (the 3 live policies are gone)");
const tables = sql("select string_agg(c.relname || ':' || c.relrowsecurity, ',' order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';");
record(!tables.includes(":false") && LEGACY_TABLES.every((name) => tables.includes(`${name}:true`)), "RLS is enabled on every public table, including the 8 legacy tables", tables);
const grants = sql("select coalesce(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type), '') from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC');");
record(grants === "business_memberships:authenticated:SELECT,businesses:authenticated:SELECT", "browser grants are exactly: authenticated SELECT on businesses and business_memberships", grants);
const truncatable = sql(`select coalesce(string_agg(r || ':' || role, ','), '') from unnest(array['${LIVE_RELATIONS.join("','")}']) r cross join unnest(array['anon','authenticated']) role where has_table_privilege(role, 'public.' || r, 'TRUNCATE') or has_table_privilege(role, 'public.' || r, 'SELECT') or has_table_privilege(role, 'public.' || r, 'INSERT') or has_table_privilege(role, 'public.' || r, 'UPDATE') or has_table_privilege(role, 'public.' || r, 'DELETE');`);
record(truncatable === "", "anon and authenticated hold no SELECT/INSERT/UPDATE/DELETE/TRUNCATE on any of the 10 live relations", truncatable);
record(sql("select coalesce(array_to_string(reloptions, ','), '') from pg_class where oid = 'public.compliance_dashboard'::regclass;") === "security_invoker=true", "the legacy view runs with the caller's rights (security_invoker)");
const defaults = sql("select coalesce(string_agg(defaclobjtype::text || ':' || array_to_string(defaclacl, ' '), ' | '), '') from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'postgres';");
record(!/(^|[ ,|])(anon|authenticated)=/.test(defaults), "postgres default privileges in public no longer grant anon/authenticated", defaults || "(none)");
const execFns = sql("select coalesce(string_agg(p.proname, ','), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));");
record(execFns === "", "no public function is executable by anon or authenticated", execFns);
record(sql("select count(*) from pg_proc where proname = 'set_business_membership';") === "0", "the browser membership RPC does not exist in the hosted release");

// --- Data preserved and existing users mapped --------------------------------------------
record(LEGACY_TABLES.every((name) => sql(`select to_regclass('public.${name}') is not null;`) === "t"), "the 8 legacy tables are kept (nothing dropped)");
const preserved = sql(`select (snapshot = '${JSON.stringify(buildSyntheticSnapshot()).replace(/'/g, "''")}'::jsonb)::text || ':' || business_id from public.workspace_snapshots where workspace_key = 'taxiflow-live';`);
record(preserved === `true:${BUSINESS_A_ID}`, "the existing workspace is unchanged and mapped to the legacy business", preserved);
const mapped = sql(`select string_agg(m.role, ',' order by m.role) from public.business_memberships m where m.business_id = '${BUSINESS_A_ID}' and m.active and m.user_id in (select id from auth.users where email in ('owner@example.com','admin@example.com','manager@example.com','driver@example.com','viewer@example.com'));`);
record(mapped === "Admin,Driver,Manager,Owner", "existing users mapped from the directory (Viewer gets nothing)", mapped);

// --- Direct role-switched SQL (what a browser key would be) -----------------------------
for (const role of ["anon", "authenticated"]) {
  const failures = [];
  for (const relation of LIVE_RELATIONS) {
    for (const statement of [`select 1 from public.${relation} limit 1`, `truncate public.${relation} cascade`]) {
      if (relation === "compliance_dashboard" && statement.startsWith("truncate")) continue;
      guard();
      const run = psql(`begin; set local role ${role}; ${statement}; rollback;`, { allowFailure: true });
      if (run.status === 0 && !/permission denied/i.test(run.stderr)) failures.push(`${relation}:${statement.split(" ")[0]}`);
    }
  }
  record(failures.length === 0, `${role}: SELECT and TRUNCATE are refused on all 10 live relations`, failures.join(", "));
}

// --- Through the API with real local tokens ----------------------------------------------
const anon = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
const signedIn = async (email) => {
  const client = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: LOCAL_TEST_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}`);
  return client;
};
const owner = await signedIn("owner@example.com");
const driver = await signedIn("driver@example.com");
const denied = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);
for (const [label, client] of [["anon", anon], ["owner", owner], ["driver", driver]]) {
  const open = [];
  for (const relation of LIVE_RELATIONS) {
    guard();
    const read = await client.from(relation).select("*").limit(1);
    if (!read.error) open.push(`${relation}:read(${read.data?.length})`);
    const write = await client.from(relation).insert({});
    if (!write.error) open.push(`${relation}:insert`);
  }
  record(open.length === 0, `${label}: every live relation refuses direct API reads and writes`, open.join(", "));
}
for (const [fn, args] of [
  ["create_business_with_owner", { p_slug: "x-biz", p_name: "X", p_owner_user_id: "00000000-0000-4000-8000-000000000001", p_owner_driver_staff_id: null, p_snapshot: {} }],
  ["apply_membership_change", { p_business_id: BUSINESS_A_ID, p_actor: "00000000-0000-4000-8000-000000000001", p_user_id: "00000000-0000-4000-8000-000000000002", p_role: "Admin", p_active: true, p_driver_staff_id: null, p_expected_updated_at: new Date().toISOString(), p_snapshot: null }],
  ["commit_finance_action", { p_business_id: BUSINESS_A_ID, p_expected_updated_at: new Date().toISOString(), p_snapshot: {}, p_updated_by: "00000000-0000-4000-8000-000000000001", p_request_id: "00000000-0000-4000-8000-0000000000ff", p_action: "x", p_target_id: "x", p_request_hash: "x", p_response: {} }],
]) {
  guard();
  const asAnon = await anon.rpc(fn, args);
  const asOwner = await owner.rpc(fn, args);
  record(Boolean(asAnon.error) && Boolean(asOwner.error), `browser cannot call ${fn} (anon and signed-in Owner)`, asOwner.error?.message);
}
const ownBiz = await owner.from("businesses").select("id");
record(!ownBiz.error && ownBiz.data.length === 1 && ownBiz.data[0].id === BUSINESS_A_ID, "a signed-in member reads only its own business (authorized browser read)", `${ownBiz.data?.length}`);
const anonBiz = await anon.from("businesses").select("id");
record(denied(anonBiz), "anonymous reads of businesses are refused");
record(sql("select count(*) from public.workspace_snapshots;") === "2", "no rows were lost or added by the checks");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
