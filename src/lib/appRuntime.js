import { differenceInDays } from "date-fns";
import {
  Activity,
  Banknote,
  LayoutDashboard,
  Settings2,
  Users,
} from "lucide-react";
import {
  calculateDailyAnalytics,
  calculateKmComputed,
  calculateTripAnalytics,
  calculateTripDurationMin,
} from "./analytics";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeMatchMedia,
  getSafeWindow,
} from "./browserRuntime";

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const VIEWER_ROLE = "Viewer";
const ROLES = ["Owner", "Admin", "Manager", "Driver", VIEWER_ROLE];
const AUTH_ACCOUNT_DIRECTORY = {
  "owner@taxiflow.local": {
    name: "Owner account",
    role: "Owner",
    actorId: "owner-session",
  },
  "admin@taxiflow.local": {
    name: "Admin account",
    role: "Admin",
    actorId: "admin-session",
  },
  "manager@taxiflow.local": {
    name: "Lerato Maseko",
    role: "Manager",
    actorId: "mgr-01",
  },
  "viewer@taxiflow.local": {
    name: "Demo Viewer",
    role: VIEWER_ROLE,
    actorId: "viewer-session",
  },
};
const DEFAULT_DRIVER_ACCOUNT_EMAIL_BY_STAFF_ID = {
  "drv-01": "driver.one@taxiflow.local",
  "drv-02": "driver.two@taxiflow.local",
};
const LOCAL_AUTH_STORAGE_KEY = "taxiflow-auth-session-v1";
const LOCAL_AUTH_PASSWORD = "TaxiFlow.123";
const ROLE_LANDING_VIEW = {
  Owner: "overview",
  Admin: "overview",
  Manager: "overview",
  Driver: "drivers",
  Viewer: "overview",
};
const MODULE_EDIT_ACCESS = {
  finance: {
    label: "Money",
    detail: "Daily takings, extra trips, expenses, and bank checks.",
  },
  fleet: {
    label: "Fleet & Operations",
    detail: "Vehicle profiles, defects, repairs, and archive actions.",
  },
  drivers: {
    label: "Drivers",
    detail: "Driver roster changes and linked driver records.",
  },
};

const MODULE_VIEW_ACCESS = {
  overview: {
    label: "Overview",
    detail: "Dashboard and activity summary.",
    roles: ROLES,
  },
  finance: {
    label: "Money",
    detail: "Daily earnings, expenses, and banking.",
    roles: ["Owner", "Admin", "Manager", VIEWER_ROLE],
  },
  fleet: {
    label: "Fleet & Operations",
    detail: "Vehicles, defects, and service status.",
    roles: ROLES,
  },
  drivers: {
    label: "Drivers",
    detail: "Driver activity, roster, and shift allocation.",
    roles: ROLES,
  },
  settings: {
    label: "Settings",
    detail: "User roles and access rights.",
    roles: ["Owner", "Admin", "Manager"],
  },
};

const SETTINGS_ASSIGNABLE_MODULES = ["finance", "fleet", "drivers"];

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, roles: ROLES },
  {
    id: "finance",
    label: "Money",
    icon: Banknote,
    roles: ["Owner", "Admin", "Manager", VIEWER_ROLE],
  },
  {
    id: "fleet",
    label: "Fleet & Operations",
    icon: Activity,
    roles: ROLES,
  },
  { id: "drivers", label: "Drivers", icon: Users, roles: ROLES },
  { id: "settings", label: "Settings", icon: Settings2, roles: ["Owner", "Admin", "Manager"] },
];

const formatMoney = (value) => ZAR.format(value ?? 0);

const DEFECT_CATEGORIES = ["Windscreen", "Tires", "Seats", "Engine", "Other"];
const ROUTE_TYPE_OPTIONS = [
  { value: "route_service", label: "Route service" },
  { value: "special_trip", label: "Special trip" },
  { value: "contract", label: "Contract" },
];
const EXPENSE_OTHER_CATEGORY = "Other";
const EXPENSE_CUSTOM_DESCRIPTION_VALUE = "__custom__";
const DEFAULT_EXPENSE_PRESET_CATALOG = {
  asset: [
    {
      id: "preset-asset-fuel",
      name: "Fuel",
      descriptions: ["Fuel top-up", "Fuel refill"],
    },
    {
      id: "preset-asset-repairs",
      name: "Repairs",
      descriptions: ["Workshop repair", "Parts replacement"],
    },
    {
      id: "preset-asset-subscription",
      name: "Subscription",
      descriptions: ["Weekly subscription", "Rank subscription"],
    },
  ],
  operational: [
    {
      id: "preset-operational-salary",
      name: "Salary",
      descriptions: ["Driver salary", "Office wages"],
    },
    {
      id: "preset-operational-admin",
      name: "Admin",
      descriptions: ["Stationery", "Data and airtime"],
    },
    {
      id: "preset-operational-subscription",
      name: "Subscription",
      descriptions: ["System subscription", "Software licence"],
    },
  ],
};

const createRecordId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const LIVE_SYNC_WARNING_MESSAGE =
  "Live sync is temporarily unavailable. Showing the safest available state.";
const LIVE_SAVE_WARNING_MESSAGE = "Save failed. Please retry after checking connection.";
const OPERATIONS_WORKFLOW = [
  {
    id: "submit",
    title: "Submission",
    owner: "Driver",
    accent: "teal",
    detail:
      "Driver records daily trips and extra trips before handing the collected cash to admin.",
  },
  {
    id: "handover",
    title: "Cash hand-in",
    owner: "Admin",
    accent: "gold",
    detail:
      "Administrator counts the cash received and compares it with the total captured in TaxiFlow.",
  },
  {
    id: "verify",
    title: "Verification",
    owner: "Manager",
    accent: "navy",
    detail:
      "Manager reviews the cash checking, shortages, and distance gaps before money is ready for banking.",
  },
];

const syncLiveWarning = (setter, nextWarning) => {
  setter((current) => (current === nextWarning ? current : nextWarning));
};

const isStandaloneDisplay = () => {
  const browserWindow = getSafeWindow();

  if (!browserWindow) {
    return false;
  }

  return Boolean(
    safeMatchMedia("(display-mode: standalone)")?.matches ||
      browserWindow.navigator?.standalone === true,
  );
};

const getQueueTone = (entry) => {
  if (
    entry.shortage > 0 ||
    entry.gapKm > 0 ||
    ["Needs manager review", "Checked with issues"].includes(entry.status)
  ) {
    return "danger";
  }
  if (["Waiting for admin hand-in", "Waiting for manager check"].includes(entry.status)) {
    return "warning";
  }
  return "success";
};

const canRecordCashHandoverForRole = (role) => ["Owner", "Admin"].includes(role);
const canVerifyCashCheckForRole = (role) => ["Owner", "Manager"].includes(role);
const canFinishDepositForRole = (role) => ["Owner", "Manager"].includes(role);
const getVehicleReadinessOptions = (counts = {}) => [
  ["all", "All readiness"],
  ["route-service", `Route service ${counts.routeService ?? 0}`],
  ["special-trips", `Special trips ${counts.specialTrips ?? 0}`],
  ["contracts", `Contracts ${counts.contracts ?? 0}`],
];
const matchesVehicleReadiness = (vehicle, readinessFilter) => {
  if (readinessFilter === "route-service") {
    return Boolean(vehicle?.canDoRouteService);
  }
  if (readinessFilter === "special-trips") {
    return Boolean(vehicle?.canDoSpecialTrips);
  }
  if (readinessFilter === "contracts") {
    return Boolean(vehicle?.canDoContracts);
  }
  return true;
};

const getVehicleTone = (vehicle) => {
  if (vehicle.status === "archived") {
    return "neutral";
  }
  if (vehicle.healthState === "danger") {
    return "danger";
  }
  if (vehicle.healthState === "warning") {
    return "warning";
  }
  return "success";
};

const getDocumentTone = (daysLeft) => {
  if (daysLeft <= 30) {
    return "danger";
  }
  if (daysLeft <= 90) {
    return "warning";
  }
  return "success";
};

const getDefectTone = (severity) => {
  if (severity === "Resolved") {
    return "success";
  }
  if (severity === "Critical") {
    return "danger";
  }
  if (severity === "High" || severity === "Medium") {
    return "warning";
  }
  return "info";
};

const toneLabel = {
  success: "Healthy",
  warning: "Attention",
  danger: "Critical",
  info: "Watch",
  neutral: "Stable",
};

const PRIVILEGED_ROLES = new Set(["Owner", "Admin", "Manager"]);
const PASSWORD_RESET_ROLES = new Set(["Owner", "Admin", "Manager"]);
const DRIVER_SHORTCUTS = [
  "Log shift takings",
  "Log daily expense",
  "Capture special trip",
  "Report a defect",
  "View vehicle status",
];

const createModuleAccessState = () => ({
  requestStatus: "none",
  requestedAt: null,
  requestedBy: null,
  requestedByRole: null,
  ownerReviewedAt: null,
  ownerReviewedBy: null,
  ownerReviewedByRole: null,
  active: false,
  grantedAt: null,
  grantedBy: null,
  grantedByRole: null,
});

const normalizeModuleAccessState = (value = {}) => ({
  ...createModuleAccessState(),
  ...value,
});

const normalizePermissionControls = (value = {}) =>
  Object.fromEntries(
    Object.keys(MODULE_EDIT_ACCESS).map((moduleKey) => [
      moduleKey,
      normalizeModuleAccessState(value?.[moduleKey]),
    ]),
  );

const getPermissionControls = (snapshot) =>
  normalizePermissionControls(snapshot?.permissionControls);

const getStoredAppUserByIdentity = (snapshot, identity) => {
  if (!identity) {
    return null;
  }

  const normalizedEmail = String(identity.email ?? "")
    .trim()
    .toLowerCase();
  const normalizedActorId = String(identity.actorId ?? "")
    .trim();

  return (
    (snapshot?.appUsers ?? []).find((user) => {
      const userEmail = String(user.email ?? "")
        .trim()
        .toLowerCase();
      const userActorId = String(user.actorId ?? user.staffId ?? "")
        .trim();

      return (
        (normalizedEmail && userEmail === normalizedEmail) ||
        (normalizedActorId && userActorId === normalizedActorId)
      );
    }) ?? null
  );
};

const getModuleAccessStatus = (control) => {
  if (control?.active) {
    return {
      tone: "success",
      label: "Admin access active",
    };
  }

  if (control?.requestStatus === "pending") {
    return {
      tone: "warning",
      label: "Waiting for owner",
    };
  }

  if (control?.requestStatus === "approved") {
    return {
      tone: "info",
      label: "Waiting for manager grant",
    };
  }

  if (control?.requestStatus === "rejected") {
    return {
      tone: "danger",
      label: "Owner declined",
    };
  }

  return {
    tone: "navy",
    label: "Locked",
  };
};

const canEditModuleUpdates = (role, moduleKey, permissionControls, currentUserRecord = null) => {
  if (role === "Owner") {
    return true;
  }

  if (["Admin", "Manager"].includes(role)) {
    return Boolean(
      normalizeModuleViewAccess(
        currentUserRecord?.moduleAccess,
        currentUserRecord?.role ?? role,
      )?.[moduleKey],
    );
  }

  return false;
};

const getModuleAccessErrorMessage = (moduleKey) =>
  `This change is locked until the owner enables ${MODULE_EDIT_ACCESS[moduleKey]?.label?.toLowerCase() ?? moduleKey} access in Settings.`;

const normalizeRole = (value) =>
  ROLES.find((role) => role.toLowerCase() === String(value ?? "").trim().toLowerCase()) ?? null;

const isViewerRole = (value) => normalizeRole(value) === VIEWER_ROLE;

const createDefaultModuleViewAccess = (role) => {
  const normalizedRole = normalizeRole(role) ?? "Driver";

  if (normalizedRole === "Owner") {
    return Object.fromEntries(Object.keys(MODULE_VIEW_ACCESS).map((moduleKey) => [moduleKey, true]));
  }

  if (normalizedRole === VIEWER_ROLE) {
    return Object.fromEntries(
      Object.keys(MODULE_VIEW_ACCESS).map((moduleKey) => [moduleKey, moduleKey === "overview"]),
    );
  }

  if (["Admin", "Manager"].includes(normalizedRole)) {
    return Object.fromEntries(
      Object.keys(MODULE_VIEW_ACCESS).map((moduleKey) => [
        moduleKey,
        moduleKey === "overview" || moduleKey === "settings",
      ]),
    );
  }

  return Object.fromEntries(
    Object.entries(MODULE_VIEW_ACCESS).map(([moduleKey, moduleConfig]) => [
      moduleKey,
      moduleKey === "overview"
        ? true
        : moduleKey === "settings"
          ? false
          : moduleConfig.roles.includes(normalizedRole),
    ]),
  );
};

const normalizeModuleViewAccess = (value = {}, role) => {
  const normalizedRole = normalizeRole(role) ?? "Driver";
  const defaults = createDefaultModuleViewAccess(normalizedRole);

  return Object.fromEntries(
    Object.keys(MODULE_VIEW_ACCESS).map((moduleKey) => {
      if (moduleKey === "overview") {
        return [moduleKey, true];
      }

      if (moduleKey === "settings") {
        return [moduleKey, MODULE_VIEW_ACCESS[moduleKey].roles.includes(normalizedRole)];
      }

      const allowedByRole = MODULE_VIEW_ACCESS[moduleKey].roles.includes(normalizedRole);
      return [moduleKey, allowedByRole ? Boolean(value?.[moduleKey] ?? defaults[moduleKey]) : false];
    }),
  );
};

const sanitizeEmailLocalPart = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

const normalizeEmailAddress = (value) => String(value ?? "").trim().toLowerCase();
const isValidEmailAddress = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmailAddress(value));
const buildRouteReferenceId = (route) => {
  const normalizedRoute = sanitizeEmailLocalPart(route)?.replace(/\.+/g, "-");
  return normalizedRoute ? `route-${normalizedRoute}` : null;
};
const normalizeVehicleCapabilityHooks = (vehicle = {}) => {
  const seatCapacity = Number(vehicle.seatCapacity ?? vehicle.seat_capacity ?? 15);

  return {
    ...vehicle,
    canDoRouteService: Boolean(
      vehicle.canDoRouteService ?? vehicle.can_do_route_service ?? true,
    ),
    canDoSpecialTrips: Boolean(
      vehicle.canDoSpecialTrips ?? vehicle.can_do_special_trips ?? false,
    ),
    canDoContracts: Boolean(vehicle.canDoContracts ?? vehicle.can_do_contracts ?? false),
    seatCapacity: Number.isFinite(seatCapacity) && seatCapacity > 0 ? seatCapacity : 15,
    currentRouteId:
      vehicle.currentRouteId ??
      vehicle.current_route_id ??
      buildRouteReferenceId(vehicle.route),
  };
};

const createGeneratedLocalEmail = (name, usedEmails) => {
  const base = sanitizeEmailLocalPart(name) || "user";
  let nextLocalPart = base;
  let sequence = 2;

  while (usedEmails.has(`${nextLocalPart}@taxiflow.local`)) {
    nextLocalPart = `${base}.${sequence}`;
    sequence += 1;
  }

  return `${nextLocalPart}@taxiflow.local`;
};

const sortAppUsers = (users) => {
  const roleOrder = new Map(ROLES.map((role, index) => [role, index]));

  return [...users].sort((left, right) => {
    const roleDelta = (roleOrder.get(left.role) ?? 99) - (roleOrder.get(right.role) ?? 99);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    return String(left.name ?? left.email).localeCompare(String(right.name ?? right.email));
  });
};

