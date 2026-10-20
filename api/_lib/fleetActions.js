import { randomUUID } from "node:crypto";

import {
  buildRouteReferenceId,
  normalizeRegistration,
  normalizeRouteMasterRecord,
  normalizeVehicleCapabilityHooks,
} from "../../src/lib/fleetRecordContract.js";
import { hasPermission } from "../../src/lib/memberPermissions.js";
import { createHttpError } from "./tenantAuth.js";

// Tenant route, vehicle and driver-profile saves (release 06). They run through
// the same pipeline as the finance actions (api/business/finance-actions.js:
// membership authorization, request-id replay, updated_at compare-and-swap) and
// use the record-action shape (parse -> apply -> { snapshot, targetId, response }).
//
// * Each record is rebuilt on the server from the stored snapshot plus the
//   explicitly allowed fields; ids that are not in THIS business are refused, so
//   another company's route, vehicle or driver id can never be referenced.
// * The integrity rules are the operator loader's (scripts/pilot/business-data-plan.mjs):
//   unique route names/codes and registrations, no rename or re-registration
//   that money records reference, odometers never go back.
// * Money records, cash-ups, deposits and the business directory (appUsers) are
//   never changed; a driver profile never carries a sign-in, email or password.
//   Sign-ins stay with the Owner in Business access.
//
// Permissions: route.save / vehicle.save need fleet.manage; driver.save and any
// vehicle driver-assignment change need drivers.manage (each capped by module).

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase().replace(/\s+/g, " ");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const bad = (message) => createHttpError(400, message);
const missing = (message) => createHttpError(404, message);
const conflict = (message) => createHttpError(409, message);
const forbid = (message) => createHttpError(403, message);
const list = (value) => (Array.isArray(value) ? value : []);

const onlyKeys = (fields, allowed) => {
  const unknown = Object.keys(fields ?? {}).filter((field) => !allowed.includes(field));
  if (unknown.length) throw bad(`Unsupported fields: ${unknown.join(", ")}.`);
};
const parseText = (value, label, max, { required = false } = {}) => {
  const result = text(value);
  if (required && !result) throw bad(`${label} is required.`);
  if (result.length > max) throw bad(`${label} is limited to ${max} characters.`);
  return result;
};
const parseId = (value, label) => {
  const result = text(value);
  if (!result) return null;
  if (!ID.test(result)) throw bad(`${label} is not a valid id.`);
  return result;
};
const parseDate = (value, label) => {
  if (value === undefined) return undefined;
  const result = text(value);
  if (result && !DATE.test(result)) throw bad(`${label} must be YYYY-MM-DD.`);
  return result || null;
};
const parseWhole = (value, label, min, max) => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
};
const parseFlag = (value, label) => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw bad(`${label} must be true or false.`);
  return value;
};

const routeHasMoney = (snapshot, routeName) =>
  list(snapshot.financeTransactions).some((record) => key(record.route) === key(routeName)) ||
  list(snapshot.dailyCashUps).some((entry) => key(entry.route) === key(routeName));
const vehicleHasMoney = (snapshot, vehicle) =>
  list(snapshot.financeTransactions).some(
    (record) => text(record.vehicleId) === text(vehicle.id) || normalizeRegistration(record.vehicle) === normalizeRegistration(vehicle.registration),
  ) || list(snapshot.dailyCashUps).some((entry) => text(entry.vehicleId) === text(vehicle.id));

const stamp = (existing, requester, now) =>
  existing
    ? { createdAt: existing.createdAt ?? null, createdBy: existing.createdBy ?? null, createdByRole: existing.createdByRole ?? null, updatedAt: now, updatedBy: requester.id, updatedByRole: requester.role }
    : { createdAt: now, createdBy: requester.id, createdByRole: requester.role, updatedAt: null, updatedBy: null, updatedByRole: null };

const auditEvent = (requester, now, requestId, fields) => ({
  id: `audit-${randomUUID()}`,
  timestamp: now,
  actorId: requester.id,
  actorRole: requester.role,
  source: "server",
  requestId,
  ...fields,
});

