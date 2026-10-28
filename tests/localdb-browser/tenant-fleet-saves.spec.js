import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { BUSINESS_A_ID, LOCAL_TEST_PASSWORD } from "../../scripts/localdb/seed-data.mjs";
import { skipUserGuideWhenShown } from "../user-guide-helpers.mjs";

// Release 06, LOCAL TEST stack (TAXIFLOW_LOCALDB_PROFILE=test, after a reset):
// the Owner gives a Manager route/vehicle and driver management in Business
// access; the Manager then saves a route, a vehicle and a driver profile in the
// real screens, and each survives a full page reload (read back from the
// server, and present in the database).

const sql = (text) =>
  execFileSync(process.execPath, ["--input-type=module", "-e", `const { psql } = await import("./scripts/localdb/lib/exec.mjs"); process.stdout.write(psql(${JSON.stringify(text)}).stdout);`], { encoding: "utf8" }).trim();

const signIn = async (page, email) => {
  await skipUserGuideWhenShown(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(LOCAL_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};
const signOut = async (page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
};
// A select's accessible name includes its option text, so find it by the field caption.
const fieldSelect = (page, caption) => page.locator("label.finance-field", { has: page.locator("span", { hasText: new RegExp(`^${caption}$`) }) }).locator("select");
const openModule = async (page, label) => page.locator("button.module-button").filter({ hasText: label }).first().click();

test("Owner-granted Manager saves a route, a vehicle and a driver that survive a reload", async ({ page }) => {
  test.skip(process.env.TAXIFLOW_LOCALDB_PROFILE !== "test", "Runs only against the isolated test stack.");

  // 1. Without the responsibility the Manager sees view-only fleet screens.
  await signIn(page, "manager@example.com");
  await openModule(page, "Fleet & Operations");
  await expect(page.getByTestId("tenant-fleet-scope")).toContainText("view-only");
  await expect(page.getByRole("button", { name: "Create route" })).toHaveCount(0);
  await signOut(page);

  // 2. The Owner gives the Manager both responsibilities in Business access.
  await signIn(page, "owner@example.com");
  await openModule(page, "Settings");
  await page.getByLabel("Manage routes and vehicles for manager@example.com").check();
  await page.getByLabel("Manage driver profiles and assignments for manager@example.com").check();
  const managerRow = page.getByTestId("access-row").filter({ hasText: "manager@example.com" }).filter({ hasText: "Manager" }).first();
  await managerRow.getByRole("button", { name: "Save responsibilities" }).click();
  await expect(page.getByRole("status")).toContainText("Responsibilities saved for manager@example.com", { timeout: 30_000 });
  await signOut(page);
  const stored06 = sql(`select array_to_string(array(select unnest(permissions) order by 1), ',') from public.business_memberships m join auth.users u on u.id = m.user_id where m.business_id = '${BUSINESS_A_ID}' and u.email = 'manager@example.com' and m.active;`);
  expect(stored06).toBe("cash.bank,cash.verify,drivers.manage,fleet.manage");

  // 3. The Manager adds a route.
  await signIn(page, "manager@example.com");
  await openModule(page, "Fleet & Operations");
  await expect(page.getByTestId("tenant-fleet-scope")).toContainText("saved on the server");
  await page.getByLabel("Route name").fill("Browser Depot to Station");
  await page.getByLabel("Route code").fill("BR1");
  await page.getByLabel("Primary origin").fill("Browser Depot");
  await page.getByLabel("Primary destination").fill("Station");
  await page.getByRole("button", { name: "Create route" }).click();
  await expect(page.getByText("Route profile created.")).toBeVisible({ timeout: 30_000 });

  // 4. ...and a vehicle on that route.
  await page.locator("button.action-button", { hasText: "Add vehicle" }).click();
  await page.getByLabel("Registration").fill("BR 100 GP");
  await page.getByLabel("Model").fill("Browser Quantum");
  await fieldSelect(page, "Route").selectOption({ label: "BR1 / Browser Depot to Station" });
  await page.getByRole("button", { name: "Create vehicle" }).click();
  await expect(page.getByText("Vehicle profile created.")).toBeVisible({ timeout: 30_000 });

  // 5. ...and a driver profile (no sign-in).
  await openModule(page, "Drivers");
  await expect(page.getByTestId("tenant-drivers-scope")).toContainText("never gives anyone a sign-in");
  await page.getByRole("button", { name: "Add driver" }).first().click();
  await page.getByLabel("Full name").fill("Browser Driver");
  await page.getByRole("listbox", { name: "Assigned routes" }).selectOption({ label: "BR1 / Browser Depot to Station" });
  await expect(page.getByLabel("Email address")).toBeDisabled();
  await page.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText("Browser Driver added to the driver roster.")).toBeVisible({ timeout: 30_000 });

  // 6. A full reload reads everything back from the server.
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  await openModule(page, "Drivers");
  await expect(page.getByText("Browser Driver").first()).toBeVisible({ timeout: 30_000 });
  await openModule(page, "Fleet & Operations");
  // The default "attention" filter lists only vehicles needing action; the vehicle selector lists all.
  await expect(page.locator("option", { hasText: "BR 100 GP / Browser Depot to Station" })).toHaveCount(1, { timeout: 30_000 });
  await expect(fieldSelect(page, "Route").locator("option", { hasText: "Browser Depot to Station" })).toHaveCount(1);

  // 7. And they are in the database, attributed to the Manager, with no sign-in created.
  const stored = JSON.parse(sql(`select json_build_object('routes', snapshot->'routes', 'vehicles', snapshot->'vehicles', 'drivers', snapshot->'drivers')::text from public.workspace_snapshots where business_id = '${BUSINESS_A_ID}';`));
  const route = stored.routes.find((entry) => entry.name === "Browser Depot to Station");
  const vehicle = stored.vehicles.find((entry) => entry.registration === "BR 100 GP");
  const driver = stored.drivers.find((entry) => entry.name === "Browser Driver");
  expect(route?.code).toBe("BR1");
  expect(route?.createdByRole).toBe("Manager");
  expect(vehicle?.currentRouteId).toBe(route?.id);
  expect(driver?.routeIds).toEqual([route?.id]);
  expect(driver?.email ?? null).toBeNull();
  expect(sql("select count(*) from auth.users where email ilike '%browser%';")).toBe("0");
});
