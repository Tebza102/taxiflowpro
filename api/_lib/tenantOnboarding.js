import { randomUUID } from "node:crypto";

import { normalizeModuleViewAccess } from "../../src/lib/moduleAccessPolicy.js";
import { createHttpError, readBusinessSnapshot, serviceClientFor } from "./tenantAuth.js";

// Pilot onboarding (Task 18). Business memberships are the ONLY source of
// access. The business directory (snapshot appUsers) mirrors each member's
// name, role, driver link and module toggles for the existing UI, and changes
// in the same database transaction as the membership
// (public.apply_membership_change).
//
// * Businesses and their initial Owner are created only by the operator
//   procedure (createBusinessWithOwner, service role, outside the browser).
// * An active Owner manages Admin, Manager and Driver access in their own
//   business; Owners are never created or changed through the app.
// * Driver profiles (snapshot drivers) exist without any sign-in; a Driver
//   membership links one login to one profile.
// * Auth accounts are found or created by email and never deleted or altered
//   here, so a person's access to other businesses is untouched.
// * An Auth account without a membership has no access, so a failure between
//   the Auth step and the membership step leaves no unintended access; the
//   response reports it and the same request can simply be retried.

const text = (value) => String(value ?? "").trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSIGNABLE_ROLES = ["Admin", "Manager", "Driver"];
const SLUG = /^[a-z0-9][a-z0-9-]{2,62}$/;
const bad = (message) => createHttpError(400, message);

export const normalizeEmail = (value) => text(value).toLowerCase();

// --- Auth accounts ------------------------------------------------------------------
export const findAuthUserByEmail = async (service, email) => {
  const target = normalizeEmail(email);
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw createHttpError(502, "The sign-in accounts could not be checked.");
    const users = data?.users ?? [];
    const match = users.find((user) => normalizeEmail(user.email) === target);
    if (match) return match;
    if (users.length < 200) return null;
  }
  return null;
};

// Finds the account or creates it without a password. A new account receives a
// password-setup (recovery) email; an existing one is left exactly as it is.
export const ensureAuthUser = async (service, { email, name, redirectTo }) => {
  const existing = await findAuthUserByEmail(service, email);
  if (existing) return { userId: existing.id, created: false, setupEmailSent: false };

  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: name ? { name } : {},
  });
  if (error) {
    // A concurrent retry may have created it first.
    const raced = await findAuthUserByEmail(service, email);
    if (raced) return { userId: raced.id, created: false, setupEmailSent: false };
    throw createHttpError(502, "The sign-in account could not be created. Nothing was granted; try again.");
  }
  const { error: mailError } = await service.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  return { userId: data.user.id, created: true, setupEmailSent: !mailError };
};

// --- Directory (snapshot appUsers) and driver profiles ------------------------------
const directoryEntry = ({ email, name, role, staffId, active, moduleAccess, existing }) => ({
  ...(existing ?? {}),
  email,
  name: text(name) || existing?.name || email,
  role,
  staffId: staffId ?? null,
  active,
  moduleAccess: normalizeModuleViewAccess(moduleAccess ?? existing?.moduleAccess ?? {}, role),
});

export const withDirectoryEntry = (snapshot, entry) => {
  const users = Array.isArray(snapshot.appUsers) ? snapshot.appUsers : [];
  const email = normalizeEmail(entry.email);
  const existing = users.find((user) => normalizeEmail(user?.email) === email) ?? null;
  const next = directoryEntry({ ...entry, email, existing });
  return {
    ...snapshot,
    appUsers: existing ? users.map((user) => (normalizeEmail(user?.email) === email ? next : user)) : [...users, next],
  };
};

const driverProfiles = (snapshot) => (Array.isArray(snapshot.drivers) ? snapshot.drivers : []);
const requireDriverProfile = (snapshot, staffId) => {
  const profile = driverProfiles(snapshot).find((driver) => text(driver?.staffId) === staffId);
  if (!profile) throw createHttpError(404, "That driver profile does not exist in this business.");
  return profile;
};

const audit = (actorId, title, detail) => ({
  id: `audit-${randomUUID()}`,
  timestamp: new Date().toISOString(),
  scope: "settings",
  actorId,
  actorRole: "Owner",
  source: "server",
  title,
  detail,
});

