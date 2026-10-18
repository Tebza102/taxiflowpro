#!/usr/bin/env node
// Verifies the isolated LOCAL TaxiFlow database (Compose stack). Read-only apart
// from signing in as a synthetic local user. Prints PASS/WARN/FAIL; never keys.
// Any published service reachable beyond loopback stops the stack.
import { createClient } from "@supabase/supabase-js";

import { DB_CONTAINER, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { LIVE_PROJECT_REF } from "./lib/localTarget.mjs";
import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD, SEED_USERS, TENANT_USERS } from "./seed-data.mjs";

const results = [];
const record = (level, name, detail) => {
  results.push({ level, name });
  console.log(`${level.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
};
const query = (sql) => psql(sql).stdout.trim();

const { bindings, listeners } = assertLoopbackOnlyOrStop();
record("PASS", "Docker published ports are exactly the three loopback mappings", bindings.join(", "));
record("PASS", "Windows listeners for Docker are loopback-only", listeners.map((l) => `${l.address}:${l.port}`).join(", "));

const status = assertLocalDatabase();
record("PASS", "target is the dedicated local instance", `${status.apiUrl}, ${DB_CONTAINER}, marker present`);

const health = await fetch(`${status.apiUrl}/auth/v1/health`, { headers: { apikey: status.ANON_KEY } });
record(health.ok ? "PASS" : "FAIL", "Auth reachable through the local API", `GET /auth/v1/health ${health.status}`);
const noKey = await fetch(`${status.apiUrl}/rest/v1/workspace_snapshots`);
record(noKey.status === 401 ? "PASS" : "FAIL", "API refuses requests without a key", `HTTP ${noKey.status}`);

record(query("select 1;") === "1" ? "PASS" : "FAIL", "database reachable", "select 1 in the local container");

const tables = query("select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'public';");
record(tables === "business_memberships,businesses,finance_action_requests,platform_admins,workspace_snapshots" ? "PASS" : "FAIL", "baseline + tenant schema loaded", `public tables: ${tables || "(none)"}`);

const rls = query("select string_agg(relrowsecurity::text, ',') from pg_class where oid in ('public.workspace_snapshots'::regclass, 'public.businesses'::regclass, 'public.business_memberships'::regclass, 'public.platform_admins'::regclass);");
record(rls === "true,true,true,true" || rls === "t,t,t,t" ? "PASS" : "FAIL", "RLS enabled on all tenant tables", rls);

const grants = query(
  "select coalesce(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type), '') from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated');",
);
record(grants === "business_memberships:authenticated:SELECT,businesses:authenticated:SELECT" ? "PASS" : "FAIL", "grants: browser has no snapshot access, no TRUNCATE; tenant tables select-only", grants || "(none)");

const policies = query("select count(*) from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true');");
record(policies === "0" ? "PASS" : "FAIL", "no permissive (true) policies remain", `${policies} found`);

const authUsers = query("select count(*) from auth.users;");
const nonExample = query("select count(*) from auth.users where email not like '%@example.com';");
record(authUsers === String(SEED_USERS.length + TENANT_USERS.length) && nonExample === "0" ? "PASS" : "FAIL", "synthetic Auth users only", `${authUsers} users, ${nonExample} non-example.com`);

const rows = query("select count(*) from public.workspace_snapshots;");
const liveTraces = query(`select count(*) from public.workspace_snapshots where snapshot::text ilike '%${LIVE_PROJECT_REF}%' or snapshot::text ~* '@(gmail|apprigate)\\.';`);
const unmapped = query("select count(*) from public.workspace_snapshots where business_id is null;");
record(rows === "2" && liveTraces === "0" && unmapped === "0" ? "PASS" : "FAIL", "one synthetic snapshot per business, all mapped", `${rows} rows, ${unmapped} unmapped, ${liveTraces} live traces`);

const anon = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
const anonRead = await anon.from("workspace_snapshots").select("workspace_key");
record(anonRead.error ? "PASS" : "FAIL", "anon cannot read the snapshot", anonRead.error?.code ?? `${anonRead.data?.length ?? 0} rows`);

const owner = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
const signIn = await owner.auth.signInWithPassword({ email: SEED_USERS[0].email, password: LOCAL_TEST_PASSWORD });
record(signIn.error ? "FAIL" : "PASS", "local Auth sign-in (synthetic Owner)", signIn.error?.message ?? "session issued");
const ownerRead = await owner.from("workspace_snapshots").select("workspace_key, updated_at");
record(ownerRead.error?.code === "42501" ? "PASS" : "FAIL", "direct browser snapshot read denied (server API path required)", ownerRead.error?.code ?? `${ownerRead.data?.length} rows`);
const ownerBiz = await owner.from("businesses").select("id");
record(!ownerBiz.error && ownerBiz.data.length === 1 && ownerBiz.data[0].id === BUSINESS_A_ID ? "PASS" : "FAIL", "Owner sees only its own business", ownerBiz.error?.message ?? `${ownerBiz.data.length} row`);

const failed = results.filter((entry) => entry.level === "FAIL").length;
const warned = results.filter((entry) => entry.level === "WARN").length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed - warned} PASS, ${warned} WARN, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
