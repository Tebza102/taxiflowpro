import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Authenticated hosted journey (playwright.preview-test.config.mjs): a Vercel
// Preview whose backend is the ISOLATED test project, seeded with the synthetic
// accounts (scripts/preview-test/build-bootstrap.mjs). Proves on hosted
// infrastructure: the Owner changes responsibilities in Business access; a
// Manager's route/vehicle/driver saves survive a reload; the full cash workflow
// (capture, submit, count, verify, bank); revoking banking blocks the next
// direct request; delegated staff management stays within its limits; the
// counter cannot verify their own count.

const REF = process.env.PREVIEW_TEST_REF;
const PASSWORD = process.env.PREVIEW_TEST_PASSWORD;
const PRODUCTION_REF = "vfxftviwteypasredjgm";
const SUPABASE_URL = `https://${REF}.supabase.co`;
const DAY = "2026-10-08";
const DAY_LABEL = "08 Oct 2026";
const EXPECTED_CASH = 380; // trip 500 less safe-paid expense 120
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

test.describe.configure({ mode: "serial" });

let anonKey = null;
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
const workspace = (request, email) => api(request, email, "/api/business/workspace");
const act = async (request, email, action, fields) => {
  const { json: ws } = await workspace(request, email);
  return api(request, email, "/api/business/finance-actions", { method: "POST", body: { action, requestId: crypto.randomUUID(), expectedVersion: ws.version, fields } });
};
const setPerms = async (request, actor, targetEmail, permissions) => {
  const target = await token(targetEmail);
  return api(request, actor, "/api/business/members", { method: "POST", body: { action: "member.permissions", fields: { userId: target.userId, permissions } } });
};

const signIn = async (page, email) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
};
const signOut = async (page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
};
const moduleButton = (page, label) => page.locator("button.module-button").filter({ hasText: label }).first();
const openBanking = async (page) => {
  await moduleButton(page, "Money").click();
  await page.locator("button.finance-mode-button").filter({ hasText: "Banking" }).click();
  await expect(page.getByRole("heading", { name: "Admin hand-in and manager verification" })).toBeVisible();
};
const dayCard = (page, driverName, label = DAY_LABEL) => page.locator("article.queue-card").filter({ hasText: driverName }).filter({ hasText: label });
const fieldSelect = (page, caption) => page.locator("label.finance-field", { has: page.locator("span", { hasText: new RegExp(`^${caption}$`) }) }).locator("select");
const saveResponsibilities = async (page, email) => {
  const row = page.getByTestId("access-row").filter({ hasText: email }).filter({ hasText: "Manager" }).first();
  await row.getByRole("button", { name: "Save responsibilities" }).click();
  await expect(page.getByRole("status")).toContainText(`Responsibilities saved for ${email}`, { timeout: 60_000 });
};

test("target: the Preview runs this build against the isolated test project, never production", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
  const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
  let bundle = "";
  for (const src of scripts) bundle += await (await request.get(src)).text();
  // App chunks are lazy-loaded; include them.
  for (const chunk of new Set(bundle.match(/assets\/[A-Za-z0-9_-]+\.js/g) ?? [])) bundle += await (await request.get(`/${chunk}`)).text();
  expect(bundle).toContain(`${REF}.supabase.co`);
  expect(bundle).not.toContain(PRODUCTION_REF);
  const refOf = (jwt) => {
    try {
      return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).ref;
    } catch {
      return null;
    }
  };
  anonKey = (bundle.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []).find((jwt) => refOf(jwt) === REF) ?? null;
  expect(anonKey, "the bundle carries the test project's public anon key").toBeTruthy();
  const unauthenticated = await request.get("/api/business/workspace");
  expect(unauthenticated.status()).toBe(401);
  // Signed in: the server answers with the business (service credentials present and scoped to the test project).
  const owner = await workspace(request, "owner@example.com");
  expect(owner.status).toBe(200);
  expect(owner.json.role).toBe("Owner");
  // Company separation on hosted infrastructure: B's Manager cannot read or write A.
  const managerB = await token("manager.b@example.com");
  const crossRead = await request.get("/api/business/workspace", { headers: { authorization: `Bearer ${managerB.token}`, "x-taxiflow-business": owner.json.businessId } });
  expect(crossRead.status()).toBe(403);
  const crossWrite = await request.post("/api/business/finance-actions", {
    headers: { authorization: `Bearer ${managerB.token}`, "x-taxiflow-business": owner.json.businessId, "content-type": "application/json" },
    data: { action: "route.save", requestId: crypto.randomUUID(), expectedVersion: owner.json.version, fields: { name: "Cross Company", primaryOrigin: "X", primaryDestination: "Y" } },
  });
  expect(crossWrite.status()).toBe(403);
});

