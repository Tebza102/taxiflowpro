// Pure parts of the TaxiFlow operator backup (no I/O): the export SQL, bundle
// validation, the manifest and the restore SQL. backup.mjs adds transport,
// encryption, verification and logging.
import { createHash } from "node:crypto";

export const BACKUP_FORMAT = "taxiflow-backup-v1";
export const END_MARKER = "taxiflow-backup-complete";

// One read-only REPEATABLE READ transaction, so every table comes from the same
// database snapshot. Auth rows are exported whole (to_jsonb), including password
// hashes, so a restore needs no password resets; the bundle is encrypted.
// The end marker is the last key: truncated output never parses as complete.
export const EXPORT_SQL = `begin transaction isolation level repeatable read read only;
select json_build_object(
  'format', '${BACKUP_FORMAT}',
  'exported_at', now(),
  'businesses', (select coalesce(json_agg(to_jsonb(b) order by b.id), '[]'::json) from public.businesses b),
  'memberships', (select coalesce(json_agg(to_jsonb(m) order by m.business_id, m.user_id), '[]'::json) from public.business_memberships m),
  'workspaces', (select coalesce(json_agg(json_build_object('workspace_key', w.workspace_key, 'snapshot', w.snapshot, 'updated_at', w.updated_at, 'updated_by', w.updated_by, 'business_id', w.business_id) order by w.workspace_key), '[]'::json) from public.workspace_snapshots w),
  'requests', (select coalesce(json_agg(to_jsonb(q) order by q.business_id, q.request_id), '[]'::json) from public.finance_action_requests q),
  'users', (select coalesce(json_agg(to_jsonb(u) order by u.id), '[]'::json) from auth.users u),
  'identities', (select coalesce(json_agg(to_jsonb(i) order by i.id), '[]'::json) from auth.identities i),
  'end', '${END_MARKER}'
)::text;
commit;
`;

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Key-order-independent JSON, for comparing rows read back from a database.
export const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const fail = (message) => {
  throw new Error(`Incomplete or inconsistent backup: ${message}`);
};

// Parses psql output and checks completeness and referential consistency.
// Throws on anything that is not a complete, self-consistent bundle.
export const parseAndValidateBundle = (text) => {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) fail("the export produced no output.");
  let bundle;
  try {
    bundle = JSON.parse(trimmed);
  } catch {
    fail("the export output is not complete JSON (truncated or corrupted).");
  }
  return validateBundle(bundle);
};

export const validateBundle = (bundle) => {
  if (!bundle || typeof bundle !== "object") fail("not an object.");
  if (bundle.format !== BACKUP_FORMAT) fail(`unknown format ${bundle.format}.`);
  if (bundle.end !== END_MARKER) fail("the end marker is missing.");
  for (const key of ["businesses", "memberships", "workspaces", "requests", "users", "identities"]) {
    if (!Array.isArray(bundle[key])) fail(`${key} is missing.`);
  }
  if (!bundle.exported_at || Number.isNaN(Date.parse(bundle.exported_at))) fail("exported_at is missing.");
  const businesses = new Set(bundle.businesses.map((b) => b.id));
  const users = new Set(bundle.users.map((u) => u.id));
  if (businesses.size === 0) fail("there are no businesses.");
  for (const m of bundle.memberships) {
    if (!businesses.has(m.business_id)) fail(`a membership references a missing business.`);
    if (!users.has(m.user_id)) fail(`a membership references a missing Auth user.`);
  }
  for (const w of bundle.workspaces) {
    if (!w.business_id || !businesses.has(w.business_id)) fail(`snapshot ${w.workspace_key} has no backed-up business.`);
    if (!w.snapshot || typeof w.snapshot !== "object") fail(`snapshot ${w.workspace_key} is empty.`);
    if (w.updated_by && !users.has(w.updated_by)) fail(`snapshot ${w.workspace_key} references a missing Auth user.`);
  }
  for (const q of bundle.requests) {
    if (!businesses.has(q.business_id)) fail("a request-log row references a missing business.");
  }
  for (const i of bundle.identities) {
    if (!users.has(i.user_id)) fail("an identity references a missing Auth user.");
  }
  for (const b of businesses) {
    if (!bundle.workspaces.some((w) => w.business_id === b)) fail(`business ${b} has no snapshot.`);
  }
  return bundle;
};

// Metadata only: counts, ids, versions and hashes. No emails, names or money.
export const buildManifest = (bundle, { plaintextSha256, ciphertextSha256, target, file }) => ({
  format: BACKUP_FORMAT,
  target,
  file,
  exportedAt: bundle.exported_at,
  plaintextSha256,
  ciphertextSha256,
  counts: {
    businesses: bundle.businesses.length,
    memberships: bundle.memberships.length,
    snapshots: bundle.workspaces.length,
    requestLog: bundle.requests.length,
    authUsers: bundle.users.length,
    authIdentities: bundle.identities.length,
  },
  businesses: bundle.businesses.map((b) => {
    const w = bundle.workspaces.find((row) => row.business_id === b.id);
    return {
      id: b.id,
      snapshotUpdatedAt: w?.updated_at ?? null,
      memberships: bundle.memberships.filter((m) => m.business_id === b.id).length,
      requestLog: bundle.requests.filter((q) => q.business_id === b.id).length,
    };
  }),
});

export const sameCounts = (bundle, manifest) =>
  JSON.stringify(buildManifest(bundle, {}).counts) === JSON.stringify(manifest.counts);

