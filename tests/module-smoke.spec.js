import { expect, test } from "@playwright/test";

const PASSWORD = "TaxiFlow.123";

const ownerAccount = {
  email: "owner@taxiflow.local",
  role: "Owner",
};

const managementAccounts = [
  { email: "manager@taxiflow.local", role: "Manager" },
  { email: "admin@taxiflow.local", role: "Admin" },
];

const driverAccount = {
  email: "driver.one@taxiflow.local",
  role: "Driver",
};

const viewerAccount = {
  email: "viewer@taxiflow.local",
  role: "Viewer",
};

const driverTwoAccount = {
  email: "driver.two@taxiflow.local",
  role: "Driver",
};

const attachRuntimeCollectors = (page) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return () => {
    expect.soft(consoleErrors, "browser console errors").toEqual([]);
    expect.soft(pageErrors, "browser page errors").toEqual([]);
  };
};

const moduleButton = (page, label) =>
  page.locator("button.module-button").filter({ hasText: label }).first();

const signIn = async (page, email, password = PASSWORD) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
};

const signOut = async (page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
};

// Settings module pills toggle; Admin and Manager start with their role modules
// on (see "Access by role" in Settings), so only click when the state differs.
const setModuleAccess = async (accessForm, moduleLabel, enabled) => {
  const pill = accessForm.getByRole("button", { name: moduleLabel, exact: true });
  const isActive = /\bactive\b/.test((await pill.getAttribute("class")) ?? "");

  if (isActive !== enabled) {
    await pill.click();
  }
};

const openModule = async (page, moduleLabel, expectedHeading) => {
  await moduleButton(page, moduleLabel).click();
  await expect(page.getByRole("heading", { name: expectedHeading })).toBeVisible();
};

test("owner can reach every main module and see embedded compliance", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await expect(page.getByText(ownerAccount.role).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily flow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Service and document alerts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Expiring documents" })).toBeVisible();

  await openModule(page, "Money", "Daily trip entry");
  await openModule(page, "Fleet & Operations", "Fleet & Operations overview");
  await openModule(page, "Drivers", "Terminal preview");
  await openModule(page, "Settings", "Roles and rights");

  await signOut(page);
  assertNoRuntimeErrors();
});

// Since d3adf04 ("Fix admin and manager module access") Admin and Manager start
// with their role modules on; the Owner narrows them per account in Settings.
test("manager and admin default to their role modules plus reset-only settings access", async ({
  page,
}) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  for (const account of managementAccounts) {
    await signIn(page, account.email);
    await expect(page.getByText(account.role).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily flow" })).toBeVisible();
    await expect(moduleButton(page, "Money")).toBeVisible();
    await expect(moduleButton(page, "Fleet & Operations")).toBeVisible();
    await expect(moduleButton(page, "Drivers")).toBeVisible();
    await expect(moduleButton(page, "Reports")).toBeVisible();
    await expect(moduleButton(page, "Settings")).toBeVisible();

    await openModule(page, "Settings", "User accounts");
    await expect(page.getByRole("heading", { name: "Update selected user" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Password reset requests" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Email outbox" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roles and rights" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Data mode" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Factory reset" })).toHaveCount(0);

    await signOut(page);
  }

  assertNoRuntimeErrors();
});

test("viewer is locked to demo data even when the owner switches the workspace to live", async ({
  page,
}) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await openModule(page, "Settings", "Roles and rights");
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.getByText(/Live mode is active\./i)).toBeVisible();
  await signOut(page);

  await signIn(page, viewerAccount.email);
  await expect(page.getByText(viewerAccount.role).first()).toBeVisible();
  await expect(page.getByText("Demo only")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily flow" })).toBeVisible();
  await expect(page.getByText("Apprigate Mobility Operators")).toBeVisible();
  await expect(page.getByText("Live operations workspace")).toHaveCount(0);
  await expect(page.locator("button.module-button").filter({ hasText: "Money" })).toHaveCount(0);
  await expect(page.locator("button.module-button").filter({ hasText: "Fleet & Operations" })).toHaveCount(0);
  await expect(page.locator("button.module-button").filter({ hasText: "Drivers" })).toHaveCount(0);
  await expect(page.locator("button.module-button").filter({ hasText: "Settings" })).toHaveCount(0);

  await signOut(page);
  assertNoRuntimeErrors();
});

test("management can update user details without changing access settings", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);
  const updatedByAdmin = "Sizwe Admin Update";
  const updatedByManager = "Sizwe Manager Update";

  await signIn(page, "admin@taxiflow.local");
  await openModule(page, "Settings", "User accounts");

  let userRow = page.locator("article.person-row").filter({
    hasText: driverAccount.email,
  });
  await userRow.getByRole("button", { name: "Manage" }).click();

  let detailsForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save changes" }),
  });
  await detailsForm.getByLabel("Full name").fill(updatedByAdmin);
  await detailsForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${updatedByAdmin} details saved.`)).toBeVisible();
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  await openModule(page, "Settings", "User accounts");

  userRow = page.locator("article.person-row").filter({
    hasText: driverAccount.email,
  });
  await expect(userRow).toContainText(updatedByAdmin);
  await userRow.getByRole("button", { name: "Manage" }).click();

  detailsForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save changes" }),
  });
  await detailsForm.getByLabel("Full name").fill(updatedByManager);
  await detailsForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${updatedByManager} details saved.`)).toBeVisible();
  await signOut(page);

  await signIn(page, driverAccount.email);
  await expect(page.getByText(updatedByManager).first()).toBeVisible();
  await signOut(page);

  assertNoRuntimeErrors();
});