test("full cash workflow: driver capture and checking, admin count, manager verify, owner bank", async ({ page }) => {
  await signIn(page, "driver@example.com");
  await page.getByRole("button", { name: "Add daily earnings" }).click();
  const panel = page.locator(".driver-action-panel");
  await panel.getByLabel("Date").fill(DAY);
  await panel.getByLabel("Time in").fill("06:00");
  await panel.getByLabel("Time out").fill("10:00");
  await panel.getByLabel("Opening odo").fill("1000");
  await panel.getByLabel("Closing odo").fill("1080");
  await panel.getByLabel("From").first().fill("Rank A");
  await panel.getByLabel("To", { exact: true }).first().fill("Rank B");
  await panel.getByRole("spinbutton", { name: "Passengers" }).first().fill("12");
  await panel.getByRole("spinbutton", { name: "Amount collected" }).first().fill("500");
  await page.getByRole("button", { name: "Save trip" }).click();
  await expect(page.getByText("Trip saved and added to the daily total.", { exact: false })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add daily expense" }).click();
  const expensePanel = page.locator(".driver-action-panel");
  await expensePanel.getByLabel("Category").selectOption("Other");
  await expensePanel.getByLabel("Description").fill(`Preview fuel slip ${RUN}`);
  await expensePanel.getByLabel("Expense date").fill(DAY);
  await expensePanel.getByLabel("Amount").fill("120");
  await expensePanel.getByLabel("Paid from safe").check();
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved and sent to a manager for review.")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
  await moduleButton(page, "Overview").click();
  const cashBoard = page.locator("article.overview-board").filter({ has: page.getByRole("heading", { name: "Day cash activity" }) });
  await expect(cashBoard).toContainText(`R ${EXPECTED_CASH}`);
  await cashBoard.getByRole("button", { name: "Checking" }).click();
  await expect(page.getByText("Checking sent.", { exact: false })).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  await signIn(page, "admin@example.com");
  await openBanking(page);
  const adminCard = dayCard(page, "UAT Driver");
  await adminCard.getByPlaceholder("Cash handed in").fill(String(EXPECTED_CASH));
  await adminCard.getByRole("button", { name: "Record hand-in" }).click();
  await expect(page.getByText("Day checking recorded and waiting for manager verification.")).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  await signIn(page, "manager@example.com");
  await openBanking(page);
  const managerCard = dayCard(page, "UAT Driver");
  await managerCard.getByRole("button", { name: "Verify checking" }).click();
  await expect(page.getByText("Day checking verified and added to cash ready for banking.")).toBeVisible({ timeout: 60_000 });
  await signOut(page);

  await signIn(page, "owner@example.com");
  await openBanking(page);
  await page.getByRole("button", { name: "Finish deposit" }).click();
  await expect(page.getByText(/manager-checked records were added to TFP-/)).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
  await openBanking(page);
  await expect(page.getByRole("button", { name: "Finish deposit" })).toBeDisabled();
  await signOut(page);
});

test("Owner grants fleet and driver management; the Manager's saves survive a reload", async ({ page, request }) => {
  await signIn(page, "manager@example.com");
  await moduleButton(page, "Fleet & Operations").click();
  await expect(page.getByTestId("tenant-fleet-scope")).toContainText("view-only");
  await signOut(page);

  await signIn(page, "owner@example.com");
  await moduleButton(page, "Settings").click();
  await page.getByLabel("Manage routes and vehicles for manager@example.com").check();
  await page.getByLabel("Manage driver profiles and assignments for manager@example.com").check();
  await saveResponsibilities(page, "manager@example.com");
  await signOut(page);
  expect([...(await workspace(request, "manager@example.com")).json.permissions].sort()).toEqual(["cash.bank", "cash.verify", "drivers.manage", "fleet.manage"]);

  const routeName = `Preview Depot ${RUN} to Station`;
  const registration = `PV ${RUN}`;
  await signIn(page, "manager@example.com");
  await moduleButton(page, "Fleet & Operations").click();
  await page.getByLabel("Route name").fill(routeName);
  await page.getByLabel("Route code").fill(`P${RUN}`);
  await page.getByLabel("Primary origin").fill(`Preview Depot ${RUN}`);
  await page.getByLabel("Primary destination").fill("Station");
  await page.getByRole("button", { name: "Create route" }).click();
  await expect(page.getByText("Route profile created.")).toBeVisible({ timeout: 60_000 });
  await page.locator("button.action-button", { hasText: "Add vehicle" }).click();
  await page.getByLabel("Registration").fill(registration);
  await page.getByLabel("Model").fill("Preview Quantum");
  await fieldSelect(page, "Route").selectOption({ label: `P${RUN} / ${routeName}` });
  await page.getByRole("button", { name: "Create vehicle" }).click();
  await expect(page.getByText("Vehicle profile created.")).toBeVisible({ timeout: 60_000 });
  await moduleButton(page, "Drivers").click();
  await page.getByRole("button", { name: "Add driver" }).first().click();
  await page.getByLabel("Full name").fill(`Preview Driver ${RUN}`);
  await page.getByRole("listbox", { name: "Assigned routes" }).selectOption({ label: `P${RUN} / ${routeName}` });
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText(`Preview Driver ${RUN} added to the driver roster.`)).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 60_000 });
  await moduleButton(page, "Drivers").click();
  await expect(page.getByText(`Preview Driver ${RUN}`).first()).toBeVisible({ timeout: 60_000 });
  await moduleButton(page, "Fleet & Operations").click();
  await expect(page.locator("option", { hasText: `${registration} / ${routeName}` })).toHaveCount(1, { timeout: 60_000 });
  await signOut(page);

  const { json } = await workspace(request, "manager@example.com");
  const route = json.snapshot.routes.find((entry) => entry.name === routeName);
  expect(route?.createdByRole).toBe("Manager");
  expect(json.snapshot.vehicles.find((entry) => entry.registration === registration)?.currentRouteId).toBe(route?.id);
  expect(json.snapshot.drivers.find((entry) => entry.name === `Preview Driver ${RUN}`)?.routeIds).toEqual([route?.id]);
});

