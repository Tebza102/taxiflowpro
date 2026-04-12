const getWindow = () => (typeof window !== "undefined" ? window : null);
const getDocument = () => (typeof document !== "undefined" ? document : null);
const getNavigator = () => (typeof navigator !== "undefined" ? navigator : null);

export const isBrowserRuntime = () => Boolean(getWindow() && getDocument());

export const getSafeWindow = () => getWindow();
export const getSafeDocument = () => getDocument();
export const getSafeNavigator = () => getNavigator();

export const safeMatchMedia = (query) => {
  const browserWindow = getWindow();

  if (!browserWindow?.matchMedia) {
    return null;
  }

  try {
    return browserWindow.matchMedia(query);
  } catch {
    return null;
  }
};

export const safeLocalStorageGet = (key) => {
  const browserWindow = getWindow();

  if (!browserWindow?.localStorage) {
    return null;
  }

  try {
    return browserWindow.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const safeLocalStorageSet = (key, value) => {
  const browserWindow = getWindow();

  if (!browserWindow?.localStorage) {
    return false;
  }

  try {
    browserWindow.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const safeLocalStorageRemove = (key) => {
  const browserWindow = getWindow();

  if (!browserWindow?.localStorage) {
    return false;
  }

  try {
    browserWindow.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const getNotificationPermissionSafe = () => {
  const browserWindow = getWindow();

  try {
    return browserWindow?.Notification?.permission ?? "unsupported";
  } catch {
    return "unsupported";
  }
};

export const canUseServiceWorker = () => {
  const browserWindow = getWindow();
  const browserNavigator = getNavigator();

  return Boolean(browserWindow?.isSecureContext && browserNavigator?.serviceWorker);
};

export const unregisterAllServiceWorkers = async () => {
  const browserNavigator = getNavigator();

  if (!browserNavigator?.serviceWorker?.getRegistrations) {
    return 0;
  }

  try {
    const registrations = await browserNavigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    return registrations.length;
  } catch {
    return 0;
  }
};

export const clearBrowserCaches = async () => {
  if (typeof caches === "undefined" || !caches?.keys) {
    return 0;
  }

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    return keys.length;
  } catch {
    return 0;
  }
};

export const clearAppBrowserCaches = async (prefix = "taxiflow-pro-") => {
  if (typeof caches === "undefined" || !caches?.keys) {
    return 0;
  }

  try {
    const keys = await caches.keys();
    const matchingKeys = keys.filter((key) => String(key ?? "").startsWith(prefix));
    await Promise.all(matchingKeys.map((key) => caches.delete(key)));
    return matchingKeys.length;
  } catch {
    return 0;
  }
};
