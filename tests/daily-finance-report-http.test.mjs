import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import reportPdfHandler from "../api/admin/daily-log/[id]/report-pdf.js";
import reportViewHandler from "../api/admin/daily-log/[id]/report-view.js";
import { mockSnapshot } from "../src/data/mockData.js";

// Real handlers and the real supabase-js client against a local stand-in for
// Supabase that answers exactly what the tenant boundary asks:
//   GET /auth/v1/user                        token -> user (caller token)
//   GET /rest/v1/business_memberships        the caller's own active rows (caller token only)
//   GET /rest/v1/workspace_snapshots         one business row (service key only)
// Nothing inside the application code is mocked. The stand-in refuses snapshot
// reads that do not carry the service key and counts every snapshot read, so
// the tests can prove service-role access happens only after authorization.

const RECORD_ID = "txn-inc-0901";
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const SERVICE_KEY = "test-service-key";

// role/active come from memberships; metadata and appUsers deliberately disagree.
const USERS = {
  "tok-owner": { email: "owner@pilot.test", memberships: [{ business_id: A, role: "Owner", active: true }] },
  "tok-manager": { email: "manager@pilot.test", memberships: [{ business_id: A, role: "Manager", active: true }] },
  "tok-manager-nomoney": { email: "manager.nomoney@pilot.test", memberships: [{ business_id: A, role: "Manager", active: true }] },
  "tok-admin-default": { email: "admin.default@pilot.test", memberships: [{ business_id: A, role: "Admin", active: true }] },
  "tok-driver": { email: "driver@pilot.test", memberships: [{ business_id: A, role: "Driver", driver_staff_id: "drv-01", active: true }], forgedMetadataRole: "Owner" },
  "tok-inactive": { email: "former@pilot.test", memberships: [{ business_id: A, role: "Manager", active: false }] },
  "tok-outsider": { email: "outsider@pilot.test", memberships: [] },
  "tok-manager-b": { email: "manager.b@pilot.test", memberships: [{ business_id: B, role: "Manager", active: true }] },
  "tok-two-businesses": {
    email: "both@pilot.test",
    memberships: [
      { business_id: A, role: "Manager", active: true },
      { business_id: B, role: "Owner", active: true },
    ],
  },
};

const snapshotFor = (businessId) => ({
  ...JSON.parse(JSON.stringify(mockSnapshot)),
  appUsers: [
    { email: "manager.nomoney@pilot.test", role: "Manager", active: true, moduleAccess: { finance: false } },
    // Forged directory entry: claims Owner for the Driver. Must be ignored.
    { email: "driver@pilot.test", role: "Owner", active: true },
  ],
  profile: { ...mockSnapshot.profile, businessId },
});

let server;
const snapshotReads = [];

const eqParam = (url, key) => url.searchParams.get(key)?.replace(/^eq\./, "") ?? null;

test.before(async () => {
  server = createServer((req, res) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Content-Type", "application/json");

    if (url.pathname === "/auth/v1/user") {
      const user = USERS[token];
      if (!user) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: 401, msg: "invalid JWT" }));
      }
      return res.end(JSON.stringify({
        id: `id-${token}`,
        aud: "authenticated",
        email: user.email,
        app_metadata: { role: user.forgedMetadataRole ?? "Viewer" },
        user_metadata: { role: user.forgedMetadataRole ?? "Viewer", business_id: B },
      }));
    }

    if (url.pathname === "/rest/v1/business_memberships") {
      const user = USERS[token];
      if (!user || eqParam(url, "user_id") !== `id-${token}`) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ message: "caller token required" }));
      }
      const onlyActive = eqParam(url, "active") === "true";
      return res.end(JSON.stringify(user.memberships.filter((m) => !onlyActive || m.active)));
    }

    if (url.pathname === "/rest/v1/workspace_snapshots") {
      if (token !== SERVICE_KEY) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ message: "permission denied for table workspace_snapshots" }));
      }
      const businessId = eqParam(url, "business_id");
      snapshotReads.push(businessId);
      const row = [A, B].includes(businessId)
        ? [{ workspace_key: businessId === A ? "taxiflow-live" : "business-b", business_id: businessId, snapshot: snapshotFor(businessId), updated_at: "2026-10-10T00:00:00Z" }]
        : [];
      return res.end(JSON.stringify(row));
    }

    res.statusCode = 404;
    return res.end("{}");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});