// --- Operator: create a business with its initial Owner -----------------------------
export const buildInitialSnapshot = ({ name, owner, ownerDriver, createdBy }) => ({
  profile: { fleetName: name, legalEntity: name, district: "" },
  appUsers: [
    directoryEntry({ email: owner.email, name: owner.name, role: "Owner", staffId: ownerDriver?.staffId ?? null, active: true }),
  ],
  drivers: ownerDriver
    ? [{ staffId: ownerDriver.staffId, name: ownerDriver.name, email: owner.email, route: null, role: "Driver" }]
    : [],
  vehicles: [],
  routes: [],
  financeTransactions: [],
  dailyCashUps: [],
  deposits: [],
  // A company created in the platform console records who created it.
  auditTrail: createdBy
    ? [{ id: `audit-${randomUUID()}`, timestamp: new Date().toISOString(), scope: "settings", actorId: createdBy.userId, actorRole: "Platform admin", source: "server", title: "Company created", detail: `${name} / Owner ${owner.email}` }]
    : [],
});

export const createBusinessWithOwner = async (service, { slug, name, ownerEmail, ownerName, ownerDrives = false, redirectTo, createdBy = null }) => {
  const normalizedSlug = text(slug).toLowerCase();
  if (!SLUG.test(normalizedSlug)) throw bad("The business slug must be 3-63 lowercase letters, digits or dashes.");
  if (!text(name)) throw bad("The business name is required.");
  const email = normalizeEmail(ownerEmail);
  if (!EMAIL.test(email)) throw bad("A valid Owner email is required.");

  const account = await ensureAuthUser(service, { email, name: ownerName, redirectTo });
  const ownerDriver = ownerDrives ? { staffId: `drv-${normalizedSlug}-owner`, name: text(ownerName) || email } : null;
  const snapshot = buildInitialSnapshot({ name: text(name), owner: { email, name: ownerName }, ownerDriver, createdBy });
  const { data, error } = await service.rpc("create_business_with_owner", {
    p_slug: normalizedSlug,
    p_name: text(name),
    p_owner_user_id: account.userId,
    p_owner_driver_staff_id: ownerDriver?.staffId ?? null,
    p_snapshot: snapshot,
  });
  if (error) {
    return {
      ok: false,
      status: 502,
      error: "The business could not be created. The Owner account has no access yet; run the same command again.",
      partial: { authUserId: account.userId, authUserCreated: account.created, business: null },
    };
  }
  if (data?.status === "slug_taken") {
    return { ok: false, status: 409, error: "That business slug is already used by another business.", partial: { authUserId: account.userId, authUserCreated: account.created } };
  }
  return {
    ok: true,
    status: data.status, // created | existing
    businessId: data.business_id,
    ownerUserId: account.userId,
    ownerCreated: account.created,
    setupEmailSent: account.setupEmailSent,
    ownerDriverStaffId: ownerDriver?.staffId ?? null,
  };
};

// --- Owner: manage access in one business --------------------------------------------
const loadMembership = async (service, businessId, userId) => {
  const { data, error } = await service
    .from("business_memberships")
    .select("user_id, role, driver_staff_id, active")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw createHttpError(502, "The membership could not be read.");
  return data ?? null;
};

const emailOf = async (service, userId) => {
  const { data } = await service.auth.admin.getUserById(userId);
  return normalizeEmail(data?.user?.email);
};

// Runs one membership change with its directory update. The snapshot is re-read
// on a version conflict (the change is recomputed from current state, so a
// retry never overwrites someone else's edit).
const commitMembership = async (authorization, build) => {
  const service = serviceClientFor(authorization);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readBusinessSnapshot(authorization);
    const change = await build(row.snapshot);
    const { data, error } = await service.rpc("apply_membership_change", {
      p_business_id: authorization.businessId,
      p_actor: authorization.userId,
      p_user_id: change.userId,
      p_role: change.role,
      p_active: change.active,
      p_driver_staff_id: change.driverStaffId ?? null,
      p_expected_updated_at: row.updated_at,
      p_snapshot: change.snapshot,
    });
    if (error) {
      if (/driver_staff|duplicate key/i.test(error.message)) {
        throw createHttpError(409, "That driver profile is already linked to another sign-in in this business.");
      }
      if (error.code === "42501") throw createHttpError(403, error.message);
      throw createHttpError(502, "The access change could not be saved.");
    }
    if (data?.status === "applied") return { version: data.version, ...change.result };
  }
  throw createHttpError(409, "The business changed repeatedly while saving; try again.");
};

const assertOwner = (authorization) => {
  if (authorization.role !== "Owner") throw createHttpError(403, "Only an Owner can manage access for this business.");
};