const normalizeAppUser = (user = {}) => {
  const role = normalizeRole(user.role) ?? "Driver";
  const email = String(user.email ?? "")
    .trim()
    .toLowerCase();
  const actorId =
    String(user.actorId ?? user.staffId ?? email ?? "")
      .trim() || createRecordId("usr");
  const staffId =
    user.staffId != null && String(user.staffId).trim()
      ? String(user.staffId).trim()
      : role === "Driver"
        ? actorId
        : null;

  return {
    id: user.id ?? email ?? actorId,
    email,
    name: String(user.name ?? email ?? actorId).trim() || email || actorId,
    role,
    actorId,
    staffId,
    accessPassword: String(user.accessPassword ?? user.localPassword ?? user.password ?? "").trim() || null,
    moduleAccess: normalizeModuleViewAccess(user.moduleAccess, role),
    createdAt: user.createdAt ?? null,
    createdBy: user.createdBy ?? null,
    createdByRole: user.createdByRole ?? null,
    updatedAt: user.updatedAt ?? null,
    updatedBy: user.updatedBy ?? null,
    updatedByRole: user.updatedByRole ?? null,
  };
};

const buildDefaultAppUsers = (snapshot) => {
  const users = [];
  const storedUsers = Array.isArray(snapshot?.appUsers) ? snapshot.appUsers.map(normalizeAppUser) : [];
  const usedEmails = new Set(storedUsers.map((user) => normalizeEmailAddress(user.email)).filter(Boolean));
  const accountByActorId = new Map(
    Object.entries(AUTH_ACCOUNT_DIRECTORY).map(([email, account]) => [account.actorId, { email, ...account }]),
  );
  const storedUsersByStaffId = new Map(
    storedUsers.flatMap((user) => {
      const keys = [user.staffId, user.actorId]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);

      return keys.map((key) => [key, user]);
    }),
  );

  const pushUser = (user) => {
    const normalizedUser = normalizeAppUser(user);

    if (!normalizedUser.email || usedEmails.has(normalizedUser.email)) {
      return;
    }

    usedEmails.add(normalizedUser.email);
    users.push(normalizedUser);
  };

  pushUser({
    email: "owner@taxiflow.local",
    name: AUTH_ACCOUNT_DIRECTORY["owner@taxiflow.local"].name,
    role: "Owner",
    actorId: "owner-session",
  });
  pushUser({
    email: "admin@taxiflow.local",
    name: AUTH_ACCOUNT_DIRECTORY["admin@taxiflow.local"].name,
    role: "Admin",
    actorId: "admin-session",
  });

  (snapshot?.drivers ?? []).forEach((driver) => {
    const mappedAccount = accountByActorId.get(driver.staffId);
    const storedUser = storedUsersByStaffId.get(String(driver.staffId ?? "").trim()) ?? null;
    const defaultDriverEmail =
      DEFAULT_DRIVER_ACCOUNT_EMAIL_BY_STAFF_ID[String(driver.staffId ?? "").trim()] ?? null;
    const email =
      normalizeEmailAddress(driver.email) ||
      normalizeEmailAddress(storedUser?.email) ||
      mappedAccount?.email ||
      (defaultDriverEmail && !usedEmails.has(defaultDriverEmail) ? defaultDriverEmail : null) ||
      createGeneratedLocalEmail(driver.name, usedEmails);

    pushUser({
      email,
      name: storedUser?.name ?? driver.name,
      role: normalizeRole(driver.role) ?? mappedAccount?.role ?? storedUser?.role ?? "Driver",
      actorId: storedUser?.actorId ?? mappedAccount?.actorId ?? driver.staffId,
      staffId: driver.staffId,
      accessPassword: driver.accessPassword ?? storedUser?.accessPassword ?? null,
      createdAt: driver.createdAt ?? storedUser?.createdAt ?? null,
      createdBy: driver.createdBy ?? storedUser?.createdBy ?? null,
      createdByRole: driver.createdByRole ?? storedUser?.createdByRole ?? null,
    });
  });

  if (!users.some((user) => user.email === "manager@taxiflow.local")) {
    pushUser({
      email: "manager@taxiflow.local",
      name: AUTH_ACCOUNT_DIRECTORY["manager@taxiflow.local"].name,
      role: "Manager",
      actorId: "mgr-01",
      staffId: "mgr-01",
    });
  }

  if (!users.some((user) => user.email === "viewer@taxiflow.local")) {
    pushUser({
      email: "viewer@taxiflow.local",
      name: AUTH_ACCOUNT_DIRECTORY["viewer@taxiflow.local"].name,
      role: VIEWER_ROLE,
      actorId: "viewer-session",
    });
  }

  return sortAppUsers(users);
};

const getAppUsers = (snapshot) => {
  const defaultUsers = buildDefaultAppUsers(snapshot);
  const storedUsers = Array.isArray(snapshot?.appUsers) ? snapshot.appUsers.map(normalizeAppUser) : [];
  const usersByEmail = new Map(defaultUsers.map((user) => [user.email, user]));
  const usersByActorId = new Map(defaultUsers.map((user) => [user.actorId, user]));

  storedUsers.forEach((user) => {
    const fallbackUser = usersByEmail.get(user.email) ?? usersByActorId.get(user.actorId);
    const nextUser = fallbackUser
      ? normalizeAppUser({
          ...fallbackUser,
          ...user,
          moduleAccess: user.moduleAccess ?? fallbackUser.moduleAccess,
        })
      : user;

    usersByEmail.set(nextUser.email, nextUser);
    usersByActorId.set(nextUser.actorId, nextUser);
  });

  return sortAppUsers(Array.from(usersByEmail.values()));
};

const getAppUserByEmail = (snapshot, email) =>
  getAppUsers(snapshot).find(
    (user) => user.email === String(email ?? "").trim().toLowerCase(),
  ) ?? null;

const canAssignRoleToUser = (role, user) => {
  const normalizedRole = normalizeRole(role);

  if (!normalizedRole) {
    return false;
  }

  if (normalizedRole !== "Driver") {
    return true;
  }

  return Boolean(user?.staffId);
};

const canAssignModuleToRole = (role, moduleKey) =>
  SETTINGS_ASSIGNABLE_MODULES.includes(moduleKey) &&
  Boolean(MODULE_VIEW_ACCESS[moduleKey]?.roles.includes(normalizeRole(role) ?? ""));

const createUserAccessDraft = (user) => {
  const role = normalizeRole(user?.role) ?? "Driver";

  return {
    id: user?.id ?? null,
    email: user?.email ?? "",
    name: user?.name ?? "",
    role,
    actorId: user?.actorId ?? "",
    staffId: user?.staffId ?? null,
    moduleAccess: normalizeModuleViewAccess(user?.moduleAccess, role),
    nextAccessPassword: "",
  };
};

const resolveAuthIdentity = (user, snapshot) => {
  if (!user) {
    return null;
  }

  const email = String(user.email ?? "")
    .trim()
    .toLowerCase();
  const snapshotAccount = getAppUserByEmail(snapshot, email);
  const mappedAccount = AUTH_ACCOUNT_DIRECTORY[email];
  const metadataRole = normalizeRole(user.app_metadata?.role ?? user.user_metadata?.role);
  const metadataStaffId =
    user.app_metadata?.staffId ??
    user.app_metadata?.staff_id ??
    user.user_metadata?.staffId ??
    user.user_metadata?.staff_id ??
    null;

  if (snapshotAccount) {
    return {
      email,
      role: snapshotAccount.role,
      actorId: snapshotAccount.actorId,
      staffId: snapshotAccount.staffId,
      moduleAccess: snapshotAccount.moduleAccess,
      name: snapshotAccount.name,
    };
  }

  if (mappedAccount) {
    return {
      ...mappedAccount,
      email,
    };
  }

  if (!metadataRole) {
    return null;
  }

  return {
    email,
    role: metadataRole,
    actorId:
      metadataRole === "Driver"
        ? metadataStaffId ?? "driver-terminal"
        : metadataStaffId ?? `${metadataRole.toLowerCase()}-session`,
    staffId: metadataStaffId ?? null,
    moduleAccess: normalizeModuleViewAccess({}, metadataRole),
  };
};

const getAuthSessionRole = (user) => {
  if (!user) {
    return null;
  }

  const email = normalizeEmailAddress(user.email);
  return normalizeRole(
    user.app_metadata?.role ??
      user.user_metadata?.role ??
      AUTH_ACCOUNT_DIRECTORY[email]?.role ??
      null,
  );
};

const createLocalAuthSession = (email, account = null) => ({
  user: {
    email,
    app_metadata: account
      ? {
          role: account.role,
          staffId: account.staffId ?? account.actorId,
          actorId: account.actorId,
        }
      : {},
    user_metadata: {},
  },
});

const readStoredLocalAuthSession = () => {
  try {
    const value = safeLocalStorageGet(LOCAL_AUTH_STORAGE_KEY);

    if (!value) {
      return null;
    }

    try {
      const parsedValue = JSON.parse(value);
      const email = normalizeEmailAddress(parsedValue?.email);

      if (!email) {
        return null;
      }

      return createLocalAuthSession(email, {
        role: normalizeRole(parsedValue?.role) ?? null,
        actorId: parsedValue?.actorId ?? null,
        staffId: parsedValue?.staffId ?? null,
      });
    } catch {
      const email = normalizeEmailAddress(value);
      return email ? createLocalAuthSession(email, AUTH_ACCOUNT_DIRECTORY[email] ?? null) : null;
    }
  } catch {
    return null;
  }
};

const persistLocalAuthSession = (email, account = null) => {
  try {
    safeLocalStorageSet(
      LOCAL_AUTH_STORAGE_KEY,
      JSON.stringify({
        email: normalizeEmailAddress(email),
        role: normalizeRole(account?.role) ?? null,
        actorId: account?.actorId ?? null,
        staffId: account?.staffId ?? null,
      }),
    );
  } catch {
    // Ignore storage failures and continue in-memory.
  }
};

const clearStoredLocalAuthSession = () => {
  try {
    safeLocalStorageRemove(LOCAL_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

const formatStamp = (value) =>
  value
    ? new Date(value).toLocaleString("en-ZA", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Pending";

const parseDateInputValue = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateInputValue = (value = new Date()) => {
  const date =
    parseDateInputValue(value) ??
    (value ? new Date(value) : null);

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatDateOnly = (value) => {
  const date =
    parseDateInputValue(value) ??
    (value ? new Date(value) : null);

  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-ZA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "No date";
};

const parseTimeInputValue = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? "").trim());

  if (!match) {
    return null;
  }

  const [, hour, minute] = match;
  const numericHour = Number(hour);
  const numericMinute = Number(minute);

  if (
    !Number.isInteger(numericHour) ||
    !Number.isInteger(numericMinute) ||
    numericHour < 0 ||
    numericHour > 23 ||
    numericMinute < 0 ||
    numericMinute > 59
  ) {
    return null;
  }

  return {
    hour: numericHour,
    minute: numericMinute,
  };
};

const toTimeInputValue = (value = new Date()) => {
  const parsedTime = parseTimeInputValue(value);

  if (parsedTime) {
    return `${String(parsedTime.hour).padStart(2, "0")}:${String(parsedTime.minute).padStart(2, "0")}`;
  }

  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const formatTimeOnly = (value) => {
  const parsedTime = parseTimeInputValue(value);

  if (parsedTime) {
    return `${String(parsedTime.hour).padStart(2, "0")}:${String(parsedTime.minute).padStart(2, "0")}`;
  }

  return formatTime(value);
};

const getTimeInputMinutes = (value) => {
  const parsedTime = parseTimeInputValue(value);

  return parsedTime ? parsedTime.hour * 60 + parsedTime.minute : null;
};

const normalizeOptionalText = (value) => {
  const normalized = String(value ?? "").trim();

  return normalized || null;
};

const normalizeOptionalNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
};

const getComputedKmValue = (startValue, endValue) => {
  return calculateKmComputed({
    odometerStart: startValue,
    odometerEnd: endValue,
  });
};

const getTripDurationMinutes = (timeInValue, timeOutValue) => {
  return calculateTripDurationMin({
    timeIn: timeInValue,
    timeOut: timeOutValue,
  });
};

const buildTripAnalyticsFields = (value = {}) => {
  const timeIn = normalizeOptionalText(value.timeIn ?? value.time_in);
  const timeOut = normalizeOptionalText(value.timeOut ?? value.time_out);
  const odometerStart = normalizeOptionalNumber(
    value.odometerStart ?? value.odometer_start ?? value.openingOdo ?? value.opening_odo,
  );
  const odometerEnd = normalizeOptionalNumber(
    value.odometerEnd ?? value.odometer_end ?? value.closingOdo ?? value.closing_odo,
  );

  return {
    timeIn,
    timeOut,
    odometerStart,
    odometerEnd,
    kmComputed:
      normalizeOptionalNumber(value.kmComputed ?? value.km_computed) ??
      getComputedKmValue(odometerStart, odometerEnd),
    tripDurationMin:
      normalizeOptionalNumber(value.tripDurationMin ?? value.trip_duration_min) ??
      getTripDurationMinutes(timeIn, timeOut),
  };
};

const buildDailyAnalyticsFields = (value = {}) => ({
  dayStartOdometer: normalizeOptionalNumber(
    value.dayStartOdometer ??
      value.day_start_odometer ??
      value.openingOdo ??
      value.opening_odo,
  ),
  dayEndOdometer: normalizeOptionalNumber(
    value.dayEndOdometer ??
      value.day_end_odometer ??
      value.closingOdo ??
      value.closing_odo,
  ),
  notes: normalizeOptionalText(value.notes),
});

const createTimestampFromDateInput = (dateValue, fallback = new Date().toISOString()) => {
  const parsedDate = parseDateInputValue(dateValue);

  if (!parsedDate) {
    return fallback;
  }

  const fallbackDate = fallback ? new Date(fallback) : new Date();
  const hasFallbackTime = !Number.isNaN(fallbackDate.getTime());
  const composed = new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    hasFallbackTime ? fallbackDate.getHours() : 12,
    hasFallbackTime ? fallbackDate.getMinutes() : 0,
    hasFallbackTime ? fallbackDate.getSeconds() : 0,
    0,
  );

  return composed.toISOString();
};

const createTimestampFromDateTimeInput = (
  dateValue,
  timeValue,
  fallback = new Date().toISOString(),
) => {
  const parsedDate = parseDateInputValue(dateValue);
  const parsedTime = parseTimeInputValue(timeValue);

  if (!parsedDate) {
    return fallback;
  }

  const fallbackDate = fallback ? new Date(fallback) : new Date();
  const hasFallbackTime = !Number.isNaN(fallbackDate.getTime());
  const hour = parsedTime?.hour ?? (hasFallbackTime ? fallbackDate.getHours() : 12);
  const minute = parsedTime?.minute ?? (hasFallbackTime ? fallbackDate.getMinutes() : 0);
  const second = hasFallbackTime ? fallbackDate.getSeconds() : 0;
  const composed = new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
    hour,
    minute,
    second,
    0,
  );

  return composed.toISOString();
};

const formatExpenseHeadline = (record) =>
  record?.description?.trim()
    ? `${record.category} / ${record.description.trim()}`
    : record?.category ?? "Expense";

const formatExpenseMeta = (record) => {
  const parts = [record?.vehicle ?? "General", formatDateOnly(record?.expenseDate ?? record?.timestamp)];

  if (record?.reference?.trim()) {
    parts.push(`Receipt ${record.reference.trim()}`);
  }

  return parts.filter(Boolean).join(" / ");
};