test("owner-granted management module access persists after reload and re-login", async ({
  page,
}) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);
  const grants = [
    {
      email: "admin@taxiflow.local",
      moduleLabel: "Drivers",
      expectedHeading: "Terminal preview",
    },
    {
      email: "manager@taxiflow.local",
      moduleLabel: "Fleet & Operations",
      expectedHeading: "Fleet & Operations overview",
    },
  ];

  await signIn(page, ownerAccount.email);
  await openModule(page, "Settings", "Roles and rights");

  for (const grant of grants) {
    const userRow = page.locator("article.person-row").filter({
      hasText: grant.email,
    });
    await userRow.getByRole("button", { name: "Manage" }).click();

    const accessForm = page.locator("form.finance-form").filter({
      has: page.getByRole("button", { name: "Save access" }),
    });
    await setModuleAccess(accessForm, grant.moduleLabel, true);
    await accessForm.getByRole("button", { name: "Save access" }).click();
    await expect(page.getByText(/updated as/i)).toBeVisible();
  }

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await openModule(page, "Settings", "Roles and rights");

  for (const grant of grants) {
    const userRow = page.locator("article.person-row").filter({
      hasText: grant.email,
    });
    await userRow.getByRole("button", { name: "Manage" }).click();

    const accessForm = page.locator("form.finance-form").filter({
      has: page.getByRole("button", { name: "Save access" }),
    });
    await expect(
      accessForm.locator("button.finance-sub-pill.active").filter({
        hasText: grant.moduleLabel,
      }),
    ).toBeVisible();
  }

  await signOut(page);

  for (const grant of grants) {
    await signIn(page, grant.email);
    await expect(moduleButton(page, grant.moduleLabel)).toBeVisible();
    await openModule(page, grant.moduleLabel, grant.expectedHeading);
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(moduleButton(page, grant.moduleLabel)).toBeVisible();
    await signOut(page);
  }

  assertNoRuntimeErrors();
});

