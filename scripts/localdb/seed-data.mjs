// Synthetic fixtures for the LOCAL TaxiFlow test database only. Every name is
// UAT-prefixed and every email is @example.com; nothing here comes from the live
// workspace. The local test password below only works against 127.0.0.1.
export const LOCAL_TEST_PASSWORD = "LocalUat-Only-2026!";
export const LOCAL_WORKSPACE_KEY = "taxiflow-live";

export const SEED_USERS = [
  { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", role: "Owner", name: "UAT Owner" },
  { id: "00000000-0000-4000-8000-000000000002", email: "admin@example.com", role: "Admin", name: "UAT Admin" },
  { id: "00000000-0000-4000-8000-000000000003", email: "manager@example.com", role: "Manager", name: "UAT Manager" },
  { id: "00000000-0000-4000-8000-000000000004", email: "driver@example.com", role: "Driver", name: "UAT Driver", staffId: "uat-drv-01" },
  { id: "00000000-0000-4000-8000-000000000005", email: "viewer@example.com", role: "Viewer", name: "UAT Viewer" },
];

const day = "2026-10-01";
const at = (time) => `${day}T${time}:00+02:00`;

// Same 18 top-level keys as the live snapshot (key names only were inventoried).
export const buildSyntheticSnapshot = () => ({
  profile: { fleetName: "UAT Fleet (synthetic)", district: "UAT District", legalEntity: "UAT Example (Pty) Ltd" },
  appUsers: SEED_USERS.map((user) => ({
    email: user.email,
    name: user.name,
    role: user.role,
    active: true,
    staffId: user.staffId ?? null,
  })),
  drivers: [{ staffId: "uat-drv-01", name: "UAT Driver", email: "driver@example.com", route: "UAT Route A", role: "Driver" }],
  vehicles: [
    { id: "uat-veh-01", registration: "UAT-TEST-01", model: "UAT Minibus", status: "active", currentOdometer: 1000, assignedDriverId: "uat-drv-01", archivedAt: null },
    { id: "uat-veh-02", registration: "UAT-TEST-02", model: "UAT Minibus", status: "active", currentOdometer: 2000, assignedDriverId: null, archivedAt: null },
  ],
  routes: [{ id: "uat-route-a", name: "UAT Route A", code: "UA", fare: 20, active: true }],
  financeTransactions: [
    { id: "uat-fin-1", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-01", driverStaffId: "uat-drv-01", route: "UAT Route A", tripDate: day, amountClaimed: 400, status: "pending", createdAt: at("08:00") },
    { id: "uat-fin-2", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-01", driverStaffId: "uat-drv-01", route: "UAT Route A", tripDate: day, amountClaimed: 300, status: "pending", createdAt: at("09:00") },
    { id: "uat-fin-3", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-02", route: "UAT Route A", tripDate: day, amountClaimed: 200, status: "verified", actualCashReceived: 200, createdAt: at("10:00") },
    { id: "uat-fin-4", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-02", route: "UAT Route A", tripDate: day, amountClaimed: 100, status: "banked", actualCashReceived: 100, depositId: "uat-dep-1", createdAt: at("11:00") },
    { id: "uat-fin-6", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-02", route: "UAT Route A", tripDate: day, amountClaimed: 150, status: "counted", actualCashReceived: 150, createdAt: at("12:00") },
    { id: "uat-fin-5", type: "income", incomeKind: "standard", vehicle: "UAT-TEST-01", driverStaffId: "uat-drv-01", route: "UAT Route A", tripDate: "2026-10-02", amountClaimed: 250, status: "pending", createdAt: "2026-10-02T08:00:00+02:00" },
  ],
  // Day checking sent by the driver, awaiting the admin hand-in (expected 400 + 300 = 700).
  dailyCashUps: [{ id: "uat-cu-1", driverStaffId: "uat-drv-01", driverName: "UAT Driver", workDate: day, status: "pending", actualCashReceived: null, expectedCashIn: 700, createdAt: at("18:00") }],
  deposits: [{ id: "uat-dep-1", amount: 100, depositedAt: at("15:00"), reference: "UAT-DEP-1" }],
  verificationQueue: [],
  defects: [{ id: "uat-def-1", vehicle: "UAT-TEST-02", title: "UAT synthetic defect", status: "open" }],
  documents: [{ id: "uat-doc-1", vehicle: "UAT-TEST-01", type: "Permit", expiryDate: "2027-01-31" }],
  serviceSchedule: [{ id: "uat-svc-1", vehicle: "UAT-TEST-01", dueOdometer: 11000 }],
  driverTerminal: { mode: "standard" },
  finance: { currency: "ZAR" },
  operationsLoop: [],
  auditTrail: [{ id: "uat-aud-1", timestamp: at("07:00"), title: "UAT synthetic seed", scope: "system" }],
  emailOutbox: [],
  passwordResetRequests: [],
});

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

// --- Tenant fixtures (loaded after the tenant foundation migration) -------------
// Business A is the explicitly mapped existing workspace ('taxiflow-live'); its
// memberships come from the migration's appUsers backfill. Business B is a second
// synthetic business. Extra identities exercise the negative tests.
export const BUSINESS_A_ID = "10000000-0000-4000-8000-00000000000a";
export const BUSINESS_B_ID = "10000000-0000-4000-8000-00000000000b";
export const BUSINESS_B_WORKSPACE_KEY = "uat-business-b";

export const TENANT_USERS = [
  { id: "00000000-0000-4000-8000-0000000000b1", email: "owner.b@example.com", business: "B", role: "Owner", staffId: "uat-drv-b-owner" },
  { id: "00000000-0000-4000-8000-0000000000b2", email: "manager.b@example.com", business: "B", role: "Manager" },
  { id: "00000000-0000-4000-8000-0000000000b3", email: "driver.b@example.com", business: "B", role: "Driver", staffId: "uat-drv-b-01" },
  { id: "00000000-0000-4000-8000-0000000000c1", email: "outsider@example.com", business: null, role: null },
  { id: "00000000-0000-4000-8000-0000000000c2", email: "inactive.a@example.com", business: "A", role: "Manager", active: false },
  { id: "00000000-0000-4000-8000-0000000000c3", email: "newhire.a@example.com", business: null, role: null },
];

const authUserSql = (user) => [
  `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)`,
  `values ('00000000-0000-0000-0000-000000000000', ${sqlString(user.id)}, 'authenticated', 'authenticated', ${sqlString(user.email)}, extensions.crypt(${sqlString(LOCAL_TEST_PASSWORD)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');`,
  `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)`,
  `values (gen_random_uuid(), ${sqlString(user.id)}, ${sqlString(user.id)}, jsonb_build_object('sub', ${sqlString(user.id)}, 'email', ${sqlString(user.email)}, 'email_verified', true), 'email', now(), now(), now());`,
];

export const buildBusinessBSnapshot = () => {
  const snapshot = buildSyntheticSnapshot();
  snapshot.profile = { fleetName: "UAT Business B (synthetic)", district: "UAT District B", legalEntity: "UAT B Example (Pty) Ltd" };
  snapshot.appUsers = TENANT_USERS.filter((user) => user.business === "B").map((user) => ({
    email: user.email,
    name: `UAT ${user.role} B`,
    role: user.role,
    active: true,
    staffId: user.staffId ?? null,
  }));
  snapshot.vehicles = snapshot.vehicles.map((vehicle) => ({ ...vehicle, id: `${vehicle.id}-b`, registration: `${vehicle.registration}-B` }));
  const toB = (staffId) => (staffId === "uat-drv-01" ? "uat-drv-b-01" : staffId);
  snapshot.drivers = snapshot.drivers.map((driver) => ({ ...driver, staffId: toB(driver.staffId), email: "driver.b@example.com", name: "UAT Driver B" }));
  snapshot.financeTransactions = snapshot.financeTransactions.map((record) => ({ ...record, id: `${record.id}-b`, ...(record.driverStaffId ? { driverStaffId: toB(record.driverStaffId) } : {}) }));
  snapshot.dailyCashUps = snapshot.dailyCashUps.map((entry) => ({ ...entry, id: `${entry.id}-b`, driverStaffId: toB(entry.driverStaffId), driverName: "UAT Driver B" }));
  return snapshot;
};

export const buildTenantSeedSql = () => {
  const lines = [
    "-- GENERATED by scripts/localdb/setup.mjs. Synthetic tenant fixtures, local only.",
    "do $$ begin",
    "  if not exists (select 1 from taxiflow_local.instance where id = 'taxiflow-localdb-isolated') then",
    "    raise exception 'Refusing to seed: this is not the dedicated local TaxiFlow database';",
    "  end if;",
    "end $$;",
    ...TENANT_USERS.flatMap(authUserSql),
    `insert into public.businesses (id, slug, name) values (${sqlString(BUSINESS_B_ID)}, 'uat-business-b', 'UAT Business B (synthetic)');`,
    `insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, updated_by, business_id)`,
    `values (${sqlString(BUSINESS_B_WORKSPACE_KEY)}, ${sqlString(JSON.stringify(buildBusinessBSnapshot()))}::jsonb, '2026-10-01T18:30:00+02:00', ${sqlString(TENANT_USERS[0].id)}, ${sqlString(BUSINESS_B_ID)});`,
  ];
  for (const user of TENANT_USERS.filter((entry) => entry.business)) {
    const businessId = user.business === "A" ? BUSINESS_A_ID : BUSINESS_B_ID;
    lines.push(
      `insert into public.business_memberships (business_id, user_id, role, driver_staff_id, active) values (${sqlString(businessId)}, ${sqlString(user.id)}, ${sqlString(user.role)}, ${user.staffId ? sqlString(user.staffId) : "null"}, ${user.active === false ? "false" : "true"});`,
    );
  }
  return `${lines.join("\n")}\n`;
};

// seed.sql: Auth users (with email identities) first, then the workspace row whose
// updated_by points at the synthetic Owner, exactly like a live row would.
export const buildSeedSql = () => {
  const lines = [
    "-- GENERATED by scripts/localdb/setup.mjs from scripts/localdb/seed-data.mjs. Synthetic, local only.",
    "do $$ begin",
    "  if not exists (select 1 from taxiflow_local.instance where id = 'taxiflow-localdb-isolated') then",
    "    raise exception 'Refusing to seed: this is not the dedicated local TaxiFlow database';",
    "  end if;",
    "end $$;",
  ];
  for (const user of SEED_USERS) {
    lines.push(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)`,
      `values ('00000000-0000-0000-0000-000000000000', ${sqlString(user.id)}, 'authenticated', 'authenticated', ${sqlString(user.email)}, extensions.crypt(${sqlString(LOCAL_TEST_PASSWORD)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');`,
      `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)`,
      `values (gen_random_uuid(), ${sqlString(user.id)}, ${sqlString(user.id)}, jsonb_build_object('sub', ${sqlString(user.id)}, 'email', ${sqlString(user.email)}, 'email_verified', true), 'email', now(), now(), now());`,
    );
  }
  lines.push(
    `insert into public.workspace_snapshots (workspace_key, snapshot, updated_at, updated_by)`,
    `values (${sqlString(LOCAL_WORKSPACE_KEY)}, ${sqlString(JSON.stringify(buildSyntheticSnapshot()))}::jsonb, '2026-10-01T18:30:00+02:00', ${sqlString(SEED_USERS[0].id)});`,
  );
  return `${lines.join("\n")}\n`;
};