const getRouteStops = (routeValue) => {
  const route = String(routeValue ?? "").trim();

  if (!route) {
    return {
      fromLocation: "",
      toLocation: "",
    };
  }

  const toMatch = /^(.+?)\s+to\s+(.+)$/i.exec(route);
  if (toMatch) {
    return {
      fromLocation: toMatch[1].trim(),
      toLocation: toMatch[2].trim(),
    };
  }

  const slashParts = route.split("/").map((part) => part.trim()).filter(Boolean);
  if (slashParts.length === 2) {
    return {
      fromLocation: slashParts[0],
      toLocation: slashParts[1],
    };
  }

  return {
    fromLocation: route,
    toLocation: "",
  };
};

const getRoutePointLabels = (routeValue) => {
  const route = String(routeValue ?? "").trim();

  if (!route) {
    return [];
  }

  const arrowParts = route
    .split(/\s*(?:->|→|>|›)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (arrowParts.length > 1) {
    return arrowParts;
  }

  const toParts = route
    .split(/\s+to\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (toParts.length > 1) {
    return toParts;
  }

  const slashParts = route.split("/").map((part) => part.trim()).filter(Boolean);
  if (slashParts.length > 1) {
    return slashParts;
  }

  return [route];
};

const buildRoutePointReference = (routeId, pointLabel, sequence) =>
  `${routeId ?? "route"}-point-${buildRouteReferenceId(pointLabel)?.replace(/^route-/, "") ?? sequence}`;

const getDefaultRouteStopType = (index, total) => {
  if (total <= 1) {
    return "both";
  }

  if (index === 0) {
    return "pickup";
  }

  if (index === total - 1) {
    return "dropoff";
  }

  return "both";
};

const normalizeRoutePointRecord = (point, routeId, index, total) => {
  const label = String(
    point?.label ??
      point?.name ??
      point?.locationLabel ??
      point?.location_label ??
      point ??
      "",
  ).trim();

  if (!label) {
    return null;
  }

  const stopType = String(
    point?.stopType ?? point?.stop_type ?? getDefaultRouteStopType(index, total),
  )
    .trim()
    .toLowerCase();
  const safeStopType = ["pickup", "dropoff", "both", "checkpoint"].includes(stopType)
    ? stopType
    : getDefaultRouteStopType(index, total);

  return {
    id:
      String(point?.id ?? point?.pointId ?? point?.point_id ?? "").trim() ||
      buildRoutePointReference(routeId, label, index + 1),
    sequence:
      Number.isFinite(Number(point?.sequence ?? point?.order)) &&
      Number(point?.sequence ?? point?.order) > 0
        ? Number(point.sequence ?? point.order)
        : index + 1,
    label,
    stopType: safeStopType,
  };
};

const normalizeRoutePointRecords = (points, routeId, fallbackLabels = []) => {
  const sourcePoints =
    Array.isArray(points) && points.length > 0 ? points : fallbackLabels;
  const normalizedPoints = sourcePoints
    .map((point, index) =>
      normalizeRoutePointRecord(point, routeId, index, sourcePoints.length),
    )
    .filter(Boolean)
    .sort((left, right) => left.sequence - right.sequence)
    .map((point, index, items) => ({
      ...point,
      sequence: index + 1,
      stopType:
        ["pickup", "dropoff", "both", "checkpoint"].includes(point.stopType)
          ? point.stopType
          : getDefaultRouteStopType(index, items.length),
    }));

  return normalizedPoints;
};

const buildRouteCode = (value) => {
  const parts = String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part && part !== "TO" && part !== "AND");

  if (parts.length === 0) {
    return "";
  }

  const initials = parts.map((part) => part[0]).join("").slice(0, 8);
  return initials || parts.join("").slice(0, 8);
};

const normalizeRouteMasterRecord = (route = {}) => {
  const rawName = String(
    route.name ??
      route.routeName ??
      route.route_name ??
      route.route ??
      "",
  ).trim();
  const inferredStops = getRouteStops(rawName);
  const primaryOrigin = String(
    route.primaryOrigin ??
      route.primary_origin ??
      inferredStops.fromLocation ??
      "",
  ).trim();
  const primaryDestination = String(
    route.primaryDestination ??
      route.primary_destination ??
      inferredStops.toLocation ??
      "",
  ).trim();
  const name = rawName || [primaryOrigin, primaryDestination].filter(Boolean).join(" to ");

  if (!name) {
    return null;
  }

  const routeId =
    String(route.id ?? route.currentRouteId ?? route.current_route_id ?? "").trim() ||
    buildRouteReferenceId(name);
  const routePoints = normalizeRoutePointRecords(
    route.routePoints ?? route.route_points ?? route.points,
    routeId,
    getRoutePointLabels(name),
  );

  return {
    ...route,
    id: routeId,
    name,
    code:
      String(route.code ?? route.routeCode ?? route.route_code ?? buildRouteCode(name)).trim() ||
      buildRouteCode(name),
    type:
      String(route.type ?? route.routeType ?? route.route_type ?? "route_service").trim() ||
      "route_service",
    primaryOrigin,
    primaryDestination,
    routePoints,
    isActive: Boolean(route.isActive ?? route.is_active ?? true),
  };
};

const mergeRouteMasterRecord = (existing, incoming) => ({
  ...existing,
  name: existing.name || incoming.name,
  code: existing.code || incoming.code,
  type: existing.type || incoming.type,
  primaryOrigin: existing.primaryOrigin || incoming.primaryOrigin,
  primaryDestination: existing.primaryDestination || incoming.primaryDestination,
  routePoints:
    Array.isArray(existing.routePoints) && existing.routePoints.length > 0
      ? existing.routePoints
      : incoming.routePoints,
  isActive: existing.isActive ?? incoming.isActive ?? true,
});

const collectRouteMasterRecords = (source = {}) => {
  const routesById = new Map();
  const addRoute = (route) => {
    const normalizedRoute = normalizeRouteMasterRecord(route);

    if (!normalizedRoute?.id) {
      return;
    }

    const existingRoute = routesById.get(normalizedRoute.id);
    routesById.set(
      normalizedRoute.id,
      existingRoute
        ? mergeRouteMasterRecord(existingRoute, normalizedRoute)
        : normalizedRoute,
    );
  };

  (Array.isArray(source.routes) ? source.routes : []).forEach(addRoute);
  (Array.isArray(source.vehicles) ? source.vehicles : []).forEach((vehicle) =>
    addRoute({
      id:
        String(vehicle.currentRouteId ?? vehicle.current_route_id ?? "").trim() ||
        buildRouteReferenceId(vehicle.route),
      route: vehicle.route,
      isActive: vehicle.status !== "archived",
    }),
  );
  (Array.isArray(source.drivers) ? source.drivers : []).forEach((driver) =>
    addRoute({
      route: driver.route,
    }),
  );

  return Array.from(routesById.values()).sort((left, right) =>
    String(left.name ?? "").localeCompare(String(right.name ?? "")),
  );
};

const normalizeDriverRouteAssignments = (driver = {}, routes = []) => {
  const routeById = new Map(
    routes.map((route) => [String(route.id ?? "").trim(), route]),
  );
  const routeByName = new Map(
    routes.map((route) => [String(route.name ?? "").trim().toLowerCase(), route]),
  );
  const routeIds = [];
  const routeNames = [];

  const pushRoute = (route) => {
    const routeId = String(route?.id ?? buildRouteReferenceId(route?.name ?? "") ?? "").trim();
    const routeName = String(route?.name ?? route?.route ?? "").trim();

    if (!routeName) {
      return;
    }

    const dedupeKey = routeId || routeName.toLowerCase();
    if (routeIds.includes(dedupeKey) || routeNames.some((name) => name.toLowerCase() === routeName.toLowerCase())) {
      return;
    }

    routeIds.push(routeId || dedupeKey);
    routeNames.push(routeName);
  };

  [
    ...(Array.isArray(driver.routeIds) ? driver.routeIds : []),
    ...(Array.isArray(driver.route_ids) ? driver.route_ids : []),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .forEach((routeId) => {
      const matchedRoute = routeById.get(routeId);
      if (matchedRoute) {
        pushRoute(matchedRoute);
      }
    });

  const rawRouteNames = [
    ...(Array.isArray(driver.routeNames) ? driver.routeNames : []),
    ...(Array.isArray(driver.route_names) ? driver.route_names : []),
    ...(Array.isArray(driver.routes) ? driver.routes : []),
    driver.route,
  ]
    .map((value) =>
      typeof value === "string"
        ? value
        : value?.name ?? value?.route ?? value?.primaryRoute ?? "",
    )
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  rawRouteNames.forEach((routeName) => {
    pushRoute(
      routeByName.get(routeName.toLowerCase()) ?? {
        id: buildRouteReferenceId(routeName),
        name: routeName,
      },
    );
  });

  const primaryRoute = routeNames[0] ?? String(driver.primaryRoute ?? driver.route ?? "").trim();

  return {
    routeIds,
    routeNames,
    primaryRouteId: routeIds[0] ?? (String(driver.primaryRouteId ?? "").trim() || null),
    primaryRoute,
    routeSummary:
      routeNames.length > 0
        ? routeNames.join(" / ")
        : primaryRoute || "No route assigned",
  };
};

const getDriverRouteSummary = (driver) =>
  String(driver?.routeSummary ?? driver?.routeNames?.join(" / ") ?? driver?.route ?? "")
    .trim() || "No route assigned";

const resolveVehicleRouteSelection = (draft = {}, routes = []) => {
  const selectedRouteId = String(draft.currentRouteId ?? "").trim();
  const enteredRoute = String(draft.route ?? "").trim();
  const selectedRoute =
    routes.find((route) => String(route.id ?? "").trim() === selectedRouteId) ?? null;
  const matchingRoute =
    routes.find(
      (route) => String(route.name ?? "").trim().toLowerCase() === enteredRoute.toLowerCase(),
    ) ?? null;
  const resolvedRoute = enteredRoute || selectedRoute?.name || matchingRoute?.name || "";
  const resolvedRouteId =
    selectedRoute?.id ??
    matchingRoute?.id ??
    (resolvedRoute ? buildRouteReferenceId(resolvedRoute) : null);

  return {
    route: resolvedRoute,
    currentRouteId: resolvedRouteId,
  };
};

const normalizeExpensePresetName = (value) => String(value ?? "").trim();

const buildExpensePresetId = (expenseKind, category) =>
  `expense-preset-${expenseKind}-${sanitizeEmailLocalPart(category)?.replace(/\.+/g, "-") || "item"}`;

const normalizeExpensePresetRecord = (entry = {}, expenseKind = "asset") => {
  const name = normalizeExpensePresetName(entry.name ?? entry.category);

  if (!name) {
    return null;
  }

  const descriptions = Array.from(
    new Set(
      [
        ...(Array.isArray(entry.descriptions) ? entry.descriptions : []),
        ...(Array.isArray(entry.descriptionOptions) ? entry.descriptionOptions : []),
        entry.description,
      ]
        .map((value) => normalizeExpensePresetName(value))
        .filter(Boolean),
    ),
  );

  return {
    id:
      String(entry.id ?? entry.presetId ?? "").trim() ||
      buildExpensePresetId(expenseKind, name),
    name,
    descriptions,
  };
};

const mergeExpensePresetRecord = (existing, incoming) => ({
  ...existing,
  ...incoming,
  descriptions: Array.from(
    new Set([...(existing?.descriptions ?? []), ...(incoming?.descriptions ?? [])]),
  ),
});

const normalizeExpensePresetCatalog = (catalog = {}) => {
  const normalizeKind = (expenseKind) => {
    const presetsByName = new Map();
    const sourceItems = [
      ...(DEFAULT_EXPENSE_PRESET_CATALOG[expenseKind] ?? []),
      ...(Array.isArray(catalog?.[expenseKind]) ? catalog[expenseKind] : []),
    ];

    sourceItems.forEach((entry) => {
      const normalized = normalizeExpensePresetRecord(entry, expenseKind);

      if (!normalized || normalized.name.toLowerCase() === EXPENSE_OTHER_CATEGORY.toLowerCase()) {
        return;
      }

      const key = normalized.name.toLowerCase();
      presetsByName.set(
        key,
        presetsByName.has(key)
          ? mergeExpensePresetRecord(presetsByName.get(key), normalized)
          : normalized,
      );
    });

    return Array.from(presetsByName.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  };

  return {
    asset: normalizeKind("asset"),
    operational: normalizeKind("operational"),
  };
};

const collectExpensePresetCatalog = (finance = {}, transactions = []) => {
  const catalog = normalizeExpensePresetCatalog(finance.expenseCatalog);

  transactions
    .filter((record) => record.type === "expense")
    .forEach((record) => {
      const expenseKind = record.expenseKind === "operational" ? "operational" : "asset";
      const category = normalizeExpensePresetName(record.category);
      const description = normalizeExpensePresetName(record.description);

      if (!category || category.toLowerCase() === EXPENSE_OTHER_CATEGORY.toLowerCase()) {
        return;
      }

      const currentItems = catalog[expenseKind] ?? [];
      const existing = currentItems.find(
        (entry) => entry.name.toLowerCase() === category.toLowerCase(),
      );
      const nextEntry = normalizeExpensePresetRecord(
        {
          ...existing,
          name: category,
          descriptions: [...(existing?.descriptions ?? []), description],
        },
        expenseKind,
      );

      catalog[expenseKind] = normalizeExpensePresetCatalog({
        ...catalog,
        [expenseKind]: existing
          ? currentItems.map((entry) =>
              entry.name.toLowerCase() === category.toLowerCase() ? nextEntry : entry,
            )
          : [...currentItems, nextEntry],
      })[expenseKind];
    });

  return catalog;
};

const getExpenseCatalogEntries = (expenseCatalog, expenseKind) =>
  Array.isArray(expenseCatalog?.[expenseKind]) ? expenseCatalog[expenseKind] : [];

const getExpenseCategoryOptions = (expenseCatalog, expenseKind, currentValue = "") =>
  Array.from(
    new Set(
      [
        ...getExpenseCatalogEntries(expenseCatalog, expenseKind).map((entry) => entry.name),
        normalizeExpensePresetName(currentValue),
        EXPENSE_OTHER_CATEGORY,
      ].filter(Boolean),
    ),
  );

const getExpenseDescriptionOptions = (expenseCatalog, expenseKind, category) =>
  getExpenseCatalogEntries(expenseCatalog, expenseKind).find(
    (entry) => entry.name.toLowerCase() === normalizeExpensePresetName(category).toLowerCase(),
  )?.descriptions ?? [];

const getExpenseDescriptionPresetValue = (
  expenseCatalog,
  expenseKind,
  category,
  description,
) => {
  if (normalizeExpensePresetName(category) === EXPENSE_OTHER_CATEGORY) {
    return EXPENSE_CUSTOM_DESCRIPTION_VALUE;
  }

  const descriptionOptions = getExpenseDescriptionOptions(expenseCatalog, expenseKind, category);
  const normalizedDescription = normalizeExpensePresetName(description);

  return descriptionOptions.includes(normalizedDescription)
    ? normalizedDescription
    : EXPENSE_CUSTOM_DESCRIPTION_VALUE;
};

const syncExpenseDraftCategory = (draft, expenseCatalog, nextCategory) => {
  const category = normalizeExpensePresetName(nextCategory);

  if (category === EXPENSE_OTHER_CATEGORY) {
    return {
      ...draft,
      category,
      description: "",
      descriptionPreset: EXPENSE_CUSTOM_DESCRIPTION_VALUE,
    };
  }

  const descriptionOptions = getExpenseDescriptionOptions(
    expenseCatalog,
    draft.expenseKind,
    category,
  );
  const matchingDescription = descriptionOptions.find(
    (item) => item === normalizeExpensePresetName(draft.description),
  );
  const nextDescription = matchingDescription ?? descriptionOptions[0] ?? "";

  return {
    ...draft,
    category,
    description: nextDescription,
    descriptionPreset: nextDescription || EXPENSE_CUSTOM_DESCRIPTION_VALUE,
  };
};

const syncExpenseDraftDescriptionPreset = (draft, nextPreset) =>
  nextPreset === EXPENSE_CUSTOM_DESCRIPTION_VALUE
    ? {
        ...draft,
        descriptionPreset: EXPENSE_CUSTOM_DESCRIPTION_VALUE,
        description: "",
      }
    : {
        ...draft,
        descriptionPreset: nextPreset,
        description: nextPreset,
      };

const createExpensePresetDraft = (expenseKind = "asset") => ({
  expenseKind,
  category: "",
  description: "",
});

const createDailyTripLogEntry = (routeValue, entry = {}) => {
  const routeStops = getRouteStops(routeValue);

  return {
    id: entry.id ?? createRecordId("trip-leg"),
    fromLocation: entry.fromLocation ?? routeStops.fromLocation,
    toLocation: entry.toLocation ?? routeStops.toLocation,
    departingFromPoint:
      entry.departingFromPoint ??
      entry.departing_from_point ??
      entry.fromLocation ??
      routeStops.fromLocation,
    goingToPoint:
      entry.goingToPoint ??
      entry.going_to_point ??
      entry.toLocation ??
      routeStops.toLocation,
    passengerCount:
      entry.passengerCount != null && entry.passengerCount !== ""
        ? String(entry.passengerCount)
        : "",
    amountCollected:
      entry.amountCollected != null && entry.amountCollected !== ""
        ? String(entry.amountCollected)
        : "",
    ...buildTripAnalyticsFields(entry),
  };
};

const createDailyTripLogbook = (routeValue, entries = []) =>
  Array.isArray(entries) && entries.length > 0
    ? entries.map((entry) => createDailyTripLogEntry(routeValue, entry))
    : [createDailyTripLogEntry(routeValue)];

const getDailyTripLogbookTotals = (entries = []) => {
  const analytics = calculateDailyAnalytics({
    trips: Array.isArray(entries) ? entries : [],
  });

  return {
    tripCount: analytics.totalTrips,
    totalPassengers: analytics.totalPassengers,
    totalAmount: analytics.totalTakingsExpected,
  };
};

const getDailyTripTripCount = (record) => {
  if (Number.isFinite(Number(record?.tripCount))) {
    return Number(record.tripCount);
  }

  return Array.isArray(record?.tripLogbook) ? record.tripLogbook.length : 0;
};

const getDailyTripPassengerTotal = (record) => {
  if (Number.isFinite(Number(record?.totalPassengers))) {
    return Number(record.totalPassengers);
  }

  return getDailyTripLogbookTotals(record?.tripLogbook).totalPassengers;
};

const syncStandardDraftTripLogbook = (draft) => {
  const nextTripLogbook = Array.isArray(draft?.tripLogbook) ? draft.tripLogbook : [];
  const totals = getDailyTripLogbookTotals(nextTripLogbook);

  return {
    ...draft,
    tripLogbook: nextTripLogbook,
    amountClaimed: String(totals.totalAmount),
  };
};

const buildStandardTripLogbookDraft = (
  routeValue,
  entries = [],
  fallbackAmount = "",
  fallbackPassengers = "",
) => {
  if (Array.isArray(entries) && entries.length > 0) {
    return createDailyTripLogbook(routeValue, entries);
  }

  return createDailyTripLogbook(routeValue, [
    {
      passengerCount:
        fallbackPassengers != null && fallbackPassengers !== "" ? String(fallbackPassengers) : "",
      amountCollected:
        fallbackAmount != null && fallbackAmount !== "" ? String(fallbackAmount) : "",
    },
  ]);
};

const getBusinessKmValue = (record) => {
  const businessKm = Number(record?.businessKm ?? calculateKmComputed(record));

  return Number.isFinite(businessKm) && businessKm > 0 ? businessKm : 0;
};

const formatTripRoute = (record) => {
  const fromLocation = record?.fromLocation?.trim();
  const toLocation = record?.toLocation?.trim();

  if (fromLocation && toLocation) {
    return `${fromLocation} to ${toLocation}`;
  }

  return record?.route ?? record?.assignedRoute ?? "Business trip";
};

const formatTripLogMeta = (record) => {
  const parts = [formatDateOnly(record?.tripDate ?? record?.timestamp)];
  const businessKm = Number(record?.businessKm ?? getBusinessKmValue(record));

  if (businessKm > 0) {
    parts.push(`${businessKm.toLocaleString()} km`);
  }

  if (record?.travelReason?.trim()) {
    parts.push(record.travelReason.trim());
  }

  if (record?.fuelOilCost != null) {
    parts.push(`Fuel ${formatMoney(record.fuelOilCost)}`);
  }

  if (record?.repairMaintenanceCost != null) {
    parts.push(`Repairs ${formatMoney(record.repairMaintenanceCost)}`);
  }

  return parts.filter(Boolean).join(" / ");
};

const formatDailyTripMeta = (record) =>
  [
    "Daily trip",
    formatDateOnly(record?.tripDate ?? record?.timestamp),
    record?.timeIn ? `In ${formatTimeOnly(record.timeIn)}` : null,
    record?.timeOut ? `Out ${formatTimeOnly(record.timeOut)}` : null,
    getDailyTripTripCount(record) > 0
      ? `${getDailyTripTripCount(record)} ${getDailyTripTripCount(record) === 1 ? "trip" : "trips"}`
      : null,
    Number.isFinite(getDailyTripPassengerTotal(record))
      ? `${getDailyTripPassengerTotal(record).toLocaleString()} passengers`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");

const hasMetricValue = (value) => Number.isFinite(Number(value));

const formatOptionalMetric = (
  value,
  {
    suffix = "",
    maximumFractionDigits = 2,
  } = {},
) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "—";
  }

  return `${numeric.toLocaleString(undefined, { maximumFractionDigits })}${suffix}`;
};

const formatOptionalMoney = (value) => {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? formatMoney(numeric) : "—";
};

const formatTransactionStatus = (status) =>
  (
    {
      pending: "Waiting hand-in",
      counted: "Waiting manager check",
      verified: "Manager checked",
      banked: "Deposited",
    }[status]
  ) ?? status;

const formatShortcutLabel = (shortcut) =>
  (
    {
      "Log shift takings": "Add daily earnings",
      "Log daily expense": "Add daily expense",
      "Capture special trip": "Add extra trip",
      "Report a defect": "Report a problem",
      "View vehicle status": "View vehicle details",
    }[shortcut]
  ) ?? shortcut;

const createEmptyDriverDayCashSummary = (workDate = toDateInputValue()) => ({
  workDate,
  workDateLabel: formatDateOnly(workDate),
  driverStaffId: null,
  driverName: null,
  entryCount: 0,
  incomeCount: 0,
  expenseCount: 0,
  totalIncome: 0,
  totalExpenses: 0,
  cashExpenses: 0,
  nonCashExpenses: 0,
  expectedCashIn: 0,
  netAfterExpenses: 0,
  entries: [],
  incomeRecords: [],
  expenseRecords: [],
  cashUpRecord: null,
});

const getFinanceRecordWorkDate = (record = {}) => {
  const candidate =
    record.type === "expense"
      ? String(record.expenseDate ?? "").trim()
      : String(record.tripDate ?? "").trim();

  return candidate || toDateInputValue(record.timestamp ?? new Date());
};

const getFinanceRecordDriverStaffId = (record = {}) => {
  const normalizedDriverStaffId = String(
    record.driverStaffId ??
      record.driver_staff_id ??
      (record.createdByRole === "Driver" ? record.createdBy : ""),
  ).trim();

  return normalizedDriverStaffId || null;
};

const getFinanceRecordDriverName = (record = {}) => {
  const normalizedDriverName = String(record.driverName ?? record.driver_name ?? "").trim();

  return normalizedDriverName || null;
};

const normalizeCashUpIdToken = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getDailyCashUpStableId = (entry = {}, fallback = "cashup") => {
  const explicitId = String(entry.id ?? "").trim();

  if (explicitId) {
    return explicitId;
  }

  const idParts = [
    normalizeCashUpIdToken(entry.driverStaffId ?? entry.driver_staff_id),
    normalizeCashUpIdToken(entry.workDate ?? entry.work_date),
    normalizeCashUpIdToken(entry.checkedAt ?? entry.updatedAt ?? entry.createdAt),
  ].filter(Boolean);

  return idParts.length > 0 ? `cashup-${idParts.join("-")}` : fallback;
};

const buildDriverCashLedgerEntry = (record = {}) => {
  const isIncome = record.type === "income";
  const amount = Number(
    isIncome ? record.amountClaimed ?? record.amount ?? 0 : record.amount ?? 0,
  );
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const cashDelta = isIncome ? safeAmount : record.cashExpense ? -safeAmount : 0;
  const amountLabel =
    safeAmount === 0
      ? formatMoney(0)
      : `${safeAmount > 0 && isIncome ? "+" : "-"}${formatMoney(Math.abs(safeAmount))}`;

  return {
    id: record.id ?? createRecordId("cash-entry"),
    record,
    entryType: isIncome ? "income" : "expense",
    title: isIncome
      ? record.incomeKind === "special"
        ? `Extra trip / ${formatTripRoute(record)}`
        : `Daily trip / ${record.vehicle ?? "Vehicle"}`
      : formatExpenseHeadline(record),
    subtitle: isIncome
      ? record.incomeKind === "special"
        ? formatTripLogMeta(record)
        : formatDailyTripMeta(record)
      : formatExpenseMeta(record),
    amount: isIncome ? safeAmount : -safeAmount,
    amountLabel,
    cashDelta,
    cashDeltaLabel:
      cashDelta === 0
        ? "No cash change"
        : `${cashDelta > 0 ? "+" : "-"}${formatMoney(Math.abs(cashDelta))} cash`,
    statusLabel: formatTransactionStatus(record.status ?? "pending"),
    ledgerLabel: isIncome
      ? "Income"
      : record.cashExpense
        ? "Cash expense"
        : "Expense",
    tone: isIncome ? "success" : record.cashExpense ? "warning" : "info",
    timestampLabel: formatStamp(record.timestamp),
  };
};

const resolveDriverWorkDate = (source, driverStaffId) => {
  if (!driverStaffId) {
    return toDateInputValue();
  }

  const relevantTransactions = [...(source?.financeTransactions ?? [])]
    .filter(
      (record) =>
        ["income", "expense"].includes(record?.type) &&
        getFinanceRecordDriverStaffId(record) === driverStaffId &&
        record.status !== "banked",
    )
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const latestCashUp =
    [...(source?.dailyCashUps ?? [])]
      .filter((entry) => String(entry.driverStaffId ?? "").trim() === driverStaffId)
      .sort(
        (left, right) =>
          new Date(right.checkedAt ?? right.updatedAt ?? right.createdAt ?? 0) -
          new Date(left.checkedAt ?? left.updatedAt ?? left.createdAt ?? 0),
      )[0] ?? null;
  const latestTransactionWorkDate = relevantTransactions[0]
    ? getFinanceRecordWorkDate(relevantTransactions[0])
    : null;
  const latestCashUpWorkDate = String(latestCashUp?.workDate ?? "").trim();

  if (latestTransactionWorkDate) {
    return latestTransactionWorkDate;
  }

  if (latestCashUpWorkDate) {
    return latestCashUpWorkDate;
  }

  return toDateInputValue();
};

const buildDriverDayCashSummary = (source, { driverStaffId, workDate = null } = {}) => {
  const resolvedWorkDate = workDate ?? resolveDriverWorkDate(source, driverStaffId);

  if (!driverStaffId) {
    return createEmptyDriverDayCashSummary(resolvedWorkDate);
  }

  const dayTransactions = [...(source?.financeTransactions ?? [])]
    .filter(
      (record) =>
        ["income", "expense"].includes(record?.type) &&
        getFinanceRecordDriverStaffId(record) === driverStaffId &&
        getFinanceRecordWorkDate(record) === resolvedWorkDate,
    )
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const incomeRecords = dayTransactions.filter((record) => record.type === "income");
  const expenseRecords = dayTransactions.filter((record) => record.type === "expense");
  const totalIncome = sumBy(incomeRecords, (record) => record.amountClaimed ?? record.amount);
  const totalExpenses = sumBy(expenseRecords, (record) => record.amount);
  const cashExpenses = sumBy(
    expenseRecords.filter((record) => record.cashExpense),
    (record) => record.amount,
  );
  const cashUpRecord =
    [...(source?.dailyCashUps ?? [])]
      .filter(
        (entry) =>
          String(entry.driverStaffId ?? "").trim() === driverStaffId &&
          String(entry.workDate ?? "").trim() === resolvedWorkDate,
      )
      .sort(
        (left, right) =>
          new Date(right.checkedAt ?? right.updatedAt ?? right.createdAt ?? 0) -
          new Date(left.checkedAt ?? left.updatedAt ?? left.createdAt ?? 0),
      )[0] ?? null;
  const resolvedDriverName =
    getFinanceRecordDriverName(dayTransactions[0]) ||
    String(cashUpRecord?.driverName ?? "").trim() ||
    null;

  return {
    workDate: resolvedWorkDate,
    workDateLabel: formatDateOnly(resolvedWorkDate),
    driverStaffId,
    driverName: resolvedDriverName,
    entryCount: dayTransactions.length,
    incomeCount: incomeRecords.length,
    expenseCount: expenseRecords.length,
    totalIncome,
    totalExpenses,
    cashExpenses,
    nonCashExpenses: totalExpenses - cashExpenses,
    expectedCashIn: totalIncome - cashExpenses,
    netAfterExpenses: totalIncome - totalExpenses,
    entries: dayTransactions.map((record) => buildDriverCashLedgerEntry(record)),
    incomeRecords,
    expenseRecords,
    cashUpRecord,
  };
};

const normalizeCashUpWorkflowStatus = (status) => {
  const normalized = String(status ?? "").trim().toLowerCase();

  return ["pending", "counted", "verified", "banked"].includes(normalized)
    ? normalized
    : null;
};

const getFinanceRecordCashUpCoverageKey = (record = {}) => {
  const driverStaffId = String(getFinanceRecordDriverStaffId(record) ?? "").trim();
  const workDate = String(getFinanceRecordWorkDate(record) ?? "").trim();

  return driverStaffId && workDate ? `${driverStaffId}::${workDate}` : null;
};

const getCashUpCoverageKey = (entry = {}) => {
  const driverStaffId = String(entry.driverStaffId ?? "").trim();
  const workDate = String(entry.workDate ?? "").trim();

  return driverStaffId && workDate ? `${driverStaffId}::${workDate}` : null;
};

const buildCashUpTransactionIds = (summary) => [
  ...(summary?.incomeRecords ?? []).map((record) => record.id),
  ...(summary?.expenseRecords ?? []).map((record) => record.id),
].filter(Boolean);

const syncTransactionsForDriverCashUp = (transactions = [], summary, updater) => {
  const linkedRecordIds = new Set(buildCashUpTransactionIds(summary));

  if (linkedRecordIds.size === 0) {
    return transactions;
  }

  return transactions.map((record) =>
    linkedRecordIds.has(record.id) ? updater(record) : record,
  );
};

const isDriverCreatedFinanceRecord = (record = {}) => record.createdByRole === "Driver";

const buildDriverCashUpAnalytics = (summary) => {
  const standardIncomeRecords = (summary?.incomeRecords ?? [])
    .filter((record) => record.incomeKind === "standard")
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
  const tripEntries = standardIncomeRecords.flatMap((record) =>
    Array.isArray(record.tripLogbook) ? record.tripLogbook : [],
  );
  const firstStandardRecord = standardIncomeRecords[0] ?? null;
  const lastStandardRecord = standardIncomeRecords[standardIncomeRecords.length - 1] ?? null;

  return calculateDailyAnalytics({
    trips: tripEntries,
    expenses: summary?.expenseRecords ?? [],
    totalTakingsExpected: summary?.totalIncome ?? 0,
    dayStartOdometer: firstStandardRecord?.openingOdo ?? null,
    dayEndOdometer: lastStandardRecord?.closingOdo ?? null,
  });
};

const getDriverCashUpGapKm = (source, summary) =>
  sumBy(
    (summary?.incomeRecords ?? []).filter((record) => record.incomeKind === "standard"),
    (record) => {
      const expectedOpening = getExpectedOpeningOdo(
        source?.financeTransactions ?? [],
        source?.vehicles ?? [],
        record.vehicleId,
        record.id,
      );

      return Math.abs(Number(record.openingOdo ?? 0) - Number(expectedOpening ?? 0));
    },
  );

const getDriverCashUpWorkflowStatus = (entry, summary) => {
  const explicitStatus = normalizeCashUpWorkflowStatus(entry?.status);
  const linkedStatuses = [
    ...(summary?.incomeRecords ?? []).map((record) =>
      normalizeCashUpWorkflowStatus(record.status),
    ),
    ...(summary?.expenseRecords ?? []).map((record) =>
      normalizeCashUpWorkflowStatus(record.status),
    ),
  ].filter(Boolean);

  if (linkedStatuses.length === 0) {
    return explicitStatus ?? "pending";
  }

  if (linkedStatuses.every((status) => status === "banked")) {
    return "banked";
  }
  if (linkedStatuses.some((status) => status === "pending")) {
    return "pending";
  }
  if (linkedStatuses.some((status) => status === "counted")) {
    return "counted";
  }
  if (linkedStatuses.some((status) => status === "verified")) {
    return "verified";
  }

  return explicitStatus ?? "pending";
};

const getDriverCashUpWorkflow = (summary, workflowStatus) => {
  if (!summary || summary.entryCount === 0) {
    return {
      label: "No activity",
      tone: "info",
    };
  }

  if (summary.incomeCount === 0) {
    return {
      label: "Heads up only",
      tone: "info",
    };
  }

  if (workflowStatus === "banked") {
    return {
      label: "Deposited",
      tone: "navy",
    };
  }

  if (workflowStatus === "pending") {
    return {
      label: "Waiting for admin hand-in",
      tone: "warning",
    };
  }

  if (workflowStatus === "counted") {
    return {
      label: "Waiting for manager check",
      tone: "info",
    };
  }

  if (workflowStatus === "verified") {
    return {
      label: "Manager checked",
      tone: "success",
    };
  }

  return {
    label: "Heads up sent",
    tone: "info",
  };
};

const buildDriverCashUpQueueEntry = (source, entry = {}) => {
  const summary = buildDriverDayCashSummary(source, {
    driverStaffId: String(entry.driverStaffId ?? "").trim(),
    workDate: String(entry.workDate ?? "").trim() || null,
  });
  const workflowStatus = getDriverCashUpWorkflowStatus(entry, summary);
  const workflow = getDriverCashUpWorkflow(summary, workflowStatus);
  const counted = Number(entry.actualCashReceived);
  const safeCounted = Number.isFinite(counted) ? counted : 0;
  const gapKm = getDriverCashUpGapKm(source, summary);
  const shortage = Number.isFinite(counted)
    ? Math.max(Number(summary.expectedCashIn ?? 0) - counted, 0)
    : 0;

  return {
    ...entry,
    ...summary,
    id: getDailyCashUpStableId(entry),
    queueType: "cash-up",
    driver: summary.driverName || String(entry.driverName ?? "").trim() || "Driver",
    driverName: summary.driverName || String(entry.driverName ?? "").trim() || "Driver",
    vehicle: String(entry.vehicle ?? "").trim() || null,
    route: String(entry.route ?? "").trim() || null,
    claimed: Number(summary.expectedCashIn ?? 0),
    counted: safeCounted,
    actualCashReceived: Number.isFinite(counted) ? counted : null,
    shortage,
    gapKm,
    checkedAtLabel: formatStamp(entry.checkedAt ?? entry.updatedAt ?? entry.createdAt),
    submittedAt: formatTime(entry.checkedAt ?? entry.updatedAt ?? entry.createdAt),
    workflowStatus,
    workflowLabel: workflow.label,
    workflowTone: workflow.tone,
    status: deriveQueueStatus({ status: workflowStatus }, shortage, gapKm),
    dayAnalytics: buildDriverCashUpAnalytics(summary),
  };
};

const buildDriverCashUpQueue = (source) =>
  [...(source?.dailyCashUps ?? [])]
    .map((entry) => buildDriverCashUpQueueEntry(source, entry))
    .sort(
      (left, right) =>
        new Date(right.checkedAt ?? right.updatedAt ?? right.createdAt ?? 0) -
        new Date(left.checkedAt ?? left.updatedAt ?? left.createdAt ?? 0),
    );

const buildRecordChangeLabel = (label, previousValue, nextValue) =>
  previousValue === nextValue ? null : `${label} ${previousValue} to ${nextValue}`;

const formatRecordMoneyChange = (value) => formatMoney(Number(value ?? 0));

const formatRecordCountChange = (value) => `${Number(value ?? 0).toLocaleString()}`;

const formatRecordDistanceChange = (value) => `${Number(value ?? 0).toLocaleString()} km`;

const formatRecordTextChange = (value, fallback = "Not set") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const formatRecordPaymentChange = (value) => (value ? "Cash" : "Non-cash");

const buildFinanceRecordChangeSummary = (previousRecord = {}, nextRecord = {}) => {
  const changes = [];

  if (nextRecord?.type === "income" && nextRecord?.incomeKind === "standard") {
    changes.push(
      buildRecordChangeLabel(
        "Takings",
        formatRecordMoneyChange(previousRecord.amountClaimed ?? previousRecord.amount),
        formatRecordMoneyChange(nextRecord.amountClaimed ?? nextRecord.amount),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Passengers",
        formatRecordCountChange(getDailyTripPassengerTotal(previousRecord)),
        formatRecordCountChange(getDailyTripPassengerTotal(nextRecord)),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Trips",
        formatRecordCountChange(getDailyTripTripCount(previousRecord)),
        formatRecordCountChange(getDailyTripTripCount(nextRecord)),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Opening odo",
        formatRecordDistanceChange(previousRecord.openingOdo),
        formatRecordDistanceChange(nextRecord.openingOdo),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Closing odo",
        formatRecordDistanceChange(previousRecord.closingOdo),
        formatRecordDistanceChange(nextRecord.closingOdo),
      ),
    );
  }

  if (nextRecord?.type === "income" && nextRecord?.incomeKind === "special") {
    changes.push(
      buildRecordChangeLabel(
        "Takings",
        formatRecordMoneyChange(previousRecord.amount),
        formatRecordMoneyChange(nextRecord.amount),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Route",
        formatTripRoute(previousRecord),
        formatTripRoute(nextRecord),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Reason",
        formatRecordTextChange(previousRecord.travelReason),
        formatRecordTextChange(nextRecord.travelReason),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Business km",
        formatRecordDistanceChange(getBusinessKmValue(previousRecord)),
        formatRecordDistanceChange(getBusinessKmValue(nextRecord)),
      ),
    );
  }

  if (nextRecord?.type === "expense") {
    changes.push(
      buildRecordChangeLabel(
        "Amount",
        formatRecordMoneyChange(previousRecord.amount),
        formatRecordMoneyChange(nextRecord.amount),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Category",
        formatRecordTextChange(previousRecord.category),
        formatRecordTextChange(nextRecord.category),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Description",
        formatRecordTextChange(previousRecord.description),
        formatRecordTextChange(nextRecord.description),
      ),
    );
    changes.push(
      buildRecordChangeLabel(
        "Payment",
        formatRecordPaymentChange(previousRecord.cashExpense),
        formatRecordPaymentChange(nextRecord.cashExpense),
      ),
    );
  }

  return changes.filter(Boolean).join(" / ") || "No tracked values changed.";
};

const buildDriverRecordEditTracking = ({
  existingRecord,
  nextRecord,
  reason,
  timestamp,
  actorId,
  actorRole,
}) => {
  const existingHistory = Array.isArray(existingRecord?.editHistory) ? existingRecord.editHistory : [];
  const normalizedReason = String(reason ?? "").trim();

  if (!normalizedReason) {
    return {
      editEntry: null,
      trackingFields: {
        editHistory: existingHistory,
        lastEditReason: existingRecord?.lastEditReason ?? null,
        lastEditSummary: existingRecord?.lastEditSummary ?? null,
        lastEditedAt: existingRecord?.lastEditedAt ?? null,
        lastEditedBy: existingRecord?.lastEditedBy ?? null,
        lastEditedByRole: existingRecord?.lastEditedByRole ?? null,
      },
    };
  }

  const editEntry = {
    id: createRecordId("edit"),
    timestamp,
    reason: normalizedReason,
    summary: buildFinanceRecordChangeSummary(existingRecord, nextRecord),
    actorId,
    actorRole,
  };

  return {
    editEntry,
    trackingFields: {
      editHistory: [editEntry, ...existingHistory],
      lastEditReason: editEntry.reason,
      lastEditSummary: editEntry.summary,
      lastEditedAt: timestamp,
      lastEditedBy: actorId,
      lastEditedByRole: actorRole,
    },
  };
};

const getRecordLastEditNote = (record = {}) => {
  const reason = String(record.lastEditReason ?? "").trim();

  if (!reason) {
    return null;
  }

  const parts = [`Driver edit note: ${reason}`];

  if (String(record.lastEditSummary ?? "").trim()) {
    parts.push(record.lastEditSummary);
  }
  if (record.lastEditedAt) {
    parts.push(formatStamp(record.lastEditedAt));
  }

  return parts.join(" / ");
};

const createAuditEvent = ({
  id,
  timestamp = new Date().toISOString(),
  scope = "system",
  action,
  entityType,
  entityId,
  title,
  detail,
  actorId = "system",
  actorRole = "System",
}) => ({
  id:
    id ??
    `audit-${entityType ?? scope}-${entityId ?? timestamp}-${Math.random()
      .toString(36)
      .slice(2, 6)}`,
  timestamp,
  scope,
  action,
  entityType,
  entityId,
  title,
  detail,
  actorId,
  actorRole,
});

const appendAuditTrail = (existing = [], entries = []) => [
  ...entries.filter(Boolean),
  ...existing,
];

const getAuditTone = (entry) => {
  if (["approve", "grant", "verify", "resolve", "lock"].includes(entry.action)) {
    return "success";
  }
  if (entry.action === "request") {
    return "warning";
  }
  if (["delete", "archive", "revoke", "reject"].includes(entry.action)) {
    return "warning";
  }
  if (["delete", "archive"].includes(entry.action)) {
    return "warning";
  }
  if (entry.action === "update") {
    return "info";
  }
  return "navy";
};

const getAuditActionLabel = (entry) => {
  const labels = {
    create: "Added",
    update: "Changed",
    verify: "Checked",
    delete: "Removed",
    lock: "Finished",
    archive: "Archived",
    report: "Reported",
    resolve: "Fixed",
    request: "Requested",
    approve: "Approved",
    reject: "Declined",
    grant: "Granted",
    revoke: "Removed",
  };

  return labels[entry.action] ?? "Saved";
};

const getAuditActorLabel = (drivers, actorId, actorRole) => {
  const driverRecord = drivers.find((driver) => driver.staffId === actorId);

  if (driverRecord?.name) {
    return driverRecord.name;
  }

  return actorRole ?? actorId ?? "System";
};

const getPasswordResetEmailNotice = (emailOutbox = [], requestId) =>
  (emailOutbox ?? []).find(
    (entry) =>
      entry.relatedRequestId === requestId &&
      String(entry.channel ?? "").trim().toLowerCase() === "email",
  ) ?? null;

const buildHistoricalAuditTrail = (source, drivers) => {
  if (!source) {
    return [];
  }

  const transactionEvents = (source.financeTransactions ?? []).flatMap((record) => [
    createAuditEvent({
      id: `audit-${record.id}-created`,
      timestamp: record.createdAt ?? record.timestamp,
      scope: "finance",
      action: "create",
      entityType: record.type,
      entityId: record.id,
      title:
        record.type === "income"
          ? `${record.isSpecial ? "Extra trip added" : "Daily trip added"} / ${
              record.vehicle ?? "General"
            }`
          : `Expense added / ${record.category}`,
      detail:
        record.type === "income"
          ? record.isSpecial
            ? `${formatMoney(record.amountClaimed ?? record.amount ?? 0)} / ${formatTripRoute(record)} / ${formatTripLogMeta(
                record,
              )}`
            : `${formatMoney(record.amountClaimed ?? record.amount ?? 0)} / ${
                record.route ?? "Pending route"
              } / ${formatDailyTripMeta(record)}`
          : `${record.description ?? record.vehicle ?? "General"} / ${formatMoney(
              record.amount ?? 0,
            )}${record.reference ? ` / Receipt ${record.reference}` : ""}`,
      actorId: record.createdBy,
      actorRole: record.createdByRole,
    }),
    record.verifiedAt
      ? createAuditEvent({
          id: `audit-${record.id}-verified`,
          timestamp: record.verifiedAt,
          scope: "finance",
          action: "verify",
          entityType: record.type,
          entityId: record.id,
          title: `Income checked / ${record.vehicle ?? "General"}`,
          detail: `${formatMoney(record.actualCashReceived ?? 0)} counted`,
          actorId: record.verifiedBy,
          actorRole: record.verifiedByRole,
        })
      : null,
  ]);

  const depositEvents = (source.deposits ?? []).map((deposit) =>
    createAuditEvent({
      id: `audit-${deposit.depositId}-locked`,
      timestamp: deposit.timestamp,
      scope: "finance",
      action: "lock",
      entityType: "deposit",
      entityId: deposit.depositId,
      title: `Deposit finished / ${deposit.reference}`,
      detail: `${deposit.recordsLocked} items / ${formatMoney(deposit.depositAmount)}`,
      actorId: deposit.lockedBy,
      actorRole: deposit.lockedByRole ?? "Owner",
    }),
  );

  const defectEvents = (source.defects ?? []).flatMap((defect) => [
    createAuditEvent({
      id: `audit-${defect.id}-reported`,
      timestamp: defect.reportedAt,
      scope: "fleet",
      action: "report",
      entityType: "defect",
      entityId: defect.id,
      title: `Problem reported / ${defect.vehicle ?? defect.vehicleId ?? "Vehicle"}`,
      detail: defect.detail ?? defect.issue,
      actorId: defect.reportedByStaffId,
      actorRole: defect.reportedByRole ?? "Driver",
    }),
    defect.updatedAt
      ? createAuditEvent({
          id: `audit-${defect.id}-updated`,
          timestamp: defect.updatedAt,
          scope: "fleet",
          action: "update",
          entityType: "defect",
          entityId: defect.id,
          title: `Problem updated / ${defect.vehicle ?? defect.vehicleId ?? "Vehicle"}`,
          detail: defect.detail ?? defect.issue,
          actorId: defect.updatedBy,
          actorRole: defect.updatedByRole,
        })
      : null,
    defect.resolvedAt
      ? createAuditEvent({
          id: `audit-${defect.id}-resolved`,
          timestamp: defect.resolvedAt,
          scope: "fleet",
          action: "resolve",
          entityType: "defect",
          entityId: defect.id,
          title: `Problem fixed / ${defect.vehicle ?? defect.vehicleId ?? "Vehicle"}`,
          detail: `${formatMoney(defect.repairCost ?? 0)} repair amount`,
          actorId: defect.resolvedBy,
          actorRole: defect.resolvedByRole ?? "Manager",
        })
      : null,
  ]);

  const vehicleEvents = (source.vehicles ?? []).flatMap((vehicle) => [
    vehicle.createdAt
      ? createAuditEvent({
          id: `audit-${vehicle.id}-created`,
          timestamp: vehicle.createdAt,
          scope: "fleet",
          action: "create",
          entityType: "vehicle",
          entityId: vehicle.id,
          title: `Vehicle added / ${vehicle.registration}`,
          detail: `${vehicle.model} / ${vehicle.route}`,
          actorId: vehicle.createdBy,
          actorRole: vehicle.createdByRole,
        })
      : null,
    vehicle.updatedAt
      ? createAuditEvent({
          id: `audit-${vehicle.id}-updated`,
          timestamp: vehicle.updatedAt,
          scope: "fleet",
          action: "update",
          entityType: "vehicle",
          entityId: vehicle.id,
          title: `Vehicle updated / ${vehicle.registration}`,
          detail: `${vehicle.model} / ${vehicle.route}`,
          actorId: vehicle.updatedBy,
          actorRole: vehicle.updatedByRole,
        })
      : null,
    vehicle.archivedAt
      ? createAuditEvent({
          id: `audit-${vehicle.id}-archived`,
          timestamp: vehicle.archivedAt,
          scope: "fleet",
          action: "archive",
          entityType: "vehicle",
          entityId: vehicle.id,
          title: `Vehicle archived / ${vehicle.registration}`,
          detail: "Kept in the history.",
          actorId: vehicle.archivedBy,
          actorRole: vehicle.archivedByRole ?? "Owner",
        })
      : null,
  ]);
  const driverEvents = (source.drivers ?? []).flatMap((driver) => [
    driver.createdAt
      ? createAuditEvent({
          id: `audit-${driver.staffId}-created`,
          timestamp: driver.createdAt,
          scope: "drivers",
          action: "create",
          entityType: "driver",
          entityId: driver.staffId,
          title: `Driver created / ${driver.name}`,
          detail: `${driver.staffId} / ${getDriverRouteSummary(driver)}${driver.email ? ` / ${driver.email}` : ""}`,
          actorId: driver.createdBy,
          actorRole: driver.createdByRole,
        })
      : null,
    driver.updatedAt
      ? createAuditEvent({
          id: `audit-${driver.staffId}-updated`,
          timestamp: driver.updatedAt,
          scope: "drivers",
          action: "update",
          entityType: "driver",
          entityId: driver.staffId,
          title: `Driver updated / ${driver.name}`,
          detail: `${driver.staffId} / ${getDriverRouteSummary(driver)}${driver.email ? ` / ${driver.email}` : ""}`,
          actorId: driver.updatedBy,
          actorRole: driver.updatedByRole,
        })
      : null,
  ]);

  return [...transactionEvents, ...depositEvents, ...defectEvents, ...vehicleEvents, ...driverEvents]
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      actorLabel: getAuditActorLabel(drivers, entry.actorId, entry.actorRole),
      actionLabel: getAuditActionLabel(entry),
      tone: getAuditTone(entry),
      timestampLabel: formatStamp(entry.timestamp),
    }))
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
};