const tagged = (text, tag) => {
  const value = String(text);
  if (value.includes(`$${tag}$`)) throw new Error(`Backup content contains the quote tag $${tag}$; refusing to build SQL.`);
  return `$${tag}$${value}$${tag}$`;
};

const insertRows = (table, columnsSql, rows, conflict = "") =>
  rows.length
    ? `insert into ${table} (${columnsSql}) select ${columnsSql} from jsonb_populate_recordset(null::${table}, ${tagged(JSON.stringify(rows), "rows")}::jsonb) ${conflict};`
    : "";

// columns: { "auth.users": "id,email,...", ... } non-generated column lists read
// from the TARGET database, so the restore follows the target's schema.
// FULL restore into an EMPTY target, one transaction, dependency order. The
// guard inside the transaction refuses a target that already holds accounts,
// memberships, snapshots or request-log rows. A business row the schema
// migration already created (the mapped legacy business) takes the backed-up
// values, which is safe because nothing in the empty target references it yet.
export const buildFullRestoreSql = (bundle, columns) => `begin;
do $guard$ begin
  if exists (select 1 from auth.users) or exists (select 1 from public.business_memberships)
     or exists (select 1 from public.workspace_snapshots) or exists (select 1 from public.finance_action_requests) then
    raise exception 'TARGET NOT EMPTY: a full restore only goes into an empty project';
  end if;
end $guard$;
${insertRows("auth.users", columns["auth.users"], bundle.users)}
${insertRows("auth.identities", columns["auth.identities"], bundle.identities)}
${insertRows("public.businesses", columns["public.businesses"], bundle.businesses, `on conflict (id) do update set (${columns["public.businesses"]}) = row(${columns["public.businesses"].split(",").map((column) => `excluded.${column}`).join(",")})`)}
${insertRows("public.business_memberships", columns["public.business_memberships"], bundle.memberships)}
${bundle.workspaces
  .map(
    (w) =>
      `insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, updated_by, business_id) values (${tagged(w.workspace_key, "k")}, ${tagged(JSON.stringify(w.snapshot), "snap")}::jsonb, ${tagged(w.updated_at, "t")}::timestamptz, ${w.updated_by ? `${tagged(w.updated_by, "u")}::uuid` : "null"}, ${tagged(w.business_id, "b")}::uuid);`,
  )
  .join("\n")}
${insertRows("public.finance_action_requests", columns["public.finance_action_requests"], bundle.requests)}
do $check$ begin
  if (select count(*) from public.workspace_snapshots) <> ${bundle.workspaces.length}
     or (select count(*) from public.business_memberships) <> ${bundle.memberships.length}
     or (select count(*) from public.finance_action_requests) <> ${bundle.requests.length}
     or (select count(*) from auth.users) <> ${bundle.users.length} then
    raise exception 'RESTORE COUNT MISMATCH';
  end if;
end $check$;
commit;
`;

// ONE business: its snapshot row and its request log, together (so a retried
// request id can never report "already applied" for a change the restored
// snapshot does not contain). Memberships and Auth are NOT touched: restoring
// access from an old backup could re-grant access an Owner has since removed.
export const buildBusinessRestoreSql = (bundle, businessId, columns) => {
  const workspace = bundle.workspaces.find((w) => w.business_id === businessId);
  if (!workspace) throw new Error("That business is not in the backup.");
  const requests = bundle.requests.filter((q) => q.business_id === businessId);
  const id = tagged(businessId, "b");
  return `begin;
do $guard$ begin
  if not exists (select 1 from public.businesses where id = ${id}::uuid) then
    raise exception 'BUSINESS NOT IN TARGET';
  end if;
  if not exists (select 1 from public.workspace_snapshots where business_id = ${id}::uuid) then
    raise exception 'BUSINESS HAS NO SNAPSHOT IN TARGET';
  end if;
end $guard$;
update public.workspace_snapshots
   set snapshot = ${tagged(JSON.stringify(workspace.snapshot), "snap")}::jsonb,
       updated_at = ${tagged(workspace.updated_at, "t")}::timestamptz,
       updated_by = ${workspace.updated_by ? `${tagged(workspace.updated_by, "u")}::uuid` : "null"}
 where business_id = ${id}::uuid;
delete from public.finance_action_requests where business_id = ${id}::uuid;
${insertRows("public.finance_action_requests", columns["public.finance_action_requests"], requests)}
commit;
`;
};

export const COLUMN_TABLES = ["auth.users", "auth.identities", "public.businesses", "public.business_memberships", "public.finance_action_requests"];
export const columnsSql = (table) => {
  const [schema, name] = table.split(".");
  return `select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = '${schema}' and table_name = '${name}' and is_generated = 'NEVER';`;
};

// The morning check: the newest log line must be PASS and recent.
export const evaluateBackupLog = (text, { now = Date.now(), maxAgeHours = 26 } = {}) => {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, reason: "no backup has been recorded" };
  const last = lines[lines.length - 1];
  const [stamp, status] = last.split(" ");
  if (status !== "PASS") return { ok: false, reason: `the newest backup failed: ${last}` };
  const ageHours = (now - Date.parse(stamp)) / 3_600_000;
  if (!Number.isFinite(ageHours)) return { ok: false, reason: "the newest log line has no valid time" };
  if (ageHours > maxAgeHours) return { ok: false, reason: `the newest PASS is ${ageHours.toFixed(1)} hours old (limit ${maxAgeHours})` };
  return { ok: true, reason: `newest PASS ${ageHours.toFixed(1)} hours ago`, line: last };
};
