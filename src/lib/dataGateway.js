import { mockSnapshot } from "../data/mockData";
import { configuredBackendMode, hasSupabaseConfig, supabase } from "./supabaseClient";

const DATA_MODE_STORAGE_KEY = "taxiflow-data-mode-v2";
const DEMO_SNAPSHOT_STORAGE_KEY = "taxiflow-demo-snapshot-v1";
const LIVE_SNAPSHOT_STORAGE_KEY = "taxiflow-live-snapshot-v1";
const LIVE_PENDING_SNAPSHOT_STORAGE_KEY = "taxiflow-live-pending-snapshot-v1";
const LIVE_WORKSPACE_KEY = "taxiflow-live";

const normalizeBackendMode = (value) =>
  String(value ?? "mock").trim().toLowerCase() === "live" ? "live" : "mock";

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));
const IS_DEV = Boolean(import.meta.env?.DEV);

const toDevErrorDetail = (error) => {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const logHandledWarning = (warning, error = null) => {
  if (!IS_DEV || !warning) {
    return;
  }

  if (error) {
    console.warn(`[dataGateway] ${warning}`, error);
    return;
  }

  console.warn(`[dataGateway] ${warning}`);
};

const createStructuredResult = (data, { ok = true, warning = null, error = null } = {}) => {
  const result = {
    ok,
    data,
    warning,
  };

  if (IS_DEV && error) {
    result.error = toDevErrorDetail(error);
  }

  return result;
};

const attachStructuredResult = (data, options = {}) => {
  if (!data || typeof data !== "object") {
    return createStructuredResult(data, options);
  }

  const detail = IS_DEV ? toDevErrorDetail(options.error) : undefined;
  const descriptors = {
    ok: { value: options.ok ?? true, enumerable: false, configurable: true },
    data: { value: data, enumerable: false, configurable: true },
    warning: { value: options.warning ?? null, enumerable: false, configurable: true },
  };

  if (detail) {
    descriptors.error = { value: detail, enumerable: false, configurable: true };
  }

  Object.defineProperties(data, descriptors);
  return data;
};

const createSnapshotShape = ({
  legalEntity = "Workspace not configured",
  district = "Not set",
  nextBankingWindow = "Not set",
  activeDriver = "No driver linked",
  assignedVehicle = "No vehicle linked",
  assignedRoute = "No route assigned",
} = {}) => ({
  profile: {
    ...cloneSnapshot(mockSnapshot.profile),
    fleetName: "TaxiFlow Pro",
    legalEntity,
    district,
    nextBankingWindow,
    monthlyTarget: 0,
  },
  operationsLoop: cloneSnapshot(mockSnapshot.operationsLoop),
  verificationQueue: [],
  finance: {
    ...cloneSnapshot(mockSnapshot.finance),
    todayClaimed: 0,
    todayCounted: 0,
    pendingCashInSafe: 0,
    verifiedToday: 0,
    shiftsAwaitingVerification: 0,
    revenueLogging: {
      ...cloneSnapshot(mockSnapshot.finance.revenueLogging),
      standardRouteCount: 0,
      specialTripCount: 0,
      standardRouteRevenue: 0,
      specialTripRevenue: 0,
      routes: [],
      specialTrips: [],
    },
    expenseMix: [],
    expenseManagement: {
      vehicleSpecific: [],
      operational: [],
    },
    bankingBatch: {
      ...cloneSnapshot(mockSnapshot.finance.bankingBatch),
      reference: "Awaiting first deposit",
      verifiedTakings: 0,
      cashExpenses: 0,
      depositAmount: 0,
      depositSlip: {
        ...cloneSnapshot(mockSnapshot.finance.bankingBatch.depositSlip),
        generatedAt: "No banking captured yet",
        teller: "Pending setup",
        recordsLocked: 0,
      },
    },
  },
  financeTransactions: [],
  deposits: [],
  appUsers: [],
  vehicles: [],
  serviceSchedule: [],
  documents: [],
  drivers: [],
  driverTerminal: {
    ...cloneSnapshot(mockSnapshot.driverTerminal),
    activeDriverId: null,
    assignedVehicleId: null,
    activeDriver,
    assignedVehicle,
    assignedRoute,
    lastShift: {
      ...cloneSnapshot(mockSnapshot.driverTerminal.lastShift),
      openOdo: 0,
      closeOdo: 0,
      revenue: 0,
      status: "Ready for capture",
    },
    shortcuts: [...mockSnapshot.driverTerminal.shortcuts],
    linkedVehicleIds: [],
    linkedVehicles: [],
  },
  defects: [],
  auditTrail: [],
});

const normalizeSnapshotShape = (snapshot, defaults = createSnapshotShape()) => {
  if (!snapshot) {
    return cloneSnapshot(defaults);
  }

  return {
    ...cloneSnapshot(defaults),
    ...snapshot,
    profile: {
      ...cloneSnapshot(defaults.profile),
      ...(snapshot.profile ?? {}),
      valuePillars: Array.isArray(snapshot.profile?.valuePillars)
        ? snapshot.profile.valuePillars
        : cloneSnapshot(defaults.profile.valuePillars ?? []),
    },
    operationsLoop: Array.isArray(snapshot.operationsLoop)
      ? snapshot.operationsLoop
      : cloneSnapshot(defaults.operationsLoop),
    verificationQueue: Array.isArray(snapshot.verificationQueue)
      ? snapshot.verificationQueue
      : cloneSnapshot(defaults.verificationQueue),
    finance: {
      ...cloneSnapshot(defaults.finance),
      ...(snapshot.finance ?? {}),
      revenueLogging: {
        ...cloneSnapshot(defaults.finance.revenueLogging),
        ...(snapshot.finance?.revenueLogging ?? {}),
        routes: Array.isArray(snapshot.finance?.revenueLogging?.routes)
          ? snapshot.finance.revenueLogging.routes
          : cloneSnapshot(defaults.finance.revenueLogging.routes),
        specialTrips: Array.isArray(snapshot.finance?.revenueLogging?.specialTrips)
          ? snapshot.finance.revenueLogging.specialTrips
          : cloneSnapshot(defaults.finance.revenueLogging.specialTrips),
      },
      expenseMix: Array.isArray(snapshot.finance?.expenseMix)
        ? snapshot.finance.expenseMix
        : cloneSnapshot(defaults.finance.expenseMix),
      expenseManagement: {
        ...cloneSnapshot(defaults.finance.expenseManagement),
        ...(snapshot.finance?.expenseManagement ?? {}),
        vehicleSpecific: Array.isArray(snapshot.finance?.expenseManagement?.vehicleSpecific)
          ? snapshot.finance.expenseManagement.vehicleSpecific
          : cloneSnapshot(defaults.finance.expenseManagement.vehicleSpecific),
        operational: Array.isArray(snapshot.finance?.expenseManagement?.operational)
          ? snapshot.finance.expenseManagement.operational
          : cloneSnapshot(defaults.finance.expenseManagement.operational),
      },
      bankingBatch: {
        ...cloneSnapshot(defaults.finance.bankingBatch),
        ...(snapshot.finance?.bankingBatch ?? {}),
        depositSlip: {
          ...cloneSnapshot(defaults.finance.bankingBatch.depositSlip),
          ...(snapshot.finance?.bankingBatch?.depositSlip ?? {}),
        },
      },
    },
    financeTransactions: Array.isArray(snapshot.financeTransactions)
      ? snapshot.financeTransactions
      : cloneSnapshot(defaults.financeTransactions),
    deposits: Array.isArray(snapshot.deposits) ? snapshot.deposits : cloneSnapshot(defaults.deposits),
    appUsers: Array.isArray(snapshot.appUsers) ? snapshot.appUsers : cloneSnapshot(defaults.appUsers),
    vehicles: Array.isArray(snapshot.vehicles) ? snapshot.vehicles : cloneSnapshot(defaults.vehicles),
    serviceSchedule: Array.isArray(snapshot.serviceSchedule)
      ? snapshot.serviceSchedule
      : cloneSnapshot(defaults.serviceSchedule),
    documents: Array.isArray(snapshot.documents)
      ? snapshot.documents
      : cloneSnapshot(defaults.documents),
    drivers: Array.isArray(snapshot.drivers) ? snapshot.drivers : cloneSnapshot(defaults.drivers),
    driverTerminal: {
      ...cloneSnapshot(defaults.driverTerminal),
      ...(snapshot.driverTerminal ?? {}),
      lastShift: {
        ...cloneSnapshot(defaults.driverTerminal.lastShift),
        ...(snapshot.driverTerminal?.lastShift ?? {}),
      },
      shortcuts: Array.isArray(snapshot.driverTerminal?.shortcuts)
        ? snapshot.driverTerminal.shortcuts
        : [...defaults.driverTerminal.shortcuts],
      linkedVehicleIds: Array.isArray(snapshot.driverTerminal?.linkedVehicleIds)
        ? snapshot.driverTerminal.linkedVehicleIds
        : [...defaults.driverTerminal.linkedVehicleIds],
      linkedVehicles: Array.isArray(snapshot.driverTerminal?.linkedVehicles)
        ? snapshot.driverTerminal.linkedVehicles
        : cloneSnapshot(defaults.driverTerminal.linkedVehicles),
    },
    defects: Array.isArray(snapshot.defects) ? snapshot.defects : cloneSnapshot(defaults.defects),
    auditTrail: Array.isArray(snapshot.auditTrail)
      ? snapshot.auditTrail
      : cloneSnapshot(defaults.auditTrail),
  };
};

const createBlankWorkspaceSnapshot = ({
  legalEntity,
  district,
  nextBankingWindow,
  activeDriver,
  assignedVehicle,
  assignedRoute,
}) => ({
  ...createSnapshotShape({
    legalEntity,
    district,
    nextBankingWindow,
    activeDriver,
    assignedVehicle,
    assignedRoute,
  }),
});

const createLiveSnapshot = () =>
  createBlankWorkspaceSnapshot({
    legalEntity: "Live operations workspace",
    district: "Client setup pending",
    nextBankingWindow: "Set banking window",
    activeDriver: "No driver linked",
    assignedVehicle: "No vehicle linked",
    assignedRoute: "No route assigned",
  });

const createTrainingSnapshot = () =>
  createBlankWorkspaceSnapshot({
    legalEntity: "Training workspace",
    district: "Demo reset slate",
    nextBankingWindow: "Training session",
    activeDriver: "No training driver linked",
    assignedVehicle: "No training vehicle linked",
    assignedRoute: "No training route assigned",
  });

const readStoredMode = () => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(DATA_MODE_STORAGE_KEY);
    return value ? normalizeBackendMode(value) : null;
  } catch {
    return null;
  }
};