const withAudit = (stored, event) => [event, ...list(stored.auditTrail)];

// --- route.save ---------------------------------------------------------------------
const ROUTE_FIELDS = ["routeId", "name", "code", "type", "primaryOrigin", "primaryDestination", "isActive"];
const parseRoute = (fields) => {
  onlyKeys(fields, ROUTE_FIELDS);
  const primaryOrigin = parseText(fields.primaryOrigin, "Primary origin", 80, { required: true });
  const primaryDestination = parseText(fields.primaryDestination, "Primary destination", 80, { required: true });
  if (key(primaryOrigin) === key(primaryDestination)) throw bad("Origin and destination must be different stops.");
  const code = parseText(fields.code, "Route code", 12).toUpperCase();
  if (code && !/^[A-Z0-9-]{1,12}$/.test(code)) throw bad("Route code must be 1-12 letters, digits or dashes.");
  const type = parseText(fields.type, "Route type", 40) || "route_service";
  if (!/^[a-z_]{1,40}$/.test(type)) throw bad("Route type is not valid.");
  return {
    routeId: parseId(fields.routeId, "routeId"),
    name: parseText(fields.name, "Route name", 80, { required: true }),
    code,
    type,
    primaryOrigin,
    primaryDestination,
    isActive: parseFlag(fields.isActive, "isActive"),
  };
};

const saveRoute = (stored, fields, requester, now, requestId) => {
  const routes = list(stored.routes);
  const existing = fields.routeId ? routes.find((route) => text(route.id) === fields.routeId) ?? null : null;
  if (fields.routeId && !existing) throw missing("That route does not exist in this business.");
  const id = existing?.id ?? buildRouteReferenceId(fields.name);
  if (!id) throw bad("Enter a valid route name.");
  const sameName = routes.find((route) => route !== existing && key(route.name) === key(fields.name));
  if (sameName) throw conflict(`A route named "${sameName.name}" already exists. Open it to edit instead.`);
  if (!existing && routes.some((route) => text(route.id) === id)) throw conflict("A route with this reference already exists. Open it to edit instead.");
  if (fields.code) {
    const duplicateCode = routes.find((route) => route !== existing && text(route.code).toUpperCase() === fields.code);
    if (duplicateCode) throw conflict("This route code is already linked to another route.");
  }
  if (existing && key(existing.name) !== key(fields.name) && routeHasMoney(stored, existing.name)) {
    throw conflict(`Route "${existing.name}" is referenced by money records; renaming it would break their history.`);
  }
  const normalized = normalizeRouteMasterRecord({
    ...(existing ?? {}),
    id,
    name: fields.name,
    ...(fields.code ? { code: fields.code } : existing ? {} : { code: undefined }),
    type: fields.type,
    primaryOrigin: fields.primaryOrigin,
    primaryDestination: fields.primaryDestination,
    route: fields.name,
    isActive: fields.isActive ?? existing?.isActive ?? true,
    ...(existing && key(existing.name) === key(fields.name) ? {} : { routePoints: undefined }),
  });
  const generatedCodeTaken = !fields.code && routes.some((route) => route !== existing && text(route.code).toUpperCase() === text(normalized.code).toUpperCase());
  if (generatedCodeTaken) throw conflict("The generated route code is already used; enter a route code.");
  const record = { ...normalized, ...stamp(existing, requester, now) };
  return {
    snapshot: {
      ...stored,
      routes: existing ? routes.map((route) => (route === existing ? record : route)) : [record, ...routes],
      auditTrail: withAudit(stored, auditEvent(requester, now, requestId, {
        scope: "fleet",
        action: existing ? "update" : "create",
        entityType: "route",
        entityId: record.id,
        title: `Route ${existing ? "updated" : "created"} / ${record.code}`,
        detail: `${record.name} / ${record.type}`,
      })),
    },
    targetId: record.id,
    response: { routeId: record.id, created: !existing },
  };
};