test.after(() => {
  server?.close();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const call = async (handler, token, query = {}, headers = {}) => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload;
    },
  };
  await handler(
    { method: "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, query: { id: RECORD_ID, mode: "live", ...query } },
    res,
  );
  return res;
};

const bothEndpoints = [
  ["report-pdf", reportPdfHandler],
  ["report-view", reportViewHandler],
];

const readsDuring = async (fn) => {
  const start = snapshotReads.length;
  await fn();
  return snapshotReads.slice(start);
};

test("Owner, Manager with Money on and a default Admin get their own business's report", async () => {
  for (const token of ["tok-owner", "tok-manager", "tok-admin-default"]) {
    const pdf = await call(reportPdfHandler, token);
    assert.equal(pdf.statusCode, 200, `${token} pdf`);
    assert.equal(pdf.body.subarray(0, 5).toString("ascii"), "%PDF-");
    const view = await call(reportViewHandler, token);
    assert.equal(view.statusCode, 200, `${token} view`);
    assert.equal(JSON.parse(view.body).meta.businessId, A);
  }
});

test("Money off (narrowed by the business's appUsers toggle) gets 403 from both endpoints", async () => {
  for (const [name, handler] of bothEndpoints) {
    const res = await call(handler, "tok-manager-nomoney");
    assert.equal(res.statusCode, 403, name);
    assert.match(JSON.parse(res.body).error, /Money access/);
  }
});

test("a Driver gets 403 even with Owner in token metadata AND in the snapshot's appUsers", async () => {
  for (const [name, handler] of bothEndpoints) {
    assert.equal((await call(handler, "tok-driver")).statusCode, 403, name);
  }
});

test("invalid/missing tokens get 401 and inactive/non-members get 403, with no snapshot read", async () => {
  for (const [name, handler] of bothEndpoints) {
    const reads = await readsDuring(async () => {
      assert.equal((await call(handler, "tok-unknown")).statusCode, 401, `bad token ${name}`);
      assert.equal((await call(handler, null)).statusCode, 401, `no token ${name}`);
      assert.equal((await call(handler, "tok-inactive")).statusCode, 403, `inactive ${name}`);
      assert.equal((await call(handler, "tok-outsider")).statusCode, 403, `outsider ${name}`);
    });
    assert.deepEqual(reads, [], `${name}: service-role snapshot access before authorization`);
  }
});

test("cross-business: a member of B cannot select business A (header or query) and nothing of A is read", async () => {
  for (const [name, handler] of bothEndpoints) {
    const reads = await readsDuring(async () => {
      assert.equal((await call(handler, "tok-manager-b", { business: A })).statusCode, 403, `${name} query`);
      assert.equal((await call(handler, "tok-manager-b", {}, { "x-taxiflow-business": A })).statusCode, 403, `${name} header`);
    });
    assert.deepEqual(reads, []);
  }
  // Token metadata pointing at B does not select B for an A-only member.
  const reads = await readsDuring(async () => {
    assert.equal((await call(reportViewHandler, "tok-owner")).statusCode, 200);
  });
  assert.deepEqual(reads, [A]);
});

test("explicit selection is required with several memberships; never a fallback", async () => {
  const reads = await readsDuring(async () => {
    const res = await call(reportViewHandler, "tok-two-businesses");
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /select one/);
  });
  assert.deepEqual(reads, []);
  const asOwnerOfB = await call(reportViewHandler, "tok-two-businesses", { business: B });
  assert.equal(asOwnerOfB.statusCode, 200);
  assert.equal(JSON.parse(asOwnerOfB.body).meta.businessId, B);
});

test("malformed or conflicting business selections are rejected before any read", async () => {
  const reads = await readsDuring(async () => {
    assert.equal((await call(reportViewHandler, "tok-owner", { business: "taxiflow-live" })).statusCode, 400);
    assert.equal((await call(reportViewHandler, "tok-two-businesses", { business: A }, { "x-taxiflow-business": B })).statusCode, 400);
  });
  assert.deepEqual(reads, []);
});

test("forged role inputs in the query are ignored", async () => {
  assert.equal((await call(reportViewHandler, "tok-driver", { role: "Owner", workspaceKey: "taxiflow-live" })).statusCode, 403);
});
