import assert from "node:assert/strict";
import test from "node:test";

import reportPdfHandler, { resolveReportPdf } from "../api/admin/daily-log/[id]/report-pdf.js";
import reportViewHandler, {
  resolveReportViewPayload,
} from "../api/admin/daily-log/[id]/report-view.js";
import { mockSnapshot } from "../src/data/mockData.js";
import { normalizeModuleViewAccess } from "../src/lib/moduleAccessPolicy.js";

const RECORD_ID = "txn-inc-0901";

const liveResult = (role, moduleAccess = {}) => ({
  snapshot: JSON.parse(JSON.stringify(mockSnapshot)),
  source: "live",
  workspaceKey: "taxiflow-live",
  requestedBy:
    role === null
      ? null
      : { id: `user-${role}`, email: null, role, moduleAccess: normalizeModuleViewAccess(moduleAccess, role) },
});

const createRes = () => {
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
  return res;
};

const withNodeEnv = async (value, fn) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
};

// --- Resolver level: identity already resolved from the bearer token ---------

test("Driver cannot obtain the PDF even when calling the endpoint directly", async () => {
  await assert.rejects(resolveReportPdf(liveResult("Driver"), RECORD_ID), (e) => e.statusCode === 403);
});

test("Driver cannot obtain the JSON preview either", () => {
  assert.throws(() => resolveReportViewPayload(liveResult("Driver"), RECORD_ID), (e) => e.statusCode === 403);
});

test("Viewer and unknown roles are rejected", async () => {
  for (const role of ["Viewer", "Superuser", undefined]) {
    await assert.rejects(resolveReportPdf(liveResult(role), RECORD_ID), (e) => e.statusCode === 403);
  }
});

test("a live request with no resolved identity is rejected with 401", async () => {
  await assert.rejects(resolveReportPdf(liveResult(null), RECORD_ID), (e) => e.statusCode === 401);
});

test("Owner, Admin and Manager obtain the selected report as a PDF", async () => {
  for (const role of ["Owner", "Admin", "Manager"]) {
    const { buffer, filename } = await resolveReportPdf(liveResult(role), RECORD_ID);
    assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(filename, `taxiflow-daily-finance-2026-03-25-${RECORD_ID}.pdf`);
  }
});

test("preview and PDF are built from the same enriched data", () => {
  const payload = resolveReportViewPayload(liveResult("Manager"), RECORD_ID);
  assert.equal(payload.reportId, RECORD_ID);
  assert.equal(payload.cashUp.expectedCashHandIn, 4760);
  assert.equal(payload.cashUp.actualCashReceived, 4760);
  assert.equal(payload.cashUp.cashVariance, 0);
  assert.equal(payload.meta.source, "live");
});

test("a Manager or Admin with Money off cannot obtain the PDF or the preview", async () => {
  for (const role of ["Manager", "Admin"]) {
    await assert.rejects(resolveReportPdf(liveResult(role, { finance: false }), RECORD_ID), (e) => e.statusCode === 403);
    assert.throws(
      () => resolveReportViewPayload(liveResult(role, { finance: false }), RECORD_ID),
      (e) => e.statusCode === 403,
    );
  }
});

test("an unknown record id returns 404 for a permitted role", async () => {
  await assert.rejects(resolveReportPdf(liveResult("Owner"), "nope"), (e) => e.statusCode === 404);
});

// --- Full handler level: real default exports, fake req/res ------------------

test("production rejects an unauthenticated ?mode=mock request for both endpoints", async () => {
  await withNodeEnv("production", async () => {
    for (const handler of [reportPdfHandler, reportViewHandler]) {
      const res = createRes();
      await handler({ method: "GET", headers: {}, query: { id: RECORD_ID, mode: "mock" } }, res);
      assert.equal(res.statusCode, 401);
      assert.match(res.headers["content-type"], /application\/json/);
    }
  });
});

test("production rejects an unauthenticated default-mode request", async () => {
  await withNodeEnv("production", async () => {
    const res = createRes();
    await reportPdfHandler({ method: "GET", headers: {}, query: { id: RECORD_ID } }, res);
    assert.equal(res.statusCode, 401);
  });
});

test("development demo request downloads a PDF with attachment headers", async () => {
  await withNodeEnv("development", async () => {
    const res = createRes();
    await reportPdfHandler({ method: "GET", headers: {}, query: { id: RECORD_ID, mode: "mock" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(
      res.headers["content-disposition"],
      `attachment; filename="taxiflow-daily-finance-2026-03-25-${RECORD_ID}.pdf"`,
    );
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.subarray(0, 5).toString("ascii"), "%PDF-");
  });
});

test("handlers reject non-GET methods and missing ids", async () => {
  const postRes = createRes();
  await reportPdfHandler({ method: "POST", headers: {}, query: { id: RECORD_ID } }, postRes);
  assert.equal(postRes.statusCode, 405);

  const missingRes = createRes();
  await reportPdfHandler({ method: "GET", headers: {}, query: {} }, missingRes);
  assert.equal(missingRes.statusCode, 400);
});

test("a demo request that carries a token is authenticated, not waved through", async () => {
  const saved = {};
  for (const key of ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const res = createRes();
    await reportPdfHandler(
      { method: "GET", headers: { authorization: "Bearer not-a-real-token" }, query: { id: RECORD_ID, mode: "mock" } },
      res,
    );
    // With no Supabase config the token cannot be validated, so the request
    // fails closed instead of producing a report.
    assert.equal(res.statusCode, 503);
    assert.match(res.headers["content-type"], /application\/json/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value;
    }
  }
});

test("a caller-supplied workspaceKey is ignored", async () => {
  await withNodeEnv("development", async () => {
    const res = createRes();
    await reportViewHandler(
      { method: "GET", headers: {}, query: { id: RECORD_ID, mode: "mock", workspaceKey: "someone-else" } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.notEqual(JSON.parse(res.body).meta.workspaceKey, "someone-else");
  });
});
