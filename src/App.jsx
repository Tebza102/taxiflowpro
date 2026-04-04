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
  "driver.one@taxiflow.local": {
    name: "Sizwe Mokoena",
    role: "Driver",
    actorId: "drv-01",
  },
  "driver.two@taxiflow.local": {
    name: "Thabo Ndlovu",
    role: "Driver",
    actorId: "drv-02",
  },
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
    label: "Fleet",
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
    label: "Fleet",
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
    roles: ["Owner"],
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
    label: "Fleet",
    icon: Activity,
    roles: ROLES,
  },
  { id: "drivers", label: "Drivers", icon: Users, roles: ROLES },
  { id: "settings", label: "Settings", icon: Settings2, roles: ["Owner"] },
];

const formatMoney = (value) => ZAR.format(value ?? 0);

const DEFECT_CATEGORIES = ["Windscreen", "Tires", "Seats", "Engine", "Other"];

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

const canEditModuleUpdates = (role, moduleKey, permissionControls) => {
  if (role === "Owner" || role === "Manager") {
    return true;
  }

  if (role === "Admin") {
    return Boolean(permissionControls?.[moduleKey]?.active);
  }

  return false;
};

const getModuleAccessErrorMessage = (moduleKey) =>
  `Admin cannot change ${MODULE_EDIT_ACCESS[moduleKey]?.label?.toLowerCase() ?? moduleKey} records until a manager receives owner approval and grants access.`;

const normalizeRole = (value) =>
  ROLES.find((role) => role.toLowerCase() === String(value ?? "").trim().toLowerCase()) ?? null;

