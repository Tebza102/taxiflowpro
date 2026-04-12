export const LIVE_CONFLICT_MESSAGE = "Live data changed on another device. Refresh before saving.";

export const createLiveConflictError = ({
  localVersion = null,
  serverVersion = null,
  reason = "live-version-conflict",
} = {}) => ({
  code: "LIVE_SNAPSHOT_CONFLICT",
  message: LIVE_CONFLICT_MESSAGE,
  localVersion,
  serverVersion,
  reason,
  action: "refresh",
});

export const detectLiveWriteConflict = (localVersion, serverVersion) => {
  if (localVersion == null && serverVersion != null) {
    return createLiveConflictError({
      localVersion,
      serverVersion,
      reason: "missing-live-baseline",
    });
  }

  if (localVersion != null && serverVersion != null && serverVersion !== localVersion) {
    return createLiveConflictError({
      localVersion,
      serverVersion,
      reason: "server-newer-than-local",
    });
  }

  return null;
};

export const shouldBypassLiveCacheRequest = (requestUrl, headerValue = "") => {
  const url = new URL(requestUrl);
  const liveBypassPathPatterns = [
    /\/auth\/v1\//i,
    /\/rest\/v1\//i,
    /\/realtime\/v1\//i,
    /workspace_snapshots/i,
  ];

  if (String(headerValue ?? "").trim().toLowerCase() === "bypass") {
    return true;
  }

  if (url.hostname.includes("supabase")) {
    return true;
  }

  if (liveBypassPathPatterns.some((pattern) => pattern.test(url.pathname))) {
    return true;
  }

  if (url.searchParams.get("workspace_key") === "taxiflow-live") {
    return true;
  }

  return false;
};