test("sign-in screen routes forgotten passwords to management", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email").fill(driverAccount.email);
  await expect(page.getByRole("button", { name: "Forgot password?" })).toBeVisible();

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByText(/Management will reset the password for this account\./i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send reset request" }).click();

  await expect(
    page.getByText(/Management has been notified in-app and the email queue has been created\./i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send reset request" }).click();
  await expect(
    page.getByText(/Management has already been notified in-app and by email\./i),
  ).toBeVisible();

  await signIn(page, ownerAccount.email);
  await openModule(page, "Settings", "Roles and rights");

  const resetPanel = page.locator("section.panel-card").filter({
    has: page.getByRole("heading", { name: "Password reset requests" }),
  });
  const requestRow = resetPanel.locator("article.person-row").filter({
    hasText: driverAccount.email,
  });
  await expect(requestRow).toContainText("Pending");
  await expect(requestRow).toContainText("Requested");
  await expect(requestRow).toContainText("In-app sent");
  await expect(requestRow).toContainText("Email queued");

  const emailPanel = page.locator("section.panel-card").filter({
    has: page.getByRole("heading", { name: "Email outbox" }),
  });
  const emailRow = emailPanel.locator("article.ledger-row").filter({
    hasText: `TaxiFlow password reset request / ${driverAccount.email}`,
  });
  await expect(emailRow).toContainText("Queued");
  await expect(emailRow).toContainText("owner@taxiflow.local");
  await expect(emailRow).toContainText("admin@taxiflow.local");
  await expect(emailRow).toContainText("manager@taxiflow.local");

  await signOut(page);
  assertNoRuntimeErrors();
});

test("owner settings rights allow admin to add a driver", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await openModule(page, "Settings", "Roles and rights");

  const adminRow = page.locator("article.person-row").filter({
    hasText: "admin@taxiflow.local",
  });
  await adminRow.getByRole("button", { name: "Manage" }).click();
  const accessForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save access" }),
  });
  await setModuleAccess(accessForm, "Drivers", true);
  await accessForm.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(/updated as Admin\./i)).toBeVisible();
  await signOut(page);

  await signIn(page, "admin@taxiflow.local");
  await openModule(page, "Drivers", "Terminal preview");

  const addDriverButton = page.getByRole("button", { name: "Add driver" }).first();
  await expect(addDriverButton).toBeEnabled();
  await addDriverButton.click();

  const addDriverForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save driver" }),
  });
  // Since fb5bb9e TaxiFlow login is an explicit, Owner-only opt-in: an Admin
  // gets no login controls and saves a profile-only driver.
  await expect(addDriverForm.getByLabel("Enable TaxiFlow login")).toHaveCount(0);
  await expect(addDriverForm.locator('input[type="password"]')).toHaveCount(0);
  await expect(addDriverForm).toContainText("Owner manages TaxiFlow login access.");
  await expect(addDriverForm).toContainText("No login access (profile only)");

  await addDriverForm.getByLabel("Full name").fill("Access Test Driver");
  await addDriverForm.getByLabel("Email address").fill("access.test.driver@taxiflow.local");
  await addDriverForm.getByLabel("Assigned routes").selectOption({ index: 0 });
  await addDriverForm.getByRole("button", { name: "Save driver" }).click();

  await expect(page.getByText("Access Test Driver added to the driver roster.")).toBeVisible();
  await expect(
    page.locator("article.person-row").filter({ hasText: "Access Test Driver" }),
  ).toContainText("access.test.driver@taxiflow.local");
  await signOut(page);
  assertNoRuntimeErrors();
});

test("saved driver.two account replaces the sample driver and persists after reload", async ({
  page,
}) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);
  const replacementDriverName = "Andile Hlatshwayo";
  const replacementPassword = "Andile123";

  // Since fb5bb9e enabling TaxiFlow login is an explicit opt-in that only the
  // Owner can make, so the Owner saves the login-enabled driver.
  await signIn(page, ownerAccount.email);
  await openModule(page, "Drivers", "Terminal preview");

  const addDriverButton = page.getByRole("button", { name: "Add driver" }).first();
  await expect(addDriverButton).toBeEnabled();
  await addDriverButton.click();

  const addDriverForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save driver" }),
  });
  const enableLogin = addDriverForm.getByLabel("Enable TaxiFlow login");
  const passwordInput = addDriverForm.locator('input[type="password"]');

  // Default: login off, no password field, profile-only.
  await expect(enableLogin).not.toBeChecked();
  await expect(passwordInput).toHaveCount(0);
  await expect(addDriverForm).toContainText("No login access (profile only)");

  // Opting in reveals the password field; opting out hides it again.
  await enableLogin.check();
  await expect(passwordInput).toBeVisible();
  await expect(addDriverForm).toContainText("Login access will be set");
  await enableLogin.uncheck();
  await expect(passwordInput).toHaveCount(0);
  await enableLogin.check();

  // A brand-new login-enabled driver needs a password in mock mode.
  await addDriverForm.getByLabel("Full name").fill(replacementDriverName);
  await addDriverForm.getByLabel("Email address").fill("new.login.driver@taxiflow.local");
  await addDriverForm.getByLabel("Assigned routes").selectOption({ index: 0 });
  await addDriverForm.getByRole("button", { name: "Save driver" }).click();
  await expect(page.getByText("Create a password for this driver before saving.")).toBeVisible();
  await expect(
    page.locator("article.person-row").filter({ hasText: "new.login.driver@taxiflow.local" }),
  ).toHaveCount(0);

  await addDriverForm.getByLabel("Email address").fill(driverTwoAccount.email);
  await passwordInput.fill(replacementPassword);
  await addDriverForm.getByRole("button", { name: "Save driver" }).click();

  await expect(
    page.getByText(`${replacementDriverName} updated in the driver roster.`),
  ).toBeVisible();
  await expect(
    page.locator("article.person-row").filter({
      hasText: replacementDriverName,
    }),
  ).toContainText(driverTwoAccount.email);
  await expect(
    page.locator("article.person-row").filter({
      hasText: "Thabo Ndlovu",
    }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await openModule(page, "Drivers", "Terminal preview");
  await expect(
    page.locator("article.person-row").filter({
      hasText: replacementDriverName,
    }),
  ).toContainText(driverTwoAccount.email);

  await signOut(page);
  await signIn(page, driverTwoAccount.email, replacementPassword);
  await expect(page.getByRole("heading", { name: replacementDriverName }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: replacementDriverName }).first()).toBeVisible();
  await signOut(page);

  assertNoRuntimeErrors();
});

