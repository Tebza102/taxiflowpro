import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInDays } from "date-fns";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Banknote,
  Briefcase,
  Building2,
  Calendar,
  Car,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  FileText,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Settings2,
  Shield,
  ShieldAlert,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import {
  calculateDailyAnalytics,
  calculateKmComputed,
  calculateTripAnalytics,
  calculateTripDurationMin,
} from "./lib/analytics";
import { TripLegOptionalFields } from "./components/TripLegOptionalFields";
import { repository } from "./lib/dataGateway";
import { hasSupabaseConfig, supabase } from "./lib/supabaseClient";

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const ROLES = ["Owner", "Admin", "Manager", "Driver"];
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
    roles: ["Owner", "Admin", "Manager"],
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
    roles: ["Owner", "Admin", "Manager"],
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
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator?.standalone === true,
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

const createDefaultModuleViewAccess = (role) => {
  const normalizedRole = normalizeRole(role) ?? "Driver";

  if (normalizedRole === "Owner") {
    return Object.fromEntries(Object.keys(MODULE_VIEW_ACCESS).map((moduleKey) => [moduleKey, true]));
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

const createLocalAuthSession = (email, account = null) => ({
  user: {
    email,
    app_metadata: account
      ? {
          role: account.role,
          staffId: account.actorId,
        }
      : {},
    user_metadata: {},
  },
});

const readStoredLocalAuthSession = () => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const email = window.localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);

    return email ? createLocalAuthSession(String(email).trim().toLowerCase()) : null;
  } catch {
    return null;
  }
};

const persistLocalAuthSession = (email) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, email);
  } catch {
    // Ignore storage failures and continue in-memory.
  }
};

const clearStoredLocalAuthSession = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
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

