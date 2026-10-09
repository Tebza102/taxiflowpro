import {
  getExpectedOpeningOdo,
  getFinanceRecordDriverStaffId,
} from "../../src/lib/cashUpContract.js";
import { normalizeModuleViewAccess, normalizeRole } from "../../src/lib/moduleAccessPolicy.js";

// Server-mediated access to the single workspace_snapshots row for accounts that
// the database rule (supabase/migrations/*_restrict_workspace_snapshots_*.sql)
// does not let read the row directly:
//   - "driver": an active Driver. Sees own records plus operational data; can
//     save only own capture (always as pending), day cash-up submission, new
//     defects, own audit events and own terminal selection.
//   - "management-no-finance": an active Admin/Manager whose Money access is off.
//     Sees and edits everything except finance, which stays as stored (they may
//     only append the expenses their own actions create, e.g. a defect repair).
//   - "full": Owner, or Admin/Manager with Money on. Same rule as the database
//     policy; these accounts use the table directly.
// Across every scope, appUsers is always kept exactly as stored: account changes
// go through the lifecycle API only (the database trigger that normally enforces
// this does not apply to the service-role writes made here).

export const WORKSPACE_SCOPES = Object.freeze({
  FULL: "full",
  DRIVER: "driver",
  NO_FINANCE: "management-no-finance",
});

const VEHICLE_FINANCE_FIELDS = ["vehicleLedger", "verifiedRevenue", "netYield", "assetExpenseTotal"];
const STAFF_FINANCE_FIELDS = ["cashAccuracy", "avgShiftRevenue"];
const PROFILE_FINANCE_FIELDS = ["monthlyTarget"];
const RECORD_MANAGEMENT_FIELDS = [
  "actualCashReceived",
  "countedAt",
  "countedBy",
  "countedByRole",
  "verifiedAt",
  "verifiedBy",
  "verifiedByRole",
  "depositId",
  "bankedAt",
];
const RECORD_OWNERSHIP_FIELDS = ["createdBy", "createdByRole", "driverStaffId", "createdAt"];
const DRIVER_VIEW_KEYS = [
  "profile",
  "routes",
  "vehicles",
  "drivers",
  "defects",
  "documents",
  "serviceSchedule",
  "operationsLoop",
];
const NO_FINANCE_WRITABLE_KEYS = [
  "profile",
  "routes",
  "vehicles",
  "drivers",
  "defects",
  "documents",
  "serviceSchedule",
  "operationsLoop",
  "passwordResetRequests",
  "emailOutbox",
];
const EMPTY_COLLECTIONS = ["deposits", "verificationQueue", "passwordResetRequests", "emailOutbox"];

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const text = (value) => String(value ?? "").trim() || null;
const asArray = (value) => (Array.isArray(value) ? value : []);
const omit = (record, fields) =>
  Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => !fields.includes(key)));
const pick = (record, fields) =>
  Object.fromEntries(fields.filter((key) => record && key in record).map((key) => [key, record[key]]));
// Key-order-insensitive comparison: the browser's normalisation may rebuild
// records with the same content in a different key order.
const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};
const same = (left, right, ignoredFields = []) =>
  stableStringify(omit(left, ignoredFields)) === stableStringify(omit(right, ignoredFields));
// Derived on every load; a difference here alone is not an edit.
const DERIVED_RECORD_FIELDS = ["tripNumber", "discrepancy"];
const byId = (records, key = "id") => new Map(asArray(records).map((record) => [record?.[key], record]));

export const findActiveMember = (snapshot, email) => {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  const member = asArray(snapshot?.appUsers).find(
    (user) => String(user?.email ?? "").trim().toLowerCase() === normalizedEmail,
  );

  return member && member.active !== false ? member : null;
};

// Mirrors the database rule taxiflow_can_access_workspace_directly(): FULL is
// exactly the set of accounts that rule admits.
export const resolveWorkspaceScope = (member) => {
  if (!member || member.active === false) {
    return null;
  }

  const role = normalizeRole(member.role);

  if (role === "Owner") {
    return WORKSPACE_SCOPES.FULL;
  }

  if (role === "Admin" || role === "Manager") {
    return normalizeModuleViewAccess(member.moduleAccess, role).finance
      ? WORKSPACE_SCOPES.FULL
      : WORKSPACE_SCOPES.NO_FINANCE;
  }

  if (role === "Driver" && text(member.staffId)) {
    return WORKSPACE_SCOPES.DRIVER;
  }

  return null;
};

