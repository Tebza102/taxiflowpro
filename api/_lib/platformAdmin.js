import { createHttpError, platformServiceClientFor } from "./tenantAuth.js";
import { createBusinessWithOwner, normalizeEmail } from "./tenantOnboarding.js";

// Platform administration: create companies (businesses) and onboard each
// company's initial Owner from the app. The caller is an active platform admin
// (tenantAuth.authorizePlatformRequest). Everything here is company METADATA:
// no workspace snapshot, member directory, finance record or report is read or
// returned, so a platform admin sees no company's data unless they are also a
// member of that company through the normal business membership path.
//
// Creating a company reuses the operator procedure (createBusinessWithOwner and
// the create_business_with_owner RPC): one transaction for business, snapshot
// and Owner membership; idempotent by slug; another Owner reusing a slug is
// refused; an existing Owner account is reused unchanged (no password reset, no
// email, its other memberships untouched); a new one gets a password-setup
// email and no password is ever chosen by the platform admin.

const text = (value) => String(value ?? "").trim();
const CREATE_FIELDS = new Set(["name", "slug", "ownerEmail", "ownerName", "ownerDrives"]);

export const slugFromName = (name) =>
  text(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

const emailOf = async (service, userId) => {
  const { data } = await service.auth.admin.getUserById(userId);
  return normalizeEmail(data?.user?.email);
};

export const listCompanies = async (platformAuthorization) => {
  const service = platformServiceClientFor(platformAuthorization);
  const { data: businesses, error } = await service.from("businesses").select("id, slug, name, created_at").order("created_at", { ascending: true });
  if (error) throw createHttpError(502, "The companies could not be read.");
  const { data: memberships, error: membershipError } = await service
    .from("business_memberships")
    .select("business_id, user_id, role, active")
    .eq("active", true);
  if (membershipError) throw createHttpError(502, "The companies could not be read.");
  const emails = new Map();
  const companies = [];
  for (const [index, business] of (businesses ?? []).entries()) {
    const active = (memberships ?? []).filter((m) => m.business_id === business.id);
    const owners = [];
    for (const owner of active.filter((m) => m.role === "Owner")) {
      if (!emails.has(owner.user_id)) emails.set(owner.user_id, await emailOf(service, owner.user_id));
      owners.push(emails.get(owner.user_id));
    }
    companies.push({
      tenantNumber: index + 1,
      businessId: business.id,
      slug: business.slug,
      name: business.name,
      createdAt: business.created_at,
      owners: owners.sort(),
      activeMembers: active.length,
    });
  }
  return { companies };
};

export const createCompany = async (platformAuthorization, fields, { redirectTo } = {}) => {
  const unknown = Object.keys(fields ?? {}).filter((key) => !CREATE_FIELDS.has(key));
  if (unknown.length) throw createHttpError(400, `Unsupported field: ${unknown.join(", ")}.`);
  const name = text(fields.name);
  if (!name) throw createHttpError(400, "The company name is required.");
  const slug = text(fields.slug).toLowerCase() || slugFromName(name);
  const ownerEmail = normalizeEmail(fields.ownerEmail);
  if (ownerEmail && ownerEmail === normalizeEmail(platformAuthorization.email)) {
    // Separation of duties: the platform admin onboards Owners; it does not
    // make itself the Owner (and so gain company data) through this console.
    throw createHttpError(403, "Use the company Owner's own email. A platform admin cannot make themselves the Owner here.");
  }
  if (fields.ownerDrives !== undefined && typeof fields.ownerDrives !== "boolean") {
    throw createHttpError(400, "ownerDrives must be true or false.");
  }
  const service = platformServiceClientFor(platformAuthorization);
  const result = await createBusinessWithOwner(service, {
    slug,
    name,
    ownerEmail,
    ownerName: text(fields.ownerName),
    ownerDrives: fields.ownerDrives === true,
    redirectTo,
    createdBy: { userId: platformAuthorization.userId },
  });
  if (!result.ok) {
    const error = createHttpError(result.status ?? 502, result.error);
    error.partial = result.partial;
    throw error;
  }
  return {
    status: result.status, // created | existing
    businessId: result.businessId,
    slug,
    ownerAccount: result.ownerCreated ? "new" : "existing",
    setupEmailSent: result.setupEmailSent,
    ownerDriverLinked: Boolean(result.ownerDriverStaffId),
  };
};
