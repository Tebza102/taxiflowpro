import { createHash, randomUUID } from "node:crypto";

// Operator business-data load: PLANNING (pure) and APPLYING (one atomic,
// version-checked write). Used by scripts/localdb/load-business-data.mjs.
//
// Loads only operational set-up data into ONE existing business snapshot:
// profile settings, routes (explicit start/end stops), driver profiles,
// vehicles (with route and driver assignment) and expense presets.
// It never deletes anything and never touches money records (financeTransactions,
// dailyCashUps, deposits), the business directory (appUsers), Auth users or
// memberships. Login invitations are a separate step (Business access).
//
// Identity rules
// * Routes: stable id (input id, else the app's buildRouteReferenceId(name)).
//   A NEW id whose name equals an existing route's name is refused (ambiguous).
// * Drivers: stable staffId (input staffId, else a deterministic id from the
//   business slug and name). A NEW staffId whose name equals an existing
//   driver's name is refused (ambiguous); same-name drivers need staffIds.
// * Vehicles: stable id, or the normalized registration when EXACTLY ONE
//   existing vehicle has it. Two matches are refused.
// * Assignments never replace an existing vehicle-driver link.
// * Changes that would break history are refused: a vehicle registration or a
//   route name that money records already reference, or an odometer decrease.

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase().replace(/\s+/g, " ");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const normalizeRegistration = (value) => text(value).toUpperCase().replace(/[\s-]+/g, " ");
const slug = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const shortHash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 10);

const changedFields = (before, after) =>
  Object.keys({ ...before, ...after }).filter((field) => !same(before?.[field], after?.[field]));

/**
 * @param {object} args
 * @param {object} args.input        operator JSON (see business-data.example.json)
 * @param {{ id: string, slug: string, name: string }} args.business
 * @param {object} args.snapshot     the business snapshot as stored
 * @param {object} args.rt           app normalizers (src/lib/appRuntime.js)
 * @param {string} [args.now]
 */
