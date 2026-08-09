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
  const metadataStaffId =
    user.app_metadata?.staffId ??
    user.app_metadata?.staff_id ??
    user.user_metadata?.staffId ??
    user.user_metadata?.staff_id ??
    null;

  // In production, Supabase Auth metadata is authoritative. Snapshot data may
  // enrich display/access details, but it must never manufacture an identity.
  if (!email || !metadataRole) {
    return null;
  }

  const storedUser = getAppUserByEmail(snapshot, email);
  const actorId =
    storedUser?.actorId ??
    metadataStaffId ??
    user.id ??
    `${metadataRole.toLowerCase()}-session`;

  return {
    email,
    role: metadataRole,
    actorId,
    staffId: storedUser?.staffId ?? metadataStaffId ?? null,
    moduleAccess: core.normalizeModuleViewAccess(storedUser?.moduleAccess ?? {}, metadataRole),
    name:
      storedUser?.name ??
      String(user.user_metadata?.name ?? user.user_metadata?.full_name ?? email).trim() ||
      email,
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