const persistMode = (mode) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(DATA_MODE_STORAGE_KEY, mode);
  } catch (error) {
    logHandledWarning("Unable to persist the selected data mode in local storage.", error);
  }
};

const readStoredSnapshot = (storageKey) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logHandledWarning(`Unable to read the workspace snapshot from local storage (${storageKey}).`, error);
    return null;
  }
};

const persistStoredSnapshot = (storageKey, snapshot) => {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    logHandledWarning(`Unable to save the workspace snapshot in local storage (${storageKey}).`, error);
    return false;
  }
};

const clearStoredSnapshot = (storageKey) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch (error) {
    logHandledWarning(`Unable to clear the workspace snapshot from local storage (${storageKey}).`, error);
  }
};

const readPendingLiveSnapshot = () => readStoredSnapshot(LIVE_PENDING_SNAPSHOT_STORAGE_KEY);
const persistPendingLiveSnapshot = (snapshot) =>
  persistStoredSnapshot(LIVE_PENDING_SNAPSHOT_STORAGE_KEY, snapshot);
const clearPendingLiveSnapshot = () => clearStoredSnapshot(LIVE_PENDING_SNAPSHOT_STORAGE_KEY);

const canUseRemoteLiveData = () => hasSupabaseConfig && Boolean(supabase);
const getInitialBackendMode = () => {
  const storedMode = readStoredMode();

  if (storedMode) {
    return storedMode;
  }

  return canUseRemoteLiveData() ? "live" : configuredBackendMode;
};

