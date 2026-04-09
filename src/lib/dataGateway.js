import { mockSnapshot } from "../data/mockData";
import { configuredBackendMode, hasSupabaseConfig, supabase } from "./supabaseClient";

const DATA_MODE_STORAGE_KEY = "taxiflow-data-mode-v2";
const DEMO_SNAPSHOT_STORAGE_KEY = "taxiflow-demo-snapshot-v1";
const LIVE_SNAPSHOT_STORAGE_KEY = "taxiflow-live-snapshot-v1";
const LIVE_PENDING_SNAPSHOT_STORAGE_KEY = "taxiflow-live-pending-snapshot-v1";
const DEMO_SNAPSHOT_BACKUP_STORAGE_KEY = "taxiflow-demo-snapshot-backup-v1";
const LIVE_SNAPSHOT_BACKUP_STORAGE_KEY = "taxiflow-live-snapshot-backup-v1";
const LIVE_WORKSPACE_KEY = "taxiflow-live";

const normalizeBackendMode = (value) =>
  String(value ?? "mock").trim().toLowerCase() === "live" ? "live" : "mock";

const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));
const IS_DEV = Boolean(import.meta.env?.DEV);
const normalizeRouteReference = (route) => {
  const normalizedRoute = String(route ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedRoute ? `route-${normalizedRoute}` : null;
};

const normalizeVehicleCapabilityFields = (vehicle = {}) => {
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
      normalizeRouteReference(vehicle.route),
  };
};

const normalizeDailyCashUpIdToken = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildDailyCashUpId = (entry = {}, index = 0) => {
  const explicitId = String(entry.id ?? "").trim();

  if (explicitId) {
    return explicitId;
  }

  const idParts = [
    normalizeDailyCashUpIdToken(entry.driverStaffId ?? entry.driver_staff_id),
    normalizeDailyCashUpIdToken(entry.workDate ?? entry.work_date),
    normalizeDailyCashUpIdToken(entry.checkedAt ?? entry.updatedAt ?? entry.createdAt),
  ].filter(Boolean);

  return idParts.length > 0 ? `cashup-${idParts.join("-")}` : `cashup-${index + 1}`;
};