const sumBy = (items, selector) =>
  items.reduce((total, item) => total + Number(selector(item) ?? 0), 0);

const getIncomeCashValue = (record) =>
  Number(record.actualCashReceived ?? record.amountClaimed ?? record.amount ?? 0);

const getCurrentActorId = (role, snapshot, authIdentity = null) => {
  if (authIdentity?.actorId) {
    return authIdentity.actorId;
  }

  if (role === "Driver") {
    return snapshot.driverTerminal?.activeDriverId ?? "driver-terminal";
  }

  return `${role.toLowerCase()}-session`;
};

const buildDepositReference = (sequence, value = new Date()) => {
  const day = value
    .toLocaleDateString("en-ZA", { weekday: "short" })
    .replace(".", "")
    .toUpperCase();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");

  return `TFP-${day}-${month}${date}-${String(sequence).padStart(2, "0")}`;
};

const getExpectedOpeningOdo = (transactions, vehicles, vehicleId, excludedId = null) => {
  const latestShift = [...transactions]
    .filter(
      (record) =>
        record.type === "income" &&
        record.incomeKind === "standard" &&
        record.vehicleId === vehicleId &&
        record.id !== excludedId,
    )
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

  if (latestShift?.closingOdo != null) {
    return Number(latestShift.closingOdo);
  }

  return Number(vehicles.find((vehicle) => vehicle.id === vehicleId)?.currentOdometer ?? 0);
};