const getSupabaseSession = async () => {
  if (!canUseRemoteLiveData()) {
    return null;
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session ?? null;
  } catch {
    return null;
  }
};

const loadSupabaseLiveSnapshot = async () => {
  const session = await getSupabaseSession();
  const cachedSnapshot = readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY);
  const pendingSnapshot = readPendingLiveSnapshot();
  const liveDefaults = createLiveSnapshot();

  if (!session) {
    const fallbackSnapshot = normalizeSnapshotShape(
      pendingSnapshot ?? cachedSnapshot,
      liveDefaults,
    );
    const warning = pendingSnapshot
      ? "Live session unavailable. Showing unsynced live changes until they can be saved."
      : cachedSnapshot
        ? "Live session unavailable. Showing the last available local workspace."
        : "Live session unavailable. Showing a fresh live workspace.";

    logHandledWarning(warning);
    return attachStructuredResult(cloneSnapshot(fallbackSnapshot), { ok: false, warning });
  }

  try {
    if (pendingSnapshot) {
      const nextSnapshot = normalizeSnapshotShape(pendingSnapshot, liveDefaults);
      persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, nextSnapshot);
      const persistResult = await persistSupabaseLiveSnapshot(nextSnapshot, session.user.id);

      return attachStructuredResult(cloneSnapshot(nextSnapshot), {
        ok: persistResult.ok,
        warning: persistResult.warning,
        error: persistResult.error,
      });
    }

    const { data, error } = await supabase
      .from("workspace_snapshots")
      .select("snapshot")
      .eq("workspace_key", LIVE_WORKSPACE_KEY)
      .maybeSingle();

    if (error) {
      const fallbackSnapshot = normalizeSnapshotShape(cachedSnapshot, liveDefaults);
      const warning =
        "Unable to load the latest live workspace. Showing the last available local workspace.";

      logHandledWarning(warning, error);
      return attachStructuredResult(cloneSnapshot(fallbackSnapshot), {
        ok: false,
        warning,
        error,
      });
    }

    const nextSnapshot = normalizeSnapshotShape(
      data?.snapshot ?? cachedSnapshot ?? liveDefaults,
      liveDefaults,
    );
    persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, nextSnapshot);

    let warning = null;
    let handledError = null;
    if (!data?.snapshot) {
      const persistResult = await persistSupabaseLiveSnapshot(nextSnapshot, session.user.id);
      warning = persistResult.warning;
      handledError = persistResult.error;
    }

    return attachStructuredResult(cloneSnapshot(nextSnapshot), {
      ok: true,
      warning,
      error: handledError,
    });
  } catch (error) {
    const fallbackSnapshot = normalizeSnapshotShape(cachedSnapshot, liveDefaults);
    const warning =
      "Unable to load the latest live workspace. Showing the last available local workspace.";

    logHandledWarning(warning, error);
    return attachStructuredResult(cloneSnapshot(fallbackSnapshot), {
      ok: false,
      warning,
      error,
    });
  }
};

