import { mockSnapshot } from "../data/mockData";
import { configuredBackendMode, hasSupabaseConfig, supabase } from "./supabaseClient";

const DATA_MODE_STORAGE_KEY = "taxiflow-data-mode-v2";
const DEMO_SNAPSHOT_STORAGE_KEY = "taxiflow-demo-snapshot-v1";
const LIVE_SNAPSHOT_STORAGE_KEY = "taxiflow-live-snapshot-v1";
const LIVE_WORKSPACE_KEY = "taxiflow-live";

const normalizeBackendMode = (value) =>
  String(value ?? "mock").trim().toLowerCase() === "live" ? "live" : "mock";

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));

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
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
};

const readStoredSnapshot = (storageKey) => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const persistStoredSnapshot = (storageKey, snapshot) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
};

const clearStoredSnapshot = (storageKey) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures.
  }
};

const canUseRemoteLiveData = () => hasSupabaseConfig && Boolean(supabase);

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
  const liveDefaults = createLiveSnapshot();

  if (!session) {
    return normalizeSnapshotShape(cachedSnapshot, liveDefaults);
  }

  const { data, error } = await supabase
    .from("workspace_snapshots")
    .select("snapshot")
    .eq("workspace_key", LIVE_WORKSPACE_KEY)
    .maybeSingle();

  if (error) {
    console.error("Unable to load the live workspace from Supabase.", error);
    return normalizeSnapshotShape(cachedSnapshot, liveDefaults);
  }

  const nextSnapshot = normalizeSnapshotShape(
    data?.snapshot ?? cachedSnapshot ?? liveDefaults,
    liveDefaults,
  );
  persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, nextSnapshot);

  if (!data?.snapshot) {
    await persistSupabaseLiveSnapshot(nextSnapshot, session.user.id);
  }

  return cloneSnapshot(nextSnapshot);
};

const persistSupabaseLiveSnapshot = async (snapshot, actorId = null) => {
  if (!canUseRemoteLiveData() || !snapshot) {
    return;
  }

  const session = await getSupabaseSession();

  if (!session) {
    return;
  }

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
    console.error("Unable to persist the live workspace to Supabase.", error);
  }
};

let activeBackendMode = normalizeBackendMode(readStoredMode() ?? configuredBackendMode);
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
    persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, nextSnapshot);

    if (canUseRemoteLiveData()) {
      persistSupabaseLiveSnapshot(nextSnapshot);
    }

    return cloneSnapshot(nextSnapshot);
  },
  async persistSnapshot(snapshot, mode = activeBackendMode) {
    if (!snapshot) {
      return;
    }

    const normalizedMode = normalizeBackendMode(mode);
    const storageKey =
      normalizedMode === "live" ? LIVE_SNAPSHOT_STORAGE_KEY : DEMO_SNAPSHOT_STORAGE_KEY;
    const defaults =
      normalizedMode === "live" ? createLiveSnapshot() : createTrainingSnapshot();
    const nextSnapshot = normalizeSnapshotShape(snapshot, defaults);

    persistStoredSnapshot(storageKey, nextSnapshot);

    if (normalizedMode === "live" && canUseRemoteLiveData()) {
      await persistSupabaseLiveSnapshot(nextSnapshot);
    }
  },
  async loadSnapshot(nextMode = activeBackendMode) {
    activeBackendMode = normalizeBackendMode(nextMode);
    persistMode(activeBackendMode);

    if (activeBackendMode !== "live") {
      const storedDemoSnapshot = readStoredSnapshot(DEMO_SNAPSHOT_STORAGE_KEY);
      return normalizeSnapshotShape(storedDemoSnapshot ?? mockSnapshot, mockSnapshot);
    }

    if (canUseRemoteLiveData()) {
      return loadSupabaseLiveSnapshot();
    }

    const storedLiveSnapshot = readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY);
    const liveSnapshot = normalizeSnapshotShape(storedLiveSnapshot, createLiveSnapshot());

    persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, liveSnapshot);
    return liveSnapshot;
  },
};