// --- vehicle.save -------------------------------------------------------------------
const VEHICLE_FIELDS = [
  "vehicleId", "registration", "model", "routeId", "currentOdometer", "lastServiceOdo", "serviceIntervalKm",
  "permitExpiryDate", "discExpiryDate", "assignedDriverId", "canDoRouteService", "canDoSpecialTrips", "canDoContracts", "seatCapacity",
];
const parseVehicle = (fields) => {
  onlyKeys(fields, VEHICLE_FIELDS);
  // Stored as entered (upper case, like the app always did); compared normalized.
  const registration = text(fields.registration).toUpperCase().replace(/\s+/g, " ");
  if (!/^[A-Z0-9 -]{2,15}$/.test(registration)) throw bad("Registration must be 2-15 letters, digits, spaces or dashes.");
  const routeId = parseId(fields.routeId, "routeId");
  if (!routeId) throw bad("Choose the vehicle's route.");
  if (fields.assignedDriverId !== undefined && fields.assignedDriverId !== null && typeof fields.assignedDriverId !== "string") throw bad("assignedDriverId must be a driver id or empty.");
  return {
    vehicleId: parseId(fields.vehicleId, "vehicleId"),
    registration,
    model: parseText(fields.model, "Model", 60, { required: true }),
    routeId,
    currentOdometer: parseWhole(fields.currentOdometer, "Current odometer", 0, 5_000_000),
    lastServiceOdo: parseWhole(fields.lastServiceOdo, "Last service odometer", 0, 5_000_000),
    serviceIntervalKm: parseWhole(fields.serviceIntervalKm, "Service interval", 1000, 100_000),
    permitExpiryDate: parseDate(fields.permitExpiryDate, "Permit expiry"),
    discExpiryDate: parseDate(fields.discExpiryDate, "Disc expiry"),
    assignedDriverId: fields.assignedDriverId === undefined ? undefined : parseId(fields.assignedDriverId, "assignedDriverId"),
    canDoRouteService: parseFlag(fields.canDoRouteService, "canDoRouteService"),
    canDoSpecialTrips: parseFlag(fields.canDoSpecialTrips, "canDoSpecialTrips"),
    canDoContracts: parseFlag(fields.canDoContracts, "canDoContracts"),
    seatCapacity: parseWhole(fields.seatCapacity, "Seat capacity", 1, 80),
  };
};