const persistSupabaseLiveSnapshot = async (snapshot, actorId = null) => {
  if (!canUseRemoteLiveData() || !snapshot) {
    return createStructuredResult(snapshot, { ok: true, warning: null });
  }

  const session = await getSupabaseSession();

  if (!session) {
    persistPendingLiveSnapshot(snapshot);
    const warning = "Live session unavailable. Changes are queued and will save when the session returns.";
    logHandledWarning(warning);
    return createStructuredResult(snapshot, { ok: false, warning });
  }

  try {
    const payload = cloneSnapshot(snapshot);
    const { error } = await supabase.from("workspace_snapshots").upsert(
      {
        workspace_key: LIVE_WORKSPACE_KEY,
        snapshot: payload,
        updated_at: new Date().toISOString(),
        updated_by: actorId ?? session.user.id,
      },
      {
        onConflict: "workspace_key",
      },
    );

    if (error) {
      persistPendingLiveSnapshot(snapshot);
      const warning =
        "Unable to save the live workspace remotely. Changes are queued and will retry automatically.";
      logHandledWarning(warning, error);
      return createStructuredResult(snapshot, { ok: false, warning, error });
    }

    persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, payload);
    clearPendingLiveSnapshot();
    return createStructuredResult(snapshot, { ok: true, warning: null });
  } catch (error) {
    persistPendingLiveSnapshot(snapshot);
    const warning =
      "Unable to save the live workspace remotely. Changes are queued and will retry automatically.";
    logHandledWarning(warning, error);
    return createStructuredResult(snapshot, { ok: false, warning, error });
  }
};

let activeBackendMode = normalizeBackendMode(getInitialBackendMode());
persistMode(activeBackendMode);