const memberActorIds = (member) =>
  new Set([text(member?.actorId), text(member?.staffId)].filter(Boolean));

const stripVehicle = (vehicle) => omit(vehicle, VEHICLE_FINANCE_FIELDS);
const stripStaff = (staff) => omit(staff, STAFF_FINANCE_FIELDS);
const stripProfile = (profile) => (profile ? omit(profile, PROFILE_FINANCE_FIELDS) : profile);
const restrictedFinance = (finance) =>
  finance?.expenseCatalog === undefined ? {} : { expenseCatalog: clone(finance.expenseCatalog) };

const isOwnedByDriver = (record, staffId) => getFinanceRecordDriverStaffId(record) === staffId;
const isDriverWritable = (record, staffId) =>
  record?.createdByRole === "Driver" && isOwnedByDriver(record, staffId);

// The other driver's latest reading on a shared vehicle: odometer and time only,
// so the Driver's opening-odometer prefill stays correct without any amounts.
const buildOdometerAnchors = (transactions, staffId) => {
  const latestByVehicle = new Map();

  asArray(transactions)
    .filter((record) => record.type === "income" && record.incomeKind === "standard" && record.vehicleId)
    .forEach((record) => {
      const current = latestByVehicle.get(record.vehicleId);
      if (!current || new Date(record.timestamp) > new Date(current.timestamp)) {
        latestByVehicle.set(record.vehicleId, record);
      }
    });

  return [...latestByVehicle.values()]
    .filter((record) => !isOwnedByDriver(record, staffId))
    .map((record) => ({
      id: record.id,
      type: "income",
      incomeKind: "standard",
      vehicleId: record.vehicleId,
      vehicle: record.vehicle ?? null,
      tripDate: record.tripDate ?? null,
      timestamp: record.timestamp ?? null,
      openingOdo: record.openingOdo ?? null,
      closingOdo: record.closingOdo ?? null,
      // A sentinel owner so the browser never attributes the anchor to anyone.
      driverStaffId: "odometer-anchor",
      createdByRole: "System",
      odometerAnchor: true,
    }));
};

const projectDriverTerminal = (terminal, staffId) => {
  if (!terminal) {
    return terminal;
  }

  const own = text(terminal.activeDriverId) === staffId;

  return { ...clone(terminal), dayCashSummary: null, ...(own ? {} : { lastShift: null }) };
};

const projectForDriver = (stored, member) => {
  const staffId = text(member.staffId);
  const actorIds = memberActorIds(member);
  const view = {};

  DRIVER_VIEW_KEYS.forEach((key) => {
    if (stored[key] !== undefined) {
      view[key] = clone(stored[key]);
    }
  });

  view.profile = stripProfile(view.profile);
  view.vehicles = asArray(view.vehicles).map(stripVehicle);
  view.drivers = asArray(view.drivers).map(stripStaff);
  view.driverTerminal = projectDriverTerminal(stored.driverTerminal, staffId);
  view.finance = restrictedFinance(stored.finance);
  view.financeTransactions = [
    ...clone(asArray(stored.financeTransactions).filter((record) => isOwnedByDriver(record, staffId))),
    ...buildOdometerAnchors(stored.financeTransactions, staffId),
  ];
  view.dailyCashUps = clone(asArray(stored.dailyCashUps).filter((entry) => text(entry.driverStaffId) === staffId));
  view.auditTrail = clone(asArray(stored.auditTrail).filter((event) => actorIds.has(text(event.actorId))));
  view.appUsers = [clone(member)];
  EMPTY_COLLECTIONS.forEach((key) => {
    view[key] = [];
  });

  return view;
};

const projectForNoFinance = (stored) => {
  const view = clone(stored);

  view.profile = stripProfile(view.profile);
  view.vehicles = asArray(view.vehicles).map(stripVehicle);
  view.drivers = asArray(view.drivers).map(stripStaff);
  view.driverTerminal = view.driverTerminal
    ? { ...view.driverTerminal, dayCashSummary: null, lastShift: null }
    : view.driverTerminal;
  view.finance = restrictedFinance(stored.finance);
  view.financeTransactions = [];
  view.dailyCashUps = [];
  view.deposits = [];
  view.verificationQueue = [];
  view.auditTrail = asArray(view.auditTrail).filter((event) => event?.scope !== "finance");

  return view;
};

