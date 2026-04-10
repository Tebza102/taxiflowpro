const TRIP_PREFIX = "trip";
const TRIP_RECORD_TYPE = "income";

const TRACKED_TRIP_FIELDS = [
  { key: "tripDate", label: "Trip date" },
  { key: "tripTime", label: "Trip time" },
  { key: "driverId", label: "Driver" },
  { key: "driverName", label: "Driver name" },
  { key: "vehicleId", label: "Vehicle" },
  { key: "vehicleRegistration", label: "Registration" },
  { key: "routeId", label: "Route" },
  { key: "routeName", label: "Route name" },
  { key: "tripNumber", label: "Trip number" },
  { key: "amount", label: "Amount" },
  { key: "amountClaimed", label: "Takings claimed" },
  { key: "actualCashReceived", label: "Cash received" },
  { key: "notes", label: "Notes" },
  { key: "openingOdo", label: "Opening odometer" },
  { key: "closingOdo", label: "Closing odometer" },
  { key: "timeIn", label: "Time in" },
  { key: "timeOut", label: "Time out" },
  { key: "fromLocation", label: "From" },
  { key: "toLocation", label: "To" },
  { key: "travelReason", label: "Reason" },
  { key: "tripCount", label: "Trip count" },
  { key: "totalPassengers", label: "Passengers" },
  { key: "tripLogbook", label: "Trip logbook" },
];

const cloneValue = (value) => JSON.parse(JSON.stringify(value));

const normalizeText = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const normalizeLookupText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const toFiniteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toDateKey = (value) => {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return normalized.slice(0, 10);
  }

  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toTimeValue = (value) => {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{1,2}:\d{2}/.test(normalized)) {
    return normalized.slice(0, 5);
  }

  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return `${String(parsedDate.getHours()).padStart(2, "0")}:${String(
    parsedDate.getMinutes(),
  ).padStart(2, "0")}`;
};

const normalizeRouteId = (value) => {
  const normalized = normalizeLookupText(value).replace(/\s+/g, "-");
  return normalized ? `route-${normalized}` : null;
};