const getDriverLinkedVehicles = (snapshot) => {
  const activeDriverId =
    snapshot.driverTerminal?.activeDriverId ??
    snapshot.drivers.find((driver) => driver.name === snapshot.driverTerminal?.activeDriver)?.staffId;
  const explicitLinkedIds = new Set(snapshot.driverTerminal?.linkedVehicleIds ?? []);

  const linkedVehicles = snapshot.vehicles.filter(
    (vehicle) =>
      vehicle.id === snapshot.driverTerminal?.assignedVehicleId ||
      explicitLinkedIds.has(vehicle.id) ||
      vehicle.registration === snapshot.driverTerminal?.assignedVehicle ||
      (activeDriverId && vehicle.assignedDriverId === activeDriverId),
  );

  return linkedVehicles.length > 0 ? linkedVehicles : [];
};

const deriveQueueStatus = (record, shortage, gapKm) => {
  if (record.status === "banked") {
    return "Deposited";
  }
  if (record.status === "pending") {
    return "Waiting for admin hand-in";
  }
  if (record.status === "counted") {
    return shortage > 0 || gapKm > 0 ? "Needs manager review" : "Waiting for manager check";
  }
  if (shortage > 0 || gapKm > 0) {
    return "Checked with issues";
  }
  return "Manager checked";
};