export const projectWorkspace = (stored, member, scope) => {
  if (scope === WORKSPACE_SCOPES.DRIVER) {
    return projectForDriver(stored ?? {}, member);
  }
  if (scope === WORKSPACE_SCOPES.NO_FINANCE) {
    return projectForNoFinance(stored ?? {});
  }
  if (scope === WORKSPACE_SCOPES.FULL) {
    return clone(stored);
  }

  throw new Error(`Unknown workspace scope: ${scope}`);
};

// A driver may reset a record to pending by editing it (the app does exactly
// that), but can never set, keep or change the count, verification or banking.
const lockManagementFields = (proposed, stored) => {
  if (!stored || proposed.status === "pending") {
    return {
      ...proposed,
      status: "pending",
      ...Object.fromEntries(RECORD_MANAGEMENT_FIELDS.map((field) => [field, null])),
    };
  }

  return { ...proposed, status: stored.status, ...pick(stored, RECORD_MANAGEMENT_FIELDS) };
};

// discrepancy is recomputed from the FULL record set: the driver's view only has
// the odometer anchor, and the flag must not be client-controlled.
const withServerDiscrepancy = (record, transactions, vehicles) =>
  record.type === "income" && record.incomeKind === "standard" && record.vehicleId
    ? {
        ...record,
        discrepancy:
          Number(record.openingOdo) !==
          getExpectedOpeningOdo(transactions, vehicles, record.vehicleId, record.id),
      }
    : record;

const mergeDriverTransactions = (stored, proposedRecords, staffId) => {
  const storedById = byId(stored.financeTransactions);
  const next = clone(asArray(stored.financeTransactions));
  const indexById = new Map(next.map((record, index) => [record.id, index]));
  const accepted = [];

  asArray(proposedRecords)
    .filter((record) => record && !record.odometerAnchor && text(record.id))
    .forEach((proposed) => {
      const existing = storedById.get(proposed.id);

      if (existing) {
        if (
          !isDriverWritable(existing, staffId) ||
          existing.status === "banked" ||
          same(existing, proposed, DERIVED_RECORD_FIELDS)
        ) {
          return;
        }

        const updated = lockManagementFields(
          { ...proposed, ...pick(existing, RECORD_OWNERSHIP_FIELDS) },
          existing,
        );
        next[indexById.get(proposed.id)] = updated;
        accepted.push(updated.id);
        return;
      }

      if (!isDriverWritable(proposed, staffId)) {
        return;
      }

      const created = lockManagementFields({ ...proposed, createdByRole: "Driver" }, null);
      indexById.set(created.id, next.length);
      next.push(created);
      accepted.push(created.id);
    });

  // Recompute discrepancy after all changes are in place, using every record.
  accepted.forEach((id) => {
    const index = indexById.get(id);
    next[index] = withServerDiscrepancy(next[index], next, asArray(stored.vehicles));
  });

  return next;
};

const mergeDriverCashUps = (stored, proposedEntries, staffId) => {
  const storedById = byId(stored.dailyCashUps);
  const next = clone(asArray(stored.dailyCashUps));
  const indexById = new Map(next.map((entry, index) => [entry.id, index]));

  asArray(proposedEntries)
    .filter((entry) => entry && text(entry.id) && text(entry.driverStaffId) === staffId)
    .forEach((proposed) => {
      const existing = storedById.get(proposed.id);

      if (existing) {
        if (text(existing.driverStaffId) !== staffId || existing.status === "banked" || same(existing, proposed)) {
          return;
        }
        next[indexById.get(proposed.id)] = lockManagementFields(
          { ...proposed, driverStaffId: existing.driverStaffId },
          existing,
        );
        return;
      }

      next.push(lockManagementFields(proposed, null));
    });

  return next;
};

// New entries only, attributed to the caller: nothing existing can be edited,
// removed or forged under someone else's name.
const appendOwn = (storedEntries, proposedEntries, isOwn) => {
  const storedIds = new Set(asArray(storedEntries).map((entry) => entry?.id));
  const additions = asArray(proposedEntries).filter(
    (entry) => entry && text(entry.id) && !storedIds.has(entry.id) && isOwn(entry),
  );

  return additions.length > 0 ? [...clone(asArray(storedEntries)), ...clone(additions)] : clone(asArray(storedEntries));
};