const parseRole = (value) => {
  const role = text(value);
  if (!ASSIGNABLE_ROLES.includes(role)) throw createHttpError(403, "Only Admin, Manager or Driver access can be granted here.");
  return role;
};

export const MEMBER_ACTIONS = {
  // Grant (or update) access for an email: finds or creates the sign-in account.
  "member.grant": async (authorization, fields, { redirectTo }) => {
    assertOwner(authorization);
    const email = normalizeEmail(fields.email);
    if (!EMAIL.test(email)) throw bad("A valid email address is required.");
    const role = parseRole(fields.role);
    const driverStaffId = text(fields.driverStaffId) || null;
    if (role === "Driver" && !driverStaffId) throw bad("Choose the driver profile this sign-in belongs to.");
    if (role !== "Driver" && driverStaffId) throw bad("Only Driver access links a driver profile.");

    const service = serviceClientFor(authorization);
    // Validate against the business before any account is created.
    const current = await readBusinessSnapshot(authorization);
    if (driverStaffId) requireDriverProfile(current.snapshot, driverStaffId);

    const account = await ensureAuthUser(service, { email, name: fields.name, redirectTo });
    const partial = { authUserId: account.userId, authUserCreated: account.created, membership: null };
    try {
      if (account.userId === authorization.userId) throw createHttpError(403, "You cannot change your own access.");
      const existing = await loadMembership(service, authorization.businessId, account.userId);
      if (existing?.role === "Owner") throw createHttpError(403, "Owner access is managed by the operator.");
      const result = await commitMembership(authorization, async (snapshot) => {
        if (driverStaffId) requireDriverProfile(snapshot, driverStaffId);
        let next = withDirectoryEntry(snapshot, { email, name: fields.name, role, staffId: driverStaffId, active: true, moduleAccess: fields.moduleAccess });
        next = { ...next, auditTrail: [audit(authorization.userId, `Access granted / ${role}`, email), ...(next.auditTrail ?? [])] };
        return {
          userId: account.userId,
          role,
          active: true,
          driverStaffId,
          snapshot: next,
          result: { userId: account.userId, role, active: true, driverStaffId, accountCreated: account.created, setupEmailSent: account.setupEmailSent, previous: existing ? { role: existing.role, active: existing.active } : null },
        };
      });
      return result;
    } catch (error) {
      error.partial = partial;
      throw error;
    }
  },

  // Change role, driver link or module toggles of an existing non-Owner member.
  "member.update": async (authorization, fields) => {
    assertOwner(authorization);
    const userId = text(fields.userId);
    const service = serviceClientFor(authorization);
    if (userId === authorization.userId) throw createHttpError(403, "You cannot change your own access.");
    const existing = await loadMembership(service, authorization.businessId, userId);
    if (!existing) throw createHttpError(404, "That person is not a member of this business.");
    if (existing.role === "Owner") throw createHttpError(403, "Owner access is managed by the operator.");
    const role = fields.role === undefined ? existing.role : parseRole(fields.role);
    const driverStaffId = fields.driverStaffId === undefined ? existing.driver_staff_id : text(fields.driverStaffId) || null;
    if (role === "Driver" && !driverStaffId) throw bad("Driver access needs a driver profile.");
    const linked = role === "Driver" ? driverStaffId : null;
    const email = await emailOf(service, userId);
    return commitMembership(authorization, async (snapshot) => {
      if (linked) requireDriverProfile(snapshot, linked);
      let next = withDirectoryEntry(snapshot, { email, name: fields.name, role, staffId: linked, active: existing.active, moduleAccess: fields.moduleAccess });
      next = { ...next, auditTrail: [audit(authorization.userId, `Access updated / ${role}`, email), ...(next.auditTrail ?? [])] };
      return { userId, role, active: existing.active, driverStaffId: linked, snapshot: next, result: { userId, role, active: existing.active, driverStaffId: linked } };
    });
  },

  "member.deactivate": async (authorization, fields) => setActive(authorization, fields, false),
  "member.reactivate": async (authorization, fields) => setActive(authorization, fields, true),

  // Owner-driver: link (or unlink) the Owner's OWN login to a driver profile.
  "owner.link_driver": async (authorization, fields) => {
    assertOwner(authorization);
    const driverStaffId = text(fields.driverStaffId) || null;
    const service = serviceClientFor(authorization);
    const email = await emailOf(service, authorization.userId);
    return commitMembership(authorization, async (snapshot) => {
      if (driverStaffId) requireDriverProfile(snapshot, driverStaffId);
      let next = withDirectoryEntry(snapshot, { email, role: "Owner", staffId: driverStaffId, active: true });
      next = { ...next, auditTrail: [audit(authorization.userId, driverStaffId ? "Owner linked to driver profile" : "Owner driver link removed", driverStaffId ?? "-"), ...(next.auditTrail ?? [])] };
      return { userId: authorization.userId, role: "Owner", active: true, driverStaffId, snapshot: next, result: { userId: authorization.userId, role: "Owner", driverStaffId } };
    });
  },
};

