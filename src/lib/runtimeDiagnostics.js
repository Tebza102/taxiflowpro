import {
  getNotificationPermissionSafe,
  getSafeNavigator,
  getSafeWindow,
} from "./browserRuntime";

const LOG_KEY = "__TAXIFLOW_DIAGNOSTICS__";
const LISTENERS_KEY = "__TAXIFLOW_DIAGNOSTICS_READY__";
const MAX_ENTRIES = 200;

const serializeError = (error) => {
  if (!error) {
    return null;
  }

  return {
    name: error.name ?? "Error",
    message: error.message ?? String(error),
    stack: error.stack ?? null,
  };
};

const getStore = () => {
  const browserWindow = getSafeWindow();

  if (!browserWindow) {
    return [];
  }

  if (!Array.isArray(browserWindow[LOG_KEY])) {
    browserWindow[LOG_KEY] = [];
  }

  return browserWindow[LOG_KEY];
};

export const readRuntimeDiagnostics = () => [...getStore()];

export const logStartupEvent = (type, detail = {}) => {
  const entry = {
    level: "info",
    type,
    detail,
    timestamp: new Date().toISOString(),
  };
  const store = getStore();

  store.push(entry);
  if (store.length > MAX_ENTRIES) {
    store.splice(0, store.length - MAX_ENTRIES);
  }

  try {
    console.info(`[TaxiFlow] ${type}`, detail);
  } catch {
    // Console access should never break app startup.
  }

  return entry;
};

export const logStartupError = (type, error, detail = {}) => {
  const entry = {
    level: "error",
    type,
    detail: {
      ...detail,
      error: serializeError(error),
    },
    timestamp: new Date().toISOString(),
  };
  const store = getStore();

  store.push(entry);
  if (store.length > MAX_ENTRIES) {
    store.splice(0, store.length - MAX_ENTRIES);
  }

  try {
    console.error(`[TaxiFlow] ${type}`, error, detail);
  } catch {
    // Console access should never break app startup.
  }

  return entry;
};

export const attachGlobalRuntimeDiagnostics = () => {
  const browserWindow = getSafeWindow();
  const browserNavigator = getSafeNavigator();

  if (!browserWindow || browserWindow[LISTENERS_KEY]) {
    return;
  }

  browserWindow[LISTENERS_KEY] = true;

  logStartupEvent("bootstrap-environment", {
    userAgent: browserNavigator?.userAgent ?? "unknown",
    language: browserNavigator?.language ?? "unknown",
    onLine: browserNavigator?.onLine ?? null,
    notificationPermission: getNotificationPermissionSafe(),
    hardwareConcurrency: browserNavigator?.hardwareConcurrency ?? null,
    deviceMemory: browserNavigator?.deviceMemory ?? null,
  });

  browserWindow.addEventListener("error", (event) => {
    logStartupError("window-error", event.error ?? new Error(event.message), {
      filename: event.filename ?? null,
      lineno: event.lineno ?? null,
      colno: event.colno ?? null,
    });
  });

  browserWindow.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? "Unhandled promise rejection"));

    logStartupError("unhandled-rejection", reason);
  });
};