const normalizeDailyCashUpRecord = (entry = {}, index = 0) => {
  const driverStaffId = String(entry.driverStaffId ?? entry.driver_staff_id ?? "").trim();
  const driverName = String(entry.driverName ?? entry.driver_name ?? "").trim();
  const workDate = String(entry.workDate ?? entry.work_date ?? "").trim();
  const status = String(entry.status ?? "pending").trim().toLowerCase();
  const normalizedStatus = ["pending", "counted", "verified", "banked"].includes(status)
    ? status
    : "pending";
  const actualCashReceived = Number(entry.actualCashReceived);

  return {
    ...entry,
    id: buildDailyCashUpId(entry, index),
    driverStaffId: driverStaffId || null,
    driverName: driverName || null,
    workDate: workDate || null,
    incomeRecordIds: Array.isArray(entry.incomeRecordIds) ? entry.incomeRecordIds : [],
    expenseRecordIds: Array.isArray(entry.expenseRecordIds) ? entry.expenseRecordIds : [],
    status: normalizedStatus,
    actualCashReceived: Number.isFinite(actualCashReceived) ? actualCashReceived : null,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    countedAt: entry.countedAt ?? null,
    verifiedAt: entry.verifiedAt ?? null,
    bankedAt: entry.bankedAt ?? null,
  };
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
  `${routeId ?? "route"}-point-${normalizeRouteReference(pointLabel)?.replace(/^route-/, "") ?? sequence}`;

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
    normalizeRouteReference(name);
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

const collectRouteMasterRecords = (source = {}, defaultRoutes = []) => {
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

  (Array.isArray(defaultRoutes) ? defaultRoutes : []).forEach(addRoute);
  (Array.isArray(source.routes) ? source.routes : []).forEach(addRoute);
  (Array.isArray(source.vehicles) ? source.vehicles : []).forEach((vehicle) =>
    addRoute({
      id:
        String(vehicle.currentRouteId ?? vehicle.current_route_id ?? "").trim() ||
        normalizeRouteReference(vehicle.route),
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
    expenseCatalog: {
      asset: [],
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
  routes: [],
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
  dailyCashUps: [],
  passwordResetRequests: [],
  emailOutbox: [],
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
      expenseCatalog: {
        ...cloneSnapshot(defaults.finance.expenseCatalog),
        ...(snapshot.finance?.expenseCatalog ?? {}),
        asset: Array.isArray(snapshot.finance?.expenseCatalog?.asset)
          ? snapshot.finance.expenseCatalog.asset
          : cloneSnapshot(defaults.finance.expenseCatalog.asset),
        operational: Array.isArray(snapshot.finance?.expenseCatalog?.operational)
          ? snapshot.finance.expenseCatalog.operational
          : cloneSnapshot(defaults.finance.expenseCatalog.operational),
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
    routes: collectRouteMasterRecords(snapshot, cloneSnapshot(defaults.routes ?? [])),
    vehicles: Array.isArray(snapshot.vehicles)
      ? snapshot.vehicles.map((vehicle) => normalizeVehicleCapabilityFields(vehicle))
      : cloneSnapshot(defaults.vehicles),
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
    dailyCashUps: Array.isArray(snapshot.dailyCashUps)
      ? snapshot.dailyCashUps.map((entry, index) => normalizeDailyCashUpRecord(entry, index))
      : cloneSnapshot(defaults.dailyCashUps),
    passwordResetRequests: Array.isArray(snapshot.passwordResetRequests)
      ? snapshot.passwordResetRequests
      : cloneSnapshot(defaults.passwordResetRequests),
    emailOutbox: Array.isArray(snapshot.emailOutbox)
      ? snapshot.emailOutbox
      : cloneSnapshot(defaults.emailOutbox),
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

const getBackupStorageKey = (storageKey) => {
  if (storageKey === LIVE_SNAPSHOT_STORAGE_KEY) {
    return LIVE_SNAPSHOT_BACKUP_STORAGE_KEY;
  }

  if (storageKey === DEMO_SNAPSHOT_STORAGE_KEY) {
    return DEMO_SNAPSHOT_BACKUP_STORAGE_KEY;
  }

  return null;
};

const hasMeaningfulWorkspaceData = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  return [
    snapshot.financeTransactions,
    snapshot.deposits,
    snapshot.routes,
    snapshot.vehicles,
    snapshot.drivers,
    snapshot.defects,
    snapshot.auditTrail,
    snapshot.dailyCashUps,
    snapshot.passwordResetRequests,
    snapshot.emailOutbox,
    snapshot.appUsers,
  ].some((collection) => Array.isArray(collection) && collection.length > 0);
};

const selectRetainedSnapshot = (candidates = [], defaults = null) => {
  const availableCandidates = candidates.filter((candidate) => candidate != null);
  const meaningfulCandidate = availableCandidates.find((candidate) =>
    hasMeaningfulWorkspaceData(candidate),
  );

  if (meaningfulCandidate) {
    return meaningfulCandidate;
  }

  return availableCandidates[0] ?? defaults;
};

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
    const backupStorageKey = getBackupStorageKey(storageKey);

    if (backupStorageKey && hasMeaningfulWorkspaceData(snapshot)) {
      window.localStorage.setItem(backupStorageKey, JSON.stringify(snapshot));
    }

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
  const backupSnapshot = readStoredSnapshot(LIVE_SNAPSHOT_BACKUP_STORAGE_KEY);
  const pendingSnapshot = readPendingLiveSnapshot();
  const liveDefaults = createLiveSnapshot();

  if (!session) {
    const fallbackSnapshot = normalizeSnapshotShape(
      selectRetainedSnapshot([pendingSnapshot, cachedSnapshot, backupSnapshot], liveDefaults),
      liveDefaults,
    );
    const warning = pendingSnapshot
      ? "Live session unavailable. Showing unsynced live changes until they can be saved."
      : cachedSnapshot
        ? "Live session unavailable. Showing the last available local workspace."
        : backupSnapshot
          ? "Live session unavailable. Restored the last retained local workspace backup."
        : "Live session unavailable. Showing a fresh live workspace.";

    logHandledWarning(warning);
    return attachStructuredResult(cloneSnapshot(fallbackSnapshot), { ok: false, warning });
  }

  try {
    if (pendingSnapshot) {
      const nextSnapshot = normalizeSnapshotShape(
        selectRetainedSnapshot([pendingSnapshot, cachedSnapshot, backupSnapshot], liveDefaults),
        liveDefaults,
      );
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
      const fallbackSnapshot = normalizeSnapshotShape(
        selectRetainedSnapshot([cachedSnapshot, backupSnapshot], liveDefaults),
        liveDefaults,
      );
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
      selectRetainedSnapshot([data?.snapshot, cachedSnapshot, backupSnapshot], liveDefaults),
      liveDefaults,
    );
    persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, nextSnapshot);

    let warning = null;
    let handledError = null;
    if (!hasMeaningfulWorkspaceData(data?.snapshot) && hasMeaningfulWorkspaceData(nextSnapshot)) {
      const persistResult = await persistSupabaseLiveSnapshot(nextSnapshot, session.user.id);
      warning =
        persistResult.warning ??
        "Recovered the last retained live workspace instead of replacing it with a blank workspace.";
      handledError = persistResult.error;
    }

    return attachStructuredResult(cloneSnapshot(nextSnapshot), {
      ok: true,
      warning,
      error: handledError,
    });
  } catch (error) {
    const fallbackSnapshot = normalizeSnapshotShape(
      selectRetainedSnapshot([cachedSnapshot, backupSnapshot], liveDefaults),
      liveDefaults,
    );
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
    const backupStorageKey = getBackupStorageKey(storageKey);

    clearStoredSnapshot(storageKey);
    if (backupStorageKey) {
      clearStoredSnapshot(backupStorageKey);
    }
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
    clearStoredSnapshot(LIVE_SNAPSHOT_BACKUP_STORAGE_KEY);
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

    const nextSnapshot = normalizeSnapshotShape(
      selectRetainedSnapshot(
        [
          pendingSnapshot,
          readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY),
          readStoredSnapshot(LIVE_SNAPSHOT_BACKUP_STORAGE_KEY),
        ],
        createLiveSnapshot(),
      ),
      createLiveSnapshot(),
    );
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
        const backupDemoSnapshot = readStoredSnapshot(DEMO_SNAPSHOT_BACKUP_STORAGE_KEY);
        const nextSnapshot = normalizeSnapshotShape(
          selectRetainedSnapshot([storedDemoSnapshot, backupDemoSnapshot, mockSnapshot], mockSnapshot),
          createTrainingSnapshot(),
        );
        return attachStructuredResult(nextSnapshot, { ok: true, warning: null });
      }

      if (canUseRemoteLiveData()) {
        return loadSupabaseLiveSnapshot();
      }

      const storedLiveSnapshot = readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY);
      const backupLiveSnapshot = readStoredSnapshot(LIVE_SNAPSHOT_BACKUP_STORAGE_KEY);
      const liveSnapshot = normalizeSnapshotShape(
        selectRetainedSnapshot([storedLiveSnapshot, backupLiveSnapshot], createLiveSnapshot()),
        createLiveSnapshot(),
      );

      persistStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY, liveSnapshot);
      return attachStructuredResult(liveSnapshot, { ok: true, warning: null });
    } catch (error) {
      const fallbackSnapshot =
        activeBackendMode === "live"
          ? normalizeSnapshotShape(
              selectRetainedSnapshot(
                [
                  readStoredSnapshot(LIVE_SNAPSHOT_STORAGE_KEY),
                  readStoredSnapshot(LIVE_SNAPSHOT_BACKUP_STORAGE_KEY),
                ],
                createLiveSnapshot(),
              ),
              createLiveSnapshot(),
            )
          : normalizeSnapshotShape(
              selectRetainedSnapshot(
                [
                  readStoredSnapshot(DEMO_SNAPSHOT_STORAGE_KEY),
                  readStoredSnapshot(DEMO_SNAPSHOT_BACKUP_STORAGE_KEY),
                  mockSnapshot,
                ],
                mockSnapshot,
              ),
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