const mergeForDriver = (stored, member, proposed) => {
  const staffId = text(member.staffId);
  const actorIds = memberActorIds(member);
  const merged = clone(stored);

  merged.financeTransactions = mergeDriverTransactions(stored, proposed.financeTransactions, staffId);
  merged.dailyCashUps = mergeDriverCashUps(stored, proposed.dailyCashUps, staffId);
  merged.defects = appendOwn(stored.defects, proposed.defects, (defect) =>
    actorIds.has(text(defect.reportedByStaffId ?? defect.reportedBy ?? defect.createdBy)),
  );
  merged.auditTrail = appendOwn(stored.auditTrail, proposed.auditTrail, (event) =>
    actorIds.has(text(event.actorId)),
  );

  if (proposed.driverTerminal && text(proposed.driverTerminal.activeDriverId) === staffId) {
    merged.driverTerminal = clone(proposed.driverTerminal);
  }

  return merged;
};

// Finance fields always come from the stored entry; an entry whose other content
// is unchanged is kept verbatim so an unchanged save rewrites nothing.
const restoreFields = (proposedEntry, storedEntry, fields) => {
  if (!storedEntry) {
    return omit(proposedEntry, fields);
  }
  if (same(proposedEntry, storedEntry, fields)) {
    return clone(storedEntry);
  }
  return { ...omit(proposedEntry, fields), ...pick(storedEntry, fields) };
};

const restoreFinanceFields = (proposedList, storedList, key, fields) => {
  const storedByKey = byId(storedList, key);

  return asArray(proposedList).map((entry) => restoreFields(entry, storedByKey.get(entry?.[key]), fields));
};

const mergePermissionRequests = (storedControls, proposedControls, actorIds) => {
  if (!proposedControls || typeof proposedControls !== "object") {
    return clone(storedControls);
  }

  let next = storedControls === undefined ? undefined : clone(storedControls);

  Object.entries(proposedControls).forEach(([moduleKey, state]) => {
    const current = storedControls?.[moduleKey] ?? {};
    const isOwnPendingRequest =
      state?.requestStatus === "pending" &&
      actorIds.has(text(state.requestedBy)) &&
      state.active !== true &&
      !state.grantedAt &&
      current.active !== true;

    if (isOwnPendingRequest && !same(current, state)) {
      next = { ...(next ?? {}), [moduleKey]: clone(state) };
    }
  });

  return next;
};

const mergeForNoFinance = (stored, member, proposed) => {
  const actorIds = memberActorIds(member);
  const merged = clone(stored);

  NO_FINANCE_WRITABLE_KEYS.forEach((key) => {
    if (proposed[key] !== undefined) {
      merged[key] = clone(proposed[key]);
    }
  });

  merged.vehicles = restoreFinanceFields(merged.vehicles, stored.vehicles, "id", VEHICLE_FINANCE_FIELDS);
  merged.drivers = restoreFinanceFields(merged.drivers, stored.drivers, "staffId", STAFF_FINANCE_FIELDS);
  if (merged.profile && stored.profile) {
    merged.profile = restoreFields(merged.profile, stored.profile, PROFILE_FINANCE_FIELDS);
  }

  merged.financeTransactions = appendOwn(
    stored.financeTransactions,
    proposed.financeTransactions,
    (record) => record.type === "expense" && actorIds.has(text(record.createdBy)),
  );
  merged.auditTrail = appendOwn(stored.auditTrail, proposed.auditTrail, (event) => actorIds.has(text(event.actorId)));
  merged.permissionControls = mergePermissionRequests(stored.permissionControls, proposed.permissionControls, actorIds);

  if (merged.permissionControls === undefined) {
    delete merged.permissionControls;
  }

  return merged;
};

export const mergeScopedChanges = (stored, member, scope, proposed) => {
  const base = stored ?? {};
  const incoming = proposed && typeof proposed === "object" ? proposed : {};
  let merged;

  if (scope === WORKSPACE_SCOPES.DRIVER) {
    merged = mergeForDriver(base, member, incoming);
  } else if (scope === WORKSPACE_SCOPES.NO_FINANCE) {
    merged = mergeForNoFinance(base, member, incoming);
  } else {
    throw new Error(`Scoped saves are not available for scope: ${scope}`);
  }

  merged.appUsers = clone(base.appUsers);
  if (merged.appUsers === undefined) {
    delete merged.appUsers;
  }

  return { snapshot: merged, changed: !same(merged, base) };
};