const getDaysLeft = (expiryDate, currentDate) => {
  if (!expiryDate) {
    return 365;
  }

  return differenceInDays(new Date(expiryDate), currentDate);
};

const getDocumentStage = (daysLeft) => {
  if (daysLeft <= 30) {
    return "30-day critical";
  }
  if (daysLeft <= 90) {
    return "60-day warning";
  }
  return "90-day watch";
};

const getServiceTone = (kmsRemaining) => {
  if (kmsRemaining <= 0) {
    return "danger";
  }
  if (kmsRemaining <= 1000) {
    return "warning";
  }
  return "success";
};

const getVehicleHealthState = ({ status, defectsOpen, kmsRemaining, minimumDocumentDays }) => {
  if (status === "archived") {
    return "neutral";
  }
  if (kmsRemaining <= 0 || minimumDocumentDays <= 30) {
    return "danger";
  }
  if (defectsOpen > 0 || kmsRemaining <= 1000) {
    return "warning";
  }
  return "success";
};

const deriveSnapshot = (source) => {
  if (!source) {
    return source;
  }

  const currentDate = new Date();
  const routes = collectRouteMasterRecords(source);
  const drivers = (source.drivers ?? []).map((driver) => {
    const staffId = driver.staffId ?? driver.id ?? driver.name;
    const routeAssignments = normalizeDriverRouteAssignments(driver, routes);
    const prdpDays =
      driver.prdpExpiryDate != null
        ? getDaysLeft(driver.prdpExpiryDate, currentDate)
        : driver.prdpDays ?? null;
    const licenseDays =
      driver.licenseExpiryDate != null
        ? getDaysLeft(driver.licenseExpiryDate, currentDate)
        : driver.licenseDays ?? null;

    return {
      ...driver,
      staffId,
      routeIds: routeAssignments.routeIds,
      routeNames: routeAssignments.routeNames,
      primaryRouteId: routeAssignments.primaryRouteId,
      route: routeAssignments.primaryRoute,
      routeSummary: routeAssignments.routeSummary,
      prdpDays,
      licenseDays,
    };
  });
  const driverMap = new Map(drivers.map((driver) => [driver.staffId, driver]));
  const rawVehicles = source.vehicles ?? [];
  const resolvedDriverId =
    source.driverTerminal?.activeDriverId ??
    drivers.find((driver) => driver.name === source.driverTerminal?.activeDriver)?.staffId ??
    drivers[0]?.staffId ??
    null;
  const resolvedVehicleId =
    source.driverTerminal?.assignedVehicleId ??
    rawVehicles.find(
      (vehicle) => vehicle.registration === source.driverTerminal?.assignedVehicle,
    )?.id ??
    rawVehicles[0]?.id ??
    null;
  const defects = [...(source.defects ?? [])]
    .map((defect) => {
      const vehicleId =
        defect.vehicleId ??
        rawVehicles.find((vehicle) => vehicle.registration === defect.vehicle)?.id ??
        null;
      const vehicle = rawVehicles.find((item) => item.id === vehicleId);
      const reporter = driverMap.get(defect.reportedByStaffId);
      const isResolved = defect.status === "resolved";

      return {
        ...defect,
        id: defect.id ?? `${vehicleId ?? "veh"}-${defect.issue}`,
        vehicleId,
        vehicle: vehicle?.registration ?? defect.vehicle ?? "Vehicle",
        category: defect.category ?? "Other",
        detail: defect.detail ?? defect.issue,
        status: defect.status ?? "open",
        statusLabel: isResolved ? "Resolved" : "Open",
        severity: isResolved ? "Resolved" : defect.severity ?? "Low",
        reportedByStaffId: defect.reportedByStaffId ?? resolvedDriverId,
        reportedByName: reporter?.name ?? "Driver",
        reportedAtLabel: formatStamp(defect.reportedAt),
        resolvedAtLabel: defect.resolvedAt ? formatStamp(defect.resolvedAt) : null,
        immutable: isResolved,
      };
    })
    .sort((left, right) => new Date(right.reportedAt) - new Date(left.reportedAt));
  const openDefectsByVehicle = defects.reduce((map, defect) => {
    if (defect.status !== "resolved" && defect.vehicleId) {
      map.set(defect.vehicleId, (map.get(defect.vehicleId) ?? 0) + 1);
    }
    return map;
  }, new Map());

  const baseVehicles = rawVehicles.map((vehicle) => {
    const normalizedVehicle = normalizeVehicleCapabilityHooks(vehicle);
    const serviceIntervalKm = Number(
      normalizedVehicle.serviceIntervalKm ?? source.profile.serviceIntervalKm ?? 10000,
    );
    const lastServiceOdo = Number(
      normalizedVehicle.lastServiceOdo ??
        (normalizedVehicle.nextServiceAt != null
          ? normalizedVehicle.nextServiceAt - serviceIntervalKm
          : 0),
    );
    const kmsRemaining =
      lastServiceOdo + serviceIntervalKm - Number(normalizedVehicle.currentOdometer ?? 0);
    const permitDays =
      normalizedVehicle.permitExpiryDate != null
        ? getDaysLeft(normalizedVehicle.permitExpiryDate, currentDate)
        : normalizedVehicle.permitDays ?? 365;
    const discDays =
      normalizedVehicle.discExpiryDate != null
        ? getDaysLeft(normalizedVehicle.discExpiryDate, currentDate)
        : normalizedVehicle.discDays ?? 365;
    const minimumDocumentDays = Math.min(permitDays, discDays);
    const defectsOpen = openDefectsByVehicle.get(normalizedVehicle.id) ?? normalizedVehicle.defectsOpen ?? 0;
    const assignedDriverId =
      normalizedVehicle.assignedDriverId ??
      drivers.find((driver) => driver.name === normalizedVehicle.assignedDriver)?.staffId ??
      null;
    const assignedDriver = assignedDriverId ? driverMap.get(assignedDriverId) : null;
    const healthState = getVehicleHealthState({
      status: normalizedVehicle.status,
      defectsOpen,
      kmsRemaining,
      minimumDocumentDays,
    });
    const healthLabelMap = {
      success: "Healthy",
      warning: "Warning",
      danger: "Critical",
      neutral: "Archived",
    };

    return {
      ...normalizedVehicle,
      status: normalizedVehicle.status ?? "active",
      assignedDriverId,
      assignedDriver: assignedDriver?.name ?? "Unassigned",
      assignedDriverStaff: assignedDriver ?? null,
      currentOdometer: Number(normalizedVehicle.currentOdometer ?? 0),
      serviceIntervalKm,
      lastServiceOdo,
      nextServiceAt: lastServiceOdo + serviceIntervalKm,
      serviceDueKm: kmsRemaining,
      serviceTone: getServiceTone(kmsRemaining),
      defectsOpen,
      permitDays,
      discDays,
      minimumDocumentDays,
      healthState,
      healthLabel: healthLabelMap[healthState] ?? "Healthy",
      archivedAt: normalizedVehicle.archivedAt ?? null,
    };
  });

  const normalizedTransactions = [...(source.financeTransactions ?? [])]
    .map((record) => {
      if (record?.type !== "income") {
        return record;
      }

      return {
        ...record,
        ...buildTripAnalyticsFields(record),
        ...(record.incomeKind === "standard" ? buildDailyAnalyticsFields(record) : {}),
        tripLogbook: Array.isArray(record.tripLogbook)
          ? record.tripLogbook.map((entry) => createDailyTripLogEntry(record.route, entry))
          : record.tripLogbook,
      };
    })
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const expenseTransactions = normalizedTransactions.filter((record) => record.type === "expense");
  const transactions = normalizedTransactions.map((record) => {
    if (record?.type !== "income") {
      return record;
    }

    if (record.incomeKind === "standard") {
      const matchingExpenses = expenseTransactions.filter(
        (expenseRecord) =>
          expenseRecord.vehicleId === record.vehicleId &&
          String(expenseRecord.expenseDate ?? "").trim() === String(record.tripDate ?? "").trim(),
      );

      return {
        ...record,
        dailyAnalytics: calculateDailyAnalytics({
          trips: record.tripLogbook,
          expenses: matchingExpenses,
          totalTakingsExpected: Number(record.amountClaimed ?? record.amount ?? 0),
          dayRecord: record,
        }),
      };
    }

    return {
      ...record,
      tripAnalytics: calculateTripAnalytics(record),
    };
  });
  const deposits = [...(source.deposits ?? [])].sort(
    (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
  );
  const activeIncomeBatch = transactions.filter(
    (record) => record.type === "income" && record.status !== "banked",
  );
  const verifiedIncome = transactions.filter(
    (record) => record.type === "income" && record.status === "verified",
  );
  const settledIncome = transactions.filter(
    (record) =>
      record.type === "income" &&
      (record.status === "verified" || record.status === "banked"),
  );
  const allExpenses = transactions.filter((record) => record.type === "expense");
  const verifiedExpenses = allExpenses.filter((record) => record.status === "verified");
  const settledExpenses = allExpenses.filter(
    (record) => record.status === "verified" || record.status === "banked",
  );
  const assetExpenses = allExpenses.filter((record) => record.expenseKind === "asset");
  const operationalExpenses = allExpenses.filter(
    (record) => record.expenseKind === "operational",
  );
  const enrichedVehicles = baseVehicles.map((vehicle) => {
    const vehicleIncome = settledIncome.filter((record) => record.vehicleId === vehicle.id);
    const vehicleExpenses = assetExpenses.filter(
      (record) =>
        record.vehicleId === vehicle.id &&
        (record.status === "verified" || record.status === "banked"),
    );
    const vehicleRevenue = sumBy(vehicleIncome, getIncomeCashValue);
    const vehicleExpenseTotal = sumBy(vehicleExpenses, (record) => record.amount);

    return {
      ...vehicle,
      verifiedRevenue: vehicleRevenue,
      assetExpenseTotal: vehicleExpenseTotal,
      netYield: vehicleRevenue - vehicleExpenseTotal,
      vehicleLedger: transactions.filter((record) => record.vehicleId === vehicle.id),
      linkedDefects: defects.filter((defect) => defect.vehicleId === vehicle.id),
    };
  });

  const vehicleOpenings = Object.fromEntries(
    enrichedVehicles.map((vehicle) => [
      vehicle.id,
      getExpectedOpeningOdo(transactions, enrichedVehicles, vehicle.id),
    ]),
  );
  const driverSummarySource = {
    ...source,
    vehicles: enrichedVehicles,
    financeTransactions: transactions,
    dailyCashUps: Array.isArray(source.dailyCashUps) ? source.dailyCashUps : [],
  };
  const driverCashUpQueue = buildDriverCashUpQueue(driverSummarySource);
  const driverCashUpCoverageKeys = new Set(
    driverCashUpQueue.map((entry) => getCashUpCoverageKey(entry)).filter(Boolean),
  );
  const activeDriverCashVerificationQueue = driverCashUpQueue.filter(
    (entry) => entry.incomeCount > 0 && entry.workflowStatus !== "banked",
  );
  const standaloneVerificationQueue = activeIncomeBatch
    .filter((record) => {
      const coverageKey = getFinanceRecordCashUpCoverageKey(record);

      if (isDriverCreatedFinanceRecord(record)) {
        return false;
      }

      return !(coverageKey && driverCashUpCoverageKeys.has(coverageKey));
    })
    .map((record) => {
      const assignedDriver =
        getFinanceRecordDriverName(record) ??
        enrichedVehicles.find((vehicle) => vehicle.id === record.vehicleId)?.assignedDriver ??
        drivers.find((driver) => driver.staffId === resolvedDriverId)?.name ??
        source.driverTerminal?.activeDriver ??
        "Driver";
      const expectedOpening =
        record.incomeKind === "standard"
          ? getExpectedOpeningOdo(transactions, enrichedVehicles, record.vehicleId, record.id)
          : 0;
      const gapKm =
        record.incomeKind === "standard"
          ? Math.abs(Number(record.openingOdo ?? 0) - Number(expectedOpening ?? 0))
          : 0;
      const shortage = Math.max(
        Number(record.amountClaimed ?? record.amount ?? 0) -
          Number(record.actualCashReceived ?? 0),
        0,
      );

      return {
        id: record.id,
        queueType: "income",
        driver: assignedDriver,
        route:
          record.incomeKind === "special"
            ? formatTripRoute(record)
            : record.route ?? "Standard shift",
        vehicle:
          enrichedVehicles.find((vehicle) => vehicle.id === record.vehicleId)?.registration ??
          record.vehicle ??
          "Vehicle",
        submittedAt: formatTime(record.timestamp),
        claimed: Number(record.amountClaimed ?? record.amount ?? 0),
        counted: Number(record.actualCashReceived ?? 0),
        shortage,
        gapKm,
        status: deriveQueueStatus(record, shortage, gapKm),
        workflowStatus: normalizeCashUpWorkflowStatus(record.status) ?? "pending",
      };
    });
  const verificationQueue = [...activeDriverCashVerificationQueue, ...standaloneVerificationQueue].sort(
    (left, right) =>
      new Date(
        right.verifiedAt ??
          right.countedAt ??
          right.checkedAt ??
          right.updatedAt ??
          right.timestamp ??
          0,
      ) -
      new Date(
        left.verifiedAt ??
          left.countedAt ??
          left.checkedAt ??
          left.updatedAt ??
          left.timestamp ??
          0,
      ),
  );
  const verifiedDriverCashUps = driverCashUpQueue.filter(
    (entry) => entry.workflowStatus === "verified",
  );
  const verifiedDriverCashUpTransactionIds = new Set(
    verifiedDriverCashUps.flatMap((entry) => buildCashUpTransactionIds(entry)),
  );
  const verifiedStandaloneIncome = verifiedIncome.filter(
    (record) => !verifiedDriverCashUpTransactionIds.has(record.id),
  );
  const verifiedStandaloneCashExpenses = verifiedExpenses.filter(
    (record) => record.cashExpense && !verifiedDriverCashUpTransactionIds.has(record.id),
  );
  const verifiedTakings =
    sumBy(verifiedDriverCashUps, (entry) => entry.totalIncome) +
    sumBy(verifiedStandaloneIncome, getIncomeCashValue);
  const verifiedCashExpenses =
    sumBy(verifiedDriverCashUps, (entry) => entry.cashExpenses) +
    sumBy(verifiedStandaloneCashExpenses, (record) => record.amount);
  const bankableCash =
    sumBy(
      verifiedDriverCashUps,
      (entry) => entry.actualCashReceived ?? entry.expectedCashIn,
    ) +
    sumBy(verifiedStandaloneIncome, getIncomeCashValue) -
    sumBy(verifiedStandaloneCashExpenses, (record) => record.amount);

  const standardIncome = activeIncomeBatch.filter(
    (record) => record.type === "income" && record.incomeKind === "standard",
  );
  const specialIncome = activeIncomeBatch.filter(
    (record) => record.type === "income" && record.isSpecial,
  );
  const routeSeries = standardIncome.slice(0, 4).map((record) => ({
    label: record.route?.split(" ")[0] ?? "Route",
    amount: Number(record.amountClaimed ?? record.amount ?? 0),
    type: record.status,
  }));
  const specialSeries = specialIncome.slice(0, 4).map((record) => ({
    name: formatTripRoute(record),
    vehicle:
      enrichedVehicles.find((vehicle) => vehicle.id === record.vehicleId)?.registration ??
      record.vehicle ??
      "General",
    type: record.travelReason ?? "Special trip",
    amount: Number(record.amount ?? 0),
  }));
  const expenseSummary = (items) =>
    Object.values(
      items.reduce((groups, item) => {
        const key = item.category;
        const current = groups[key] ?? { category: key, amount: 0 };
        groups[key] = { ...current, amount: current.amount + Number(item.amount ?? 0) };
        return groups;
      }, {}),
    );
  const lockableVerificationQueue = verificationQueue.filter(
    (entry) => entry.workflowStatus === "verified",
  );
  const nextReference = buildDepositReference(deposits.length + 1);
  const batchReference =
    lockableVerificationQueue.length > 0 ? nextReference : deposits[0]?.reference ?? nextReference;
  const latestVerifiedTimestamp =
    lockableVerificationQueue
      .map(
        (entry) =>
          entry.verifiedAt ??
          entry.countedAt ??
          entry.checkedAt ??
          entry.updatedAt ??
          entry.timestamp ??
          null,
      )
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] ?? null;
  const serviceSchedule = enrichedVehicles
    .filter((vehicle) => vehicle.status !== "archived")
    .sort((left, right) => left.serviceDueKm - right.serviceDueKm)
    .map((vehicle) => ({
      vehicle: vehicle.registration,
      vehicleId: vehicle.id,
      dueInKm: vehicle.serviceDueKm,
      serviceType:
        vehicle.serviceDueKm <= 0
          ? "Immediate service pull-in"
          : `${vehicle.serviceIntervalKm.toLocaleString()}km preventive service`,
      workshop:
        vehicle.serviceDueKm <= 1000 ? "Priority workshop lane" : "TaxiFlow Partner Bay",
      tone: vehicle.serviceTone,
    }));
  const documents = [
    ...enrichedVehicles
      .filter((vehicle) => vehicle.status !== "archived")
      .flatMap((vehicle) => [
        {
          id: `${vehicle.id}-permit`,
          subject: vehicle.registration,
          subjectId: vehicle.id,
          subjectType: "vehicle",
          document: "Operating Permit",
          expiryDate: vehicle.permitExpiryDate ?? null,
          daysLeft: vehicle.permitDays,
          stage: getDocumentStage(vehicle.permitDays),
          owner: "Fleet Manager",
          action:
            vehicle.permitDays < 30
              ? "Escalate permit renewal and confirm proof of submission."
              : "Monitor permit renewal timeline.",
        },
        {
          id: `${vehicle.id}-disc`,
          subject: vehicle.registration,
          subjectId: vehicle.id,
          subjectType: "vehicle",
          document: "License Disc",
          expiryDate: vehicle.discExpiryDate ?? null,
          daysLeft: vehicle.discDays,
          stage: getDocumentStage(vehicle.discDays),
          owner: "Fleet Manager",
          action:
            vehicle.discDays < 30
              ? "Book licensing office slot and prepare roadworthy documents."
              : "Keep disc renewal documentation ready.",
        },
      ]),
    ...drivers
      .filter((driver) => driver.role === "Driver" && driver.prdpExpiryDate)
      .map((driver) => ({
        id: `${driver.staffId}-prdp`,
        subject: driver.name,
        subjectId: driver.staffId,
        subjectType: "staff",
        document: "PrDP",
        expiryDate: driver.prdpExpiryDate,
        daysLeft: driver.prdpDays ?? 365,
        stage: getDocumentStage(driver.prdpDays ?? 365),
        owner: "HR Admin",
        action:
          (driver.prdpDays ?? 365) < 30
            ? "Collect renewal slip and restrict reassignment until renewed."
            : "Track driver renewal in advance.",
      })),
    ...drivers
      .filter((driver) => driver.role === "Driver" && driver.licenseExpiryDate)
      .map((driver) => ({
        id: `${driver.staffId}-licence`,
        subject: driver.name,
        subjectId: driver.staffId,
        subjectType: "staff",
        document: "Driver licence",
        expiryDate: driver.licenseExpiryDate,
        daysLeft: driver.licenseDays ?? 365,
        stage: getDocumentStage(driver.licenseDays ?? 365),
        owner: "HR Admin",
        action:
          (driver.licenseDays ?? 365) < 30
            ? "Book the driver licence renewal and verify the updated card."
            : "Track driver licence renewal in advance.",
      })),
  ].sort((left, right) => left.daysLeft - right.daysLeft);
  const activeDriver = drivers.find((driver) => driver.staffId === resolvedDriverId) ?? drivers[0];
  const linkedVehicleRecords = enrichedVehicles.filter(
    (vehicle) => vehicle.assignedDriverId === activeDriver?.staffId,
  );
  const driverDayCashSummary = buildDriverDayCashSummary(driverSummarySource, {
    driverStaffId: activeDriver?.staffId ?? null,
  });
  const pendingDriverCashUps = driverCashUpQueue.filter(
    (entry) => entry.workflowStatus !== "banked",
  );
  const assignedVehicle =
    linkedVehicleRecords.find((vehicle) => vehicle.id === resolvedVehicleId) ??
    linkedVehicleRecords[0] ??
    enrichedVehicles.find((vehicle) => vehicle.id === resolvedVehicleId) ??
    enrichedVehicles[0];
  const auditTrailSource =
    source.auditTrail?.length > 0 ? source.auditTrail : buildHistoricalAuditTrail(source, drivers);
  const auditTrail = auditTrailSource
    .map((entry) => ({
      ...entry,
      actorLabel: entry.actorLabel ?? getAuditActorLabel(drivers, entry.actorId, entry.actorRole),
      actionLabel: entry.actionLabel ?? getAuditActionLabel(entry),
      tone: entry.tone ?? getAuditTone(entry),
      timestampLabel: entry.timestampLabel ?? formatStamp(entry.timestamp),
    }))
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));

  return {
    ...source,
    routes,
    drivers,
    defects,
    auditTrail,
    operationsLoop: OPERATIONS_WORKFLOW,
    documents,
    serviceSchedule,
    driverTerminal: {
      ...source.driverTerminal,
      activeDriverId: activeDriver?.staffId ?? null,
      activeDriver: activeDriver?.name ?? source.driverTerminal?.activeDriver ?? "Driver",
      assignedVehicleId: assignedVehicle?.id ?? null,
      assignedVehicle:
        assignedVehicle?.registration ?? source.driverTerminal?.assignedVehicle ?? "Vehicle",
      assignedRoute: assignedVehicle?.route ?? source.driverTerminal?.assignedRoute ?? "Route",
      shortcuts: Array.from(
        new Set([...DRIVER_SHORTCUTS, ...(source.driverTerminal?.shortcuts ?? [])]),
      ),
      dayCashSummary: driverDayCashSummary,
      linkedVehicleIds: linkedVehicleRecords.map((vehicle) => vehicle.id),
      linkedVehicles: linkedVehicleRecords.map((vehicle) => ({
        id: vehicle.id,
        registration: vehicle.registration,
        route: vehicle.route,
      })),
    },
    vehicles: enrichedVehicles,
    verificationQueue,
    finance: {
      ...source.finance,
      todayClaimed: sumBy(
        activeIncomeBatch,
        (record) => record.amountClaimed ?? record.amount,
      ),
      todayCounted: sumBy(
        verificationQueue.filter((entry) =>
          ["counted", "verified"].includes(entry.workflowStatus),
        ),
        (entry) => entry.counted,
      ),
      pendingCashInSafe: bankableCash,
      verifiedToday: verificationQueue.filter((entry) => entry.workflowStatus === "verified").length,
      shiftsAwaitingVerification: verificationQueue.length,
      pendingDriverCashUps,
      expectedCashInHeadsUp: sumBy(pendingDriverCashUps, (entry) => entry.expectedCashIn),
      handoversAwaitingAdmin: verificationQueue.filter(
        (entry) => entry.workflowStatus === "pending",
      ).length,
      checksAwaitingManager: verificationQueue.filter(
        (entry) => entry.workflowStatus === "counted",
      ).length,
      globalFleetProfit:
        sumBy(settledIncome, getIncomeCashValue) - sumBy(settledExpenses, (record) => record.amount),
      operationalOverhead: sumBy(
        operationalExpenses.filter(
          (record) => record.status === "verified" || record.status === "banked",
        ),
        (record) => record.amount,
      ),
      vehicleOpenings,
      revenueLogging: {
        standardRouteCount: standardIncome.length,
        specialTripCount: specialIncome.length,
        standardRouteRevenue: sumBy(
          standardIncome,
          (record) => record.amountClaimed ?? record.amount,
        ),
        specialTripRevenue: sumBy(specialIncome, (record) => record.amount),
        routes: routeSeries,
        specialTrips: specialSeries,
      },
      expenseManagement: {
        vehicleSpecific: expenseSummary(assetExpenses),
        operational: expenseSummary(operationalExpenses),
      },
      expenseCatalog: collectExpensePresetCatalog(source.finance ?? {}, transactions),
      bankingBatch: {
        ...source.finance?.bankingBatch,
        reference: batchReference,
        verifiedTakings,
        cashExpenses: verifiedCashExpenses,
        depositAmount: bankableCash,
        depositSlip: {
          generatedAt:
            lockableVerificationQueue.length > 0
              ? formatStamp(latestVerifiedTimestamp)
              : deposits[0]?.timestamp
                ? formatStamp(deposits[0].timestamp)
                : "Ready to lock",
          teller: source.finance?.bankingBatch?.depositSlip?.teller ?? "Bank teller pending",
          recordsLocked: lockableVerificationQueue.length,
        },
      },
    },
  };
};