const buildRecordId = (prefix = TRIP_PREFIX, seed = Date.now()) => {
  const numericSeed = Number(seed);
  const safeSeed = Number.isFinite(numericSeed) ? numericSeed : Date.now();
  return `${prefix}-${safeSeed.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const getFinanceTransactions = (source) =>
  Array.isArray(source) ? source : Array.isArray(source?.financeTransactions) ? source.financeTransactions : [];

const getDrivers = (source = {}, options = {}) =>
  Array.isArray(options.drivers) ? options.drivers : Array.isArray(source.drivers) ? source.drivers : [];

const getVehicles = (source = {}, options = {}) =>
  Array.isArray(options.vehicles) ? options.vehicles : Array.isArray(source.vehicles) ? source.vehicles : [];

const getRoutes = (source = {}, options = {}) =>
  Array.isArray(options.routes) ? options.routes : Array.isArray(source.routes) ? source.routes : [];

const normalizeComparableValue = (value) => {
  if (value == null || value === "") {
    return null;
  }

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return String(value);
};

const buildTripContext = (source = {}, options = {}) => {
  const drivers = getDrivers(source, options);
  const vehicles = getVehicles(source, options);
  const routes = getRoutes(source, options);

  return {
    driversById: new Map(
      drivers
        .map((driver) => [normalizeText(driver.staffId ?? driver.id), driver])
        .filter(([id]) => Boolean(id)),
    ),
    driversByName: new Map(
      drivers
        .map((driver) => [normalizeLookupText(driver.name), driver])
        .filter(([key]) => Boolean(key)),
    ),
    vehiclesById: new Map(
      vehicles
        .map((vehicle) => [normalizeText(vehicle.id), vehicle])
        .filter(([id]) => Boolean(id)),
    ),
    vehiclesByRegistration: new Map(
      vehicles
        .map((vehicle) => [normalizeLookupText(vehicle.registration), vehicle])
        .filter(([key]) => Boolean(key)),
    ),
    routesById: new Map(
      routes
        .map((route) => [normalizeText(route.id ?? route.routeId), route])
        .filter(([id]) => Boolean(id)),
    ),
    routesByName: new Map(
      routes
        .map((route) => [normalizeLookupText(route.name ?? route.route), route])
        .filter(([key]) => Boolean(key)),
    ),
  };
};

const isTripRecord = (record = {}) => record?.type === TRIP_RECORD_TYPE;

// Older snapshots only keep last-edit markers. This bridges them into the new editHistory shape.
const buildLegacyEditEntry = (record, tripId) => {
  const reason = normalizeText(record.lastEditReason);
  const timestamp = normalizeText(record.lastEditedAt ?? record.updatedAt);

  if (!reason && !timestamp) {
    return null;
  }

  return {
    id: `${tripId}-legacy-edit`,
    timestamp,
    reason: reason ?? "Trip record updated",
    summary: normalizeText(record.lastEditSummary) ?? "Trip record updated",
    actorId: normalizeText(record.lastEditedBy ?? record.updatedBy),
    actorName: null,
    actorRole: normalizeText(record.lastEditedByRole ?? record.updatedByRole),
    changes: [],
  };
};

const normalizeEditHistoryEntry = (entry = {}, tripId, index = 0) => ({
  ...entry,
  id: normalizeText(entry.id) ?? `${tripId}-edit-${index + 1}`,
  timestamp: normalizeText(entry.timestamp) ?? null,
  reason: normalizeText(entry.reason) ?? null,
  summary: normalizeText(entry.summary) ?? null,
  actorId: normalizeText(entry.actorId) ?? null,
  actorName: normalizeText(entry.actorName) ?? null,
  actorRole: normalizeText(entry.actorRole) ?? null,
  changes: Array.isArray(entry.changes)
    ? entry.changes.map((change) => ({
        field: normalizeText(change?.field) ?? "field",
        label: normalizeText(change?.label) ?? normalizeText(change?.field) ?? "field",
        before: change?.before ?? null,
        after: change?.after ?? null,
      }))
    : [],
});

const resolveDriverId = (record = {}, context) => {
  const explicitDriverId = normalizeText(record.driverId ?? record.driverStaffId ?? record.driver_staff_id);
  if (explicitDriverId) {
    return explicitDriverId;
  }

  const explicitDriverName = normalizeLookupText(record.driverName ?? record.driver_name);
  if (explicitDriverName && context.driversByName.has(explicitDriverName)) {
    return normalizeText(context.driversByName.get(explicitDriverName)?.staffId);
  }

  const vehicleId = normalizeText(record.vehicleId);
  if (vehicleId && context.vehiclesById.has(vehicleId)) {
    return normalizeText(context.vehiclesById.get(vehicleId)?.assignedDriverId);
  }

  return normalizeText(record.createdByRole) === "Driver" ? normalizeText(record.createdBy) : null;
};

const resolveDriverName = (record = {}, driverId, context) => {
  const explicitDriverName = normalizeText(record.driverName ?? record.driver_name);
  if (explicitDriverName) {
    return explicitDriverName;
  }

  if (driverId && context.driversById.has(driverId)) {
    return normalizeText(context.driversById.get(driverId)?.name);
  }

  const vehicleId = normalizeText(record.vehicleId);
  if (vehicleId && context.vehiclesById.has(vehicleId)) {
    const assignedDriverId = normalizeText(context.vehiclesById.get(vehicleId)?.assignedDriverId);
    if (assignedDriverId && context.driversById.has(assignedDriverId)) {
      return normalizeText(context.driversById.get(assignedDriverId)?.name);
    }
  }

  return null;
};

const resolveVehicleId = (record = {}, context) => {
  const explicitVehicleId = normalizeText(record.vehicleId);
  if (explicitVehicleId) {
    return explicitVehicleId;
  }

  const registrationKey = normalizeLookupText(record.vehicleRegistration ?? record.vehicle);
  if (registrationKey && context.vehiclesByRegistration.has(registrationKey)) {
    return normalizeText(context.vehiclesByRegistration.get(registrationKey)?.id);
  }

  return null;
};

const resolveVehicleRegistration = (record = {}, vehicleId, context) => {
  const explicitRegistration = normalizeText(record.vehicleRegistration ?? record.vehicle);
  if (explicitRegistration) {
    return explicitRegistration;
  }

  if (vehicleId && context.vehiclesById.has(vehicleId)) {
    return normalizeText(context.vehiclesById.get(vehicleId)?.registration);
  }

  return null;
};

const resolveRouteInfo = (record = {}, vehicleId, context) => {
  const explicitRouteId = normalizeText(record.routeId ?? record.currentRouteId ?? record.current_route_id);
  const explicitRouteName = normalizeText(record.routeName ?? record.assignedRoute ?? record.route);

  if (explicitRouteId && context.routesById.has(explicitRouteId)) {
    return {
      routeId: explicitRouteId,
      routeName: explicitRouteName ?? normalizeText(context.routesById.get(explicitRouteId)?.name),
    };
  }

  const routeLookupKey = normalizeLookupText(explicitRouteName);
  if (routeLookupKey && context.routesByName.has(routeLookupKey)) {
    const route = context.routesByName.get(routeLookupKey);
    return {
      routeId: normalizeText(route?.id),
      routeName: explicitRouteName ?? normalizeText(route?.name ?? route?.route),
    };
  }

  if (vehicleId && context.vehiclesById.has(vehicleId)) {
    const vehicle = context.vehiclesById.get(vehicleId);
    const vehicleRouteId = normalizeText(vehicle?.currentRouteId ?? vehicle?.current_route_id);
    const vehicleRouteName = normalizeText(vehicle?.route);

    if (vehicleRouteId || vehicleRouteName) {
      return {
        routeId:
          vehicleRouteId ??
          normalizeText(context.routesByName.get(normalizeLookupText(vehicleRouteName))?.id) ??
          normalizeRouteId(vehicleRouteName),
        routeName: explicitRouteName ?? vehicleRouteName,
      };
    }
  }

  return {
    routeId: explicitRouteId ?? normalizeRouteId(explicitRouteName),
    routeName: explicitRouteName,
  };
};

const resolveTripDate = (record = {}, fallbackTimestamp) =>
  toDateKey(record.tripDate ?? record.trip_date ?? record.timestamp ?? record.createdAt ?? fallbackTimestamp) ??
  toDateKey(fallbackTimestamp);

const resolveTripTime = (record = {}) =>
  toTimeValue(record.tripTime ?? record.timeIn ?? record.time_in ?? record.timestamp ?? record.createdAt);

const resolveTripNotes = (record = {}) =>
  normalizeText(record.notes ?? record.note ?? record.description ?? null);

const buildTripCorrectionFlag = (record = {}, editHistory = []) =>
  Boolean(
    record.correctionFlag ||
      record.edited ||
      record.isEdited ||
      record.isCorrected ||
      (Array.isArray(editHistory) && editHistory.length > 0) ||
      record.lastEditReason ||
      record.updatedAt,
  );

const buildSequenceGroupKey = (trip = {}) => {
  const tripDate = normalizeText(trip.tripDate) ?? "undated";
  const driverId = normalizeText(trip.driverId);
  const vehicleId = normalizeText(trip.vehicleId);

  if (driverId) {
    return `${tripDate}::driver::${driverId}`;
  }

  if (vehicleId) {
    return `${tripDate}::vehicle::${vehicleId}`;
  }

  return `${tripDate}::general`;
};

const getTripSortTimestamp = (trip = {}) =>
  normalizeText(trip.originalCreatedAt ?? trip.createdAt ?? trip.timestamp ?? trip.updatedAt) ?? "";

const assignTripNumbers = (records = []) => {
  const grouped = new Map();

  for (const record of records) {
    if (!isTripRecord(record)) {
      continue;
    }

    const groupKey = buildSequenceGroupKey(record);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(record);
  }

  const tripNumberById = new Map();
  for (const groupRecords of grouped.values()) {
    groupRecords
      .slice()
      .sort((left, right) => {
        const leftTimestamp = getTripSortTimestamp(left);
        const rightTimestamp = getTripSortTimestamp(right);
        return leftTimestamp.localeCompare(rightTimestamp) || String(left.tripId).localeCompare(String(right.tripId));
      })
      .forEach((record, index) => {
        tripNumberById.set(record.tripId, index + 1);
      });
  }

  return records.map((record) =>
    isTripRecord(record) && tripNumberById.has(record.tripId)
      ? {
          ...record,
          tripNumber: tripNumberById.get(record.tripId),
        }
      : record,
  );
};

const normalizeBaseTripRecord = (record = {}, context, fallbackTimestamp = new Date().toISOString()) => {
  const tripId = normalizeText(record.tripId ?? record.id) ?? buildRecordId(TRIP_PREFIX);
  const createdAt = normalizeText(record.createdAt ?? record.timestamp) ?? fallbackTimestamp;
  const originalCreatedAt = normalizeText(record.originalCreatedAt) ?? createdAt;
  const driverId = resolveDriverId(record, context);
  const driverName = resolveDriverName(record, driverId, context);
  const vehicleId = resolveVehicleId(record, context);
  const vehicleRegistration = resolveVehicleRegistration(record, vehicleId, context);
  const routeInfo = resolveRouteInfo(record, vehicleId, context);
  const legacyEditEntry = buildLegacyEditEntry(record, tripId);
  const editHistorySource = Array.isArray(record.editHistory) ? record.editHistory : [];
  const normalizedEditHistory = [
    ...editHistorySource.map((entry, index) => normalizeEditHistoryEntry(entry, tripId, index)),
    ...(editHistorySource.length === 0 && legacyEditEntry ? [legacyEditEntry] : []),
  ];
  const correctionFlag = buildTripCorrectionFlag(record, normalizedEditHistory);

  return {
    ...record,
    id: normalizeText(record.id) ?? tripId,
    tripId,
    tripDate: resolveTripDate(record, originalCreatedAt),
    tripTime: resolveTripTime(record),
    driverId,
    driverStaffId: normalizeText(record.driverStaffId ?? record.driver_staff_id ?? driverId),
    driverName,
    vehicleId,
    vehicleRegistration,
    vehicle: normalizeText(record.vehicle) ?? vehicleRegistration,
    routeId: routeInfo.routeId,
    routeName: routeInfo.routeName,
    route: normalizeText(record.route) ?? routeInfo.routeName,
    tripNumber:
      Number.isInteger(Number(record.tripNumber)) && Number(record.tripNumber) > 0
        ? Number(record.tripNumber)
        : null,
    amount: toFiniteNumber(record.amount),
    amountClaimed: toFiniteNumber(record.amountClaimed ?? record.amount_claimed ?? record.amount),
    actualCashReceived: toFiniteNumber(record.actualCashReceived),
    notes: resolveTripNotes(record),
    createdBy: normalizeText(record.createdBy) ?? null,
    updatedBy: normalizeText(record.updatedBy) ?? null,
    updatedAt: normalizeText(record.updatedAt) ?? null,
    createdAt,
    originalCreatedAt,
    correctionFlag,
    editHistory: normalizedEditHistory,
  };
};

// The helpers accept either a full snapshot object or a raw financeTransactions array.
const normalizeTripCollection = (source, options = {}) => {
  const records = getFinanceTransactions(source);
  const context = buildTripContext(
    Array.isArray(source) ? options.source ?? {} : source ?? {},
    options,
  );
  const normalizedRecords = records.map((record) =>
    isTripRecord(record) ? normalizeBaseTripRecord(record, context) : record,
  );

  return assignTripNumbers(normalizedRecords);
};

const buildTripChangeSet = (previousRecord, nextRecord) =>
  TRACKED_TRIP_FIELDS.reduce((changes, { key, label }) => {
    const previousValue = previousRecord?.[key] ?? null;
    const nextValue = nextRecord?.[key] ?? null;

    if (normalizeComparableValue(previousValue) === normalizeComparableValue(nextValue)) {
      return changes;
    }

    changes.push({
      field: key,
      label,
      before: cloneValue(previousValue),
      after: cloneValue(nextValue),
    });
    return changes;
  }, []);

const summarizeTripChanges = (changes = []) =>
  changes.length === 0 ? "No tracked values changed." : changes.map((change) => change.label).join(" / ");

const matchesTripFilter = (trip, candidate, values) => {
  const normalizedCandidate = normalizeLookupText(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return values.some((value) => {
    const normalizedValue = normalizeLookupText(value);
    return Boolean(normalizedValue) && normalizedValue.includes(normalizedCandidate);
  });
};

export const createTripRecord = (record = {}, options = {}) => {
  const source = Array.isArray(options.source) ? { financeTransactions: options.source } : options.source ?? {};
  const context = buildTripContext(source, options);
  const timestamp = normalizeText(options.timestamp) ?? new Date().toISOString();
  const actorId = normalizeText(options.actorId ?? record.createdBy) ?? null;
  const actorRole = normalizeText(options.actorRole ?? record.createdByRole) ?? null;
  const baseRecord = normalizeBaseTripRecord(
    {
      type: TRIP_RECORD_TYPE,
      ...record,
      id: normalizeText(record.id ?? record.tripId) ?? buildRecordId(TRIP_PREFIX),
      tripId: normalizeText(record.tripId ?? record.id),
      createdAt: normalizeText(record.createdAt) ?? timestamp,
      originalCreatedAt: normalizeText(record.originalCreatedAt) ?? normalizeText(record.createdAt) ?? timestamp,
      createdBy: actorId ?? normalizeText(record.createdBy),
      createdByRole: actorRole ?? normalizeText(record.createdByRole),
      updatedBy: normalizeText(record.updatedBy) ?? null,
      updatedAt: normalizeText(record.updatedAt) ?? null,
      correctionFlag: Boolean(record.correctionFlag),
    },
    context,
    timestamp,
  );
  const existingTrips = getFinanceTransactions(options.existingTrips ?? source).filter(
    (entry) => isTripRecord(entry) && normalizeText(entry.tripId ?? entry.id) !== baseRecord.tripId,
  );
  const normalizedCollection = normalizeTripCollection(
    {
      ...source,
      financeTransactions: [...existingTrips, baseRecord],
    },
    options,
  );

  return normalizedCollection.find((entry) => entry.tripId === baseRecord.tripId) ?? baseRecord;
};

export const updateTripRecord = (existingRecord, updates = {}, options = {}) => {
  if (!isTripRecord(existingRecord)) {
    throw new Error("updateTripRecord expects an income trip record.");
  }

  const source = Array.isArray(options.source) ? { financeTransactions: options.source } : options.source ?? {};
  const context = buildTripContext(source, options);
  const timestamp = normalizeText(options.timestamp) ?? new Date().toISOString();
  const previousRecord = normalizeBaseTripRecord(existingRecord, context, timestamp);
  const candidateRecord = normalizeBaseTripRecord(
    {
      ...existingRecord,
      ...updates,
      id: previousRecord.id,
      tripId: previousRecord.tripId,
      createdAt: previousRecord.createdAt,
      originalCreatedAt: previousRecord.originalCreatedAt,
      createdBy: previousRecord.createdBy,
      createdByRole: existingRecord.createdByRole ?? updates.createdByRole ?? null,
    },
    context,
    timestamp,
  );
  const changes = buildTripChangeSet(previousRecord, candidateRecord);

  if (changes.length === 0) {
    return createTripRecord(candidateRecord, {
      ...options,
      source,
      existingTrips: options.existingTrips ?? source,
      timestamp,
    });
  }

  const actorId = normalizeText(options.actorId ?? updates.updatedBy ?? previousRecord.updatedBy) ?? null;
  const actorName = normalizeText(options.actorName) ?? null;
  const actorRole = normalizeText(options.actorRole ?? updates.updatedByRole) ?? null;
  const reason = normalizeText(options.reason ?? updates.editReason) ?? "Trip corrected";
  const editEntry = normalizeEditHistoryEntry(
    {
      id: buildRecordId(`${previousRecord.tripId}-edit`, timestamp),
      timestamp,
      reason,
      summary: summarizeTripChanges(changes),
      actorId,
      actorName,
      actorRole,
      changes,
    },
    previousRecord.tripId,
  );

  return createTripRecord(
    {
      ...candidateRecord,
      updatedBy: actorId,
      updatedByRole: actorRole,
      updatedAt: timestamp,
      correctionFlag: true,
      editHistory: [editEntry, ...(Array.isArray(previousRecord.editHistory) ? previousRecord.editHistory : [])],
      lastEditReason: editEntry.reason,
      lastEditSummary: editEntry.summary,
      lastEditedAt: timestamp,
      lastEditedBy: actorId,
      lastEditedByRole: actorRole,
    },
    {
      ...options,
      source,
      existingTrips: options.existingTrips ?? source,
      timestamp,
    },
  );
};

export const getTripRecords = (source, options = {}) =>
  normalizeTripCollection(source, options).filter(isTripRecord);

export const getTripsByDate = (source, tripDate, options = {}) => {
  const targetDate = toDateKey(tripDate);

  if (!targetDate) {
    return [];
  }

  return getTripRecords(source, options).filter((trip) => trip.tripDate === targetDate);
};

export const getTripsByDateRange = (source, startDate, endDate = startDate, options = {}) => {
  const start = toDateKey(startDate);
  const end = toDateKey(endDate);

  if (!start || !end) {
    return [];
  }

  const lower = start <= end ? start : end;
  const upper = start <= end ? end : start;

  return getTripRecords(source, options).filter(
    (trip) => trip.tripDate != null && trip.tripDate >= lower && trip.tripDate <= upper,
  );
};

export const getTripsByDriver = (source, driverCandidate, options = {}) =>
  getTripRecords(source, options).filter((trip) =>
    matchesTripFilter(trip, driverCandidate, [trip.driverId, trip.driverName]),
  );

export const getTripsByVehicle = (source, vehicleCandidate, options = {}) =>
  getTripRecords(source, options).filter((trip) =>
    matchesTripFilter(trip, vehicleCandidate, [trip.vehicleId, trip.vehicleRegistration, trip.vehicle]),
  );

export const normalizeTripFinanceTransactions = (financeTransactions = [], options = {}) =>
  normalizeTripCollection(financeTransactions, options);