const saveVehicle = (stored, fields, requester, now, requestId) => {
  const vehicles = list(stored.vehicles);
  const existing = fields.vehicleId ? vehicles.find((vehicle) => text(vehicle.id) === fields.vehicleId) ?? null : null;
  if (fields.vehicleId && !existing) throw missing("That vehicle does not exist in this business.");
  if (existing?.status === "archived" || existing?.archivedAt) throw conflict("Archived vehicles cannot be edited.");

  const normalized = normalizeRegistration(fields.registration);
  const sameRegistration = vehicles.find((vehicle) => vehicle !== existing && normalizeRegistration(vehicle.registration) === normalized);
  if (sameRegistration) throw conflict(`Registration ${fields.registration} already belongs to another vehicle.`);
  // Same registration in another spelling keeps the stored text: money records match it exactly.
  const registration = existing && normalizeRegistration(existing.registration) === normalized ? existing.registration : fields.registration;
  if (existing && registration !== existing.registration && vehicleHasMoney(stored, existing)) {
    throw conflict(`This vehicle has money records under ${existing.registration}; changing its registration would break their history.`);
  }

  const route = list(stored.routes).find((entry) => text(entry.id) === fields.routeId) ?? null;
  const keepsCurrentRoute = existing && text(existing.currentRouteId) === fields.routeId;
  if (!route && !keepsCurrentRoute) throw missing("That route does not exist in this business.");

  if (existing && fields.currentOdometer !== undefined && fields.currentOdometer < Number(existing.currentOdometer ?? 0)) {
    throw conflict(`The odometer cannot go back (recorded ${existing.currentOdometer} km).`);
  }

  // Driver assignment: only a driver of THIS business; changing it needs drivers.manage.
  const previousDriver = text(existing?.assignedDriverId) || null;
  const nextDriver = fields.assignedDriverId === undefined ? previousDriver : fields.assignedDriverId;
  if (nextDriver && !list(stored.drivers).some((driver) => text(driver.staffId) === nextDriver)) {
    throw missing("That driver does not exist in this business.");
  }
  const assignmentChanged = nextDriver !== previousDriver;
  if (assignmentChanged && !hasPermission(requester, "drivers.manage")) {
    throw forbid('Changing a vehicle\'s driver needs the "Manage driver profiles and assignments" responsibility.');
  }

  const id = existing?.id ?? `veh-${randomUUID().slice(0, 8)}`;
  const set = (field, fallback) => (fields[field] !== undefined ? fields[field] : existing?.[field] ?? fallback);
  const record = {
    ...normalizeVehicleCapabilityHooks({
      ...(existing ?? {}),
      id,
      registration,
      model: fields.model,
      route: route?.name ?? existing.route,
      currentRouteId: route?.id ?? existing.currentRouteId,
      status: existing?.status ?? "active",
      utilisation: existing?.utilisation ?? 0,
      currentOdometer: set("currentOdometer", 0),
      lastServiceOdo: set("lastServiceOdo", 0),
      serviceIntervalKm: set("serviceIntervalKm", Number(stored.profile?.serviceIntervalKm ?? 10000)),
      permitExpiryDate: set("permitExpiryDate", null),
      discExpiryDate: set("discExpiryDate", null),
      assignedDriverId: nextDriver,
      canDoRouteService: set("canDoRouteService", true),
      canDoSpecialTrips: set("canDoSpecialTrips", false),
      canDoContracts: set("canDoContracts", false),
      seatCapacity: set("seatCapacity", 15),
      archivedAt: existing?.archivedAt ?? null,
      archivedBy: existing?.archivedBy ?? null,
      archivedByRole: existing?.archivedByRole ?? null,
    }),
    ...stamp(existing, requester, now),
  };
  // One driver per vehicle (the app's existing rule): the driver's previous vehicle is released.
  const others = vehicles.map((vehicle) => (vehicle !== existing && nextDriver && assignmentChanged && text(vehicle.assignedDriverId) === nextDriver ? { ...vehicle, assignedDriverId: null } : vehicle));
  return {
    snapshot: {
      ...stored,
      vehicles: existing ? others.map((vehicle) => (vehicle === existing ? record : vehicle)) : [record, ...others],
      auditTrail: withAudit(stored, auditEvent(requester, now, requestId, {
        scope: "fleet",
        action: existing ? "update" : "create",
        entityType: "vehicle",
        entityId: record.id,
        title: `Vehicle ${existing ? "updated" : "created"} / ${record.registration}`,
        detail: `${record.model} / ${record.route}${assignmentChanged ? ` / driver ${nextDriver ?? "none"}` : ""}`,
      })),
    },
    targetId: record.id,
    response: { vehicleId: record.id, created: !existing },
  };
};

// --- driver.save (a profile; never a sign-in) ----------------------------------------
const DRIVER_FIELDS = ["staffId", "name", "phone", "routeIds", "licenseNumber", "licenseCode", "licenseExpiryDate", "prdpNumber", "prdpExpiryDate"];
const parseDriver = (fields) => {
  onlyKeys(fields, DRIVER_FIELDS);
  if (fields.routeIds !== undefined && (!Array.isArray(fields.routeIds) || fields.routeIds.length > 20)) throw bad("routeIds must be a list of route ids.");
  const routeIds = fields.routeIds === undefined ? undefined : [...new Set(fields.routeIds.map((id) => parseId(id, "routeIds")).filter(Boolean))];
  return {
    staffId: parseId(fields.staffId, "staffId"),
    name: parseText(fields.name, "Driver name", 80, { required: true }),
    phone: fields.phone === undefined ? undefined : parseText(fields.phone, "Phone", 30) || null,
    routeIds,
    licenseNumber: fields.licenseNumber === undefined ? undefined : parseText(fields.licenseNumber, "Licence number", 40) || null,
    licenseCode: fields.licenseCode === undefined ? undefined : parseText(fields.licenseCode, "Licence code", 10).toUpperCase() || null,
    licenseExpiryDate: parseDate(fields.licenseExpiryDate, "Licence expiry"),
    prdpNumber: fields.prdpNumber === undefined ? undefined : parseText(fields.prdpNumber, "PrDP number", 40) || null,
    prdpExpiryDate: parseDate(fields.prdpExpiryDate, "PrDP expiry"),
  };
};