const createDefaultModuleViewAccess = (role) => {
  const normalizedRole = normalizeRole(role) ?? "Driver";

  if (normalizedRole === "Owner") {
    return Object.fromEntries(Object.keys(MODULE_VIEW_ACCESS).map((moduleKey) => [moduleKey, true]));
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
        return [moduleKey, normalizedRole === "Owner"];
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
  const usedEmails = new Set();
  const accountByActorId = new Map(
    Object.entries(AUTH_ACCOUNT_DIRECTORY).map(([email, account]) => [account.actorId, { email, ...account }]),
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
    const email = mappedAccount?.email ?? createGeneratedLocalEmail(driver.name, usedEmails);

    pushUser({
      email,
      name: driver.name,
      role: normalizeRole(driver.role) ?? "Driver",
      actorId: mappedAccount?.actorId ?? driver.staffId,
      staffId: driver.staffId,
      createdAt: driver.createdAt ?? null,
      createdBy: driver.createdBy ?? null,
      createdByRole: driver.createdByRole ?? null,
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
    const account = AUTH_ACCOUNT_DIRECTORY[String(email ?? "").trim().toLowerCase()] ?? null;

    return email ? createLocalAuthSession(email, account) : null;
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

const createDailyTripLogEntry = (routeValue, entry = {}) => {
  const routeStops = getRouteStops(routeValue);

  return {
    id: entry.id ?? createRecordId("trip-leg"),
    fromLocation: entry.fromLocation ?? routeStops.fromLocation,
    toLocation: entry.toLocation ?? routeStops.toLocation,
    passengerCount:
      entry.passengerCount != null && entry.passengerCount !== ""
        ? String(entry.passengerCount)
        : "",
    amountCollected:
      entry.amountCollected != null && entry.amountCollected !== ""
        ? String(entry.amountCollected)
        : "",
  };
};

const createDailyTripLogbook = (routeValue, entries = []) =>
  Array.isArray(entries) && entries.length > 0
    ? entries.map((entry) => createDailyTripLogEntry(routeValue, entry))
    : [createDailyTripLogEntry(routeValue)];

const getDailyTripLogbookTotals = (entries = []) => {
  const safeEntries = Array.isArray(entries) ? entries : [];

  return safeEntries.reduce(
    (totals, entry) => {
      const passengerCount = Number(entry?.passengerCount ?? 0);
      const amountCollected = Number(entry?.amountCollected ?? 0);

      return {
        tripCount: totals.tripCount + 1,
        totalPassengers:
          totals.totalPassengers +
          (Number.isFinite(passengerCount) && passengerCount > 0 ? passengerCount : 0),
        totalAmount:
          totals.totalAmount +
          (Number.isFinite(amountCollected) && amountCollected > 0 ? amountCollected : 0),
      };
    },
    {
      tripCount: 0,
      totalPassengers: 0,
      totalAmount: 0,
    },
  );
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
    amountClaimed: totals.totalAmount > 0 ? String(totals.totalAmount) : "",
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
  const openingOdo = Number(record?.openingOdo ?? 0);
  const closingOdo = Number(record?.closingOdo ?? 0);
  const businessKm = closingOdo - openingOdo;

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
    getDailyTripPassengerTotal(record) > 0
      ? `${getDailyTripPassengerTotal(record).toLocaleString()} passengers`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");

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
          detail: `${driver.staffId} / ${driver.route}`,
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
          detail: `${driver.staffId} / ${driver.route}`,
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
  const drivers = (source.drivers ?? []).map((driver) => {
    const staffId = driver.staffId ?? driver.id ?? driver.name;
    const prdpDays =
      driver.prdpExpiryDate != null
        ? getDaysLeft(driver.prdpExpiryDate, currentDate)
        : driver.prdpDays ?? null;

    return {
      ...driver,
      staffId,
      prdpDays,
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
    const serviceIntervalKm = Number(
      vehicle.serviceIntervalKm ?? source.profile.serviceIntervalKm ?? 10000,
    );
    const lastServiceOdo = Number(
      vehicle.lastServiceOdo ??
        (vehicle.nextServiceAt != null ? vehicle.nextServiceAt - serviceIntervalKm : 0),
    );
    const kmsRemaining =
      lastServiceOdo + serviceIntervalKm - Number(vehicle.currentOdometer ?? 0);
    const permitDays =
      vehicle.permitExpiryDate != null
        ? getDaysLeft(vehicle.permitExpiryDate, currentDate)
        : vehicle.permitDays ?? 365;
    const discDays =
      vehicle.discExpiryDate != null
        ? getDaysLeft(vehicle.discExpiryDate, currentDate)
        : vehicle.discDays ?? 365;
    const minimumDocumentDays = Math.min(permitDays, discDays);
    const defectsOpen = openDefectsByVehicle.get(vehicle.id) ?? vehicle.defectsOpen ?? 0;
    const assignedDriverId =
      vehicle.assignedDriverId ??
      drivers.find((driver) => driver.name === vehicle.assignedDriver)?.staffId ??
      null;
    const assignedDriver = assignedDriverId ? driverMap.get(assignedDriverId) : null;
    const healthState = getVehicleHealthState({
      status: vehicle.status,
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
      ...vehicle,
      status: vehicle.status ?? "active",
      assignedDriverId,
      assignedDriver: assignedDriver?.name ?? "Unassigned",
      assignedDriverStaff: assignedDriver ?? null,
      currentOdometer: Number(vehicle.currentOdometer ?? 0),
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
      archivedAt: vehicle.archivedAt ?? null,
    };
  });

  const transactions = [...(source.financeTransactions ?? [])].sort(
    (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
  );
  const deposits = [...(source.deposits ?? [])].sort(
    (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
  );
  const activeIncomeBatch = transactions.filter(
    (record) => record.type === "income" && record.status !== "banked",
  );
  const verifiedIncome = transactions.filter(
    (record) => record.type === "income" && record.status === "verified",
  );
  const countedIncome = transactions.filter(
    (record) =>
      record.type === "income" &&
      ["counted", "verified", "banked"].includes(record.status) &&
      record.actualCashReceived != null,
  );
  const activeCountedIncome = countedIncome.filter((record) => record.status !== "banked");
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
  const bankableCash =
    sumBy(verifiedIncome, getIncomeCashValue) -
    sumBy(
      verifiedExpenses.filter((record) => record.cashExpense),
      (record) => record.amount,
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

  const verificationQueue = activeIncomeBatch
    .map((record) => {
      const assignedDriver =
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
      };
    })
    .slice(0, 8);

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
  const lockableTransactions = transactions.filter((record) => record.status === "verified");
  const nextReference = buildDepositReference(deposits.length + 1);
  const batchReference =
    lockableTransactions.length > 0 ? nextReference : deposits[0]?.reference ?? nextReference;
  const latestVerifiedTimestamp = lockableTransactions[0]?.timestamp;
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
  ].sort((left, right) => left.daysLeft - right.daysLeft);
  const activeDriver = drivers.find((driver) => driver.staffId === resolvedDriverId) ?? drivers[0];
  const linkedVehicleRecords = enrichedVehicles.filter(
    (vehicle) => vehicle.assignedDriverId === activeDriver?.staffId,
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
        activeCountedIncome,
        (record) => record.actualCashReceived,
      ),
      pendingCashInSafe: bankableCash,
      verifiedToday: verifiedIncome.length,
      shiftsAwaitingVerification: transactions.filter(
        (record) =>
          record.type === "income" && !["verified", "banked"].includes(record.status),
      ).length,
      handoversAwaitingAdmin: transactions.filter(
        (record) => record.type === "income" && record.status === "pending",
      ).length,
      checksAwaitingManager: transactions.filter(
        (record) => record.type === "income" && record.status === "counted",
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
      bankingBatch: {
        ...source.finance?.bankingBatch,
        reference: batchReference,
        verifiedTakings: sumBy(verifiedIncome, getIncomeCashValue),
        cashExpenses: sumBy(
          verifiedExpenses.filter((record) => record.cashExpense),
          (record) => record.amount,
        ),
        depositAmount: bankableCash,
        depositSlip: {
          generatedAt:
            lockableTransactions.length > 0
              ? formatStamp(latestVerifiedTimestamp)
              : deposits[0]?.timestamp
                ? formatStamp(deposits[0].timestamp)
                : "Ready to lock",
          teller: source.finance?.bankingBatch?.depositSlip?.teller ?? "Bank teller pending",
          recordsLocked: lockableTransactions.length,
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
    return "Add at least one passenger trip to the daily logbook.";
  }

  for (const [index, entry] of tripLogbook.entries()) {
    const fromLocation = String(entry?.fromLocation ?? "").trim();
    const toLocation = String(entry?.toLocation ?? "").trim();
    const passengerCount = Number(entry?.passengerCount);
    const amountCollected = Number(entry?.amountCollected);

    if (!fromLocation || !toLocation) {
      return `Complete the from and to stops for trip ${index + 1}.`;
    }
    if (fromLocation.toLowerCase() === toLocation.toLowerCase()) {
      return `Trip ${index + 1} must use two different stops.`;
    }
    if (!Number.isInteger(passengerCount) || passengerCount <= 0) {
      return `Enter the passenger count for trip ${index + 1}.`;
    }
    if (!Number.isFinite(amountCollected) || amountCollected <= 0) {
      return `Enter the amount collected for trip ${index + 1}.`;
    }
  }

  if (getDailyTripLogbookTotals(tripLogbook).totalAmount <= 0) {
    return "The daily trip total must be greater than zero.";
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
});

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

const createExpenseDraft = (expenseKind, vehicleId) => ({
  id: null,
  expenseKind,
  category: expenseKind === "asset" ? "Fuel" : "Salary",
  description: "",
  expenseDate: toDateInputValue(),
  reference: "",
  vehicleId: vehicleId ?? "",
  amount: "",
  cashExpense: true,
});

const createVehicleDraft = (vehicle, defaultInterval) => ({
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
});

const createDriverDraft = (driver) => ({
  staffId: driver?.staffId ?? "",
  name: driver?.name ?? "",
  route: driver?.route ?? "",
  shiftStatus: driver?.shiftStatus ?? "Ready for dispatch",
  prdpExpiryDate: driver?.prdpExpiryDate ?? "",
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
  const [authDraft, setAuthDraft] = useState({
    email: "",
    password: "",
  });

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
    canEditModuleUpdates(activeRole, moduleKey, getPermissionControls(current));

  const handleAuthSubmit = async (event) => {
    event.preventDefault();

    setAuthSubmitting(true);
    setAuthError(null);

    const normalizedEmail = authDraft.email.trim().toLowerCase();

    if (!authEnabled) {
      const account = getAppUserByEmail(currentSnapshot, normalizedEmail);

      if (!account) {
        setAuthError("This email is not assigned to a TaxiFlow account.");
        setAuthSubmitting(false);
        return;
      }

      if (authDraft.password !== LOCAL_AUTH_PASSWORD) {
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

  const handleSignOut = async () => {
    setAuthSubmitting(true);

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
        onChange={setAuthDraft}
        onSubmit={handleAuthSubmit}
        password={authDraft.password}
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
      const nextUser = normalizeAppUser({
        ...existingUser,
        role: nextRole,
        moduleAccess: normalizeModuleViewAccess(draft.moduleAccess, nextRole),
        updatedAt: timestamp,
        updatedBy: actorId,
        updatedByRole: activeRole,
      });
      const nextUsers = sortAppUsers(
        currentUsers.map((user) => (user.email === existingUser.email ? nextUser : normalizeAppUser(user))),
      );
      const enabledModules = SETTINGS_ASSIGNABLE_MODULES.filter(
        (moduleKey) => nextUser.moduleAccess[moduleKey],
      ).map((moduleKey) => MODULE_VIEW_ACCESS[moduleKey].label);

      result = {
        ok: true,
        message: `${nextUser.name} updated as ${nextUser.role}.`,
      };

      return {
        ...current,
        appUsers: nextUsers,
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
            ].join(" / "),
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

      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (existing?.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
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
        result = { ok: false, error: "Add at least one passenger trip to the daily logbook." };
        return current;
      }

      const normalizedTripLogbook = [];
      for (const [index, entry] of tripLogbook.entries()) {
        const fromLocation = String(entry?.fromLocation ?? "").trim();
        const toLocation = String(entry?.toLocation ?? "").trim();
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
        if (!Number.isInteger(passengerCount) || passengerCount <= 0) {
          result = { ok: false, error: `Enter the passenger count for trip ${index + 1}.` };
          return current;
        }
        if (!Number.isFinite(amountCollected) || amountCollected <= 0) {
          result = { ok: false, error: `Enter the amount collected for trip ${index + 1}.` };
          return current;
        }

        normalizedTripLogbook.push({
          id: entry.id ?? createRecordId("trip-leg"),
          fromLocation,
          toLocation,
          passengerCount,
          amountCollected,
        });
      }

      const tripLogTotals = getDailyTripLogbookTotals(normalizedTripLogbook);
      const amountClaimed = tripLogTotals.totalAmount;
      if (amountClaimed <= 0) {
        result = { ok: false, error: "The daily trip total must be greater than zero." };
        return current;
      }

      const expectedOpening = getExpectedOpeningOdo(
        current.financeTransactions ?? [],
        current.vehicles ?? [],
        draft.vehicleId,
        draft.id ?? null,
      );
      const nextRecord = {
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
        amountClaimed,
        actualCashReceived: null,
        amount: amountClaimed,
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
          )}`,
        }),
      ]);

      result = {
        ok: true,
        message: nextRecord.discrepancy
          ? "Trip saved and added to the daily total, but the opening odometer does not match the last record."
          : "Trip saved, added to the daily total, and waiting for admin cash hand-in.",
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

      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (existing?.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
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

      const nextRecord = {
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
        fromLocation,
        toLocation,
        travelReason,
        fuelOilCost,
        repairMaintenanceCost,
        amount,
        amountClaimed: amount,
        actualCashReceived: null,
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
          )}`,
        }),
      ]);

      result = {
        ok: true,
        message: "Extra trip saved, added to the daily total, and waiting for admin cash hand-in.",
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
      const status = PRIVILEGED_ROLES.has(activeRole) ? "verified" : "pending";
      const now = new Date().toISOString();
      const expenseDate = String(draft.expenseDate ?? "").trim();
      const description = draft.description?.trim() ?? "";
      const reference = draft.reference?.trim() ?? "";
      const actorId = resolveCurrentActorId(current);
      const isUpdate = Boolean(existing);

      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (existing?.status === "banked") {
        result = { ok: false, error: "Deposited records can no longer be changed." };
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

      const nextRecord = {
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
          }`,
        }),
      ]);

      result = {
        ok: true,
        message:
          status === "verified"
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

  const verifyIncome = (transactionId, actualCashReceived) => {
    let result = { ok: false, error: "Unable to update this cash hand-in record." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const amount = Number(actualCashReceived);
      const target = current.financeTransactions.find((record) => record.id === transactionId);
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);

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

      const lockableTransactions = current.financeTransactions.filter(
        (record) => record.status === "verified",
      );

      if (!hasModuleUpdateAccess(current, "finance")) {
        result = { ok: false, error: getModuleAccessErrorMessage("finance") };
        return current;
      }
      if (lockableTransactions.length === 0) {
        return current;
      }

      const now = new Date();
      const actorId = resolveCurrentActorId(current);
      const depositId = `dep-${now.getTime()}`;
      const reference = buildDepositReference((current.deposits?.length ?? 0) + 1, now);
      const verifiedTakings = sumBy(
        lockableTransactions.filter((record) => record.type === "income"),
        getIncomeCashValue,
      );
      const cashExpenses = sumBy(
        lockableTransactions.filter(
          (record) => record.type === "expense" && record.cashExpense,
        ),
        (record) => record.amount,
      );
      const depositRecord = {
        depositId,
        reference,
        timestamp: now.toISOString(),
        recordsLocked: lockableTransactions.length,
        verifiedTakings,
        cashExpenses,
        depositAmount: verifiedTakings - cashExpenses,
        transactionIds: lockableTransactions.map((record) => record.id),
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
          detail: `${lockableTransactions.length} records / ${formatMoney(
            depositRecord.depositAmount,
          )}`,
        }),
      ]);

      result = {
        ok: true,
        message: `${lockableTransactions.length} manager-checked records were added to ${reference}.`,
        reference,
      };

      return {
        ...current,
        deposits: [depositRecord, ...(current.deposits ?? [])],
        financeTransactions: current.financeTransactions.map((record) =>
          record.status === "verified"
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
      if (!draft.registration?.trim() || !draft.model?.trim() || !draft.route?.trim()) {
        result = { ok: false, error: "Registration, model, and route are required." };
        return current;
      }

      const existing = current.vehicles.find((vehicle) => vehicle.id === draft.id);
      const assignedDriver =
        draft.assignedDriverId != null && draft.assignedDriverId !== ""
          ? current.drivers.find((driver) => driver.staffId === draft.assignedDriverId)
          : null;
      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "fleet")) {
        result = { ok: false, error: getModuleAccessErrorMessage("fleet") };
        return current;
      }
      if (draft.assignedDriverId && !assignedDriver) {
        result = { ok: false, error: "Select a valid driver for this vehicle." };
        return current;
      }
      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextVehicle = {
        ...existing,
        id: draft.id ?? createRecordId("veh"),
        registration: draft.registration.trim().toUpperCase(),
        model: draft.model.trim(),
        route: draft.route.trim(),
        status: draft.status ?? "active",
        utilisation: Number(draft.utilisation ?? 0),
        currentOdometer: Number(draft.currentOdometer ?? 0),
        lastServiceOdo: Number(draft.lastServiceOdo ?? 0),
        serviceIntervalKm: Number(draft.serviceIntervalKm ?? current.profile.serviceIntervalKm),
        permitExpiryDate: draft.permitExpiryDate || null,
        discExpiryDate: draft.discExpiryDate || null,
        assignedDriverId: draft.assignedDriverId || null,
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
      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "drivers")) {
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
      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "drivers")) {
        result = { ok: false, error: getModuleAccessErrorMessage("drivers") };
        return current;
      }
      if (!draft.name?.trim() || !draft.route?.trim()) {
        result = { ok: false, error: "Driver name and route are required." };
        return current;
      }

      const now = new Date().toISOString();
      const actorId = resolveCurrentActorId(current);
      const nextDriver = {
        staffId: draft.staffId?.trim() || createRecordId("drv"),
        name: draft.name.trim(),
        route: draft.route.trim(),
        shiftStatus: draft.shiftStatus ?? "Ready for dispatch",
        avgShiftRevenue: 0,
        cashAccuracy: 100,
        prdpExpiryDate: draft.prdpExpiryDate || null,
        role: "Driver",
        createdAt: now,
        createdBy: actorId,
        createdByRole: activeRole,
        updatedAt: null,
        updatedBy: null,
        updatedByRole: null,
      };
      const nextAuditTrail = appendAuditTrail(current.auditTrail, [
        buildCurrentAuditEvent(current, {
          timestamp: now,
          scope: "drivers",
          action: "create",
          entityType: "driver",
          entityId: nextDriver.staffId,
          title: `Driver created / ${nextDriver.name}`,
          detail: `${nextDriver.staffId} / ${nextDriver.route}`,
        }),
      ]);

      result = {
        ok: true,
        message: `${nextDriver.name} added to the driver roster.`,
        staffId: nextDriver.staffId,
      };

      return {
        ...current,
        drivers: [nextDriver, ...(current.drivers ?? [])],
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
      if (!["Owner", "Admin"].includes(activeRole)) {
        result = { ok: false, error: "Only Admin or Owner can archive vehicles." };
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
      if (activeRole === "Admin" && !hasModuleUpdateAccess(current, "fleet")) {
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
      sub: activeRole === "Driver" ? "My vehicle" : "Visible fleet",
    },
    drivers: {
      stat: `${activeDrivers}`,
      sub: "Active drivers",
    },
    settings: {
      stat: `${appUsers.length}`,
      sub: "User access",
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
                src="/taxiflow-favicon.png"
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
              permissionControls={permissionControls}
              onNavigate={setActiveView}
              onSaveStandardIncome={saveStandardIncome}
              onSaveSpecialIncome={saveSpecialIncome}
              onSaveExpense={saveExpense}
              onVerifyIncome={verifyIncome}
              onDeleteTransaction={deleteTransaction}
              onLockDeposit={lockDeposit}
            />
          )}
          {activeView === "fleet" && (
            <FleetPanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              permissionControls={permissionControls}
              onSaveVehicle={saveVehicleProfile}
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
              permissionControls={permissionControls}
              onShortcutAction={handleDriverShortcut}
              shortcutIntent={driverShortcutIntent}
              onSaveStandardIncome={saveStandardIncome}
              onSaveSpecialIncome={saveSpecialIncome}
              onSaveExpense={saveExpense}
              onSaveDriver={saveDriver}
              onAllocateDriverShift={allocateDriverShift}
              onSelectDriverVehicle={selectDriverVehicle}
            />
          )}
          {activeView === "settings" && (
            <SettingsPanel
              snapshot={currentSnapshot}
              backendMode={backendMode}
              backendModeLabel={backendModeLabel}
              backendModeNote={backendModeNote}
              currentUserEmail={authSession?.user?.email ?? ""}
              factoryResetSubmitting={factoryResetSubmitting}
              isLocalAuth={!authEnabled}
              onChangeBackendMode={handleBackendModeChange}
              onFactoryReset={handleFactoryReset}
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
  onSelectDriverVehicle,
  onRequestAdminModuleAccess,
  onReviewAdminModuleAccess,
  onSetAdminModuleAccess,
}) {
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
  const bankingSeries = [
    { label: "In", value: snapshot.finance.bankingBatch.verifiedTakings },
    { label: "Out", value: snapshot.finance.bankingBatch.cashExpenses },
    { label: "Net", value: snapshot.finance.bankingBatch.depositAmount },
  ];

  if (isDriver) {
    return (
      <div className="content-stack">
        <div className="analytics-grid overview-analytics">
          <InsightCard
            title="Last shift"
            metric={formatMoney(snapshot.driverTerminal.lastShift.revenue)}
            meta={snapshot.driverTerminal.lastShift.status}
            icon={CheckSquare}
            tone="success"
          >
            <MiniBars
              items={[
                { label: "Open", value: snapshot.driverTerminal.lastShift.openOdo },
                { label: "Close", value: snapshot.driverTerminal.lastShift.closeOdo },
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
          title="Fleet overview"
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
              Fleet
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

      {activeRole !== "Driver" && (
        <AdminEditAccessPanel
          activeRole={activeRole}
          permissionControls={permissionControls}
          onRequestAdminModuleAccess={onRequestAdminModuleAccess}
          onReviewAdminModuleAccess={onReviewAdminModuleAccess}
          onSetAdminModuleAccess={onSetAdminModuleAccess}
        />
      )}

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
          const status = getModuleAccessStatus(control);
          const requestMeta = control.requestedAt
            ? `Requested ${formatStamp(control.requestedAt)}`
            : "No owner request has been sent yet.";
          const reviewMeta = control.ownerReviewedAt
            ? `Owner reviewed ${formatStamp(control.ownerReviewedAt)}`
            : "Owner decision still pending.";
          const grantMeta = control.grantedAt
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
                  {control.active
                    ? grantMeta
                    : ["approved", "rejected"].includes(control.requestStatus)
                      ? reviewMeta
                      : requestMeta}
                </span>
              </div>
              <div className="finance-form-actions">
                {activeRole === "Manager" && control.requestStatus !== "approved" && !control.active && (
                  <button
                    type="button"
                    className="action-button primary"
                    disabled={control.requestStatus === "pending"}
                    onClick={() => pushFeedback(onRequestAdminModuleAccess(moduleKey))}
                  >
                    Ask owner
                  </button>
                )}
                {activeRole === "Manager" && control.requestStatus === "approved" && !control.active && (
                  <button
                    type="button"
                    className="action-button primary"
                    onClick={() => pushFeedback(onSetAdminModuleAccess(moduleKey, true))}
                  >
                    Grant to admin
                  </button>
                )}
                {["Owner", "Manager"].includes(activeRole) && control.active && (
                  <button
                    type="button"
                    className="action-button"
                    onClick={() => pushFeedback(onSetAdminModuleAccess(moduleKey, false))}
                  >
                    Remove admin access
                  </button>
                )}
                {activeRole === "Owner" && control.requestStatus === "pending" && (
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
                  (control.requestStatus === "pending"
                    ? "Review the manager request before admin can receive edit access."
                    : control.active
                      ? "Admin is currently allowed to edit saved records in this area."
                      : "Only the owner can approve new admin edit access requests.")}
                {activeRole === "Manager" &&
                  (control.requestStatus === "pending"
                    ? "Waiting for the owner to respond."
                    : control.requestStatus === "approved" && !control.active
                      ? "Owner approval is ready. You can now grant admin access."
                      : control.active
                        ? "Admin edit access is live for this area."
                        : "Ask the owner first, then grant access to admin after approval.")}
                {activeRole === "Admin" &&
                  (control.active
                    ? "You can edit saved records in this area while this manager grant stays active."
                    : "Edits stay locked until the manager receives owner approval and grants access.")}
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
  permissionControls,
  onNavigate,
  onSaveStandardIncome,
  onSaveSpecialIncome,
  onSaveExpense,
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
    createExpenseDraft("asset", defaultVehicleId),
  );

  const incomeRecords = snapshot.financeTransactions.filter((record) => record.type === "income");
  const expenseRecords = snapshot.financeTransactions.filter((record) => record.type === "expense");
  const filteredExpenseRecords = expenseRecords.filter((record) =>
    expenseView === "vehicle" ? record.expenseKind === "asset" : record.expenseKind === "operational",
  );
  const expenseItems =
    expenseView === "vehicle"
      ? finance.expenseManagement.vehicleSpecific
      : finance.expenseManagement.operational;
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
  const verificationRecords = incomeRecords
    .filter((record) => record.status !== "banked")
    .slice(0, 8);
  const pendingVerificationCount = verificationRecords.filter(
    (record) => record.status === "pending",
  ).length;
  const depositHistory = snapshot.deposits.slice(0, 3);
  const lockableCount = snapshot.financeTransactions.filter(
    (record) => record.status === "verified",
  ).length;
  const canEditFinanceUpdates = canEditModuleUpdates(
    activeRole,
    "finance",
    permissionControls,
  );
  const canRecordCashHandIn = canRecordCashHandoverForRole(activeRole);
  const canVerifyFinanceChecks = canVerifyCashCheckForRole(activeRole);
  const financeAccessStatus = getModuleAccessStatus(permissionControls.finance);

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
    setExpenseView(nextView);
    setExpenseDraft(
      createExpenseDraft(nextView === "vehicle" ? "asset" : "operational", defaultVehicleId),
    );
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
        createExpenseDraft(expenseView === "vehicle" ? "asset" : "operational", defaultVehicleId),
      );
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

      {activeRole === "Admin" && !canEditFinanceUpdates && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Admin access</p>
            <h3>Money edits are locked</h3>
          </div>
          <p className="panel-note">
            A manager must ask the owner for approval, then grant admin access before you can edit
            saved daily takings, delete records, or finish deposits. Cash hand-ins stay available
            so you can compare what was received against the app.
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
                <p className="eyebrow">Expense form</p>
                <h3>{expenseView === "vehicle" ? "Vehicle cost" : "Business cost"} entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleExpenseSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Category</span>
                    <input
                      type="text"
                      value={expenseDraft.category}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field finance-field-wide">
                    <span>Description</span>
                    <input
                      type="text"
                      placeholder="Weekly subscription for Rank 12"
                      value={expenseDraft.description}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
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
                    data-tone={PRIVILEGED_ROLES.has(activeRole) ? "success" : "warning"}
                  >
                    Status starts as {PRIVILEGED_ROLES.has(activeRole) ? "checked" : "waiting"}
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
                          ),
                        )
                      }
                    >
                      Cancel edit
                    </button>
                  )}
                </div>

                <p className="finance-form-note" data-tone="info">
                  Capture the expense category, dated description, and receipt reference for items
                  such as weekly subscriptions, rank fees, fuel, and repairs.
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
              Administrator records the cash handed in against the app total. Manager then verifies
              the checking before the money moves into the ready-for-bank total.
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
                  Cash ready for bank is manager-checked income minus checked cash expenses.
                  Finishing the deposit includes {finance.bankingBatch.depositSlip.recordsLocked} records.
                </p>
                <div className="finance-form-actions">
                  <button
                    type="button"
                    className="action-button primary"
                    disabled={lockableCount === 0 || !canEditFinanceUpdates}
                    onClick={() => pushFeedback(onLockDeposit())}
                  >
                    Finish deposit
                  </button>
                </div>
              </div>
            </Panel>

            <Panel eyebrow="Deposit steps" title="Deposit history" icon={ArrowDownToLine}>
              <div className="flow-strip">
                <FlowLane owner="Driver" title="Submit takings" tone="teal" />
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
                const entry = snapshot.verificationQueue.find((item) => item.id === record.id);
                const queueEntry = entry ?? {
                  claimed: Number(record.amountClaimed ?? record.amount ?? 0),
                  counted: Number(record.actualCashReceived ?? 0),
                  shortage: 0,
                  gapKm: 0,
                  status: "Manager checked",
                  driver: "Driver",
                };
                const canRecordHandIn =
                  record.status === "pending" && canRecordCashHandIn;
                const canVerifyCheck =
                  record.status === "counted" && canVerifyFinanceChecks;
                const canEditCashInput =
                  canRecordHandIn || (activeRole === "Owner" && record.status === "counted");
                const actionLabel = canRecordHandIn
                  ? "Record hand-in"
                  : canVerifyCheck
                    ? "Verify checking"
                    : record.status === "pending"
                      ? "Waiting for admin hand-in"
                      : record.status === "counted"
                        ? "Waiting for manager check"
                        : "Manager checked";

                return (
                  <article key={record.id} className="queue-card">
                    <div className="queue-header">
                      <div>
                        <h3>
                          {record.incomeKind === "special"
                            ? `${record.vehicle} / ${formatTripRoute(record)}`
                            : `${record.vehicle} / ${record.route}`}
                        </h3>
                        <p>
                          {queueEntry.driver} /{" "}
                          {record.incomeKind === "special"
                            ? formatTripLogMeta(record)
                            : formatDailyTripMeta(record)}
                        </p>
                      </div>
                      <span className="status-chip" data-tone={getQueueTone(queueEntry)}>
                        {queueEntry.status}
                      </span>
                    </div>

                    <div className="queue-stats">
                      <InfoPair label="Reported" value={formatMoney(queueEntry.claimed)} />
                      <InfoPair label="Counted" value={formatMoney(queueEntry.counted)} />
                      <InfoPair label="Difference" value={formatMoney(queueEntry.shortage)} />
                      {!record.isSpecial && (
                        <InfoPair
                          label="Passengers"
                          value={`${getDailyTripPassengerTotal(record).toLocaleString()}`}
                        />
                      )}
                      {!record.isSpecial && (
                        <InfoPair label="Trips logged" value={`${getDailyTripTripCount(record)}`} />
                      )}
                      {record.isSpecial && (
                        <InfoPair
                          label="Business km"
                          value={`${Number(record.businessKm ?? getBusinessKmValue(record)).toLocaleString()} km`}
                        />
                      )}
                      <InfoPair label="Distance gap" value={`${queueEntry.gapKm} km`} />
                    </div>

                    <div className="verification-actions">
                      <input
                        className="verification-input"
                        type="number"
                        min="0"
                        step="1"
                        value={verificationInputs[record.id] ?? record.actualCashReceived ?? ""}
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
                        disabled={record.status === "banked" || !canEditFinanceUpdates}
                        onClick={() => handleEditIncome(record)}
                      >
                        Edit entry
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={record.status === "banked" || !canEditFinanceUpdates}
                        onClick={() => handleDelete(record.id)}
                      >
                        Delete entry
                      </button>
                    </div>
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
  permissionControls,
  onSaveVehicle,
  onArchiveVehicle,
  onLogDefect,
  onResolveDefect,
  onSelectDriverVehicle,
}) {
  const isDriver = activeRole === "Driver";
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const availableVehicles = isDriver ? linkedVehicles : snapshot.vehicles;
  const canViewVehicleProfile = !isDriver;
  const canManageVehicles = PRIVILEGED_ROLES.has(activeRole);
  const canEditFleetUpdates = canEditModuleUpdates(activeRole, "fleet", permissionControls);
  const fleetAccessStatus = getModuleAccessStatus(permissionControls.fleet);
  const canArchiveVehicles = ["Owner", "Admin"].includes(activeRole) && canEditFleetUpdates;
  const canResolveDefects =
    activeRole === "Owner" || activeRole === "Manager"
      ? true
      : activeRole === "Admin"
        ? canEditFleetUpdates
        : false;
  const assignedVehicleId = isDriver
    ? snapshot.driverTerminal.assignedVehicleId ?? linkedVehicles[0]?.id ?? null
    : snapshot.driverTerminal.assignedVehicleId ?? snapshot.vehicles[0]?.id ?? null;
  const [activeFilter, setActiveFilter] = useState(isDriver ? "assigned" : "attention");
  const [selectedVehicleId, setSelectedVehicleId] = useState(assignedVehicleId);
  const [feedback, setFeedback] = useState(null);
  const [vehicleDraft, setVehicleDraft] = useState(() =>
    createVehicleDraft(snapshot.vehicles[0], snapshot.profile.serviceIntervalKm),
  );
  const [defectDraft, setDefectDraft] = useState(() => createDefectDraft(assignedVehicleId));
  const [resolutionCosts, setResolutionCosts] = useState({});
  const vehicleFormRef = useRef(null);
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

  const filteredVehicles = useMemo(() => {
    if (isDriver) {
      return linkedVehicles;
    }
    if (activeFilter === "attention") {
      return snapshot.vehicles.filter(
        (vehicle) =>
          vehicle.status !== "archived" &&
          (vehicle.healthState === "warning" || vehicle.healthState === "danger"),
      );
    }
    if (activeFilter === "critical") {
      return snapshot.vehicles.filter(
        (vehicle) => vehicle.status !== "archived" && vehicle.healthState === "danger",
      );
    }
    if (activeFilter === "healthy") {
      return snapshot.vehicles.filter(
        (vehicle) => vehicle.status !== "archived" && vehicle.healthState === "success",
      );
    }
    if (activeFilter === "archived") {
      return snapshot.vehicles.filter((vehicle) => vehicle.status === "archived");
    }
    return snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived");
  }, [activeFilter, isDriver, linkedVehicles, snapshot.vehicles]);

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

  const handleNewVehicle = () => {
    setVehicleDraft(createVehicleDraft(null, snapshot.profile.serviceIntervalKm));
  };

  const handleAddVehicle = () => {
    handleNewVehicle();
    vehicleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

      {activeRole === "Admin" && !canEditFleetUpdates && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Admin access</p>
            <h3>Fleet edits are locked</h3>
          </div>
          <p className="panel-note">
            A manager must ask the owner for approval, then grant admin access before you can
            update saved vehicle profiles, edit reported problems, archive vehicles, or mark
            repairs as fixed.
          </p>
          <div className="finance-form-meta">
            <span className="status-chip" data-tone={fleetAccessStatus.tone}>
              {fleetAccessStatus.label}
            </span>
          </div>
        </article>
      )}

      <Panel eyebrow="Fleet summary" title="Fleet overview" icon={Car}>
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
          <div className="finance-sub-switch fleet-toolbar">
            {canManageVehicles && (
              <button
                type="button"
                className="finance-sub-pill finance-sub-pill-action"
                disabled={activeRole === "Admin" && !canEditFleetUpdates}
                onClick={handleAddVehicle}
              >
                <Car size={14} />
                Add vehicle
              </button>
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
                <p className="eyebrow">{isDriver ? "Linked vehicles" : "Fleet view"}</p>
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
                  : "Fleet onboarding"
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
                    <p className="eyebrow">Fleet setup</p>
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
                      <input
                        type="text"
                        value={vehicleDraft.route}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            route: event.target.value,
                          }))
                        }
                      />
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
                      disabled={activeRole === "Admin" && !canEditFleetUpdates}
                    >
                      {vehicleDraft.id ? "Save vehicle" : "Create vehicle"}
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      disabled={activeRole === "Admin" && !canEditFleetUpdates}
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

          {selectedVehicle && canViewVehicleProfile && (
            <div className="overview-board-grid">
              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Income summary</p>
                  <h3>Income and route history</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair label="Total income" value={formatMoney(revenueOutline.totalRevenue)} />
                  <InfoPair label="Daily routes" value={`${revenueOutline.shiftCount}`} />
                  <InfoPair label="Extra trips" value={`${revenueOutline.specialTripCount}`} />
                  <InfoPair label="Extra trip income" value={formatMoney(revenueOutline.specialRevenue)} />
                </div>
                <div className="finance-ledger">
                  {vehicleIncomeRecords.slice(0, 4).map((record) => (
                    <article key={record.id} className="ledger-row">
                      <div className="ledger-copy">
                        <strong>
                          {record.isSpecial
                            ? formatTripRoute(record)
                            : record.route ?? selectedVehicle.route}
                        </strong>
                        <span>
                          {record.isSpecial
                            ? formatTripLogMeta(record)
                            : formatDailyTripMeta(record)}
                        </span>
                      </div>
                      <div className="ledger-meta">
                        <span className="status-chip" data-tone={getTransactionTone(record)}>
                          {record.isSpecial ? "extra trip" : "route"}
                        </span>
                        <strong>{formatMoney(record.amountClaimed ?? record.amount)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Route history</p>
                  <h3>Recent routes and income</h3>
                </div>
                <div className="compact-feed">
                  {routeHistory.map((route, index) => (
                    <CompactFeedItem
                      key={`${route.title}-${index}`}
                      title={route.title}
                      subtitle={`${route.trips} recorded trips`}
                      tone={route.subtitle === "Special trip" ? "info" : "success"}
                      meta={formatMoney(route.revenue)}
                    />
                  ))}
                  {routeHistory.length === 0 && (
                    <CompactFeedItem
                      title="No route history yet"
                      subtitle="No trips recorded yet"
                      tone="info"
                      meta={selectedVehicle.route}
                    />
                  )}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Driver and vehicle history</p>
                  <h3>Drivers and vehicle condition</h3>
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
                  {healthHighlights.map((entry, index) => (
                    <CompactFeedItem
                      key={`${entry.title}-${index}`}
                      title={entry.title}
                      subtitle={entry.subtitle}
                      tone={entry.tone}
                      meta={entry.meta}
                    />
                  ))}
                </div>
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
                    disabled={activeRole === "Admin" && !canEditFleetUpdates}
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
  snapshot,
  backendMode,
  backendModeLabel,
  backendModeNote,
  currentUserEmail,
  factoryResetSubmitting,
  isLocalAuth,
  onChangeBackendMode,
  onFactoryReset,
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
  const selectedUserEnabledModules = SETTINGS_ASSIGNABLE_MODULES.filter(
    (moduleKey) => selectedUser?.moduleAccess?.[moduleKey],
  );

  useEffect(() => {
    if (selectedUser) {
      setDraft(createUserAccessDraft(selectedUser));
    }
  }, [selectedUser]);

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
    const response = onSaveUserAccess(draft);

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
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
        <Panel eyebrow="User access" title="Roles and rights" icon={Settings2}>
          <div className="finance-form-meta">
            <span className="status-chip" data-tone="info">
              {users.length} mapped users
            </span>
            {isLocalAuth && (
              <span className="status-chip" data-tone="warning">
                Local password: {LOCAL_AUTH_PASSWORD}
              </span>
            )}
          </div>
          <div className="list-stack">
            {users.map((user) => {
              const visibleRights = SETTINGS_ASSIGNABLE_MODULES.filter(
                (moduleKey) => user.moduleAccess[moduleKey],
              );

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
                      {visibleRights.length > 0
                        ? `${visibleRights.length + 1} modules`
                        : "Overview only"}
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

        <Panel eyebrow="Owner control" title="Edit selected user" icon={Lock}>
          {selectedUser ? (
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
                    selectedUserEnabledModules.length > 0
                      ? selectedUserEnabledModules
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
                  Overview stays on for every user. Settings stays owner-only.
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
                    : "Changing a role resets module rights to that role's default access. You can then switch individual modules on or off."}
              </p>
            </form>
          ) : (
            <p className="panel-note">No user accounts are available in this workspace yet.</p>
          )}
        </Panel>
      </div>

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
          Set the vehicle route in Fleet to prefill the two stops for this daily logbook.
        </p>
      )}

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
                  min="1"
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
                  min="1"
                  step="1"
                  value={entry.amountCollected}
                  onChange={(event) =>
                    updateEntry(entry.id, {
                      amountCollected: event.target.value,
                    })
                  }
                />
              </label>
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
  permissionControls,
  onShortcutAction,
  shortcutIntent,
  onSaveStandardIncome,
  onSaveSpecialIncome,
  onSaveExpense,
  onSaveDriver,
  onAllocateDriverShift,
  onSelectDriverVehicle,
}) {
  const isDriver = activeRole === "Driver";
  const canManageDrivers = PRIVILEGED_ROLES.has(activeRole);
  const canEditDriverRecords = canEditModuleUpdates(activeRole, "drivers", permissionControls);
  const canEditFinanceRecords = canEditModuleUpdates(activeRole, "finance", permissionControls);
  const canUseFinanceCapture = activeRole === "Admin" ? canEditFinanceRecords : true;
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
    createExpenseDraft("asset", assignedVehicleId),
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

  const handleShiftSubmit = (event) => {
    event.preventDefault();
    const response = onSaveStandardIncome({
      ...shiftDraft,
      vehicleId: assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setShiftDraft(
        createStandardDraft(assignedVehicleId, response.nextOpeningOdo, assignedVehicleRoute),
      );
      setDriverAction(null);
    }
  };

  const handleSpecialSubmit = (event) => {
    event.preventDefault();
    const response = onSaveSpecialIncome({
      ...specialDraft,
      vehicleId: assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setSpecialDraft(createSpecialDraft(assignedVehicleId));
      setDriverAction(null);
    }
  };

  const handleExpenseSubmit = (event) => {
    event.preventDefault();
    const response = onSaveExpense({
      ...expenseDraft,
      expenseKind: "asset",
      vehicleId: assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setExpenseDraft(createExpenseDraft("asset", assignedVehicleId));
      setDriverAction(null);
    }
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

      {activeRole === "Admin" && (!canEditFinanceRecords || !canEditDriverRecords) && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Admin access</p>
            <h3>Some edits are locked</h3>
          </div>
          <p className="panel-note">
            The owner must approve the request first, and then the manager must grant admin access
            before you can save daily takings, daily expenses, or change the driver roster here.
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
                        disabled={Boolean(shiftValidationError) || !canUseFinanceCapture}
                      >
                        Save trip
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => setDriverAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={shiftValidationError ? "danger" : "info"}
                    >
                      {shiftValidationError ??
                        "Passenger trip logbook is complete and ready to save."}
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
                        disabled={!canUseFinanceCapture || Boolean(specialValidationError)}
                      >
                        Save trip
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => setDriverAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={specialValidationError ? "danger" : "info"}
                    >
                      {specialValidationError ??
                        "Extra trip logbook details are complete and ready to save."}
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
                        <input
                          type="text"
                          value={expenseDraft.category}
                          onChange={(event) =>
                            setExpenseDraft((current) => ({
                              ...current,
                              category: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field finance-field-wide">
                        <span>Description</span>
                        <input
                          type="text"
                          placeholder="Fuel top-up, wash bay, rank fee"
                          value={expenseDraft.description}
                          onChange={(event) =>
                            setExpenseDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                        />
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
                    </div>
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="warning">
                        Logged against {assignedVehicle?.registration ?? "the assigned vehicle"}
                      </span>
                      <span
                        className="status-chip"
                        data-tone={PRIVILEGED_ROLES.has(activeRole) ? "success" : "warning"}
                      >
                        Status starts as {PRIVILEGED_ROLES.has(activeRole) ? "checked" : "waiting"}
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={!canUseFinanceCapture || Boolean(expenseValidationError)}
                      >
                        Save expense
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => setDriverAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={expenseValidationError ? "danger" : "info"}
                    >
                      {expenseValidationError ??
                        "Daily expense details are complete and ready to save."}
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
                    disabled={activeRole === "Admin" && !canEditDriverRecords}
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
                      <label className="finance-field">
                        <span>Route</span>
                        <input
                          type="text"
                          value={driverDraft.route}
                          onChange={(event) =>
                            setDriverDraft((current) => ({
                              ...current,
                              route: event.target.value,
                            }))
                          }
                        />
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
                        <span>PrDP expiry</span>
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
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={activeRole === "Admin" && !canEditDriverRecords}
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
                    <p className="finance-form-note" data-tone="info">
                      Add the driver here, then use shift allocation below to place the driver on
                      a vehicle.
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
                      disabled={!selectedAllocationDriver || (activeRole === "Admin" && !canEditDriverRecords)}
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
                    <p>
                      {driver.role} / {driver.route}
                    </p>
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
                        disabled={activeRole === "Admin" && !canEditDriverRecords}
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
  onSubmit,
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-lockup auth-brand">
          <img className="brand-logo auth-logo" src="/taxiflow-favicon.png" alt="TaxiFlow logo" />
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
          </div>
          <p className="finance-form-note" data-tone={error ? "danger" : "info"}>
            {error ??
              (isLocalAuth
                ? "Use one of the configured TaxiFlow accounts. Local setup mode routes you by designation."
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