const getTransactionTone = (record) => {
  if (record.status === "banked") {
    return "navy";
  }
  if (record.status === "verified") {
    return "success";
  }
  return "warning";
};

const createStandardDraft = (vehicleId, openingOdo, route = "") =>
  syncStandardDraftTripLogbook({
    id: null,
    vehicleId: vehicleId ?? "",
    route,
    tripDate: toDateInputValue(),
    timeIn: "",
    timeOut: "",
    tripLogbook: createDailyTripLogbook(route),
    openingOdo: openingOdo != null ? String(openingOdo) : "",
    closingOdo: "",
    amountClaimed: "",
    editReason: "",
  });

const getStandardDraftValidationError = (draft) => {
  if (!draft.vehicleId) {
    return "Select a vehicle before saving the trip log.";
  }

  if (!draft.tripDate || !parseDateInputValue(draft.tripDate)) {
    return "Select the trip date.";
  }

  if (!parseTimeInputValue(draft.timeIn)) {
    return "Enter a valid time in.";
  }

  if (!parseTimeInputValue(draft.timeOut)) {
    return "Enter a valid time out.";
  }

  if ((getTimeInputMinutes(draft.timeOut) ?? 0) <= (getTimeInputMinutes(draft.timeIn) ?? 0)) {
    return "Time out must be later than time in.";
  }

  if (draft.openingOdo === "") {
    return "Opening odometer is required.";
  }

  const openingOdo = Number(draft.openingOdo);
  if (!Number.isFinite(openingOdo)) {
    return "Enter a valid opening odometer.";
  }

  if (draft.closingOdo === "") {
    return "Enter the closing odometer to save the trip log.";
  }

  const closingOdo = Number(draft.closingOdo);
  if (!Number.isFinite(closingOdo)) {
    return "Enter a valid closing odometer.";
  }
  if (closingOdo <= openingOdo) {
    return "Closing odometer must be greater than opening odometer.";
  }

  const tripLogbook = Array.isArray(draft.tripLogbook) ? draft.tripLogbook : [];
  if (tripLogbook.length === 0) {
    return "Add at least one trip to the daily logbook.";
  }

  for (const [index, entry] of tripLogbook.entries()) {
    const fromLocation = String(entry?.fromLocation ?? "").trim();
    const toLocation = String(entry?.toLocation ?? "").trim();
    const passengerValue = String(entry?.passengerCount ?? "").trim();
    const amountValue = String(entry?.amountCollected ?? "").trim();
    const passengerCount = Number(entry?.passengerCount);
    const amountCollected = Number(entry?.amountCollected);

    if (!fromLocation || !toLocation) {
      return `Complete the from and to stops for trip ${index + 1}.`;
    }
    if (fromLocation.toLowerCase() === toLocation.toLowerCase()) {
      return `Trip ${index + 1} must use two different stops.`;
    }
    if (!passengerValue) {
      return `Enter the passenger count for trip ${index + 1}.`;
    }
    if (!Number.isInteger(passengerCount) || passengerCount < 0) {
      return `Passenger count for trip ${index + 1} must be zero or more.`;
    }
    if (!amountValue) {
      return `Enter the amount collected for trip ${index + 1}.`;
    }
    if (!Number.isFinite(amountCollected) || amountCollected < 0) {
      return `Amount collected for trip ${index + 1} must be zero or more.`;
    }
  }

  return null;
};