const saveDriver = (stored, fields, requester, now, requestId) => {
  const drivers = list(stored.drivers);
  const existing = fields.staffId ? drivers.find((driver) => text(driver.staffId) === fields.staffId) ?? null : null;
  if (fields.staffId && !existing) throw missing("That driver profile does not exist in this business.");
  let routeFields = {};
  if (fields.routeIds !== undefined) {
    const routes = fields.routeIds.map((id) => list(stored.routes).find((route) => text(route.id) === id) ?? null);
    if (routes.some((route) => !route)) throw missing("A selected route does not exist in this business.");
    routeFields = { routeIds: routes.map((route) => route.id), routeNames: routes.map((route) => route.name), route: routes[0]?.name ?? "", primaryRouteId: routes[0]?.id ?? null };
  }
  const optional = Object.fromEntries(
    ["phone", "licenseNumber", "licenseCode", "licenseExpiryDate", "prdpNumber", "prdpExpiryDate"].filter((field) => fields[field] !== undefined).map((field) => [field, fields[field]]),
  );
  const record = {
    ...(existing ?? { role: "Driver", email: null, route: "", routeIds: [], routeNames: [], primaryRouteId: null, shiftStatus: "Ready for dispatch", avgShiftRevenue: 0, cashAccuracy: 100 }),
    ...optional,
    ...routeFields,
    staffId: existing?.staffId ?? `drv-${randomUUID().slice(0, 8)}`,
    name: fields.name,
    role: "Driver",
    ...stamp(existing, requester, now),
  };
  // A profile never holds a password (sign-ins are Auth + membership, Owner only).
  delete record.accessPassword;
  return {
    snapshot: {
      ...stored,
      drivers: existing ? drivers.map((driver) => (driver === existing ? record : driver)) : [record, ...drivers],
      auditTrail: withAudit(stored, auditEvent(requester, now, requestId, {
        scope: "drivers",
        action: existing ? "update" : "create",
        entityType: "driver",
        entityId: record.staffId,
        title: `Driver ${existing ? "updated" : "created"} / ${record.name}`,
        detail: `${record.staffId} / ${record.routeNames?.join(", ") || "no route"}`,
      })),
    },
    targetId: record.staffId,
    response: { staffId: record.staffId, created: !existing },
  };
};

// Keys a fleet action must never change (checked after every apply).
const PROTECTED_KEYS = ["financeTransactions", "dailyCashUps", "deposits", "appUsers", "verificationQueue"];
const guarded = (apply) => (stored, fields, requester, now, requestId) => {
  const result = apply(stored, fields, requester, now, requestId);
  for (const field of PROTECTED_KEYS) {
    if (JSON.stringify(stored[field] ?? null) !== JSON.stringify(result.snapshot[field] ?? null)) {
      throw createHttpError(500, "Refusing to save: a protected record would change.");
    }
  }
  return result;
};

export const FLEET_ACTIONS = Object.freeze({
  "route.save": { roles: ["Owner", "Admin", "Manager"], permission: "fleet.manage", fields: ROUTE_FIELDS, parse: parseRoute, apply: guarded(saveRoute) },
  "vehicle.save": { roles: ["Owner", "Admin", "Manager"], permission: "fleet.manage", fields: VEHICLE_FIELDS, parse: parseVehicle, apply: guarded(saveVehicle) },
  "driver.save": { roles: ["Owner", "Admin", "Manager"], permission: "drivers.manage", fields: DRIVER_FIELDS, parse: parseDriver, apply: guarded(saveDriver) },
});