export const planBusinessDataLoad = ({ input, business, snapshot, rt, now = new Date().toISOString() }) => {
  const errors = [];
  const warnings = [];
  const changes = [];
  const unchanged = [];
  const next = clone(snapshot) ?? {};
  const err = (message) => errors.push(message);

  if (!input || typeof input !== "object") return { errors: ["The input must be a JSON object."], warnings, changes, unchanged, nextSnapshot: next };
  if (text(input.business?.name) !== text(business.name)) {
    err(`business.name "${text(input.business?.name)}" does not match the business "${business.name}" (slug ${business.slug}).`);
  }
  for (const key of Object.keys(input)) {
    if (!["business", "profile", "routes", "drivers", "vehicles", "expensePresets"].includes(key)) err(`Unknown top-level field "${key}".`);
  }

  const finance = Array.isArray(snapshot.financeTransactions) ? snapshot.financeTransactions : [];
  const cashUps = Array.isArray(snapshot.dailyCashUps) ? snapshot.dailyCashUps : [];
  const existingRoutes = Array.isArray(snapshot.routes) ? snapshot.routes : [];
  const existingDrivers = Array.isArray(snapshot.drivers) ? snapshot.drivers : [];
  const existingVehicles = Array.isArray(snapshot.vehicles) ? snapshot.vehicles : [];
  const audit = { by: "Operator", source: "operator-load" };
  const created = (record) => ({ ...record, createdAt: now, createdBy: "operator", createdByRole: "Operator", updatedAt: null, updatedBy: null, updatedByRole: null });
  const updated = (record) => ({ ...record, updatedAt: now, updatedBy: "operator", updatedByRole: "Operator" });

  // --- Profile (optional; only the supplied keys change) ---------------------------------
  const profileInput = input.profile ?? {};
  const profileNext = { ...(snapshot.profile ?? {}) };
  for (const [field, value] of Object.entries(profileInput)) {
    if (["legalEntity", "district", "nextBankingWindow"].includes(field)) {
      if (!text(value) || text(value).length > 120) err(`profile.${field} must be 1-120 characters.`);
      else profileNext[field] = text(value);
    } else if (field === "serviceIntervalKm") {
      const km = Number(value);
      if (!Number.isInteger(km) || km < 1000 || km > 100000) err("profile.serviceIntervalKm must be a whole number from 1000 to 100000.");
      else profileNext.serviceIntervalKm = km;
    } else {
      err(`profile.${field} is not supported (business name comes from onboarding).`);
    }
  }
  const profileFields = changedFields(snapshot.profile ?? {}, profileNext);
  if (profileFields.length) {
    changes.push({ kind: "profile", action: "update", id: "profile", label: business.name, fields: profileFields });
    next.profile = profileNext;
  }

  // --- Routes ---------------------------------------------------------------------------
  const routesOut = existingRoutes.map(clone);
  const routeByName = new Map();
  const seenRouteIds = new Set();
  const seenRouteNames = new Set();
  const isFirstLoad = existingRoutes.length === 0;
  const routeInputs = Array.isArray(input.routes) ? input.routes : [];
  if (isFirstLoad && routeInputs.length === 0) err("At least one route with explicit start and end stops is required.");
  for (const [index, entry] of routeInputs.entries()) {
    const where = `routes[${index}]`;
    const startStop = text(entry?.startStop);
    const endStop = text(entry?.endStop);
    if (!startStop || !endStop) { err(`${where}: startStop and endStop are required.`); continue; }
    if (key(startStop) === key(endStop)) { err(`${where}: startStop and endStop must be different stops.`); continue; }
    if (startStop.length > 80 || endStop.length > 80) { err(`${where}: stop names are limited to 80 characters.`); continue; }
    const name = text(entry.name) || `${startStop} to ${endStop}`;
    const code = text(entry.code).toUpperCase();
    if (code && !/^[A-Z0-9-]{1,12}$/.test(code)) { err(`${where}: code must be 1-12 letters, digits or dashes.`); continue; }
    const id = text(entry.id) || rt.buildRouteReferenceId(name);
    if (seenRouteIds.has(id) || seenRouteNames.has(key(name))) { err(`${where}: route "${name}" appears more than once in the input.`); continue; }
    seenRouteIds.add(id);
    seenRouteNames.add(key(name));

    const parsed = rt.getRouteStops(name);
    if (key(parsed.fromLocation) !== key(startStop) || key(parsed.toLocation) !== key(endStop)) {
      warnings.push(`${where}: the name "${name}" does not read as "${startStop} to ${endStop}"; trip capture prefills stops from the route name, so drivers will type them.`);
    }

    const existing = routesOut.find((route) => text(route.id) === id) ?? null;
    if (!existing) {
      const sameName = routesOut.find((route) => key(route.name) === key(name));
      if (sameName) { err(`${where}: a route named "${name}" already exists with id "${sameName.id}". Supply that id to update it.`); continue; }
    }
    const duplicateCode = code && routesOut.find((route) => text(route.id) !== id && text(route.code).toUpperCase() === code);
    if (duplicateCode) { err(`${where}: code ${code} is already used by route "${duplicateCode.name}".`); continue; }

    const normalized = rt.normalizeRouteMasterRecord({
      ...(existing ?? {}),
      id,
      name,
      ...(code ? { code } : {}),
      primaryOrigin: startStop,
      primaryDestination: endStop,
      route: name,
      isActive: existing?.isActive ?? true,
      ...(existing ? {} : { routePoints: undefined }),
    });
    if (existing) {
      if (key(existing.name) !== key(name)) {
        const usedByMoney = finance.some((record) => key(record.route) === key(existing.name)) || cashUps.some((entry) => key(entry.route) === key(existing.name));
        if (usedByMoney) { err(`${where}: route "${existing.name}" is referenced by money records; renaming it would break their history.`); continue; }
      }
      const fields = changedFields(
        { name: existing.name, code: existing.code, primaryOrigin: existing.primaryOrigin, primaryDestination: existing.primaryDestination },
        { name: normalized.name, code: normalized.code, primaryOrigin: normalized.primaryOrigin, primaryDestination: normalized.primaryDestination },
      );
      if (fields.length) {
        const replacement = updated({ ...existing, name: normalized.name, code: normalized.code, primaryOrigin: normalized.primaryOrigin, primaryDestination: normalized.primaryDestination, route: normalized.name });
        routesOut[routesOut.indexOf(existing)] = replacement;
        changes.push({ kind: "route", action: "update", id, label: name, fields });
        routeByName.set(key(name), replacement);
      } else {
        unchanged.push({ kind: "route", id });
        routeByName.set(key(name), existing);
      }
    } else {
      const record = created({ ...normalized, id });
      routesOut.push(record);
      changes.push({ kind: "route", action: "add", id, label: name });
      routeByName.set(key(name), record);
    }
  }
  const findRoute = (where, ref) => {
    if (!ref) return null;
    const byId = routesOut.find((route) => text(route.id) === text(ref));
    if (byId) return byId;
    const byName = routesOut.filter((route) => key(route.name) === key(ref));
    if (byName.length === 1) return byName[0];
    err(`${where}: route "${ref}" ${byName.length > 1 ? "is ambiguous" : "does not exist in this business or the input"}.`);
    return undefined;
  };

  // --- Drivers (profiles only; sign-in is granted separately) ------------------------------
  const driversOut = existingDrivers.map(clone);
  const seenStaff = new Set();
  const seenDriverNames = new Set();
  for (const [index, entry] of (Array.isArray(input.drivers) ? input.drivers : []).entries()) {
    const where = `drivers[${index}]`;
    const name = text(entry?.name);
    if (!name || name.length > 80) { err(`${where}: name is required (up to 80 characters).`); continue; }
    if (!text(entry.staffId) && seenDriverNames.has(key(name))) { err(`${where}: two drivers are named "${name}"; give each a staffId.`); continue; }
    seenDriverNames.add(key(name));
    const staffId = text(entry.staffId) || `drv-${shortHash(`${business.slug}|${key(name)}`)}`;
    if (seenStaff.has(staffId)) { err(`${where}: staffId ${staffId} appears more than once in the input.`); continue; }
    seenStaff.add(staffId);
    if (entry.prdpExpiryDate !== undefined && entry.prdpExpiryDate !== null && !DATE.test(text(entry.prdpExpiryDate))) { err(`${where}: prdpExpiryDate must be YYYY-MM-DD.`); continue; }
    const route = entry.route ? findRoute(where, entry.route) : null;
    if (route === undefined) continue;

    const existing = driversOut.find((driver) => text(driver.staffId) === staffId) ?? null;
    if (!existing) {
      // Only drivers that already exist can make a new name ambiguous; same-name
      // drivers inside one input are allowed when each carries its own staffId.
      const sameName = existingDrivers.filter((driver) => key(driver.name) === key(name));
      if (sameName.length) { err(`${where}: a driver named "${name}" already exists (${sameName.map((d) => d.staffId).join(", ")}). Supply the staffId to update, or a new staffId for a different person.`); continue; }
    }
    const fields = {
      name,
      ...(entry.phone !== undefined ? { phone: text(entry.phone) || null } : {}),
      ...(entry.prdpExpiryDate !== undefined ? { prdpExpiryDate: text(entry.prdpExpiryDate) || null } : {}),
      ...(route ? { route: route.name, routeIds: [route.id], routeNames: [route.name] } : {}),
    };
    if (existing) {
      const diff = changedFields(Object.fromEntries(Object.keys(fields).map((field) => [field, existing[field]])), fields);
      if (diff.length) {
        driversOut[driversOut.indexOf(existing)] = updated({ ...existing, ...fields });
        changes.push({ kind: "driver", action: "update", id: staffId, label: name, fields: diff });
      } else unchanged.push({ kind: "driver", id: staffId });
    } else {
      driversOut.push(created({ staffId, role: "Driver", email: null, routeIds: [], routeNames: [], route: "", shiftStatus: "Ready for dispatch", ...fields }));
      changes.push({ kind: "driver", action: "add", id: staffId, label: name });
    }
  }
  const findDriver = (where, entry) => {
    if (entry.assignedDriverStaffId) {
      const driver = driversOut.find((d) => text(d.staffId) === text(entry.assignedDriverStaffId));
      if (!driver) err(`${where}: driver ${entry.assignedDriverStaffId} does not exist in this business or the input.`);
      return driver ?? undefined;
    }
    if (entry.assignedDriverName) {
      const matches = driversOut.filter((d) => key(d.name) === key(entry.assignedDriverName));
      if (matches.length !== 1) {
        err(`${where}: driver "${entry.assignedDriverName}" ${matches.length ? "is ambiguous; use assignedDriverStaffId" : "does not exist in this business or the input"}.`);
        return undefined;
      }
      return matches[0];
    }
    return null;
  };

  // --- Vehicles -------------------------------------------------------------------------
  const vehiclesOut = existingVehicles.map(clone);
  const seenRegistrations = new Set();
  const vehicleInputs = Array.isArray(input.vehicles) ? input.vehicles : [];
  if (existingVehicles.length === 0 && vehicleInputs.length === 0) err("At least one vehicle registration is required.");
  for (const [index, entry] of vehicleInputs.entries()) {
    const where = `vehicles[${index}]`;
    const registration = normalizeRegistration(entry?.registration);
    if (!/^[A-Z0-9 ]{2,15}$/.test(registration)) { err(`${where}: registration "${text(entry?.registration)}" is not valid (letters, digits and spaces, 2-15).`); continue; }
    if (seenRegistrations.has(registration)) { err(`${where}: registration ${registration} appears more than once in the input.`); continue; }
    seenRegistrations.add(registration);
    const byRegistration = vehiclesOut.filter((vehicle) => normalizeRegistration(vehicle.registration) === registration);
    if (byRegistration.length > 1) { err(`${where}: ${byRegistration.length} existing vehicles have registration ${registration} (${byRegistration.map((v) => v.id).join(", ")}); supply the id.`); continue; }
    let existing = null;
    if (text(entry.id)) {
      existing = vehiclesOut.find((vehicle) => text(vehicle.id) === text(entry.id)) ?? null;
      if (byRegistration[0] && byRegistration[0] !== existing) { err(`${where}: registration ${registration} already belongs to vehicle ${byRegistration[0].id}.`); continue; }
    } else {
      existing = byRegistration[0] ?? null;
    }
    const id = existing?.id ?? (text(entry.id) || `veh-${slug(registration)}`);
    if (!existing && vehiclesOut.some((vehicle) => text(vehicle.id) === id)) { err(`${where}: vehicle id ${id} is already used.`); continue; }

    const route = findRoute(where, entry.route);
    if (route === undefined) continue;
    if (!route && !existing) { err(`${where}: route is required.`); continue; }
    const driver = findDriver(where, entry);
    if (driver === undefined) continue;

    if (existing) {
      const vehicleHasMoney = finance.some((record) =>
        text(record.vehicleId) === text(existing.id) || normalizeRegistration(record.vehicle) === normalizeRegistration(existing.registration),
      ) || cashUps.some((entry) => text(entry.vehicleId) === text(existing.id));
      if (normalizeRegistration(existing.registration) !== registration && vehicleHasMoney) {
        err(`${where}: vehicle ${existing.id} has money records under ${existing.registration}; changing its registration would break their history.`);
        continue;
      }
      if (driver && text(existing.assignedDriverId) && text(existing.assignedDriverId) !== text(driver.staffId)) {
        err(`${where}: vehicle ${registration} is already assigned to driver ${existing.assignedDriverId}; the loader never reassigns an existing link.`);
        continue;
      }
    }
    const odometer = entry.currentOdometer === undefined ? undefined : Number(entry.currentOdometer);
    if (odometer !== undefined && (!Number.isInteger(odometer) || odometer < 0 || odometer > 5_000_000)) { err(`${where}: currentOdometer must be a whole number of km.`); continue; }
    if (existing && odometer !== undefined && odometer < Number(existing.currentOdometer ?? 0)) {
      err(`${where}: currentOdometer ${odometer} is lower than the recorded ${existing.currentOdometer}; odometers never go back.`);
      continue;
    }
    for (const field of ["permitExpiryDate", "discExpiryDate"]) {
      if (entry[field] !== undefined && entry[field] !== null && !DATE.test(text(entry[field]))) err(`${where}: ${field} must be YYYY-MM-DD.`);
    }
    const seatCapacity = entry.seatCapacity === undefined ? undefined : Number(entry.seatCapacity);
    if (seatCapacity !== undefined && (!Number.isInteger(seatCapacity) || seatCapacity < 1 || seatCapacity > 80)) { err(`${where}: seatCapacity must be 1-80.`); continue; }

    const fields = {
      registration,
      ...(entry.model !== undefined || !existing ? { model: text(entry.model) || existing?.model || "Minibus taxi" } : {}),
      ...(route ? { route: route.name, currentRouteId: route.id } : {}),
      ...(driver ? { assignedDriverId: driver.staffId } : {}),
      ...(odometer !== undefined ? { currentOdometer: odometer } : {}),
      ...(seatCapacity !== undefined ? { seatCapacity } : {}),
      ...(entry.permitExpiryDate !== undefined ? { permitExpiryDate: text(entry.permitExpiryDate) || null } : {}),
      ...(entry.discExpiryDate !== undefined ? { discExpiryDate: text(entry.discExpiryDate) || null } : {}),
    };
    if (existing) {
      const diff = changedFields(Object.fromEntries(Object.keys(fields).map((field) => [field, existing[field]])), fields);
      if (diff.length) {
        vehiclesOut[vehiclesOut.indexOf(existing)] = updated(rt.normalizeVehicleCapabilityHooks({ ...existing, ...fields }));
        changes.push({ kind: "vehicle", action: "update", id, label: registration, fields: diff });
      } else unchanged.push({ kind: "vehicle", id });
    } else {
      const serviceIntervalKm = Number(profileNext.serviceIntervalKm ?? 10000);
      vehiclesOut.push(created(rt.normalizeVehicleCapabilityHooks({
        id,
        status: "active",
        utilisation: 0,
        currentOdometer: 0,
        lastServiceOdo: odometer ?? 0,
        serviceIntervalKm,
        permitExpiryDate: null,
        discExpiryDate: null,
        assignedDriverId: null,
        archivedAt: null,
        archivedBy: null,
        archivedByRole: null,
        ...fields,
      })));
      changes.push({ kind: "vehicle", action: "add", id, label: registration });
    }
  }

  // --- Expense presets (additive) -------------------------------------------------------------
  if (input.expensePresets !== undefined) {
    const presets = input.expensePresets;
    const stored = snapshot.finance?.expenseCatalog ?? {};
    const merged = { ...stored };
    for (const kind of Object.keys(presets ?? {})) {
      if (!["asset", "operational"].includes(kind) || !Array.isArray(presets[kind])) { err(`expensePresets.${kind} is not supported (use asset or operational lists).`); continue; }
      const entries = presets[kind].map((preset) => ({ name: text(preset?.name), descriptions: Array.isArray(preset?.descriptions) ? preset.descriptions.map(text).filter(Boolean) : [] }));
      if (entries.some((preset) => !preset.name || preset.name.length > 60)) { err(`expensePresets.${kind}: every preset needs a name (up to 60 characters).`); continue; }
      merged[kind] = [...(Array.isArray(stored[kind]) ? stored[kind] : []), ...entries];
    }
    const before = rt.normalizeExpensePresetCatalog(stored);
    const after = rt.normalizeExpensePresetCatalog(merged);
    if (!same(before, after)) {
      next.finance = { ...(snapshot.finance ?? {}), expenseCatalog: after };
      changes.push({ kind: "expensePresets", action: "update", id: "expenseCatalog", label: "expense presets" });
    } else unchanged.push({ kind: "expensePresets", id: "expenseCatalog" });
  }

  next.routes = routesOut;
  next.drivers = driversOut;
  next.vehicles = vehiclesOut;
  if (changes.length && !errors.length) {
    const count = (kind, action) => changes.filter((change) => change.kind === kind && change.action === action).length;
    next.auditTrail = [
      {
        id: `audit-${randomUUID()}`,
        timestamp: now,
        scope: "settings",
        action: "operator-load",
        actorId: "operator",
        actorRole: audit.by,
        source: audit.source,
        title: "Business set-up data loaded by the operator",
        detail: ["route", "driver", "vehicle"].map((kind) => `${kind}s +${count(kind, "add")} ~${count(kind, "update")}`).join(" / ") +
          (changes.some((c) => c.kind === "profile") ? " / profile updated" : "") +
          (changes.some((c) => c.kind === "expensePresets") ? " / presets updated" : ""),
      },
      ...(Array.isArray(snapshot.auditTrail) ? snapshot.auditTrail : []),
    ];
  }
  return { errors, warnings, changes, unchanged, nextSnapshot: next };
};