const createSpecialDraft = (vehicleId) => ({
  id: null,
  vehicleId: vehicleId ?? "",
  tripDate: toDateInputValue(),
  openingOdo: "",
  closingOdo: "",
  fromLocation: "",
  toLocation: "",
  travelReason: "",
  fuelOilCost: "0",
  repairMaintenanceCost: "0",
  amount: "",
  editReason: "",
});

const getDriverEditReasonError = (draft, label) =>
  draft?.id && !String(draft?.editReason ?? "").trim()
    ? `Add a note explaining why you are updating this ${label}.`
    : null;

const getSpecialDraftValidationError = (draft) => {
  if (!draft.vehicleId) {
    return "Select a vehicle before saving the extra trip.";
  }

  if (!draft.tripDate || !parseDateInputValue(draft.tripDate)) {
    return "Select the travel date.";
  }

  if (draft.openingOdo === "") {
    return "Opening odometer is required.";
  }

  const openingOdo = Number(draft.openingOdo);
  if (!Number.isFinite(openingOdo)) {
    return "Enter a valid opening odometer.";
  }

  if (draft.closingOdo === "") {
    return "Enter the closing odometer to save the extra trip.";
  }

  const closingOdo = Number(draft.closingOdo);
  if (!Number.isFinite(closingOdo)) {
    return "Enter a valid closing odometer.";
  }
  if (closingOdo <= openingOdo) {
    return "Closing odometer must be greater than opening odometer.";
  }

  if (!draft.fromLocation?.trim()) {
    return "Enter where the business trip started.";
  }

  if (!draft.toLocation?.trim()) {
    return "Enter where the business trip ended.";
  }

  if (!draft.travelReason?.trim()) {
    return "Enter the business travel reason.";
  }

  const fuelOilCost = Number(draft.fuelOilCost ?? 0);
  if (!Number.isFinite(fuelOilCost) || fuelOilCost < 0) {
    return "Enter a valid fuel and oil cost.";
  }

  const repairMaintenanceCost = Number(draft.repairMaintenanceCost ?? 0);
  if (!Number.isFinite(repairMaintenanceCost) || repairMaintenanceCost < 0) {
    return "Enter a valid repairs and maintenance cost.";
  }

  if (draft.amount === "") {
    return "Enter the amount earned for the extra trip.";
  }

  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Amount earned must be greater than zero.";
  }

  return null;
};

const getExpenseDraftValidationError = (draft) => {
  if (draft.expenseKind === "asset" && !draft.vehicleId) {
    return "A vehicle must be linked before saving a daily expense.";
  }

  if (!draft.category?.trim()) {
    return "Enter an expense category.";
  }

  if (!draft.description?.trim()) {
    return "Enter an expense description.";
  }

  if (!draft.expenseDate || !parseDateInputValue(draft.expenseDate)) {
    return "Select the expense date.";
  }

  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter a valid expense amount.";
  }

  return null;
};

const createExpenseDraft = (expenseKind, vehicleId, expenseCatalog = null) => {
  const defaultCategory =
    getExpenseCatalogEntries(expenseCatalog, expenseKind)[0]?.name ??
    (expenseKind === "asset" ? "Fuel" : "Salary");
  const defaultDescription =
    getExpenseDescriptionOptions(expenseCatalog, expenseKind, defaultCategory)[0] ?? "";

  return {
    id: null,
    expenseKind,
    category: defaultCategory,
    description: defaultDescription,
    descriptionPreset: defaultDescription || EXPENSE_CUSTOM_DESCRIPTION_VALUE,
    expenseDate: toDateInputValue(),
    reference: "",
    vehicleId: vehicleId ?? "",
    amount: "",
    cashExpense: true,
    editReason: "",
  };
};

const createVehicleDraft = (vehicle, defaultInterval) => {
  const normalizedVehicle = normalizeVehicleCapabilityHooks(vehicle ?? {});

  return {
    id: vehicle?.id ?? null,
    registration: vehicle?.registration ?? "",
    model: vehicle?.model ?? "",
    route: vehicle?.route ?? "",
    utilisation: vehicle?.utilisation ?? 0,
    currentOdometer: vehicle?.currentOdometer ?? 0,
    lastServiceOdo: vehicle?.lastServiceOdo ?? 0,
    serviceIntervalKm: vehicle?.serviceIntervalKm ?? defaultInterval,
    permitExpiryDate: vehicle?.permitExpiryDate ?? "",
    discExpiryDate: vehicle?.discExpiryDate ?? "",
    assignedDriverId: vehicle?.assignedDriverId ?? "",
    status: vehicle?.status ?? "active",
    canDoRouteService: normalizedVehicle.canDoRouteService,
    canDoSpecialTrips: normalizedVehicle.canDoSpecialTrips,
    canDoContracts: normalizedVehicle.canDoContracts,
    seatCapacity: normalizedVehicle.seatCapacity,
    currentRouteId: normalizedVehicle.currentRouteId,
  };
};

const createRouteDraft = (route = null) => ({
  id: route?.id ?? null,
  name: route?.name ?? route?.route ?? "",
  code: route?.code ?? "",
  type: route?.type ?? "route_service",
  primaryOrigin: route?.primaryOrigin ?? "",
  primaryDestination: route?.primaryDestination ?? "",
  isActive: route?.isActive ?? true,
});

const createDriverDraft = (driver) => ({
  staffId: driver?.staffId ?? "",
  name: driver?.name ?? "",
  email: driver?.email ?? "",
  routeIds: Array.isArray(driver?.routeIds)
    ? driver.routeIds
    : Array.isArray(driver?.route_ids)
      ? driver.route_ids
      : driver?.primaryRouteId
        ? [driver.primaryRouteId]
        : buildRouteReferenceId(driver?.route)
          ? [buildRouteReferenceId(driver?.route)]
          : [],
  shiftStatus: driver?.shiftStatus ?? "Ready for dispatch",
  licenseNumber: driver?.licenseNumber ?? "",
  licenseCode: driver?.licenseCode ?? "",
  licenseExpiryDate: driver?.licenseExpiryDate ?? "",
  prdpNumber: driver?.prdpNumber ?? "",
  prdpExpiryDate: driver?.prdpExpiryDate ?? "",
  accessPassword: driver?.accessPassword ?? "",
});

const createDriverAllocationDraft = (staffId = "", vehicleId = "") => ({
  staffId,
  vehicleId,
});

const createDefectDraft = (vehicleId) => ({
  id: null,
  vehicleId: vehicleId ?? "",
  category: DEFECT_CATEGORIES[0],
  detail: "",
});

export {
  ZAR,
  VIEWER_ROLE,
  ROLES,
  AUTH_ACCOUNT_DIRECTORY,
  DEFAULT_DRIVER_ACCOUNT_EMAIL_BY_STAFF_ID,
  LOCAL_AUTH_STORAGE_KEY,
  LOCAL_AUTH_PASSWORD,
  ROLE_LANDING_VIEW,
  MODULE_EDIT_ACCESS,
  MODULE_VIEW_ACCESS,
  SETTINGS_ASSIGNABLE_MODULES,
  NAV_ITEMS,
  formatMoney,
  DEFECT_CATEGORIES,
  ROUTE_TYPE_OPTIONS,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_CUSTOM_DESCRIPTION_VALUE,
  DEFAULT_EXPENSE_PRESET_CATALOG,
  createRecordId,
  LIVE_SYNC_WARNING_MESSAGE,
  LIVE_SAVE_WARNING_MESSAGE,
  OPERATIONS_WORKFLOW,
  syncLiveWarning,
  isStandaloneDisplay,
  getQueueTone,
  canRecordCashHandoverForRole,
  canVerifyCashCheckForRole,
  canFinishDepositForRole,
  getVehicleReadinessOptions,
  matchesVehicleReadiness,
  getVehicleTone,
  getDocumentTone,
  getDefectTone,
  toneLabel,
  PRIVILEGED_ROLES,
  PASSWORD_RESET_ROLES,
  DRIVER_SHORTCUTS,
  createModuleAccessState,
  normalizeModuleAccessState,
  normalizePermissionControls,
  getPermissionControls,
  getStoredAppUserByIdentity,
  getModuleAccessStatus,
  canEditModuleUpdates,
  getModuleAccessErrorMessage,
  normalizeRole,
  isViewerRole,
  createDefaultModuleViewAccess,
  normalizeModuleViewAccess,
  sanitizeEmailLocalPart,
  normalizeEmailAddress,
  isValidEmailAddress,
  buildRouteReferenceId,
  normalizeVehicleCapabilityHooks,
  createGeneratedLocalEmail,
  sortAppUsers,
  normalizeAppUser,
  buildDefaultAppUsers,
  getAppUsers,
  getAppUserByEmail,
  canAssignRoleToUser,
  canAssignModuleToRole,
  createUserAccessDraft,
  resolveAuthIdentity,
  getAuthSessionRole,
  createLocalAuthSession,
  readStoredLocalAuthSession,
  persistLocalAuthSession,
  clearStoredLocalAuthSession,
  formatTime,
  formatStamp,
  parseDateInputValue,
  toDateInputValue,
  formatDateOnly,
  parseTimeInputValue,
  toTimeInputValue,
  formatTimeOnly,
  getTimeInputMinutes,
  normalizeOptionalText,
  normalizeOptionalNumber,
  getComputedKmValue,
  getTripDurationMinutes,
  buildTripAnalyticsFields,
  buildDailyAnalyticsFields,
  createTimestampFromDateInput,
  createTimestampFromDateTimeInput,
  formatExpenseHeadline,
  formatExpenseMeta,
  getRouteStops,
  getRoutePointLabels,
  buildRoutePointReference,
  getDefaultRouteStopType,
  normalizeRoutePointRecord,
  normalizeRoutePointRecords,
  buildRouteCode,
  normalizeRouteMasterRecord,
  mergeRouteMasterRecord,
  collectRouteMasterRecords,
  normalizeDriverRouteAssignments,
  getDriverRouteSummary,
  resolveVehicleRouteSelection,
  normalizeExpensePresetName,
  buildExpensePresetId,
  normalizeExpensePresetRecord,
  mergeExpensePresetRecord,
  normalizeExpensePresetCatalog,
  collectExpensePresetCatalog,
  getExpenseCatalogEntries,
  getExpenseCategoryOptions,
  getExpenseDescriptionOptions,
  getExpenseDescriptionPresetValue,
  syncExpenseDraftCategory,
  syncExpenseDraftDescriptionPreset,
  createExpensePresetDraft,
  createDailyTripLogEntry,
  createDailyTripLogbook,
  getDailyTripLogbookTotals,
  getDailyTripTripCount,
  getDailyTripPassengerTotal,
  syncStandardDraftTripLogbook,
  buildStandardTripLogbookDraft,
  getBusinessKmValue,
  formatTripRoute,
  formatTripLogMeta,
  formatDailyTripMeta,
  hasMetricValue,
  formatOptionalMetric,
  formatOptionalMoney,
  formatTransactionStatus,
  formatShortcutLabel,
  createEmptyDriverDayCashSummary,
  getFinanceRecordWorkDate,
  getFinanceRecordDriverStaffId,
  getFinanceRecordDriverName,
  normalizeCashUpIdToken,
  getDailyCashUpStableId,
  buildDriverCashLedgerEntry,
  resolveDriverWorkDate,
  buildDriverDayCashSummary,
  normalizeCashUpWorkflowStatus,
  getFinanceRecordCashUpCoverageKey,
  getCashUpCoverageKey,
  buildCashUpTransactionIds,
  syncTransactionsForDriverCashUp,
  isDriverCreatedFinanceRecord,
  buildDriverCashUpAnalytics,
  getDriverCashUpGapKm,
  getDriverCashUpWorkflowStatus,
  getDriverCashUpWorkflow,
  buildDriverCashUpQueueEntry,
  buildDriverCashUpQueue,
  buildRecordChangeLabel,
  formatRecordMoneyChange,
  formatRecordCountChange,
  formatRecordDistanceChange,
  formatRecordTextChange,
  formatRecordPaymentChange,
  buildFinanceRecordChangeSummary,
  buildDriverRecordEditTracking,
  getRecordLastEditNote,
  createAuditEvent,
  appendAuditTrail,
  getAuditTone,
  getAuditActionLabel,
  getAuditActorLabel,
  getPasswordResetEmailNotice,
  buildHistoricalAuditTrail,
  sumBy,
  getIncomeCashValue,
  getCurrentActorId,
  buildDepositReference,
  getExpectedOpeningOdo,
  getDriverLinkedVehicles,
  deriveQueueStatus,
  getDaysLeft,
  getDocumentStage,
  getServiceTone,
  getVehicleHealthState,
  deriveSnapshot,
  getTransactionTone,
  createStandardDraft,
  getStandardDraftValidationError,
  createSpecialDraft,
  getDriverEditReasonError,
  getSpecialDraftValidationError,
  getExpenseDraftValidationError,
  createExpenseDraft,
  createVehicleDraft,
  createRouteDraft,
  createDriverDraft,
  createDriverAllocationDraft,
  createDefectDraft
};
