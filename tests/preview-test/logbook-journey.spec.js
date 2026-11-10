import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { pageHtml } from "../../scripts/logbook/extraction-check.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Hosted logbook journey (playwright.preview-test.config.mjs): a Vercel Preview
// of feat/logbook-pipeline whose backend is the ISOLATED test project, with the
// REAL vision model. Synthetic page and synthetic accounts only.
//   upload -> pending review -> approve -> pending finance record
//   -> re-upload the same photo -> no duplicate.
// Hosted data persists between runs, so each run writes amounts of its own and
// a date on which the synthetic driver's day is still open.
//   PREVIEW_URL=https://<branch preview>.vercel.app npx playwright test -c playwright.preview-test.config.mjs tests/preview-test/logbook-journey.spec.js

const REF = process.env.PREVIEW_TEST_REF;
const PASSWORD = process.env.PREVIEW_TEST_PASSWORD;
const PRODUCTION_REF = "vfxftviwteypasredjgm";
const SUPABASE_URL = `https://${REF}.supabase.co`;
const OWNER = "owner@example.com";
const DRIVER_STAFF_ID = "pv-drv-01";
const VEHICLE = "PV-TEST-01";
const DRIVER = "UAT Driver";

test.describe.configure({ mode: "serial" });

let anonKey = null;
let pageFile = null;
let written = null;
const tokens = {};
const token = async (email) => {
  if (tokens[email]) return tokens[email];
  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  tokens[email] = { token: data.session.access_token, userId: data.user.id };
  return tokens[email];
};
const api = async (request, email, path, { method = "GET", body } = {}) => {
  const who = await token(email);
  const response = await request.fetch(path, { method, headers: { authorization: `Bearer ${who.token}`, "content-type": "application/json" }, data: body });
  let json = {};
  try { json = await response.json(); } catch { /* not JSON */ }
  return { status: response.status(), json };
};
const workspace = async (request) => (await api(request, OWNER, "/api/business/workspace")).json;
const logbookRecords = async (request) => (await workspace(request)).snapshot.financeTransactions.filter((record) => record.source === "logbook-import");
const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
};
const rows = (page) => page.getByTestId("logbook-row");

test("target: the Preview runs this build against the isolated test project, never production", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
  let bundle = "";
  for (const src of scripts) bundle += await (await request.get(src)).text();
  for (const chunk of new Set(bundle.match(/assets\/[A-Za-z0-9_-]+\.js/g) ?? [])) bundle += await (await request.get(`/${chunk}`)).text();
  expect(bundle).toContain(`${REF}.supabase.co`);
  expect(bundle).not.toContain(PRODUCTION_REF);
  expect(bundle, "the logbook screen is in this build").toContain("Logbook import");
  const refOf = (jwt) => {
    try {
      return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).ref;
    } catch {
      return null;
    }
  };
  anonKey = (bundle.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []).find((jwt) => refOf(jwt) === REF) ?? null;
  expect(anonKey, "the bundle carries the test project's public anon key").toBeTruthy();

  // Server side: a token issued by the TEST project is accepted, so the
  // functions validate against the test project, not production.
  expect((await request.get("/api/logbook/batches")).status()).toBe(401);
  const owner = await api(request, OWNER, "/api/business/workspace");
  expect(owner.status).toBe(200);
  expect(owner.json.role).toBe("Owner");
  expect(owner.json.snapshot.vehicles.some((vehicle) => vehicle.registration === VEHICLE)).toBe(true);
  const batches = await api(request, OWNER, "/api/logbook/batches");
  expect(batches.status, "the logbook tables exist in the test project").toBe(200);
  expect((await api(request, "manager@example.com", "/api/logbook/batches")).status).toBe(403);
});

