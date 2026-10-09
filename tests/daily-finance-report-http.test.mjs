import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import reportPdfHandler from "../api/admin/daily-log/[id]/report-pdf.js";
import reportViewHandler from "../api/admin/daily-log/[id]/report-view.js";
import { mockSnapshot } from "../src/data/mockData.js";

// Direct endpoint calls through the real handlers and the real supabase-js
// client, against a local stand-in for Supabase that answers the two requests
// the report endpoints make: GET /auth/v1/user (token -> user) and GET
// /rest/v1/workspace_snapshots (the live row). Nothing here is mocked inside
// the application code.

const RECORD_ID = "txn-inc-0901";

const USERS = {
  "tok-owner": { email: "owner@pilot.test", role: "Owner", moduleAccess: { finance: false } },
  "tok-manager": { email: "manager@pilot.test", role: "Manager", moduleAccess: { finance: true } },
  "tok-manager-nomoney": { email: "manager.nomoney@pilot.test", role: "Manager", moduleAccess: { finance: false } },
  "tok-admin-nomoney": { email: "admin.nomoney@pilot.test", role: "Admin", moduleAccess: { finance: false } },
  "tok-admin-default": { email: "admin.default@pilot.test", role: "Admin" },
  "tok-driver": { email: "driver@pilot.test", role: "Driver", forgedMetadataRole: "Owner" },
  "tok-inactive": { email: "former@pilot.test", role: "Manager", active: false, moduleAccess: { finance: true } },
  "tok-outsider": { email: "outsider@pilot.test", role: null },
};

const liveSnapshot = {
  ...JSON.parse(JSON.stringify(mockSnapshot)),
  appUsers: Object.values(USERS)
    .filter((user) => user.role)
    .map((user) => ({
      email: user.email,
      role: user.role,
      active: user.active ?? true,
      ...(user.moduleAccess ? { moduleAccess: user.moduleAccess } : {}),
    })),
};

let server;

test.before(async () => {
  server = createServer((req, res) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Content-Type", "application/json");

    if (url.pathname === "/auth/v1/user") {
      const user = USERS[token];
      if (!user) {
        res.statusCode = 401;
        res.end(JSON.stringify({ code: 401, msg: "invalid JWT" }));
        return;
      }
      res.end(
        JSON.stringify({
          id: `id-${token}`,
          aud: "authenticated",
          email: user.email,
          app_metadata: { role: user.forgedMetadataRole ?? user.role },
          user_metadata: { role: user.forgedMetadataRole ?? user.role },
        }),
      );
      return;
    }

    if (url.pathname === "/rest/v1/workspace_snapshots") {
      res.end(JSON.stringify([{ snapshot: liveSnapshot }]));
      return;
    }

    res.statusCode = 404;
    res.end("{}");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
});

test.after(() => {
  server?.close();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
});

const call = async (handler, token, query = {}) => {
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
    {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      query: { id: RECORD_ID, mode: "live", ...query },
    },
    res,
  );

  return res;
};

const bothEndpoints = [
  ["report-pdf", reportPdfHandler],
  ["report-view", reportViewHandler],
];

test("Manager and Admin with Money off get 403 from both endpoints when calling them directly", async () => {
  for (const token of ["tok-manager-nomoney", "tok-admin-nomoney"]) {
    for (const [name, handler] of bothEndpoints) {
      const res = await call(handler, token);
      assert.equal(res.statusCode, 403, `${token} ${name}`);
      assert.match(JSON.parse(res.body).error, /Money access/);
    }
  }
});

test("a Driver gets 403 from both endpoints, even with Owner in editable token metadata", async () => {
  for (const [name, handler] of bothEndpoints) {
    const res = await call(handler, "tok-driver");
    assert.equal(res.statusCode, 403, name);
  }
});

test("inactive and non-member accounts get 403; a bad token gets 401; no token gets 401", async () => {
  for (const [name, handler] of bothEndpoints) {
    assert.equal((await call(handler, "tok-inactive")).statusCode, 403, `inactive ${name}`);
    assert.equal((await call(handler, "tok-outsider")).statusCode, 403, `outsider ${name}`);
    assert.equal((await call(handler, "tok-unknown")).statusCode, 401, `bad token ${name}`);
    assert.equal((await call(handler, null)).statusCode, 401, `no token ${name}`);
  }
});

test("Owner (even with a stored Money off), Manager with Money on, and a default Admin get the report", async () => {
  for (const token of ["tok-owner", "tok-manager", "tok-admin-default"]) {
    const pdf = await call(reportPdfHandler, token);
    assert.equal(pdf.statusCode, 200, `${token} pdf`);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.equal(pdf.body.subarray(0, 5).toString("ascii"), "%PDF-");

    const view = await call(reportViewHandler, token);
    assert.equal(view.statusCode, 200, `${token} view`);
    assert.equal(JSON.parse(view.body).meta.source, "live");
  }
});

test("Money-off accounts are also denied demo reports", async () => {
  for (const [name, handler] of bothEndpoints) {
    assert.equal((await call(handler, "tok-manager-nomoney", { mode: "mock" })).statusCode, 403, name);
  }
});
