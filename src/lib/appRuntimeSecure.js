import * as core from "./appRuntime.js";
import { configuredBackendMode } from "./supabaseClient.js";

export * from "./appRuntime.js";

const LIVE_MODE = configuredBackendMode === "live";
const DEMO_EMAIL_SUFFIX = "@taxiflow.local";

const isDemoSeedEmail = (email) =>
  String(email ?? "")
    .trim()
    .toLowerCase()
    .endsWith(DEMO_EMAIL_SUFFIX);

const sanitizeLiveUser = (user = {}) => {
  const normalized = core.normalizeAppUser(user);

  if (!LIVE_MODE) {
    return normalized;
  }

  return {
    ...normalized,
    accessPassword: null,
  };
};

const getStoredLiveUsers = (snapshot) =>
  core.sortAppUsers(
    (Array.isArray(snapshot?.appUsers) ? snapshot.appUsers : [])
      .map(sanitizeLiveUser)
      .filter((user) => user.email && !isDemoSeedEmail(user.email)),
  );

export const AUTH_ACCOUNT_DIRECTORY = LIVE_MODE ? {} : core.AUTH_ACCOUNT_DIRECTORY;
export const DEFAULT_DRIVER_ACCOUNT_EMAIL_BY_STAFF_ID = LIVE_MODE
  ? {}
  : core.DEFAULT_DRIVER_ACCOUNT_EMAIL_BY_STAFF_ID;
export const LOCAL_AUTH_PASSWORD = LIVE_MODE ? null : core.LOCAL_AUTH_PASSWORD;

export const normalizeAppUser = (user = {}) => sanitizeLiveUser(user);

export const buildDefaultAppUsers = (snapshot) =>
  LIVE_MODE ? getStoredLiveUsers(snapshot) : core.buildDefaultAppUsers(snapshot);

export const getAppUsers = (snapshot) =>
  LIVE_MODE ? getStoredLiveUsers(snapshot) : core.getAppUsers(snapshot);

export const getAppUserByEmail = (snapshot, email) => {
  if (!LIVE_MODE) {
    return core.getAppUserByEmail(snapshot, email);
  }

  const normalizedEmail = core.normalizeEmailAddress(email);
  return getStoredLiveUsers(snapshot).find((user) => user.email === normalizedEmail) ?? null;
};

export const resolveAuthIdentity = (user, snapshot) => {
  if (!LIVE_MODE) {
    return core.resolveAuthIdentity(user, snapshot);
  }

  if (!user) {
    return null;
  }

  const email = core.normalizeEmailAddress(user.email);
  const metadataRole = core.normalizeRole(user.app_metadata?.role ?? user.user_metadata?.role);

  if (!email || !metadataRole) {
    return null;
  }

  // Production membership gate: a valid Supabase Auth session is necessary but not
  // sufficient. The account must also exist as an ACTIVE member of the TaxiFlow
  // account directory (appUsers). An Auth-only identity - for example one left
  // behind by a partial account creation, or created directly in Supabase without
  // ever being added to TaxiFlow - must never resolve to application access.
  const storedUser = getAppUserByEmail(snapshot, email);

  if (!storedUser || storedUser.active === false) {
    return null;
  }

  const metadataStaffId =
    user.app_metadata?.staffId ??
    user.app_metadata?.staff_id ??
    user.user_metadata?.staffId ??
    user.user_metadata?.staff_id ??
    null;

  const role = storedUser.role ?? metadataRole;
  const actorId = storedUser.actorId ?? metadataStaffId ?? user.id ?? `${role.toLowerCase()}-session`;

  return {
    email,
    role,
    actorId,
    staffId: storedUser.staffId ?? metadataStaffId ?? null,
    moduleAccess: core.normalizeModuleViewAccess(storedUser.moduleAccess ?? {}, role),
    name:
      storedUser.name ??
      (String(user.user_metadata?.name ?? user.user_metadata?.full_name ?? email).trim() || email),
  };
};

export const getAuthSessionRole = (user) => {
  if (!LIVE_MODE) {
    return core.getAuthSessionRole(user);
  }

  if (!user) {
    return null;
  }

  return core.normalizeRole(user.app_metadata?.role ?? user.user_metadata?.role ?? null);
};

export const createLocalAuthSession = (email, account = null) =>
  LIVE_MODE ? null : core.createLocalAuthSession(email, account);

export const readStoredLocalAuthSession = () =>
  LIVE_MODE ? null : core.readStoredLocalAuthSession();

export const persistLocalAuthSession = (email, account = null) => {
  if (!LIVE_MODE) {
    core.persistLocalAuthSession(email, account);
  }
};
