// Pure route and vehicle record rules shared by the browser app (via
// appRuntime.js) and the server fleet actions. No imports, so Node can load it
// directly. Moved verbatim from appRuntime.js: the screens, the operator loader
// and the server must build exactly the same records.

export const sanitizeEmailLocalPart = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

// Registration identity (moved from scripts/pilot/business-data-plan.mjs).
export const normalizeRegistration = (value) => String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, " ");

export const buildRouteReferenceId = (route) => {
  const normalizedRoute = sanitizeEmailLocalPart(route)?.replace(/\.+/g, "-");
  return normalizedRoute ? `route-${normalizedRoute}` : null;
};
export const normalizeVehicleCapabilityHooks = (vehicle = {}) => {
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
      buildRouteReferenceId(vehicle.route),
  };
};


export const getRouteStops = (routeValue) => {
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

export const getRoutePointLabels = (routeValue) => {
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

export const buildRoutePointReference = (routeId, pointLabel, sequence) =>
  `${routeId ?? "route"}-point-${buildRouteReferenceId(pointLabel)?.replace(/^route-/, "") ?? sequence}`;

export const getDefaultRouteStopType = (index, total) => {
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

export const normalizeRoutePointRecord = (point, routeId, index, total) => {
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

export const normalizeRoutePointRecords = (points, routeId, fallbackLabels = []) => {
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

export const buildRouteCode = (value) => {
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

export const normalizeRouteMasterRecord = (route = {}) => {
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
    buildRouteReferenceId(name);
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