function App() {
  const authEnabled = hasSupabaseConfig && Boolean(supabase);
  const authProviderLabel = authEnabled ? "Supabase authentication" : "Local setup authentication";
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [backendMode, setBackendMode] = useState(() => repository.backendMode);
  const [backendFeedback, setBackendFeedback] = useState(null);
  const [liveLoadWarning, setLiveLoadWarning] = useState(null);
  const [liveSaveWarning, setLiveSaveWarning] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [installPromptOpen, setInstallPromptOpen] = useState(false);
  const [pwaInstalled, setPwaInstalled] = useState(() => isStandaloneDisplay());
  const [activeRole, setActiveRole] = useState("Owner");
  const [activeView, setActiveView] = useState("overview");
  const [driverShortcutIntent, setDriverShortcutIntent] = useState(null);
  const [authSession, setAuthSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [factoryResetSubmitting, setFactoryResetSubmitting] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authRecoveryFeedback, setAuthRecoveryFeedback] = useState(null);
  const [authDraft, setAuthDraft] = useState({
    email: "",
    password: "",
  });
  const latestSnapshotRef = useRef(null);
  const latestBackendModeRef = useRef(repository.backendMode);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const displayModeQuery = window.matchMedia?.("(display-mode: standalone)");
    const syncInstallState = () => {
      const installed = isStandaloneDisplay();
      setPwaInstalled(installed);

      if (installed) {
        setInstallPromptEvent(null);
        setInstallPromptOpen(false);
      }
    };

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
      syncInstallState();
    };

    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setInstallPromptOpen(false);
      setPwaInstalled(true);
    };

    syncInstallState();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    if (displayModeQuery?.addEventListener) {
      displayModeQuery.addEventListener("change", syncInstallState);
    } else if (displayModeQuery?.addListener) {
      displayModeQuery.addListener(syncInstallState);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);

      if (displayModeQuery?.removeEventListener) {
        displayModeQuery.removeEventListener("change", syncInstallState);
      } else if (displayModeQuery?.removeListener) {
        displayModeQuery.removeListener(syncInstallState);
      }
    };
  }, []);

  useEffect(() => {
    if (!authEnabled) {
      setAuthSession(readStoredLocalAuthSession());
      setAuthLoading(false);
      return undefined;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) {
          return;
        }

        setAuthSession(data.session ?? null);
        setAuthError(error?.message ?? null);
        setAuthLoading(false);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setAuthError(error.message);
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }

      setAuthSession(session ?? null);
      setAuthError(null);
      setAuthLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [authEnabled]);

  useEffect(() => {
    if (authEnabled && authLoading) {
      return undefined;
    }

    let isMounted = true;

    setLoading(true);
    repository
      .loadSnapshot(backendMode)
      .then((data) => {
        if (isMounted) {
          syncLiveWarning(
            setLiveLoadWarning,
            backendMode === "live" && (data?.ok === false || data?.warning)
              ? LIVE_SYNC_WARNING_MESSAGE
              : null,
          );
          setSnapshot(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          syncLiveWarning(
            setLiveLoadWarning,
            backendMode === "live" ? LIVE_SYNC_WARNING_MESSAGE : null,
          );
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [authEnabled, authLoading, authSession?.user?.id, backendMode]);

  useEffect(() => {
    if (loading || !snapshot) {
      return undefined;
    }

    let isCurrent = true;

    repository
      .persistSnapshot(snapshot, backendMode)
      .then((result) => {
        if (!isCurrent) {
          return;
        }

        syncLiveWarning(
          setLiveSaveWarning,
          backendMode === "live" && (result?.ok === false || result?.warning)
            ? LIVE_SAVE_WARNING_MESSAGE
            : null,
        );
      })
      .catch(() => {
        if (!isCurrent) {
          return;
        }

        syncLiveWarning(
          setLiveSaveWarning,
          backendMode === "live" ? LIVE_SAVE_WARNING_MESSAGE : null,
        );
      });

    return () => {
      isCurrent = false;
    };
  }, [backendMode, loading, snapshot]);

  useEffect(() => {
    if (backendMode !== "live" || (authEnabled && (authLoading || !authSession))) {
      return undefined;
    }

    let isCurrent = true;

    const flushPendingLiveSave = async () => {
      const result = await repository.flushPendingLiveSnapshot();

      if (!isCurrent) {
        return;
      }

      syncLiveWarning(
        setLiveSaveWarning,
        result?.ok === false || result?.warning ? LIVE_SAVE_WARNING_MESSAGE : null,
      );
    };

    void flushPendingLiveSave();

    if (typeof window === "undefined") {
      return () => {
        isCurrent = false;
      };
    }

    const handleOnline = () => {
      void flushPendingLiveSave();
    };
    const retryId = window.setInterval(handleOnline, 30_000);

    window.addEventListener("online", handleOnline);

    return () => {
      isCurrent = false;
      window.clearInterval(retryId);
      window.removeEventListener("online", handleOnline);
    };
  }, [authEnabled, authLoading, authSession, backendMode]);

  useEffect(() => {
    if (backendMode === "live") {
      return;
    }

    syncLiveWarning(setLiveLoadWarning, null);
    syncLiveWarning(setLiveSaveWarning, null);
  }, [backendMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handlePageHide = () => {
      if (!latestSnapshotRef.current) {
        return;
      }

      void repository.persistSnapshot(
        latestSnapshotRef.current,
        latestBackendModeRef.current,
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || !latestSnapshotRef.current) {
        return;
      }

      void repository.persistSnapshot(
        latestSnapshotRef.current,
        latestBackendModeRef.current,
      );
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const currentSnapshot = useMemo(() => deriveSnapshot(snapshot), [snapshot]);
  const liveOperationalWarning = useMemo(
    () => (backendMode === "live" ? liveLoadWarning ?? liveSaveWarning : null),
    [backendMode, liveLoadWarning, liveSaveWarning],
  );
  const appUsers = useMemo(() => getAppUsers(currentSnapshot), [currentSnapshot]);
  const permissionControls = useMemo(
    () => getPermissionControls(currentSnapshot),
    [currentSnapshot],
  );
  const authIdentity = useMemo(
    () => resolveAuthIdentity(authSession?.user ?? null, currentSnapshot),
    [authSession, currentSnapshot],
  );
  const authModuleAccess = useMemo(
    () => normalizeModuleViewAccess(authIdentity?.moduleAccess, authIdentity?.role),
    [authIdentity],
  );
  const currentUserRecord = useMemo(
    () => getStoredAppUserByIdentity(currentSnapshot, authIdentity),
    [authIdentity, currentSnapshot],
  );

  useEffect(() => {
    latestSnapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    latestBackendModeRef.current = backendMode;
  }, [backendMode]);

  const authDisplayName = useMemo(() => {
    if (!authIdentity || !currentSnapshot) {
      return authIdentity?.email ?? null;
    }

    return authIdentity.name ?? authIdentity.email;
  }, [authIdentity, currentSnapshot]);

  useEffect(() => {
    if (!authIdentity?.role) {
      return;
    }

    setActiveRole(authIdentity.role);
  }, [authIdentity]);

  useEffect(() => {
    if (authIdentity?.role !== "Driver") {
      return;
    }

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const derived = deriveSnapshot(current);
      const driver = derived.drivers.find((candidate) => candidate.staffId === authIdentity.actorId);

      if (!driver) {
        return current;
      }

      const linkedVehicles = derived.vehicles.filter(
        (vehicle) => vehicle.assignedDriverId === driver.staffId,
      );
      const linkedVehicleIds = linkedVehicles.map((vehicle) => vehicle.id);
      const currentLinkedIds = current.driverTerminal?.linkedVehicleIds ?? [];
      const assignedVehicle =
        linkedVehicles.find((vehicle) => vehicle.id === current.driverTerminal?.assignedVehicleId) ??
        linkedVehicles[0] ??
        null;
      const nextAssignedVehicleLabel = assignedVehicle?.registration ?? "No vehicle linked";
      const nextAssignedRoute = assignedVehicle?.route ?? driver.route ?? "No route assigned";
      const sameLinkedVehicles =
        linkedVehicleIds.length === currentLinkedIds.length &&
        linkedVehicleIds.every((vehicleId, index) => vehicleId === currentLinkedIds[index]);

      if (
        current.driverTerminal?.activeDriverId === driver.staffId &&
        current.driverTerminal?.activeDriver === driver.name &&
        current.driverTerminal?.assignedVehicleId === (assignedVehicle?.id ?? null) &&
        current.driverTerminal?.assignedVehicle === nextAssignedVehicleLabel &&
        current.driverTerminal?.assignedRoute === nextAssignedRoute &&
        sameLinkedVehicles
      ) {
        return current;
      }

      return {
        ...current,
        driverTerminal: {
          ...current.driverTerminal,
          activeDriverId: driver.staffId,
          activeDriver: driver.name,
          assignedVehicleId: assignedVehicle?.id ?? null,
          assignedVehicle: nextAssignedVehicleLabel,
          assignedRoute: nextAssignedRoute,
          linkedVehicleIds,
        },
      };
    });
  }, [authIdentity, snapshot]);

  useEffect(() => {
    if (!authIdentity?.role) {
      return;
    }

    setActiveView(ROLE_LANDING_VIEW[authIdentity.role] ?? "overview");
    setDriverShortcutIntent(null);
  }, [authIdentity?.email, authIdentity?.role]);

  const allowedViews = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) => item.roles.includes(activeRole) && Boolean(authModuleAccess[item.id]),
      ),
    [activeRole, authModuleAccess],
  );

  useEffect(() => {
    if (!allowedViews.some((item) => item.id === activeView)) {
      setActiveView(allowedViews[0]?.id ?? "overview");
    }
  }, [activeRole, activeView, allowedViews]);

  if (loading || !snapshot || authLoading) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <Loader2 className="spin" size={36} />
          <p className="eyebrow">Initialising TaxiFlow Pro</p>
          <h1>{authEnabled ? "Restoring secure session" : "Loading access screen"}</h1>
        </div>
      </div>
    );
  }

  const resolveCurrentActorId = (current) => getCurrentActorId(activeRole, current, authIdentity);

  const buildCurrentAuditEvent = (current, event) =>
    createAuditEvent({
      ...event,
      actorId: event.actorId ?? resolveCurrentActorId(current),
      actorRole: event.actorRole ?? activeRole,
    });

  const hasModuleUpdateAccess = (current, moduleKey) =>
    canEditModuleUpdates(
      activeRole,
      moduleKey,
      getPermissionControls(current),
      getStoredAppUserByIdentity(current, authIdentity),
    );

  const updateAuthDraft = (updater) => {
    setAuthRecoveryFeedback(null);
    setAuthDraft(updater);
  };

  const buildPasswordResetEmailNotice = ({
    requestId,
    timestamp,
    normalizedEmail,
    mappedAccount,
    recipientEmails,
  }) => ({
    id: createRecordId("mail"),
    channel: "email",
    createdAt: timestamp,
    relatedRequestId: requestId,
    recipients: recipientEmails,
    subject: `TaxiFlow password reset request / ${normalizedEmail}`,
    preview: mappedAccount
      ? `${mappedAccount.name} (${mappedAccount.role}) requested a password reset.`
      : `${normalizedEmail} requested a password reset from the sign-in screen.`,
    body: [
      `TaxiFlow password reset requested for ${normalizedEmail}.`,
      mappedAccount?.name ? `Account name: ${mappedAccount.name}.` : "Account name not mapped.",
      mappedAccount?.role ? `Role: ${mappedAccount.role}.` : "Role not mapped.",
      `Requested at: ${formatStamp(timestamp)}.`,
      "Management must reset the password and contact the user.",
    ].join(" "),
    status: "queued",
  });

  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    setAuthSubmitting(true);
    setAuthError(null);
    setAuthRecoveryFeedback(null);

    const normalizedEmail = authDraft.email.trim().toLowerCase();

    if (!authEnabled) {
      const account = getAppUserByEmail(currentSnapshot, normalizedEmail);

      if (!account) {
        setAuthError("This email is not assigned to a TaxiFlow account.");
        setAuthSubmitting(false);
        return;
      }

      const expectedPassword = account.accessPassword ?? LOCAL_AUTH_PASSWORD;

      if (authDraft.password !== expectedPassword) {
        setAuthError("Incorrect password for this TaxiFlow account.");
        setAuthSubmitting(false);
        return;
      }

      const session = createLocalAuthSession(normalizedEmail, account);
      persistLocalAuthSession(normalizedEmail);
      setAuthSession(session);
      setAuthDraft((current) => ({
        ...current,
        password: "",
      }));
      setAuthSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: authDraft.password,
    });

    if (error) {
      setAuthError(error.message);
      setAuthSubmitting(false);
      return;
    }

    setAuthDraft((current) => ({
      ...current,
      password: "",
    }));
    setAuthSubmitting(false);
  };

  const handlePasswordResetRequest = () => {
    const normalizedEmail = normalizeEmailAddress(authDraft.email);

    if (!normalizedEmail) {
      setAuthRecoveryFeedback({
        tone: "danger",
        message: "Enter the email assigned to your TaxiFlow account before sending a reset request.",
      });
      return;
    }

    if (!isValidEmailAddress(normalizedEmail)) {
      setAuthRecoveryFeedback({
        tone: "danger",
        message: "Enter a valid TaxiFlow email address before sending a reset request.",
      });
      return;
    }

    let response = { ok: false, error: "Unable to send the password reset request." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const currentUsers = getAppUsers(current);
      const managementRecipients = Array.from(
        new Map(
          currentUsers
            .filter((user) => PRIVILEGED_ROLES.has(user.role))
            .map((user) => [normalizeEmailAddress(user.email), normalizeAppUser(user)]),
        ).values(),
      );

      if (managementRecipients.length === 0) {
        response = {
          ok: false,
          error: "No management accounts are available yet to receive this reset request.",
        };
        return current;
      }

      const mappedAccount = getAppUserByEmail(current, normalizedEmail);
      const timestamp = new Date().toISOString();
      const recipientEmails = managementRecipients.map((user) => user.email);
      const existingPendingRequest =
        (current.passwordResetRequests ?? []).find(
          (request) =>
            normalizeEmailAddress(request.email) === normalizedEmail &&
            String(request.status ?? "pending").trim().toLowerCase() === "pending",
        ) ?? null;

      if (existingPendingRequest) {
        const hasEmailNotice = Boolean(
          getPasswordResetEmailNotice(current.emailOutbox ?? [], existingPendingRequest.id),
        );
        const nextRequest = {
          ...existingPendingRequest,
          accountName: mappedAccount?.name ?? existingPendingRequest.accountName ?? normalizedEmail,
          accountRole: mappedAccount?.role ?? existingPendingRequest.accountRole ?? null,
          managementRecipients: recipientEmails,
          note:
            mappedAccount
              ? null
              : existingPendingRequest.note ?? "Email not mapped to a current TaxiFlow account.",
          notificationStatus: "sent",
          notificationSentAt:
            existingPendingRequest.notificationSentAt ??
            existingPendingRequest.requestedAt ??
            timestamp,
        };
        const nextEmail = hasEmailNotice
          ? null
          : buildPasswordResetEmailNotice({
              requestId: existingPendingRequest.id,
              timestamp,
              normalizedEmail,
              mappedAccount,
              recipientEmails,
            });

        response = {
          ok: true,
          message: hasEmailNotice
            ? "Management has already been notified in-app and by email. They will reset the password for this account."
            : "The in-app management notice is already active. TaxiFlow queued the missing management email again for this password reset.",
        };

        return {
          ...current,
          passwordResetRequests: (current.passwordResetRequests ?? []).map((request) =>
            request.id === existingPendingRequest.id ? nextRequest : request,
          ),
          emailOutbox: nextEmail ? [nextEmail, ...(current.emailOutbox ?? [])] : current.emailOutbox ?? [],
          auditTrail: nextEmail
            ? appendAuditTrail(current.auditTrail, [
                createAuditEvent({
                  timestamp,
                  scope: "system",
                  action: "request",
                  entityType: "password-reset-email",
                  entityId: existingPendingRequest.id,
                  title: `Password reset email requeued / ${normalizedEmail}`,
                  detail: `Management email queue ${recipientEmails.join(", ")}`,
                  actorId: normalizedEmail,
                  actorRole: "Unauthenticated",
                }),
              ])
            : current.auditTrail,
        };
      }

      const requestId = createRecordId("pwd");
      const nextRequest = {
        id: requestId,
        email: normalizedEmail,
        accountName: mappedAccount?.name ?? normalizedEmail,
        accountRole: mappedAccount?.role ?? null,
        requestedAt: timestamp,
        requestedVia: "Sign-in screen",
        status: "pending",
        managementRecipients: recipientEmails,
        note: mappedAccount ? null : "Email not mapped to a current TaxiFlow account.",
        notificationStatus: "sent",
        notificationSentAt: timestamp,
      };
      const nextEmail = buildPasswordResetEmailNotice({
        requestId,
        timestamp,
        normalizedEmail,
        mappedAccount,
        recipientEmails,
      });

      response = {
        ok: true,
        message:
          "Management has been notified in-app and the email queue has been created. They will reset the password for this account.",
      };

      return {
        ...current,
        passwordResetRequests: [nextRequest, ...(current.passwordResetRequests ?? [])],
        emailOutbox: [nextEmail, ...(current.emailOutbox ?? [])],
        auditTrail: appendAuditTrail(current.auditTrail, [
          createAuditEvent({
            timestamp,
            scope: "system",
            action: "request",
            entityType: "password-reset",
            entityId: requestId,
            title: `Password reset requested / ${normalizedEmail}`,
            detail: `Sign-in screen / Email queue ${recipientEmails.join(", ")}`,
            actorId: normalizedEmail,
            actorRole: "Unauthenticated",
          }),
        ]),
      };
    });

    setAuthError(null);

    if (response.ok) {
      setAuthDraft((current) => ({
        ...current,
        password: "",
      }));
    }

    setAuthRecoveryFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  const handleSignOut = async () => {
    setAuthSubmitting(true);

    const latestSnapshot = latestSnapshotRef.current;
    if (latestSnapshot) {
      const persistResult = await repository.persistSnapshot(
        latestSnapshot,
        latestBackendModeRef.current,
      );

      syncLiveWarning(
        setLiveSaveWarning,
        latestBackendModeRef.current === "live" &&
          (persistResult?.ok === false || persistResult?.warning)
          ? LIVE_SAVE_WARNING_MESSAGE
          : null,
      );
    }

    if (!authEnabled) {
      clearStoredLocalAuthSession();
      setAuthSession(null);
      setAuthError(null);
      setAuthDraft((current) => ({
        ...current,
        password: "",
      }));
      setAuthSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthError(error.message);
    } else {
      setAuthSession(null);
      setAuthDraft((current) => ({
        ...current,
        password: "",
      }));
    }

    setAuthSubmitting(false);
  };

  if (!authSession) {
    return (
      <SignInShell
        authProviderLabel={authProviderLabel}
        email={authDraft.email}
        error={authError}
        fleetName={currentSnapshot.profile.fleetName}
        isLocalAuth={!authEnabled}
        onChange={updateAuthDraft}
        onRequestPasswordReset={handlePasswordResetRequest}
        onSubmit={handleAuthSubmit}
        password={authDraft.password}
        passwordResetFeedback={authRecoveryFeedback}
        submitting={authSubmitting}
      />
    );
  }

  if (!authIdentity) {
    return (
      <AccessDeniedShell
        email={authSession?.user?.email ?? "Unknown account"}
        onSignOut={handleSignOut}
      />
    );
  }

  const requestAdminModuleAccess = (moduleKey) => {
    let result = { ok: false, error: "Unable to send this permission request." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (activeRole !== "Manager") {
        result = { ok: false, error: "Only a manager can ask the owner for admin edit access." };
        return current;
      }
      if (!MODULE_EDIT_ACCESS[moduleKey]) {
        result = { ok: false, error: "Permission area not found." };
        return current;
      }

      const currentControls = getPermissionControls(current);
      const targetControl = currentControls[moduleKey];

      if (targetControl.requestStatus === "pending") {
        result = { ok: false, error: "This request is already waiting for the owner." };
        return current;
      }

      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextControl = {
        ...targetControl,
        requestStatus: "pending",
        requestedAt: timestamp,
        requestedBy: actorId,
        requestedByRole: activeRole,
        ownerReviewedAt: null,
        ownerReviewedBy: null,
        ownerReviewedByRole: null,
        active: false,
        grantedAt: null,
        grantedBy: null,
        grantedByRole: null,
      };

      result = {
        ok: true,
        message: `Owner approval requested for admin edits in ${MODULE_EDIT_ACCESS[moduleKey].label}.`,
      };

      return {
        ...current,
        permissionControls: {
          ...currentControls,
          [moduleKey]: nextControl,
        },
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp,
            scope: "system",
            action: "request",
            entityType: "permission",
            entityId: moduleKey,
            title: `Admin edit access requested / ${MODULE_EDIT_ACCESS[moduleKey].label}`,
            detail: "Manager asked the owner for approval.",
          }),
        ]),
      };
    });

    return result;
  };

  const reviewAdminModuleAccess = (moduleKey, nextDecision) => {
    let result = { ok: false, error: "Unable to review this permission request." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (activeRole !== "Owner") {
        result = { ok: false, error: "Only the owner can review admin edit requests." };
        return current;
      }
      if (!MODULE_EDIT_ACCESS[moduleKey]) {
        result = { ok: false, error: "Permission area not found." };
        return current;
      }

      const currentControls = getPermissionControls(current);
      const targetControl = currentControls[moduleKey];

      if (targetControl.requestStatus !== "pending") {
        result = { ok: false, error: "There is no waiting request for this area." };
        return current;
      }

      const approved = nextDecision === "approved";
      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextControl = {
        ...targetControl,
        requestStatus: approved ? "approved" : "rejected",
        ownerReviewedAt: timestamp,
        ownerReviewedBy: actorId,
        ownerReviewedByRole: activeRole,
        active: approved ? targetControl.active : false,
        grantedAt: approved ? targetControl.grantedAt : null,
        grantedBy: approved ? targetControl.grantedBy : null,
        grantedByRole: approved ? targetControl.grantedByRole : null,
      };

      result = {
        ok: true,
        message: approved
          ? `Owner approved admin edit access for ${MODULE_EDIT_ACCESS[moduleKey].label}.`
          : `Owner declined admin edit access for ${MODULE_EDIT_ACCESS[moduleKey].label}.`,
      };

      return {
        ...current,
        permissionControls: {
          ...currentControls,
          [moduleKey]: nextControl,
        },
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp,
            scope: "system",
            action: approved ? "approve" : "reject",
            entityType: "permission",
            entityId: moduleKey,
            title: `Admin edit access ${approved ? "approved" : "declined"} / ${
              MODULE_EDIT_ACCESS[moduleKey].label
            }`,
            detail: approved
              ? "Manager can now grant admin access."
              : "Admin edit access stays locked.",
          }),
        ]),
      };
    });

    return result;
  };

  const setAdminModuleAccess = (moduleKey, nextActive) => {
    let result = { ok: false, error: "Unable to change admin access." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!["Owner", "Manager"].includes(activeRole)) {
        result = { ok: false, error: "Only the owner or manager can change admin access." };
        return current;
      }
      if (!MODULE_EDIT_ACCESS[moduleKey]) {
        result = { ok: false, error: "Permission area not found." };
        return current;
      }

      const currentControls = getPermissionControls(current);
      const targetControl = currentControls[moduleKey];

      if (nextActive && targetControl.requestStatus !== "approved") {
        result = {
          ok: false,
          error: "Owner approval is still required before admin access can be granted.",
        };
        return current;
      }
      if (!nextActive && !targetControl.active) {
        result = { ok: false, error: "Admin access is already off for this area." };
        return current;
      }

      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextControl = {
        ...targetControl,
        active: nextActive,
        grantedAt: nextActive ? timestamp : null,
        grantedBy: nextActive ? actorId : null,
        grantedByRole: nextActive ? activeRole : null,
      };

      result = {
        ok: true,
        message: nextActive
          ? `Admin can now edit ${MODULE_EDIT_ACCESS[moduleKey].label} records.`
          : `Admin edit access removed from ${MODULE_EDIT_ACCESS[moduleKey].label}.`,
      };

      return {
        ...current,
        permissionControls: {
          ...currentControls,
          [moduleKey]: nextControl,
        },
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp,
            scope: "system",
            action: nextActive ? "grant" : "revoke",
            entityType: "permission",
            entityId: moduleKey,
            title: `Admin edit access ${nextActive ? "granted" : "removed"} / ${
              MODULE_EDIT_ACCESS[moduleKey].label
            }`,
            detail: nextActive
              ? "Admin can now update saved records in this area."
              : "Admin must wait for the next manager grant.",
          }),
        ]),
      };
    });

    return result;
  };

  const saveUserAccess = (draft) => {
    let result = { ok: false, error: "Unable to save this user access change." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (activeRole !== "Owner") {
        result = { ok: false, error: "Only the owner can change roles and access rights." };
        return current;
      }

      const currentUsers = getAppUsers(current);
      const existingUser =
        currentUsers.find(
          (user) =>
            user.id === draft.id ||
            user.email === String(draft.email ?? "").trim().toLowerCase(),
        ) ?? null;

      if (!existingUser) {
        result = { ok: false, error: "This user account could not be found." };
        return current;
      }

      if (existingUser.email === String(authSession?.user?.email ?? "").trim().toLowerCase()) {
        result = {
          ok: false,
          error: "Use another owner account if you need to change the signed-in owner profile.",
        };
        return current;
      }

      const nextRole = normalizeRole(draft.role);
      if (!nextRole) {
        result = { ok: false, error: "Select a valid TaxiFlow role." };
        return current;
      }

      const nextAccessPassword = String(draft.nextAccessPassword ?? "").trim();
      if (nextAccessPassword && nextAccessPassword.length < 6) {
        result = {
          ok: false,
          error: "Reset password must be at least 6 characters long.",
        };
        return current;
      }

      if (!canAssignRoleToUser(nextRole, existingUser)) {
        result = {
          ok: false,
          error: "This account must be linked to a driver profile before it can use the Driver role.",
        };
        return current;
      }

      const ownerCount = currentUsers.filter((user) => user.role === "Owner").length;
      if (existingUser.role === "Owner" && nextRole !== "Owner" && ownerCount <= 1) {
        result = { ok: false, error: "TaxiFlow must always keep at least one owner account." };
        return current;
      }

      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const resolvedRequestIds = nextAccessPassword
        ? (current.passwordResetRequests ?? [])
            .filter(
              (request) =>
                normalizeEmailAddress(request.email) === existingUser.email &&
                String(request.status ?? "pending").trim().toLowerCase() === "pending",
            )
            .map((request) => request.id)
        : [];
      const nextUser = normalizeAppUser({
        ...existingUser,
        role: nextRole,
        accessPassword: nextAccessPassword || existingUser.accessPassword,
        moduleAccess: normalizeModuleViewAccess(draft.moduleAccess, nextRole),
        updatedAt: timestamp,
        updatedBy: actorId,
        updatedByRole: activeRole,
      });
      const nextUsers = sortAppUsers(
        currentUsers.map((user) => (user.email === existingUser.email ? nextUser : normalizeAppUser(user))),
      );
      const nextDrivers =
        nextAccessPassword && existingUser.staffId
          ? (current.drivers ?? []).map((driver) =>
              driver.staffId === existingUser.staffId
                ? {
                    ...driver,
                    accessPassword: nextAccessPassword,
                    updatedAt: timestamp,
                    updatedBy: actorId,
                    updatedByRole: activeRole,
                  }
                : driver,
            )
          : current.drivers ?? [];
      const enabledModules = SETTINGS_ASSIGNABLE_MODULES.filter(
        (moduleKey) => nextUser.moduleAccess[moduleKey],
      ).map((moduleKey) => MODULE_VIEW_ACCESS[moduleKey].label);
      const nextPasswordResetRequests = resolvedRequestIds.length
        ? (current.passwordResetRequests ?? []).map((request) =>
            resolvedRequestIds.includes(request.id)
              ? {
                  ...request,
                  status: "resolved",
                  notificationStatus: "sent",
                  notificationSentAt:
                    request.notificationSentAt ?? request.requestedAt ?? timestamp,
                  resolvedAt: timestamp,
                  resolvedBy: actorId,
                  resolvedByRole: activeRole,
                }
              : request,
          )
        : current.passwordResetRequests ?? [];
      const nextEmailOutbox = resolvedRequestIds.length
        ? (current.emailOutbox ?? []).map((entry) =>
            resolvedRequestIds.includes(entry.relatedRequestId) &&
            String(entry.status ?? "queued").trim().toLowerCase() === "queued"
              ? {
                  ...entry,
                  status: "actioned",
                  actionedAt: timestamp,
                  actionedBy: actorId,
                }
              : entry,
          )
        : current.emailOutbox ?? [];

      result = {
        ok: true,
        message: `${nextUser.name} updated as ${nextUser.role}.${nextAccessPassword ? " Password reset saved." : ""}`,
      };

      return {
        ...current,
        appUsers: nextUsers,
        drivers: nextDrivers,
        passwordResetRequests: nextPasswordResetRequests,
        emailOutbox: nextEmailOutbox,
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp,
            scope: "system",
            action: "update",
            entityType: "user-access",
            entityId: nextUser.id,
            title: `User access updated / ${nextUser.name}`,
            detail: [
              nextUser.email,
              `Role ${nextUser.role}`,
              enabledModules.length > 0
                ? `Rights ${enabledModules.join(", ")}`
                : "Rights overview only",
              nextAccessPassword ? "Local password reset saved" : null,
              resolvedRequestIds.length > 0
                ? `${resolvedRequestIds.length} password reset request${resolvedRequestIds.length === 1 ? "" : "s"} handled`
                : null,
            ]
              .filter(Boolean)
              .join(" / "),
          }),
        ]),
      };
    });

    return result;
  };

  const resetUserPassword = ({ email, name, nextAccessPassword }) => {
    let result = { ok: false, error: "Unable to reset this TaxiFlow password." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      if (!PASSWORD_RESET_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can reset TaxiFlow passwords." };
        return current;
      }

      const normalizedEmail = normalizeEmailAddress(email);
      const password = String(nextAccessPassword ?? "").trim();
      const currentUsers = getAppUsers(current);
      const existingUser =
        currentUsers.find((user) => normalizeEmailAddress(user.email) === normalizedEmail) ?? null;

      if (!existingUser) {
        result = { ok: false, error: "This user account could not be found." };
        return current;
      }

      if (activeRole !== "Owner" && existingUser.role === "Owner") {
        result = { ok: false, error: "Only the owner can reset another owner password." };
        return current;
      }

      const nextName = String(name ?? existingUser.name ?? "").trim();
      const shouldUpdateName = nextName !== String(existingUser.name ?? "").trim();
      const shouldUpdatePassword = Boolean(password);

      if (!nextName) {
        result = { ok: false, error: "Enter the full name before saving these details." };
        return current;
      }

      if (!shouldUpdateName && !shouldUpdatePassword) {
        result = { ok: false, error: "Update the full name or enter a new password before saving." };
        return current;
      }

      if (shouldUpdatePassword && password.length < 6) {
        result = { ok: false, error: "Reset password must be at least 6 characters long." };
        return current;
      }

      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextUser = normalizeAppUser({
        ...existingUser,
        name: nextName,
        accessPassword: shouldUpdatePassword ? password : existingUser.accessPassword,
        updatedAt: timestamp,
        updatedBy: actorId,
        updatedByRole: activeRole,
      });
      const nextUsers = sortAppUsers(
        currentUsers.map((user) =>
          user.email === existingUser.email ? nextUser : normalizeAppUser(user),
        ),
      );
      const nextDrivers = existingUser.staffId
        ? (current.drivers ?? []).map((driver) =>
            driver.staffId === existingUser.staffId
              ? {
                  ...driver,
                  name: nextName,
                  accessPassword: shouldUpdatePassword ? password : driver.accessPassword,
                  updatedAt: timestamp,
                  updatedBy: actorId,
                  updatedByRole: activeRole,
                }
              : driver,
          )
        : current.drivers ?? [];
      const resolvedRequestIds = shouldUpdatePassword
        ? (current.passwordResetRequests ?? [])
            .filter(
              (request) =>
                normalizeEmailAddress(request.email) === normalizedEmail &&
                String(request.status ?? "pending").trim().toLowerCase() === "pending",
            )
            .map((request) => request.id)
        : [];
      const nextPasswordResetRequests = resolvedRequestIds.length
        ? (current.passwordResetRequests ?? []).map((request) =>
            resolvedRequestIds.includes(request.id)
              ? {
                  ...request,
                  status: "resolved",
                  notificationStatus: "sent",
                  notificationSentAt:
                    request.notificationSentAt ?? request.requestedAt ?? timestamp,
                  resolvedAt: timestamp,
                  resolvedBy: actorId,
                  resolvedByRole: activeRole,
                }
              : request,
          )
        : current.passwordResetRequests ?? [];
      const nextEmailOutbox = resolvedRequestIds.length
        ? (current.emailOutbox ?? []).map((entry) =>
            resolvedRequestIds.includes(entry.relatedRequestId) &&
            String(entry.status ?? "queued").trim().toLowerCase() === "queued"
              ? {
                  ...entry,
                  status: "actioned",
                  actionedAt: timestamp,
                  actionedBy: actorId,
                }
              : entry,
          )
        : current.emailOutbox ?? [];

      result = {
        ok: true,
        message: shouldUpdateName && shouldUpdatePassword
          ? `${nextUser.name} details and password saved.${resolvedRequestIds.length > 0 ? " Reset request closed." : ""}`
          : shouldUpdatePassword
            ? `${nextUser.name} password reset saved.${resolvedRequestIds.length > 0 ? " Reset request closed." : ""}`
            : `${nextUser.name} details saved.`,
      };

      return {
        ...current,
        appUsers: nextUsers,
        drivers: nextDrivers,
        passwordResetRequests: nextPasswordResetRequests,
        emailOutbox: nextEmailOutbox,
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp,
            scope: "system",
            action: "update",
            entityType: shouldUpdatePassword ? "password-reset" : "user-profile",
            entityId: nextUser.id,
            title: shouldUpdatePassword
              ? `Password reset saved / ${nextUser.name}`
              : `User details saved / ${nextUser.name}`,
            detail: [
              nextUser.email,
              shouldUpdateName ? "Name updated" : null,
              shouldUpdatePassword
                ? activeRole === "Owner"
                  ? "Owner reset saved"
                  : "Management reset saved"
                : null,
              resolvedRequestIds.length > 0
                ? `${resolvedRequestIds.length} password reset request${resolvedRequestIds.length === 1 ? "" : "s"} handled`
                : null,
            ]
              .filter(Boolean)
              .join(" / "),
          }),
        ]),
      };
    });

    return result;
  };

  const resolvePasswordResetRequest = (requestId) => {
    let result = { ok: false, error: "Unable to close this password reset request." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      if (!PASSWORD_RESET_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can close password reset requests." };
        return current;
      }

      const targetRequest =
        (current.passwordResetRequests ?? []).find((request) => request.id === requestId) ?? null;

      if (!targetRequest) {
        result = { ok: false, error: "Password reset request not found." };
        return current;
      }

      if (String(targetRequest.status ?? "pending").trim().toLowerCase() === "resolved") {
        result = { ok: false, error: "This password reset request is already marked as handled." };
        return current;
      }

      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextPasswordResetRequests = (current.passwordResetRequests ?? []).map((request) =>
        request.id === requestId
          ? {
              ...request,
              status: "resolved",
              notificationStatus: "sent",
              notificationSentAt:
                request.notificationSentAt ?? request.requestedAt ?? timestamp,
              resolvedAt: timestamp,
              resolvedBy: actorId,
              resolvedByRole: activeRole,
            }
          : request,
      );
      const nextEmailOutbox = (current.emailOutbox ?? []).map((entry) =>
        entry.relatedRequestId === requestId &&
        String(entry.status ?? "queued").trim().toLowerCase() === "queued"
          ? {
              ...entry,
              status: "actioned",
              actionedAt: timestamp,
              actionedBy: actorId,
            }
          : entry,
      );

      result = {
        ok: true,
        message: `Password reset request marked as handled for ${targetRequest.email}.`,
      };

      return {
        ...current,
        passwordResetRequests: nextPasswordResetRequests,
        emailOutbox: nextEmailOutbox,
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp,
            scope: "system",
            action: "update",
            entityType: "password-reset",
            entityId: requestId,
            title: `Password reset handled / ${targetRequest.email}`,
            detail: "Management confirmed the password reset request was handled.",
          }),
        ]),
      };
    });

    return result;
  };

  const selectDriverVehicle = (vehicleId) => {
    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const linkedVehicles = getDriverLinkedVehicles(deriveSnapshot(current));
      const target =
        linkedVehicles.find((vehicle) => vehicle.id === vehicleId) ??
        current.vehicles.find((vehicle) => vehicle.id === vehicleId);

      if (!target) {
        return current;
      }

      return {
        ...current,
        driverTerminal: {
          ...current.driverTerminal,
          assignedVehicleId: target.id,
          assignedVehicle: target.registration,
          assignedRoute: target.route,
        },
      };
    });
  };

  const saveStandardIncome = (draft) => {
    let result = { ok: false, error: "Unable to save the standard shift." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const existing = (current.financeTransactions ?? []).find(
        (record) => record.id === draft.id,
      );
      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      const tripDate = String(draft.tripDate ?? "").trim();
      const timeIn = String(draft.timeIn ?? "").trim();
      const timeOut = String(draft.timeOut ?? "").trim();
      const tripLogbook = Array.isArray(draft.tripLogbook) ? draft.tripLogbook : [];
      const openingOdo = Number(draft.openingOdo);
      const closingOdo = Number(draft.closingOdo);
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const isUpdate = Boolean(existing);
      const driverEditReason =
        isUpdate && activeRole === "Driver" ? String(draft.editReason ?? "").trim() : "";
      const driverStaffId =
        activeRole === "Driver"
          ? String(current.driverTerminal?.activeDriverId ?? actorId ?? "").trim() || null
          : String(existing?.driverStaffId ?? "").trim() || null;
      const driverName =
        activeRole === "Driver"
          ? String(
              current.driverTerminal?.activeDriver ??
                current.drivers.find((driver) => driver.staffId === driverStaffId)?.name ??
                "",
            ).trim() || null
          : String(existing?.driverName ?? "").trim() || null;

      if (activeRole !== "Driver" && !hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (existing?.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
        return current;
      }
      if (isUpdate && activeRole === "Driver" && !driverEditReason) {
        result = {
          ok: false,
          error: "Add a note explaining why you are updating this daily taking.",
        };
        return current;
      }
      if (!vehicle) {
        result = { ok: false, error: "Select a valid vehicle before submitting." };
        return current;
      }
      if (!tripDate || !parseDateInputValue(tripDate)) {
        result = { ok: false, error: "Select the trip date." };
        return current;
      }
      if (!parseTimeInputValue(timeIn) || !parseTimeInputValue(timeOut)) {
        result = { ok: false, error: "Enter a valid time in and time out." };
        return current;
      }
      if ((getTimeInputMinutes(timeOut) ?? 0) <= (getTimeInputMinutes(timeIn) ?? 0)) {
        result = { ok: false, error: "Time out must be later than time in." };
        return current;
      }
      if (!Number.isFinite(openingOdo) || !Number.isFinite(closingOdo)) {
        result = { ok: false, error: "Opening and closing odometer readings are required." };
        return current;
      }
      if (closingOdo - openingOdo <= 0) {
        result = { ok: false, error: "Closing odometer must be greater than opening odometer." };
        return current;
      }

      if (tripLogbook.length === 0) {
        result = { ok: false, error: "Add at least one trip to the daily logbook." };
        return current;
      }

      const normalizedTripLogbook = [];
      for (const [index, entry] of tripLogbook.entries()) {
        const normalizedEntry = createDailyTripLogEntry(draft.route ?? vehicle.route, entry);
        const fromLocation = String(normalizedEntry.fromLocation ?? "").trim();
        const toLocation = String(normalizedEntry.toLocation ?? "").trim();
        const passengerValue = String(entry?.passengerCount ?? "").trim();
        const amountValue = String(entry?.amountCollected ?? "").trim();
        const passengerCount = Number(entry?.passengerCount);
        const amountCollected = Number(entry?.amountCollected);

        if (!fromLocation || !toLocation) {
          result = { ok: false, error: `Complete the from and to stops for trip ${index + 1}.` };
          return current;
        }
        if (fromLocation.toLowerCase() === toLocation.toLowerCase()) {
          result = { ok: false, error: `Trip ${index + 1} must use two different stops.` };
          return current;
        }
        if (!passengerValue) {
          result = { ok: false, error: `Enter the passenger count for trip ${index + 1}.` };
          return current;
        }
        if (!Number.isInteger(passengerCount) || passengerCount < 0) {
          result = {
            ok: false,
            error: `Passenger count for trip ${index + 1} must be zero or more.`,
          };
          return current;
        }
        if (!amountValue) {
          result = { ok: false, error: `Enter the amount collected for trip ${index + 1}.` };
          return current;
        }
        if (!Number.isFinite(amountCollected) || amountCollected < 0) {
          result = {
            ok: false,
            error: `Amount collected for trip ${index + 1} must be zero or more.`,
          };
          return current;
        }

        normalizedTripLogbook.push({
          id: normalizedEntry.id ?? createRecordId("trip-leg"),
          fromLocation,
          toLocation,
          departingFromPoint: String(
            normalizedEntry.departingFromPoint ?? fromLocation,
          ).trim(),
          goingToPoint: String(normalizedEntry.goingToPoint ?? toLocation).trim(),
          passengerCount,
          amountCollected,
          ...buildTripAnalyticsFields(normalizedEntry),
        });
      }

      const tripLogTotals = getDailyTripLogbookTotals(normalizedTripLogbook);
      const amountClaimed = tripLogTotals.totalAmount;

      const expectedOpening = getExpectedOpeningOdo(
        current.financeTransactions ?? [],
        current.vehicles ?? [],
        draft.vehicleId,
        draft.id ?? null,
      );
      const recordAnalytics = buildTripAnalyticsFields({
        ...existing,
        timeIn,
        timeOut,
        odometerStart: draft.odometerStart ?? existing?.odometerStart ?? openingOdo,
        odometerEnd: draft.odometerEnd ?? existing?.odometerEnd ?? closingOdo,
      });
      const dailyAnalytics = buildDailyAnalyticsFields({
        ...existing,
        dayStartOdometer: draft.dayStartOdometer ?? existing?.dayStartOdometer ?? openingOdo,
        dayEndOdometer: draft.dayEndOdometer ?? existing?.dayEndOdometer ?? closingOdo,
        notes: draft.notes ?? existing?.notes,
      });
      const baseNextRecord = {
        ...existing,
        id: draft.id ?? createRecordId("txn-inc"),
        type: "income",
        incomeKind: "standard",
        vehicleId: draft.vehicleId,
        vehicle: vehicle.registration,
        route: vehicle.route,
        tripDate,
        timeIn,
        timeOut,
        tripLogbook: normalizedTripLogbook,
        tripCount: tripLogTotals.tripCount,
        totalPassengers: tripLogTotals.totalPassengers,
        openingOdo,
        closingOdo,
        ...recordAnalytics,
        ...dailyAnalytics,
        amountClaimed,
        actualCashReceived: null,
        amount: amountClaimed,
        driverStaffId,
        driverName,
        discrepancy: openingOdo !== expectedOpening,
        isSpecial: false,
        status: "pending",
        timestamp: createTimestampFromDateTimeInput(tripDate, timeIn, existing?.timestamp ?? now),
        createdAt: existing?.createdAt ?? existing?.timestamp ?? now,
        createdBy: existing?.createdBy ?? actorId,
        createdByRole: existing?.createdByRole ?? activeRole,
        updatedAt: isUpdate ? now : null,
        updatedBy: isUpdate ? actorId : null,
        updatedByRole: isUpdate ? activeRole : null,
        verifiedAt: null,
        verifiedBy: null,
        verifiedByRole: null,
        depositId: null,
      };
      const driverEditTracking = buildDriverRecordEditTracking({
        existingRecord: existing,
        nextRecord: baseNextRecord,
        reason: driverEditReason,
        timestamp: now,
        actorId,
        actorRole: activeRole,
      });
      const nextRecord = {
        ...baseNextRecord,
        ...driverEditTracking.trackingFields,
      };
      const nextTransactions = draft.id
        ? current.financeTransactions.map((record) =>
            record.id === draft.id
              ? nextRecord
              : record,
          )
        : [nextRecord, ...(current.financeTransactions ?? [])];
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "finance",
          action: isUpdate ? "update" : "create",
          entityType: "income",
          entityId: nextRecord.id,
          title: `${isUpdate ? "Trip income updated" : "Trip income added"} / ${vehicle.registration}`,
          detail: `${vehicle.route} / ${tripLogTotals.tripCount} trips / ${tripLogTotals.totalPassengers} passengers / ${formatMoney(
            amountClaimed,
          )}${
            driverEditTracking.editEntry
              ? ` / Driver note: ${driverEditTracking.editEntry.reason} / ${driverEditTracking.editEntry.summary}`
              : ""
          }`,
        }),
      ]);

      result = {
        ok: true,
        message: isUpdate
          ? nextRecord.discrepancy
            ? "Trip update saved and logged for owner review. The opening odometer still does not match the last record."
            : "Trip update saved and logged for owner review."
          : nextRecord.discrepancy
            ? "Trip saved and added to the daily total, but the opening odometer does not match the last record."
            : "Trip saved and added to the daily total. Use Checking to wrap up the day for cash-in.",
        nextOpeningOdo: closingOdo,
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const saveSpecialIncome = (draft) => {
    let result = { ok: false, error: "Unable to save the extra trip." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const existing = (current.financeTransactions ?? []).find(
        (record) => record.id === draft.id,
      );
      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      const tripDate = String(draft.tripDate ?? "").trim();
      const openingOdo = Number(draft.openingOdo);
      const closingOdo = Number(draft.closingOdo);
      const fromLocation = draft.fromLocation?.trim() ?? "";
      const toLocation = draft.toLocation?.trim() ?? "";
      const travelReason = draft.travelReason?.trim() ?? "";
      const fuelOilCost = Number(draft.fuelOilCost ?? 0);
      const repairMaintenanceCost = Number(draft.repairMaintenanceCost ?? 0);
      const amount = Number(draft.amount);
      const businessKm = closingOdo - openingOdo;
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const isUpdate = Boolean(existing);
      const driverEditReason =
        isUpdate && activeRole === "Driver" ? String(draft.editReason ?? "").trim() : "";
      const driverStaffId =
        activeRole === "Driver"
          ? String(current.driverTerminal?.activeDriverId ?? actorId ?? "").trim() || null
          : String(existing?.driverStaffId ?? "").trim() || null;
      const driverName =
        activeRole === "Driver"
          ? String(
              current.driverTerminal?.activeDriver ??
                current.drivers.find((driver) => driver.staffId === driverStaffId)?.name ??
                "",
            ).trim() || null
          : String(existing?.driverName ?? "").trim() || null;

      if (activeRole !== "Driver" && !hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (existing?.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
        return current;
      }
      if (isUpdate && activeRole === "Driver" && !driverEditReason) {
        result = {
          ok: false,
          error: "Add a note explaining why you are updating this extra trip.",
        };
        return current;
      }
      if (!vehicle) {
        result = { ok: false, error: "Select a valid vehicle before submitting." };
        return current;
      }
      if (!tripDate || !parseDateInputValue(tripDate)) {
        result = { ok: false, error: "Select the travel date." };
        return current;
      }
      if (!Number.isFinite(openingOdo) || !Number.isFinite(closingOdo)) {
        result = { ok: false, error: "Opening and closing odometer readings are required." };
        return current;
      }
      if (closingOdo - openingOdo <= 0) {
        result = { ok: false, error: "Closing odometer must be greater than opening odometer." };
        return current;
      }
      if (!fromLocation || !toLocation || !travelReason) {
        result = { ok: false, error: "Complete the business travel details before saving." };
        return current;
      }
      if (!Number.isFinite(fuelOilCost) || fuelOilCost < 0) {
        result = { ok: false, error: "Enter a valid fuel and oil cost." };
        return current;
      }
      if (!Number.isFinite(repairMaintenanceCost) || repairMaintenanceCost < 0) {
        result = { ok: false, error: "Enter a valid repairs and maintenance cost." };
        return current;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        result = { ok: false, error: "Enter the amount earned for the extra trip." };
        return current;
      }

      const recordAnalytics = buildTripAnalyticsFields({
        ...existing,
        timeIn: draft.timeIn ?? existing?.timeIn,
        timeOut: draft.timeOut ?? existing?.timeOut,
        odometerStart: draft.odometerStart ?? existing?.odometerStart ?? openingOdo,
        odometerEnd: draft.odometerEnd ?? existing?.odometerEnd ?? closingOdo,
        kmComputed: draft.kmComputed ?? existing?.kmComputed ?? businessKm,
        tripDurationMin: draft.tripDurationMin ?? existing?.tripDurationMin,
      });
      const baseNextRecord = {
        ...existing,
        id: draft.id ?? createRecordId("txn-sp"),
        type: "income",
        incomeKind: "special",
        vehicleId: draft.vehicleId,
        vehicle: vehicle.registration,
        route: `${fromLocation} to ${toLocation}`,
        assignedRoute: vehicle.route,
        description: travelReason,
        tripDate,
        openingOdo,
        closingOdo,
        businessKm,
        ...recordAnalytics,
        fromLocation,
        toLocation,
        departingFromPoint: fromLocation,
        goingToPoint: toLocation,
        travelReason,
        fuelOilCost,
        repairMaintenanceCost,
        amount,
        amountClaimed: amount,
        actualCashReceived: null,
        driverStaffId,
        driverName,
        discrepancy: false,
        isSpecial: true,
        status: "pending",
        timestamp: createTimestampFromDateInput(tripDate, existing?.timestamp ?? now),
        createdAt: existing?.createdAt ?? existing?.timestamp ?? now,
        createdBy: existing?.createdBy ?? actorId,
        createdByRole: existing?.createdByRole ?? activeRole,
        updatedAt: isUpdate ? now : null,
        updatedBy: isUpdate ? actorId : null,
        updatedByRole: isUpdate ? activeRole : null,
        verifiedAt: null,
        verifiedBy: null,
        verifiedByRole: null,
        depositId: null,
      };
      const driverEditTracking = buildDriverRecordEditTracking({
        existingRecord: existing,
        nextRecord: baseNextRecord,
        reason: driverEditReason,
        timestamp: now,
        actorId,
        actorRole: activeRole,
      });
      const nextRecord = {
        ...baseNextRecord,
        ...driverEditTracking.trackingFields,
      };
      const nextTransactions = draft.id
        ? current.financeTransactions.map((record) =>
            record.id === draft.id ? nextRecord : record,
          )
        : [nextRecord, ...(current.financeTransactions ?? [])];
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "finance",
          action: isUpdate ? "update" : "create",
          entityType: "income",
          entityId: nextRecord.id,
          title: `${isUpdate ? "Extra trip updated" : "Extra trip added"} / ${
            nextRecord.vehicle
          }`,
          detail: `${formatTripRoute(nextRecord)} / ${travelReason} / ${businessKm.toLocaleString()} km / ${formatMoney(
            amount,
          )}${
            driverEditTracking.editEntry
              ? ` / Driver note: ${driverEditTracking.editEntry.reason} / ${driverEditTracking.editEntry.summary}`
              : ""
          }`,
        }),
      ]);

      result = {
        ok: true,
        message: isUpdate
          ? "Extra trip update saved and logged for owner review."
          : "Extra trip saved and added to the daily total. Use Checking to wrap up the day for cash-in.",
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const saveExpense = (draft) => {
    let result = { ok: false, error: "Unable to save the expense." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const existing = (current.financeTransactions ?? []).find(
        (record) => record.id === draft.id,
      );
      const amount = Number(draft.amount);
      const expenseKind = draft.expenseKind;
      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      const status =
        activeRole !== "Driver" && hasModuleUpdateAccess(current, "finance")
          ? "verified"
          : "pending";
      const now = new Date().toISOString();
      const expenseDate = String(draft.expenseDate ?? "").trim();
      const description = draft.description?.trim() ?? "";
      const reference = draft.reference?.trim() ?? "";
      const actorId = resolveCurrentActorId(current);
      const isUpdate = Boolean(existing);
      const driverEditReason =
        isUpdate && activeRole === "Driver" ? String(draft.editReason ?? "").trim() : "";
      const driverStaffId =
        activeRole === "Driver"
          ? String(current.driverTerminal?.activeDriverId ?? actorId ?? "").trim() || null
          : String(existing?.driverStaffId ?? "").trim() || null;
      const driverName =
        activeRole === "Driver"
          ? String(
              current.driverTerminal?.activeDriver ??
                current.drivers.find((driver) => driver.staffId === driverStaffId)?.name ??
                "",
            ).trim() || null
          : String(existing?.driverName ?? "").trim() || null;

      if (activeRole !== "Driver" && !hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (existing?.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
        return current;
      }
      if (isUpdate && activeRole === "Driver" && !driverEditReason) {
        result = {
          ok: false,
          error: "Add a note explaining why you are updating this expense.",
        };
        return current;
      }
      if (!draft.category?.trim()) {
        result = { ok: false, error: "Enter an expense category." };
        return current;
      }
      if (!description) {
        result = { ok: false, error: "Enter an expense description." };
        return current;
      }
      if (!expenseDate) {
        result = { ok: false, error: "Select the expense date." };
        return current;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        result = { ok: false, error: "Enter a valid expense amount." };
        return current;
      }
      if (expenseKind === "asset" && !vehicle) {
        result = { ok: false, error: "Vehicle costs need a valid vehicle." };
        return current;
      }

      const baseNextRecord = {
        ...existing,
        id: draft.id ?? createRecordId("txn-exp"),
        type: "expense",
        expenseKind,
        category: draft.category.trim(),
        description,
        expenseDate,
        reference: reference || null,
        vehicleId: expenseKind === "asset" ? draft.vehicleId : null,
        vehicle: expenseKind === "asset" ? vehicle.registration : "General",
        amount,
        cashExpense: Boolean(draft.cashExpense),
        driverStaffId,
        driverName,
        status,
        timestamp: createTimestampFromDateInput(expenseDate, existing?.timestamp ?? now),
        createdAt: existing?.createdAt ?? existing?.timestamp ?? now,
        createdBy: existing?.createdBy ?? actorId,
        createdByRole: existing?.createdByRole ?? activeRole,
        updatedAt: isUpdate ? now : null,
        updatedBy: isUpdate ? actorId : null,
        updatedByRole: isUpdate ? activeRole : null,
        depositId: null,
      };
      const driverEditTracking = buildDriverRecordEditTracking({
        existingRecord: existing,
        nextRecord: baseNextRecord,
        reason: driverEditReason,
        timestamp: now,
        actorId,
        actorRole: activeRole,
      });
      const nextRecord = {
        ...baseNextRecord,
        ...driverEditTracking.trackingFields,
      };
      const nextTransactions = draft.id
        ? current.financeTransactions.map((record) =>
            record.id === draft.id ? nextRecord : record,
          )
        : [nextRecord, ...(current.financeTransactions ?? [])];
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "finance",
          action: isUpdate ? "update" : "create",
          entityType: "expense",
          entityId: nextRecord.id,
          title: `${isUpdate ? "Expense updated" : "Expense added"} / ${nextRecord.category}`,
          detail: `${nextRecord.description} / ${formatMoney(amount)}${
            nextRecord.reference ? ` / Receipt ${nextRecord.reference}` : ""
          }${
            driverEditTracking.editEntry
              ? ` / Driver note: ${driverEditTracking.editEntry.reason} / ${driverEditTracking.editEntry.summary}`
              : ""
          }`,
        }),
      ]);

      result = {
        ok: true,
        message: isUpdate && activeRole === "Driver"
          ? "Expense update saved and logged for owner review."
          : status === "verified"
            ? "Expense saved and checked."
            : "Expense saved and sent to a manager for review.",
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const submitDriverCashUp = () => {
    if (!snapshot) {
      return { ok: false, error: "Unable to send the day checking." };
    }
    if (activeRole !== "Driver") {
      return { ok: false, error: "Only a driver can wrap up the day with checking." };
    }

    const actorId = resolveCurrentActorId(snapshot);
    const derived = deriveSnapshot(snapshot);
    const driverStaffId =
      String(derived.driverTerminal?.activeDriverId ?? actorId ?? "").trim() || null;
    const daySummary = buildDriverDayCashSummary(derived, { driverStaffId });

    if (daySummary.entryCount === 0) {
      return {
        ok: false,
        error: "Save at least one income or expense entry before sending checking for the day.",
      };
    }

    const timestamp = new Date().toISOString();
    const existingCashUp =
      (snapshot.dailyCashUps ?? []).find(
        (entry) =>
          String(entry.driverStaffId ?? "").trim() === driverStaffId &&
          String(entry.workDate ?? "").trim() === daySummary.workDate,
      ) ?? null;
    if (existingCashUp?.status === "banked") {
      return { ok: false, error: "Deposited day checkings can no longer be updated." };
    }

    const nextCashUp = {
      ...existingCashUp,
      id: getDailyCashUpStableId(
        {
          ...existingCashUp,
          driverStaffId,
          workDate: daySummary.workDate,
          checkedAt: timestamp,
          createdAt: existingCashUp?.createdAt ?? timestamp,
        },
        createRecordId("cashup"),
      ),
      driverStaffId,
      driverName:
        daySummary.driverName ??
        derived.driverTerminal?.activeDriver ??
        "Driver",
      workDate: daySummary.workDate,
      vehicleId: derived.driverTerminal?.assignedVehicleId ?? null,
      vehicle: derived.driverTerminal?.assignedVehicle ?? null,
      route: derived.driverTerminal?.assignedRoute ?? null,
      incomeRecordIds: daySummary.incomeRecords.map((record) => record.id),
      expenseRecordIds: daySummary.expenseRecords.map((record) => record.id),
      totalIncome: daySummary.totalIncome,
      totalExpenses: daySummary.totalExpenses,
      cashExpenses: daySummary.cashExpenses,
      expectedCashIn: daySummary.expectedCashIn,
      entryCount: daySummary.entryCount,
      status: "pending",
      actualCashReceived: null,
      checkedAt: timestamp,
      checkedBy: actorId,
      checkedByRole: activeRole,
      createdAt: existingCashUp?.createdAt ?? timestamp,
      updatedAt: existingCashUp ? timestamp : null,
      countedAt: null,
      countedBy: null,
      countedByRole: null,
      verifiedAt: null,
      verifiedBy: null,
      verifiedByRole: null,
      depositId: null,
      bankedAt: null,
    };
    const nextCashUps = existingCashUp
      ? (snapshot.dailyCashUps ?? []).map((entry) =>
          entry.id === existingCashUp.id ? nextCashUp : entry,
        )
      : [nextCashUp, ...(snapshot.dailyCashUps ?? [])];
    const nextTransactions = syncTransactionsForDriverCashUp(
      snapshot.financeTransactions ?? [],
      daySummary,
      (record) => ({
        ...record,
        status: "pending",
        actualCashReceived: null,
        countedAt: null,
        countedBy: null,
        countedByRole: null,
        verifiedAt: null,
        verifiedBy: null,
        verifiedByRole: null,
        depositId: null,
        bankedAt: null,
      }),
    );
    const nextAuditTrail = appendAuditTrail(snapshot.auditTrail, [
      buildCurrentAuditEvent(snapshot, {
        timestamp,
        scope: "finance",
        action: existingCashUp ? "update" : "create",
        entityType: "driver-checking",
        entityId: nextCashUp.id,
        title: `${existingCashUp ? "Checking updated" : "Checking submitted"} / ${
          nextCashUp.driverName
        }`,
        detail: `${nextCashUp.workDate} / ${formatMoney(nextCashUp.totalIncome)} income / ${formatMoney(
          nextCashUp.totalExpenses,
        )} expenses / ${formatMoney(nextCashUp.expectedCashIn)} expected cash in`,
      }),
    ]);

    setSnapshot({
      ...snapshot,
      financeTransactions: nextTransactions,
      dailyCashUps: nextCashUps,
      auditTrail: nextAuditTrail,
    });

    return {
      ok: true,
      message: existingCashUp
        ? "Checking updated. Management can now record one day hand-in from the latest total."
        : "Checking sent. Management can now record one day hand-in for this shift.",
    };
  };

  const saveExpensePreset = (draft) => {
    let result = { ok: false, error: "Unable to save the expense setup." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!PRIVILEGED_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can save expense setup." };
        return current;
      }
      if (!hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }

      const expenseKind = draft.expenseKind === "operational" ? "operational" : "asset";
      const category = normalizeExpensePresetName(draft.category);
      const description = normalizeExpensePresetName(draft.description);

      if (!category) {
        result = { ok: false, error: "Enter an expense category to save." };
        return current;
      }
      if (category.toLowerCase() === EXPENSE_OTHER_CATEGORY.toLowerCase()) {
        result = {
          ok: false,
          error: "Other is already available in the category list and cannot be saved as a preset.",
        };
        return current;
      }

      const currentCatalog = normalizeExpensePresetCatalog(current.finance?.expenseCatalog ?? {});
      const currentItems = currentCatalog[expenseKind] ?? [];
      const existingEntry =
        currentItems.find((entry) => entry.name.toLowerCase() === category.toLowerCase()) ?? null;
      const nextEntry = normalizeExpensePresetRecord(
        {
          ...existingEntry,
          name: category,
          descriptions: [...(existingEntry?.descriptions ?? []), description],
        },
        expenseKind,
      );
      const nextCatalog = normalizeExpensePresetCatalog({
        ...currentCatalog,
        [expenseKind]: existingEntry
          ? currentItems.map((entry) =>
              entry.name.toLowerCase() === category.toLowerCase() ? nextEntry : entry,
            )
          : [...currentItems, nextEntry],
      });
      const now = new Date().toISOString();

      result = {
        ok: true,
        message: description
          ? `${category} saved with ${description}.`
          : `${category} saved.`,
      };

      return {
        ...current,
        finance: {
          ...current.finance,
          expenseCatalog: nextCatalog,
        },
        auditTrail: appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp: now,
            scope: "finance",
            action: existingEntry ? "update" : "create",
            entityType: "expense-preset",
            entityId: nextEntry.id,
            title: `Expense setup ${existingEntry ? "updated" : "created"} / ${category}`,
            detail: [
              expenseKind === "asset" ? "Vehicle cost" : "Business cost",
              description || "Category only",
            ].join(" / "),
          }),
        ]),
      };
    });

    return result;
  };

  const verifyIncome = (transactionId, actualCashReceived) => {
    let result = { ok: false, error: "Unable to update this cash hand-in record." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const amount = Number(actualCashReceived);
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const cashUpTarget =
        (current.dailyCashUps ?? []).find(
          (entry) => getDailyCashUpStableId(entry) === transactionId,
        ) ?? null;

      if (cashUpTarget) {
        const derived = deriveSnapshot(current);
        const daySummary = buildDriverDayCashSummary(derived, {
          driverStaffId: String(cashUpTarget.driverStaffId ?? "").trim() || null,
          workDate: String(cashUpTarget.workDate ?? "").trim() || null,
        });
        const workflowStatus = getDriverCashUpWorkflowStatus(cashUpTarget, daySummary);

        if (workflowStatus === "banked") {
          result = { ok: false, error: "Deposited day checkings can no longer be changed." };
          return current;
        }

        if (workflowStatus === "pending") {
          if (!canRecordCashHandoverForRole(activeRole)) {
            result = {
              ok: false,
              error: "Administrator must record the day hand-in before manager verification.",
            };
            return current;
          }
          if (!Number.isFinite(amount) || amount < 0) {
            result = {
              ok: false,
              error: "Enter the cash received before recording the day hand-in.",
            };
            return current;
          }

          const nextCashUp = {
            ...cashUpTarget,
            status: "counted",
            actualCashReceived: amount,
            countedAt: now,
            countedBy: actorId,
            countedByRole: activeRole,
            verifiedAt: null,
            verifiedBy: null,
            verifiedByRole: null,
          };
          const nextTransactions = syncTransactionsForDriverCashUp(
            current.financeTransactions ?? [],
            daySummary,
            (record) => ({
              ...record,
              status: "counted",
              countedAt: now,
              countedBy: actorId,
              countedByRole: activeRole,
              verifiedAt: null,
              verifiedBy: null,
              verifiedByRole: null,
              depositId: null,
              bankedAt: null,
            }),
          );
          const nextAuditTrail = appendAuditTrail(current.auditTrail, [
            buildCurrentAuditEvent(current, {
              timestamp: now,
              scope: "finance",
              action: "update",
              entityType: "driver-checking",
              entityId: transactionId,
              title: `Day hand-in recorded / ${cashUpTarget.driverName ?? "Driver"}`,
              detail: `${cashUpTarget.workDate} / ${formatMoney(amount)} handed in to admin`,
            }),
          ]);

          result = {
            ok: true,
            message: "Day checking recorded and waiting for manager verification.",
            shortage: Math.max(Number(daySummary.expectedCashIn ?? 0) - amount, 0),
          };

          return {
            ...current,
            dailyCashUps: (current.dailyCashUps ?? []).map((entry) =>
              entry.id === transactionId ? nextCashUp : entry,
            ),
            financeTransactions: nextTransactions,
            auditTrail: nextAuditTrail,
          };
        }

        if (workflowStatus === "counted") {
          if (!canVerifyCashCheckForRole(activeRole)) {
            result = {
              ok: false,
              error: "Manager must verify the admin day checking before banking.",
            };
            return current;
          }

          const finalAmount =
            Number.isFinite(amount) && amount >= 0
              ? amount
              : Number(cashUpTarget.actualCashReceived ?? NaN);
          if (!Number.isFinite(finalAmount) || finalAmount < 0) {
            result = {
              ok: false,
              error: "Administrator must record the day hand-in before manager verification.",
            };
            return current;
          }

          const nextCashUp = {
            ...cashUpTarget,
            status: "verified",
            actualCashReceived: finalAmount,
            verifiedAt: now,
            verifiedBy: actorId,
            verifiedByRole: activeRole,
          };
          const nextTransactions = syncTransactionsForDriverCashUp(
            current.financeTransactions ?? [],
            daySummary,
            (record) => ({
              ...record,
              status: "verified",
              verifiedAt: now,
              verifiedBy: actorId,
              verifiedByRole: activeRole,
            }),
          );
          const nextAuditTrail = appendAuditTrail(current.auditTrail, [
            buildCurrentAuditEvent(current, {
              timestamp: now,
              scope: "finance",
              action: "verify",
              entityType: "driver-checking",
              entityId: transactionId,
              title: `Day checking verified / ${cashUpTarget.driverName ?? "Driver"}`,
              detail: `${cashUpTarget.workDate} / ${formatMoney(finalAmount)} manager checked`,
            }),
          ]);

          result = {
            ok: true,
            message: "Day checking verified and added to cash ready for banking.",
            shortage: Math.max(Number(daySummary.expectedCashIn ?? 0) - finalAmount, 0),
          };

          return {
            ...current,
            dailyCashUps: (current.dailyCashUps ?? []).map((entry) =>
              entry.id === transactionId ? nextCashUp : entry,
            ),
            financeTransactions: nextTransactions,
            auditTrail: nextAuditTrail,
          };
        }

        result = {
          ok: false,
          error:
            workflowStatus === "verified"
              ? "This day checking has already been verified."
              : "This day checking is not ready for another cash action.",
        };
        return current;
      }

      const target = current.financeTransactions.find((record) => record.id === transactionId);

      if (!target || target.type !== "income") {
        result = { ok: false, error: "Income record not found." };
        return current;
      }
      if (target.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
        return current;
      }

      if (target.status === "pending") {
        if (!canRecordCashHandoverForRole(activeRole)) {
          result = {
            ok: false,
            error: "Administrator must record the cash hand-in before manager verification.",
          };
          return current;
        }
        if (!Number.isFinite(amount) || amount < 0) {
          result = {
            ok: false,
            error: "Enter the cash received before recording the hand-in.",
          };
          return current;
        }

        const nextTransactions = current.financeTransactions.map((record) =>
          record.id === transactionId
            ? {
                ...record,
                actualCashReceived: amount,
                status: "counted",
                countedAt: now,
                countedBy: actorId,
                countedByRole: activeRole,
                verifiedAt: null,
                verifiedBy: null,
                verifiedByRole: null,
              }
            : record,
        );
        const nextAuditTrail = appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp: now,
            scope: "finance",
            action: "update",
            entityType: "income",
            entityId: transactionId,
            title: `Cash hand-in recorded / ${target.vehicle ?? "General"}`,
            detail: `${formatMoney(amount)} handed in to admin`,
          }),
        ]);

        result = {
          ok: true,
          message: "Cash hand-in recorded and waiting for manager verification.",
          shortage: Math.max(Number(target.amountClaimed ?? target.amount ?? 0) - amount, 0),
        };

        return {
          ...current,
          financeTransactions: nextTransactions,
          auditTrail: nextAuditTrail,
        };
      }

      if (target.status === "counted") {
        if (!canVerifyCashCheckForRole(activeRole)) {
          result = {
            ok: false,
            error: "Manager must verify the admin cash checking before banking.",
          };
          return current;
        }

        const finalAmount =
          Number.isFinite(amount) && amount >= 0 ? amount : Number(target.actualCashReceived ?? NaN);
        if (!Number.isFinite(finalAmount) || finalAmount < 0) {
          result = {
            ok: false,
            error: "Administrator must record the cash hand-in before manager verification.",
          };
          return current;
        }

        const nextTransactions = current.financeTransactions.map((record) =>
          record.id === transactionId
            ? {
                ...record,
                actualCashReceived: finalAmount,
                status: "verified",
                verifiedAt: now,
                verifiedBy: actorId,
                verifiedByRole: activeRole,
              }
            : record,
        );
        const nextAuditTrail = appendAuditTrail(current.auditTrail, [
          buildCurrentAuditEvent(current, {
            timestamp: now,
            scope: "finance",
            action: "verify",
            entityType: "income",
            entityId: transactionId,
            title: `Cash checking verified / ${target.vehicle ?? "General"}`,
            detail: `${formatMoney(finalAmount)} manager checked`,
          }),
        ]);

        result = {
          ok: true,
          message: "Cash checking verified and added to cash ready for banking.",
          shortage: Math.max(Number(target.amountClaimed ?? target.amount ?? 0) - finalAmount, 0),
        };

        return {
          ...current,
          financeTransactions: nextTransactions,
          auditTrail: nextAuditTrail,
        };
      }

      result = {
        ok: false,
        error:
          target.status === "verified"
            ? "This cash checking has already been verified."
            : "This income record is not ready for another cash action.",
      };
      return current;
    });

    return result;
  };

  const deleteTransaction = (transactionId) => {
    let result = { ok: false, error: "Unable to delete the record." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const target = current.financeTransactions.find((record) => record.id === transactionId);

      if (!hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (!target) {
        result = { ok: false, error: "Record not found." };
        return current;
      }
      if (target.status === "banked") {
        result = { ok: false, error: "Deposited records are final and cannot be deleted." };
        return current;
      }

      result = { ok: true, message: "Record removed." };
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          scope: "finance",
          action: "delete",
          entityType: target.type,
          entityId: target.id,
          title:
            target.type === "income"
              ? `${target.isSpecial ? "Extra trip removed" : "Trip income removed"} / ${
                  target.vehicle ?? "General"
                }`
              : `Expense removed / ${target.category}`,
          detail:
            target.type === "income"
              ? target.isSpecial
                ? `${formatMoney(target.amountClaimed ?? target.amount ?? 0)} / ${formatTripRoute(
                    target,
                  )} / ${formatTripLogMeta(target)}`
                : `${formatMoney(target.amountClaimed ?? target.amount ?? 0)} / ${
                    target.route ?? "Pending route"
                  }`
              : `${formatMoney(target.amount ?? 0)} / ${target.vehicle ?? "General"}`,
        }),
      ]);

      return {
        ...current,
        financeTransactions: current.financeTransactions.filter(
          (record) => record.id !== transactionId,
        ),
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const lockDeposit = () => {
    let result = { ok: false, error: "No manager-checked records are ready to finalise." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      if (!hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (!canFinishDepositForRole(activeRole)) {
        result = {
          ok: false,
          error: "Only the manager or owner can finalise a verified deposit batch.",
        };
        return current;
      }
      const derived = deriveSnapshot(current);
      const driverCashUpQueue = buildDriverCashUpQueue({
        ...derived,
        vehicles: derived.vehicles,
        financeTransactions: derived.financeTransactions,
        dailyCashUps: Array.isArray(current.dailyCashUps) ? current.dailyCashUps : [],
      });
      const verifiedDriverCashUps = driverCashUpQueue.filter(
        (entry) => entry.workflowStatus === "verified",
      );
      const verifiedDriverCashUpIds = new Set(
        verifiedDriverCashUps.map((entry) => entry.id).filter(Boolean),
      );
      const verifiedDriverCashUpTransactionIds = new Set(
        verifiedDriverCashUps.flatMap((entry) => buildCashUpTransactionIds(entry)),
      );
      const standaloneVerifiedTransactions = (current.financeTransactions ?? []).filter(
        (record) => record.status === "verified" && !verifiedDriverCashUpTransactionIds.has(record.id),
      );
      const recordsLocked = verifiedDriverCashUps.length + standaloneVerifiedTransactions.length;

      if (recordsLocked === 0) {
        return current;
      }

      const now = new Date();
      const actorId = resolveCurrentActorId(current);
      const depositId = `dep-${now.getTime()}`;
      const reference = buildDepositReference((current.deposits?.length ?? 0) + 1, now);
      const verifiedTakings =
        sumBy(verifiedDriverCashUps, (entry) => entry.totalIncome) +
        sumBy(
          standaloneVerifiedTransactions.filter((record) => record.type === "income"),
          getIncomeCashValue,
        );
      const cashExpenses = sumBy(
        standaloneVerifiedTransactions.filter(
          (record) => record.type === "expense" && record.cashExpense,
        ),
        (record) => record.amount,
      ) + sumBy(verifiedDriverCashUps, (entry) => entry.cashExpenses);
      const depositRecord = {
        depositId,
        reference,
        timestamp: now.toISOString(),
        recordsLocked,
        verifiedTakings,
        cashExpenses,
        depositAmount:
          sumBy(
            verifiedDriverCashUps,
            (entry) => entry.actualCashReceived ?? entry.expectedCashIn,
          ) +
          sumBy(
            standaloneVerifiedTransactions.filter((record) => record.type === "income"),
            getIncomeCashValue,
          ) -
          sumBy(
            standaloneVerifiedTransactions.filter(
              (record) => record.type === "expense" && record.cashExpense,
            ),
            (record) => record.amount,
          ),
        transactionIds: [
          ...verifiedDriverCashUpTransactionIds,
          ...standaloneVerifiedTransactions.map((record) => record.id),
        ],
        cashUpIds: [...verifiedDriverCashUpIds],
        lockedBy: actorId,
        lockedByRole: activeRole,
      };
      const timestamp = now.toISOString();
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp,
          scope: "finance",
          action: "lock",
          entityType: "deposit",
          entityId: depositId,
          title: `Deposit finished / ${reference}`,
          detail: `${recordsLocked} records / ${formatMoney(depositRecord.depositAmount)}`,
        }),
      ]);

      result = {
        ok: true,
        message: `${recordsLocked} manager-checked records were added to ${reference}.`,
        reference,
      };

      return {
        ...current,
        deposits: [depositRecord, ...(current.deposits ?? [])],
        dailyCashUps: (current.dailyCashUps ?? []).map((entry) =>
          verifiedDriverCashUpIds.has(entry.id)
            ? {
                ...entry,
                status: "banked",
                depositId,
                bankedAt: timestamp,
              }
            : entry,
        ),
        financeTransactions: current.financeTransactions.map((record) =>
          record.status === "verified" || verifiedDriverCashUpTransactionIds.has(record.id)
            ? {
                ...record,
                status: "banked",
                depositId,
                bankedAt: timestamp,
              }
            : record,
        ),
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const saveVehicleProfile = (draft) => {
    let result = { ok: false, error: "Unable to save the vehicle profile." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!PRIVILEGED_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can edit vehicle settings." };
        return current;
      }
      const routeCatalog = collectRouteMasterRecords(current);
      const routeSelection = resolveVehicleRouteSelection(draft, routeCatalog);

      if (!draft.registration?.trim() || !draft.model?.trim() || !routeSelection.route) {
        result = { ok: false, error: "Registration, model, and route are required." };
        return current;
      }

      const existing = current.vehicles.find((vehicle) => vehicle.id === draft.id);
      const assignedDriver =
        draft.assignedDriverId != null && draft.assignedDriverId !== ""
          ? current.drivers.find((driver) => driver.staffId === draft.assignedDriverId)
          : null;
      if (!hasModuleUpdateAccess(current, "fleet")) {
        result = { ok: false, error: getModuleAccessErrorMessage("fleet") };
        return current;
      }
      if (draft.assignedDriverId && !assignedDriver) {
        result = { ok: false, error: "Select a valid driver for this vehicle." };
        return current;
      }
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const capabilityFields = normalizeVehicleCapabilityHooks({
        ...existing,
        ...draft,
        route: routeSelection.route,
        currentRouteId: routeSelection.currentRouteId,
      });
      const nextVehicle = {
        ...existing,
        id: draft.id ?? createRecordId("veh"),
        registration: draft.registration.trim().toUpperCase(),
        model: draft.model.trim(),
        route: routeSelection.route,
        status: draft.status ?? "active",
        utilisation: Number(draft.utilisation ?? 0),
        currentOdometer: Number(draft.currentOdometer ?? 0),
        lastServiceOdo: Number(draft.lastServiceOdo ?? 0),
        serviceIntervalKm: Number(draft.serviceIntervalKm ?? current.profile.serviceIntervalKm),
        permitExpiryDate: draft.permitExpiryDate || null,
        discExpiryDate: draft.discExpiryDate || null,
        assignedDriverId: draft.assignedDriverId || null,
        canDoRouteService: capabilityFields.canDoRouteService,
        canDoSpecialTrips: capabilityFields.canDoSpecialTrips,
        canDoContracts: capabilityFields.canDoContracts,
        seatCapacity: capabilityFields.seatCapacity,
        currentRouteId: routeSelection.currentRouteId ?? capabilityFields.currentRouteId,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actorId,
        createdByRole: existing?.createdByRole ?? activeRole,
        updatedAt: existing ? now : null,
        updatedBy: existing ? actorId : null,
        updatedByRole: existing ? activeRole : null,
        archivedAt: existing?.archivedAt ?? null,
        archivedBy: existing?.archivedBy ?? null,
        archivedByRole: existing?.archivedByRole ?? null,
      };
      const currentVehicles = current.vehicles ?? [];
      const nextVehiclesBase = draft.id
        ? currentVehicles.map((vehicle) =>
            vehicle.id === draft.id ? { ...vehicle, ...nextVehicle } : vehicle,
          )
        : [nextVehicle, ...currentVehicles];
      const nextVehicles = nextVehicle.assignedDriverId
        ? nextVehiclesBase.map((vehicle) =>
            vehicle.id !== nextVehicle.id && vehicle.assignedDriverId === nextVehicle.assignedDriverId
              ? {
                  ...vehicle,
                  assignedDriverId: null,
                }
              : vehicle,
          )
        : nextVehiclesBase;
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "fleet",
          action: existing ? "update" : "create",
          entityType: "vehicle",
          entityId: nextVehicle.id,
          title: `Vehicle ${existing ? "updated" : "created"} / ${nextVehicle.registration}`,
          detail: `${nextVehicle.model} / ${nextVehicle.route}`,
        }),
      ]);

      result = {
        ok: true,
        message: draft.id ? "Vehicle profile updated." : "Vehicle profile created.",
        vehicleId: nextVehicle.id,
      };

      return {
        ...current,
        vehicles: nextVehicles,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const saveRouteProfile = (draft) => {
    let result = { ok: false, error: "Unable to save the route profile." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!PRIVILEGED_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can edit route settings." };
        return current;
      }
      if (!hasModuleUpdateAccess(current, "fleet")) {
        result = { ok: false, error: getModuleAccessErrorMessage("fleet") };
        return current;
      }

      const routeName = String(draft.name ?? "").trim();
      const routeCode = String(draft.code ?? "").trim().toUpperCase();
      const routeType = String(draft.type ?? "route_service").trim() || "route_service";
      const primaryOrigin = String(draft.primaryOrigin ?? "").trim();
      const primaryDestination = String(draft.primaryDestination ?? "").trim();

      if (!routeName) {
        result = { ok: false, error: "Route name is required." };
        return current;
      }
      if (!primaryOrigin || !primaryDestination) {
        result = { ok: false, error: "Primary origin and destination are required." };
        return current;
      }

      const normalizedDraft = normalizeRouteMasterRecord({
        ...draft,
        name: routeName,
        code: routeCode,
        type: routeType,
        primaryOrigin,
        primaryDestination,
        route: routeName,
        isActive: draft.isActive ?? true,
      });

      if (!normalizedDraft) {
        result = { ok: false, error: "Enter a valid route name." };
        return current;
      }

      const currentRoutes = current.routes ?? [];
      const existingRoute =
        currentRoutes.find(
          (route) =>
            route.id === draft.id ||
            route.id === normalizedDraft.id ||
            route.name?.trim().toLowerCase() === normalizedDraft.name.trim().toLowerCase(),
        ) ?? null;
      const duplicateCode = currentRoutes.find(
        (route) =>
          route.id !== existingRoute?.id &&
          String(route.code ?? "").trim().toUpperCase() === normalizedDraft.code,
      );

      if (duplicateCode) {
        result = { ok: false, error: "This route code is already linked to another route." };
        return current;
      }

      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextRoute = {
        ...existingRoute,
        ...normalizedDraft,
        createdAt: existingRoute?.createdAt ?? now,
        createdBy: existingRoute?.createdBy ?? actorId,
        createdByRole: existingRoute?.createdByRole ?? activeRole,
        updatedAt: existingRoute ? now : null,
        updatedBy: existingRoute ? actorId : null,
        updatedByRole: existingRoute ? activeRole : null,
      };
      const nextRoutesBase = existingRoute
        ? currentRoutes.map((route) => (route.id === existingRoute.id ? nextRoute : route))
        : [nextRoute, ...currentRoutes];
      const nextRoutes = collectRouteMasterRecords({
        ...current,
        routes: nextRoutesBase,
      });
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "fleet",
          action: existingRoute ? "update" : "create",
          entityType: "route",
          entityId: nextRoute.id,
          title: `Route ${existingRoute ? "updated" : "created"} / ${nextRoute.code}`,
          detail: `${nextRoute.name} / ${nextRoute.type}`,
        }),
      ]);

      result = {
        ok: true,
        message: existingRoute ? "Route profile updated." : "Route profile created.",
        routeId: nextRoute.id,
      };

      return {
        ...current,
        routes: nextRoutes,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const allocateDriverShift = (draft) => {
    let result = { ok: false, error: "Unable to save the driver allocation." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!PRIVILEGED_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can allocate drivers to vehicles." };
        return current;
      }
      if (!hasModuleUpdateAccess(current, "drivers")) {
        result = { ok: false, error: getModuleAccessErrorMessage("drivers") };
        return current;
      }

      const derived = deriveSnapshot(current);
      const driver = derived.drivers.find((item) => item.staffId === draft.staffId);

      if (!driver) {
        result = { ok: false, error: "Select a valid driver before saving the allocation." };
        return current;
      }

      const targetVehicle = draft.vehicleId
        ? derived.vehicles.find((vehicle) => vehicle.id === draft.vehicleId)
        : null;

      if (draft.vehicleId && !targetVehicle) {
        result = { ok: false, error: "Select a valid vehicle for the shift allocation." };
        return current;
      }
      if (targetVehicle?.status === "archived") {
        result = { ok: false, error: "Archived vehicles cannot receive a driver allocation." };
        return current;
      }

      const currentVehicle =
        derived.vehicles.find((vehicle) => vehicle.assignedDriverId === driver.staffId) ?? null;
      const displacedDriver =
        targetVehicle?.assignedDriverId && targetVehicle.assignedDriverId !== driver.staffId
          ? derived.drivers.find((item) => item.staffId === targetVehicle.assignedDriverId) ?? null
          : null;

      if ((currentVehicle?.id ?? "") === (targetVehicle?.id ?? "")) {
        result = {
          ok: true,
          message: targetVehicle
            ? `${driver.name} is already assigned to ${targetVehicle.registration}.`
            : `${driver.name} is already unassigned.`,
          staffId: driver.staffId,
          vehicleId: targetVehicle?.id ?? "",
        };
        return current;
      }

      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextVehicles = (current.vehicles ?? []).map((vehicle) => {
        if (vehicle.id === targetVehicle?.id) {
          return {
            ...vehicle,
            assignedDriverId: driver.staffId,
          };
        }

        if (vehicle.assignedDriverId === driver.staffId) {
          return {
            ...vehicle,
            assignedDriverId: null,
          };
        }

        return vehicle;
      });
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "drivers",
          action: "update",
          entityType: "allocation",
          entityId: `${driver.staffId}:${targetVehicle?.id ?? "unassigned"}`,
          title: `Shift allocation updated / ${driver.name}`,
          detail: [
            targetVehicle
              ? `${targetVehicle.registration} / ${targetVehicle.route}`
              : "Removed from vehicle",
            currentVehicle && currentVehicle.id !== targetVehicle?.id
              ? `Previous ${currentVehicle.registration}`
              : null,
            displacedDriver ? `${displacedDriver.name} removed from vehicle` : null,
          ]
            .filter(Boolean)
            .join(" / "),
        }),
      ]);

      result = {
        ok: true,
        message: targetVehicle
          ? `${driver.name} assigned to ${targetVehicle.registration}.`
          : `${driver.name} removed from the shift allocation.`,
        staffId: driver.staffId,
        vehicleId: targetVehicle?.id ?? "",
      };

      return {
        ...current,
        vehicles: nextVehicles,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const saveDriver = (draft) => {
    let result = { ok: false, error: "Unable to save the driver profile." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!PRIVILEGED_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can add drivers." };
        return current;
      }
      if (!hasModuleUpdateAccess(current, "drivers")) {
        result = { ok: false, error: getModuleAccessErrorMessage("drivers") };
        return current;
      }

      const driverName = String(draft.name ?? "").trim();
      if (!driverName) {
        result = { ok: false, error: "Driver name is required." };
        return current;
      }

      const email = normalizeEmailAddress(draft.email);
      if (!email) {
        result = { ok: false, error: "Driver email is required." };
        return current;
      }
      if (!isValidEmailAddress(email)) {
        result = { ok: false, error: "Enter a valid driver email address." };
        return current;
      }

      const routeCatalog = collectRouteMasterRecords(current);
      const selectedRouteIds = Array.from(
        new Set(
          (Array.isArray(draft.routeIds) ? draft.routeIds : [])
            .map((value) => String(value ?? "").trim())
            .filter(Boolean),
        ),
      );
      const selectedRoutes = selectedRouteIds
        .map((routeId) => routeCatalog.find((route) => route.id === routeId) ?? null)
        .filter(Boolean);

      if (selectedRoutes.length === 0) {
        result = {
          ok: false,
          error:
            routeCatalog.length > 0
              ? "Select at least one route for this driver."
              : "Add a route in Fleet & Operations before saving this driver.",
        };
        return current;
      }

      const existingDriver =
        (current.drivers ?? []).find(
          (driver) => driver.staffId === String(draft.staffId ?? "").trim(),
        ) ??
        (current.drivers ?? []).find(
          (driver) => normalizeEmailAddress(driver.email) === email,
        ) ??
        null;
      const currentUsers = getAppUsers(current);
      const existingUserByEmail =
        currentUsers.find((user) => normalizeEmailAddress(user.email) === email) ?? null;
      const linkedDriverByUserEmail =
        !existingDriver && existingUserByEmail?.staffId
          ? (current.drivers ?? []).find((driver) => driver.staffId === existingUserByEmail.staffId) ??
            null
          : null;
      const resolvedExistingDriver = existingDriver ?? linkedDriverByUserEmail;
      const existingUser =
        currentUsers.find(
          (user) =>
            user.staffId === resolvedExistingDriver?.staffId ||
            normalizeEmailAddress(user.email) === normalizeEmailAddress(resolvedExistingDriver?.email),
        ) ??
        existingUserByEmail ??
        null;

      if (
        currentUsers.some(
          (user) =>
            normalizeEmailAddress(user.email) === email &&
            user.staffId !== resolvedExistingDriver?.staffId,
        )
      ) {
        result = {
          ok: false,
          error: "This email is already linked to another TaxiFlow account.",
        };
        return current;
      }

      const accessPassword = String(draft.accessPassword ?? "").trim();
      if (!resolvedExistingDriver && !accessPassword) {
        result = { ok: false, error: "Create a password for this driver before saving." };
        return current;
      }
      if (accessPassword && accessPassword.length < 6) {
        result = {
          ok: false,
          error: "Driver password must be at least 6 characters long.",
        };
        return current;
      }

      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const routeNames = selectedRoutes.map((route) => route.name);
      const primaryRoute = routeNames[0] ?? "";
      const nextDriver = {
        ...resolvedExistingDriver,
        staffId: resolvedExistingDriver?.staffId ?? (draft.staffId?.trim() || createRecordId("drv")),
        name: driverName,
        email,
        route: primaryRoute,
        routeIds: selectedRouteIds,
        routeNames,
        primaryRouteId: selectedRouteIds[0] ?? null,
        shiftStatus: draft.shiftStatus ?? "Ready for dispatch",
        avgShiftRevenue: resolvedExistingDriver?.avgShiftRevenue ?? 0,
        cashAccuracy: resolvedExistingDriver?.cashAccuracy ?? 100,
        licenseNumber: String(draft.licenseNumber ?? "").trim() || null,
        licenseCode: String(draft.licenseCode ?? "").trim().toUpperCase() || null,
        licenseExpiryDate: draft.licenseExpiryDate || null,
        prdpNumber: String(draft.prdpNumber ?? "").trim() || null,
        prdpExpiryDate: draft.prdpExpiryDate || null,
        accessPassword: accessPassword || resolvedExistingDriver?.accessPassword || null,
        role: "Driver",
        createdAt: resolvedExistingDriver?.createdAt ?? now,
        createdBy: resolvedExistingDriver?.createdBy ?? actorId,
        createdByRole: resolvedExistingDriver?.createdByRole ?? activeRole,
        updatedAt: resolvedExistingDriver ? now : null,
        updatedBy: resolvedExistingDriver ? actorId : null,
        updatedByRole: resolvedExistingDriver ? activeRole : null,
      };
      const nextDriverUser = normalizeAppUser({
        ...existingUser,
        email,
        name: nextDriver.name,
        role: "Driver",
        actorId: existingUser?.actorId ?? nextDriver.staffId,
        staffId: nextDriver.staffId,
        accessPassword: nextDriver.accessPassword,
        createdAt: existingUser?.createdAt ?? nextDriver.createdAt,
        createdBy: existingUser?.createdBy ?? nextDriver.createdBy,
        createdByRole: existingUser?.createdByRole ?? nextDriver.createdByRole,
        updatedAt: existingUser ? now : null,
        updatedBy: existingUser ? actorId : null,
        updatedByRole: existingUser ? activeRole : null,
      });
      const nextDrivers = resolvedExistingDriver
        ? (current.drivers ?? []).map((driver) =>
            driver.staffId === resolvedExistingDriver.staffId ? nextDriver : driver,
          )
        : [nextDriver, ...(current.drivers ?? [])];
      const nextUsers = sortAppUsers(
        existingUser
          ? currentUsers.map((user) =>
              user.staffId === nextDriver.staffId ||
              normalizeEmailAddress(user.email) === normalizeEmailAddress(existingUser.email)
                ? nextDriverUser
                : normalizeAppUser(user),
            )
          : [...currentUsers, nextDriverUser],
      );
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "drivers",
          action: existingDriver ? "update" : "create",
          entityType: "driver",
          entityId: nextDriver.staffId,
          title: `Driver ${existingDriver ? "updated" : "created"} / ${nextDriver.name}`,
          detail: `${nextDriver.staffId} / ${getDriverRouteSummary(nextDriver)} / ${nextDriver.email}`,
        }),
      ]);

      result = {
        ok: true,
        message: resolvedExistingDriver
          ? `${nextDriver.name} updated in the driver roster.`
          : `${nextDriver.name} added to the driver roster.`,
        staffId: nextDriver.staffId,
      };

      return {
        ...current,
        drivers: nextDrivers,
        appUsers: nextUsers,
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const archiveVehicle = (vehicleId) => {
    let result = { ok: false, error: "Unable to archive this vehicle." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!PRIVILEGED_ROLES.has(activeRole)) {
        result = { ok: false, error: "Only management can archive vehicles." };
        return current;
      }
      if (!hasModuleUpdateAccess(current, "fleet")) {
        result = { ok: false, error: getModuleAccessErrorMessage("fleet") };
        return current;
      }

      const target = current.vehicles.find((vehicle) => vehicle.id === vehicleId);
      if (!target) {
        result = { ok: false, error: "Vehicle not found." };
        return current;
      }
      if (target.status === "archived") {
        result = { ok: false, error: "Vehicle is already archived." };
        return current;
      }

      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      result = { ok: true, message: `${target.registration} archived for audit retention.` };
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "fleet",
          action: "archive",
          entityType: "vehicle",
          entityId: target.id,
          title: `Vehicle archived / ${target.registration}`,
          detail: `${target.model} kept in the owner history`,
        }),
      ]);

      return {
        ...current,
        vehicles: current.vehicles.map((vehicle) =>
          vehicle.id === vehicleId
            ? {
                ...vehicle,
                status: "archived",
                archivedAt: now,
                archivedBy: actorId,
                archivedByRole: activeRole,
                updatedAt: now,
                updatedBy: actorId,
                updatedByRole: activeRole,
              }
            : vehicle,
        ),
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const logDefect = (draft) => {
    let result = { ok: false, error: "Unable to save the problem report." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      const existing = current.defects.find((defect) => defect.id === draft.id);
      if (!draft.vehicleId) {
        result = { ok: false, error: "Select a vehicle before reporting a problem." };
        return current;
      }
      if (!DEFECT_CATEGORIES.includes(draft.category)) {
        result = { ok: false, error: "Select a valid problem category." };
        return current;
      }
      if (activeRole !== "Driver" && !hasModuleUpdateAccess(current, "fleet")) {
        result = { ok: false, error: getModuleAccessErrorMessage("fleet") };
        return current;
      }
      if (existing && !["Owner", "Admin", "Manager"].includes(activeRole)) {
        result = { ok: false, error: "Only management can update reported problems." };
        return current;
      }
      if (existing?.status === "resolved") {
        result = { ok: false, error: "Fixed problems can no longer be changed." };
        return current;
      }

      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      if (!vehicle) {
        result = { ok: false, error: "Vehicle not found." };
        return current;
      }

      const severity =
        draft.category === "Engine" || draft.category === "Tires" || draft.category === "Windscreen"
          ? "High"
          : draft.category === "Seats"
            ? "Medium"
            : "Low";
      const detail = draft.detail?.trim() || draft.category;
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const defectRecord = {
        ...existing,
        id: draft.id ?? createRecordId("def"),
        vehicleId: draft.vehicleId,
        category: draft.category,
        issue: detail,
        detail,
        severity,
        reportedAt: existing?.reportedAt ?? now,
        reportedByStaffId: existing?.reportedByStaffId ?? actorId,
        reportedByRole: existing?.reportedByRole ?? activeRole,
        updatedAt: existing ? now : null,
        updatedBy: existing ? actorId : null,
        updatedByRole: existing ? activeRole : null,
        status: "open",
        costEstimate: existing?.costEstimate ?? 0,
        repairCost: null,
        resolvedAt: null,
        resolvedExpenseId: null,
        resolvedBy: null,
        resolvedByRole: null,
      };
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "fleet",
          action: existing ? "update" : "report",
          entityType: "defect",
          entityId: defectRecord.id,
          title: `Problem ${existing ? "updated" : "reported"} / ${vehicle.registration}`,
          detail,
        }),
      ]);

      result = {
        ok: true,
        message: existing
          ? "Reported problem updated in the vehicle history."
          : "Problem added to the vehicle history.",
      };

      return {
        ...current,
        defects: existing
          ? current.defects.map((defect) =>
              defect.id === draft.id ? { ...defect, ...defectRecord } : defect,
            )
          : [defectRecord, ...(current.defects ?? [])],
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const resolveDefect = (defectId, repairCost) => {
    let result = { ok: false, error: "Unable to mark this problem as fixed." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!["Owner", "Admin", "Manager"].includes(activeRole)) {
        result = { ok: false, error: "Only management can mark problems as fixed." };
        return current;
      }
      if (!hasModuleUpdateAccess(current, "fleet")) {
        result = { ok: false, error: getModuleAccessErrorMessage("fleet") };
        return current;
      }

      const target = (current.defects ?? []).find((defect) => defect.id === defectId);
      const amount = Number(repairCost);
      if (!target) {
        result = { ok: false, error: "Problem not found." };
        return current;
      }
      if (target.status === "resolved") {
        result = { ok: false, error: "Fixed problems can no longer be changed." };
        return current;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        result = { ok: false, error: "Enter the repair cost before marking this as fixed." };
        return current;
      }

      const vehicle = current.vehicles.find((item) => item.id === target.vehicleId);
      const expenseId = createRecordId("txn-exp");
      const timestamp = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const expenseRecord = {
        id: expenseId,
        type: "expense",
        expenseKind: "asset",
        category: `Repair / ${target.category}`,
        vehicleId: target.vehicleId,
        vehicle: vehicle?.registration ?? "Vehicle",
        amount,
        cashExpense: true,
        status: "verified",
        timestamp,
        createdAt: timestamp,
        createdBy: actorId,
        createdByRole: activeRole,
        verifiedAt: timestamp,
        verifiedBy: actorId,
        verifiedByRole: activeRole,
        depositId: null,
      };
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp,
          scope: "fleet",
          action: "resolve",
          entityType: "defect",
          entityId: defectId,
          title: `Problem fixed / ${vehicle?.registration ?? "Vehicle"}`,
          detail: `${target.detail ?? target.issue} / ${formatMoney(amount)}`,
        }),
        buildCurrentAuditEvent(current, {
          timestamp,
          scope: "finance",
          action: "create",
          entityType: "expense",
          entityId: expenseId,
          title: `Repair cost added / ${vehicle?.registration ?? "Vehicle"}`,
          detail: `${target.category} / ${formatMoney(amount)}`,
        }),
      ]);

      result = {
        ok: true,
        message: "Problem marked as fixed and the repair cost was added to expenses.",
      };

      return {
        ...current,
        defects: current.defects.map((defect) =>
          defect.id === defectId
            ? {
                ...defect,
                status: "resolved",
                repairCost: amount,
                resolvedAt: timestamp,
                resolvedExpenseId: expenseId,
                resolvedBy: actorId,
                resolvedByRole: activeRole,
                updatedAt: timestamp,
                updatedBy: actorId,
                updatedByRole: activeRole,
              }
            : defect,
        ),
        financeTransactions: [expenseRecord, ...(current.financeTransactions ?? [])],
        auditTrail: nextAuditTrail,
      };
    });

    return result;
  };

  const handleDriverShortcut = (shortcut) => {
    const token = { type: shortcut, issuedAt: Date.now() };

    if (shortcut === "Log shift takings") {
      setDriverShortcutIntent(token);
      setActiveView("drivers");
      return;
    }
    if (shortcut === "Log daily expense") {
      setDriverShortcutIntent(token);
      setActiveView("drivers");
      return;
    }
    if (shortcut === "Capture special trip") {
      setDriverShortcutIntent(token);
      setActiveView("drivers");
      return;
    }
    if (shortcut === "Report a defect") {
      setActiveView("fleet");
      return;
    }
    if (shortcut === "View vehicle status") {
      setActiveView("fleet");
    }
  };

  const backendModeLabel = backendMode === "live" ? "Live mode" : "Demo mode";
  const backendModeNote =
    backendMode === "live"
      ? `Client data is stored in ${repository.liveModeSourceLabel} with a clean live slate.`
      : "Training and presentation data is active. Reset demo to start from zero.";
  const showInstallButton = Boolean(installPromptEvent) && !pwaInstalled;

  const handleBackendModeChange = (nextMode) => {
    const resolvedMode = repository.setBackendMode(nextMode);

    setBackendFeedback(
      resolvedMode === "live"
        ? {
            tone: "success",
            message: `Live mode is active. Data now saves in ${repository.liveModeSourceLabel}.`,
          }
        : {
            tone: "info",
            message: "Demo data mode is active for training and presentations.",
          },
    );

    if (resolvedMode !== backendMode) {
      setLoading(true);
      setBackendMode(resolvedMode);
    }
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      return;
    }

    setInstallPromptOpen(true);

    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
      setInstallPromptEvent(null);
    } catch {
      // Ignore prompt failures and keep the current shell usable.
    } finally {
      setInstallPromptOpen(false);
    }
  };

  const handleFactoryReset = async (password) => {
    if (activeRole !== "Owner") {
      return { ok: false, error: "Only the owner can run a factory reset." };
    }

    const submittedPassword = String(password ?? "");
    if (!submittedPassword.trim()) {
      return { ok: false, error: "Enter the owner password before resetting the workspace." };
    }

    setFactoryResetSubmitting(true);

    if (!authEnabled) {
      if (submittedPassword !== LOCAL_AUTH_PASSWORD) {
        setFactoryResetSubmitting(false);
        return { ok: false, error: "Incorrect owner password." };
      }
    } else {
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email: String(authSession?.user?.email ?? "").trim().toLowerCase(),
          password: submittedPassword,
        });

        if (error) {
          setFactoryResetSubmitting(false);
          return { ok: false, error: "Incorrect owner password." };
        }
      } catch {
        setFactoryResetSubmitting(false);
        return { ok: false, error: "Unable to confirm the owner password right now." };
      }
    }

    const resetSnapshot = repository.resetModeSnapshot(backendMode);
    setSnapshot(resetSnapshot);
    setBackendFeedback({
      tone: "warning",
      message: `${
        backendMode === "live" ? "Live" : "Demo"
      } workspace reset to factory settings.`,
    });
    setFactoryResetSubmitting(false);

    return {
      ok: true,
      message: `${
        backendMode === "live" ? "Live" : "Demo"
      } workspace reset to factory settings.`,
    };
  };

  const openDefects = currentSnapshot.defects.filter(
    (defect) => defect.status !== "resolved",
  ).length;
  const visibleFleetCount = currentSnapshot.vehicles.length;
  const criticalDocs = currentSnapshot.documents.filter(
    (document) => document.daysLeft <= 30,
  ).length;
  const activeDrivers = currentSnapshot.drivers.filter(
    (driver) => driver.role === "Driver",
  ).length;
  const overviewAttentionCount = openDefects + criticalDocs;
  const pendingPasswordResetCount = (currentSnapshot.passwordResetRequests ?? []).filter(
    (request) => String(request.status ?? "pending").trim().toLowerCase() === "pending",
  ).length;

  const moduleMeta = {
    overview: {
      stat:
        activeRole === "Driver"
          ? currentSnapshot.driverTerminal.assignedVehicle
          : `${overviewAttentionCount}`,
      sub: activeRole === "Driver" ? "My terminal" : "Need action",
    },
    finance: {
      stat: `${currentSnapshot.finance.shiftsAwaitingVerification}`,
      sub: "Awaiting count",
    },
    fleet: {
      stat: activeRole === "Driver" ? currentSnapshot.driverTerminal.assignedVehicle : `${visibleFleetCount}`,
      sub: activeRole === "Driver" ? "My vehicle" : "Visible vehicles",
    },
    drivers: {
      stat: `${activeDrivers}`,
      sub: "Active drivers",
    },
    settings: {
      stat: pendingPasswordResetCount > 0 ? `${pendingPasswordResetCount}` : `${appUsers.length}`,
      sub: pendingPasswordResetCount > 0 ? "Reset requests" : "User access",
    },
  };

  return (
    <div className="app-shell">
      <div className="app-canvas">
        <main className="page-shell">
          <section className="app-toolbar">
            <div className="brand-lockup compact">
              <img
                className="brand-logo compact toolbar-logo"
                src="/taxiflow-logo.png"
                alt="TaxiFlow logo"
              />
              <div>
                <h1>{currentSnapshot.profile.fleetName}</h1>
                <p className="topbar-meta">
                  {currentSnapshot.profile.legalEntity} / {currentSnapshot.profile.district}
                </p>
              </div>
            </div>

            <div className="toolbar-actions">
              <div className="toolbar-meta">
                <span className="status-chip" data-tone="success">
                  <Clock size={14} />
                  <span>Banking window {currentSnapshot.profile.nextBankingWindow}</span>
                </span>
                {backendFeedback && (
                  <span className="status-chip" data-tone={backendFeedback.tone}>
                    {backendFeedback.message}
                  </span>
                )}
                {liveOperationalWarning && (
                  <span className="status-chip" data-tone="warning">
                    {liveOperationalWarning}
                  </span>
                )}
              </div>

              <div className="auth-session-panel">
                <span className="status-chip" data-tone="info">
                  {activeRole}
                </span>
                <div className="auth-session-copy">
                  <strong>{authDisplayName}</strong>
                  <span>{authSession?.user?.email}</span>
                </div>
                {showInstallButton && (
                  <button
                    type="button"
                    className="role-pill compact"
                    onClick={handleInstallApp}
                    disabled={installPromptOpen}
                  >
                    <ArrowDownToLine size={14} />
                    <span>{installPromptOpen ? "Installing..." : "Install app"}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="role-pill compact"
                  onClick={handleSignOut}
                  disabled={authSubmitting}
                >
                  <LogOut size={14} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          </section>

          <nav className="section-nav" aria-label="Primary views">
            {allowedViews.map((item) => (
              <ModuleButton
                key={item.id}
                active={item.id === activeView}
                icon={item.icon}
                label={item.label}
                stat={moduleMeta[item.id]?.stat}
                sub={moduleMeta[item.id]?.sub}
                onClick={() => setActiveView(item.id)}
              />
            ))}
          </nav>

          {activeView === "overview" && (
            <OverviewPanel
              activeRole={activeRole}
              snapshot={currentSnapshot}
              permissionControls={permissionControls}
              onNavigate={setActiveView}
              onShortcutAction={handleDriverShortcut}
              onSubmitDriverCashUp={submitDriverCashUp}
              onSelectDriverVehicle={selectDriverVehicle}
              onRequestAdminModuleAccess={requestAdminModuleAccess}
              onReviewAdminModuleAccess={reviewAdminModuleAccess}
              onSetAdminModuleAccess={setAdminModuleAccess}
            />
          )}
          {activeView === "finance" && (
            <FinancePanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              currentUserRecord={currentUserRecord}
              permissionControls={permissionControls}
              onNavigate={setActiveView}
              onSaveStandardIncome={saveStandardIncome}
              onSaveSpecialIncome={saveSpecialIncome}
              onSaveExpense={saveExpense}
              onSaveExpensePreset={saveExpensePreset}
              onVerifyIncome={verifyIncome}
              onDeleteTransaction={deleteTransaction}
              onLockDeposit={lockDeposit}
            />
          )}
          {activeView === "fleet" && (
            <FleetPanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              currentUserRecord={currentUserRecord}
              permissionControls={permissionControls}
              onSaveVehicle={saveVehicleProfile}
              onSaveRoute={saveRouteProfile}
              onArchiveVehicle={archiveVehicle}
              onLogDefect={logDefect}
              onResolveDefect={resolveDefect}
              onSelectDriverVehicle={selectDriverVehicle}
            />
          )}
          {activeView === "drivers" && (
            <DriversPanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              currentUserRecord={currentUserRecord}
              permissionControls={permissionControls}
              onShortcutAction={handleDriverShortcut}
              shortcutIntent={driverShortcutIntent}
              onSaveStandardIncome={saveStandardIncome}
              onSaveSpecialIncome={saveSpecialIncome}
              onSaveExpense={saveExpense}
              onSubmitDriverCashUp={submitDriverCashUp}
              onSaveDriver={saveDriver}
              onAllocateDriverShift={allocateDriverShift}
              onSelectDriverVehicle={selectDriverVehicle}
            />
          )}
          {activeView === "settings" && (
            <SettingsPanel
              activeRole={activeRole}
              snapshot={currentSnapshot}
              backendMode={backendMode}
              backendModeLabel={backendModeLabel}
              backendModeNote={backendModeNote}
              currentUserEmail={authSession?.user?.email ?? ""}
              factoryResetSubmitting={factoryResetSubmitting}
              isLocalAuth={!authEnabled}
              onChangeBackendMode={handleBackendModeChange}
              onFactoryReset={handleFactoryReset}
              onResolvePasswordResetRequest={resolvePasswordResetRequest}
              onResetUserPassword={resetUserPassword}
              onSaveUserAccess={saveUserAccess}
            />
          )}
        </main>

        <footer className="app-footer">
          <span>Created by Apprigate</span>
          <a href="https://www.apprigate.com" target="_blank" rel="noreferrer">
            www.apprigate.com
          </a>
        </footer>
      </div>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {allowedViews.map((item) => (
          <button
            key={item.id}
            className={item.id === activeView ? "bottom-nav-item active" : "bottom-nav-item"}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function OverviewPanel({
  activeRole,
  snapshot,
  permissionControls,
  onNavigate,
  onShortcutAction,
  onSubmitDriverCashUp,
  onSelectDriverVehicle,
  onRequestAdminModuleAccess,
  onReviewAdminModuleAccess,
  onSetAdminModuleAccess,
}) {
  const [driverCashFeedback, setDriverCashFeedback] = useState(null);
  const isDriver = activeRole === "Driver";
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const linkedVehicleIds = new Set(linkedVehicles.map((vehicle) => vehicle.id));
  const linkedVehicleRegistrations = new Set(
    linkedVehicles.map((vehicle) => vehicle.registration),
  );
  const criticalDocs = snapshot.documents.filter((document) => document.daysLeft <= 30).length;
  const warningDocs = snapshot.documents.filter(
    (document) => document.daysLeft > 30 && document.daysLeft <= 90,
  ).length;
  const watchDocs = snapshot.documents.length - criticalDocs - warningDocs;
  const visibleVehicles = isDriver ? linkedVehicles : snapshot.vehicles;
  const visibleFleetCount = visibleVehicles.length;
  const ownerAuditTrail = activeRole === "Owner" ? (snapshot.auditTrail ?? []).slice(0, 10) : [];
  const activeVehicles = visibleVehicles.filter((vehicle) => vehicle.status !== "archived");
  const archivedVehicles = visibleFleetCount - activeVehicles.length;
  const healthyVehicles = activeVehicles.filter(
    (vehicle) => getVehicleTone(vehicle) === "success",
  ).length;
  const criticalVehicles = activeVehicles.filter(
    (vehicle) => getVehicleTone(vehicle) === "danger",
  ).length;
  const attentionVehicles = activeVehicles.length - healthyVehicles - criticalVehicles;
  const activeDriverRecord =
    snapshot.drivers.find((driver) => driver.name === snapshot.driverTerminal.activeDriver) ??
    snapshot.drivers[0];
  const assignedVehicle = visibleVehicles.find(
    (vehicle) => vehicle.registration === snapshot.driverTerminal.assignedVehicle,
  ) ?? linkedVehicles[0];
  const driverDefects = snapshot.defects.filter(
    (defect) =>
      linkedVehicleIds.has(defect.vehicleId) || linkedVehicleRegistrations.has(defect.vehicle),
  );
  const cashSeries = snapshot.verificationQueue.slice(0, 4).map((entry) => ({
    label: entry.driver.split(" ")[0],
    primary: entry.counted,
    secondary: entry.claimed,
  }));
  const driverDayCashSummary =
    snapshot.driverTerminal?.dayCashSummary ?? createEmptyDriverDayCashSummary();
  const pendingDriverCashUps = snapshot.finance.pendingDriverCashUps ?? [];
  const handleDriverCashUp = () => {
    const response = onSubmitDriverCashUp?.();

    if (!response) {
      return;
    }

    setDriverCashFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };
  const bankingSeries = [
    { label: "In", value: snapshot.finance.bankingBatch.verifiedTakings },
    { label: "Out", value: snapshot.finance.bankingBatch.cashExpenses },
    { label: "Net", value: snapshot.finance.bankingBatch.depositAmount },
  ];

  if (isDriver) {
    return (
      <div className="content-stack">
        {driverCashFeedback && (
          <div className="finance-feedback" data-tone={driverCashFeedback.tone}>
            <span className="status-chip" data-tone={driverCashFeedback.tone}>
              {driverCashFeedback.message}
            </span>
          </div>
        )}
        <div className="analytics-grid overview-analytics">
          <InsightCard
            title="Expected cash in"
            metric={formatMoney(driverDayCashSummary.expectedCashIn)}
            meta={`${driverDayCashSummary.workDateLabel} / ${driverDayCashSummary.entryCount} entries`}
            icon={CheckSquare}
            tone={driverDayCashSummary.expectedCashIn > 0 ? "success" : "info"}
          >
            <MiniBars
              items={[
                { label: "In", value: driverDayCashSummary.totalIncome },
                { label: "Out", value: driverDayCashSummary.totalExpenses },
                { label: "Cash", value: Math.abs(driverDayCashSummary.expectedCashIn) },
              ]}
              tone="success"
            />
          </InsightCard>

          <InsightCard
            title="Assigned vehicle"
            metric={snapshot.driverTerminal.assignedVehicle}
            meta={snapshot.driverTerminal.assignedRoute}
            icon={Car}
            tone="navy"
          >
            <RingMeter
              value={assignedVehicle?.utilisation ?? 0}
              total={100}
              label={`${assignedVehicle?.utilisation ?? 0}%`}
              tone="navy"
            />
          </InsightCard>

          <InsightCard
            title="PrDP days left"
            metric={activeDriverRecord?.prdpDays ? `${activeDriverRecord.prdpDays}d` : "N/A"}
            meta="days left"
            icon={Shield}
            tone={activeDriverRecord?.prdpDays && activeDriverRecord.prdpDays <= 30 ? "danger" : "info"}
          >
            <RingMeter
              value={Math.max(Math.min(activeDriverRecord?.prdpDays ?? 0, 180), 0)}
              total={180}
              label={activeDriverRecord?.prdpDays ? `${activeDriverRecord.prdpDays}` : "N/A"}
              tone={
                activeDriverRecord?.prdpDays && activeDriverRecord.prdpDays <= 30
                  ? "danger"
                  : "info"
              }
            />
          </InsightCard>

          <InsightCard
            title="Open defects"
            metric={`${driverDefects.length}`}
            meta="my vehicle"
            icon={AlertTriangle}
            tone={driverDefects.length > 0 ? "warning" : "success"}
          >
            <SegmentMeter
              segments={[
                { label: "Open", value: driverDefects.length, tone: "warning" },
                { label: "Clear", value: Math.max(3 - driverDefects.length, 0), tone: "success" },
              ]}
            />
          </InsightCard>
        </div>

        {linkedVehicles.length > 1 && (
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Linked vehicles</p>
              <h3>Choose active vehicle</h3>
            </div>
            <div className="finance-sub-switch">
              {linkedVehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  type="button"
                  className={
                    vehicle.id === snapshot.driverTerminal.assignedVehicleId
                      ? "finance-sub-pill active"
                      : "finance-sub-pill"
                  }
                  onClick={() => onSelectDriverVehicle(vehicle.id)}
                >
                  {vehicle.registration}
                </button>
              ))}
            </div>
          </article>
        )}

        <DriverCashSummaryBoard
          summary={driverDayCashSummary}
          onSubmitCashUp={handleDriverCashUp}
        />

        <div className="overview-board-grid">
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Today</p>
              <h3>Quick actions</h3>
            </div>
            <div className="shortcut-grid compact">
              {snapshot.driverTerminal.shortcuts.map((shortcut, index) => (
                <button
                  key={`${shortcut}-${index}`}
                  type="button"
                  className="shortcut-button"
                  onClick={() => onShortcutAction(shortcut)}
                >
                  {formatShortcutLabel(shortcut)}
                </button>
              ))}
            </div>
          </article>

          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Attention</p>
              <h3>My alerts</h3>
            </div>
            <div className="compact-feed">
              {driverDefects.slice(0, 2).map((defect, index) => (
                <CompactFeedItem
                  key={defect.id ?? `${defect.vehicle}-${defect.issue}-${index}`}
                  title={defect.issue}
                  subtitle={defect.statusLabel ?? defect.status}
                  tone={getDefectTone(defect.severity)}
                  meta={defect.reportedAtLabel ?? defect.reportedAt}
                />
              ))}
              <CompactFeedItem
                title="Odometer check"
                subtitle={`${snapshot.driverTerminal.lastShift.openOdo.toLocaleString()} to ${snapshot.driverTerminal.lastShift.closeOdo.toLocaleString()} km`}
                tone="info"
                meta={snapshot.driverTerminal.assignedVehicle}
              />
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="content-stack">
      <div className="analytics-grid overview-analytics">
        <InsightCard
          title="Daily total entered"
          metric={formatMoney(snapshot.finance.todayClaimed)}
          meta={`${snapshot.finance.handoversAwaitingAdmin} waiting hand-in / ${snapshot.finance.checksAwaitingManager} waiting manager`}
          icon={Banknote}
          tone="warning"
        >
          <SegmentMeter
            segments={[
              { label: "Hand-in", value: snapshot.finance.handoversAwaitingAdmin, tone: "warning" },
              { label: "Manager", value: snapshot.finance.checksAwaitingManager, tone: "info" },
              { label: "Ready", value: snapshot.finance.verifiedToday, tone: "success" },
            ]}
          />
        </InsightCard>

        <InsightCard
          title="Cash handed in"
          metric={formatMoney(snapshot.finance.todayCounted)}
          meta={`${snapshot.finance.checksAwaitingManager} waiting manager check`}
          icon={Lock}
          tone={snapshot.finance.checksAwaitingManager > 0 ? "warning" : "success"}
        >
          <MiniCompareChart items={cashSeries} />
        </InsightCard>

        <InsightCard
          title="Expected cash in"
          metric={formatMoney(snapshot.finance.expectedCashInHeadsUp)}
          meta={`${pendingDriverCashUps.length} driver checking${pendingDriverCashUps.length === 1 ? "" : "s"}`}
          icon={CheckSquare}
          tone={pendingDriverCashUps.length > 0 ? "warning" : "success"}
        >
          <MiniBars
            items={pendingDriverCashUps.slice(0, 4).map((entry, index) => ({
              label: entry.driverName?.split(" ")[0] ?? `D${index + 1}`,
              value: Math.abs(entry.expectedCashIn),
            }))}
            tone="warning"
          />
        </InsightCard>

        <InsightCard
          title="Next bank deposit"
          metric={formatMoney(snapshot.finance.bankingBatch.depositAmount)}
          meta={snapshot.finance.bankingBatch.reference}
          icon={Building2}
          tone="navy"
        >
          <MiniBars items={bankingSeries} tone="navy" />
        </InsightCard>

        <InsightCard
          title="Documents"
          metric={`${criticalDocs} urgent`}
          meta="90 / 60 / 30"
          icon={ShieldAlert}
          tone={criticalDocs > 0 ? "danger" : "info"}
        >
          <SegmentMeter
            segments={[
              { label: "30", value: criticalDocs, tone: "danger" },
              { label: "60", value: warningDocs, tone: "warning" },
              { label: "90", value: watchDocs, tone: "info" },
            ]}
          />
        </InsightCard>

        <InsightCard
          title="Fleet & Operations overview"
          metric={`${visibleFleetCount}`}
          meta={`${activeVehicles.length} active / ${archivedVehicles} archived`}
          icon={Wrench}
          tone={criticalVehicles > 0 ? "warning" : "success"}
        >
          <SegmentMeter
            segments={[
              { label: "Healthy", value: healthyVehicles, tone: "success" },
              { label: "Attention", value: attentionVehicles, tone: "warning" },
              { label: "Critical", value: criticalVehicles, tone: "danger" },
            ]}
          />
        </InsightCard>
      </div>

      <div className="overview-board-grid">
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Heads up</p>
            <h3>Driver checking heads up</h3>
          </div>
          <div className="finance-ledger">
            {pendingDriverCashUps.slice(0, 4).map((entry) => (
              <article key={entry.id} className="ledger-row">
                <div className="ledger-copy">
                  <strong>{entry.driverName} / {entry.workDateLabel}</strong>
                  <span>
                    {entry.vehicle ?? "Vehicle pending"} / {entry.workflowLabel} / {entry.entryCount}{" "}
                    entries
                  </span>
                </div>
                <div className="ledger-meta">
                  <span className="status-chip" data-tone={entry.workflowTone}>
                    {entry.checkedAtLabel}
                  </span>
                  <strong>{formatMoney(entry.expectedCashIn)}</strong>
                </div>
              </article>
            ))}
            {pendingDriverCashUps.length === 0 && (
              <p className="panel-note">
                Drivers have not sent any day checking heads up yet.
              </p>
            )}
          </div>
        </article>

        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Issues</p>
            <h3>Cash and distance checks</h3>
          </div>
          <div className="compact-feed">
            {snapshot.verificationQueue
              .filter((entry) => entry.shortage > 0 || entry.gapKm > 0)
              .slice(0, 3)
              .map((entry) => (
                <CompactFeedItem
                  key={entry.id}
                  title={`${entry.driver} / ${entry.vehicle}`}
                  subtitle={entry.status}
                  tone={getQueueTone(entry)}
                  meta={`${formatMoney(entry.shortage)} / ${entry.gapKm} km`}
                />
              ))}
          </div>
        </article>

        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Documents</p>
            <h3>Next expiries</h3>
          </div>
          <div className="compact-feed">
            {snapshot.documents.slice(0, 3).map((document) => (
              <CompactFeedItem
                key={`${document.subject}-${document.document}`}
                title={`${document.subject} / ${document.document}`}
                subtitle={document.stage}
                tone={getDocumentTone(document.daysLeft)}
                meta={`${document.daysLeft} days`}
              />
            ))}
          </div>
        </article>

        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Today</p>
            <h3>Daily flow</h3>
          </div>
          <div className="flow-strip">
            {snapshot.operationsLoop.map((step) => (
              <FlowLane key={step.id} owner={step.owner} title={step.title} tone={step.accent} />
            ))}
          </div>
          <div className="module-quick-links">
            <button className="cta-link" onClick={() => onNavigate("finance")} type="button">
              Money
              <ChevronRight size={16} />
            </button>
            <button className="cta-link" onClick={() => onNavigate("fleet")} type="button">
              Fleet & Operations
              <ChevronRight size={16} />
            </button>
            <button className="cta-link" onClick={() => onNavigate("drivers")} type="button">
              Drivers
              <ChevronRight size={16} />
            </button>
          </div>
        </article>
      </div>

      <CompliancePanel snapshot={snapshot} />

      {activeRole === "Owner" && (
        <Panel eyebrow="Owner tools" title="System activity history" icon={Clock}>
          <div className="finance-ledger">
            {ownerAuditTrail.map((entry) => (
              <article key={entry.id} className="ledger-row">
                <div className="ledger-copy">
                  <strong>{entry.title}</strong>
                  <span>{entry.detail}</span>
                </div>
                <div className="ledger-meta">
                  <span className="status-chip" data-tone={entry.tone}>
                    {entry.actionLabel}
                  </span>
                  <span>
                    {entry.actorLabel} / {entry.timestampLabel}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function AdminEditAccessPanel({
  activeRole,
  permissionControls,
  storedAppUsers,
  onRequestAdminModuleAccess,
  onReviewAdminModuleAccess,
  onSetAdminModuleAccess,
}) {
  const [feedback, setFeedback] = useState(null);
  const pushFeedback = (response) => {
    if (!response) {
      return;
    }

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  return (
    <Panel eyebrow="Access control" title="Admin edit permissions" icon={Lock}>
      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}
      <div className="overview-board-grid">
        {Object.entries(MODULE_EDIT_ACCESS).map(([moduleKey, moduleConfig]) => {
          const control = permissionControls[moduleKey];
          const ownerSettingsAccess = (storedAppUsers ?? []).some(
            (user) =>
              normalizeRole(user.role) === "Admin" &&
              normalizeModuleViewAccess(user.moduleAccess, user.role)?.[moduleKey],
          );
          const effectiveControl = ownerSettingsAccess ? { ...control, active: true } : control;
          const status = getModuleAccessStatus(effectiveControl);
          const requestMeta = control.requestedAt
            ? `Requested ${formatStamp(control.requestedAt)}`
            : "No owner request has been sent yet.";
          const reviewMeta = control.ownerReviewedAt
            ? `Owner reviewed ${formatStamp(control.ownerReviewedAt)}`
            : "Owner decision still pending.";
          const grantMeta = ownerSettingsAccess
            ? "Enabled by owner in Settings."
            : control.grantedAt
              ? `Manager granted ${formatStamp(control.grantedAt)}`
              : "Admin access is not active.";

          return (
            <article key={moduleKey} className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">{moduleConfig.label}</p>
                <h3>{status.label}</h3>
              </div>
              <p className="panel-note">{moduleConfig.detail}</p>
              <div className="finance-form-meta">
                <span className="status-chip" data-tone={status.tone}>
                  {status.label}
                </span>
                <span className="status-chip" data-tone="info">
                  {effectiveControl.active
                    ? grantMeta
                    : ["approved", "rejected"].includes(control.requestStatus)
                      ? reviewMeta
                      : requestMeta}
                </span>
              </div>
              <div className="finance-form-actions">
                {activeRole === "Manager" &&
                  !ownerSettingsAccess &&
                  control.requestStatus !== "approved" &&
                  !control.active && (
                  <button
                    type="button"
                    className="action-button primary"
                    disabled={control.requestStatus === "pending"}
                    onClick={() => pushFeedback(onRequestAdminModuleAccess(moduleKey))}
                  >
                    Ask owner
                  </button>
                )}
                {activeRole === "Manager" &&
                  !ownerSettingsAccess &&
                  control.requestStatus === "approved" &&
                  !control.active && (
                  <button
                    type="button"
                    className="action-button primary"
                    onClick={() => pushFeedback(onSetAdminModuleAccess(moduleKey, true))}
                  >
                    Grant to admin
                  </button>
                )}
                {["Owner", "Manager"].includes(activeRole) && control.active && !ownerSettingsAccess && (
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => pushFeedback(onSetAdminModuleAccess(moduleKey, false))}
                  >
                    Remove admin access
                  </button>
                )}
                {activeRole === "Owner" && control.requestStatus === "pending" && !ownerSettingsAccess && (
                  <>
                    <button
                      type="button"
                      className="action-button primary"
                      onClick={() => pushFeedback(onReviewAdminModuleAccess(moduleKey, "approved"))}
                    >
                      Approve request
                    </button>
                    <button
                      type="button"
                      className="record-button danger"
                      onClick={() => pushFeedback(onReviewAdminModuleAccess(moduleKey, "rejected"))}
                    >
                      Decline request
                    </button>
                  </>
                )}
              </div>
              <p className="panel-note">
                {activeRole === "Owner" &&
                  (ownerSettingsAccess
                    ? "Admin access for this area is currently being controlled in Settings."
                    : control.requestStatus === "pending"
                    ? "Review the manager request before admin can receive edit access."
                    : control.active
                      ? "Admin is currently allowed to edit saved records in this area."
                      : "Only the owner can approve new admin edit access requests.")}
                {activeRole === "Manager" &&
                  (ownerSettingsAccess
                    ? "Owner Settings already control admin access for this area."
                    : control.requestStatus === "pending"
                    ? "Waiting for the owner to respond."
                    : control.requestStatus === "approved" && !control.active
                      ? "Owner approval is ready. You can now grant admin access."
                      : control.active
                        ? "Admin edit access is live for this area."
                        : "Ask the owner first, then grant access to admin after approval.")}
                {activeRole === "Admin" &&
                  (effectiveControl.active
                    ? ownerSettingsAccess
                      ? "You can edit saved records in this area because the owner enabled it in Settings."
                      : "You can edit saved records in this area while this manager grant stays active."
                    : "Edits stay locked until the owner enables this area in Settings or a manager grant becomes active.")}
              </p>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function FinancePanel({
  snapshot,
  activeRole,
  currentUserRecord,
  permissionControls,
  onNavigate,
  onSaveStandardIncome,
  onSaveSpecialIncome,
  onSaveExpense,
  onSaveExpensePreset,
  onVerifyIncome,
  onDeleteTransaction,
  onLockDeposit,
}) {
  const finance = snapshot.finance;
  const defaultVehicle = snapshot.vehicles[0] ?? null;
  const defaultVehicleId = defaultVehicle?.id ?? "";
  const defaultVehicleRoute = defaultVehicle?.route ?? "";
  const [financeView, setFinanceView] = useState("revenue");
  const [expenseView, setExpenseView] = useState("vehicle");
  const [feedback, setFeedback] = useState(null);
  const [verificationInputs, setVerificationInputs] = useState({});
  const [pendingRevenueTarget, setPendingRevenueTarget] = useState(null);
  const standardEntryRef = useRef(null);
  const specialEntryRef = useRef(null);
  const depositLockRef = useRef(null);
  const verificationQueueRef = useRef(null);
  const [standardDraft, setStandardDraft] = useState(() =>
    createStandardDraft(
      defaultVehicleId,
      finance.vehicleOpenings?.[defaultVehicleId],
      defaultVehicleRoute,
    ),
  );
  const [specialDraft, setSpecialDraft] = useState(() => createSpecialDraft(defaultVehicleId));
  const [expenseDraft, setExpenseDraft] = useState(() =>
    createExpenseDraft("asset", defaultVehicleId, finance.expenseCatalog),
  );
  const [expensePresetDraft, setExpensePresetDraft] = useState(() =>
    createExpensePresetDraft("asset"),
  );

  const incomeRecords = snapshot.financeTransactions.filter((record) => record.type === "income");
  const expenseRecords = snapshot.financeTransactions.filter((record) => record.type === "expense");
  const expenseKind = expenseView === "vehicle" ? "asset" : "operational";
  const filteredExpenseRecords = expenseRecords.filter((record) =>
    expenseView === "vehicle" ? record.expenseKind === "asset" : record.expenseKind === "operational",
  );
  const expenseItems =
    expenseView === "vehicle"
      ? finance.expenseManagement.vehicleSpecific
      : finance.expenseManagement.operational;
  const expensePresetItems = getExpenseCatalogEntries(finance.expenseCatalog, expenseKind);
  const expenseCategoryOptions = getExpenseCategoryOptions(
    finance.expenseCatalog,
    expenseDraft.expenseKind,
    expenseDraft.category,
  );
  const expenseDescriptionOptions = getExpenseDescriptionOptions(
    finance.expenseCatalog,
    expenseDraft.expenseKind,
    expenseDraft.category,
  );
  const usesCustomExpenseDescription =
    expenseDraft.category === EXPENSE_OTHER_CATEGORY ||
    expenseDraft.descriptionPreset === EXPENSE_CUSTOM_DESCRIPTION_VALUE ||
    expenseDescriptionOptions.length === 0;
  const selectedVehicleOpening =
    finance.vehicleOpenings?.[standardDraft.vehicleId || defaultVehicleId] ?? 0;
  const selectedStandardVehicleRoute =
    snapshot.vehicles.find((vehicle) => vehicle.id === standardDraft.vehicleId)?.route ??
    defaultVehicleRoute;
  const standardTripTotals = getDailyTripLogbookTotals(standardDraft.tripLogbook);
  const specialBusinessKm = getBusinessKmValue(specialDraft);
  const gapKm = Math.abs(
    Number(standardDraft.openingOdo || selectedVehicleOpening) - Number(selectedVehicleOpening || 0),
  );
  const standardValidationError = getStandardDraftValidationError(standardDraft);
  const specialValidationError = getSpecialDraftValidationError(specialDraft);
  const verificationRecords = snapshot.verificationQueue.slice(0, 8);
  const depositHistory = snapshot.deposits.slice(0, 3);
  const lockableCount = snapshot.verificationQueue.filter(
    (entry) => entry.workflowStatus === "verified",
  ).length;
  const canEditFinanceUpdates = canEditModuleUpdates(
    activeRole,
    "finance",
    permissionControls,
    currentUserRecord,
  );
  const canRecordCashHandIn = canRecordCashHandoverForRole(activeRole);
  const canVerifyFinanceChecks = canVerifyCashCheckForRole(activeRole);
  const canFinishDeposit = canFinishDepositForRole(activeRole) && canEditFinanceUpdates;
  const financeAccessStatus = getModuleAccessStatus(permissionControls.finance);
  const autoCheckFinanceEntries = activeRole !== "Driver" && canEditFinanceUpdates;

  useEffect(() => {
    if (!standardDraft.vehicleId && defaultVehicleId) {
      setStandardDraft(
        createStandardDraft(
          defaultVehicleId,
          finance.vehicleOpenings?.[defaultVehicleId],
          defaultVehicleRoute,
        ),
      );
    }
  }, [defaultVehicleId, defaultVehicleRoute, finance.vehicleOpenings, standardDraft.vehicleId]);

  useEffect(() => {
    if (!specialDraft.vehicleId && defaultVehicleId) {
      setSpecialDraft(createSpecialDraft(defaultVehicleId));
    }
  }, [defaultVehicleId, specialDraft.vehicleId]);

  useEffect(() => {
    if (expenseDraft.expenseKind === "asset" && !expenseDraft.vehicleId && defaultVehicleId) {
      setExpenseDraft((current) => ({ ...current, vehicleId: defaultVehicleId }));
    }
  }, [defaultVehicleId, expenseDraft.expenseKind, expenseDraft.vehicleId]);

  useEffect(() => {
    if (financeView !== "revenue" || !pendingRevenueTarget) {
      return;
    }

    const targetRef = pendingRevenueTarget === "special" ? specialEntryRef : standardEntryRef;
    const targetNode = targetRef.current;

    if (!targetNode) {
      return;
    }

    targetNode.scrollIntoView({ behavior: "smooth", block: "start" });
    targetNode.querySelector("input, select, button")?.focus();
    setPendingRevenueTarget(null);
  }, [financeView, pendingRevenueTarget]);

  const pushFeedback = (response) => {
    if (!response) {
      return;
    }

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  const handleExpenseViewChange = (nextView) => {
    const nextExpenseKind = nextView === "vehicle" ? "asset" : "operational";
    setExpenseView(nextView);
    setExpenseDraft(
      createExpenseDraft(nextExpenseKind, defaultVehicleId, finance.expenseCatalog),
    );
    setExpensePresetDraft(createExpensePresetDraft(nextExpenseKind));
  };

  const handleStandardSubmit = (event) => {
    event.preventDefault();
    const response = onSaveStandardIncome(standardDraft);
    pushFeedback(response);
    if (response.ok) {
      setStandardDraft(
        createStandardDraft(
          standardDraft.vehicleId,
          response.nextOpeningOdo,
          selectedStandardVehicleRoute,
        ),
      );
    }
  };

  const handleSpecialSubmit = (event) => {
    event.preventDefault();
    const response = onSaveSpecialIncome(specialDraft);
    pushFeedback(response);
    if (response.ok) {
      setSpecialDraft(createSpecialDraft(specialDraft.vehicleId || defaultVehicleId));
    }
  };

  const handleExpenseSubmit = (event) => {
    event.preventDefault();
    const response = onSaveExpense(expenseDraft);
    pushFeedback(response);
    if (response.ok) {
      setExpenseDraft(
        createExpenseDraft(expenseKind, defaultVehicleId, finance.expenseCatalog),
      );
    }
  };

  const handleExpensePresetSubmit = (event) => {
    event.preventDefault();
    const response = onSaveExpensePreset({
      ...expensePresetDraft,
      expenseKind,
    });
    pushFeedback(response);
    if (response.ok) {
      setExpensePresetDraft(createExpensePresetDraft(expenseKind));
    }
  };

  const handleVerify = (recordId) => {
    const response = onVerifyIncome(recordId, verificationInputs[recordId]);
    pushFeedback(response);
    if (response.ok) {
      setVerificationInputs((current) => {
        const next = { ...current };
        delete next[recordId];
        return next;
      });
    }
  };

  const handleDelete = (recordId) => {
    pushFeedback(onDeleteTransaction(recordId));
  };

  const handleEditIncome = (record) => {
    setFinanceView("revenue");
    if (record.incomeKind === "standard") {
      const route =
        record.route ??
        snapshot.vehicles.find((vehicle) => vehicle.id === record.vehicleId)?.route ??
        "";
      setStandardDraft(
        syncStandardDraftTripLogbook({
          id: record.id,
          vehicleId: record.vehicleId,
          route,
          tripDate: record.tripDate ?? toDateInputValue(record.timestamp),
          timeIn: record.timeIn ?? toTimeInputValue(record.timestamp),
          timeOut: record.timeOut ?? "",
          tripLogbook: buildStandardTripLogbookDraft(
            route,
            record.tripLogbook,
            record.amountClaimed ?? record.amount ?? "",
            record.totalPassengers ?? "",
          ),
          openingOdo: String(record.openingOdo ?? ""),
          closingOdo: String(record.closingOdo ?? ""),
          amountClaimed: String(record.amountClaimed ?? record.amount ?? ""),
        }),
      );
      return;
    }

    const routeParts = String(record.route ?? "").split(" to ");
    setSpecialDraft({
      id: record.id,
      vehicleId: record.vehicleId ?? defaultVehicleId,
      tripDate: record.tripDate ?? toDateInputValue(record.timestamp),
      openingOdo: String(record.openingOdo ?? ""),
      closingOdo: String(record.closingOdo ?? ""),
      fromLocation: record.fromLocation ?? routeParts[0] ?? "",
      toLocation: record.toLocation ?? routeParts.slice(1).join(" to ") ?? "",
      travelReason: record.travelReason ?? record.description ?? "",
      fuelOilCost: String(record.fuelOilCost ?? 0),
      repairMaintenanceCost: String(record.repairMaintenanceCost ?? 0),
      amount: String(record.amount ?? ""),
    });
  };

  const handleEditExpense = (record) => {
    setFinanceView("expenses");
    setExpenseView(record.expenseKind === "asset" ? "vehicle" : "operational");
    setExpenseDraft({
      id: record.id,
      expenseKind: record.expenseKind,
      category: record.category ?? "",
      description: record.description ?? "",
      descriptionPreset: getExpenseDescriptionPresetValue(
        finance.expenseCatalog,
        record.expenseKind,
        record.category ?? "",
        record.description ?? "",
      ),
      expenseDate: record.expenseDate ?? toDateInputValue(record.timestamp),
      reference: record.reference ?? "",
      vehicleId: record.vehicleId ?? defaultVehicleId,
      amount: String(record.amount ?? ""),
      cashExpense: Boolean(record.cashExpense),
    });
  };

  const openRevenueEntry = (target = "standard") => {
    setFinanceView("revenue");
    setPendingRevenueTarget(target);
  };

  const scrollToSection = (targetRef) => {
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="content-stack">
      <section className="hero-card hero-card-minimal finance-access-card">
        <div className="hero-copy hero-copy-minimal">
          <p className="eyebrow">Quick access</p>
          <h2>Daily earnings log</h2>
          <p className="hero-text">
            Use this entry point to add daily trip income and extra trip income without searching
            through the money screens.
          </p>
          <div className="hero-meta-strip">
            <span className="status-chip" data-tone="info">
              Daily trips
            </span>
            <span className="status-chip" data-tone="warning">
              Extra trips
            </span>
            <span className="status-chip" data-tone="success">
              {finance.todayClaimed > 0 ? formatMoney(finance.todayClaimed) : "No takings yet"}
            </span>
          </div>
        </div>

        <div className="finance-shortcut-row">
          <button
            type="button"
            className="action-button primary finance-shortcut-button"
            onClick={() => openRevenueEntry("standard")}
          >
            <ArrowDownToLine size={16} />
            Open daily earnings log
          </button>
          <button
            type="button"
            className="action-button finance-shortcut-button"
            onClick={() => openRevenueEntry("special")}
          >
            <TrendingUp size={16} />
            Open extra trip entry
          </button>
        </div>
      </section>

      <div className="finance-module-nav">
        <FinanceModeButton
          active={financeView === "revenue"}
          label="Daily Earnings"
          meta="Daily trips and extra trips"
          icon={TrendingUp}
          onClick={() => setFinanceView("revenue")}
        />
        <FinanceModeButton
          active={financeView === "expenses"}
          label="Expenses"
          meta="Vehicle and business costs"
          icon={Briefcase}
          onClick={() => setFinanceView("expenses")}
        />
        <FinanceModeButton
          active={financeView === "banking"}
          label="Banking"
          meta="Cash hand-in, manager check, and deposits"
          icon={Lock}
          onClick={() => setFinanceView("banking")}
        />
      </div>

      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      {PRIVILEGED_ROLES.has(activeRole) && !canEditFinanceUpdates && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Management access</p>
            <h3>Money edits are locked</h3>
          </div>
          <p className="panel-note">
            The owner can enable Money rights in Settings. Until then this management account
            cannot edit saved daily takings, delete records, or finish deposits. Cash hand-ins stay
            available so you can compare what was received against the app.
          </p>
          <div className="finance-form-meta">
            <span className="status-chip" data-tone={financeAccessStatus.tone}>
              {financeAccessStatus.label}
            </span>
          </div>
        </article>
      )}

      {financeView === "revenue" && (
        <div className="content-stack">
          <div className="analytics-grid finance-analytics">
            <InsightCard
              title="Daily route trips"
              metric={`${finance.revenueLogging.standardRouteCount}`}
              meta={formatMoney(finance.revenueLogging.standardRouteRevenue)}
              icon={Banknote}
              tone="navy"
            >
              <MiniBars
                items={finance.revenueLogging.routes.map((route) => ({
                  label: route.label,
                  value: route.amount,
                }))}
                tone="navy"
              />
            </InsightCard>

            <InsightCard
              title="Extra trips"
              metric={`${finance.revenueLogging.specialTripCount}`}
              meta={formatMoney(finance.revenueLogging.specialTripRevenue)}
              icon={TrendingUp}
              tone="info"
            >
              <MiniBars
                items={finance.revenueLogging.specialTrips.map((trip) => ({
                  label: trip.vehicle.split(" ")[0],
                  value: trip.amount,
                }))}
                tone="info"
              />
            </InsightCard>

            <InsightCard
              title="Total entered today"
              metric={formatMoney(finance.todayClaimed)}
              meta="Daily trips plus extra trips"
              icon={ArrowDownToLine}
              tone="warning"
            >
              <SegmentMeter
                segments={[
                  { label: "Hand-in", value: finance.handoversAwaitingAdmin, tone: "warning" },
                  {
                    label: "Manager",
                    value: finance.checksAwaitingManager,
                    tone: "info",
                  },
                  { label: "Ready", value: finance.verifiedToday, tone: "success" },
                ]}
              />
            </InsightCard>

            <InsightCard
              title="Cash handed in"
              metric={formatMoney(finance.todayCounted)}
              meta="Admin compared cash with the app"
              icon={CheckCircle2}
              tone="success"
            >
              <MiniCompareChart
                items={snapshot.verificationQueue.slice(0, 4).map((entry) => ({
                  label: entry.driver.split(" ")[0],
                  primary: entry.counted,
                  secondary: entry.claimed,
                }))}
              />
            </InsightCard>
          </div>

          <div className="finance-board-grid finance-board-grid-3">
            <article ref={standardEntryRef} className="overview-board finance-entry-board">
              <div className="overview-board-head">
                <p className="eyebrow">Daily earnings log</p>
                <h3>Daily trip entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleStandardSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Vehicle</span>
                    <select
                      value={standardDraft.vehicleId}
                      onChange={(event) => {
                        const nextVehicle =
                          snapshot.vehicles.find((vehicle) => vehicle.id === event.target.value) ?? null;

                        setStandardDraft((current) =>
                          syncStandardDraftTripLogbook({
                            ...current,
                            vehicleId: event.target.value,
                            route: nextVehicle?.route ?? "",
                            tripLogbook: createDailyTripLogbook(nextVehicle?.route ?? ""),
                            openingOdo: String(
                              finance.vehicleOpenings?.[event.target.value] ?? "",
                            ),
                            closingOdo: "",
                          }),
                        );
                      }}
                    >
                      {snapshot.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.registration} / {vehicle.route}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="finance-field">
                    <span>Date</span>
                    <input
                      type="date"
                      value={standardDraft.tripDate}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          tripDate: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Time in</span>
                    <input
                      type="time"
                      value={standardDraft.timeIn}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          timeIn: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Time out</span>
                    <input
                      type="time"
                      value={standardDraft.timeOut}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          timeOut: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Opening odo</span>
                    <input
                      type="number"
                      value={standardDraft.openingOdo}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          openingOdo: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Closing odo</span>
                    <input
                      type="number"
                      min={Number(standardDraft.openingOdo || 0) + 1}
                      value={standardDraft.closingOdo}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          closingOdo: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Total passengers</span>
                    <input
                      type="text"
                      value={standardTripTotals.totalPassengers.toLocaleString()}
                      disabled
                      readOnly
                    />
                  </label>

                  <label className="finance-field">
                    <span>Total collected</span>
                    <input
                      type="text"
                      value={formatMoney(standardTripTotals.totalAmount)}
                      disabled
                      readOnly
                    />
                  </label>
                </div>

                <DailyTripLogbookFields
                  route={selectedStandardVehicleRoute}
                  tripLogbook={standardDraft.tripLogbook}
                  onChange={(nextTripLogbook) =>
                    setStandardDraft((current) =>
                      syncStandardDraftTripLogbook({
                        ...current,
                        tripLogbook: nextTripLogbook,
                      }),
                    )
                  }
                />

                <div className="finance-form-meta">
                  <span className="status-chip" data-tone={gapKm > 0 ? "warning" : "info"}>
                    Expected start {Number(selectedVehicleOpening).toLocaleString()} km
                  </span>
                  <span
                    className="status-chip"
                    data-tone={Number(standardDraft.closingOdo || 0) > Number(standardDraft.openingOdo || 0) ? "success" : "danger"}
                  >
                    Distance {Math.max(
                      Number(standardDraft.closingOdo || 0) - Number(standardDraft.openingOdo || 0),
                      0,
                    ).toLocaleString()} km
                  </span>
                </div>

                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={Boolean(standardValidationError) || !canEditFinanceUpdates}
                  >
                    {standardDraft.id ? "Update trip" : "Save trip"}
                  </button>
                  {standardDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() =>
                        setStandardDraft(
                          createStandardDraft(
                            defaultVehicleId,
                            finance.vehicleOpenings?.[defaultVehicleId],
                            defaultVehicleRoute,
                          ),
                        )
                      }
                    >
                      Cancel edit
                    </button>
                  )}
                </div>

                <p
                  className="finance-form-note"
                  data-tone={standardValidationError ? "danger" : "info"}
                >
                  {standardValidationError ??
                    (standardDraft.id
                      ? "Passenger trip logbook is complete and ready to update."
                      : "Passenger trip logbook is complete and ready to save.")}
                </p>
              </form>
            </article>

            <article ref={specialEntryRef} className="overview-board finance-entry-board">
              <div className="overview-board-head">
                <p className="eyebrow">Daily earnings log</p>
                <h3>Extra trip entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleSpecialSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Vehicle</span>
                    <select
                      value={specialDraft.vehicleId}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          vehicleId: event.target.value,
                        }))
                      }
                    >
                      {snapshot.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.registration}
                        </option>
                        ))}
                    </select>
                  </label>

                  <label className="finance-field">
                    <span>Date</span>
                    <input
                      type="date"
                      value={specialDraft.tripDate}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          tripDate: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Opening odo</span>
                    <input
                      type="number"
                      value={specialDraft.openingOdo}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          openingOdo: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Closing odo</span>
                    <input
                      type="number"
                      min={Number(specialDraft.openingOdo || 0) + 1}
                      value={specialDraft.closingOdo}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          closingOdo: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Total business km</span>
                    <input type="number" value={specialBusinessKm} disabled readOnly />
                  </label>

                  <label className="finance-field">
                    <span>From</span>
                    <input
                      type="text"
                      value={specialDraft.fromLocation}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          fromLocation: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>To</span>
                    <input
                      type="text"
                      value={specialDraft.toLocation}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          toLocation: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field finance-field-wide">
                    <span>Reason</span>
                    <input
                      type="text"
                      value={specialDraft.travelReason}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          travelReason: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Actual fuel & oil cost</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={specialDraft.fuelOilCost}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          fuelOilCost: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Actual repairs & maintenance cost</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={specialDraft.repairMaintenanceCost}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          repairMaintenanceCost: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={specialDraft.amount}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="finance-form-meta">
                  <span className="status-chip" data-tone="info">
                    SARS-style logbook
                  </span>
                  <span className="status-chip" data-tone={specialBusinessKm > 0 ? "success" : "danger"}>
                    Business km {specialBusinessKm.toLocaleString()} km
                  </span>
                </div>

                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={Boolean(specialValidationError) || !canEditFinanceUpdates}
                  >
                    {specialDraft.id ? "Update trip" : "Save trip"}
                  </button>
                  {specialDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => setSpecialDraft(createSpecialDraft(defaultVehicleId))}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
                <p
                  className="finance-form-note"
                  data-tone={specialValidationError ? "danger" : "info"}
                >
                  {specialValidationError ??
                    "Extra trip logbook details are complete and ready to save."}
                </p>
              </form>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Recent income</p>
                <h3>Waiting, handed in, checked, and deposited</h3>
              </div>

              <div className="finance-ledger">
                {incomeRecords.slice(0, 6).map((record) => (
                  <article key={record.id} className="ledger-row">
                    <div className="ledger-copy">
                      <strong>
                        {record.incomeKind === "special"
                          ? `${record.vehicle} / ${formatTripRoute(record)}`
                          : `${record.vehicle} / ${record.route}`}
                      </strong>
                      <span>
                        {record.incomeKind === "special"
                          ? formatTripLogMeta(record)
                          : formatDailyTripMeta(record)}
                      </span>
                      {getRecordLastEditNote(record) && (
                        <span>{getRecordLastEditNote(record)}</span>
                      )}
                    </div>
                    <div className="ledger-meta">
                      <span className="status-chip" data-tone={getTransactionTone(record)}>
                        {formatTransactionStatus(record.status)}
                      </span>
                      <strong>{formatMoney(record.amountClaimed ?? record.amount)}</strong>
                    </div>
                    <div className="record-actions">
                      <button
                        type="button"
                        className="record-button"
                        disabled={record.status === "banked" || !canEditFinanceUpdates}
                        onClick={() => handleEditIncome(record)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={record.status === "banked" || !canEditFinanceUpdates}
                        onClick={() => handleDelete(record.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="module-quick-links stack">
                <button className="cta-link" onClick={() => onNavigate("drivers")} type="button">
                  Drivers
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => onNavigate("fleet")} type="button">
                  Fleet
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => setFinanceView("banking")} type="button">
                  Banking
                  <ChevronRight size={16} />
                </button>
              </div>
            </article>
          </div>
        </div>
      )}

      {financeView === "expenses" && activeRole !== "Driver" && (
        <div className="content-stack">
          <div className="finance-sub-switch">
            <button
              type="button"
              className={
                expenseView === "vehicle" ? "finance-sub-pill active" : "finance-sub-pill"
              }
              onClick={() => handleExpenseViewChange("vehicle")}
            >
              Vehicle costs
            </button>
            <button
              type="button"
              className={
                expenseView === "operational" ? "finance-sub-pill active" : "finance-sub-pill"
              }
              onClick={() => handleExpenseViewChange("operational")}
            >
              Business costs
            </button>
          </div>

          <div className="analytics-grid finance-analytics">
            <InsightCard
              title={expenseView === "vehicle" ? "Vehicle costs" : "Business costs"}
              metric={formatMoney(sumBy(expenseItems, (item) => item.amount))}
              meta={
                expenseView === "vehicle"
                  ? "Effect on money left for each vehicle"
                  : "Effect on money left for the business"
              }
              icon={Briefcase}
              tone={expenseView === "vehicle" ? "warning" : "info"}
            >
              <MiniBars
                items={expenseItems.map((item) => ({
                  label: item.category,
                  value: item.amount,
                }))}
                tone={expenseView === "vehicle" ? "warning" : "info"}
              />
            </InsightCard>

            <InsightCard
              title="How expenses were paid"
              metric={`${filteredExpenseRecords.length}`}
              meta="Checked and waiting"
              icon={FileText}
              tone="navy"
            >
              <SegmentMeter
                segments={[
                  {
                    label: "Cash",
                    value: sumBy(
                      filteredExpenseRecords.filter((record) => record.cashExpense),
                      (record) => record.amount,
                    ),
                    tone: "warning",
                  },
                  {
                    label: "Non-cash",
                    value: sumBy(
                      filteredExpenseRecords.filter((record) => !record.cashExpense),
                      (record) => record.amount,
                    ),
                    tone: "info",
                  },
                ]}
              />
            </InsightCard>
          </div>

          <div className="finance-board-grid finance-board-grid-3">
            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Expense setup</p>
                <h3>{expenseView === "vehicle" ? "Vehicle cost" : "Business cost"} presets</h3>
              </div>

              <div className="compact-feed">
                {expensePresetItems.slice(0, 6).map((entry) => (
                  <CompactFeedItem
                    key={entry.id}
                    title={entry.name}
                    subtitle={
                      entry.descriptions.length > 0
                        ? entry.descriptions.slice(0, 2).join(" / ")
                        : "Category saved without preset descriptions"
                    }
                    tone="info"
                    meta={`${entry.descriptions.length} descriptions`}
                  />
                ))}
                {expensePresetItems.length === 0 && (
                  <CompactFeedItem
                    title="No saved setup yet"
                    subtitle="Add preset categories and descriptions for faster expense entry"
                    tone="warning"
                    meta="Expense setup"
                  />
                )}
              </div>

              <form className="finance-form" onSubmit={handleExpensePresetSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Category name</span>
                    <input
                      type="text"
                      placeholder="Subscription"
                      value={expensePresetDraft.category}
                      onChange={(event) =>
                        setExpensePresetDraft((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="finance-field finance-field-wide">
                    <span>Description option</span>
                    <input
                      type="text"
                      placeholder="Weekly subscription"
                      value={expensePresetDraft.description}
                      onChange={(event) =>
                        setExpensePresetDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={!canEditFinanceUpdates}
                  >
                    Save setup
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => setExpensePresetDraft(createExpensePresetDraft(expenseKind))}
                  >
                    Clear
                  </button>
                </div>

                <p className="finance-form-note" data-tone="info">
                  Save a category on its own or add a preset description to that category. The
                  entry form will then offer these as quick dropdown options.
                </p>
              </form>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Expense form</p>
                <h3>{expenseView === "vehicle" ? "Vehicle cost" : "Business cost"} entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleExpenseSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Category</span>
                    <select
                      value={expenseDraft.category}
                      onChange={(event) =>
                        setExpenseDraft((current) =>
                          syncExpenseDraftCategory(
                            current,
                            finance.expenseCatalog,
                            event.target.value,
                          ),
                        )
                      }
                    >
                      {expenseCategoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="finance-field finance-field-wide">
                    <span>Description</span>
                    {usesCustomExpenseDescription ? (
                      <input
                        type="text"
                        placeholder={
                          expenseDraft.category === EXPENSE_OTHER_CATEGORY
                            ? "Provide the expense details"
                            : "Add the expense details"
                        }
                        value={expenseDraft.description}
                        onChange={(event) =>
                          setExpenseDraft((current) => ({
                            ...current,
                            description: event.target.value,
                            descriptionPreset: EXPENSE_CUSTOM_DESCRIPTION_VALUE,
                          }))
                        }
                      />
                    ) : (
                      <select
                        value={expenseDraft.descriptionPreset}
                        onChange={(event) =>
                          setExpenseDraft((current) =>
                            syncExpenseDraftDescriptionPreset(
                              current,
                              event.target.value,
                            ),
                          )
                        }
                      >
                        {expenseDescriptionOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={EXPENSE_CUSTOM_DESCRIPTION_VALUE}>Other details</option>
                      </select>
                    )}
                  </label>

                  <label className="finance-field">
                    <span>Expense date</span>
                    <input
                      type="date"
                      value={expenseDraft.expenseDate}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          expenseDate: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Receipt no. / reference</span>
                    <input
                      type="text"
                      placeholder="REC-2048"
                      value={expenseDraft.reference}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          reference: event.target.value,
                        }))
                      }
                    />
                  </label>

                  {expenseView === "vehicle" && (
                    <label className="finance-field">
                      <span>Vehicle</span>
                      <select
                        value={expenseDraft.vehicleId}
                        onChange={(event) =>
                          setExpenseDraft((current) => ({
                            ...current,
                            vehicleId: event.target.value,
                          }))
                        }
                      >
                        {snapshot.vehicles.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.registration} / {vehicle.route}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="finance-field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={expenseDraft.amount}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field finance-field-check">
                    <span>Paid from safe</span>
                    <input
                      type="checkbox"
                      checked={expenseDraft.cashExpense}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          cashExpense: event.target.checked,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="finance-form-meta">
                  <span className="status-chip" data-tone={expenseView === "vehicle" ? "warning" : "info"}>
                    {expenseView === "vehicle"
                      ? "Reduces the money left for this vehicle"
                      : "Reduces the total money left for the business"}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={expenseDraft.category === EXPENSE_OTHER_CATEGORY ? "warning" : "info"}
                  >
                    {expenseDraft.category === EXPENSE_OTHER_CATEGORY
                      ? "Other selected: description details are required"
                      : `${expensePresetItems.length} preset categories available`}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={autoCheckFinanceEntries ? "success" : "warning"}
                  >
                    Status starts as {autoCheckFinanceEntries ? "checked" : "waiting"}
                  </span>
                </div>

                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={!canEditFinanceUpdates}
                  >
                    {expenseDraft.id ? "Update expense" : "Save expense"}
                  </button>
                  {expenseDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() =>
                        setExpenseDraft(
                          createExpenseDraft(
                            expenseView === "vehicle" ? "asset" : "operational",
                            defaultVehicleId,
                            finance.expenseCatalog,
                          ),
                        )
                      }
                    >
                      Cancel edit
                    </button>
                  )}
                </div>

                <p className="finance-form-note" data-tone="info">
                  Choose a saved category and description to capture expenses faster. Use Other when
                  the cost is outside the usual list, then type the full details under Description.
                </p>
              </form>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Recent expenses</p>
                <h3>{expenseView === "vehicle" ? "Recent vehicle costs" : "Recent business costs"}</h3>
              </div>

              <div className="finance-ledger">
                {filteredExpenseRecords.slice(0, 6).map((record) => (
                  <article key={record.id} className="ledger-row">
                    <div className="ledger-copy">
                      <strong>{formatExpenseHeadline(record)}</strong>
                      <span>{formatExpenseMeta(record)}</span>
                      {getRecordLastEditNote(record) && (
                        <span>{getRecordLastEditNote(record)}</span>
                      )}
                    </div>
                    <div className="ledger-meta">
                      <span className="status-chip" data-tone={getTransactionTone(record)}>
                        {formatTransactionStatus(record.status)}
                      </span>
                      <strong>{formatMoney(record.amount)}</strong>
                    </div>
                    <div className="record-actions">
                      <button
                        type="button"
                        className="record-button"
                        disabled={record.status === "banked" || !canEditFinanceUpdates}
                        onClick={() => handleEditExpense(record)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={record.status === "banked" || !canEditFinanceUpdates}
                        onClick={() => handleDelete(record.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Connected areas</p>
                <h3>Summary</h3>
              </div>

              <div className="compact-feed">
                <CompactFeedItem
                  title="Total vehicle costs"
                  subtitle="Costs linked to vehicles"
                  tone="warning"
                  meta={formatMoney(
                    sumBy(snapshot.vehicles, (vehicle) => vehicle.assetExpenseTotal ?? 0),
                  )}
                />
                <CompactFeedItem
                  title="Money left after costs"
                  subtitle="Income after checked costs"
                  tone="info"
                  meta={formatMoney(finance.globalFleetProfit)}
                />
              </div>

              <div className="module-quick-links stack">
                <button className="cta-link" onClick={() => onNavigate("fleet")} type="button">
                  Fleet assets
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => setFinanceView("banking")} type="button">
                  Banking
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => onNavigate("overview")} type="button">
                  Overview
                  <ChevronRight size={16} />
                </button>
              </div>
            </article>
          </div>
        </div>
      )}

      {financeView === "banking" && activeRole !== "Driver" && (
        <div className="content-stack">
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Cash workflow</p>
              <h3>Admin hand-in and manager verification</h3>
            </div>
            <p className="panel-note">
              Administrator records the driver day checking against the app total. Manager then
              verifies the checking before the money moves into the ready-for-bank total.
            </p>
            <div className="finance-form-actions">
              <button
                type="button"
                className="action-button primary"
                onClick={() => scrollToSection(verificationQueueRef)}
              >
                <CheckSquare size={16} />
                Open hand-in queue
              </button>
              <button
                type="button"
                className="action-button"
                onClick={() => scrollToSection(depositLockRef)}
              >
                <Lock size={16} />
                Open deposit summary
              </button>
              <span
                className="status-chip"
                data-tone={finance.shiftsAwaitingVerification > 0 ? "warning" : "success"}
              >
                {finance.handoversAwaitingAdmin} hand-in / {finance.checksAwaitingManager} manager
              </span>
            </div>
          </article>

          <div ref={depositLockRef} className="two-up">
            <Panel eyebrow="Bank deposit" title="Deposit summary" icon={Lock}>
              <div className="deposit-card">
                <div className="deposit-row">
                  <span>Manager-checked income</span>
                  <strong>{formatMoney(finance.bankingBatch.verifiedTakings)}</strong>
                </div>
                <div className="deposit-row">
                  <span>Cash expenses paid</span>
                  <strong>{formatMoney(finance.bankingBatch.cashExpenses)}</strong>
                </div>
                <div className="deposit-row total">
                  <span>Cash ready for bank</span>
                  <strong>{formatMoney(finance.bankingBatch.depositAmount)}</strong>
                </div>
                <div className="deposit-meta">
                  <span className="status-chip" data-tone="navy">
                    <Building2 size={14} />
                    <span>{finance.bankingBatch.reference}</span>
                  </span>
                  <span className="status-chip" data-tone="info">
                    <Calendar size={14} />
                    <span>{finance.bankingBatch.depositSlip.generatedAt}</span>
                  </span>
                </div>
                <p className="panel-note">
                  Cash ready for bank uses manager-checked day hand-ins plus standalone verified
                  income, less checked cash expenses. Finishing the deposit includes{" "}
                  {finance.bankingBatch.depositSlip.recordsLocked} records.
                </p>
                <div className="finance-form-actions">
                  <button
                    type="button"
                    className="action-button primary"
                    disabled={lockableCount === 0 || !canFinishDeposit}
                    onClick={() => pushFeedback(onLockDeposit())}
                  >
                    Finish deposit
                  </button>
                </div>
              </div>
            </Panel>

            <Panel eyebrow="Deposit steps" title="Deposit history" icon={ArrowDownToLine}>
              <div className="flow-strip">
                <FlowLane owner="Driver" title="Send checking" tone="teal" />
                <FlowLane owner="Admin" title="Record hand-in" tone="gold" />
                <FlowLane owner="Manager" title="Verify checking" tone="navy" />
              </div>
              <div className="finance-ledger">
                {depositHistory.map((deposit) => (
                  <article key={deposit.depositId} className="ledger-row">
                    <div className="ledger-copy">
                      <strong>{deposit.reference}</strong>
                      <span>{formatStamp(deposit.timestamp)}</span>
                    </div>
                    <div className="ledger-meta">
                      <span className="status-chip" data-tone="navy">
                        {deposit.recordsLocked} items
                      </span>
                      <strong>{formatMoney(deposit.depositAmount)}</strong>
                    </div>
                  </article>
                ))}
              </div>
              <div className="module-quick-links stack">
                <button className="cta-link" onClick={() => setFinanceView("revenue")} type="button">
                  Daily earnings log
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => setFinanceView("expenses")} type="button">
                  Expenses
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => onNavigate("overview")} type="button">
                  Overview
                  <ChevronRight size={16} />
                </button>
              </div>
            </Panel>
          </div>

          <div ref={verificationQueueRef}>
            <Panel eyebrow="Cash queue" title="Hand-in and verification queue" icon={CheckSquare}>
              <div className="queue-grid">
                {verificationRecords.map((record) => {
                const isDriverCashUp = record.queueType === "cash-up";
                const sourceRecord = isDriverCashUp
                  ? null
                  : incomeRecords.find((item) => item.id === record.id) ?? null;

                if (!isDriverCashUp && !sourceRecord) {
                  return null;
                }

                const queueEntry = record;
                const workflowStatus =
                  queueEntry.workflowStatus ??
                  normalizeCashUpWorkflowStatus(sourceRecord?.status) ??
                  "pending";
                const canRecordHandIn =
                  workflowStatus === "pending" && canRecordCashHandIn;
                const canVerifyCheck =
                  workflowStatus === "counted" && canVerifyFinanceChecks;
                const canEditCashInput =
                  canRecordHandIn || (activeRole === "Owner" && workflowStatus === "counted");
                const actionLabel = canRecordHandIn
                  ? "Record hand-in"
                  : canVerifyCheck
                    ? "Verify checking"
                    : workflowStatus === "pending"
                      ? "Waiting for admin hand-in"
                      : workflowStatus === "counted"
                        ? "Waiting for manager check"
                        : "Manager checked";
                const dayAnalytics = isDriverCashUp
                  ? queueEntry.dayAnalytics ?? null
                  : !sourceRecord.isSpecial
                    ? sourceRecord.dailyAnalytics ?? null
                    : null;
                const hasDayAnalytics = Boolean(dayAnalytics);
                const hasTripDurationAnalytics =
                  (dayAnalytics?.observedTripDurationCount ?? 0) > 0;
                const hasWaitingAnalytics = (dayAnalytics?.waitingIntervalCount ?? 0) > 0;
                const hasDayKmAnalytics = hasMetricValue(dayAnalytics?.dayKm);

                return (
                  <article key={record.id} className="queue-card">
                    <div className="queue-header">
                      <div>
                        <h3>
                          {isDriverCashUp
                            ? `${queueEntry.vehicle ?? "Vehicle"} / ${queueEntry.workDateLabel}`
                            : sourceRecord.incomeKind === "special"
                              ? `${sourceRecord.vehicle} / ${formatTripRoute(sourceRecord)}`
                              : `${sourceRecord.vehicle} / ${sourceRecord.route}`}
                        </h3>
                        <p>
                          {isDriverCashUp
                            ? `${queueEntry.driver} / ${queueEntry.route ?? "Day checking"} / ${
                                queueEntry.entryCount
                              } entries`
                            : `${queueEntry.driver} / ${
                                sourceRecord.incomeKind === "special"
                                  ? formatTripLogMeta(sourceRecord)
                                  : formatDailyTripMeta(sourceRecord)
                              }`}
                        </p>
                      </div>
                      <span className="status-chip" data-tone={getQueueTone(queueEntry)}>
                        {queueEntry.status}
                      </span>
                    </div>

                    <div className="queue-stats">
                      <InfoPair
                        label={isDriverCashUp ? "Expected cash in" : "Reported"}
                        value={formatMoney(queueEntry.claimed)}
                      />
                      <InfoPair label="Counted" value={formatMoney(queueEntry.counted)} />
                      <InfoPair label="Difference" value={formatMoney(queueEntry.shortage)} />
                      {isDriverCashUp ? (
                        <>
                          <InfoPair
                            label="Income"
                            value={formatMoney(queueEntry.totalIncome ?? 0)}
                          />
                          <InfoPair
                            label="Cash expenses"
                            value={formatMoney(queueEntry.cashExpenses ?? 0)}
                          />
                          <InfoPair
                            label="Day entries"
                            value={`${Number(queueEntry.entryCount ?? 0).toLocaleString()}`}
                          />
                        </>
                      ) : !sourceRecord.isSpecial ? (
                        <>
                          <InfoPair
                            label="Passengers"
                            value={`${getDailyTripPassengerTotal(sourceRecord).toLocaleString()}`}
                          />
                          <InfoPair
                            label="Trips logged"
                            value={`${getDailyTripTripCount(sourceRecord)}`}
                          />
                        </>
                      ) : (
                        <InfoPair
                          label="Business km"
                          value={`${Number(
                            sourceRecord.businessKm ?? getBusinessKmValue(sourceRecord),
                          ).toLocaleString()} km`}
                        />
                      )}
                      <InfoPair label="Distance gap" value={`${queueEntry.gapKm} km`} />
                    </div>

                    {(isDriverCashUp || !sourceRecord.isSpecial) && (
                      <div className="content-stack">
                        <div className="overview-board-head">
                          <p className="eyebrow">Analytics</p>
                          <h3>Analytics Summary</h3>
                        </div>
                        <div className="queue-stats">
                          <InfoPair
                            label="Total trips"
                            value={
                              hasDayAnalytics
                                ? formatOptionalMetric(dayAnalytics.totalTrips, {
                                    maximumFractionDigits: 0,
                                  })
                                : "—"
                            }
                          />
                          <InfoPair
                            label="Total passengers"
                            value={
                              hasDayAnalytics
                                ? formatOptionalMetric(dayAnalytics.totalPassengers, {
                                    maximumFractionDigits: 0,
                                  })
                                : "—"
                            }
                          />
                          <InfoPair
                            label="Avg trip duration"
                            value={
                              hasTripDurationAnalytics
                                ? formatOptionalMetric(dayAnalytics.avgTripDurationMin, {
                                    suffix: " min",
                                  })
                                : "—"
                            }
                          />
                          <InfoPair
                            label="Avg waiting"
                            value={
                              hasWaitingAnalytics
                                ? formatOptionalMetric(dayAnalytics.avgWaitingMin, {
                                    suffix: " min",
                                  })
                                : "—"
                            }
                          />
                          <InfoPair
                            label="Avg takings / trip"
                            value={
                              hasDayAnalytics && (dayAnalytics.totalTrips ?? 0) > 0
                                ? formatOptionalMoney(dayAnalytics.avgTakingsPerTrip)
                                : "—"
                            }
                          />
                          <InfoPair
                            label="Avg passengers / trip"
                            value={
                              hasDayAnalytics && (dayAnalytics.totalTrips ?? 0) > 0
                                ? formatOptionalMetric(dayAnalytics.avgPassengersPerTrip)
                                : "—"
                            }
                          />
                          <InfoPair
                            label="KM / day"
                            value={
                              hasDayKmAnalytics
                                ? formatOptionalMetric(dayAnalytics.dayKm, {
                                    suffix: " km",
                                  })
                                : "—"
                            }
                          />
                        </div>
                      </div>
                    )}

                    <div className="verification-actions">
                      <input
                        className="verification-input"
                        type="number"
                        min="0"
                        step="1"
                        value={
                          verificationInputs[record.id] ??
                          queueEntry.actualCashReceived ??
                          sourceRecord?.actualCashReceived ??
                          ""
                        }
                        disabled={!canEditCashInput}
                        onChange={(event) =>
                          setVerificationInputs((current) => ({
                            ...current,
                            [record.id]: event.target.value,
                          }))
                        }
                        placeholder="Cash handed in"
                      />
                      <button
                        type="button"
                        className="action-button primary"
                        disabled={!(canRecordHandIn || canVerifyCheck)}
                        onClick={() => handleVerify(record.id)}
                      >
                        {actionLabel}
                      </button>
                      <button
                        type="button"
                        className="record-button"
                        disabled={
                          isDriverCashUp || sourceRecord.status === "banked" || !canEditFinanceUpdates
                        }
                        onClick={() => !isDriverCashUp && handleEditIncome(sourceRecord)}
                      >
                        Edit entry
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={
                          isDriverCashUp || sourceRecord.status === "banked" || !canEditFinanceUpdates
                        }
                        onClick={() => !isDriverCashUp && handleDelete(sourceRecord.id)}
                      >
                        Delete entry
                      </button>
                    </div>
                    {isDriverCashUp && (
                      <p className="finance-form-note" data-tone="info">
                        This hand-in covers the whole driver day. Update the trip or expense in the
                        ledgers if the day total needs to change.
                      </p>
                    )}
                  </article>
                );
              })}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function FleetPanel({
  snapshot,
  activeRole,
  currentUserRecord,
  permissionControls,
  onSaveVehicle,
  onSaveRoute,
  onArchiveVehicle,
  onLogDefect,
  onResolveDefect,
  onSelectDriverVehicle,
}) {
  const isDriver = activeRole === "Driver";
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const availableVehicles = isDriver ? linkedVehicles : snapshot.vehicles;
  const canViewVehicleProfile = !isDriver;
  const canEditFleetUpdates = canEditModuleUpdates(
    activeRole,
    "fleet",
    permissionControls,
    currentUserRecord,
  );
  const canManageVehicles =
    activeRole === "Owner" ||
    (PRIVILEGED_ROLES.has(activeRole) && canEditFleetUpdates);
  const fleetAccessStatus = getModuleAccessStatus(permissionControls.fleet);
  const canArchiveVehicles = PRIVILEGED_ROLES.has(activeRole) && canEditFleetUpdates;
  const canResolveDefects = PRIVILEGED_ROLES.has(activeRole) && canEditFleetUpdates;
  const vehicleRouteOptions = useMemo(
    () => snapshot.routes ?? [],
    [snapshot.routes],
  );
  const assignedVehicleId = isDriver
    ? snapshot.driverTerminal.assignedVehicleId ?? linkedVehicles[0]?.id ?? null
    : snapshot.driverTerminal.assignedVehicleId ?? snapshot.vehicles[0]?.id ?? null;
  const [activeFilter, setActiveFilter] = useState(isDriver ? "assigned" : "attention");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [selectedVehicleId, setSelectedVehicleId] = useState(assignedVehicleId);
  const [feedback, setFeedback] = useState(null);
  const [vehicleDraft, setVehicleDraft] = useState(() =>
    createVehicleDraft(snapshot.vehicles[0], snapshot.profile.serviceIntervalKm),
  );
  const [routeDraft, setRouteDraft] = useState(() => createRouteDraft());
  const [defectDraft, setDefectDraft] = useState(() => createDefectDraft(assignedVehicleId));
  const [resolutionCosts, setResolutionCosts] = useState({});
  const vehicleFormRef = useRef(null);
  const routeFormRef = useRef(null);
  const vehicleProfileRef = useRef(null);
  const defectFormRef = useRef(null);
  const openDefectsRef = useRef(null);

  const fleetHealth = useMemo(() => {
    const activeVehicles = snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived");

    return {
      total: activeVehicles.length,
      healthy: activeVehicles.filter((vehicle) => vehicle.healthState === "success").length,
      warning: activeVehicles.filter((vehicle) => vehicle.healthState === "warning").length,
      critical: activeVehicles.filter((vehicle) => vehicle.healthState === "danger").length,
      archived: snapshot.vehicles.filter((vehicle) => vehicle.status === "archived").length,
    };
  }, [snapshot.vehicles]);
  const readinessCounts = useMemo(() => {
    const activeVehicles = snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived");

    return {
      routeService: activeVehicles.filter((vehicle) => vehicle.canDoRouteService).length,
      specialTrips: activeVehicles.filter((vehicle) => vehicle.canDoSpecialTrips).length,
      contracts: activeVehicles.filter((vehicle) => vehicle.canDoContracts).length,
    };
  }, [snapshot.vehicles]);

  const filteredVehicles = useMemo(() => {
    let nextVehicles;

    if (isDriver) {
      nextVehicles = linkedVehicles;
    } else if (activeFilter === "attention") {
      nextVehicles = snapshot.vehicles.filter(
        (vehicle) =>
          vehicle.status !== "archived" &&
          (vehicle.healthState === "warning" || vehicle.healthState === "danger"),
      );
    } else if (activeFilter === "critical") {
      nextVehicles = snapshot.vehicles.filter(
        (vehicle) => vehicle.status !== "archived" && vehicle.healthState === "danger",
      );
    } else if (activeFilter === "healthy") {
      nextVehicles = snapshot.vehicles.filter(
        (vehicle) => vehicle.status !== "archived" && vehicle.healthState === "success",
      );
    } else if (activeFilter === "archived") {
      nextVehicles = snapshot.vehicles.filter((vehicle) => vehicle.status === "archived");
    } else {
      nextVehicles = snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived");
    }

    return nextVehicles.filter((vehicle) => matchesVehicleReadiness(vehicle, readinessFilter));
  }, [activeFilter, isDriver, linkedVehicles, readinessFilter, snapshot.vehicles]);

  useEffect(() => {
    if (!availableVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(availableVehicles[0]?.id ?? null);
    }
  }, [availableVehicles, selectedVehicleId]);

  useEffect(() => {
    if (isDriver || filteredVehicles.length === 0) {
      return;
    }

    if (!filteredVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(filteredVehicles[0].id);
    }
  }, [filteredVehicles, isDriver, selectedVehicleId]);

  const selectedVehicle =
    availableVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ??
    filteredVehicles[0] ??
    availableVehicles[0] ??
    null;
  const vehicleLedger = useMemo(
    () =>
      snapshot.financeTransactions
        .filter((record) => record.vehicleId === selectedVehicle?.id)
        .slice(0, 8),
    [selectedVehicle?.id, snapshot.financeTransactions],
  );
  const vehicleDocuments = useMemo(
    () => snapshot.documents.filter((document) => document.subjectId === selectedVehicle?.id),
    [selectedVehicle?.id, snapshot.documents],
  );
  const vehicleDefects = useMemo(
    () => snapshot.defects.filter((defect) => defect.vehicleId === selectedVehicle?.id),
    [selectedVehicle?.id, snapshot.defects],
  );
  const vehicleIncomeRecords = useMemo(
    () => vehicleLedger.filter((record) => record.type === "income"),
    [vehicleLedger],
  );
  const revenueOutline = useMemo(
    () => ({
      totalRevenue: sumBy(vehicleIncomeRecords, getIncomeCashValue),
      standardRevenue: sumBy(
        vehicleIncomeRecords.filter((record) => record.incomeKind === "standard"),
        getIncomeCashValue,
      ),
      specialRevenue: sumBy(
        vehicleIncomeRecords.filter((record) => record.isSpecial),
        (record) => record.amount,
      ),
      shiftCount: vehicleIncomeRecords.filter((record) => record.incomeKind === "standard").length,
      specialTripCount: vehicleIncomeRecords.filter((record) => record.isSpecial).length,
    }),
    [vehicleIncomeRecords],
  );
  const routeHistory = useMemo(
    () =>
      Object.values(
        vehicleIncomeRecords.reduce((groups, record) => {
          const key = record.isSpecial
            ? `${formatTripRoute(record)} / ${record.travelReason ?? "Special trip"}`
            : record.route ?? selectedVehicle?.route ?? "Route";
          const current = groups[key] ?? {
            title: record.isSpecial ? formatTripRoute(record) : key,
            subtitle: record.isSpecial ? record.travelReason ?? "Special trip" : "Standard route",
            trips: 0,
            revenue: 0,
            latestTimestamp: record.timestamp,
          };

          groups[key] = {
            ...current,
            trips: current.trips + 1,
            revenue: current.revenue + Number(record.amountClaimed ?? record.amount ?? 0),
            latestTimestamp:
              new Date(record.timestamp) > new Date(current.latestTimestamp)
                ? record.timestamp
                : current.latestTimestamp,
          };

          return groups;
        }, {}),
      )
        .sort((left, right) => new Date(right.latestTimestamp) - new Date(left.latestTimestamp))
        .slice(0, 4),
    [selectedVehicle?.route, vehicleIncomeRecords],
  );
  const driverHistory = useMemo(() => {
    const entries = [];
    const seen = new Set();
    const pushEntry = (name, meta, tone = "info") => {
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      entries.push({ name, meta, tone });
    };

    pushEntry(
      selectedVehicle?.assignedDriver && selectedVehicle.assignedDriver !== "Unassigned"
        ? selectedVehicle.assignedDriver
        : null,
      "Linked now",
      "success",
    );

    vehicleIncomeRecords
      .filter((record) => record.createdByRole === "Driver")
      .forEach((record) => {
        const driverName =
          snapshot.drivers.find((driver) => driver.staffId === record.createdBy)?.name ?? null;
        pushEntry(
          driverName,
          `Income entry / ${
            record.isSpecial ? formatTripLogMeta(record) : formatDailyTripMeta(record)
          }`,
          "info",
        );
      });

    vehicleDefects.forEach((defect) => {
      pushEntry(defect.reportedByName, `Problem report / ${defect.reportedAtLabel}`, "warning");
    });

    return entries.slice(0, 4);
  }, [selectedVehicle?.assignedDriver, snapshot.drivers, vehicleDefects, vehicleIncomeRecords]);
  const healthHighlights = useMemo(
    () => [
      {
        title: "Fleet health",
        subtitle: selectedVehicle?.healthLabel ?? "Healthy",
        tone: getVehicleTone(selectedVehicle ?? {}) === "neutral" ? "info" : getVehicleTone(selectedVehicle ?? {}),
        meta: `${selectedVehicle?.defectsOpen ?? 0} open defects`,
      },
      {
        title: "Service due in",
        subtitle: `${selectedVehicle?.serviceDueKm?.toLocaleString() ?? 0} km remaining`,
        tone: selectedVehicle?.serviceTone ?? "info",
        meta: `Last service ${selectedVehicle?.lastServiceOdo?.toLocaleString() ?? 0} km`,
      },
      {
        title: "Document time left",
        subtitle: `${selectedVehicle?.minimumDocumentDays ?? 0} days minimum`,
        tone: getDocumentTone(selectedVehicle?.minimumDocumentDays ?? 365),
        meta: `Permit ${selectedVehicle?.permitDays ?? 0} / Disc ${selectedVehicle?.discDays ?? 0}`,
      },
    ],
    [selectedVehicle],
  );
  const currentRouteRecord = useMemo(
    () =>
      (snapshot.routes ?? []).find(
        (route) =>
          route.id === selectedVehicle?.currentRouteId ||
          route.name === selectedVehicle?.route,
      ) ?? null,
    [selectedVehicle?.currentRouteId, selectedVehicle?.route, snapshot.routes],
  );
  const passengerContribution = useMemo(() => {
    const standardRouteRecords = vehicleIncomeRecords.filter(
      (record) => record.incomeKind === "standard",
    );
    const totalTrips = sumBy(standardRouteRecords, getDailyTripTripCount);
    const totalPassengers = sumBy(standardRouteRecords, getDailyTripPassengerTotal);

    return {
      capturedDays: standardRouteRecords.length,
      totalTrips,
      totalPassengers,
      lastCapturedAt: standardRouteRecords[0]?.timestamp ?? null,
    };
  }, [vehicleIncomeRecords]);
  const routeMovementPoints = useMemo(
    () => currentRouteRecord?.routePoints ?? [],
    [currentRouteRecord],
  );
  const lastKnownDriver = useMemo(() => {
    if (selectedVehicle?.assignedDriver && selectedVehicle.assignedDriver !== "Unassigned") {
      return selectedVehicle.assignedDriver;
    }

    const incomeDriver = vehicleIncomeRecords
      .map(
        (record) =>
          snapshot.drivers.find((driver) => driver.staffId === record.createdBy)?.name ?? null,
      )
      .find(Boolean);

    return (
      incomeDriver ??
      vehicleDefects.find((defect) => defect.reportedByName)?.reportedByName ??
      "No driver history yet"
    );
  }, [selectedVehicle?.assignedDriver, snapshot.drivers, vehicleDefects, vehicleIncomeRecords]);
  const latestFinanceActivity = vehicleLedger[0] ?? null;
  const operatedRoutes = useMemo(
    () =>
      Object.values(
        vehicleIncomeRecords.reduce((groups, record) => {
          const key = record.isSpecial
            ? formatTripRoute(record)
            : record.route ?? selectedVehicle?.route ?? "Route";
          const current = groups[key] ?? {
            title: key,
            subtitle: record.isSpecial ? record.travelReason ?? "Special trip" : "Standard route",
            trips: 0,
            revenue: 0,
            latestTimestamp: record.timestamp,
          };

          groups[key] = {
            ...current,
            trips: current.trips + 1,
            revenue: current.revenue + Number(record.amountClaimed ?? record.amount ?? 0),
            latestTimestamp:
              new Date(record.timestamp) > new Date(current.latestTimestamp)
                ? record.timestamp
                : current.latestTimestamp,
          };

          return groups;
        }, {}),
      )
        .sort((left, right) => new Date(right.latestTimestamp) - new Date(left.latestTimestamp))
        .map((route) => ({
          title: route.title,
          subtitle: route.subtitle,
          meta: `${route.trips} trips / ${formatMoney(route.revenue)}`,
        })),
    [selectedVehicle?.route, vehicleIncomeRecords],
  );
  const serviceHistory = useMemo(
    () =>
      vehicleDefects
        .filter((defect) => defect.status === "resolved")
        .sort(
          (left, right) =>
            (Date.parse(right.resolvedAt ?? right.updatedAt ?? right.reportedAt ?? "") || 0) -
            (Date.parse(left.resolvedAt ?? left.updatedAt ?? left.reportedAt ?? "") || 0),
        )
        .slice(0, 4),
    [vehicleDefects],
  );
  const suitabilityHighlights = useMemo(
    () => [
      selectedVehicle?.canDoRouteService ? "Route service ready" : "Route service off",
      selectedVehicle?.canDoSpecialTrips ? "Special trips ready" : "Special trips not set",
      selectedVehicle?.canDoContracts ? "Contracts ready" : "Contracts not set",
    ],
    [
      selectedVehicle?.canDoContracts,
      selectedVehicle?.canDoRouteService,
      selectedVehicle?.canDoSpecialTrips,
    ],
  );

  useEffect(() => {
    if (selectedVehicle && canManageVehicles) {
      setVehicleDraft(createVehicleDraft(selectedVehicle, snapshot.profile.serviceIntervalKm));
    }
  }, [canManageVehicles, selectedVehicle, snapshot.profile.serviceIntervalKm]);

  useEffect(() => {
    const targetVehicleId = isDriver ? selectedVehicle?.id ?? assignedVehicleId : selectedVehicle?.id;
    if (targetVehicleId) {
      setDefectDraft((current) => ({
        ...current,
        vehicleId: current.id ? current.vehicleId : targetVehicleId,
      }));
    }
  }, [assignedVehicleId, isDriver, selectedVehicle?.id]);

  const fleetListMessage = (() => {
    if (isDriver) {
      return "No vehicles are currently linked to your driver profile.";
    }
    if (activeFilter === "attention") {
      return "No vehicles currently need attention. Switch filters or add a vehicle.";
    }
    if (activeFilter === "critical") {
      return "No vehicles are currently in the critical list.";
    }
    if (activeFilter === "healthy") {
      return "No vehicles are currently marked healthy in this workspace.";
    }
    if (activeFilter === "archived") {
      return "No archived vehicles are available yet.";
    }
    if (readinessFilter === "route-service") {
      return "No vehicles in this view are marked ready for route service.";
    }
    if (readinessFilter === "special-trips") {
      return "No vehicles in this view are marked ready for special trips.";
    }
    if (readinessFilter === "contracts") {
      return "No vehicles in this view are marked ready for contracts.";
    }
    return "No active vehicles are available in this view.";
  })();

  const pushFeedback = (response) => {
    if (!response) {
      return;
    }

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  const handleVehicleSubmit = (event) => {
    event.preventDefault();
    const isNewVehicle = !vehicleDraft.id;
    const response = onSaveVehicle(vehicleDraft);
    pushFeedback(response);
    if (response.ok) {
      if (isNewVehicle && !isDriver) {
        setActiveFilter("all");
      }
      setSelectedVehicleId(response.vehicleId);
    }
  };

  const buildBlankVehicleDraft = () => {
    const baseDraft = createVehicleDraft(null, snapshot.profile.serviceIntervalKm);
    const defaultRoute = vehicleRouteOptions[0] ?? null;

    return defaultRoute
      ? {
          ...baseDraft,
          route: defaultRoute.name,
          currentRouteId: defaultRoute.id,
        }
      : baseDraft;
  };

  const handleNewVehicle = () => {
    setVehicleDraft(buildBlankVehicleDraft());
  };

  const handleAddVehicle = () => {
    handleNewVehicle();
    vehicleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleAddRoute = () => {
    setRouteDraft(createRouteDraft());
    routeFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleRouteSubmit = (event) => {
    event.preventDefault();
    const response = onSaveRoute(routeDraft);
    pushFeedback(response);
    if (response?.ok) {
      setRouteDraft(createRouteDraft());
    }
  };

  const handleViewProfile = (vehicleId) => {
    setSelectedVehicleId(vehicleId);
    if (isDriver) {
      onSelectDriverVehicle(vehicleId);
    }
    vehicleProfileRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDefectSubmit = (event) => {
    event.preventDefault();
    const response = onLogDefect({
      ...defectDraft,
      vehicleId: isDriver ? selectedVehicle?.id ?? assignedVehicleId : defectDraft.vehicleId,
    });
    pushFeedback(response);
    if (response.ok) {
      setDefectDraft(
        createDefectDraft(isDriver ? selectedVehicle?.id ?? assignedVehicleId : selectedVehicle?.id),
      );
    }
  };

  const handleEditDefect = (defect) => {
    setDefectDraft({
      id: defect.id,
      vehicleId:
        defect.vehicleId ??
        (isDriver ? selectedVehicle?.id ?? assignedVehicleId : selectedVehicle?.id ?? ""),
      category: defect.category ?? DEFECT_CATEGORIES[0],
      detail: defect.detail ?? defect.issue ?? "",
    });
    defectFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleResolve = (defectId) => {
    pushFeedback(onResolveDefect(defectId, resolutionCosts[defectId]));
    setResolutionCosts((current) => {
      const next = { ...current };
      delete next[defectId];
      return next;
    });
  };

  return (
    <div className="content-stack">
      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      {PRIVILEGED_ROLES.has(activeRole) && !canEditFleetUpdates && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Management access</p>
            <h3>Fleet & Operations edits are locked</h3>
          </div>
          <p className="panel-note">
            The owner can enable Fleet & Operations rights in Settings. Until then this management
            account cannot update saved vehicle profiles, edit reported problems, archive vehicles,
            or mark repairs as fixed.
          </p>
          <div className="finance-form-meta">
            <span className="status-chip" data-tone={fleetAccessStatus.tone}>
              {fleetAccessStatus.label}
            </span>
          </div>
        </article>
      )}

      <Panel eyebrow="Fleet & Operations summary" title="Fleet & Operations overview" icon={Car}>
        <div className="fleet-counter-grid">
          <article className="overview-board fleet-health-card" data-tone="success">
            <p className="eyebrow">Fleet health</p>
            <h3>{fleetHealth.healthy} healthy</h3>
            <p>{fleetHealth.total} active vehicles in service.</p>
          </article>
          <article className="overview-board fleet-health-card" data-tone="warning">
            <p className="eyebrow">Warning</p>
            <h3>{fleetHealth.warning} orange</h3>
            <p>Vehicles with defects or less than 1,000 km before service.</p>
          </article>
          <article className="overview-board fleet-health-card" data-tone="danger">
            <p className="eyebrow">Critical</p>
            <h3>{fleetHealth.critical} red</h3>
            <p>Vehicles with overdue service or documents that need urgent attention.</p>
          </article>
        </div>

        {!isDriver && (
          <>
            <div className="finance-sub-switch fleet-toolbar">
              {canManageVehicles && (
                <>
                  <button
                    type="button"
                    className="finance-sub-pill finance-sub-pill-action"
                    disabled={!canEditFleetUpdates}
                    onClick={handleAddVehicle}
                  >
                    <Car size={14} />
                    Add vehicle
                  </button>
                  <button
                    type="button"
                    className="finance-sub-pill finance-sub-pill-action"
                    disabled={!canEditFleetUpdates}
                    onClick={handleAddRoute}
                  >
                    <FileText size={14} />
                    Add route
                  </button>
                </>
              )}
              {[
                ["attention", "Attention"],
                ["critical", "Critical"],
                ["healthy", "Healthy"],
                ["all", "All"],
                ["archived", `Archived ${fleetHealth.archived}`],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={activeFilter === value ? "finance-sub-pill active" : "finance-sub-pill"}
                  onClick={() => setActiveFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="finance-sub-switch">
              {getVehicleReadinessOptions(readinessCounts).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    readinessFilter === value ? "finance-sub-pill active" : "finance-sub-pill"
                  }
                  onClick={() => setReadinessFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {isDriver && linkedVehicles.length > 1 && (
          <div className="finance-sub-switch">
            {linkedVehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                className={
                  vehicle.id === selectedVehicle?.id ? "finance-sub-pill active" : "finance-sub-pill"
                }
                onClick={() => {
                  setSelectedVehicleId(vehicle.id);
                  onSelectDriverVehicle(vehicle.id);
                }}
              >
                {vehicle.registration}
              </button>
            ))}
          </div>
        )}

        <div className="fleet-management-grid">
          {filteredVehicles.length === 0 && (
            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">{isDriver ? "Linked vehicles" : "Fleet & Operations view"}</p>
                <h3>No vehicles in this view</h3>
              </div>
              <p className="panel-note">{fleetListMessage}</p>
            </article>
          )}

          {filteredVehicles.map((vehicle) => (
            <article
              key={vehicle.id}
              className={
                vehicle.id === selectedVehicle?.id
                  ? "vehicle-summary-card active"
                  : "vehicle-summary-card"
              }
            >
              <button
                type="button"
                className="vehicle-summary-trigger"
                onClick={() => {
                  setSelectedVehicleId(vehicle.id);
                  if (isDriver) {
                    onSelectDriverVehicle(vehicle.id);
                  }
                }}
              >
                <div className="vehicle-summary-top">
                  <div>
                    <strong>{vehicle.registration}</strong>
                    <span>
                      {vehicle.model} / {vehicle.route}
                    </span>
                  </div>
                  <span className="status-chip" data-tone={getVehicleTone(vehicle)}>
                    {vehicle.healthLabel}
                  </span>
                </div>
                <div className="queue-stats compact">
                  <InfoPair label="Driver" value={vehicle.assignedDriver} />
                  <InfoPair label="Defects" value={`${vehicle.defectsOpen}`} />
                  <InfoPair label="Service" value={`${vehicle.serviceDueKm.toLocaleString()} km`} />
                  <InfoPair label="Documents" value={`${vehicle.minimumDocumentDays} days`} />
                </div>
                <div className="finance-form-meta">
                  <span
                    className="status-chip"
                    data-tone={vehicle.canDoRouteService ? "success" : "neutral"}
                  >
                    {vehicle.canDoRouteService ? "Route service" : "Route service off"}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={vehicle.canDoSpecialTrips ? "info" : "neutral"}
                  >
                    {vehicle.canDoSpecialTrips ? "Special trips" : "Special trips off"}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={vehicle.canDoContracts ? "info" : "neutral"}
                  >
                    {vehicle.canDoContracts ? "Contracts" : "Contracts off"}
                  </span>
                </div>
              </button>

              {canViewVehicleProfile && (
                <div className="vehicle-summary-actions">
                  <button
                    type="button"
                    className="action-button primary"
                    onClick={() => handleViewProfile(vehicle.id)}
                  >
                    <FileText size={16} />
                    View profile
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </Panel>

      {(canManageVehicles || selectedVehicle) && (
        <>
          <div ref={vehicleProfileRef} className="two-up">
            <Panel
              eyebrow="Vehicle profile"
              title={
                selectedVehicle
                  ? `${selectedVehicle.registration} / ${selectedVehicle.route}`
                  : "Fleet & Operations onboarding"
              }
              icon={Activity}
            >
              {selectedVehicle ? (
                <>
                  <div className="queue-stats">
                    <InfoPair label="Assigned driver" value={selectedVehicle.assignedDriver} />
                    <InfoPair
                      label="Driver staffId"
                      value={selectedVehicle.assignedDriverId ?? "Unassigned"}
                    />
                    <InfoPair
                      label="Current odometer"
                      value={`${selectedVehicle.currentOdometer.toLocaleString()} km`}
                    />
                    <InfoPair
                      label="KM left"
                      value={`${selectedVehicle.serviceDueKm.toLocaleString()} km`}
                    />
                    <InfoPair label="Open defects" value={`${selectedVehicle.defectsOpen}`} />
                    <InfoPair label="Status" value={selectedVehicle.healthLabel} />
                    {!isDriver && (
                      <>
                        <InfoPair
                          label="Vehicle income"
                          value={formatMoney(selectedVehicle.verifiedRevenue ?? 0)}
                        />
                        <InfoPair
                          label="Vehicle costs"
                          value={formatMoney(selectedVehicle.assetExpenseTotal ?? 0)}
                        />
                        <InfoPair
                          label="Money left after costs"
                          value={formatMoney(selectedVehicle.netYield ?? 0)}
                        />
                      </>
                    )}
                  </div>

                  {!isDriver && (
                    <div className="finance-ledger">
                      {vehicleLedger.map((record) => (
                        <article key={record.id} className="ledger-row">
                          <div className="ledger-copy">
                            <strong>
                              {record.type === "income"
                                ? record.isSpecial
                                  ? `Income / ${formatTripRoute(record)}`
                                  : `Income / ${record.route}`
                                : formatExpenseHeadline(record)}
                            </strong>
                            <span>
                              {record.type === "expense"
                                ? formatExpenseMeta(record)
                                : record.isSpecial
                                  ? formatTripLogMeta(record)
                                  : formatDailyTripMeta(record)}
                            </span>
                          </div>
                          <div className="ledger-meta">
                            <span className="status-chip" data-tone={getTransactionTone(record)}>
                              {formatTransactionStatus(record.status)}
                            </span>
                            <strong>
                              {record.type === "income" ? "+" : "-"}
                              {formatMoney(record.amountClaimed ?? record.amount)}
                            </strong>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <article className="overview-board">
                  <div className="overview-board-head">
                    <p className="eyebrow">Fleet & Operations setup</p>
                    <h3>Create the first vehicle</h3>
                  </div>
                  <p className="panel-note">
                    Add a vehicle to activate route assignments, service monitoring, compliance
                    tracking, and defect reporting.
                  </p>
                </article>
              )}
            </Panel>

            <Panel
              eyebrow="Service and documents"
              title={selectedVehicle ? "Service and document reminders" : "Create first vehicle"}
              icon={ShieldAlert}
            >
              {selectedVehicle ? (
                <div className="compact-feed">
                  <CompactFeedItem
                    title="Next service"
                    subtitle={`Last service ${selectedVehicle.lastServiceOdo.toLocaleString()} km`}
                    tone={selectedVehicle.serviceTone}
                    meta={`${selectedVehicle.serviceDueKm.toLocaleString()} km remaining`}
                  />
                  {vehicleDocuments.map((document) => (
                    <CompactFeedItem
                      key={document.id}
                      title={document.document}
                      subtitle={document.stage}
                      tone={getDocumentTone(document.daysLeft)}
                      meta={`${document.daysLeft} days`}
                    />
                  ))}
                </div>
              ) : (
                <p className="panel-note">
                  This panel starts tracking service dates and expiry dates as soon as the first
                  vehicle is saved.
                </p>
              )}

              {canManageVehicles && (
                <form ref={vehicleFormRef} className="finance-form" onSubmit={handleVehicleSubmit}>
                  <div className="finance-form-grid">
                    <label className="finance-field">
                      <span>Registration</span>
                      <input
                        type="text"
                        value={vehicleDraft.registration}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            registration: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Model</span>
                      <input
                        type="text"
                        value={vehicleDraft.model}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Route</span>
                      {vehicleRouteOptions.length > 0 ? (
                        <select
                          value={vehicleDraft.currentRouteId ?? ""}
                          onChange={(event) =>
                            setVehicleDraft((current) => {
                              const nextRoute =
                                vehicleRouteOptions.find(
                                  (route) => route.id === event.target.value,
                                ) ?? null;

                              return {
                                ...current,
                                currentRouteId: event.target.value || null,
                                route: nextRoute?.name ?? "",
                              };
                            })
                          }
                        >
                          <option value="">Select a route</option>
                          {vehicleRouteOptions.map((route) => (
                            <option key={route.id} value={route.id}>
                              {route.code ? `${route.code} / ` : ""}
                              {route.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={vehicleDraft.route}
                          onChange={(event) =>
                            setVehicleDraft((current) => ({
                              ...current,
                              route: event.target.value,
                              currentRouteId: buildRouteReferenceId(event.target.value),
                            }))
                          }
                        />
                      )}
                    </label>
                    <label className="finance-field">
                      <span>Assigned driver</span>
                      <select
                        value={vehicleDraft.assignedDriverId}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            assignedDriverId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {snapshot.drivers
                          .filter((driver) => driver.role === "Driver")
                          .map((driver) => (
                            <option key={driver.staffId} value={driver.staffId}>
                              {driver.name} / {driver.staffId}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="finance-field">
                      <span>Current odometer</span>
                      <input
                        type="number"
                        value={vehicleDraft.currentOdometer}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            currentOdometer: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Last service odometer</span>
                      <input
                        type="number"
                        value={vehicleDraft.lastServiceOdo}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            lastServiceOdo: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Service interval</span>
                      <input
                        type="number"
                        value={vehicleDraft.serviceIntervalKm}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            serviceIntervalKm: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Permit expiry</span>
                      <input
                        type="date"
                        value={vehicleDraft.permitExpiryDate}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            permitExpiryDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Disc expiry</span>
                      <input
                        type="date"
                        value={vehicleDraft.discExpiryDate}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            discExpiryDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="finance-form-actions">
                    <button
                      type="submit"
                      className="action-button primary"
                      disabled={!canEditFleetUpdates}
                    >
                      {vehicleDraft.id ? "Save vehicle" : "Create vehicle"}
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      disabled={!canEditFleetUpdates}
                      onClick={handleAddVehicle}
                    >
                      Add vehicle
                    </button>
                    {canArchiveVehicles &&
                      vehicleDraft.id &&
                      selectedVehicle?.id === vehicleDraft.id &&
                      selectedVehicle.status !== "archived" && (
                      <button
                        type="button"
                        className="record-button danger"
                        onClick={() => pushFeedback(onArchiveVehicle(selectedVehicle.id))}
                      >
                        Archive vehicle
                      </button>
                      )}
                  </div>
                  <p className="finance-form-note" data-tone="info">
                    Drivers can be linked to multiple vehicles. Save more than one vehicle with the
                    same linked driver to extend that driver&apos;s active vehicle list.
                  </p>
                </form>
              )}
            </Panel>
          </div>

          {canManageVehicles && (
            <Panel eyebrow="Route setup" title="Create route" icon={FileText}>
              <div className="compact-feed">
                {(snapshot.routes ?? []).slice(0, 4).map((route) => (
                  <CompactFeedItem
                    key={route.id}
                    title={`${route.code} / ${route.name}`}
                    subtitle={ROUTE_TYPE_OPTIONS.find((option) => option.value === route.type)?.label ?? route.type}
                    tone={route.isActive ? "success" : "info"}
                    meta={`${route.primaryOrigin} to ${route.primaryDestination}`}
                  />
                ))}
                {(snapshot.routes ?? []).length === 0 && (
                  <CompactFeedItem
                    title="No routes saved yet"
                    subtitle="Create the first reusable route record"
                    tone="info"
                    meta="Route master data"
                  />
                )}
              </div>
              <form ref={routeFormRef} className="finance-form" onSubmit={handleRouteSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field finance-field-wide">
                    <span>Route name</span>
                    <input
                      type="text"
                      value={routeDraft.name}
                      onChange={(event) =>
                        setRouteDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="finance-field">
                    <span>Route code</span>
                    <input
                      type="text"
                      value={routeDraft.code}
                      onChange={(event) =>
                        setRouteDraft((current) => ({
                          ...current,
                          code: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="finance-field">
                    <span>Route type</span>
                    <select
                      value={routeDraft.type}
                      onChange={(event) =>
                        setRouteDraft((current) => ({
                          ...current,
                          type: event.target.value,
                        }))
                      }
                    >
                      {ROUTE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="finance-field">
                    <span>Primary origin</span>
                    <input
                      type="text"
                      value={routeDraft.primaryOrigin}
                      onChange={(event) =>
                        setRouteDraft((current) => ({
                          ...current,
                          primaryOrigin: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="finance-field">
                    <span>Primary destination</span>
                    <input
                      type="text"
                      value={routeDraft.primaryDestination}
                      onChange={(event) =>
                        setRouteDraft((current) => ({
                          ...current,
                          primaryDestination: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="finance-field">
                    <span>Route status</span>
                    <select
                      value={routeDraft.isActive ? "active" : "inactive"}
                      onChange={(event) =>
                        setRouteDraft((current) => ({
                          ...current,
                          isActive: event.target.value === "active",
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                </div>
                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={!canEditFleetUpdates}
                  >
                    Create route
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => setRouteDraft(createRouteDraft())}
                  >
                    Clear form
                  </button>
                </div>
                <p className="finance-form-note" data-tone="info">
                  Use the route name to describe the full movement path if needed, for example{" "}
                  <code>A -&gt; B -&gt; C</code>. TaxiFlow will keep this as a reusable route
                  record.
                </p>
              </form>
            </Panel>
          )}

          {selectedVehicle && canViewVehicleProfile && (
            <div className="overview-board-grid">
              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Identity & Capability</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair label="Registration" value={selectedVehicle.registration} />
                  <InfoPair label="Model" value={selectedVehicle.model} />
                  <InfoPair label="Current driver" value={selectedVehicle.assignedDriver} />
                  <InfoPair label="Last known driver" value={lastKnownDriver} />
                  <InfoPair label="Current route" value={selectedVehicle.route} />
                  <InfoPair
                    label="Seat capacity"
                    value={
                      Number.isFinite(Number(selectedVehicle.seatCapacity))
                        ? `${selectedVehicle.seatCapacity}`
                        : "Not set"
                    }
                  />
                  <InfoPair
                    label="Route record"
                    value={currentRouteRecord?.code ?? selectedVehicle.currentRouteId ?? "Not linked"}
                  />
                  <InfoPair
                    label="Current odometer"
                    value={`${selectedVehicle.currentOdometer.toLocaleString()} km`}
                  />
                </div>
                <div className="finance-form-meta">
                  <span
                    className="status-chip"
                    data-tone={selectedVehicle.canDoRouteService ? "success" : "neutral"}
                  >
                    {selectedVehicle.canDoRouteService ? "Route service" : "Route service off"}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={selectedVehicle.canDoSpecialTrips ? "info" : "neutral"}
                  >
                    {selectedVehicle.canDoSpecialTrips ? "Special trips" : "Special trips off"}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={selectedVehicle.canDoContracts ? "info" : "neutral"}
                  >
                    {selectedVehicle.canDoContracts ? "Contracts" : "Contracts off"}
                  </span>
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Financial Contribution</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair
                    label="Captured income"
                    value={formatMoney(revenueOutline.totalRevenue)}
                  />
                  <InfoPair
                    label="Settled income"
                    value={formatMoney(selectedVehicle.verifiedRevenue ?? 0)}
                  />
                  <InfoPair
                    label="Route income"
                    value={formatMoney(revenueOutline.standardRevenue)}
                  />
                  <InfoPair
                    label="Extra trip income"
                    value={formatMoney(revenueOutline.specialRevenue)}
                  />
                  <InfoPair
                    label="Vehicle costs"
                    value={formatMoney(selectedVehicle.assetExpenseTotal ?? 0)}
                  />
                  <InfoPair label="Daily routes" value={`${revenueOutline.shiftCount}`} />
                  <InfoPair label="Extra trips" value={`${revenueOutline.specialTripCount}`} />
                  <InfoPair
                    label="Money left after costs"
                    value={formatMoney(selectedVehicle.netYield ?? 0)}
                  />
                  <InfoPair
                    label="Latest money activity"
                    value={
                      latestFinanceActivity
                        ? latestFinanceActivity.type === "expense"
                          ? formatExpenseMeta(latestFinanceActivity)
                          : latestFinanceActivity.isSpecial
                            ? formatTripLogMeta(latestFinanceActivity)
                            : formatDailyTripMeta(latestFinanceActivity)
                        : "No finance activity yet"
                    }
                  />
                </div>
                {vehicleIncomeRecords.length === 0 && (
                  <p className="panel-note">
                    Financial contribution details will fill in here once this vehicle has verified
                    income or expense activity.
                  </p>
                )}
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Passenger Contribution</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair
                    label="Passengers moved"
                    value={`${passengerContribution.totalPassengers}`}
                  />
                  <InfoPair label="Trips logged" value={`${passengerContribution.totalTrips}`} />
                  <InfoPair
                    label="Days captured"
                    value={`${passengerContribution.capturedDays}`}
                  />
                  <InfoPair
                    label="Last capture"
                    value={
                      passengerContribution.lastCapturedAt
                        ? formatStamp(passengerContribution.lastCapturedAt)
                        : "No passenger log yet"
                    }
                  />
                </div>
                {passengerContribution.totalTrips === 0 && (
                  <p className="panel-note">
                    Passenger contribution will appear here after daily route logs are captured for
                    this vehicle.
                  </p>
                )}
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Driver History</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair label="Current driver" value={selectedVehicle.assignedDriver} />
                  <InfoPair label="Last known driver" value={lastKnownDriver} />
                  <InfoPair label="Driver events" value={`${driverHistory.length}`} />
                  <InfoPair
                    label="Latest driver activity"
                    value={driverHistory[0]?.meta ?? "No driver-linked activity yet"}
                  />
                </div>
                <div className="compact-feed">
                  {driverHistory.map((entry, index) => (
                    <CompactFeedItem
                      key={`${entry.name}-${index}`}
                      title={entry.name}
                      subtitle={entry.meta}
                      tone={entry.tone}
                      meta={selectedVehicle.registration}
                    />
                  ))}
                  {driverHistory.length === 0 && (
                    <CompactFeedItem
                      title="No driver history yet"
                      subtitle="Driver-linked actions will appear here"
                      tone="info"
                      meta={selectedVehicle.assignedDriver}
                    />
                  )}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Route & Movement History</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair label="Current route" value={selectedVehicle.route} />
                  <InfoPair
                    label="Route type"
                    value={currentRouteRecord?.type ?? "route_service"}
                  />
                  <InfoPair
                    label="Primary origin"
                    value={currentRouteRecord?.primaryOrigin ?? "Not set"}
                  />
                  <InfoPair
                    label="Primary destination"
                    value={currentRouteRecord?.primaryDestination ?? "Not set"}
                  />
                  <InfoPair
                    label="Points on route"
                    value={`${routeMovementPoints.length}`}
                  />
                  <InfoPair
                    label="Routes operated"
                    value={`${operatedRoutes.length}`}
                  />
                </div>
                <div className="compact-feed">
                  {operatedRoutes.map((route, index) => (
                    <CompactFeedItem
                      key={`${route.title}-${index}`}
                      title={route.title}
                      subtitle={route.subtitle}
                      tone={route.subtitle === "Standard route" ? "success" : "info"}
                      meta={route.meta}
                    />
                  ))}
                  {routeMovementPoints.slice(0, 4).map((point) => (
                    <CompactFeedItem
                      key={point.id}
                      title={`${point.sequence}. ${point.label}`}
                      subtitle={`Stop type: ${point.stopType}`}
                      tone={point.stopType === "checkpoint" ? "info" : "success"}
                      meta={currentRouteRecord?.code ?? selectedVehicle.currentRouteId ?? "Route"}
                    />
                  ))}
                  {operatedRoutes.length === 0 && routeMovementPoints.length === 0 && (
                    <CompactFeedItem
                      title="No route history yet"
                      subtitle="Trips and route point movement will appear here"
                      tone="info"
                      meta={selectedVehicle.route}
                    />
                  )}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Service & Compliance</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair
                    label="Last service"
                    value={`${selectedVehicle.lastServiceOdo.toLocaleString()} km`}
                  />
                  <InfoPair
                    label="Service interval"
                    value={`${selectedVehicle.serviceIntervalKm.toLocaleString()} km`}
                  />
                  <InfoPair
                    label="Next service target"
                    value={`${selectedVehicle.nextServiceAt.toLocaleString()} km`}
                  />
                  <InfoPair
                    label="Permit expiry"
                    value={selectedVehicle.permitExpiryDate ? formatDateOnly(selectedVehicle.permitExpiryDate) : "Not set"}
                  />
                  <InfoPair
                    label="Disc expiry"
                    value={selectedVehicle.discExpiryDate ? formatDateOnly(selectedVehicle.discExpiryDate) : "Not set"}
                  />
                </div>
                <div className="compact-feed">
                  {serviceHistory.map((defect) => (
                    <CompactFeedItem
                      key={defect.id}
                      title={`Repair / ${defect.category}`}
                      subtitle={defect.detail}
                      tone="success"
                      meta={`${formatMoney(defect.repairCost ?? 0)} / ${defect.resolvedAtLabel ?? "Resolved"}`}
                    />
                  ))}
                  {healthHighlights.map((entry, index) => (
                    <CompactFeedItem
                      key={`${entry.title}-${index}`}
                      title={entry.title}
                      subtitle={entry.subtitle}
                      tone={entry.tone}
                      meta={entry.meta}
                    />
                  ))}
                  {vehicleDocuments.slice(0, 3).map((document) => (
                    <CompactFeedItem
                      key={document.id}
                      title={document.document}
                      subtitle={document.stage}
                      tone={getDocumentTone(document.daysLeft)}
                      meta={`${document.daysLeft} days`}
                    />
                  ))}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Vehicle profile shell</p>
                  <h3>Availability & Suitability</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair label="Status" value={selectedVehicle.status ?? "active"} />
                  <InfoPair label="Assigned driver" value={selectedVehicle.assignedDriver} />
                  <InfoPair
                    label="Open defects"
                    value={`${selectedVehicle.defectsOpen ?? 0}`}
                  />
                  <InfoPair
                    label="Document runway"
                    value={`${selectedVehicle.minimumDocumentDays ?? 0} days`}
                  />
                </div>
                <div className="finance-form-meta">
                  {suitabilityHighlights.map((item) => (
                    <span key={item} className="status-chip" data-tone="info">
                      {item}
                    </span>
                  ))}
                </div>
                <p className="panel-note">
                  Current suitability is based on the saved vehicle status, linked driver,
                  document time left, open problems, and capability flags. Live availability
                  windows are not captured yet.
                </p>
              </article>
            </div>
          )}

      {selectedVehicle ? (
        <Panel eyebrow="Vehicle issues" title="Activity history" icon={AlertTriangle}>
          {canResolveDefects && (
            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Manager tools</p>
                <h3>Update reported problems</h3>
              </div>
              <p className="panel-note">
                Managers can open any reported problem for editing, then mark it as fixed once the
                repair amount is confirmed.
              </p>
              <div className="finance-form-actions">
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() =>
                    openDefectsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  <AlertTriangle size={16} />
                  Open reported problems
                </button>
                <button
                  type="button"
                  className="action-button"
                  onClick={() =>
                    defectFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  <Settings2 size={16} />
                  Update problem form
                </button>
                <span
                  className="status-chip"
                  data-tone={
                    vehicleDefects.some((defect) => defect.status !== "resolved")
                      ? "warning"
                      : "success"
                  }
                >
                  {vehicleDefects.filter((defect) => defect.status !== "resolved").length} open
                </span>
              </div>
            </article>
          )}

          <div className="finance-board-grid finance-board-grid-3">
            <article ref={defectFormRef} className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Problem form</p>
                <h3>
                  {defectDraft.id
                    ? "Update reported problem"
                    : isDriver
                      ? "My assigned vehicle"
                      : "Report a problem"}
                </h3>
              </div>
              <form className="finance-form" onSubmit={handleDefectSubmit}>
                {!isDriver && (
                  <label className="finance-field">
                    <span>Vehicle</span>
                    <select
                      value={defectDraft.vehicleId}
                      onChange={(event) =>
                        setDefectDraft((current) => ({
                          ...current,
                          vehicleId: event.target.value,
                        }))
                      }
                    >
                      {snapshot.vehicles
                        .filter((vehicle) => vehicle.status !== "archived")
                        .map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.registration} / {vehicle.route}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="finance-field">
                  <span>Category</span>
                  <select
                    value={defectDraft.category}
                    onChange={(event) =>
                      setDefectDraft((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                  >
                    {DEFECT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="finance-field finance-field-wide">
                  <span>Detail</span>
                  <input
                    type="text"
                    value={defectDraft.detail}
                    onChange={(event) =>
                      setDefectDraft((current) => ({
                        ...current,
                        detail: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={PRIVILEGED_ROLES.has(activeRole) && !canEditFleetUpdates}
                  >
                    {defectDraft.id ? "Update problem" : "Report problem"}
                  </button>
                  {defectDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() =>
                        setDefectDraft(createDefectDraft(isDriver ? assignedVehicleId : selectedVehicle?.id))
                      }
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            </article>

            <article ref={openDefectsRef} className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Open problems</p>
                <h3>What still needs fixing</h3>
              </div>
              <div className="finance-ledger">
                {vehicleDefects
                  .filter((defect) => defect.status !== "resolved")
                  .map((defect) => (
                    <article key={defect.id} className="ledger-row">
                      <div className="ledger-copy">
                        <strong>{defect.category}</strong>
                        <span>{defect.detail}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="status-chip" data-tone={getDefectTone(defect.severity)}>
                          {defect.severity}
                        </span>
                        <span>{defect.reportedAtLabel}</span>
                      </div>
                      {canResolveDefects ? (
                        <div className="verification-actions">
                          <button
                            type="button"
                            className="action-button"
                            onClick={() => handleEditDefect(defect)}
                          >
                            <Settings2 size={16} />
                            Update problem
                          </button>
                          <input
                            className="verification-input"
                            type="number"
                            min="0"
                            step="1"
                            value={resolutionCosts[defect.id] ?? ""}
                            onChange={(event) =>
                              setResolutionCosts((current) => ({
                                ...current,
                                [defect.id]: event.target.value,
                              }))
                            }
                            placeholder="Repair amount"
                          />
                          <button
                            type="button"
                            className="action-button primary"
                            onClick={() => handleResolve(defect.id)}
                          >
                            Mark as fixed
                          </button>
                        </div>
                      ) : (
                        <span className="status-chip" data-tone="warning">
                          Waiting for manager action
                        </span>
                      )}
                    </article>
                  ))}
              </div>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Fixed history</p>
                <h3>Past repairs</h3>
              </div>
              <div className="finance-ledger">
                {vehicleDefects
                  .filter((defect) => defect.status === "resolved")
                  .map((defect) => (
                    <article key={defect.id} className="ledger-row">
                      <div className="ledger-copy">
                        <strong>{defect.category}</strong>
                        <span>{defect.detail}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="status-chip" data-tone="success">
                          Resolved
                        </span>
                        <strong>{formatMoney(defect.repairCost ?? 0)}</strong>
                        <span>{defect.resolvedAtLabel}</span>
                      </div>
                    </article>
                  ))}
              </div>
            </article>
          </div>
        </Panel>
      ) : (
        <Panel eyebrow="Vehicle issues" title="Activity history" icon={AlertTriangle}>
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Problem reporting</p>
              <h3>No vehicle available</h3>
            </div>
            <p className="panel-note">
              {isDriver
                ? "A vehicle must be linked to your driver profile before you can report defects."
                : "Add a vehicle before logging, updating, or resolving defects."}
            </p>
          </article>
        </Panel>
      )}
        </>
      )}
    </div>
  );
}

function CompliancePanel({ snapshot }) {
  return (
    <div className="content-stack">
      <div className="two-up">
        <Panel
          eyebrow="Service reminders"
          title="Service and document alerts"
          icon={ShieldAlert}
        >
          <div className="traffic-grid">
            {snapshot.serviceSchedule.slice(0, 3).map((item, index) => (
              <article
                key={`${item.vehicle}-${item.serviceType}-${index}`}
                className="traffic-card"
                data-tone={item.tone}
              >
                <span className="eyebrow">
                  {item.dueInKm <= 0 ? "Immediate" : `${item.dueInKm} km`}
                </span>
                <h3>{item.vehicle}</h3>
                <p>{item.serviceType}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Document reminders" title="Expiring documents" icon={FileText}>
          <div className="list-stack">
            {snapshot.documents.map((document) => (
              <StatusRow
                key={document.id ?? `${document.subject}-${document.document}`}
                title={`${document.subject} / ${document.document}`}
                detail={document.action}
                tone={getDocumentTone(document.daysLeft)}
                meta={`${document.daysLeft} days / ${document.owner}`}
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SettingsPanel({
  activeRole,
  snapshot,
  backendMode,
  backendModeLabel,
  backendModeNote,
  currentUserEmail,
  factoryResetSubmitting,
  isLocalAuth,
  onChangeBackendMode,
  onFactoryReset,
  onResolvePasswordResetRequest,
  onResetUserPassword,
  onSaveUserAccess,
}) {
  const users = useMemo(() => getAppUsers(snapshot), [snapshot]);
  const normalizedCurrentUserEmail = String(currentUserEmail ?? "").trim().toLowerCase();
  const [selectedUserEmail, setSelectedUserEmail] = useState(users[0]?.email ?? "");
  const [draft, setDraft] = useState(() => createUserAccessDraft(users[0]));
  const [feedback, setFeedback] = useState(null);
  const [factoryResetPassword, setFactoryResetPassword] = useState("");
  const [factoryResetFeedback, setFactoryResetFeedback] = useState(null);

  useEffect(() => {
    if (!users.some((user) => user.email === selectedUserEmail)) {
      setSelectedUserEmail(users[0]?.email ?? "");
    }
  }, [selectedUserEmail, users]);

  const selectedUser = users.find((user) => user.email === selectedUserEmail) ?? users[0] ?? null;
  const isEditingSignedInOwner = selectedUser?.email === normalizedCurrentUserEmail;
  const selectedUserVisibleModules = Object.keys(MODULE_VIEW_ACCESS).filter(
    (moduleKey) => selectedUser?.moduleAccess?.[moduleKey],
  );
  const passwordResetRequests = useMemo(() => {
    const usersByEmail = new Map(users.map((user) => [normalizeEmailAddress(user.email), user]));

    return [...(snapshot.passwordResetRequests ?? [])]
      .map((request) => {
        const normalizedEmail = normalizeEmailAddress(request.email);
        const matchedUser = usersByEmail.get(normalizedEmail) ?? null;
        const linkedEmailNotice = getPasswordResetEmailNotice(snapshot.emailOutbox ?? [], request.id);
        const status =
          String(request.status ?? "pending").trim().toLowerCase() === "resolved"
            ? "resolved"
            : "pending";
        const notificationChannelStatus =
          String(request.notificationStatus ?? "sent").trim().toLowerCase() === "sent"
            ? "sent"
            : "missing";
        const emailChannelStatus = linkedEmailNotice
          ? String(linkedEmailNotice.status ?? "queued").trim().toLowerCase() === "actioned"
            ? "actioned"
            : "queued"
          : "missing";

        return {
          ...request,
          email: normalizedEmail,
          accountName: request.accountName ?? matchedUser?.name ?? normalizedEmail,
          accountRoleLabel: matchedUser?.role ?? request.accountRole ?? "Unmapped account",
          requestedAtLabel: formatStamp(request.requestedAt),
          managementRecipientsLabel: Array.isArray(request.managementRecipients)
            ? request.managementRecipients.join(", ")
            : "No management recipients",
          status,
          statusLabel: status === "resolved" ? "Handled" : "Pending",
          statusTone: status === "resolved" ? "success" : "warning",
          notificationChannelLabel:
            notificationChannelStatus === "sent" ? "In-app sent" : "In-app retry needed",
          notificationChannelTone:
            notificationChannelStatus === "sent" ? "success" : "warning",
          emailChannelLabel:
            emailChannelStatus === "queued"
              ? "Email queued"
              : emailChannelStatus === "actioned"
                ? "Email handled"
                : "Email retry needed",
          emailChannelTone:
            emailChannelStatus === "queued"
              ? "info"
              : emailChannelStatus === "actioned"
                ? "success"
                : "warning",
          userExists: Boolean(matchedUser),
        };
      })
      .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt));
  }, [snapshot.emailOutbox, snapshot.passwordResetRequests, users]);
  const emailOutbox = useMemo(
    () =>
      [...(snapshot.emailOutbox ?? [])]
        .map((entry) => {
          const status =
            String(entry.status ?? "queued").trim().toLowerCase() === "actioned"
              ? "actioned"
              : "queued";

          return {
            ...entry,
            createdAtLabel: formatStamp(entry.createdAt ?? entry.actionedAt),
            recipientsLabel: Array.isArray(entry.recipients)
              ? entry.recipients.join(", ")
              : "No recipients",
            previewText: String(entry.preview ?? entry.body ?? "").trim() || "No email text prepared.",
            status,
            statusLabel: status === "actioned" ? "Handled" : "Queued",
            statusTone: status === "actioned" ? "success" : "info",
          };
        })
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)),
    [snapshot.emailOutbox],
  );
  const pendingPasswordResetCount = passwordResetRequests.filter(
    (request) => request.status === "pending",
  ).length;
  const queuedEmailCount = emailOutbox.filter((entry) => entry.status === "queued").length;
  const canManageUserAccess = activeRole === "Owner";
  const canResetPasswords = PASSWORD_RESET_ROLES.has(activeRole);
  const canManageSelectedUserDetails =
    Boolean(selectedUser) && (canManageUserAccess || selectedUser?.role !== "Owner");
  const hasManagedUserDraftChanges =
    Boolean(selectedUser) &&
    (String(draft.name ?? "").trim() !== String(selectedUser?.name ?? "").trim() ||
      Boolean(String(draft.nextAccessPassword ?? "").trim()));

  useEffect(() => {
    if (selectedUser) {
      setDraft(createUserAccessDraft(selectedUser));
    }
  }, [selectedUser]);

  const pushFeedback = (response) => {
    setFeedback({
      tone: response?.ok ? "success" : "danger",
      message: response?.message ?? response?.error,
    });
  };

  const handleRoleChange = (nextRole) => {
    setDraft((current) => {
      const resolvedRole = normalizeRole(nextRole) ?? current.role;
      return {
        ...current,
        role: resolvedRole,
        moduleAccess: normalizeModuleViewAccess(current.moduleAccess, resolvedRole),
      };
    });
  };

  const toggleModuleAccess = (moduleKey) => {
    setDraft((current) => ({
      ...current,
      moduleAccess: {
        ...current.moduleAccess,
        [moduleKey]: !current.moduleAccess[moduleKey],
      },
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    pushFeedback(onSaveUserAccess(draft));
  };

  const handleManagedUserSubmit = (event) => {
    event.preventDefault();
    pushFeedback(
      onResetUserPassword({
        email: selectedUser?.email,
        name: draft.name,
        nextAccessPassword: draft.nextAccessPassword,
      }),
    );
  };

  const handleFactoryResetSubmit = async (event) => {
    event.preventDefault();
    const response = await onFactoryReset(factoryResetPassword);

    setFactoryResetFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setFactoryResetPassword("");
    }
  };

  return (
    <div className="content-stack">
      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      <div className="two-up">
        <Panel
          eyebrow={canManageUserAccess ? "User access" : "Password support"}
          title={canManageUserAccess ? "Roles and rights" : "User accounts"}
          icon={Settings2}
        >
          <div className="finance-form-meta">
            <span className="status-chip" data-tone="info">
              {users.length} mapped users
            </span>
            {isLocalAuth && (
              <span className="status-chip" data-tone="warning">
                Default local password: {LOCAL_AUTH_PASSWORD}
              </span>
            )}
          </div>
          <div className="list-stack">
            {users.map((user) => {
              const visibleModuleCount = Object.keys(MODULE_VIEW_ACCESS).filter(
                (moduleKey) => user.moduleAccess?.[moduleKey],
              ).length;

              return (
                <article key={user.email} className="person-row">
                  <div>
                    <h3>{user.name}</h3>
                    <p>{user.email}</p>
                  </div>
                  <div className="ledger-meta">
                    <span className="status-chip" data-tone={user.role === "Owner" ? "success" : "info"}>
                      {user.role}
                    </span>
                    <span className="status-chip" data-tone="navy">
                      {`${visibleModuleCount} module${visibleModuleCount === 1 ? "" : "s"}`}
                    </span>
                    <button
                      type="button"
                      className={
                        user.email === selectedUserEmail
                          ? "finance-sub-pill active"
                          : "finance-sub-pill"
                      }
                      onClick={() => setSelectedUserEmail(user.email)}
                    >
                      Manage
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel
          eyebrow={canManageUserAccess ? "Owner control" : "Management control"}
          title={canManageUserAccess ? "Edit selected user" : "Update selected user"}
          icon={Lock}
        >
          {selectedUser ? (
            canManageUserAccess ? (
              <form className="finance-form" onSubmit={handleSubmit}>
                <div className="queue-stats">
                  <InfoPair label="Name" value={selectedUser.name} />
                  <InfoPair label="Email" value={selectedUser.email} />
                  <InfoPair
                    label="Driver link"
                    value={selectedUser.staffId ? selectedUser.staffId : "Not linked"}
                  />
                  <InfoPair
                    label="Current rights"
                    value={
                      selectedUserVisibleModules.length > 0
                        ? selectedUserVisibleModules
                            .map((moduleKey) => MODULE_VIEW_ACCESS[moduleKey].label)
                            .join(", ")
                        : "Overview only"
                    }
                  />
                </div>

                <label className="finance-field">
                  <span>Role</span>
                  <select
                    value={draft.role}
                    disabled={isEditingSignedInOwner}
                    onChange={(event) => handleRoleChange(event.target.value)}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role} disabled={!canAssignRoleToUser(role, selectedUser)}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="overview-board">
                  <div className="overview-board-head">
                    <p className="eyebrow">Module rights</p>
                    <h3>Access by role</h3>
                  </div>
                  <p className="panel-note">
                    Overview stays on for every user. Management keeps Settings for password resets,
                    and the owner turns Money, Fleet & Operations, and Drivers on only when needed.
                  </p>
                  <div className="finance-sub-switch">
                    {SETTINGS_ASSIGNABLE_MODULES.map((moduleKey) => {
                      const moduleConfig = MODULE_VIEW_ACCESS[moduleKey];
                      const allowedByRole = canAssignModuleToRole(draft.role, moduleKey);
                      const active = Boolean(draft.moduleAccess[moduleKey]);

                      return (
                        <button
                          key={moduleKey}
                          type="button"
                          className={active ? "finance-sub-pill active" : "finance-sub-pill"}
                          disabled={!allowedByRole || isEditingSignedInOwner || draft.role === "Owner"}
                          onClick={() => toggleModuleAccess(moduleKey)}
                        >
                          {moduleConfig.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="finance-field">
                  <span>Reset local password</span>
                  <input
                    autoComplete="new-password"
                    type="password"
                    placeholder="Leave blank to keep the current password"
                    value={draft.nextAccessPassword}
                    disabled={isEditingSignedInOwner}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        nextAccessPassword: event.target.value,
                      }))
                    }
                  />
                </label>

                <div className="finance-form-actions">
                  <button type="submit" className="action-button primary" disabled={isEditingSignedInOwner}>
                    Save access
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => setDraft(createUserAccessDraft(selectedUser))}
                  >
                    Reset
                  </button>
                </div>

                <p
                  className="finance-form-note"
                  data-tone={
                    isEditingSignedInOwner || !canAssignRoleToUser(draft.role, selectedUser)
                      ? "warning"
                      : "info"
                  }
                >
                  {isEditingSignedInOwner
                    ? "The signed-in owner account stays locked while it is in use."
                    : !canAssignRoleToUser(draft.role, selectedUser)
                      ? "Link this account to a driver profile before assigning the Driver role."
                      : draft.nextAccessPassword
                        ? isLocalAuth
                          ? "Saving now will reset this account password and close any waiting reset request for this email."
                          : "Saving here records the reset request as handled. Update the matching Supabase password separately."
                      : "Changing a role resets optional feature access to that role's default. Management starts with Overview and Settings only until the owner enables more modules."}
                </p>
              </form>
            ) : (
              <form className="finance-form" onSubmit={handleManagedUserSubmit}>
                <div className="queue-stats">
                  <InfoPair label="Name" value={selectedUser.name} />
                  <InfoPair label="Email" value={selectedUser.email} />
                  <InfoPair label="Role" value={selectedUser.role} />
                  <InfoPair
                    label="Current feature access"
                    value={
                      selectedUserVisibleModules.length > 0
                        ? selectedUserVisibleModules
                            .map((moduleKey) => MODULE_VIEW_ACCESS[moduleKey].label)
                            .join(", ")
                        : "Overview only"
                    }
                  />
                </div>

                <label className="finance-field">
                  <span>Full name</span>
                  <input
                    type="text"
                    placeholder="Name and surname"
                    value={draft.name}
                    disabled={!canManageSelectedUserDetails}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="finance-field">
                  <span>New password</span>
                  <input
                    autoComplete="new-password"
                    type="password"
                    placeholder="Enter the replacement password"
                    value={draft.nextAccessPassword}
                    disabled={!canManageSelectedUserDetails}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        nextAccessPassword: event.target.value,
                      }))
                    }
                  />
                </label>

                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={!canManageSelectedUserDetails || !hasManagedUserDraftChanges}
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => setDraft(createUserAccessDraft(selectedUser))}
                  >
                    Clear
                  </button>
                </div>

                <p
                  className="finance-form-note"
                  data-tone={!canManageSelectedUserDetails ? "warning" : "info"}
                >
                  {!canManageSelectedUserDetails
                    ? "Only the owner can update another owner profile."
                    : isLocalAuth
                      ? "Management can update a user name here and optionally reset the local password. The owner still controls roles and feature access."
                      : "Management can update a user name here and log a password reset. The owner still controls roles and feature access, and the matching Supabase password must still be updated separately in live mode."}
                </p>
              </form>
            )
          ) : (
            <p className="panel-note">No user accounts are available in this workspace yet.</p>
          )}
        </Panel>
      </div>

      <div className="two-up">
        <Panel eyebrow="Access support" title="Password reset requests" icon={AlertCircle}>
          <div className="finance-form-meta">
            <span className="status-chip" data-tone={pendingPasswordResetCount > 0 ? "warning" : "success"}>
              {pendingPasswordResetCount} pending
            </span>
            <span className="status-chip" data-tone="info">
              {passwordResetRequests.length} logged
            </span>
          </div>
          {passwordResetRequests.length > 0 ? (
            <div className="list-stack">
              {passwordResetRequests.map((request) => (
                <article key={request.id} className="person-row">
                  <div className="person-copy">
                    <h3>{request.accountName}</h3>
                    <p>{request.email}</p>
                    <p>
                      {request.accountRoleLabel} / Requested {request.requestedAtLabel}
                    </p>
                    <p>Management: {request.managementRecipientsLabel}</p>
                  </div>
                  <div className="person-metrics">
                    <span className="status-chip" data-tone={request.statusTone}>
                      {request.statusLabel}
                    </span>
                    <span className="status-chip" data-tone={request.notificationChannelTone}>
                      {request.notificationChannelLabel}
                    </span>
                    <span className="status-chip" data-tone={request.emailChannelTone}>
                      {request.emailChannelLabel}
                    </span>
                    {request.userExists && (
                      <button
                        type="button"
                        className="finance-sub-pill"
                        onClick={() => setSelectedUserEmail(request.email)}
                      >
                        Open user
                      </button>
                    )}
                    {request.status === "pending" && (
                      <button
                        type="button"
                        className="finance-sub-pill"
                        onClick={() => pushFeedback(onResolvePasswordResetRequest(request.id))}
                      >
                        Mark handled
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-note">
              No password reset requests have been sent from the sign-in screen yet.
            </p>
          )}
          <p className="finance-form-note" data-tone="info">
            Reset the account password in the selected user record, or mark the request handled if
            management completed the reset outside TaxiFlow.
          </p>
        </Panel>

        <Panel eyebrow="Outgoing mail" title="Email outbox" icon={FileText}>
          <div className="finance-form-meta">
            <span className="status-chip" data-tone={queuedEmailCount > 0 ? "info" : "success"}>
              {queuedEmailCount} queued
            </span>
            <span className="status-chip" data-tone="navy">
              {emailOutbox.length} notices
            </span>
          </div>
          {emailOutbox.length > 0 ? (
            <div className="finance-ledger">
              {emailOutbox.map((entry) => (
                <article key={entry.id} className="ledger-row">
                  <div className="ledger-copy">
                    <strong>{entry.subject}</strong>
                    <span>{entry.previewText}</span>
                  </div>
                  <div className="ledger-meta">
                    <span className="status-chip" data-tone={entry.statusTone}>
                      {entry.statusLabel}
                    </span>
                    <span>{entry.createdAtLabel}</span>
                    <span>{entry.recipientsLabel}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="panel-note">No email notices have been prepared yet.</p>
          )}
          <p className="finance-form-note" data-tone="info">
            TaxiFlow keeps the management email notice here so the reset trail stays visible inside
            the workspace.
          </p>
        </Panel>
      </div>

      {activeRole === "Owner" && (
        <div className="two-up">
          <Panel eyebrow="Workspace control" title="Data mode" icon={Settings2}>
            <div className="queue-stats">
              <InfoPair label="Current mode" value={backendModeLabel} />
              <InfoPair
                label="Storage"
                value={
                  backendMode === "live"
                    ? repository.liveModeSourceLabel
                    : "Local training workspace"
                }
              />
            </div>
            <div className="backend-mode-switch" role="group" aria-label="Data mode toggle">
              <button
                type="button"
                className={backendMode === "mock" ? "role-pill compact active" : "role-pill compact"}
                onClick={() => onChangeBackendMode("mock")}
              >
                Demo
              </button>
              <button
                type="button"
                className={backendMode === "live" ? "role-pill compact active" : "role-pill compact"}
                onClick={() => onChangeBackendMode("live")}
              >
                Live
              </button>
            </div>
            <p className="panel-note">{backendModeNote}</p>
            <p className="finance-form-note" data-tone="info">
              Switching mode reloads the workspace with the selected data source.
            </p>
          </Panel>

          <Panel eyebrow="Owner control" title="Factory reset" icon={AlertTriangle}>
            {factoryResetFeedback && (
              <div className="finance-feedback" data-tone={factoryResetFeedback.tone}>
                <span className="status-chip" data-tone={factoryResetFeedback.tone}>
                  {factoryResetFeedback.message}
                </span>
              </div>
            )}
            <form className="finance-form" onSubmit={handleFactoryResetSubmit}>
              <div className="queue-stats">
                <InfoPair
                  label="Reset target"
                  value={backendMode === "live" ? "Live workspace" : "Demo workspace"}
                />
                <InfoPair
                  label="Keeps after reset"
                  value="Owner sign-in and default factory setup"
                />
                <InfoPair
                  label="Clears"
                  value="Trips, expenses, fleet, users, documents, and history"
                />
                <InfoPair
                  label="Password check"
                  value={isLocalAuth ? "TaxiFlow local owner password" : "Signed-in owner password"}
                />
              </div>

              <label className="finance-field">
                <span>Owner password</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={factoryResetPassword}
                  onChange={(event) => setFactoryResetPassword(event.target.value)}
                />
              </label>

              <div className="finance-form-actions">
                <button
                  type="submit"
                  className="record-button danger"
                  disabled={factoryResetSubmitting || !factoryResetPassword.trim()}
                >
                  {factoryResetSubmitting ? "Resetting..." : "Factory reset"}
                </button>
              </div>

              <p className="finance-form-note" data-tone="danger">
                This resets the active {backendMode === "live" ? "live" : "demo"} workspace to
                factory defaults and removes all captured activity in that workspace.
              </p>
            </form>
          </Panel>
        </div>
      )}
    </div>
  );
}

function DailyTripLogbookFields({ route, tripLogbook, onChange }) {
  const routeStops = getRouteStops(route);
  const hasPresetStops = Boolean(routeStops.fromLocation && routeStops.toLocation);
  const safeTripLogbook = Array.isArray(tripLogbook) ? tripLogbook : [];
  const totals = getDailyTripLogbookTotals(safeTripLogbook);

  const updateEntry = (entryId, updates) => {
    onChange(
      safeTripLogbook.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              ...updates,
            }
          : entry,
      ),
    );
  };

  return (
    <div className="content-stack">
      <div className="overview-board-head">
        <p className="eyebrow">Passenger logbook</p>
        <h3>Trips between stops</h3>
      </div>

      <div className="finance-form-meta">
        <span className="status-chip" data-tone={hasPresetStops ? "info" : "warning"}>
          Route {route?.trim() || "Not set"}
        </span>
        <span className="status-chip" data-tone="navy">
          Logged trips {totals.tripCount}
        </span>
        <span className="status-chip" data-tone="info">
          Passengers {totals.totalPassengers.toLocaleString()}
        </span>
        <span className="status-chip" data-tone="success">
          Total collected {formatMoney(totals.totalAmount)}
        </span>
      </div>

      {!hasPresetStops && (
        <p className="finance-form-note" data-tone="info">
          Set the vehicle route in Fleet & Operations to prefill the two stops for this daily logbook.
        </p>
      )}

      <p className="finance-form-note" data-tone="info">
        Trip time and odometer details are optional. The driver can skip them and still save the
        trip, and the duration and kilometre previews fill themselves in only when both values are
        available.
      </p>

      <div className="list-stack">
        {safeTripLogbook.map((entry, index) => (
          <article key={entry.id ?? index} className="person-row">
            <div className="finance-form-grid">
              <label className="finance-field">
                <span>From</span>
                {hasPresetStops ? (
                  <select
                    value={entry.fromLocation}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        fromLocation: event.target.value,
                      })
                    }
                  >
                    {[routeStops.fromLocation, routeStops.toLocation].map((stop) => (
                      <option key={`from-${entry.id}-${stop}`} value={stop}>
                        {stop}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={entry.fromLocation}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        fromLocation: event.target.value,
                      })
                    }
                  />
                )}
              </label>

              <label className="finance-field">
                <span>To</span>
                {hasPresetStops ? (
                  <select
                    value={entry.toLocation}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        toLocation: event.target.value,
                      })
                    }
                  >
                    {[routeStops.fromLocation, routeStops.toLocation].map((stop) => (
                      <option key={`to-${entry.id}-${stop}`} value={stop}>
                        {stop}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={entry.toLocation}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        toLocation: event.target.value,
                      })
                    }
                  />
                )}
              </label>

              <label className="finance-field">
                <span>Passengers</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={entry.passengerCount}
                  onChange={(event) =>
                    updateEntry(entry.id, {
                      passengerCount: event.target.value,
                    })
                  }
                />
              </label>

              <label className="finance-field">
                <span>Amount collected</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={entry.amountCollected}
                  onChange={(event) =>
                    updateEntry(entry.id, {
                      amountCollected: event.target.value,
                    })
                  }
                />
              </label>

              <TripLegOptionalFields
                entry={entry}
                onUpdate={(updates) => updateEntry(entry.id, updates)}
              />
            </div>

            <div className="finance-form-actions">
              <button
                type="button"
                className="record-button"
                onClick={() =>
                  updateEntry(entry.id, {
                    fromLocation: entry.toLocation,
                    toLocation: entry.fromLocation,
                  })
                }
              >
                Swap stops
              </button>
              <button
                type="button"
                className="record-button danger"
                disabled={safeTripLogbook.length === 1}
                onClick={() => onChange(safeTripLogbook.filter((item) => item.id !== entry.id))}
              >
                Remove trip
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="finance-form-actions">
        <button
          type="button"
          className="action-button"
          onClick={() =>
            onChange([...safeTripLogbook, createDailyTripLogEntry(route)])
          }
        >
          Add passenger trip
        </button>
      </div>
    </div>
  );
}

function DriversPanel({
  snapshot,
  activeRole,
  currentUserRecord,
  permissionControls,
  onShortcutAction,
  shortcutIntent,
  onSaveStandardIncome,
  onSaveSpecialIncome,
  onSaveExpense,
  onSubmitDriverCashUp,
  onSaveDriver,
  onAllocateDriverShift,
  onSelectDriverVehicle,
}) {
  const isDriver = activeRole === "Driver";
  const canEditDriverRecords = canEditModuleUpdates(
    activeRole,
    "drivers",
    permissionControls,
    currentUserRecord,
  );
  const canManageDrivers =
    activeRole === "Owner" ||
    (PRIVILEGED_ROLES.has(activeRole) && canEditDriverRecords);
  const canEditFinanceRecords = canEditModuleUpdates(
    activeRole,
    "finance",
    permissionControls,
    currentUserRecord,
  );
  const canUseFinanceCapture = activeRole === "Driver" ? true : canEditFinanceRecords;
  const autoCheckDriverExpenses = activeRole !== "Driver" && canEditFinanceRecords;
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const allocatableDrivers = useMemo(
    () => snapshot.drivers.filter((driver) => driver.role === "Driver"),
    [snapshot.drivers],
  );
  const allocatableVehicles = useMemo(
    () => snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived"),
    [snapshot.vehicles],
  );
  const driverVehicleMap = useMemo(
    () =>
      new Map(
        snapshot.vehicles
          .filter((vehicle) => vehicle.assignedDriverId)
          .map((vehicle) => [vehicle.assignedDriverId, vehicle]),
      ),
    [snapshot.vehicles],
  );
  const linkedVehicleIds = new Set(linkedVehicles.map((vehicle) => vehicle.id));
  const linkedVehicleRegistrations = new Set(
    linkedVehicles.map((vehicle) => vehicle.registration),
  );
  const filteredDrivers =
    activeRole === "Driver"
      ? snapshot.drivers.filter(
          (driver) => driver.name === snapshot.driverTerminal.activeDriver,
        )
      : snapshot.drivers;
  const assignedVehicleId = isDriver
    ? snapshot.driverTerminal.assignedVehicleId ?? linkedVehicles[0]?.id ?? ""
    : snapshot.driverTerminal.assignedVehicleId ?? snapshot.vehicles[0]?.id ?? "";
  const [driverAction, setDriverAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [driverDraft, setDriverDraft] = useState(() => createDriverDraft());
  const buildAllocationDraft = (staffId = allocatableDrivers[0]?.staffId ?? "") =>
    createDriverAllocationDraft(staffId, driverVehicleMap.get(staffId)?.id ?? "");
  const [allocationDraft, setAllocationDraft] = useState(() => buildAllocationDraft());
  const [shiftDraft, setShiftDraft] = useState(() =>
    createStandardDraft(
      assignedVehicleId,
      snapshot.finance.vehicleOpenings?.[assignedVehicleId],
      (isDriver
        ? linkedVehicles.find((vehicle) => vehicle.id === assignedVehicleId)?.route ??
          linkedVehicles[0]?.route
        : snapshot.vehicles.find((vehicle) => vehicle.id === assignedVehicleId)?.route ??
          snapshot.vehicles[0]?.route) ?? "",
    ),
  );
  const [expenseDraft, setExpenseDraft] = useState(() =>
    createExpenseDraft("asset", assignedVehicleId, snapshot.finance.expenseCatalog),
  );
  const [specialDraft, setSpecialDraft] = useState(() => createSpecialDraft(assignedVehicleId));
  const driverFormRef = useRef(null);
  const allocationFormRef = useRef(null);
  const assignedVehicle = isDriver
    ? linkedVehicles.find((vehicle) => vehicle.id === assignedVehicleId) ?? linkedVehicles[0] ?? null
    : snapshot.vehicles.find((vehicle) => vehicle.id === assignedVehicleId) ?? snapshot.vehicles[0];
  const assignedVehicleRoute = assignedVehicle?.route ?? "";
  const selectedAllocationDriver =
    allocatableDrivers.find((driver) => driver.staffId === allocationDraft.staffId) ?? null;
  const currentAllocationVehicle = selectedAllocationDriver
    ? driverVehicleMap.get(selectedAllocationDriver.staffId) ?? null
    : null;
  const selectedAllocationVehicle =
    allocatableVehicles.find((vehicle) => vehicle.id === allocationDraft.vehicleId) ?? null;
  const displacedDriver =
    selectedAllocationVehicle?.assignedDriverId &&
    selectedAllocationVehicle.assignedDriverId !== selectedAllocationDriver?.staffId
      ? allocatableDrivers.find(
          (driver) => driver.staffId === selectedAllocationVehicle.assignedDriverId,
        ) ?? null
      : null;
  const visibleDefects = isDriver
    ? snapshot.defects.filter(
        (defect) =>
          linkedVehicleIds.has(defect.vehicleId) || linkedVehicleRegistrations.has(defect.vehicle),
      )
    : snapshot.defects;
  const shiftValidationError = getStandardDraftValidationError({
    ...shiftDraft,
    vehicleId: assignedVehicleId,
  });
  const specialValidationError = getSpecialDraftValidationError({
    ...specialDraft,
    vehicleId: assignedVehicleId,
  });
  const shiftTripTotals = getDailyTripLogbookTotals(shiftDraft.tripLogbook);
  const expenseValidationError = getExpenseDraftValidationError({
    ...expenseDraft,
    expenseKind: "asset",
    vehicleId: assignedVehicleId,
  });
  const driverExpenseCategoryOptions = getExpenseCategoryOptions(
    snapshot.finance.expenseCatalog,
    expenseDraft.expenseKind,
    expenseDraft.category,
  );
  const driverExpenseDescriptionOptions = getExpenseDescriptionOptions(
    snapshot.finance.expenseCatalog,
    expenseDraft.expenseKind,
    expenseDraft.category,
  );
  const usesCustomDriverExpenseDescription =
    expenseDraft.category === EXPENSE_OTHER_CATEGORY ||
    expenseDraft.descriptionPreset === EXPENSE_CUSTOM_DESCRIPTION_VALUE ||
    driverExpenseDescriptionOptions.length === 0;
  const driverRouteOptions = useMemo(
    () =>
      [...(snapshot.routes ?? [])].sort((left, right) =>
        String(left.name ?? "").localeCompare(String(right.name ?? "")),
      ),
    [snapshot.routes],
  );
  const selectedDriverRouteNames = useMemo(
    () =>
      driverRouteOptions
        .filter((route) => driverDraft.routeIds.includes(route.id))
        .map((route) => route.name),
    [driverDraft.routeIds, driverRouteOptions],
  );
  const driverDayCashSummary =
    snapshot.driverTerminal?.dayCashSummary ?? createEmptyDriverDayCashSummary();
  const driverOwnedFinanceRecords = useMemo(() => {
    if (!isDriver) {
      return [];
    }

    const activeDriverStaffId = String(snapshot.driverTerminal?.activeDriverId ?? "").trim();

    return [...(snapshot.financeTransactions ?? [])]
      .filter(
        (record) =>
          ["income", "expense"].includes(record?.type) &&
          getFinanceRecordDriverStaffId(record) === activeDriverStaffId,
      )
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  }, [isDriver, snapshot.driverTerminal?.activeDriverId, snapshot.financeTransactions]);
  const shiftEditReasonError = isDriver
    ? getDriverEditReasonError(shiftDraft, "daily taking")
    : null;
  const specialEditReasonError = isDriver
    ? getDriverEditReasonError(specialDraft, "extra trip")
    : null;
  const expenseEditReasonError = isDriver
    ? getDriverEditReasonError(expenseDraft, "expense")
    : null;

  useEffect(() => {
    if (!assignedVehicleId) {
      return;
    }

    setShiftDraft((current) => {
      const nextVehicleId = assignedVehicleId;
      const sameVehicle = current.vehicleId === nextVehicleId;

      return syncStandardDraftTripLogbook({
        ...current,
        vehicleId: nextVehicleId,
        route: assignedVehicleRoute,
        tripLogbook: sameVehicle ? current.tripLogbook : createDailyTripLogbook(assignedVehicleRoute),
        openingOdo:
          sameVehicle && current.openingOdo
            ? current.openingOdo
            : String(snapshot.finance.vehicleOpenings?.[assignedVehicleId] ?? ""),
      });
    });
    setSpecialDraft((current) => ({
      ...current,
      vehicleId: assignedVehicleId,
    }));
    setExpenseDraft((current) => ({
      ...current,
      vehicleId: assignedVehicleId,
    }));
  }, [assignedVehicleId, assignedVehicleRoute, snapshot.finance.vehicleOpenings]);

  useEffect(() => {
    if (!canManageDrivers) {
      return;
    }

    if (!allocatableDrivers.some((driver) => driver.staffId === allocationDraft.staffId)) {
      setAllocationDraft(buildAllocationDraft());
      return;
    }

    if (
      allocationDraft.vehicleId &&
      !allocatableVehicles.some((vehicle) => vehicle.id === allocationDraft.vehicleId)
    ) {
      setAllocationDraft(buildAllocationDraft(allocationDraft.staffId));
    }
  }, [
    allocationDraft.staffId,
    allocationDraft.vehicleId,
    allocatableDrivers,
    allocatableVehicles,
    canManageDrivers,
  ]);

  useEffect(() => {
    if (!shortcutIntent) {
      return;
    }

    if (shortcutIntent.type === "Log shift takings") {
      setDriverAction("shift");
    }
    if (shortcutIntent.type === "Log daily expense") {
      setDriverAction("expense");
    }
    if (shortcutIntent.type === "Capture special trip") {
      setDriverAction("special");
    }
  }, [shortcutIntent]);

  const handleShortcut = (shortcut) => {
    if (shortcut === "Log shift takings") {
      setDriverAction("shift");
      return;
    }
    if (shortcut === "Log daily expense") {
      setDriverAction("expense");
      return;
    }
    if (shortcut === "Capture special trip") {
      setDriverAction("special");
      return;
    }
    onShortcutAction(shortcut);
  };

  const resetDriverShiftDraft = (nextOpeningOdo = snapshot.finance.vehicleOpenings?.[assignedVehicleId]) => {
    setShiftDraft(
      createStandardDraft(
        assignedVehicleId,
        nextOpeningOdo,
        assignedVehicleRoute,
      ),
    );
  };

  const resetDriverSpecialDraft = () => {
    setSpecialDraft(createSpecialDraft(assignedVehicleId));
  };

  const resetDriverExpenseDraft = () => {
    setExpenseDraft(
      createExpenseDraft("asset", assignedVehicleId, snapshot.finance.expenseCatalog),
    );
  };

  const handleShiftSubmit = (event) => {
    event.preventDefault();
    const response = onSaveStandardIncome({
      ...shiftDraft,
      vehicleId: shiftDraft.vehicleId || assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      resetDriverShiftDraft(response.nextOpeningOdo);
      setDriverAction(null);
    }
  };

  const handleSpecialSubmit = (event) => {
    event.preventDefault();
    const response = onSaveSpecialIncome({
      ...specialDraft,
      vehicleId: specialDraft.vehicleId || assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      resetDriverSpecialDraft();
      setDriverAction(null);
    }
  };

  const handleExpenseSubmit = (event) => {
    event.preventDefault();
    const response = onSaveExpense({
      ...expenseDraft,
      expenseKind: "asset",
      vehicleId: expenseDraft.vehicleId || assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      resetDriverExpenseDraft();
      setDriverAction(null);
    }
  };

  const handleEditDriverIncome = (record) => {
    if (record.vehicleId && record.vehicleId !== assignedVehicleId) {
      onSelectDriverVehicle(record.vehicleId);
    }

    if (record.incomeKind === "standard") {
      const route =
        record.route ??
        snapshot.vehicles.find((vehicle) => vehicle.id === record.vehicleId)?.route ??
        assignedVehicleRoute;

      setShiftDraft(
        syncStandardDraftTripLogbook({
          id: record.id,
          vehicleId: record.vehicleId ?? assignedVehicleId,
          route,
          tripDate: record.tripDate ?? toDateInputValue(record.timestamp),
          timeIn: record.timeIn ?? toTimeInputValue(record.timestamp),
          timeOut: record.timeOut ?? "",
          tripLogbook: buildStandardTripLogbookDraft(
            route,
            record.tripLogbook,
            record.amountClaimed ?? record.amount ?? "",
            record.totalPassengers ?? "",
          ),
          openingOdo: String(record.openingOdo ?? ""),
          closingOdo: String(record.closingOdo ?? ""),
          amountClaimed: String(record.amountClaimed ?? record.amount ?? ""),
          editReason: "",
        }),
      );
      setDriverAction("shift");
      return;
    }

    setSpecialDraft({
      id: record.id,
      vehicleId: record.vehicleId ?? assignedVehicleId,
      tripDate: record.tripDate ?? toDateInputValue(record.timestamp),
      openingOdo: String(record.openingOdo ?? ""),
      closingOdo: String(record.closingOdo ?? ""),
      fromLocation: record.fromLocation ?? "",
      toLocation: record.toLocation ?? "",
      travelReason: record.travelReason ?? record.description ?? "",
      fuelOilCost: String(record.fuelOilCost ?? 0),
      repairMaintenanceCost: String(record.repairMaintenanceCost ?? 0),
      amount: String(record.amount ?? ""),
      editReason: "",
    });
    setDriverAction("special");
  };

  const handleEditDriverExpense = (record) => {
    if (record.vehicleId && record.vehicleId !== assignedVehicleId) {
      onSelectDriverVehicle(record.vehicleId);
    }

    setExpenseDraft({
      id: record.id,
      expenseKind: "asset",
      category: record.category ?? "",
      description: record.description ?? "",
      descriptionPreset: getExpenseDescriptionPresetValue(
        snapshot.finance.expenseCatalog,
        "asset",
        record.category ?? "",
        record.description ?? "",
      ),
      expenseDate: record.expenseDate ?? toDateInputValue(record.timestamp),
      reference: record.reference ?? "",
      vehicleId: record.vehicleId ?? assignedVehicleId,
      amount: String(record.amount ?? ""),
      cashExpense: Boolean(record.cashExpense),
      editReason: "",
    });
    setDriverAction("expense");
  };

  const handleDriverCashUp = () => {
    const response = onSubmitDriverCashUp?.();

    if (!response) {
      return;
    }

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  const handleAddDriver = () => {
    setDriverDraft(createDriverDraft());
    setShowDriverForm(true);
    driverFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDriverSubmit = (event) => {
    event.preventDefault();
    const response = onSaveDriver(driverDraft);

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setDriverDraft(createDriverDraft());
      setShowDriverForm(false);
    }
  };

  const handleOpenAllocation = (driver = null) => {
    setAllocationDraft(buildAllocationDraft(driver?.staffId ?? allocatableDrivers[0]?.staffId ?? ""));
    allocationFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleAllocationSubmit = (event) => {
    event.preventDefault();
    const response = onAllocateDriverShift(allocationDraft);

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setAllocationDraft(buildAllocationDraft(response.staffId));
    }
  };

  return (
    <div className="content-stack">
      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      {PRIVILEGED_ROLES.has(activeRole) && (!canEditFinanceRecords || !canEditDriverRecords) && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Management access</p>
            <h3>Some edits are locked</h3>
          </div>
          <p className="panel-note">
            The owner can enable Money and Drivers rights in Settings. Until then this management
            account cannot save daily takings, daily expenses, or change the driver roster here.
          </p>
        </article>
      )}

      {isDriver && linkedVehicles.length > 1 && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Linked vehicles</p>
            <h3>Choose active vehicle</h3>
          </div>
          <div className="finance-sub-switch">
            {linkedVehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                className={
                  vehicle.id === assignedVehicleId ? "finance-sub-pill active" : "finance-sub-pill"
                }
                onClick={() => onSelectDriverVehicle(vehicle.id)}
              >
                {vehicle.registration}
              </button>
            ))}
          </div>
        </article>
      )}

      <div className="two-up">
        <Panel eyebrow="Driver view" title="Terminal preview" icon={LayoutDashboard}>
          <div className="terminal-card">
            <div className="terminal-header">
              <div>
                <p className="eyebrow">Signed in</p>
                <h3>{snapshot.driverTerminal.activeDriver}</h3>
                <p>
                  {snapshot.driverTerminal.assignedVehicle} /{" "}
                  {snapshot.driverTerminal.assignedRoute}
                </p>
              </div>
              <span className="status-chip" data-tone="success">
                <CheckCircle2 size={14} />
                <span>{snapshot.driverTerminal.lastShift.status}</span>
              </span>
            </div>

            <div className="queue-stats">
              <InfoPair
                label="Starting odometer"
                value={`${snapshot.driverTerminal.lastShift.openOdo.toLocaleString()} km`}
              />
              <InfoPair
                label="Ending odometer"
                value={`${snapshot.driverTerminal.lastShift.closeOdo.toLocaleString()} km`}
              />
              <InfoPair
                label="Last revenue"
                value={formatMoney(snapshot.driverTerminal.lastShift.revenue)}
              />
              <InfoPair label="Terminal mode" value="High contrast" />
            </div>

            <div className="shortcut-grid">
              {snapshot.driverTerminal.shortcuts.map((shortcut, index) => (
                <button
                  key={`${shortcut}-${index}`}
                  type="button"
                  className="shortcut-button"
                  onClick={() => handleShortcut(shortcut)}
                >
                  {formatShortcutLabel(shortcut)}
                </button>
              ))}
            </div>

            <DriverCashSummaryBoard
              summary={driverDayCashSummary}
              onSubmitCashUp={handleDriverCashUp}
            />

            {isDriver && (
              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Driver edits</p>
                  <h3>My captured takings and expenses</h3>
                </div>
                <div className="finance-ledger">
                  {driverOwnedFinanceRecords.slice(0, 6).map((record) => (
                    <article key={record.id} className="ledger-row">
                      <div className="ledger-copy">
                        <strong>
                          {record.type === "expense"
                            ? formatExpenseHeadline(record)
                            : record.incomeKind === "special"
                              ? `${record.vehicle} / ${formatTripRoute(record)}`
                              : `${record.vehicle} / ${record.route}`}
                        </strong>
                        <span>
                          {record.type === "expense"
                            ? formatExpenseMeta(record)
                            : record.incomeKind === "special"
                              ? formatTripLogMeta(record)
                              : formatDailyTripMeta(record)}
                        </span>
                        {getRecordLastEditNote(record) && (
                          <span>{getRecordLastEditNote(record)}</span>
                        )}
                      </div>
                      <div className="ledger-meta">
                        <span className="status-chip" data-tone={getTransactionTone(record)}>
                          {formatTransactionStatus(record.status)}
                        </span>
                        <strong>
                          {formatMoney(
                            record.type === "expense"
                              ? record.amount
                              : record.amountClaimed ?? record.amount,
                          )}
                        </strong>
                      </div>
                      <div className="record-actions">
                        <button
                          type="button"
                          className="record-button"
                          disabled={record.status === "banked"}
                          onClick={() =>
                            record.type === "expense"
                              ? handleEditDriverExpense(record)
                              : handleEditDriverIncome(record)
                          }
                        >
                          Edit
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {driverOwnedFinanceRecords.length === 0 && (
                  <p className="panel-note">
                    Your saved takings and expenses will appear here. Use Edit to correct them with
                    a reason note for the owner.
                  </p>
                )}
              </article>
            )}

            {driverAction && (
              <div className="driver-action-panel">
                <div className="overview-board-head">
                  <p className="eyebrow">Quick entry</p>
                  <h3>
                    {(
                      {
                        shift: "Add daily earnings",
                        expense: "Add daily expense",
                        special: "Add extra trip",
                      }[driverAction]
                    ) ?? "Quick entry"}
                  </h3>
                </div>

                {driverAction === "shift" && (
                  <form className="finance-form" onSubmit={handleShiftSubmit}>
                    <div className="finance-form-grid">
                      <label className="finance-field">
                        <span>Vehicle</span>
                        <input type="text" value={assignedVehicle?.registration ?? ""} disabled />
                      </label>
                      <label className="finance-field">
                        <span>Date</span>
                        <input
                          type="date"
                          value={shiftDraft.tripDate}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              tripDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Time in</span>
                        <input
                          type="time"
                          value={shiftDraft.timeIn}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              timeIn: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Time out</span>
                        <input
                          type="time"
                          value={shiftDraft.timeOut}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              timeOut: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Opening odo</span>
                        <input
                          type="number"
                          value={shiftDraft.openingOdo}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              openingOdo: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Closing odo</span>
                        <input
                          type="number"
                          min={Number(shiftDraft.openingOdo || 0) + 1}
                          value={shiftDraft.closingOdo}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              closingOdo: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Total passengers</span>
                        <input
                          type="text"
                          value={shiftTripTotals.totalPassengers.toLocaleString()}
                          disabled
                          readOnly
                        />
                      </label>
                      <label className="finance-field">
                        <span>Total collected</span>
                        <input
                          type="text"
                          value={formatMoney(shiftTripTotals.totalAmount)}
                          disabled
                          readOnly
                        />
                      </label>
                    </div>
                    <DailyTripLogbookFields
                      route={assignedVehicleRoute}
                      tripLogbook={shiftDraft.tripLogbook}
                      onChange={(nextTripLogbook) =>
                        setShiftDraft((current) =>
                          syncStandardDraftTripLogbook({
                            ...current,
                            tripLogbook: nextTripLogbook,
                          }),
                        )
                      }
                    />
                    {shiftDraft.id && (
                      <label className="finance-field finance-field-wide">
                        <span>Update reason</span>
                        <textarea
                          rows="3"
                          value={shiftDraft.editReason}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              editReason: event.target.value,
                            }))
                          }
                        />
                      </label>
                    )}
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="info">
                        Expected opening{" "}
                        {Number(
                          snapshot.finance.vehicleOpenings?.[assignedVehicleId] ?? 0,
                        ).toLocaleString()}{" "}
                        km
                      </span>
                      <span
                        className="status-chip"
                        data-tone={
                          Number(shiftDraft.closingOdo || 0) > Number(shiftDraft.openingOdo || 0)
                            ? "success"
                            : "danger"
                        }
                      >
                        Distance {Math.max(
                          Number(shiftDraft.closingOdo || 0) - Number(shiftDraft.openingOdo || 0),
                          0,
                        ).toLocaleString()} km
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={
                          Boolean(shiftValidationError) ||
                          Boolean(shiftEditReasonError) ||
                          !canUseFinanceCapture
                        }
                      >
                        {shiftDraft.id ? "Update trip" : "Save trip"}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          resetDriverShiftDraft();
                          setDriverAction(null);
                        }}
                      >
                        {shiftDraft.id ? "Cancel edit" : "Cancel"}
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={shiftValidationError || shiftEditReasonError ? "danger" : "info"}
                    >
                      {shiftEditReasonError ??
                        shiftValidationError ??
                        (shiftDraft.id
                          ? "Explain the correction before updating this taking. The owner will see the note in system activity history."
                          : "Passenger trip logbook is complete and ready to save.")}
                    </p>
                  </form>
                )}

                {driverAction === "special" && (
                  <form className="finance-form" onSubmit={handleSpecialSubmit}>
                    <div className="finance-form-grid">
                      <label className="finance-field">
                        <span>Date</span>
                        <input
                          type="date"
                          value={specialDraft.tripDate}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              tripDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Vehicle</span>
                        <input type="text" value={assignedVehicle?.registration ?? ""} disabled />
                      </label>
                      <label className="finance-field">
                        <span>Opening odo</span>
                        <input
                          type="number"
                          value={specialDraft.openingOdo}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              openingOdo: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Closing odo</span>
                        <input
                          type="number"
                          min={Number(specialDraft.openingOdo || 0) + 1}
                          value={specialDraft.closingOdo}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              closingOdo: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Total business km</span>
                        <input type="number" value={getBusinessKmValue(specialDraft)} disabled readOnly />
                      </label>
                      <label className="finance-field">
                        <span>From</span>
                        <input
                          type="text"
                          value={specialDraft.fromLocation}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              fromLocation: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>To</span>
                        <input
                          type="text"
                          value={specialDraft.toLocation}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              toLocation: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field finance-field-wide">
                        <span>Reason</span>
                        <input
                          type="text"
                          value={specialDraft.travelReason}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              travelReason: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Actual fuel & oil cost</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={specialDraft.fuelOilCost}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              fuelOilCost: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Actual repairs & maintenance cost</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={specialDraft.repairMaintenanceCost}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              repairMaintenanceCost: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Amount</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={specialDraft.amount}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                        />
                      </label>
                      {specialDraft.id && (
                        <label className="finance-field finance-field-wide">
                          <span>Update reason</span>
                          <textarea
                            rows="3"
                            value={specialDraft.editReason}
                            onChange={(event) =>
                              setSpecialDraft((current) => ({
                                ...current,
                                editReason: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                    </div>
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="info">
                        SARS-style logbook
                      </span>
                      <span
                        className="status-chip"
                        data-tone={getBusinessKmValue(specialDraft) > 0 ? "success" : "danger"}
                      >
                        Business km {getBusinessKmValue(specialDraft).toLocaleString()} km
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={
                          !canUseFinanceCapture ||
                          Boolean(specialValidationError) ||
                          Boolean(specialEditReasonError)
                        }
                      >
                        {specialDraft.id ? "Update trip" : "Save trip"}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          resetDriverSpecialDraft();
                          setDriverAction(null);
                        }}
                      >
                        {specialDraft.id ? "Cancel edit" : "Cancel"}
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={specialValidationError || specialEditReasonError ? "danger" : "info"}
                    >
                      {specialEditReasonError ??
                        specialValidationError ??
                        (specialDraft.id
                          ? "Explain the correction before updating this extra trip. The owner will see the note in system activity history."
                          : "Extra trip logbook details are complete and ready to save.")}
                    </p>
                  </form>
                )}

                {driverAction === "expense" && (
                  <form className="finance-form" onSubmit={handleExpenseSubmit}>
                    <div className="finance-form-grid">
                      <label className="finance-field">
                        <span>Vehicle</span>
                        <input type="text" value={assignedVehicle?.registration ?? ""} disabled />
                      </label>
                      <label className="finance-field">
                        <span>Category</span>
                        <select
                          value={expenseDraft.category}
                          onChange={(event) =>
                            setExpenseDraft((current) =>
                              syncExpenseDraftCategory(
                                current,
                                snapshot.finance.expenseCatalog,
                                event.target.value,
                              ),
                            )
                          }
                        >
                          {driverExpenseCategoryOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="finance-field finance-field-wide">
                        <span>Description</span>
                        {usesCustomDriverExpenseDescription ? (
                          <input
                            type="text"
                            placeholder={
                              expenseDraft.category === EXPENSE_OTHER_CATEGORY
                                ? "Provide the expense details"
                                : "Fuel top-up, wash bay, rank fee"
                            }
                            value={expenseDraft.description}
                            onChange={(event) =>
                              setExpenseDraft((current) => ({
                                ...current,
                                description: event.target.value,
                                descriptionPreset: EXPENSE_CUSTOM_DESCRIPTION_VALUE,
                              }))
                            }
                          />
                        ) : (
                          <select
                            value={expenseDraft.descriptionPreset}
                            onChange={(event) =>
                              setExpenseDraft((current) =>
                                syncExpenseDraftDescriptionPreset(
                                  current,
                                  event.target.value,
                                ),
                              )
                            }
                          >
                            {driverExpenseDescriptionOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                            <option value={EXPENSE_CUSTOM_DESCRIPTION_VALUE}>Other details</option>
                          </select>
                        )}
                      </label>
                      <label className="finance-field">
                        <span>Expense date</span>
                        <input
                          type="date"
                          value={expenseDraft.expenseDate}
                          onChange={(event) =>
                            setExpenseDraft((current) => ({
                              ...current,
                              expenseDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Receipt no. / reference</span>
                        <input
                          type="text"
                          placeholder="REC-2048"
                          value={expenseDraft.reference}
                          onChange={(event) =>
                            setExpenseDraft((current) => ({
                              ...current,
                              reference: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Amount</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={expenseDraft.amount}
                          onChange={(event) =>
                            setExpenseDraft((current) => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field finance-field-check">
                        <span>Paid from safe</span>
                        <input
                          type="checkbox"
                          checked={expenseDraft.cashExpense}
                          onChange={(event) =>
                            setExpenseDraft((current) => ({
                              ...current,
                              cashExpense: event.target.checked,
                            }))
                          }
                        />
                      </label>
                      {expenseDraft.id && (
                        <label className="finance-field finance-field-wide">
                          <span>Update reason</span>
                          <textarea
                            rows="3"
                            value={expenseDraft.editReason}
                            onChange={(event) =>
                              setExpenseDraft((current) => ({
                                ...current,
                                editReason: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                    </div>
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="warning">
                        Logged against {assignedVehicle?.registration ?? "the assigned vehicle"}
                      </span>
                      <span
                        className="status-chip"
                        data-tone={expenseDraft.category === EXPENSE_OTHER_CATEGORY ? "warning" : "info"}
                      >
                        {expenseDraft.category === EXPENSE_OTHER_CATEGORY
                          ? "Other selected: description details are required"
                          : `${driverExpenseCategoryOptions.length} category options`}
                      </span>
                      <span
                        className="status-chip"
                        data-tone={autoCheckDriverExpenses ? "success" : "warning"}
                      >
                        Status starts as {autoCheckDriverExpenses ? "checked" : "waiting"}
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={
                          !canUseFinanceCapture ||
                          Boolean(expenseValidationError) ||
                          Boolean(expenseEditReasonError)
                        }
                      >
                        {expenseDraft.id ? "Update expense" : "Save expense"}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          resetDriverExpenseDraft();
                          setDriverAction(null);
                        }}
                      >
                        {expenseDraft.id ? "Cancel edit" : "Cancel"}
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={expenseValidationError || expenseEditReasonError ? "danger" : "info"}
                    >
                      {expenseEditReasonError ??
                        expenseValidationError ??
                        (expenseDraft.id
                          ? "Explain the correction before updating this expense. The owner will see the note in system activity history."
                          : "Choose a saved category and description, or use Other and type the full expense details.")}
                    </p>
                  </form>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel eyebrow="People operations" title="Roster and performance" icon={Users}>
          <div className="content-stack">
            {canManageDrivers && (
              <article ref={driverFormRef} className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Roster control</p>
                  <h3>Add driver</h3>
                </div>
                <div className="finance-form-actions">
                    <button
                      type="button"
                      className="action-button primary"
                      disabled={!canManageDrivers}
                      onClick={handleAddDriver}
                    >
                    <Users size={16} />
                    Add driver
                  </button>
                </div>
                {showDriverForm && (
                  <form className="finance-form" onSubmit={handleDriverSubmit}>
                    <div className="finance-form-grid">
                      <label className="finance-field finance-field-wide">
                        <span>Full name</span>
                        <input
                          type="text"
                          value={driverDraft.name}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field finance-field-wide">
                        <span>Email address</span>
                        <input
                          type="email"
                          value={driverDraft.email}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              email: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field finance-field-wide">
                        <span>Assigned routes</span>
                        <select
                          multiple
                          size={Math.min(Math.max(driverRouteOptions.length, 3), 6)}
                          value={driverDraft.routeIds}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              routeIds: Array.from(event.target.selectedOptions, (option) => option.value),
                            }))
                          }
                        >
                          {driverRouteOptions.map((route) => (
                            <option key={route.id} value={route.id}>
                              {route.code ? `${route.code} / ` : ""}
                              {route.name}
                              {route.isActive ? "" : " (Inactive)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="finance-field">
                        <span>Shift status</span>
                        <select
                          value={driverDraft.shiftStatus}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              shiftStatus: event.target.value,
                            }))
                          }
                        >
                          {[
                            "Ready for dispatch",
                            "Available",
                            "On route",
                            "Needs review",
                          ].map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="finance-field">
                        <span>Driver&apos;s license number</span>
                        <input
                          type="text"
                          value={driverDraft.licenseNumber}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              licenseNumber: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>License code</span>
                        <input
                          type="text"
                          value={driverDraft.licenseCode}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              licenseCode: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>License expiry</span>
                        <input
                          type="date"
                          value={driverDraft.licenseExpiryDate}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              licenseExpiryDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>PDP / PrDP number</span>
                        <input
                          type="text"
                          value={driverDraft.prdpNumber}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              prdpNumber: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>PDP / PrDP expiry</span>
                        <input
                          type="date"
                          value={driverDraft.prdpExpiryDate}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              prdpExpiryDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Password</span>
                        <input
                          autoComplete="new-password"
                          type="password"
                          value={driverDraft.accessPassword}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              accessPassword: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="info">
                        Routes {selectedDriverRouteNames.length}
                      </span>
                      <span
                        className="status-chip"
                        data-tone={driverDraft.accessPassword ? "success" : "warning"}
                      >
                        {driverDraft.accessPassword ? "Password set" : "Password required"}
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={!canManageDrivers}
                      >
                        Save driver
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          setDriverDraft(createDriverDraft());
                          setShowDriverForm(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={driverRouteOptions.length === 0 ? "warning" : "info"}
                    >
                      {driverRouteOptions.length === 0
                        ? "Add a route in Fleet & Operations first, then return here to assign the driver."
                        : hasSupabaseConfig && Boolean(supabase)
                          ? "Use Ctrl or Command to select more than one route, then use shift allocation below to place the driver on a vehicle. In live mode, issue the same password on the driver's Supabase sign-in account."
                          : "Use Ctrl or Command to select more than one route, then use shift allocation below to place the driver on a vehicle. The saved password works for local TaxiFlow sign-in."}
                    </p>
                  </form>
                )}
              </article>
            )}
            {canManageDrivers && (
              <article ref={allocationFormRef} className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Shift allocation</p>
                  <h3>Assign driver to vehicle</h3>
                </div>
                <form className="finance-form" onSubmit={handleAllocationSubmit}>
                  <div className="finance-form-grid">
                    <label className="finance-field">
                      <span>Driver</span>
                      <select
                        value={allocationDraft.staffId}
                        onChange={(event) =>
                          setAllocationDraft(buildAllocationDraft(event.target.value))
                        }
                      >
                        {allocatableDrivers.map((driver) => (
                          <option key={driver.staffId} value={driver.staffId}>
                            {driver.name} / {driver.staffId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="finance-field">
                      <span>Vehicle</span>
                      <select
                        value={allocationDraft.vehicleId}
                        onChange={(event) =>
                          setAllocationDraft((current) => ({
                            ...current,
                            vehicleId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {allocatableVehicles.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.registration} / {vehicle.route}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="finance-form-meta">
                    <span className="status-chip" data-tone="info">
                      Current vehicle {currentAllocationVehicle?.registration ?? "Unassigned"}
                    </span>
                    <span
                      className="status-chip"
                      data-tone={selectedAllocationVehicle ? "success" : "warning"}
                    >
                      Next vehicle {selectedAllocationVehicle?.registration ?? "Unassigned"}
                    </span>
                    {displacedDriver && (
                      <span className="status-chip" data-tone="warning">
                        {displacedDriver.name} will be removed from{" "}
                        {selectedAllocationVehicle?.registration}
                      </span>
                    )}
                  </div>
                  <div className="finance-form-actions">
                    <button
                      type="submit"
                      className="action-button primary"
                      disabled={!selectedAllocationDriver || !canManageDrivers}
                    >
                      Save allocation
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => setAllocationDraft(buildAllocationDraft())}
                    >
                      Reset
                    </button>
                  </div>
                  <p className="finance-form-note" data-tone="info">
                    Choose another vehicle to move a driver for the shift. If the vehicle already
                    has a driver, that driver will be removed from it.
                  </p>
                </form>
              </article>
            )}
            <div className="list-stack">
              {filteredDrivers.map((driver) => (
                <article key={driver.staffId ?? driver.name} className="person-row">
                  <div className="person-copy">
                    <h3>{driver.name}</h3>
                    <p>{driver.role} / {getDriverRouteSummary(driver)}</p>
                    {driver.email && <p>{driver.email}</p>}
                    {(driver.licenseNumber || driver.prdpNumber) && (
                      <p>
                        {[
                          driver.licenseNumber ? `Licence ${driver.licenseNumber}` : null,
                          driver.licenseCode ? `Code ${driver.licenseCode}` : null,
                          driver.prdpNumber ? `PrDP ${driver.prdpNumber}` : null,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                    )}
                  </div>
                  <div className="person-metrics">
                    <span
                      className="status-chip"
                      data-tone={driverVehicleMap.has(driver.staffId) ? "success" : "info"}
                    >
                      {driverVehicleMap.get(driver.staffId)?.registration ?? "Unassigned"}
                    </span>
                    <span
                      className="status-chip"
                      data-tone={driver.cashAccuracy >= 98 ? "success" : "warning"}
                    >
                      {driver.cashAccuracy}% accuracy
                    </span>
                    <span
                      className="status-chip"
                      data-tone={driver.licenseDays && driver.licenseDays <= 30 ? "danger" : "info"}
                    >
                      {driver.licenseDays ? `${driver.licenseDays} days licence` : "Licence not set"}
                    </span>
                    <span
                      className="status-chip"
                      data-tone={driver.prdpDays && driver.prdpDays <= 30 ? "danger" : "info"}
                    >
                      {driver.prdpDays ? `${driver.prdpDays} days PrDP` : driver.shiftStatus}
                    </span>
                  </div>
                  {canManageDrivers && driver.role === "Driver" && (
                    <div className="finance-form-actions">
                      <button
                        type="button"
                        className="record-button"
                        disabled={!canManageDrivers}
                        onClick={() => handleOpenAllocation(driver)}
                      >
                        {driverVehicleMap.has(driver.staffId) ? "Change vehicle" : "Assign vehicle"}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Maintenance handoff" title="Live defect feed" icon={AlertTriangle}>
        <div className="queue-grid">
          {visibleDefects.map((defect, index) => (
            <article
              key={defect.id ?? `${defect.vehicle}-${defect.issue}-${index}`}
              className="queue-card"
            >
              <div className="queue-header">
                <div>
                  <h3>{defect.vehicle}</h3>
                  <p>{defect.issue}</p>
                </div>
                <span className="status-chip" data-tone={getDefectTone(defect.severity)}>
                  {defect.severity}
                </span>
              </div>

              <div className="queue-stats">
                <InfoPair label="Reported" value={defect.reportedAtLabel ?? defect.reportedAt} />
                <InfoPair label="Status" value={defect.statusLabel ?? defect.status} />
                <InfoPair label="Estimate" value={formatMoney(defect.costEstimate)} />
                <InfoPair label="Owner" value="Fleet Manager" />
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function SignInShell({
  fleetName,
  authProviderLabel,
  isLocalAuth,
  email,
  password,
  error,
  submitting,
  onChange,
  onRequestPasswordReset,
  onSubmit,
  passwordResetFeedback,
}) {
  const [showForgotPasswordHelp, setShowForgotPasswordHelp] = useState(false);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-lockup auth-brand">
          <img className="brand-logo auth-logo" src="/taxiflow-logo.png" alt="TaxiFlow logo" />
        </div>
        <div className="auth-copy">
          <p className="eyebrow">Secure access</p>
          <h1>{fleetName}</h1>
          <p>Sign in to open the workspace assigned to your designation and access level.</p>
          <span className="auth-provider-note">{authProviderLabel}</span>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="finance-field">
            <span>Email</span>
            <input
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
          </label>
          <label className="finance-field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </label>
          <div className="finance-form-actions">
            <button type="submit" className="action-button primary" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </button>
            <button
              type="button"
              className="action-button"
              aria-controls="auth-recovery-note"
              aria-expanded={showForgotPasswordHelp}
              onClick={() => setShowForgotPasswordHelp((current) => !current)}
            >
              Forgot password?
            </button>
          </div>
          {showForgotPasswordHelp && (
            <div id="auth-recovery-note" className="backend-mode-panel">
              <div className="backend-mode-head">
                <Lock size={16} />
                <div>
                  <strong>Password reset support</strong>
                </div>
              </div>
              <p className="backend-mode-note">
                Management will reset the password for this account. TaxiFlow sends both the
                in-app management notice in Settings and the management email queue, and a repeat
                request rebuilds any missing channel.
              </p>
              <div className="backend-mode-actions">
                <button
                  type="button"
                  className="action-button"
                  onClick={onRequestPasswordReset}
                  disabled={submitting || !String(email ?? "").trim()}
                >
                  Send reset request
                </button>
              </div>
              <p
                className="finance-form-note"
                data-tone={passwordResetFeedback?.tone ?? "warning"}
              >
                {passwordResetFeedback?.message ??
                  "Only management can recreate TaxiFlow access. They will reset the password after TaxiFlow sends the in-app and email notices."}
              </p>
            </div>
          )}
          <p className="finance-form-note" data-tone={error ? "danger" : "info"}>
            {error ??
              (isLocalAuth
                ? "Use the password assigned to your TaxiFlow account. Older local accounts still use the default TaxiFlow password."
                : "Use the Supabase account issued for your TaxiFlow role. Access is routed by designation.")}
          </p>
        </form>
      </div>
    </div>
  );
}

function AccessDeniedShell({ email, onSignOut }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="panel-icon">
          <Lock size={20} />
        </div>
        <div className="auth-copy">
          <p className="eyebrow">Access blocked</p>
          <h1>Account not mapped</h1>
          <p>
            {email} signed in successfully, but this account is not linked to an application role
            yet.
          </p>
        </div>
        <div className="finance-form-actions">
          <button type="button" className="action-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function DriverCashSummaryBoard({ summary, onSubmitCashUp }) {
  const hasEntries = (summary?.entryCount ?? 0) > 0;
  const expectedCashTone =
    (summary?.expectedCashIn ?? 0) < 0
      ? "danger"
      : (summary?.expectedCashIn ?? 0) > 0
        ? "success"
        : "info";

  return (
    <article className="overview-board">
      <div className="overview-board-head">
        <p className="eyebrow">Driver cash view</p>
        <h3>Day cash activity</h3>
      </div>

      <div className="queue-stats">
        <InfoPair label="Work date" value={summary?.workDateLabel ?? formatDateOnly(new Date())} />
        <InfoPair label="Income" value={formatMoney(summary?.totalIncome ?? 0)} />
        <InfoPair label="Expenses" value={formatMoney(summary?.totalExpenses ?? 0)} />
        <InfoPair label="Cash expenses" value={formatMoney(summary?.cashExpenses ?? 0)} />
        <InfoPair label="Expected cash in" value={formatMoney(summary?.expectedCashIn ?? 0)} />
      </div>

      <div className="finance-form-meta">
        <span className="status-chip" data-tone={expectedCashTone}>
          {formatMoney(summary?.expectedCashIn ?? 0)} expected cash in
        </span>
        <span className="status-chip" data-tone={summary?.cashUpRecord ? "success" : "info"}>
          {summary?.cashUpRecord
            ? `Checking sent ${formatStamp(summary.cashUpRecord.checkedAt ?? summary.cashUpRecord.updatedAt ?? summary.cashUpRecord.createdAt)}`
            : "Checking not sent yet"}
        </span>
        <span className="status-chip" data-tone="info">
          {(summary?.entryCount ?? 0).toLocaleString()} activity entries
        </span>
      </div>

      {hasEntries ? (
        <div className="finance-ledger">
          {(summary?.entries ?? []).slice(0, 5).map((entry) => (
            <article key={entry.id} className="ledger-row">
              <div className="ledger-copy">
                <strong>{entry.title}</strong>
                <span>{entry.subtitle}</span>
              </div>
              <div className="ledger-meta">
                <span className="status-chip" data-tone={entry.tone}>
                  {entry.ledgerLabel}
                </span>
                <strong>{entry.amountLabel}</strong>
                <span>{entry.statusLabel}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="panel-note">
          Save trip income or expense entries first to build the day cash activity view.
        </p>
      )}

      <div className="finance-form-actions">
        <button
          type="button"
          className="action-button primary"
          disabled={!hasEntries || !onSubmitCashUp}
          onClick={onSubmitCashUp}
        >
          Checking
        </button>
      </div>
      <p className="finance-form-note" data-tone={hasEntries ? "info" : "warning"}>
        {hasEntries
          ? "Checking wraps up the current day and sends management one day hand-in total."
          : "No income or expense activity is ready for day checking yet."}
      </p>
    </article>
  );
}

function InsightCard({ title, metric, meta, icon: Icon, tone, children }) {
  return (
    <article className="insight-card" data-tone={tone}>
      <div className="insight-head">
        <div>
          <p className="eyebrow">{title}</p>
          <strong>{metric}</strong>
          <span>{meta}</span>
        </div>
        <div className="panel-icon">
          <Icon size={18} />
        </div>
      </div>
      <div className="insight-visual">{children}</div>
    </article>
  );
}

function MiniBars({ items, tone = "info" }) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="mini-bars">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="mini-bar-group">
          <div className="mini-bar-track vertical">
            <div
              className="mini-bar-fill"
              data-tone={tone}
              style={{ height: `${Math.max((item.value / maxValue) * 100, 12)}%` }}
            />
          </div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function MiniCompareChart({ items }) {
  const maxValue = Math.max(
    ...items.flatMap((item) => [item.primary, item.secondary]),
    1,
  );

  return (
    <div className="mini-bars compare">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="mini-bar-group">
          <div className="mini-bar-track vertical compare">
            <div
              className="mini-bar-fill secondary"
              data-tone="info"
              style={{ height: `${Math.max((item.secondary / maxValue) * 100, 12)}%` }}
            />
            <div
              className="mini-bar-fill primary"
              data-tone="success"
              style={{ height: `${Math.max((item.primary / maxValue) * 100, 12)}%` }}
            />
          </div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function SegmentMeter({ segments }) {
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.value, 0),
    1,
  );

  return (
    <div className="segment-meter">
      <div className="segment-bar">
        {segments.map((segment, index) => (
          <span
            key={`${segment.label}-${index}`}
            className="segment-piece"
            data-tone={segment.tone}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="segment-legend">
        {segments.map((segment, index) => (
          <span key={`${segment.label}-${index}`} className="segment-label">
            <i data-tone={segment.tone} />
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RingMeter({ value, total, label, tone, sublabel }) {
  const progress = Math.max(Math.min((value / Math.max(total, 1)) * 360, 360), 0);
  const colorMap = {
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    info: "var(--info)",
    navy: "var(--navy)",
  };

  return (
    <div className="ring-wrap">
      <div
        className="ring-meter"
        style={{
          background: `conic-gradient(${colorMap[tone] ?? "var(--info)"} ${progress}deg, rgba(11, 37, 69, 0.08) ${progress}deg 360deg)`,
        }}
      >
        <div className="ring-core">
          <strong>{label}</strong>
        </div>
      </div>
      {sublabel && <span className="ring-subtitle">{sublabel}</span>}
    </div>
  );
}

function CompactFeedItem({ title, subtitle, meta, tone }) {
  return (
    <article className="compact-feed-item">
      <div className="compact-feed-head">
        <div>
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>
        <span className="compact-badge" data-tone={tone}>
          {toneLabel[tone]}
        </span>
      </div>
      <span className="compact-meta">{meta}</span>
    </article>
  );
}

function FlowLane({ owner, title, tone }) {
  return (
    <article className="flow-lane" data-tone={tone}>
      <span>{owner}</span>
      <strong>{title}</strong>
    </article>
  );
}

function FinanceModeButton({ active, label, meta, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      className={active ? "finance-mode-button active" : "finance-mode-button"}
      onClick={onClick}
    >
      <div className="finance-mode-head">
        <div className="module-button-icon">
          <Icon size={16} />
        </div>
      </div>
      <span className="module-button-label">{label}</span>
      <span className="module-button-sub">{meta}</span>
    </button>
  );
}

function ModuleButton({ active, icon: Icon, label, stat, sub, onClick }) {
  return (
    <button
      type="button"
      className={active ? "module-button active" : "module-button"}
      onClick={onClick}
    >
      <div className="module-button-head">
        <div className="module-button-icon">
          <Icon size={18} />
        </div>
        {stat && <strong>{stat}</strong>}
      </div>
      <span className="module-button-label">{label}</span>
      {sub && <span className="module-button-sub">{sub}</span>}
    </button>
  );
}

function Panel({ eyebrow, title, icon: Icon, children }) {
  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="panel-icon">
          <Icon size={18} />
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }) {
  return (
    <article className="metric-card" data-tone={tone}>
      <div className="metric-head">
        <span>{label}</span>
        <div className="metric-icon">
          <Icon size={16} />
        </div>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function StatusRow({ title, detail, meta, tone }) {
  return (
    <article className="status-row">
      <div className="status-copy">
        <div className="status-title-row">
          <h3>{title}</h3>
          <span className="status-chip" data-tone={tone}>
            {toneLabel[tone]}
          </span>
        </div>
        <p>{detail}</p>
      </div>
      <span className="status-meta">{meta}</span>
    </article>
  );
}

function TimelineRow({ title, detail }) {
  return (
    <article className="timeline-row">
      <div className="timeline-dot" />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function InfoPair({ label, value }) {
  return (
    <div className="info-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