// Keys the loader must never change.
export const PROTECTED_KEYS = ["financeTransactions", "dailyCashUps", "deposits", "appUsers", "verificationQueue"];

// One atomic write: only if the snapshot is still at expectedVersion.
export const applyBusinessDataLoad = async ({ service, businessId, expectedVersion, before, plan }) => {
  if (plan.errors.length) return { ok: false, status: "invalid", error: "The plan has errors; nothing was written." };
  if (!plan.changes.length) return { ok: true, status: "unchanged" };
  for (const field of PROTECTED_KEYS) {
    if (!same(before[field], plan.nextSnapshot[field])) return { ok: false, status: "refused", error: `Refusing to write: ${field} would change.` };
  }
  const version = new Date().toISOString();
  const { data, error } = await service
    .from("workspace_snapshots")
    .update({ snapshot: plan.nextSnapshot, updated_at: version, updated_by: null })
    .eq("business_id", businessId)
    .eq("updated_at", expectedVersion)
    .select("updated_at");
  if (error) return { ok: false, status: "error", error: "The business snapshot could not be written; nothing changed." };
  if (!data || data.length !== 1) return { ok: false, status: "stale", error: "The business changed after this plan was made; nothing was written. Run the loader again to re-plan." };
  return { ok: true, status: "applied", version: data[0].updated_at };
};