const setActive = async (authorization, fields, active) => {
  assertOwner(authorization);
  const userId = text(fields.userId);
  const service = serviceClientFor(authorization);
  if (userId === authorization.userId) throw createHttpError(403, "You cannot change your own access.");
  const existing = await loadMembership(service, authorization.businessId, userId);
  if (!existing) throw createHttpError(404, "That person is not a member of this business.");
  if (existing.role === "Owner") throw createHttpError(403, "Owner access is managed by the operator.");
  const email = await emailOf(service, userId);
  return commitMembership(authorization, async (snapshot) => {
    let next = withDirectoryEntry(snapshot, { email, role: existing.role, staffId: existing.driver_staff_id, active });
    next = { ...next, auditTrail: [audit(authorization.userId, active ? "Access restored" : "Access removed", email), ...(next.auditTrail ?? [])] };
    return { userId, role: existing.role, active, driverStaffId: existing.driver_staff_id, snapshot: next, result: { userId, role: existing.role, active } };
  });
};

// Driver profile without any sign-in (create or rename). Owner only.
export const saveDriverProfile = async (authorization, fields) => {
  assertOwner(authorization);
  const name = text(fields.name);
  if (!name) throw bad("The driver's name is required.");
  const staffId = text(fields.staffId) || `drv-${randomUUID().slice(0, 8)}`;
  const service = serviceClientFor(authorization);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readBusinessSnapshot(authorization);
    const drivers = driverProfiles(row.snapshot);
    const existing = drivers.find((driver) => text(driver?.staffId) === staffId);
    if (text(fields.staffId) && !existing) throw createHttpError(404, "That driver profile does not exist in this business.");
    const profile = { ...(existing ?? { role: "Driver", route: null }), staffId, name, phone: text(fields.phone) || existing?.phone || null };
    const snapshot = {
      ...row.snapshot,
      drivers: existing ? drivers.map((driver) => (driver === existing ? profile : driver)) : [...drivers, profile],
      auditTrail: [audit(authorization.userId, existing ? "Driver profile updated" : "Driver profile added", name), ...(row.snapshot.auditTrail ?? [])],
    };
    const version = new Date().toISOString();
    const { data, error } = await service
      .from("workspace_snapshots")
      .update({ snapshot, updated_at: version, updated_by: authorization.userId })
      .eq("business_id", authorization.businessId)
      .eq("updated_at", row.updated_at)
      .select("updated_at");
    if (error) throw createHttpError(502, "The driver profile could not be saved.");
    if (data?.length === 1) return { staffId, name, created: !existing, version: data[0].updated_at };
  }
  throw createHttpError(409, "The business changed repeatedly while saving; try again.");
};

// Members of ONE business, for an Owner or Admin.
export const listMembers = async (authorization) => {
  if (!["Owner", "Admin"].includes(authorization.role)) throw createHttpError(403, "Only an Owner or Admin can view business access.");
  const service = serviceClientFor(authorization);
  const { data, error } = await service
    .from("business_memberships")
    .select("user_id, role, driver_staff_id, active")
    .eq("business_id", authorization.businessId);
  if (error) throw createHttpError(502, "Business access could not be read.");
  const row = await readBusinessSnapshot(authorization);
  const users = Array.isArray(row.snapshot.appUsers) ? row.snapshot.appUsers : [];
  const members = [];
  for (const member of data ?? []) {
    const email = await emailOf(service, member.user_id);
    const entry = users.find((user) => normalizeEmail(user?.email) === email);
    members.push({ userId: member.user_id, email, name: entry?.name ?? email, role: member.role, active: member.active, driverStaffId: member.driver_staff_id });
  }
  const linked = new Set(members.map((member) => member.driverStaffId).filter(Boolean));
  return {
    members: members.sort((a, b) => a.email.localeCompare(b.email)),
    driverProfiles: driverProfiles(row.snapshot).map((driver) => ({ staffId: driver.staffId, name: driver.name, signInLinked: linked.has(driver.staffId) })),
  };
};