test("Owner: upload -> pending review -> approve -> pending record -> re-upload adds nothing (real vision model)", async ({ page, request, browser }) => {
  test.setTimeout(600_000);
  // A date in the last 90 days on which the synthetic driver's day is still open.
  const ws = await workspace(request);
  const closed = new Set((ws.snapshot.dailyCashUps ?? []).filter((entry) => entry.driverStaffId === DRIVER_STAFF_ID).map((entry) => entry.workDate));
  const today = new Date(Date.now() + 2 * 3_600_000);
  let date = null;
  for (let back = 3; back < 90 && !date; back += 1) {
    const candidate = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    if (!closed.has(candidate)) date = candidate;
  }
  expect(date, "an open day for the synthetic driver").toBeTruthy();
  // Amounts unique to this run (so an earlier run's row hash cannot match), whole rand, reconciling.
  const revenue = 1000 + (Date.now() % 800);
  written = { date, vehicleRegistration: VEHICLE, driverName: DRIVER, revenue, fuel: 400, wash: 50, marshalFees: 30, otherExpenses: 0, banked: revenue - 480 };

  const drawing = await browser.newPage({ viewport: { width: 1580, height: 700 } });
  await drawing.setContent(pageHtml({ rows: [written] }));
  pageFile = { name: `preview-logbook-${date}-${revenue}.png`, mimeType: "image/png", buffer: await drawing.screenshot({ fullPage: true }) };
  await drawing.close();

  const before = await logbookRecords(request);
  const batchesBefore = (await api(request, OWNER, "/api/logbook/batches")).json.batches.length;

  await signIn(page, OWNER);
  await page.locator("button.module-button").filter({ hasText: "Money" }).first().click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Logbook import" }).click();
  await page.getByTestId("logbook-file-input").setInputFiles(pageFile);
  await expect(page.getByRole("status")).toContainText("row(s) are waiting for review", { timeout: 120_000 });
  await expect(rows(page)).toHaveCount(1);
  expect(await logbookRecords(request), "upload alone records nothing").toHaveLength(before.length);

  // What the real model read, against what is written on the page.
  const batches = (await api(request, OWNER, "/api/logbook/batches")).json.batches;
  expect(batches).toHaveLength(batchesBefore + 1);
  const batch = (await api(request, OWNER, `/api/logbook/batch?id=${batches[0].id}`)).json;
  const row = batch.rows[0];
  const read = Object.fromEntries(Object.entries(row.fields).map(([key, field]) => [key, field.value]));
  console.log(`model read: ${JSON.stringify(read)}; confidence: ${JSON.stringify(Object.fromEntries(Object.entries(row.fields).map(([key, field]) => [key, field.confidence])))}; checks: ${JSON.stringify(row.issues)}`);
  expect(row.status).toBe("pending");
  expect(row.issues.filter((entry) => entry.severity === "error"), "no blocking checks on a clean synthetic page").toEqual([]);
  for (const key of ["date", "revenue", "fuel", "wash", "marshalFees", "otherExpenses", "banked"]) expect(read[key], key).toBe(written[key]);

  await rows(page).first().getByRole("button", { name: "Approve" }).click();
  const confirm = page.getByRole("button", { name: "Approve as written" });
  if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click();
  await expect(rows(page).first()).toContainText("Approved", { timeout: 60_000 });

  const after = await logbookRecords(request);
  const added = after.filter((record) => !before.some((old) => old.id === record.id));
  expect(added.map((record) => `${record.type}:${record.category ?? "income"}:${record.amount}:${record.status}`).sort()).toEqual([
    "expense:Fuel:400:pending",
    "expense:Rank Fees:30:pending",
    "expense:Wash:50:pending",
    `income:income:${revenue}:pending`,
  ]);
  expect(added.every((record) => record.driverStaffId === DRIVER_STAFF_ID && record.vehicle === VEHICLE && record.logbookImport?.rowId === row.id)).toBe(true);

  // The same photo again: recognised before the model is called; nothing new.
  await page.getByTestId("logbook-file-input").setInputFiles(pageFile);
  await expect(page.getByRole("status")).toContainText("was uploaded before", { timeout: 120_000 });
  expect(await logbookRecords(request)).toHaveLength(after.length);
  const batchesAfter = (await api(request, OWNER, "/api/logbook/batches")).json.batches;
  expect(batchesAfter).toHaveLength(batchesBefore + 1);
  expect(batchesAfter[0].counts).toEqual({ pending: 0, approved: 1, rejected: 0 });
});
