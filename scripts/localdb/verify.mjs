#!/usr/bin/env node
// Verifies the isolated LOCAL TaxiFlow database (Compose stack). Read-only apart
// from signing in as a synthetic local user. Prints PASS/WARN/FAIL; never keys.
// Any published service reachable beyond loopback stops the stack.
import { createClient } from "@supabase/supabase-js";

import { DB_CONTAINER, assertLocalDatabase, assertLoopbackOnlyOrStop, psql } from "./lib/exec.mjs";
import { LIVE_PROJECT_REF } from "./lib/localTarget.mjs";
import { LOCAL_TEST_PASSWORD, SEED_USERS } from "./seed-data.mjs";

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
record(tables === "workspace_snapshots" ? "PASS" : "FAIL", "baseline schema loaded", `public tables: ${tables || "(none)"}`);

const rls = query("select relrowsecurity from pg_class where oid = 'public.workspace_snapshots'::regclass;");
record(rls === "t" ? "PASS" : "FAIL", "RLS enabled on workspace_snapshots");

const grants = query(
  "select coalesce(string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type), '') from information_schema.role_table_grants where table_schema = 'public' and table_name = 'workspace_snapshots' and grantee in ('anon', 'authenticated');",
);
record(grants === "authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE" ? "PASS" : "FAIL", "grants: no anon access, no TRUNCATE/DELETE", grants || "(none)");

const policies = query("select count(*) from pg_policies where schemaname = 'public' and tablename = 'workspace_snapshots' and (qual = 'true' or with_check = 'true');");
record("WARN", "live-mirror permissive policies present (known insecure; tenant work must replace)", `${policies} policies with true`);

const authUsers = query("select count(*) from auth.users;");
const nonExample = query("select count(*) from auth.users where email not like '%@example.com';");
record(authUsers === String(SEED_USERS.length) && nonExample === "0" ? "PASS" : "FAIL", "synthetic Auth users only", `${authUsers} users, ${nonExample} non-example.com`);

const rows = query("select count(*) from public.workspace_snapshots;");
const liveTraces = query(`select count(*) from public.workspace_snapshots where snapshot::text ilike '%${LIVE_PROJECT_REF}%' or snapshot::text ~* '@(gmail|apprigate)\\.';`);
record(rows === "1" && liveTraces === "0" ? "PASS" : "FAIL", "seeded snapshot present and synthetic only", `${rows} row, ${liveTraces} live traces`);

const anon = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
const anonRead = await anon.from("workspace_snapshots").select("workspace_key");
record(anonRead.error ? "PASS" : "FAIL", "anon cannot read the snapshot", anonRead.error?.code ?? `${anonRead.data?.length ?? 0} rows`);

const owner = createClient(status.apiUrl, status.ANON_KEY, { auth: { persistSession: false } });
const signIn = await owner.auth.signInWithPassword({ email: SEED_USERS[0].email, password: LOCAL_TEST_PASSWORD });
record(signIn.error ? "FAIL" : "PASS", "local Auth sign-in (synthetic Owner)", signIn.error?.message ?? "session issued");
const ownerRead = await owner.from("workspace_snapshots").select("workspace_key, updated_at");
record(ownerRead.data?.length === 1 ? "PASS" : "FAIL", "authenticated app read of the workspace row", ownerRead.error?.message ?? `${ownerRead.data?.length} row`);

const failed = results.filter((entry) => entry.level === "FAIL").length;
const warned = results.filter((entry) => entry.level === "WARN").length;
console.log(`\n${failed ? "FAIL" : "PASS"}: ${results.length - failed - warned} PASS, ${warned} WARN, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