export const repository = {
  get backendMode() {
    return activeBackendMode;
  },
  get supportsLiveMode() {
    return true;
  },
  get liveModeSourceLabel() {
    return canUseRemoteLiveData() ? "Supabase" : "This browser";
  },
  resetModeSnapshot(mode = activeBackendMode) {
    const normalizedMode = normalizeBackendMode(mode);
    const nextSnapshot =
      normalizedMode === "live" ? createLiveSnapshot() : createTrainingSnapshot();
    const storageKey =
      normalizedMode === "live" ? LIVE_SNAPSHOT_STORAGE_KEY : DEMO_SNAPSHOT_STORAGE_KEY;

    clearStoredSnapshot(storageKey);
    if (normalizedMode === "live") {
      clearPendingLiveSnapshot();
    }
    persistStoredSnapshot(storageKey, nextSnapshot);

    if (normalizedMode === "live" && canUseRemoteLiveData()) {
      persistSupabaseLiveSnapshot(nextSnapshot);
    }

    return cloneSnapshot(nextSnapshot);
  },
  setBackendMode(nextMode) {
    activeBackendMode = normalizeBackendMode(nextMode);
    persistMode(activeBackendMode);
    return activeBackendMode;
  },
  resetLiveSnapshot() {
    const nextSnapshot = createLiveSnapshot();
    clearStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY);
    clearPendingLiveSnapshot();
    persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, nextSnapshot);

    if (canUseRemoteLiveData()) {
      persistSupabaseLiveSnapshot(nextSnapshot);
    }

    return cloneSnapshot(nextSnapshot);
  },
  async flushPendingLiveSnapshot() {
    const pendingSnapshot = readPendingLiveSnapshot();

    if (!pendingSnapshot) {
      return createStructuredResult(null, { ok: true, warning: null });
    }

    const nextSnapshot = normalizeSnapshotShape(pendingSnapshot, createLiveSnapshot());
    return persistSupabaseLiveSnapshot(nextSnapshot);
  },
  async persistSnapshot(snapshot, mode = activeBackendMode) {
    if (!snapshot) {
      return createStructuredResult(null, {
        ok: false,
        warning: "No workspace snapshot was provided for saving.",
      });
    }

    try {
      const normalizedMode = normalizeBackendMode(mode);
      const storageKey =
        normalizedMode === "live" ? LIVE_SNAPSHOT_STORAGE_KEY : DEMO_SNAPSHOT_STORAGE_KEY;
      const defaults =
        normalizedMode === "live" ? createLiveSnapshot() : createTrainingSnapshot();
      const nextSnapshot = normalizeSnapshotShape(snapshot, defaults);

      const storedLocally = persistStoredSnapshot(storageKey, nextSnapshot);
      const localWarning = storedLocally
        ? null
        : "Unable to save the workspace snapshot in local storage.";

      if (normalizedMode === "live" && canUseRemoteLiveData()) {
        const remoteResult = await persistSupabaseLiveSnapshot(nextSnapshot);
        return createStructuredResult(nextSnapshot, {
          ok: remoteResult.ok,
          warning: remoteResult.warning ?? localWarning,
          error: remoteResult.error,
        });
      }

      return createStructuredResult(nextSnapshot, {
        ok: storedLocally,
        warning: localWarning,
      });
    } catch (error) {
      const warning = "Unable to save the workspace snapshot.";
      logHandledWarning(warning, error);
      return createStructuredResult(snapshot, { ok: false, warning, error });
    }
  },
  async loadSnapshot(nextMode = activeBackendMode) {
    activeBackendMode = normalizeBackendMode(nextMode);
    persistMode(activeBackendMode);

    try {
      if (activeBackendMode !== "live") {
        const storedDemoSnapshot = readStoredSnapshot(DEMO_SNAPSHOT_STORAGE_KEY);
        const nextSnapshot = normalizeSnapshotShape(
          storedDemoSnapshot ?? mockSnapshot,
          createTrainingSnapshot(),
        );
        return attachStructuredResult(nextSnapshot, { ok: true, warning: null });
      }

      if (canUseRemoteLiveData()) {
        return loadSupabaseLiveSnapshot();
      }

      const storedLiveSnapshot = readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY);
      const liveSnapshot = normalizeSnapshotShape(storedLiveSnapshot, createLiveSnapshot());

      persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, liveSnapshot);
      return attachStructuredResult(liveSnapshot, { ok: true, warning: null });
    } catch (error) {
      const fallbackSnapshot =
        activeBackendMode === "live"
          ? normalizeSnapshotShape(
              readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY),
              createLiveSnapshot(),
            )
          : normalizeSnapshotShape(
              readStoredSnapshot(DEMO_SNAPSHOT_STORAGE_KEY) ?? mockSnapshot,
              createTrainingSnapshot(),
            );
      const warning =
        activeBackendMode === "live"
          ? "Unable to load the live workspace. Showing the last available workspace."
          : "Unable to load the workspace. Showing the last available workspace.";

      logHandledWarning(warning, error);
      return attachStructuredResult(fallbackSnapshot, { ok: false, warning, error });
    }
  },
};