test("revoking banking in Business access blocks the Manager's next direct banking request", async ({ page, request }) => {
  await signIn(page, "owner@example.com");
  await moduleButton(page, "Settings").click();
  await page.getByLabel("Bank verified cash for manager@example.com").uncheck();
  await saveResponsibilities(page, "manager@example.com");
  await signOut(page);
  const before = (await workspace(request, "manager@example.com")).json;
  expect(before.permissions).not.toContain("cash.bank");
  const refused = await act(request, "manager@example.com", "deposit.lock", { cashUpIds: [], transactionIds: [] });
  expect(refused.status).toBe(403);
  expect(refused.json.error).toMatch(/Bank verified cash/);
  expect((await workspace(request, "manager@example.com")).json.version).toBe(before.version);
});

test("delegated staff management stays within the delegate's own responsibilities", async ({ request }) => {
  expect((await setPerms(request, "admin@example.com", "manager@example.com", ["cash.verify"])).status).toBe(403);
  expect((await setPerms(request, "owner@example.com", "admin@example.com", ["cash.count", "staff.manage"])).status).toBe(200);
  const manager = [...(await workspace(request, "manager@example.com")).json.permissions].sort();
  const withCount = [...manager, "cash.count"];
  expect((await setPerms(request, "admin@example.com", "manager@example.com", withCount)).status).toBe(200);
  const beyond = await setPerms(request, "admin@example.com", "manager@example.com", withCount.filter((key) => key !== "fleet.manage"));
  expect(beyond.status).toBe(403);
  expect(beyond.json.error).toMatch(/hold yourself/);
  expect((await setPerms(request, "admin@example.com", "manager@example.com", [...withCount, "staff.manage"])).status).toBe(403);
  expect((await setPerms(request, "admin@example.com", "admin@example.com", ["cash.count", "staff.manage", "cash.bank"])).status).toBe(403);
  expect((await setPerms(request, "admin@example.com", "owner@example.com", ["cash.count"])).status).toBe(403);
  expect((await api(request, "admin@example.com", "/api/business/members", { method: "POST", body: { action: "member.grant", fields: { email: `delegate.${RUN.toLowerCase()}@example.com`, role: "Manager" } } })).status).toBe(403);
  expect((await setPerms(request, "owner@example.com", "admin@example.com", ["cash.count"])).status).toBe(200);
  expect((await setPerms(request, "admin@example.com", "manager@example.com", manager)).status).toBe(403);
});

test("separation of duties: a Manager holding count and verify cannot verify its own count", async ({ request }) => {
  const manager = (await workspace(request, "manager@example.com")).json.permissions;
  expect(manager).toEqual(expect.arrayContaining(["cash.count", "cash.verify"]));
  // The driver captures a second day through the server action (direct API).
  const vehicle = (await workspace(request, "driver@example.com")).json.snapshot.vehicles.find((entry) => entry.registration === "PV TEST 01");
  const SOD_DAY = "2026-10-09";
  const captured = await act(request, "driver@example.com", "capture.standard_income", {
    captureAs: "driver",
    vehicleId: vehicle.id,
    tripDate: SOD_DAY,
    timeIn: "06:00",
    timeOut: "09:00",
    openingOdo: 1080,
    closingOdo: 1140,
    tripLogbook: [{ fromLocation: "Rank A", toLocation: "Rank B", passengerCount: 10, amountCollected: 250 }],
  });
  expect(captured.status, captured.json.error).toBe(200);
  const submitted = await act(request, "driver@example.com", "cashup.submit", { workDate: SOD_DAY });
  expect(submitted.status).toBe(200);
  const day = submitted.json.cashUpId;
  expect((await act(request, "manager@example.com", "cashup.record_handin", { cashUpId: day, actualCashReceived: 250 })).status).toBe(200);
  const self = await act(request, "manager@example.com", "cashup.verify", { cashUpId: day });
  expect(self.status).toBe(403);
  expect(self.json.error).toMatch(/another authorized person/);
  const other = await act(request, "owner@example.com", "cashup.verify", { cashUpId: day });
  expect(other.status).toBe(200);
  expect(other.json.status).toBe("verified");
});
