// Module view-permission rules shared by the browser app (via appRuntime.js) and
// the server report endpoints. No imports, so Node can load it directly: the
// Reports UI and the report endpoints must reach the same answer for an account.

export const VIEWER_ROLE = "Viewer";
export const ROLES = ["Owner", "Admin", "Manager", "Driver", VIEWER_ROLE];

export const MODULE_VIEW_ROLES = {
  overview: ROLES,
  finance: ["Owner", "Admin", "Manager", VIEWER_ROLE],
  fleet: ROLES,
  drivers: ROLES,
  // Not separately assignable: an account sees Reports only while its Money
  // (finance) permission is on. See normalizeModuleViewAccess.
  reports: ["Owner", "Admin", "Manager"],
  settings: ["Owner", "Admin", "Manager"],
};

const MODULE_KEYS = Object.keys(MODULE_VIEW_ROLES);

export const normalizeRole = (value) =>
  ROLES.find((role) => role.toLowerCase() === String(value ?? "").trim().toLowerCase()) ?? null;

const allowedByRole = (moduleKey, role) => MODULE_VIEW_ROLES[moduleKey].includes(role);

export const createDefaultModuleViewAccess = (role) => {
  const normalizedRole = normalizeRole(role) ?? "Driver";

  if (normalizedRole === "Owner") {
    return Object.fromEntries(MODULE_KEYS.map((moduleKey) => [moduleKey, true]));
  }

  if (normalizedRole === VIEWER_ROLE) {
    return Object.fromEntries(MODULE_KEYS.map((moduleKey) => [moduleKey, moduleKey === "overview"]));
  }

  if (["Admin", "Manager"].includes(normalizedRole)) {
    return Object.fromEntries(
      MODULE_KEYS.map((moduleKey) => [moduleKey, allowedByRole(moduleKey, normalizedRole)]),
    );
  }

  return Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => [
      moduleKey,
      moduleKey === "overview"
        ? true
        : moduleKey === "settings"
          ? false
          : allowedByRole(moduleKey, normalizedRole),
    ]),
  );
};

// An explicit stored true/false (what Settings saves when the Owner flips a
// toggle) is authoritative; the role default only fills a missing key. The
// previous `stored || default` made a stored `false` impossible once Admin and
// Manager defaults became role-based, so the Owner could not switch Money off.
// The Owner is never restricted.
export const normalizeModuleViewAccess = (value = {}, role) => {
  const normalizedRole = normalizeRole(role) ?? "Driver";
  const defaults = createDefaultModuleViewAccess(normalizedRole);

  if (normalizedRole === "Owner") {
    return defaults;
  }

  const access = Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => {
      if (moduleKey === "overview") {
        return [moduleKey, true];
      }

      if (moduleKey === "settings") {
        return [moduleKey, allowedByRole(moduleKey, normalizedRole)];
      }

      if (!allowedByRole(moduleKey, normalizedRole)) {
        return [moduleKey, false];
      }

      const stored = value?.[moduleKey];

      return [moduleKey, typeof stored === "boolean" ? stored : defaults[moduleKey]];
    }),
  );

  access.reports = allowedByRole("reports", normalizedRole) && access.finance === true;

  return access;
};
