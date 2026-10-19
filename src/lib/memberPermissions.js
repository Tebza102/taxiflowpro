// Owner-assigned responsibilities (release file 06), shared by the server
// (authoritative) and the screens (what to show). No imports, so Node can load it.
//
// Stored per membership in business_memberships.permissions; changed through
// public.set_member_permissions by an active Owner, or by a holder of
// staff.manage within its own responsibilities (see delegablePermissions). The
// Owner always holds every responsibility. Drivers hold none. Each
// responsibility also needs its module's view access (moduleAccess), so a
// switched-off module is never bypassed. Roles and sign-ins are never a
// responsibility: they stay with the Owner only.

export const MEMBER_PERMISSIONS = Object.freeze([
  Object.freeze({ key: "cash.count", module: "finance", label: "Receive and count cash", detail: "Record a driver's day hand-in and count standalone income." }),
  Object.freeze({ key: "cash.verify", module: "finance", label: "Verify counted cash", detail: "Check a counted hand-in before it can be banked." }),
  Object.freeze({ key: "cash.bank", module: "finance", label: "Bank verified cash", detail: "Finish the deposit for the verified batch." }),
  Object.freeze({ key: "drivers.manage", module: "drivers", label: "Manage driver profiles and assignments", detail: "Add or edit driver profiles and their route. Never gives anyone a sign-in." }),
  Object.freeze({ key: "fleet.manage", module: "fleet", label: "Manage routes and vehicles", detail: "Add or edit routes and vehicles." }),
  Object.freeze({
    key: "staff.manage",
    module: "settings",
    label: "Manage staff responsibilities",
    detail: "Give or remove other Admins' and Managers' responsibilities, only ones you hold yourself. Never roles, sign-ins or this responsibility; only the Owner gives it.",
  }),
]);

export const PERMISSION_KEYS = Object.freeze(MEMBER_PERMISSIONS.map((permission) => permission.key));
export const PERMISSION_ROLES = Object.freeze(["Admin", "Manager"]);
// Only the Owner can give or remove these (they are never delegated onward).
export const OWNER_ONLY_PERMISSIONS = Object.freeze(["staff.manage"]);

// Responsibilities this requester may give or remove for someone else: the
// Owner any; a staff manager only those it currently holds (effective, so a
// switched-off module also limits what it can delegate); everyone else none.
export const delegablePermissions = (requester) => {
  if (requester?.role === "Owner") return [...PERMISSION_KEYS];
  const held = Array.isArray(requester?.permissions) ? requester.permissions : [];
  if (!PERMISSION_ROLES.includes(requester?.role) || !held.includes("staff.manage")) return [];
  return held.filter((key) => PERMISSION_KEYS.includes(key) && !OWNER_ONLY_PERMISSIONS.includes(key));
};

// The keys a change would add or remove.
export const changedPermissions = (before, after) => {
  const a = new Set(normalizePermissionList(before));
  const b = new Set(normalizePermissionList(after));
  return [...new Set([...a].filter((key) => !b.has(key)).concat([...b].filter((key) => !a.has(key))))].sort();
};

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
