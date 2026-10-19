// Owner-assigned responsibilities (release file 06), shared by the server
// (authoritative) and the screens (what to show). No imports, so Node can load it.
//
// Stored per membership in business_memberships.permissions; only an active
// Owner changes them (public.set_member_permissions). The Owner always holds
// every responsibility. Drivers hold none. Each responsibility also needs its
// module's view access (moduleAccess), so a switched-off module is never
// bypassed. Changing staff roles, sign-ins or these responsibilities is not a
// responsibility: it stays with the Owner only.

export const MEMBER_PERMISSIONS = Object.freeze([
  Object.freeze({ key: "cash.count", module: "finance", label: "Receive and count cash", detail: "Record a driver's day hand-in and count standalone income." }),
  Object.freeze({ key: "cash.verify", module: "finance", label: "Verify counted cash", detail: "Check a counted hand-in before it can be banked." }),
  Object.freeze({ key: "cash.bank", module: "finance", label: "Bank verified cash", detail: "Finish the deposit for the verified batch." }),
  Object.freeze({ key: "drivers.manage", module: "drivers", label: "Manage driver profiles and assignments", detail: "Add or edit driver profiles and their route. Never gives anyone a sign-in." }),
  Object.freeze({ key: "fleet.manage", module: "fleet", label: "Manage routes and vehicles", detail: "Add or edit routes and vehicles." }),
]);

export const PERMISSION_KEYS = Object.freeze(MEMBER_PERMISSIONS.map((permission) => permission.key));
export const PERMISSION_ROLES = Object.freeze(["Admin", "Manager"]);

// Must match taxiflow_private.default_member_permissions (release file 06).
const ROLE_DEFAULTS = Object.freeze({
  Admin: Object.freeze(["cash.count"]),
  Manager: Object.freeze(["cash.verify", "cash.bank"]),
});

export const defaultPermissionsForRole = (role) => [...(ROLE_DEFAULTS[role] ?? [])];

export const normalizePermissionList = (value) =>
  [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry ?? "").trim()))]
    .filter((key) => PERMISSION_KEYS.includes(key))
    .sort();

// What the member can actually do now. `permissions` is the stored membership
// value; null/undefined (a database without file 06) means the role defaults,
// which equal the pre-06 fixed rules.
export const effectivePermissions = ({ role, permissions, moduleAccess } = {}) => {
  if (role === "Owner") return [...PERMISSION_KEYS];
  if (!PERMISSION_ROLES.includes(role)) return [];
  const stored = permissions === null || permissions === undefined ? defaultPermissionsForRole(role) : normalizePermissionList(permissions);
  return stored.filter((key) => {
    const module = MEMBER_PERMISSIONS.find((permission) => permission.key === key)?.module;
    return moduleAccess?.[module] === true;
  });
};

export const hasPermission = (requester, key) =>
  Boolean(requester) && (requester.role === "Owner" || (Array.isArray(requester.permissions) && requester.permissions.includes(key)));

export const permissionLabel = (key) => MEMBER_PERMISSIONS.find((permission) => permission.key === key)?.label ?? key;
