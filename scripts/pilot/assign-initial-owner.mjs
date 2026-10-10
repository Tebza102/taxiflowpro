import { createHttpError } from "../../api/_lib/tenantAuth.js";
import { ensureAuthUser, findAuthUserByEmail, normalizeEmail, withDirectoryEntry } from "../../api/_lib/tenantOnboarding.js";

// OPERATOR: assign the initial Owner of an EXISTING business (for example the
// mapped legacy workspace when no active Owner was mapped). Shared by the local
// and hosted procedures; the target guards live in the callers.
//
// * Refused when the business already has an active Owner.
// * Dry-run (planAssignInitialOwner) reads only: no account is created.
// * Apply: finds or creates the account (a new account gets the password-setup
//   email; an existing one is unchanged), then one transaction sets the Owner
//   membership and the directory entry with a version check
//   (public.assign_initial_owner). An account without a membership has no
//   access, so a failure between the two steps grants nothing; repeat the same
//   command to finish.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value) => String(value ?? "").trim();

const loadBusiness = async (service, slug) => {
  const { data: business, error } = await service.from("businesses").select("id, slug, name").eq("slug", text(slug).toLowerCase()).maybeSingle();
  if (error) throw createHttpError(502, "The business could not be looked up.");
  if (!business) throw createHttpError(404, `No business with slug "${slug}".`);
  const { data: row, error: rowError } = await service.from("workspace_snapshots").select("snapshot, updated_at").eq("business_id", business.id).maybeSingle();
  if (rowError || !row) throw createHttpError(502, "The business snapshot could not be read.");
  const { data: members, error: memberError } = await service.from("business_memberships").select("user_id, role, active, driver_staff_id").eq("business_id", business.id);
  if (memberError) throw createHttpError(502, "The business memberships could not be read.");
  return { business, row, members: members ?? [] };
};

export const planAssignInitialOwner = async (service, { slug, ownerEmail, driverStaffId }) => {
  const email = normalizeEmail(ownerEmail);
  if (!EMAIL.test(email)) throw createHttpError(400, "A valid Owner email is required.");
  const { business, row, members } = await loadBusiness(service, slug);
  const account = await findAuthUserByEmail(service, email);
  const activeOwners = members.filter((member) => member.role === "Owner" && member.active);
  const current = account ? members.find((member) => member.user_id === account.id) ?? null : null;
  const staffId = text(driverStaffId) || null;
  const problems = [];
  if (activeOwners.length && !(current && current.role === "Owner" && current.active)) {
    problems.push(`${business.name} already has ${activeOwners.length} active Owner(s); this procedure only assigns the first Owner.`);
  }
  if (staffId) {
    const drivers = Array.isArray(row.snapshot?.drivers) ? row.snapshot.drivers : [];
    if (!drivers.some((driver) => text(driver?.staffId) === staffId)) problems.push(`Driver profile ${staffId} does not exist in ${business.name}.`);
    const linked = members.find((member) => text(member.driver_staff_id) === staffId && member.user_id !== account?.id);
    if (linked) problems.push(`Driver profile ${staffId} is already linked to another sign-in.`);
  }
  return {
    business: { id: business.id, slug: business.slug, name: business.name },
    version: row.updated_at,
    ownerEmail: email,
    account: account ? "existing (unchanged; other business access untouched)" : "new (created with a password-setup email)",
    currentMembership: current ? `${current.role}${current.active ? "" : " (inactive)"}` : "none",
    alreadyOwner: Boolean(current && current.role === "Owner" && current.active),
    driverStaffId: staffId,
    problems,
  };
};

export const applyAssignInitialOwner = async (service, { slug, ownerEmail, ownerName, driverStaffId, redirectTo }) => {
  const plan = await planAssignInitialOwner(service, { slug, ownerEmail, driverStaffId });
  if (plan.problems.length) return { ok: false, status: "refused", plan };
  if (plan.alreadyOwner) return { ok: true, status: "already_owner", plan };
  const accountResult = await ensureAuthUser(service, { email: plan.ownerEmail, name: ownerName, redirectTo });
  const partial = { authUserId: accountResult.userId, authUserCreated: accountResult.created, membership: null };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { row } = await loadBusiness(service, slug);
    const snapshot = withDirectoryEntry(row.snapshot, { email: plan.ownerEmail, name: ownerName, role: "Owner", staffId: plan.driverStaffId, active: true });
    const { data, error } = await service.rpc("assign_initial_owner", {
      p_business_id: plan.business.id,
      p_user_id: accountResult.userId,
      p_driver_staff_id: plan.driverStaffId,
      p_expected_updated_at: row.updated_at,
      p_snapshot: snapshot,
    });
    if (error) {
      return { ok: false, status: "error", plan, partial, error: "The Owner could not be assigned; the account has no access yet. Run the same command again." };
    }
    if (data?.status === "conflict") continue;
    if (data?.status === "assigned" || data?.status === "already_owner") {
      return { ok: true, status: data.status, plan, accountCreated: accountResult.created, setupEmailSent: accountResult.setupEmailSent };
    }
    return { ok: false, status: data?.status ?? "unknown", plan, partial, error: data?.status === "has_owner" ? "The business gained an active Owner meanwhile; nothing was changed." : "The Owner could not be assigned." };
  }
  return { ok: false, status: "conflict", plan, partial, error: "The business kept changing; nothing was assigned. Run the same command again." };
};