test("owner settings rights allow manager to work in Fleet & Operations", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await openModule(page, "Settings", "Roles and rights");

  const managerRow = page.locator("article.person-row").filter({
    hasText: "manager@taxiflow.local",
  });
  await managerRow.getByRole("button", { name: "Manage" }).click();
  const accessForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save access" }),
  });
  await setModuleAccess(accessForm, "Fleet & Operations", true);
  await accessForm.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByText(/updated as Manager\./i)).toBeVisible();
  await signOut(page);

  await signIn(page, "manager@taxiflow.local");
  await openModule(page, "Fleet & Operations", "Fleet & Operations overview");
  await expect(page.getByRole("button", { name: "Add vehicle" }).first()).toBeEnabled();

  await signOut(page);
  assertNoRuntimeErrors();
});

test("owner can add a vehicle from Fleet & Operations", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await openModule(page, "Fleet & Operations", "Fleet & Operations overview");

  await page.getByRole("button", { name: "Add vehicle" }).first().click();

  const vehicleForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Create vehicle" }),
  });
  await vehicleForm.getByLabel("Registration").fill("TEST123GP");
  await vehicleForm.getByLabel("Model").fill("Toyota Quantum");
  await vehicleForm.getByLabel("Route").selectOption({ index: 1 });
  await vehicleForm.getByRole("button", { name: "Create vehicle" }).click();

  await expect(page.getByText("Vehicle profile created.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /TEST123GP/i })).toBeVisible();

  await signOut(page);
  assertNoRuntimeErrors();
});

test("management can save expense setup and use preset dropdowns", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, ownerAccount.email);
  await openModule(page, "Money", "Daily trip entry");
  await page.getByRole("button", { name: "Expenses" }).click();
  await expect(page.getByRole("heading", { name: "Vehicle cost presets" })).toBeVisible();

  const setupForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save setup" }),
  });
  await setupForm.getByLabel("Category name").fill("Test setup");
  await setupForm.getByLabel("Description option").fill("Test description");
  await setupForm.getByRole("button", { name: "Save setup" }).click();

  await expect(page.getByText("Test setup saved with Test description.")).toBeVisible();

  const expenseForm = page.locator("form.finance-form").filter({
    has: page.getByRole("button", { name: "Save expense" }),
  });
  await expenseForm.getByLabel("Category").selectOption("Test setup");
  await expect(expenseForm.getByLabel("Description")).toHaveValue("Test description");

  await expenseForm.getByLabel("Category").selectOption("Other");
  await expect(expenseForm.getByLabel("Description")).toHaveAttribute(
    "placeholder",
    "Provide the expense details",
  );

  await signOut(page);
  assertNoRuntimeErrors();
});

test("driver lands in the driver terminal and only sees allowed modules", async ({ page }) => {
  const assertNoRuntimeErrors = attachRuntimeCollectors(page);

  await signIn(page, driverAccount.email);
  await expect(page.getByText(driverAccount.role).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terminal preview" })).toBeVisible();
  await expect(page.locator("button.module-button").filter({ hasText: "Money" })).toHaveCount(0);
  await expect(page.locator("button.module-button").filter({ hasText: "Settings" })).toHaveCount(0);

  await openModule(page, "Overview", "Quick actions");
  await expect(page.getByRole("heading", { name: "My alerts" })).toBeVisible();
  await openModule(page, "Fleet & Operations", "Fleet & Operations overview");
  await openModule(page, "Drivers", "Terminal preview");

  await signOut(page);
  assertNoRuntimeErrors();
});
