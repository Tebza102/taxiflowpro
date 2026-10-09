import { repository as coreRepository } from "./dataGateway.js";

export * from "./dataGateway.js";

const DEMO_EMAIL_SUFFIX = "@taxiflow.local";

const normalizeMode = (value) =>
  String(value ?? coreRepository.backendMode ?? "mock").trim().toLowerCase() === "live"
    ? "live"
    : "mock";

const stripCredentialFields = (record = {}) => {
  const { accessPassword, localPassword, password, ...safeRecord } = record;
  return safeRecord;
};

const sanitizeLiveSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const cloned = JSON.parse(JSON.stringify(snapshot));

  cloned.appUsers = (Array.isArray(cloned.appUsers) ? cloned.appUsers : [])
    .filter(
      (user) =>
        !String(user?.email ?? "")
          .trim()
          .toLowerCase()
          .endsWith(DEMO_EMAIL_SUFFIX),
    )
    .map(stripCredentialFields);

  cloned.drivers = (Array.isArray(cloned.drivers) ? cloned.drivers : []).map(
    stripCredentialFields,
  );

  return cloned;
};

const sanitizeLoadedLiveSnapshotInPlace = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const sanitized = sanitizeLiveSnapshot(snapshot);
  snapshot.appUsers = sanitized.appUsers;
  snapshot.drivers = sanitized.drivers;
  return snapshot;
};

export const repository = Object.create(coreRepository);

Object.defineProperty(repository, "loadSnapshot", {
  enumerable: true,
  configurable: false,
  value: async (mode = coreRepository.backendMode) => {
    const result = await coreRepository.loadSnapshot(mode);
    return normalizeMode(mode) === "live"
      ? sanitizeLoadedLiveSnapshotInPlace(result)
      : result;
  },
});

Object.defineProperty(repository, "persistSnapshot", {
  enumerable: true,
  configurable: false,
  value: async (snapshot, mode = coreRepository.backendMode) =>
    coreRepository.persistSnapshot(
      normalizeMode(mode) === "live" ? sanitizeLiveSnapshot(snapshot) : snapshot,
      mode,
    ),
});
