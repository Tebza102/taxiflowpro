import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInDays } from "date-fns";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  Banknote,
  Briefcase,
  Building2,
  Calendar,
  Car,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  FileText,
  LayoutDashboard,
  Loader2,
  Lock,
  Settings2,
  Shield,
  ShieldAlert,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import { repository } from "./lib/dataGateway";

const ZAR = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  maximumFractionDigits: 0,
});

const ROLES = ["Owner", "Admin", "Manager", "Driver"];

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, roles: ROLES },
  {
    id: "finance",
    label: "Finance",
    icon: Banknote,
    roles: ["Owner", "Admin", "Manager"],
  },
  {
    id: "fleet",
    label: "Fleet",
    icon: Activity,
    roles: ROLES,
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: Shield,
    roles: ["Owner", "Admin", "Manager"],
  },
  { id: "drivers", label: "Drivers", icon: Users, roles: ROLES },
];

const formatMoney = (value) => ZAR.format(value ?? 0);

const DEFECT_CATEGORIES = ["Windscreen", "Tires", "Seats", "Engine", "Other"];

const getQueueTone = (entry) => {
  if (entry.shortage > 0 || entry.gapKm > 0 || entry.status === "Escalate") {
    return "danger";
  }
  if (entry.status === "Awaiting Cash Count") {
    return "warning";
  }
  return "success";
};

const getVehicleTone = (vehicle) => {
  if (vehicle.status === "archived") {
    return "neutral";
  }
  if (vehicle.healthState === "danger") {
    return "danger";
  }
  if (vehicle.healthState === "warning") {
    return "warning";
  }
  return "success";
};

const getDocumentTone = (daysLeft) => {
  if (daysLeft <= 30) {
    return "danger";
  }
  if (daysLeft <= 90) {
    return "warning";
  }
  return "success";
};

const getDefectTone = (severity) => {
  if (severity === "Resolved") {
    return "success";
  }
  if (severity === "Critical") {
    return "danger";
  }
  if (severity === "High" || severity === "Medium") {
    return "warning";
  }
  return "info";
};

const toneLabel = {
  success: "Healthy",
  warning: "Attention",
  danger: "Critical",
  info: "Watch",
  neutral: "Stable",
};

const PRIVILEGED_ROLES = new Set(["Owner", "Admin", "Manager"]);

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

const formatStamp = (value) =>
  value
    ? new Date(value).toLocaleString("en-ZA", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Pending";

const sumBy = (items, selector) =>
  items.reduce((total, item) => total + Number(selector(item) ?? 0), 0);

const getIncomeCashValue = (record) =>
  Number(record.actualCashReceived ?? record.amountClaimed ?? record.amount ?? 0);

const getCurrentActorId = (role, snapshot) => {
  if (role === "Driver") {
    return snapshot.driverTerminal?.activeDriverId ?? "driver-terminal";
  }

  return `${role.toLowerCase()}-session`;
};

const buildDepositReference = (sequence, value = new Date()) => {
  const day = value
    .toLocaleDateString("en-ZA", { weekday: "short" })
    .replace(".", "")
    .toUpperCase();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");

  return `TFP-${day}-${month}${date}-${String(sequence).padStart(2, "0")}`;
};

const getExpectedOpeningOdo = (transactions, vehicles, vehicleId, excludedId = null) => {
  const latestShift = [...transactions]
    .filter(
      (record) =>
        record.type === "income" &&
        record.incomeKind === "standard" &&
        record.vehicleId === vehicleId &&
        record.id !== excludedId,
    )
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

  if (latestShift?.closingOdo != null) {
    return Number(latestShift.closingOdo);
  }

  return Number(vehicles.find((vehicle) => vehicle.id === vehicleId)?.currentOdometer ?? 0);
};

const getDriverLinkedVehicles = (snapshot) => {
  const activeDriverId =
    snapshot.driverTerminal?.activeDriverId ??
    snapshot.drivers.find((driver) => driver.name === snapshot.driverTerminal?.activeDriver)?.staffId;
  const explicitLinkedIds = new Set(snapshot.driverTerminal?.linkedVehicleIds ?? []);

  const linkedVehicles = snapshot.vehicles.filter(
    (vehicle) =>
      vehicle.id === snapshot.driverTerminal?.assignedVehicleId ||
      explicitLinkedIds.has(vehicle.id) ||
      vehicle.registration === snapshot.driverTerminal?.assignedVehicle ||
      (activeDriverId && vehicle.assignedDriverId === activeDriverId),
  );

  return linkedVehicles.length > 0 ? linkedVehicles : [];
};

const deriveQueueStatus = (record, shortage, gapKm) => {
  if (record.status === "banked") {
    return "Banked";
  }
  if (record.status === "pending") {
    return "Awaiting Cash Count";
  }
  if (shortage > 0 || gapKm > 0) {
    return "Escalate";
  }
  return "Verified";
};

const getDaysLeft = (expiryDate, currentDate) => {
  if (!expiryDate) {
    return 365;
  }

  return differenceInDays(new Date(expiryDate), currentDate);
};

const getDocumentStage = (daysLeft) => {
  if (daysLeft <= 30) {
    return "30-day critical";
  }
  if (daysLeft <= 90) {
    return "60-day warning";
  }
  return "90-day watch";
};

const getServiceTone = (kmsRemaining) => {
  if (kmsRemaining <= 0) {
    return "danger";
  }
  if (kmsRemaining <= 1000) {
    return "warning";
  }
  return "success";
};

const getVehicleHealthState = ({ status, defectsOpen, kmsRemaining, minimumDocumentDays }) => {
  if (status === "archived") {
    return "neutral";
  }
  if (kmsRemaining <= 0 || minimumDocumentDays <= 30) {
    return "danger";
  }
  if (defectsOpen > 0 || kmsRemaining <= 1000) {
    return "warning";
  }
  return "success";
};

const deriveSnapshot = (source) => {
  if (!source) {
    return source;
  }

  const currentDate = new Date();
  const drivers = (source.drivers ?? []).map((driver) => {
    const staffId = driver.staffId ?? driver.id ?? driver.name;
    const prdpDays =
      driver.prdpExpiryDate != null
        ? getDaysLeft(driver.prdpExpiryDate, currentDate)
        : driver.prdpDays ?? null;

    return {
      ...driver,
      staffId,
      prdpDays,
    };
  });
  const driverMap = new Map(drivers.map((driver) => [driver.staffId, driver]));
  const rawVehicles = source.vehicles ?? [];
  const resolvedDriverId =
    source.driverTerminal?.activeDriverId ??
    drivers.find((driver) => driver.name === source.driverTerminal?.activeDriver)?.staffId ??
    drivers[0]?.staffId ??
    null;
  const resolvedVehicleId =
    source.driverTerminal?.assignedVehicleId ??
    rawVehicles.find(
      (vehicle) => vehicle.registration === source.driverTerminal?.assignedVehicle,
    )?.id ??
    rawVehicles[0]?.id ??
    null;
  const defects = [...(source.defects ?? [])]
    .map((defect) => {
      const vehicleId =
        defect.vehicleId ??
        rawVehicles.find((vehicle) => vehicle.registration === defect.vehicle)?.id ??
        null;
      const vehicle = rawVehicles.find((item) => item.id === vehicleId);
      const reporter = driverMap.get(defect.reportedByStaffId);
      const isResolved = defect.status === "resolved";

      return {
        ...defect,
        id: defect.id ?? `${vehicleId ?? "veh"}-${defect.issue}`,
        vehicleId,
        vehicle: vehicle?.registration ?? defect.vehicle ?? "Vehicle",
        category: defect.category ?? "Other",
        detail: defect.detail ?? defect.issue,
        status: defect.status ?? "open",
        statusLabel: isResolved ? "Resolved" : "Open",
        severity: isResolved ? "Resolved" : defect.severity ?? "Low",
        reportedByStaffId: defect.reportedByStaffId ?? resolvedDriverId,
        reportedByName: reporter?.name ?? "Driver",
        reportedAtLabel: formatStamp(defect.reportedAt),
        resolvedAtLabel: defect.resolvedAt ? formatStamp(defect.resolvedAt) : null,
        immutable: isResolved,
      };
    })
    .sort((left, right) => new Date(right.reportedAt) - new Date(left.reportedAt));
  const openDefectsByVehicle = defects.reduce((map, defect) => {
    if (defect.status !== "resolved" && defect.vehicleId) {
      map.set(defect.vehicleId, (map.get(defect.vehicleId) ?? 0) + 1);
    }
    return map;
  }, new Map());

  const baseVehicles = rawVehicles.map((vehicle) => {
    const serviceIntervalKm = Number(
      vehicle.serviceIntervalKm ?? source.profile.serviceIntervalKm ?? 10000,
    );
    const lastServiceOdo = Number(
      vehicle.lastServiceOdo ??
        (vehicle.nextServiceAt != null ? vehicle.nextServiceAt - serviceIntervalKm : 0),
    );
    const kmsRemaining =
      lastServiceOdo + serviceIntervalKm - Number(vehicle.currentOdometer ?? 0);
    const permitDays =
      vehicle.permitExpiryDate != null
        ? getDaysLeft(vehicle.permitExpiryDate, currentDate)
        : vehicle.permitDays ?? 365;
    const discDays =
      vehicle.discExpiryDate != null
        ? getDaysLeft(vehicle.discExpiryDate, currentDate)
        : vehicle.discDays ?? 365;
    const minimumDocumentDays = Math.min(permitDays, discDays);
    const defectsOpen = openDefectsByVehicle.get(vehicle.id) ?? vehicle.defectsOpen ?? 0;
    const assignedDriverId =
      vehicle.assignedDriverId ??
      drivers.find((driver) => driver.name === vehicle.assignedDriver)?.staffId ??
      null;
    const assignedDriver = assignedDriverId ? driverMap.get(assignedDriverId) : null;
    const healthState = getVehicleHealthState({
      status: vehicle.status,
      defectsOpen,
      kmsRemaining,
      minimumDocumentDays,
    });
    const healthLabelMap = {
      success: "Healthy",
      warning: "Warning",
      danger: "Critical",
      neutral: "Archived",
    };

    return {
      ...vehicle,
      status: vehicle.status ?? "active",
      assignedDriverId,
      assignedDriver: assignedDriver?.name ?? "Unassigned",
      assignedDriverStaff: assignedDriver ?? null,
      currentOdometer: Number(vehicle.currentOdometer ?? 0),
      serviceIntervalKm,
      lastServiceOdo,
      nextServiceAt: lastServiceOdo + serviceIntervalKm,
      serviceDueKm: kmsRemaining,
      serviceTone: getServiceTone(kmsRemaining),
      defectsOpen,
      permitDays,
      discDays,
      minimumDocumentDays,
      healthState,
      healthLabel: healthLabelMap[healthState] ?? "Healthy",
      archivedAt: vehicle.archivedAt ?? null,
    };
  });

  const transactions = [...(source.financeTransactions ?? [])].sort(
    (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
  );
  const deposits = [...(source.deposits ?? [])].sort(
    (left, right) => new Date(right.timestamp) - new Date(left.timestamp),
  );
  const verifiedIncome = transactions.filter(
    (record) => record.type === "income" && record.status === "verified",
  );
  const settledIncome = transactions.filter(
    (record) =>
      record.type === "income" &&
      (record.status === "verified" || record.status === "banked"),
  );
  const allExpenses = transactions.filter((record) => record.type === "expense");
  const verifiedExpenses = allExpenses.filter((record) => record.status === "verified");
  const settledExpenses = allExpenses.filter(
    (record) => record.status === "verified" || record.status === "banked",
  );
  const assetExpenses = allExpenses.filter((record) => record.expenseKind === "asset");
  const operationalExpenses = allExpenses.filter(
    (record) => record.expenseKind === "operational",
  );
  const bankableCash =
    sumBy(verifiedIncome, getIncomeCashValue) -
    sumBy(
      verifiedExpenses.filter((record) => record.cashExpense),
      (record) => record.amount,
    );

  const enrichedVehicles = baseVehicles.map((vehicle) => {
    const vehicleIncome = settledIncome.filter((record) => record.vehicleId === vehicle.id);
    const vehicleExpenses = assetExpenses.filter(
      (record) =>
        record.vehicleId === vehicle.id &&
        (record.status === "verified" || record.status === "banked"),
    );
    const vehicleRevenue = sumBy(vehicleIncome, getIncomeCashValue);
    const vehicleExpenseTotal = sumBy(vehicleExpenses, (record) => record.amount);

    return {
      ...vehicle,
      verifiedRevenue: vehicleRevenue,
      assetExpenseTotal: vehicleExpenseTotal,
      netYield: vehicleRevenue - vehicleExpenseTotal,
      vehicleLedger: transactions.filter((record) => record.vehicleId === vehicle.id),
      linkedDefects: defects.filter((defect) => defect.vehicleId === vehicle.id),
    };
  });

  const vehicleOpenings = Object.fromEntries(
    enrichedVehicles.map((vehicle) => [
      vehicle.id,
      getExpectedOpeningOdo(transactions, enrichedVehicles, vehicle.id),
    ]),
  );

  const verificationQueue = transactions
    .filter((record) => record.type === "income")
    .map((record) => {
      const assignedDriver =
        enrichedVehicles.find((vehicle) => vehicle.id === record.vehicleId)?.assignedDriver ??
        drivers.find((driver) => driver.staffId === resolvedDriverId)?.name ??
        source.driverTerminal?.activeDriver ??
        "Driver";
      const expectedOpening =
        record.incomeKind === "standard"
          ? getExpectedOpeningOdo(transactions, enrichedVehicles, record.vehicleId, record.id)
          : 0;
      const gapKm =
        record.incomeKind === "standard"
          ? Math.abs(Number(record.openingOdo ?? 0) - Number(expectedOpening ?? 0))
          : 0;
      const shortage = Math.max(
        Number(record.amountClaimed ?? record.amount ?? 0) -
          Number(record.actualCashReceived ?? 0),
        0,
      );

      return {
        id: record.id,
        driver: assignedDriver,
        route:
          record.incomeKind === "special"
            ? record.description
            : record.route ?? "Standard shift",
        vehicle:
          enrichedVehicles.find((vehicle) => vehicle.id === record.vehicleId)?.registration ??
          record.vehicle ??
          "Vehicle",
        submittedAt: formatTime(record.timestamp),
        claimed: Number(record.amountClaimed ?? record.amount ?? 0),
        counted: Number(record.actualCashReceived ?? 0),
        shortage,
        gapKm,
        status: deriveQueueStatus(record, shortage, gapKm),
      };
    })
    .slice(0, 8);

  const standardIncome = transactions.filter(
    (record) => record.type === "income" && record.incomeKind === "standard",
  );
  const specialIncome = transactions.filter(
    (record) => record.type === "income" && record.isSpecial,
  );
  const routeSeries = standardIncome.slice(0, 4).map((record) => ({
    label: record.route?.split(" ")[0] ?? "Route",
    amount: Number(record.amountClaimed ?? record.amount ?? 0),
    type: record.status,
  }));
  const specialSeries = specialIncome.slice(0, 4).map((record) => ({
    name: record.description,
    vehicle:
      enrichedVehicles.find((vehicle) => vehicle.id === record.vehicleId)?.registration ??
      record.vehicle ??
      "General",
    type: "Special trip",
    amount: Number(record.amount ?? 0),
  }));
  const expenseSummary = (items) =>
    Object.values(
      items.reduce((groups, item) => {
        const key = item.category;
        const current = groups[key] ?? { category: key, amount: 0 };
        groups[key] = { ...current, amount: current.amount + Number(item.amount ?? 0) };
        return groups;
      }, {}),
    );
  const lockableTransactions = transactions.filter((record) => record.status === "verified");
  const nextReference = buildDepositReference(deposits.length + 1);
  const batchReference =
    lockableTransactions.length > 0 ? nextReference : deposits[0]?.reference ?? nextReference;
  const latestVerifiedTimestamp = lockableTransactions[0]?.timestamp;
  const serviceSchedule = enrichedVehicles
    .filter((vehicle) => vehicle.status !== "archived")
    .sort((left, right) => left.serviceDueKm - right.serviceDueKm)
    .map((vehicle) => ({
      vehicle: vehicle.registration,
      vehicleId: vehicle.id,
      dueInKm: vehicle.serviceDueKm,
      serviceType:
        vehicle.serviceDueKm <= 0
          ? "Immediate service pull-in"
          : `${vehicle.serviceIntervalKm.toLocaleString()}km preventive service`,
      workshop:
        vehicle.serviceDueKm <= 1000 ? "Priority workshop lane" : "TaxiFlow Partner Bay",
      tone: vehicle.serviceTone,
    }));
  const documents = [
    ...enrichedVehicles
      .filter((vehicle) => vehicle.status !== "archived")
      .flatMap((vehicle) => [
        {
          id: `${vehicle.id}-permit`,
          subject: vehicle.registration,
          subjectId: vehicle.id,
          subjectType: "vehicle",
          document: "Operating Permit",
          expiryDate: vehicle.permitExpiryDate ?? null,
          daysLeft: vehicle.permitDays,
          stage: getDocumentStage(vehicle.permitDays),
          owner: "Fleet Manager",
          action:
            vehicle.permitDays < 30
              ? "Escalate permit renewal and confirm proof of submission."
              : "Monitor permit renewal timeline.",
        },
        {
          id: `${vehicle.id}-disc`,
          subject: vehicle.registration,
          subjectId: vehicle.id,
          subjectType: "vehicle",
          document: "License Disc",
          expiryDate: vehicle.discExpiryDate ?? null,
          daysLeft: vehicle.discDays,
          stage: getDocumentStage(vehicle.discDays),
          owner: "Fleet Manager",
          action:
            vehicle.discDays < 30
              ? "Book licensing office slot and prepare roadworthy documents."
              : "Keep disc renewal documentation ready.",
        },
      ]),
    ...drivers
      .filter((driver) => driver.role === "Driver" && driver.prdpExpiryDate)
      .map((driver) => ({
        id: `${driver.staffId}-prdp`,
        subject: driver.name,
        subjectId: driver.staffId,
        subjectType: "staff",
        document: "PrDP",
        expiryDate: driver.prdpExpiryDate,
        daysLeft: driver.prdpDays ?? 365,
        stage: getDocumentStage(driver.prdpDays ?? 365),
        owner: "HR Admin",
        action:
          (driver.prdpDays ?? 365) < 30
            ? "Collect renewal slip and restrict reassignment until renewed."
            : "Track driver renewal in advance.",
      })),
  ].sort((left, right) => left.daysLeft - right.daysLeft);
  const activeDriver = drivers.find((driver) => driver.staffId === resolvedDriverId) ?? drivers[0];
  const linkedVehicleRecords = enrichedVehicles.filter(
    (vehicle) => vehicle.assignedDriverId === activeDriver?.staffId,
  );
  const assignedVehicle =
    linkedVehicleRecords.find((vehicle) => vehicle.id === resolvedVehicleId) ??
    linkedVehicleRecords[0] ??
    enrichedVehicles.find((vehicle) => vehicle.id === resolvedVehicleId) ??
    enrichedVehicles[0];

  return {
    ...source,
    drivers,
    defects,
    documents,
    serviceSchedule,
    driverTerminal: {
      ...source.driverTerminal,
      activeDriverId: activeDriver?.staffId ?? null,
      activeDriver: activeDriver?.name ?? source.driverTerminal?.activeDriver ?? "Driver",
      assignedVehicleId: assignedVehicle?.id ?? null,
      assignedVehicle:
        assignedVehicle?.registration ?? source.driverTerminal?.assignedVehicle ?? "Vehicle",
      assignedRoute: assignedVehicle?.route ?? source.driverTerminal?.assignedRoute ?? "Route",
      linkedVehicleIds: linkedVehicleRecords.map((vehicle) => vehicle.id),
      linkedVehicles: linkedVehicleRecords.map((vehicle) => ({
        id: vehicle.id,
        registration: vehicle.registration,
        route: vehicle.route,
      })),
    },
    vehicles: enrichedVehicles,
    verificationQueue,
    finance: {
      ...source.finance,
      todayClaimed: sumBy(
        transactions.filter((record) => record.type === "income"),
        (record) => record.amountClaimed ?? record.amount,
      ),
      todayCounted: sumBy(
        transactions.filter(
          (record) => record.type === "income" && record.actualCashReceived != null,
        ),
        (record) => record.actualCashReceived,
      ),
      pendingCashInSafe: bankableCash,
      verifiedToday: verifiedIncome.length,
      shiftsAwaitingVerification: transactions.filter(
        (record) => record.type === "income" && record.status === "pending",
      ).length,
      globalFleetProfit:
        sumBy(settledIncome, getIncomeCashValue) - sumBy(settledExpenses, (record) => record.amount),
      operationalOverhead: sumBy(
        operationalExpenses.filter(
          (record) => record.status === "verified" || record.status === "banked",
        ),
        (record) => record.amount,
      ),
      vehicleOpenings,
      revenueLogging: {
        standardRouteCount: standardIncome.length,
        specialTripCount: specialIncome.length,
        standardRouteRevenue: sumBy(
          standardIncome,
          (record) => record.amountClaimed ?? record.amount,
        ),
        specialTripRevenue: sumBy(specialIncome, (record) => record.amount),
        routes: routeSeries,
        specialTrips: specialSeries,
      },
      expenseManagement: {
        vehicleSpecific: expenseSummary(assetExpenses),
        operational: expenseSummary(operationalExpenses),
      },
      bankingBatch: {
        ...source.finance?.bankingBatch,
        reference: batchReference,
        verifiedTakings: sumBy(verifiedIncome, getIncomeCashValue),
        cashExpenses: sumBy(
          verifiedExpenses.filter((record) => record.cashExpense),
          (record) => record.amount,
        ),
        depositAmount: bankableCash,
        depositSlip: {
          generatedAt:
            lockableTransactions.length > 0
              ? formatStamp(latestVerifiedTimestamp)
              : deposits[0]?.timestamp
                ? formatStamp(deposits[0].timestamp)
                : "Ready to lock",
          teller: source.finance?.bankingBatch?.depositSlip?.teller ?? "Bank teller pending",
          recordsLocked: lockableTransactions.length,
        },
      },
    },
  };
};

const getTransactionTone = (record) => {
  if (record.status === "banked") {
    return "navy";
  }
  if (record.status === "verified") {
    return "success";
  }
  return "warning";
};

const createStandardDraft = (vehicleId, openingOdo) => ({
  id: null,
  vehicleId: vehicleId ?? "",
  openingOdo: openingOdo != null ? String(openingOdo) : "",
  closingOdo: "",
  amountClaimed: "",
});

const getStandardDraftValidationError = (draft) => {
  if (!draft.vehicleId) {
    return "Select a vehicle before saving the shift.";
  }

  if (draft.openingOdo === "") {
    return "Opening odometer is required.";
  }

  const openingOdo = Number(draft.openingOdo);
  if (!Number.isFinite(openingOdo)) {
    return "Enter a valid opening odometer.";
  }

  if (draft.closingOdo === "") {
    return "Enter the closing odometer to save the shift.";
  }

  const closingOdo = Number(draft.closingOdo);
  if (!Number.isFinite(closingOdo)) {
    return "Enter a valid closing odometer.";
  }
  if (closingOdo <= openingOdo) {
    return "Closing odometer must be greater than opening odometer.";
  }

  if (draft.amountClaimed === "") {
    return "Enter the amount claimed to save the shift.";
  }

  const amountClaimed = Number(draft.amountClaimed);
  if (!Number.isFinite(amountClaimed) || amountClaimed <= 0) {
    return "Amount claimed must be greater than zero.";
  }

  return null;
};

const createSpecialDraft = (vehicleId) => ({
  id: null,
  vehicleId: vehicleId ?? "",
  description: "",
  amount: "",
});

const createExpenseDraft = (expenseKind, vehicleId) => ({
  id: null,
  expenseKind,
  category: expenseKind === "asset" ? "Fuel" : "Salary",
  vehicleId: vehicleId ?? "",
  amount: "",
  cashExpense: true,
});

const createVehicleDraft = (vehicle, defaultInterval) => ({
  id: vehicle?.id ?? null,
  registration: vehicle?.registration ?? "",
  model: vehicle?.model ?? "",
  route: vehicle?.route ?? "",
  utilisation: vehicle?.utilisation ?? 0,
  currentOdometer: vehicle?.currentOdometer ?? 0,
  lastServiceOdo: vehicle?.lastServiceOdo ?? 0,
  serviceIntervalKm: vehicle?.serviceIntervalKm ?? defaultInterval,
  permitExpiryDate: vehicle?.permitExpiryDate ?? "",
  discExpiryDate: vehicle?.discExpiryDate ?? "",
  assignedDriverId: vehicle?.assignedDriverId ?? "",
  status: vehicle?.status ?? "active",
});

const createDefectDraft = (vehicleId) => ({
  id: null,
  vehicleId: vehicleId ?? "",
  category: DEFECT_CATEGORIES[0],
  detail: "",
});

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState("Owner");
  const [activeView, setActiveView] = useState("overview");
  const [driverShortcutIntent, setDriverShortcutIntent] = useState(null);

  useEffect(() => {
    let isMounted = true;

    repository.loadSnapshot().then((data) => {
      if (isMounted) {
        setSnapshot(data);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const currentSnapshot = useMemo(() => deriveSnapshot(snapshot), [snapshot]);

  const allowedViews = useMemo(
    () => NAV_ITEMS.filter((item) => item.roles.includes(activeRole)),
    [activeRole],
  );

  useEffect(() => {
    if (!allowedViews.some((item) => item.id === activeView)) {
      setActiveView(allowedViews[0]?.id ?? "overview");
    }
  }, [activeRole, activeView, allowedViews]);

  if (loading || !snapshot) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <Loader2 className="spin" size={36} />
          <p className="eyebrow">Initialising TaxiFlow Pro</p>
          <h1>Building the mobile command centre</h1>
        </div>
      </div>
    );
  }

  const createRecordId = (prefix) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const selectDriverVehicle = (vehicleId) => {
    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const linkedVehicles = getDriverLinkedVehicles(deriveSnapshot(current));
      const target =
        linkedVehicles.find((vehicle) => vehicle.id === vehicleId) ??
        current.vehicles.find((vehicle) => vehicle.id === vehicleId);

      if (!target) {
        return current;
      }

      return {
        ...current,
        driverTerminal: {
          ...current.driverTerminal,
          assignedVehicleId: target.id,
          assignedVehicle: target.registration,
          assignedRoute: target.route,
        },
      };
    });
  };

  const saveStandardIncome = (draft) => {
    let result = { ok: false, error: "Unable to save the standard shift." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const existing = (current.financeTransactions ?? []).find(
        (record) => record.id === draft.id,
      );
      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      const openingOdo = Number(draft.openingOdo);
      const closingOdo = Number(draft.closingOdo);
      const amountClaimed = Number(draft.amountClaimed);

      if (existing?.status === "banked") {
        result = { ok: false, error: "Banked records are read-only." };
        return current;
      }
      if (!vehicle) {
        result = { ok: false, error: "Select a valid vehicle before submitting." };
        return current;
      }
      if (!Number.isFinite(openingOdo) || !Number.isFinite(closingOdo)) {
        result = { ok: false, error: "Opening and closing odometer readings are required." };
        return current;
      }
      if (closingOdo - openingOdo <= 0) {
        result = { ok: false, error: "Closing odometer must be greater than opening odometer." };
        return current;
      }
      if (!Number.isFinite(amountClaimed) || amountClaimed <= 0) {
        result = { ok: false, error: "Enter the amount claimed for the shift." };
        return current;
      }

      const expectedOpening = getExpectedOpeningOdo(
        current.financeTransactions ?? [],
        current.vehicles ?? [],
        draft.vehicleId,
        draft.id ?? null,
      );
      const nextRecord = {
        id: draft.id ?? createRecordId("txn-inc"),
        type: "income",
        incomeKind: "standard",
        vehicleId: draft.vehicleId,
        vehicle: vehicle.registration,
        route: vehicle.route,
        openingOdo,
        closingOdo,
        amountClaimed,
        actualCashReceived: null,
        amount: amountClaimed,
        discrepancy: openingOdo !== expectedOpening,
        isSpecial: false,
        status: "pending",
        timestamp: new Date().toISOString(),
        createdBy: getCurrentActorId(activeRole, current),
        createdByRole: activeRole,
        depositId: null,
      };
      const nextTransactions = draft.id
        ? current.financeTransactions.map((record) =>
            record.id === draft.id
              ? {
                  ...nextRecord,
                  createdBy: record.createdBy,
                  createdByRole: record.createdByRole,
                }
              : record,
          )
        : [nextRecord, ...(current.financeTransactions ?? [])];

      result = {
        ok: true,
        message: nextRecord.discrepancy
          ? "Shift saved with an opening odometer discrepancy flag."
          : "Shift saved and queued for verification.",
        nextOpeningOdo: closingOdo,
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
      };
    });

    return result;
  };

  const saveSpecialIncome = (draft) => {
    let result = { ok: false, error: "Unable to save the special trip." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const existing = (current.financeTransactions ?? []).find(
        (record) => record.id === draft.id,
      );
      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      const amount = Number(draft.amount);

      if (existing?.status === "banked") {
        result = { ok: false, error: "Banked records are read-only." };
        return current;
      }
      if (!draft.description?.trim()) {
        result = { ok: false, error: "Add a description for the special trip." };
        return current;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        result = { ok: false, error: "Enter the amount earned for the special trip." };
        return current;
      }

      const nextRecord = {
        id: draft.id ?? createRecordId("txn-sp"),
        type: "income",
        incomeKind: "special",
        vehicleId: draft.vehicleId || null,
        vehicle: vehicle?.registration ?? "General",
        route: vehicle?.route ?? "Special trip",
        description: draft.description.trim(),
        amount,
        amountClaimed: amount,
        actualCashReceived: null,
        discrepancy: false,
        isSpecial: true,
        status: "pending",
        timestamp: new Date().toISOString(),
        createdBy: getCurrentActorId(activeRole, current),
        createdByRole: activeRole,
        depositId: null,
      };
      const nextTransactions = draft.id
        ? current.financeTransactions.map((record) =>
            record.id === draft.id
              ? {
                  ...nextRecord,
                  createdBy: record.createdBy,
                  createdByRole: record.createdByRole,
                }
              : record,
          )
        : [nextRecord, ...(current.financeTransactions ?? [])];

      result = {
        ok: true,
        message: "Special trip saved as pending income.",
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
      };
    });

    return result;
  };

  const saveExpense = (draft) => {
    let result = { ok: false, error: "Unable to save the expense." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const existing = (current.financeTransactions ?? []).find(
        (record) => record.id === draft.id,
      );
      const amount = Number(draft.amount);
      const expenseKind = draft.expenseKind;
      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      const status = PRIVILEGED_ROLES.has(activeRole) ? "verified" : "pending";

      if (existing?.status === "banked") {
        result = { ok: false, error: "Banked records are read-only." };
        return current;
      }
      if (!draft.category?.trim()) {
        result = { ok: false, error: "Enter an expense category." };
        return current;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        result = { ok: false, error: "Enter a valid expense amount." };
        return current;
      }
      if (expenseKind === "asset" && !vehicle) {
        result = { ok: false, error: "Asset-linked expenses require a valid vehicle." };
        return current;
      }

      const nextRecord = {
        id: draft.id ?? createRecordId("txn-exp"),
        type: "expense",
        expenseKind,
        category: draft.category.trim(),
        vehicleId: expenseKind === "asset" ? draft.vehicleId : null,
        vehicle: expenseKind === "asset" ? vehicle.registration : "General",
        amount,
        cashExpense: Boolean(draft.cashExpense),
        status,
        timestamp: new Date().toISOString(),
        createdBy: getCurrentActorId(activeRole, current),
        createdByRole: activeRole,
        depositId: null,
      };
      const nextTransactions = draft.id
        ? current.financeTransactions.map((record) =>
            record.id === draft.id
              ? {
                  ...nextRecord,
                  createdBy: record.createdBy,
                  createdByRole: record.createdByRole,
                }
              : record,
          )
        : [nextRecord, ...(current.financeTransactions ?? [])];

      result = {
        ok: true,
        message:
          status === "verified"
            ? "Expense saved and verified."
            : "Expense saved and routed for manager approval.",
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
      };
    });

    return result;
  };

  const verifyIncome = (transactionId, actualCashReceived) => {
    let result = { ok: false, error: "Unable to verify this income record." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const amount = Number(actualCashReceived);
      const target = current.financeTransactions.find((record) => record.id === transactionId);

      if (!target || target.type !== "income") {
        result = { ok: false, error: "Income record not found." };
        return current;
      }
      if (target.status === "banked") {
        result = { ok: false, error: "Banked records are read-only." };
        return current;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        result = { ok: false, error: "Enter the actual cash received before verifying." };
        return current;
      }

      const nextTransactions = current.financeTransactions.map((record) =>
        record.id === transactionId
          ? {
              ...record,
              actualCashReceived: amount,
              status: "verified",
            }
          : record,
      );

      result = {
        ok: true,
        message: "Income record verified and moved into the bankable cash pool.",
        shortage: Math.max(Number(target.amountClaimed ?? target.amount ?? 0) - amount, 0),
      };

      return {
        ...current,
        financeTransactions: nextTransactions,
      };
    });

    return result;
  };

  const deleteTransaction = (transactionId) => {
    let result = { ok: false, error: "Unable to delete the record." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const target = current.financeTransactions.find((record) => record.id === transactionId);

      if (!target) {
        result = { ok: false, error: "Record not found." };
        return current;
      }
      if (target.status === "banked") {
        result = { ok: false, error: "Banked records are locked and cannot be deleted." };
        return current;
      }

      result = { ok: true, message: "Record removed from the current working set." };

      return {
        ...current,
        financeTransactions: current.financeTransactions.filter(
          (record) => record.id !== transactionId,
        ),
      };
    });

    return result;
  };

  const lockDeposit = () => {
    let result = { ok: false, error: "No verified records are available to lock." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }

      const lockableTransactions = current.financeTransactions.filter(
        (record) => record.status === "verified",
      );

      if (lockableTransactions.length === 0) {
        return current;
      }

      const now = new Date();
      const depositId = `dep-${now.getTime()}`;
      const reference = buildDepositReference((current.deposits?.length ?? 0) + 1, now);
      const verifiedTakings = sumBy(
        lockableTransactions.filter((record) => record.type === "income"),
        getIncomeCashValue,
      );
      const cashExpenses = sumBy(
        lockableTransactions.filter(
          (record) => record.type === "expense" && record.cashExpense,
        ),
        (record) => record.amount,
      );
      const depositRecord = {
        depositId,
        reference,
        timestamp: now.toISOString(),
        recordsLocked: lockableTransactions.length,
        verifiedTakings,
        cashExpenses,
        depositAmount: verifiedTakings - cashExpenses,
        transactionIds: lockableTransactions.map((record) => record.id),
      };

      result = {
        ok: true,
        message: `${lockableTransactions.length} verified records were sealed into ${reference}.`,
        reference,
      };

      return {
        ...current,
        deposits: [depositRecord, ...(current.deposits ?? [])],
        financeTransactions: current.financeTransactions.map((record) =>
          record.status === "verified"
            ? {
                ...record,
                status: "banked",
                depositId,
              }
            : record,
        ),
      };
    });

    return result;
  };

  const saveVehicleProfile = (draft) => {
    let result = { ok: false, error: "Unable to save the vehicle profile." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!["Owner", "Admin"].includes(activeRole)) {
        result = { ok: false, error: "Only Admin or Owner can edit vehicle settings." };
        return current;
      }
      if (!draft.registration?.trim() || !draft.model?.trim() || !draft.route?.trim()) {
        result = { ok: false, error: "Registration, model, and route are required." };
        return current;
      }

      const nextVehicle = {
        id: draft.id ?? createRecordId("veh"),
        registration: draft.registration.trim().toUpperCase(),
        model: draft.model.trim(),
        route: draft.route.trim(),
        status: draft.status ?? "active",
        utilisation: Number(draft.utilisation ?? 0),
        currentOdometer: Number(draft.currentOdometer ?? 0),
        lastServiceOdo: Number(draft.lastServiceOdo ?? 0),
        serviceIntervalKm: Number(draft.serviceIntervalKm ?? current.profile.serviceIntervalKm),
        permitExpiryDate: draft.permitExpiryDate || null,
        discExpiryDate: draft.discExpiryDate || null,
        assignedDriverId: draft.assignedDriverId || null,
        archivedAt: draft.status === "archived" ? new Date().toISOString() : null,
      };
      const nextVehicles = draft.id
        ? current.vehicles.map((vehicle) =>
            vehicle.id === draft.id ? { ...vehicle, ...nextVehicle } : vehicle,
          )
        : [nextVehicle, ...(current.vehicles ?? [])];

      result = {
        ok: true,
        message: draft.id ? "Vehicle profile updated." : "Vehicle profile created.",
        vehicleId: nextVehicle.id,
      };

      return {
        ...current,
        vehicles: nextVehicles,
      };
    });

    return result;
  };

  const archiveVehicle = (vehicleId) => {
    let result = { ok: false, error: "Unable to archive this vehicle." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!["Owner", "Admin"].includes(activeRole)) {
        result = { ok: false, error: "Only Admin or Owner can archive vehicles." };
        return current;
      }

      const target = current.vehicles.find((vehicle) => vehicle.id === vehicleId);
      if (!target) {
        result = { ok: false, error: "Vehicle not found." };
        return current;
      }
      if (target.status === "archived") {
        result = { ok: false, error: "Vehicle is already archived." };
        return current;
      }

      result = { ok: true, message: `${target.registration} archived for audit retention.` };

      return {
        ...current,
        vehicles: current.vehicles.map((vehicle) =>
          vehicle.id === vehicleId
            ? {
                ...vehicle,
                status: "archived",
                archivedAt: new Date().toISOString(),
              }
            : vehicle,
        ),
      };
    });

    return result;
  };

  const logDefect = (draft) => {
    let result = { ok: false, error: "Unable to log the defect." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      const existing = current.defects.find((defect) => defect.id === draft.id);
      if (!draft.vehicleId) {
        result = { ok: false, error: "Select a vehicle before logging a defect." };
        return current;
      }
      if (!DEFECT_CATEGORIES.includes(draft.category)) {
        result = { ok: false, error: "Select a valid defect category." };
        return current;
      }
      if (existing && !["Owner", "Admin", "Manager"].includes(activeRole)) {
        result = { ok: false, error: "Only management can update logged defects." };
        return current;
      }
      if (existing?.status === "resolved") {
        result = { ok: false, error: "Resolved defects are immutable." };
        return current;
      }

      const vehicle = current.vehicles.find((item) => item.id === draft.vehicleId);
      if (!vehicle) {
        result = { ok: false, error: "Vehicle not found." };
        return current;
      }

      const severity =
        draft.category === "Engine" || draft.category === "Tires" || draft.category === "Windscreen"
          ? "High"
          : draft.category === "Seats"
            ? "Medium"
            : "Low";
      const detail = draft.detail?.trim() || draft.category;
      const defectRecord = {
        id: draft.id ?? createRecordId("def"),
        vehicleId: draft.vehicleId,
        category: draft.category,
        issue: detail,
        detail,
        severity,
        reportedAt: existing?.reportedAt ?? new Date().toISOString(),
        reportedByStaffId: existing?.reportedByStaffId ?? getCurrentActorId(activeRole, current),
        status: "open",
        costEstimate: existing?.costEstimate ?? 0,
        repairCost: null,
        resolvedAt: null,
        resolvedExpenseId: null,
      };

      result = {
        ok: true,
        message: existing
          ? "Logged defect updated in the vehicle audit trail."
          : "Defect logged into the vehicle audit trail.",
      };

      return {
        ...current,
        defects: existing
          ? current.defects.map((defect) =>
              defect.id === draft.id ? { ...defect, ...defectRecord } : defect,
            )
          : [defectRecord, ...(current.defects ?? [])],
      };
    });

    return result;
  };

  const resolveDefect = (defectId, repairCost) => {
    let result = { ok: false, error: "Unable to resolve the defect." };

    setSnapshot((current) => {
      if (!current) {
        return current;
      }
      if (!["Owner", "Admin", "Manager"].includes(activeRole)) {
        result = { ok: false, error: "Only management can resolve defects." };
        return current;
      }

      const target = (current.defects ?? []).find((defect) => defect.id === defectId);
      const amount = Number(repairCost);
      if (!target) {
        result = { ok: false, error: "Defect not found." };
        return current;
      }
      if (target.status === "resolved") {
        result = { ok: false, error: "Resolved defects are immutable." };
        return current;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        result = { ok: false, error: "Enter the repair cost to resolve this defect." };
        return current;
      }

      const vehicle = current.vehicles.find((item) => item.id === target.vehicleId);
      const expenseId = createRecordId("txn-exp");
      const timestamp = new Date().toISOString();
      const expenseRecord = {
        id: expenseId,
        type: "expense",
        expenseKind: "asset",
        category: `Repair / ${target.category}`,
        vehicleId: target.vehicleId,
        vehicle: vehicle?.registration ?? "Vehicle",
        amount,
        cashExpense: true,
        status: "verified",
        timestamp,
        createdBy: getCurrentActorId(activeRole, current),
        createdByRole: activeRole,
        depositId: null,
      };

      result = {
        ok: true,
        message: "Defect resolved and repair expense posted to the finance ledger.",
      };

      return {
        ...current,
        defects: current.defects.map((defect) =>
          defect.id === defectId
            ? {
                ...defect,
                status: "resolved",
                repairCost: amount,
                resolvedAt: timestamp,
                resolvedExpenseId: expenseId,
              }
            : defect,
        ),
        financeTransactions: [expenseRecord, ...(current.financeTransactions ?? [])],
      };
    });

    return result;
  };

  const handleDriverShortcut = (shortcut) => {
    const token = { type: shortcut, issuedAt: Date.now() };

    if (shortcut === "Log shift takings") {
      setDriverShortcutIntent(token);
      setActiveView("drivers");
      return;
    }
    if (shortcut === "Capture special trip") {
      setDriverShortcutIntent(token);
      setActiveView("drivers");
      return;
    }
    if (shortcut === "Report a defect") {
      setActiveView("fleet");
      return;
    }
    if (shortcut === "View vehicle status") {
      setActiveView("fleet");
    }
  };

  const openDefects = currentSnapshot.defects.filter(
    (defect) => defect.status !== "resolved",
  ).length;
  const visibleFleetCount = currentSnapshot.vehicles.length;
  const criticalDocs = currentSnapshot.documents.filter(
    (document) => document.daysLeft <= 30,
  ).length;
  const activeDrivers = currentSnapshot.drivers.filter(
    (driver) => driver.role === "Driver",
  ).length;

  const moduleMeta = {
    overview: {
      stat: activeRole === "Driver" ? currentSnapshot.driverTerminal.assignedVehicle : "Live",
      sub: activeRole === "Driver" ? "My terminal" : "Operations",
    },
    finance: {
      stat: `${currentSnapshot.finance.shiftsAwaitingVerification}`,
      sub: "Awaiting count",
    },
    fleet: {
      stat: activeRole === "Driver" ? currentSnapshot.driverTerminal.assignedVehicle : `${visibleFleetCount}`,
      sub: activeRole === "Driver" ? "My vehicle" : "Visible fleet",
    },
    compliance: {
      stat: `${criticalDocs}`,
      sub: "Critical docs",
    },
    drivers: {
      stat: `${activeDrivers}`,
      sub: "Active drivers",
    },
  };

  return (
    <div className="app-shell">
      <div className="app-canvas">
        <main className="page-shell">
          <section className="app-toolbar">
            <div className="brand-lockup compact">
              <div className="brand-mark compact">TF</div>
              <div>
                <h1>{currentSnapshot.profile.fleetName}</h1>
                <p className="topbar-meta">
                  {currentSnapshot.profile.legalEntity} / {currentSnapshot.profile.district}
                </p>
              </div>
            </div>

            <div className="toolbar-actions">
              <div className="toolbar-meta">
                <span className="status-chip" data-tone="success">
                  <Clock size={14} />
                  <span>Banking window {currentSnapshot.profile.nextBankingWindow}</span>
                </span>
              </div>

              <div className="role-switcher inline">
                {ROLES.map((role) => (
                  <button
                    key={role}
                    className={
                      role === activeRole ? "role-pill active compact" : "role-pill compact"
                    }
                    onClick={() => setActiveRole(role)}
                    type="button"
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <nav className="section-nav" aria-label="Primary views">
            {allowedViews.map((item) => (
              <ModuleButton
                key={item.id}
                active={item.id === activeView}
                icon={item.icon}
                label={item.label}
                stat={moduleMeta[item.id]?.stat}
                sub={moduleMeta[item.id]?.sub}
                onClick={() => setActiveView(item.id)}
              />
            ))}
          </nav>

          {activeView === "overview" && (
            <OverviewPanel
              activeRole={activeRole}
              snapshot={currentSnapshot}
              onNavigate={setActiveView}
              onShortcutAction={handleDriverShortcut}
              onSelectDriverVehicle={selectDriverVehicle}
            />
          )}
          {activeView === "finance" && (
            <FinancePanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              onNavigate={setActiveView}
              onSaveStandardIncome={saveStandardIncome}
              onSaveSpecialIncome={saveSpecialIncome}
              onSaveExpense={saveExpense}
              onVerifyIncome={verifyIncome}
              onDeleteTransaction={deleteTransaction}
              onLockDeposit={lockDeposit}
            />
          )}
          {activeView === "fleet" && (
            <FleetPanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              onSaveVehicle={saveVehicleProfile}
              onArchiveVehicle={archiveVehicle}
              onLogDefect={logDefect}
              onResolveDefect={resolveDefect}
              onSelectDriverVehicle={selectDriverVehicle}
            />
          )}
          {activeView === "compliance" && <CompliancePanel snapshot={currentSnapshot} />}
          {activeView === "drivers" && (
            <DriversPanel
              snapshot={currentSnapshot}
              activeRole={activeRole}
              onShortcutAction={handleDriverShortcut}
              shortcutIntent={driverShortcutIntent}
              onSaveStandardIncome={saveStandardIncome}
              onSaveSpecialIncome={saveSpecialIncome}
              onSelectDriverVehicle={selectDriverVehicle}
            />
          )}
        </main>

        <footer className="app-footer">
          <span>Created by Apprigate</span>
          <a href="https://www.apprigate.com" target="_blank" rel="noreferrer">
            www.apprigate.com
          </a>
        </footer>
      </div>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {allowedViews.map((item) => (
          <button
            key={item.id}
            className={item.id === activeView ? "bottom-nav-item active" : "bottom-nav-item"}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function OverviewPanel({ activeRole, snapshot, onNavigate, onShortcutAction, onSelectDriverVehicle }) {
  const isDriver = activeRole === "Driver";
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const linkedVehicleIds = new Set(linkedVehicles.map((vehicle) => vehicle.id));
  const linkedVehicleRegistrations = new Set(
    linkedVehicles.map((vehicle) => vehicle.registration),
  );
  const criticalDocs = snapshot.documents.filter((document) => document.daysLeft <= 30).length;
  const warningDocs = snapshot.documents.filter(
    (document) => document.daysLeft > 30 && document.daysLeft <= 90,
  ).length;
  const watchDocs = snapshot.documents.length - criticalDocs - warningDocs;
  const visibleVehicles = isDriver ? linkedVehicles : snapshot.vehicles;
  const visibleFleetCount = visibleVehicles.length;
  const activeVehicles = visibleVehicles.filter((vehicle) => vehicle.status !== "archived");
  const archivedVehicles = visibleFleetCount - activeVehicles.length;
  const healthyVehicles = activeVehicles.filter(
    (vehicle) => getVehicleTone(vehicle) === "success",
  ).length;
  const criticalVehicles = activeVehicles.filter(
    (vehicle) => getVehicleTone(vehicle) === "danger",
  ).length;
  const attentionVehicles = activeVehicles.length - healthyVehicles - criticalVehicles;
  const activeDriverRecord =
    snapshot.drivers.find((driver) => driver.name === snapshot.driverTerminal.activeDriver) ??
    snapshot.drivers[0];
  const assignedVehicle = visibleVehicles.find(
    (vehicle) => vehicle.registration === snapshot.driverTerminal.assignedVehicle,
  ) ?? linkedVehicles[0];
  const driverDefects = snapshot.defects.filter(
    (defect) =>
      linkedVehicleIds.has(defect.vehicleId) || linkedVehicleRegistrations.has(defect.vehicle),
  );
  const cashSeries = snapshot.verificationQueue.slice(0, 4).map((entry) => ({
    label: entry.driver.split(" ")[0],
    primary: entry.counted,
    secondary: entry.claimed,
  }));
  const bankingSeries = [
    { label: "In", value: snapshot.finance.bankingBatch.verifiedTakings },
    { label: "Out", value: snapshot.finance.bankingBatch.cashExpenses },
    { label: "Net", value: snapshot.finance.bankingBatch.depositAmount },
  ];

  if (isDriver) {
    return (
      <div className="content-stack">
        <div className="analytics-grid overview-analytics">
          <InsightCard
            title="Last shift"
            metric={formatMoney(snapshot.driverTerminal.lastShift.revenue)}
            meta={snapshot.driverTerminal.lastShift.status}
            icon={CheckSquare}
            tone="success"
          >
            <MiniBars
              items={[
                { label: "Open", value: snapshot.driverTerminal.lastShift.openOdo },
                { label: "Close", value: snapshot.driverTerminal.lastShift.closeOdo },
              ]}
              tone="success"
            />
          </InsightCard>

          <InsightCard
            title="Assigned vehicle"
            metric={snapshot.driverTerminal.assignedVehicle}
            meta={snapshot.driverTerminal.assignedRoute}
            icon={Car}
            tone="navy"
          >
            <RingMeter
              value={assignedVehicle?.utilisation ?? 0}
              total={100}
              label={`${assignedVehicle?.utilisation ?? 0}%`}
              tone="navy"
            />
          </InsightCard>

          <InsightCard
            title="PrDP runway"
            metric={activeDriverRecord?.prdpDays ? `${activeDriverRecord.prdpDays}d` : "N/A"}
            meta="days left"
            icon={Shield}
            tone={activeDriverRecord?.prdpDays && activeDriverRecord.prdpDays <= 30 ? "danger" : "info"}
          >
            <RingMeter
              value={Math.max(Math.min(activeDriverRecord?.prdpDays ?? 0, 180), 0)}
              total={180}
              label={activeDriverRecord?.prdpDays ? `${activeDriverRecord.prdpDays}` : "N/A"}
              tone={
                activeDriverRecord?.prdpDays && activeDriverRecord.prdpDays <= 30
                  ? "danger"
                  : "info"
              }
            />
          </InsightCard>

          <InsightCard
            title="Open defects"
            metric={`${driverDefects.length}`}
            meta="my vehicle"
            icon={AlertTriangle}
            tone={driverDefects.length > 0 ? "warning" : "success"}
          >
            <SegmentMeter
              segments={[
                { label: "Open", value: driverDefects.length, tone: "warning" },
                { label: "Clear", value: Math.max(3 - driverDefects.length, 0), tone: "success" },
              ]}
            />
          </InsightCard>
        </div>

        {linkedVehicles.length > 1 && (
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Linked vehicles</p>
              <h3>Choose active vehicle</h3>
            </div>
            <div className="finance-sub-switch">
              {linkedVehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  type="button"
                  className={
                    vehicle.id === snapshot.driverTerminal.assignedVehicleId
                      ? "finance-sub-pill active"
                      : "finance-sub-pill"
                  }
                  onClick={() => onSelectDriverVehicle(vehicle.id)}
                >
                  {vehicle.registration}
                </button>
              ))}
            </div>
          </article>
        )}

        <div className="overview-board-grid">
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Today</p>
              <h3>Quick actions</h3>
            </div>
            <div className="shortcut-grid compact">
              {snapshot.driverTerminal.shortcuts.map((shortcut) => (
                <button
                  key={shortcut}
                  type="button"
                  className="shortcut-button"
                  onClick={() => onShortcutAction(shortcut)}
                >
                  {shortcut}
                </button>
              ))}
            </div>
          </article>

          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Attention</p>
              <h3>My alerts</h3>
            </div>
            <div className="compact-feed">
              {driverDefects.slice(0, 2).map((defect) => (
                <CompactFeedItem
                  key={`${defect.vehicle}-${defect.issue}`}
                  title={defect.issue}
                  subtitle={defect.statusLabel ?? defect.status}
                  tone={getDefectTone(defect.severity)}
                  meta={defect.reportedAtLabel ?? defect.reportedAt}
                />
              ))}
              <CompactFeedItem
                title="Odometer continuity"
                subtitle={`${snapshot.driverTerminal.lastShift.openOdo.toLocaleString()} to ${snapshot.driverTerminal.lastShift.closeOdo.toLocaleString()} km`}
                tone="info"
                meta={snapshot.driverTerminal.assignedVehicle}
              />
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="content-stack">
      <div className="analytics-grid overview-analytics">
        <InsightCard
          title="Cash capture"
          metric={formatMoney(snapshot.finance.pendingCashInSafe)}
          meta={`${snapshot.finance.verifiedToday} verified`}
          icon={Lock}
          tone="warning"
        >
          <MiniCompareChart items={cashSeries} />
        </InsightCard>

        <InsightCard
          title="Banking batch"
          metric={formatMoney(snapshot.finance.bankingBatch.depositAmount)}
          meta={snapshot.finance.bankingBatch.reference}
          icon={Building2}
          tone="navy"
        >
          <MiniBars items={bankingSeries} tone="navy" />
        </InsightCard>

        <InsightCard
          title="Compliance"
          metric={`${criticalDocs} critical`}
          meta="90 / 60 / 30"
          icon={ShieldAlert}
          tone={criticalDocs > 0 ? "danger" : "info"}
        >
          <SegmentMeter
            segments={[
              { label: "30", value: criticalDocs, tone: "danger" },
              { label: "60", value: warningDocs, tone: "warning" },
              { label: "90", value: watchDocs, tone: "info" },
            ]}
          />
        </InsightCard>

        <InsightCard
          title="Fleet overview"
          metric={`${visibleFleetCount}`}
          meta={`${activeVehicles.length} active / ${archivedVehicles} archived`}
          icon={Wrench}
          tone={criticalVehicles > 0 ? "warning" : "success"}
        >
          <SegmentMeter
            segments={[
              { label: "Healthy", value: healthyVehicles, tone: "success" },
              { label: "Attention", value: attentionVehicles, tone: "warning" },
              { label: "Critical", value: criticalVehicles, tone: "danger" },
            ]}
          />
        </InsightCard>
      </div>

      <div className="overview-board-grid">
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Queue</p>
            <h3>Cash and gap flags</h3>
          </div>
          <div className="compact-feed">
            {snapshot.verificationQueue
              .filter((entry) => entry.shortage > 0 || entry.gapKm > 0)
              .slice(0, 3)
              .map((entry) => (
                <CompactFeedItem
                  key={entry.id}
                  title={`${entry.driver} / ${entry.vehicle}`}
                  subtitle={entry.status}
                  tone={getQueueTone(entry)}
                  meta={`${formatMoney(entry.shortage)} / ${entry.gapKm} km`}
                />
              ))}
          </div>
        </article>

        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Renewals</p>
            <h3>Next expiries</h3>
          </div>
          <div className="compact-feed">
            {snapshot.documents.slice(0, 3).map((document) => (
              <CompactFeedItem
                key={`${document.subject}-${document.document}`}
                title={`${document.subject} / ${document.document}`}
                subtitle={document.stage}
                tone={getDocumentTone(document.daysLeft)}
                meta={`${document.daysLeft} days`}
              />
            ))}
          </div>
        </article>

        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Loop</p>
            <h3>Daily flow</h3>
          </div>
          <div className="flow-strip">
            {snapshot.operationsLoop.map((step) => (
              <FlowLane key={step.id} owner={step.owner} title={step.title} tone={step.accent} />
            ))}
          </div>
          <div className="module-quick-links">
            <button className="cta-link" onClick={() => onNavigate("finance")} type="button">
              Finance
              <ChevronRight size={16} />
            </button>
            <button className="cta-link" onClick={() => onNavigate("fleet")} type="button">
              Fleet
              <ChevronRight size={16} />
            </button>
            <button className="cta-link" onClick={() => onNavigate("compliance")} type="button">
              Compliance
              <ChevronRight size={16} />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

function FinancePanel({
  snapshot,
  activeRole,
  onNavigate,
  onSaveStandardIncome,
  onSaveSpecialIncome,
  onSaveExpense,
  onVerifyIncome,
  onDeleteTransaction,
  onLockDeposit,
}) {
  const finance = snapshot.finance;
  const defaultVehicleId = snapshot.vehicles[0]?.id ?? "";
  const [financeView, setFinanceView] = useState("revenue");
  const [expenseView, setExpenseView] = useState("vehicle");
  const [feedback, setFeedback] = useState(null);
  const [verificationInputs, setVerificationInputs] = useState({});
  const [pendingRevenueTarget, setPendingRevenueTarget] = useState(null);
  const standardEntryRef = useRef(null);
  const specialEntryRef = useRef(null);
  const depositLockRef = useRef(null);
  const verificationQueueRef = useRef(null);
  const [standardDraft, setStandardDraft] = useState(() =>
    createStandardDraft(defaultVehicleId, finance.vehicleOpenings?.[defaultVehicleId]),
  );
  const [specialDraft, setSpecialDraft] = useState(() => createSpecialDraft(defaultVehicleId));
  const [expenseDraft, setExpenseDraft] = useState(() =>
    createExpenseDraft("asset", defaultVehicleId),
  );

  const incomeRecords = snapshot.financeTransactions.filter((record) => record.type === "income");
  const expenseRecords = snapshot.financeTransactions.filter((record) => record.type === "expense");
  const filteredExpenseRecords = expenseRecords.filter((record) =>
    expenseView === "vehicle" ? record.expenseKind === "asset" : record.expenseKind === "operational",
  );
  const expenseItems =
    expenseView === "vehicle"
      ? finance.expenseManagement.vehicleSpecific
      : finance.expenseManagement.operational;
  const selectedVehicleOpening =
    finance.vehicleOpenings?.[standardDraft.vehicleId || defaultVehicleId] ?? 0;
  const distance =
    Number(standardDraft.closingOdo || 0) - Number(standardDraft.openingOdo || 0);
  const gapKm = Math.abs(
    Number(standardDraft.openingOdo || selectedVehicleOpening) - Number(selectedVehicleOpening || 0),
  );
  const standardValidationError = getStandardDraftValidationError(standardDraft);
  const verificationRecords = incomeRecords.slice(0, 8);
  const pendingVerificationCount = verificationRecords.filter(
    (record) => record.status === "pending",
  ).length;
  const depositHistory = snapshot.deposits.slice(0, 3);
  const lockableCount = snapshot.financeTransactions.filter(
    (record) => record.status === "verified",
  ).length;

  useEffect(() => {
    if (!standardDraft.vehicleId && defaultVehicleId) {
      setStandardDraft(createStandardDraft(defaultVehicleId, finance.vehicleOpenings?.[defaultVehicleId]));
    }
  }, [defaultVehicleId, finance.vehicleOpenings, standardDraft.vehicleId]);

  useEffect(() => {
    if (!specialDraft.vehicleId && defaultVehicleId) {
      setSpecialDraft(createSpecialDraft(defaultVehicleId));
    }
  }, [defaultVehicleId, specialDraft.vehicleId]);

  useEffect(() => {
    if (expenseDraft.expenseKind === "asset" && !expenseDraft.vehicleId && defaultVehicleId) {
      setExpenseDraft((current) => ({ ...current, vehicleId: defaultVehicleId }));
    }
  }, [defaultVehicleId, expenseDraft.expenseKind, expenseDraft.vehicleId]);

  useEffect(() => {
    if (financeView !== "revenue" || !pendingRevenueTarget) {
      return;
    }

    const targetRef = pendingRevenueTarget === "special" ? specialEntryRef : standardEntryRef;
    const targetNode = targetRef.current;

    if (!targetNode) {
      return;
    }

    targetNode.scrollIntoView({ behavior: "smooth", block: "start" });
    targetNode.querySelector("input, select, button")?.focus();
    setPendingRevenueTarget(null);
  }, [financeView, pendingRevenueTarget]);

  const pushFeedback = (response) => {
    if (!response) {
      return;
    }

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  const handleExpenseViewChange = (nextView) => {
    setExpenseView(nextView);
    setExpenseDraft(
      createExpenseDraft(nextView === "vehicle" ? "asset" : "operational", defaultVehicleId),
    );
  };

  const handleStandardSubmit = (event) => {
    event.preventDefault();
    const response = onSaveStandardIncome(standardDraft);
    pushFeedback(response);
    if (response.ok) {
      setStandardDraft(createStandardDraft(standardDraft.vehicleId, response.nextOpeningOdo));
    }
  };

  const handleSpecialSubmit = (event) => {
    event.preventDefault();
    const response = onSaveSpecialIncome(specialDraft);
    pushFeedback(response);
    if (response.ok) {
      setSpecialDraft(createSpecialDraft(specialDraft.vehicleId || defaultVehicleId));
    }
  };

  const handleExpenseSubmit = (event) => {
    event.preventDefault();
    const response = onSaveExpense(expenseDraft);
    pushFeedback(response);
    if (response.ok) {
      setExpenseDraft(
        createExpenseDraft(expenseView === "vehicle" ? "asset" : "operational", defaultVehicleId),
      );
    }
  };

  const handleVerify = (recordId) => {
    const response = onVerifyIncome(recordId, verificationInputs[recordId]);
    pushFeedback(response);
    if (response.ok) {
      setVerificationInputs((current) => {
        const next = { ...current };
        delete next[recordId];
        return next;
      });
    }
  };

  const handleDelete = (recordId) => {
    pushFeedback(onDeleteTransaction(recordId));
  };

  const handleEditIncome = (record) => {
    setFinanceView("revenue");
    if (record.incomeKind === "standard") {
      setStandardDraft({
        id: record.id,
        vehicleId: record.vehicleId,
        openingOdo: String(record.openingOdo ?? ""),
        closingOdo: String(record.closingOdo ?? ""),
        amountClaimed: String(record.amountClaimed ?? record.amount ?? ""),
      });
      return;
    }

    setSpecialDraft({
      id: record.id,
      vehicleId: record.vehicleId ?? defaultVehicleId,
      description: record.description ?? "",
      amount: String(record.amount ?? ""),
    });
  };

  const handleEditExpense = (record) => {
    setFinanceView("expenses");
    setExpenseView(record.expenseKind === "asset" ? "vehicle" : "operational");
    setExpenseDraft({
      id: record.id,
      expenseKind: record.expenseKind,
      category: record.category ?? "",
      vehicleId: record.vehicleId ?? defaultVehicleId,
      amount: String(record.amount ?? ""),
      cashExpense: Boolean(record.cashExpense),
    });
  };

  const openRevenueEntry = (target = "standard") => {
    setFinanceView("revenue");
    setPendingRevenueTarget(target);
  };

  const scrollToSection = (targetRef) => {
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="content-stack">
      <section className="hero-card hero-card-minimal finance-access-card">
        <div className="hero-copy hero-copy-minimal">
          <p className="eyebrow">Quick access</p>
          <h2>Daily taking-in log</h2>
          <p className="hero-text">
            Use this entry point to capture daily route takings and special trip income without
            hunting through the finance screens.
          </p>
          <div className="hero-meta-strip">
            <span className="status-chip" data-tone="info">
              Standard shifts
            </span>
            <span className="status-chip" data-tone="warning">
              Special trips
            </span>
            <span className="status-chip" data-tone="success">
              {finance.shiftsAwaitingVerification} awaiting verification
            </span>
          </div>
        </div>

        <div className="finance-shortcut-row">
          <button
            type="button"
            className="action-button primary finance-shortcut-button"
            onClick={() => openRevenueEntry("standard")}
          >
            <ArrowDownToLine size={16} />
            Open daily taking-in log
          </button>
          <button
            type="button"
            className="action-button finance-shortcut-button"
            onClick={() => openRevenueEntry("special")}
          >
            <TrendingUp size={16} />
            Open special trip entry
          </button>
        </div>
      </section>

      <div className="finance-module-nav">
        <FinanceModeButton
          active={financeView === "revenue"}
          label="Daily Taking-In Log"
          meta="Standard shifts and special trips"
          icon={TrendingUp}
          onClick={() => setFinanceView("revenue")}
        />
        <FinanceModeButton
          active={financeView === "expenses"}
          label="Expense Management"
          meta="Vehicle-specific and operational"
          icon={Briefcase}
          onClick={() => setFinanceView("expenses")}
        />
        <FinanceModeButton
          active={financeView === "banking"}
          label="Banking Module"
          meta="Verification and lock"
          icon={Lock}
          onClick={() => setFinanceView("banking")}
        />
      </div>

      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      {financeView === "revenue" && (
        <div className="content-stack">
          <div className="analytics-grid finance-analytics">
            <InsightCard
              title="Standard route shifts"
              metric={`${finance.revenueLogging.standardRouteCount}`}
              meta={formatMoney(finance.revenueLogging.standardRouteRevenue)}
              icon={Banknote}
              tone="navy"
            >
              <MiniBars
                items={finance.revenueLogging.routes.map((route) => ({
                  label: route.label,
                  value: route.amount,
                }))}
                tone="navy"
              />
            </InsightCard>

            <InsightCard
              title="Special trips"
              metric={`${finance.revenueLogging.specialTripCount}`}
              meta={formatMoney(finance.revenueLogging.specialTripRevenue)}
              icon={TrendingUp}
              tone="info"
            >
              <MiniBars
                items={finance.revenueLogging.specialTrips.map((trip) => ({
                  label: trip.vehicle.split(" ")[0],
                  value: trip.amount,
                }))}
                tone="info"
              />
            </InsightCard>

            <InsightCard
              title="Claimed today"
              metric={formatMoney(finance.todayClaimed)}
              meta="Pending plus verified"
              icon={ArrowDownToLine}
              tone="warning"
            >
              <SegmentMeter
                segments={[
                  { label: "Verified", value: finance.verifiedToday, tone: "success" },
                  {
                    label: "Pending",
                    value: finance.shiftsAwaitingVerification,
                    tone: "warning",
                  },
                ]}
              />
            </InsightCard>

            <InsightCard
              title="Counted today"
              metric={formatMoney(finance.todayCounted)}
              meta="Physical cash verified"
              icon={CheckCircle2}
              tone="success"
            >
              <MiniCompareChart
                items={snapshot.verificationQueue.slice(0, 4).map((entry) => ({
                  label: entry.driver.split(" ")[0],
                  primary: entry.counted,
                  secondary: entry.claimed,
                }))}
              />
            </InsightCard>
          </div>

          <div className="finance-board-grid finance-board-grid-3">
            <article ref={standardEntryRef} className="overview-board finance-entry-board">
              <div className="overview-board-head">
                <p className="eyebrow">Daily taking-in log</p>
                <h3>Standard shift entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleStandardSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Vehicle</span>
                    <select
                      value={standardDraft.vehicleId}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          vehicleId: event.target.value,
                          openingOdo: String(
                            finance.vehicleOpenings?.[event.target.value] ?? "",
                          ),
                        }))
                      }
                    >
                      {snapshot.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.registration} / {vehicle.route}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="finance-field">
                    <span>Opening odo</span>
                    <input
                      type="number"
                      value={standardDraft.openingOdo}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          openingOdo: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Closing odo</span>
                    <input
                      type="number"
                      min={Number(standardDraft.openingOdo || 0) + 1}
                      value={standardDraft.closingOdo}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          closingOdo: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Amount claimed</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={standardDraft.amountClaimed}
                      onChange={(event) =>
                        setStandardDraft((current) => ({
                          ...current,
                          amountClaimed: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="finance-form-meta">
                  <span className="status-chip" data-tone={gapKm > 0 ? "warning" : "info"}>
                    Expected opening {Number(selectedVehicleOpening).toLocaleString()} km
                  </span>
                  <span className="status-chip" data-tone={distance > 0 ? "success" : "danger"}>
                    Distance {Math.max(distance, 0).toLocaleString()} km
                  </span>
                </div>

                <div className="finance-form-actions">
                  <button
                    type="submit"
                    className="action-button primary"
                    disabled={Boolean(standardValidationError)}
                  >
                    {standardDraft.id ? "Update shift" : "Save shift"}
                  </button>
                  {standardDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() =>
                        setStandardDraft(
                          createStandardDraft(
                            defaultVehicleId,
                            finance.vehicleOpenings?.[defaultVehicleId],
                          ),
                        )
                      }
                    >
                      Cancel edit
                    </button>
                  )}
                </div>

                <p
                  className="finance-form-note"
                  data-tone={standardValidationError ? "danger" : "info"}
                >
                  {standardValidationError ??
                    (standardDraft.id
                      ? "Shift details are complete and ready to update."
                      : "Shift details are complete and ready to save.")}
                </p>
              </form>
            </article>

            <article ref={specialEntryRef} className="overview-board finance-entry-board">
              <div className="overview-board-head">
                <p className="eyebrow">Daily taking-in log</p>
                <h3>Special trip entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleSpecialSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Vehicle</span>
                    <select
                      value={specialDraft.vehicleId}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          vehicleId: event.target.value,
                        }))
                      }
                    >
                      {snapshot.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.registration}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="finance-field finance-field-wide">
                    <span>Description</span>
                    <input
                      type="text"
                      value={specialDraft.description}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={specialDraft.amount}
                      onChange={(event) =>
                        setSpecialDraft((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="finance-form-meta">
                  <span className="status-chip" data-tone="info">
                    Tagged as income / special
                  </span>
                  <span className="status-chip" data-tone="warning">
                    Excluded from route average metrics
                  </span>
                </div>

                <div className="finance-form-actions">
                  <button type="submit" className="action-button primary">
                    {specialDraft.id ? "Update trip" : "Save trip"}
                  </button>
                  {specialDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => setSpecialDraft(createSpecialDraft(defaultVehicleId))}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Recent income</p>
                <h3>Pending, verified, and locked</h3>
              </div>

              <div className="finance-ledger">
                {incomeRecords.slice(0, 6).map((record) => (
                  <article key={record.id} className="ledger-row">
                    <div className="ledger-copy">
                      <strong>
                        {record.incomeKind === "special"
                          ? record.description
                          : `${record.vehicle} / ${record.route}`}
                      </strong>
                      <span>
                        {record.incomeKind === "special" ? "Special trip" : "Standard shift"} /{" "}
                        {formatStamp(record.timestamp)}
                      </span>
                    </div>
                    <div className="ledger-meta">
                      <span className="status-chip" data-tone={getTransactionTone(record)}>
                        {record.status}
                      </span>
                      <strong>{formatMoney(record.amountClaimed ?? record.amount)}</strong>
                    </div>
                    <div className="record-actions">
                      <button
                        type="button"
                        className="record-button"
                        disabled={record.status === "banked"}
                        onClick={() => handleEditIncome(record)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={record.status === "banked"}
                        onClick={() => handleDelete(record.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="module-quick-links stack">
                <button className="cta-link" onClick={() => onNavigate("drivers")} type="button">
                  Drivers
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => onNavigate("fleet")} type="button">
                  Fleet
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => setFinanceView("banking")} type="button">
                  Banking module
                  <ChevronRight size={16} />
                </button>
              </div>
            </article>
          </div>
        </div>
      )}

      {financeView === "expenses" && activeRole !== "Driver" && (
        <div className="content-stack">
          <div className="finance-sub-switch">
            <button
              type="button"
              className={
                expenseView === "vehicle" ? "finance-sub-pill active" : "finance-sub-pill"
              }
              onClick={() => handleExpenseViewChange("vehicle")}
            >
              Vehicle-Specific
            </button>
            <button
              type="button"
              className={
                expenseView === "operational" ? "finance-sub-pill active" : "finance-sub-pill"
              }
              onClick={() => handleExpenseViewChange("operational")}
            >
              Operational
            </button>
          </div>

          <div className="analytics-grid finance-analytics">
            <InsightCard
              title={expenseView === "vehicle" ? "Asset-linked costs" : "Operational costs"}
              metric={formatMoney(sumBy(expenseItems, (item) => item.amount))}
              meta={expenseView === "vehicle" ? "Vehicle net yield impact" : "Global profit impact"}
              icon={Briefcase}
              tone={expenseView === "vehicle" ? "warning" : "info"}
            >
              <MiniBars
                items={expenseItems.map((item) => ({
                  label: item.category,
                  value: item.amount,
                }))}
                tone={expenseView === "vehicle" ? "warning" : "info"}
              />
            </InsightCard>

            <InsightCard
              title="Cash-out mix"
              metric={`${filteredExpenseRecords.length}`}
              meta="Verified and pending"
              icon={FileText}
              tone="navy"
            >
              <SegmentMeter
                segments={[
                  {
                    label: "Cash",
                    value: sumBy(
                      filteredExpenseRecords.filter((record) => record.cashExpense),
                      (record) => record.amount,
                    ),
                    tone: "warning",
                  },
                  {
                    label: "Non-cash",
                    value: sumBy(
                      filteredExpenseRecords.filter((record) => !record.cashExpense),
                      (record) => record.amount,
                    ),
                    tone: "info",
                  },
                ]}
              />
            </InsightCard>
          </div>

          <div className="finance-board-grid finance-board-grid-3">
            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Expense engine</p>
                <h3>{expenseView === "vehicle" ? "Asset-linked" : "Operational"} entry</h3>
              </div>

              <form className="finance-form" onSubmit={handleExpenseSubmit}>
                <div className="finance-form-grid">
                  <label className="finance-field">
                    <span>Category</span>
                    <input
                      type="text"
                      value={expenseDraft.category}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    />
                  </label>

                  {expenseView === "vehicle" && (
                    <label className="finance-field">
                      <span>Vehicle</span>
                      <select
                        value={expenseDraft.vehicleId}
                        onChange={(event) =>
                          setExpenseDraft((current) => ({
                            ...current,
                            vehicleId: event.target.value,
                          }))
                        }
                      >
                        {snapshot.vehicles.map((vehicle) => (
                          <option key={vehicle.id} value={vehicle.id}>
                            {vehicle.registration} / {vehicle.route}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="finance-field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={expenseDraft.amount}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="finance-field finance-field-check">
                    <span>Paid from safe</span>
                    <input
                      type="checkbox"
                      checked={expenseDraft.cashExpense}
                      onChange={(event) =>
                        setExpenseDraft((current) => ({
                          ...current,
                          cashExpense: event.target.checked,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="finance-form-meta">
                  <span className="status-chip" data-tone={expenseView === "vehicle" ? "warning" : "info"}>
                    {expenseView === "vehicle"
                      ? "Decrements vehicle net yield"
                      : "Decrements global fleet profit"}
                  </span>
                  <span
                    className="status-chip"
                    data-tone={PRIVILEGED_ROLES.has(activeRole) ? "success" : "warning"}
                  >
                    Status defaults to {PRIVILEGED_ROLES.has(activeRole) ? "verified" : "pending"}
                  </span>
                </div>

                <div className="finance-form-actions">
                  <button type="submit" className="action-button primary">
                    {expenseDraft.id ? "Update expense" : "Save expense"}
                  </button>
                  {expenseDraft.id && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() =>
                        setExpenseDraft(
                          createExpenseDraft(
                            expenseView === "vehicle" ? "asset" : "operational",
                            defaultVehicleId,
                          ),
                        )
                      }
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Recent expenses</p>
                <h3>{expenseView === "vehicle" ? "Vehicle-linked ledger" : "Overhead ledger"}</h3>
              </div>

              <div className="finance-ledger">
                {filteredExpenseRecords.slice(0, 6).map((record) => (
                  <article key={record.id} className="ledger-row">
                    <div className="ledger-copy">
                      <strong>{record.category}</strong>
                      <span>
                        {record.vehicle ?? "General"} / {formatStamp(record.timestamp)}
                      </span>
                    </div>
                    <div className="ledger-meta">
                      <span className="status-chip" data-tone={getTransactionTone(record)}>
                        {record.status}
                      </span>
                      <strong>{formatMoney(record.amount)}</strong>
                    </div>
                    <div className="record-actions">
                      <button
                        type="button"
                        className="record-button"
                        disabled={record.status === "banked"}
                        onClick={() => handleEditExpense(record)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={record.status === "banked"}
                        onClick={() => handleDelete(record.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="overview-board">
              <div className="overview-board-head">
                <p className="eyebrow">Linked modules</p>
                <h3>Impact controls</h3>
              </div>

              <div className="compact-feed">
                <CompactFeedItem
                  title="Fleet net yield"
                  subtitle="Vehicle-specific costs"
                  tone="warning"
                  meta={formatMoney(
                    sumBy(snapshot.vehicles, (vehicle) => vehicle.assetExpenseTotal ?? 0),
                  )}
                />
                <CompactFeedItem
                  title="Global fleet profit"
                  subtitle="Income less approved costs"
                  tone="info"
                  meta={formatMoney(finance.globalFleetProfit)}
                />
              </div>

              <div className="module-quick-links stack">
                <button className="cta-link" onClick={() => onNavigate("fleet")} type="button">
                  Fleet assets
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => setFinanceView("banking")} type="button">
                  Banking module
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => onNavigate("overview")} type="button">
                  Overview
                  <ChevronRight size={16} />
                </button>
              </div>
            </article>
          </div>
        </div>
      )}

      {financeView === "banking" && activeRole !== "Driver" && (
        <div className="content-stack">
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Manager controls</p>
              <h3>Verify takings and lock deposits</h3>
            </div>
            <p className="panel-note">
              Managers can verify pending takings first, then lock the deposit once the cash count
              is complete.
            </p>
            <div className="finance-form-actions">
              <button
                type="button"
                className="action-button primary"
                onClick={() => scrollToSection(verificationQueueRef)}
              >
                <CheckSquare size={16} />
                Verify pending takings
              </button>
              <button
                type="button"
                className="action-button"
                onClick={() => scrollToSection(depositLockRef)}
              >
                <Lock size={16} />
                Open deposit lock
              </button>
              <span
                className="status-chip"
                data-tone={pendingVerificationCount > 0 ? "warning" : "success"}
              >
                {pendingVerificationCount} pending
              </span>
            </div>
          </article>

          <div ref={depositLockRef} className="two-up">
            <Panel eyebrow="Banking loop" title="Digital deposit slip" icon={Lock}>
              <div className="deposit-card">
                <div className="deposit-row">
                  <span>Verified takings</span>
                  <strong>{formatMoney(finance.bankingBatch.verifiedTakings)}</strong>
                </div>
                <div className="deposit-row">
                  <span>Cash-out expenses</span>
                  <strong>{formatMoney(finance.bankingBatch.cashExpenses)}</strong>
                </div>
                <div className="deposit-row total">
                  <span>Net bankable cash</span>
                  <strong>{formatMoney(finance.bankingBatch.depositAmount)}</strong>
                </div>
                <div className="deposit-meta">
                  <span className="status-chip" data-tone="navy">
                    <Building2 size={14} />
                    <span>{finance.bankingBatch.reference}</span>
                  </span>
                  <span className="status-chip" data-tone="info">
                    <Calendar size={14} />
                    <span>{finance.bankingBatch.depositSlip.generatedAt}</span>
                  </span>
                </div>
                <p className="panel-note">
                  Net bankable cash reacts to verified income minus verified cash expenses.
                  Confirming the deposit seals {finance.bankingBatch.depositSlip.recordsLocked} records.
                </p>
                <div className="finance-form-actions">
                  <button
                    type="button"
                    className="action-button primary"
                    disabled={lockableCount === 0}
                    onClick={() => pushFeedback(onLockDeposit())}
                  >
                    Confirm & lock deposit
                  </button>
                </div>
              </div>
            </Panel>

            <Panel eyebrow="Lock flow" title="State-lock and deposit history" icon={ArrowDownToLine}>
              <div className="flow-strip">
                <FlowLane owner="Verified cash" title="Aggregate takings" tone="teal" />
                <FlowLane owner="Cash-out" title="Subtract expenses" tone="gold" />
                <FlowLane owner="Deposit slip" title="Seal records" tone="navy" />
              </div>
              <div className="finance-ledger">
                {depositHistory.map((deposit) => (
                  <article key={deposit.depositId} className="ledger-row">
                    <div className="ledger-copy">
                      <strong>{deposit.reference}</strong>
                      <span>{formatStamp(deposit.timestamp)}</span>
                    </div>
                    <div className="ledger-meta">
                      <span className="status-chip" data-tone="navy">
                        {deposit.recordsLocked} locked
                      </span>
                      <strong>{formatMoney(deposit.depositAmount)}</strong>
                    </div>
                  </article>
                ))}
              </div>
              <div className="module-quick-links stack">
                <button className="cta-link" onClick={() => setFinanceView("revenue")} type="button">
                  Daily taking-in log
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => setFinanceView("expenses")} type="button">
                  Expense management
                  <ChevronRight size={16} />
                </button>
                <button className="cta-link" onClick={() => onNavigate("overview")} type="button">
                  Overview
                  <ChevronRight size={16} />
                </button>
              </div>
            </Panel>
          </div>

          <div ref={verificationQueueRef}>
            <Panel eyebrow="Verification queue" title="Pending cash and locked records" icon={CheckSquare}>
              <div className="queue-grid">
              {verificationRecords.map((record) => {
                const entry = snapshot.verificationQueue.find((item) => item.id === record.id);
                const queueEntry = entry ?? {
                  claimed: Number(record.amountClaimed ?? record.amount ?? 0),
                  counted: Number(record.actualCashReceived ?? 0),
                  shortage: 0,
                  gapKm: 0,
                  status: "Verified",
                  driver: "Driver",
                };

                return (
                  <article key={record.id} className="queue-card">
                    <div className="queue-header">
                      <div>
                        <h3>
                          {record.incomeKind === "special"
                            ? record.description
                            : `${record.vehicle} / ${record.route}`}
                        </h3>
                        <p>
                          {queueEntry.driver} / {formatStamp(record.timestamp)}
                        </p>
                      </div>
                      <span className="status-chip" data-tone={getQueueTone(queueEntry)}>
                        {queueEntry.status}
                      </span>
                    </div>

                    <div className="queue-stats">
                      <InfoPair label="Claimed" value={formatMoney(queueEntry.claimed)} />
                      <InfoPair label="Counted" value={formatMoney(queueEntry.counted)} />
                      <InfoPair label="Shortage" value={formatMoney(queueEntry.shortage)} />
                      <InfoPair label="Odo gap" value={`${queueEntry.gapKm} km`} />
                    </div>

                    <div className="verification-actions">
                      <input
                        className="verification-input"
                        type="number"
                        min="0"
                        step="1"
                        value={verificationInputs[record.id] ?? record.actualCashReceived ?? ""}
                        disabled={record.status !== "pending"}
                        onChange={(event) =>
                          setVerificationInputs((current) => ({
                            ...current,
                            [record.id]: event.target.value,
                          }))
                        }
                        placeholder="Actual cash received"
                      />
                      <button
                        type="button"
                        className="action-button primary"
                        disabled={record.status !== "pending"}
                        onClick={() => handleVerify(record.id)}
                      >
                        Verify taking
                      </button>
                      <button
                        type="button"
                        className="record-button"
                        disabled={record.status === "banked"}
                        onClick={() => handleEditIncome(record)}
                      >
                        Edit entry
                      </button>
                      <button
                        type="button"
                        className="record-button danger"
                        disabled={record.status === "banked"}
                        onClick={() => handleDelete(record.id)}
                      >
                        Delete entry
                      </button>
                    </div>
                  </article>
                );
              })}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function FleetPanel({
  snapshot,
  activeRole,
  onSaveVehicle,
  onArchiveVehicle,
  onLogDefect,
  onResolveDefect,
  onSelectDriverVehicle,
}) {
  const isDriver = activeRole === "Driver";
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const canViewVehicleProfile = !isDriver;
  const canManageVehicles = ["Owner", "Admin"].includes(activeRole);
  const canResolveDefects = ["Owner", "Admin", "Manager"].includes(activeRole);
  const assignedVehicleId =
    snapshot.driverTerminal.assignedVehicleId ?? linkedVehicles[0]?.id ?? snapshot.vehicles[0]?.id ?? null;
  const [activeFilter, setActiveFilter] = useState(isDriver ? "assigned" : "attention");
  const [selectedVehicleId, setSelectedVehicleId] = useState(assignedVehicleId);
  const [feedback, setFeedback] = useState(null);
  const [vehicleDraft, setVehicleDraft] = useState(() =>
    createVehicleDraft(snapshot.vehicles[0], snapshot.profile.serviceIntervalKm),
  );
  const [defectDraft, setDefectDraft] = useState(() =>
    createDefectDraft(assignedVehicleId ?? snapshot.vehicles[0]?.id),
  );
  const [resolutionCosts, setResolutionCosts] = useState({});
  const vehicleFormRef = useRef(null);
  const vehicleProfileRef = useRef(null);
  const defectFormRef = useRef(null);
  const openDefectsRef = useRef(null);

  const fleetHealth = useMemo(() => {
    const activeVehicles = snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived");

    return {
      total: activeVehicles.length,
      healthy: activeVehicles.filter((vehicle) => vehicle.healthState === "success").length,
      warning: activeVehicles.filter((vehicle) => vehicle.healthState === "warning").length,
      critical: activeVehicles.filter((vehicle) => vehicle.healthState === "danger").length,
      archived: snapshot.vehicles.filter((vehicle) => vehicle.status === "archived").length,
    };
  }, [snapshot.vehicles]);

  const filteredVehicles = useMemo(() => {
    if (isDriver) {
      return linkedVehicles;
    }
    if (activeFilter === "attention") {
      return snapshot.vehicles.filter(
        (vehicle) =>
          vehicle.status !== "archived" &&
          (vehicle.healthState === "warning" || vehicle.healthState === "danger"),
      );
    }
    if (activeFilter === "critical") {
      return snapshot.vehicles.filter(
        (vehicle) => vehicle.status !== "archived" && vehicle.healthState === "danger",
      );
    }
    if (activeFilter === "healthy") {
      return snapshot.vehicles.filter(
        (vehicle) => vehicle.status !== "archived" && vehicle.healthState === "success",
      );
    }
    if (activeFilter === "archived") {
      return snapshot.vehicles.filter((vehicle) => vehicle.status === "archived");
    }
    return snapshot.vehicles.filter((vehicle) => vehicle.status !== "archived");
  }, [activeFilter, assignedVehicleId, isDriver, linkedVehicles, snapshot.vehicles]);

  useEffect(() => {
    if (!filteredVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(filteredVehicles[0]?.id ?? null);
    }
  }, [filteredVehicles, selectedVehicleId]);

  const selectedVehicle =
    snapshot.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? filteredVehicles[0];
  const vehicleLedger = useMemo(
    () =>
      snapshot.financeTransactions
        .filter((record) => record.vehicleId === selectedVehicle?.id)
        .slice(0, 8),
    [selectedVehicle?.id, snapshot.financeTransactions],
  );
  const vehicleDocuments = useMemo(
    () => snapshot.documents.filter((document) => document.subjectId === selectedVehicle?.id),
    [selectedVehicle?.id, snapshot.documents],
  );
  const vehicleDefects = useMemo(
    () => snapshot.defects.filter((defect) => defect.vehicleId === selectedVehicle?.id),
    [selectedVehicle?.id, snapshot.defects],
  );
  const vehicleIncomeRecords = useMemo(
    () => vehicleLedger.filter((record) => record.type === "income"),
    [vehicleLedger],
  );
  const revenueOutline = useMemo(
    () => ({
      totalRevenue: sumBy(vehicleIncomeRecords, getIncomeCashValue),
      standardRevenue: sumBy(
        vehicleIncomeRecords.filter((record) => record.incomeKind === "standard"),
        getIncomeCashValue,
      ),
      specialRevenue: sumBy(
        vehicleIncomeRecords.filter((record) => record.isSpecial),
        (record) => record.amount,
      ),
      shiftCount: vehicleIncomeRecords.filter((record) => record.incomeKind === "standard").length,
      specialTripCount: vehicleIncomeRecords.filter((record) => record.isSpecial).length,
    }),
    [vehicleIncomeRecords],
  );
  const routeHistory = useMemo(
    () =>
      Object.values(
        vehicleIncomeRecords.reduce((groups, record) => {
          const key = record.isSpecial
            ? record.description ?? "Special trip"
            : record.route ?? selectedVehicle?.route ?? "Route";
          const current = groups[key] ?? {
            title: key,
            subtitle: record.isSpecial ? "Special trip" : "Standard route",
            trips: 0,
            revenue: 0,
            latestTimestamp: record.timestamp,
          };

          groups[key] = {
            ...current,
            trips: current.trips + 1,
            revenue: current.revenue + Number(record.amountClaimed ?? record.amount ?? 0),
            latestTimestamp:
              new Date(record.timestamp) > new Date(current.latestTimestamp)
                ? record.timestamp
                : current.latestTimestamp,
          };

          return groups;
        }, {}),
      )
        .sort((left, right) => new Date(right.latestTimestamp) - new Date(left.latestTimestamp))
        .slice(0, 4),
    [selectedVehicle?.route, vehicleIncomeRecords],
  );
  const driverHistory = useMemo(() => {
    const entries = [];
    const seen = new Set();
    const pushEntry = (name, meta, tone = "info") => {
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      entries.push({ name, meta, tone });
    };

    pushEntry(
      selectedVehicle?.assignedDriver && selectedVehicle.assignedDriver !== "Unassigned"
        ? selectedVehicle.assignedDriver
        : null,
      "Linked now",
      "success",
    );

    vehicleIncomeRecords
      .filter((record) => record.createdByRole === "Driver")
      .forEach((record) => {
        const driverName =
          snapshot.drivers.find((driver) => driver.staffId === record.createdBy)?.name ?? null;
        pushEntry(driverName, `Revenue entry / ${formatStamp(record.timestamp)}`, "info");
      });

    vehicleDefects.forEach((defect) => {
      pushEntry(defect.reportedByName, `Defect report / ${defect.reportedAtLabel}`, "warning");
    });

    return entries.slice(0, 4);
  }, [selectedVehicle?.assignedDriver, snapshot.drivers, vehicleDefects, vehicleIncomeRecords]);
  const healthHighlights = useMemo(
    () => [
      {
        title: "Fleet health",
        subtitle: selectedVehicle?.healthLabel ?? "Healthy",
        tone: getVehicleTone(selectedVehicle ?? {}) === "neutral" ? "info" : getVehicleTone(selectedVehicle ?? {}),
        meta: `${selectedVehicle?.defectsOpen ?? 0} open defects`,
      },
      {
        title: "Service runway",
        subtitle: `${selectedVehicle?.serviceDueKm?.toLocaleString() ?? 0} km remaining`,
        tone: selectedVehicle?.serviceTone ?? "info",
        meta: `Last service ${selectedVehicle?.lastServiceOdo?.toLocaleString() ?? 0} km`,
      },
      {
        title: "Compliance runway",
        subtitle: `${selectedVehicle?.minimumDocumentDays ?? 0} days minimum`,
        tone: getDocumentTone(selectedVehicle?.minimumDocumentDays ?? 365),
        meta: `Permit ${selectedVehicle?.permitDays ?? 0} / Disc ${selectedVehicle?.discDays ?? 0}`,
      },
    ],
    [selectedVehicle],
  );

  useEffect(() => {
    if (selectedVehicle && canManageVehicles) {
      setVehicleDraft(createVehicleDraft(selectedVehicle, snapshot.profile.serviceIntervalKm));
    }
  }, [canManageVehicles, selectedVehicle, snapshot.profile.serviceIntervalKm]);

  useEffect(() => {
    const targetVehicleId = isDriver ? selectedVehicle?.id ?? assignedVehicleId : selectedVehicle?.id;
    if (targetVehicleId) {
      setDefectDraft((current) => ({
        ...current,
        vehicleId: current.vehicleId || targetVehicleId,
      }));
    }
  }, [assignedVehicleId, isDriver, selectedVehicle?.id]);

  const pushFeedback = (response) => {
    if (!response) {
      return;
    }

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });
  };

  const handleVehicleSubmit = (event) => {
    event.preventDefault();
    const response = onSaveVehicle(vehicleDraft);
    pushFeedback(response);
    if (response.ok) {
      setSelectedVehicleId(response.vehicleId);
    }
  };

  const handleNewVehicle = () => {
    setVehicleDraft(createVehicleDraft(null, snapshot.profile.serviceIntervalKm));
  };

  const handleAddVehicle = () => {
    handleNewVehicle();
    vehicleFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleViewProfile = (vehicleId) => {
    setSelectedVehicleId(vehicleId);
    if (isDriver) {
      onSelectDriverVehicle(vehicleId);
    }
    vehicleProfileRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDefectSubmit = (event) => {
    event.preventDefault();
    const response = onLogDefect({
      ...defectDraft,
      vehicleId: isDriver ? selectedVehicle?.id ?? assignedVehicleId : defectDraft.vehicleId,
    });
    pushFeedback(response);
    if (response.ok) {
      setDefectDraft(
        createDefectDraft(isDriver ? selectedVehicle?.id ?? assignedVehicleId : selectedVehicle?.id),
      );
    }
  };

  const handleEditDefect = (defect) => {
    setDefectDraft({
      id: defect.id,
      vehicleId:
        defect.vehicleId ??
        (isDriver ? selectedVehicle?.id ?? assignedVehicleId : selectedVehicle?.id ?? ""),
      category: defect.category ?? DEFECT_CATEGORIES[0],
      detail: defect.detail ?? defect.issue ?? "",
    });
    defectFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleResolve = (defectId) => {
    pushFeedback(onResolveDefect(defectId, resolutionCosts[defectId]));
    setResolutionCosts((current) => {
      const next = { ...current };
      delete next[defectId];
      return next;
    });
  };

  return (
    <div className="content-stack">
      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      <Panel eyebrow="Management by exception" title="Fleet dashboard" icon={Car}>
        <div className="fleet-counter-grid">
          <article className="overview-board">
            <p className="eyebrow">Fleet health</p>
            <h3>{fleetHealth.healthy} healthy</h3>
            <p>{fleetHealth.total} active vehicles in service.</p>
          </article>
          <article className="overview-board">
            <p className="eyebrow">Warning</p>
            <h3>{fleetHealth.warning} orange</h3>
            <p>Vehicles with defects or sub-1,000km service runway.</p>
          </article>
          <article className="overview-board">
            <p className="eyebrow">Critical</p>
            <h3>{fleetHealth.critical} red</h3>
            <p>Overdue service or compliance inside the red window.</p>
          </article>
        </div>

        {canManageVehicles && (
          <div className="finance-form-actions">
            <button type="button" className="action-button primary" onClick={handleAddVehicle}>
              <Car size={16} />
              Add vehicle
            </button>
          </div>
        )}

        {!isDriver && (
          <div className="finance-sub-switch">
            {[
              ["attention", "Attention"],
              ["critical", "Critical"],
              ["healthy", "Healthy"],
              ["all", "All"],
              ["archived", `Archived ${fleetHealth.archived}`],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={activeFilter === value ? "finance-sub-pill active" : "finance-sub-pill"}
                onClick={() => setActiveFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {isDriver && linkedVehicles.length > 1 && (
          <div className="finance-sub-switch">
            {linkedVehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                className={
                  vehicle.id === selectedVehicle?.id ? "finance-sub-pill active" : "finance-sub-pill"
                }
                onClick={() => {
                  setSelectedVehicleId(vehicle.id);
                  onSelectDriverVehicle(vehicle.id);
                }}
              >
                {vehicle.registration}
              </button>
            ))}
          </div>
        )}

        <div className="fleet-management-grid">
          {filteredVehicles.map((vehicle) => (
            <article
              key={vehicle.id}
              className={
                vehicle.id === selectedVehicle?.id
                  ? "vehicle-summary-card active"
                  : "vehicle-summary-card"
              }
            >
              <button
                type="button"
                className="vehicle-summary-trigger"
                onClick={() => {
                  setSelectedVehicleId(vehicle.id);
                  if (isDriver) {
                    onSelectDriverVehicle(vehicle.id);
                  }
                }}
              >
                <div className="vehicle-summary-top">
                  <div>
                    <strong>{vehicle.registration}</strong>
                    <span>
                      {vehicle.model} / {vehicle.route}
                    </span>
                  </div>
                  <span className="status-chip" data-tone={getVehicleTone(vehicle)}>
                    {vehicle.healthLabel}
                  </span>
                </div>
                <div className="queue-stats compact">
                  <InfoPair label="Driver" value={vehicle.assignedDriver} />
                  <InfoPair label="Defects" value={`${vehicle.defectsOpen}`} />
                  <InfoPair label="Service" value={`${vehicle.serviceDueKm.toLocaleString()} km`} />
                  <InfoPair label="Documents" value={`${vehicle.minimumDocumentDays} days`} />
                </div>
              </button>

              {canViewVehicleProfile && (
                <div className="vehicle-summary-actions">
                  <button
                    type="button"
                    className="action-button primary"
                    onClick={() => handleViewProfile(vehicle.id)}
                  >
                    <FileText size={16} />
                    View profile
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </Panel>

      {selectedVehicle && (
        <>
          <div ref={vehicleProfileRef} className="two-up">
            <Panel eyebrow="Vehicle profile" title={`${selectedVehicle.registration} / ${selectedVehicle.route}`} icon={Activity}>
              <div className="queue-stats">
                <InfoPair label="Assigned driver" value={selectedVehicle.assignedDriver} />
                <InfoPair
                  label="Driver staffId"
                  value={selectedVehicle.assignedDriverId ?? "Unassigned"}
                />
                <InfoPair
                  label="Current odo"
                  value={`${selectedVehicle.currentOdometer.toLocaleString()} km`}
                />
                <InfoPair
                  label="Kms remaining"
                  value={`${selectedVehicle.serviceDueKm.toLocaleString()} km`}
                />
                <InfoPair label="Open defects" value={`${selectedVehicle.defectsOpen}`} />
                <InfoPair label="Status" value={selectedVehicle.healthLabel} />
                {!isDriver && (
                  <>
                    <InfoPair label="Vehicle revenue" value={formatMoney(selectedVehicle.verifiedRevenue ?? 0)} />
                    <InfoPair label="Vehicle expenses" value={formatMoney(selectedVehicle.assetExpenseTotal ?? 0)} />
                    <InfoPair label="Asset net yield" value={formatMoney(selectedVehicle.netYield ?? 0)} />
                  </>
                )}
              </div>

              {!isDriver && (
                <div className="finance-ledger">
                  {vehicleLedger.map((record) => (
                    <article key={record.id} className="ledger-row">
                      <div className="ledger-copy">
                        <strong>
                          {record.type === "income"
                            ? record.isSpecial
                              ? record.description
                              : `Revenue / ${record.route}`
                            : record.category}
                        </strong>
                        <span>{formatStamp(record.timestamp)}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="status-chip" data-tone={getTransactionTone(record)}>
                          {record.status}
                        </span>
                        <strong>
                          {record.type === "income" ? "+" : "-"}
                          {formatMoney(record.amountClaimed ?? record.amount)}
                        </strong>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel eyebrow="Proactive intelligence" title="Compliance and service engine" icon={ShieldAlert}>
              <div className="compact-feed">
                <CompactFeedItem
                  title="Service countdown"
                  subtitle={`Last service ${selectedVehicle.lastServiceOdo.toLocaleString()} km`}
                  tone={selectedVehicle.serviceTone}
                  meta={`${selectedVehicle.serviceDueKm.toLocaleString()} km remaining`}
                />
                {vehicleDocuments.map((document) => (
                  <CompactFeedItem
                    key={document.id}
                    title={document.document}
                    subtitle={document.stage}
                    tone={getDocumentTone(document.daysLeft)}
                    meta={`${document.daysLeft} days`}
                  />
                ))}
              </div>

              {canManageVehicles && (
                <form ref={vehicleFormRef} className="finance-form" onSubmit={handleVehicleSubmit}>
                  <div className="finance-form-grid">
                    <label className="finance-field">
                      <span>Registration</span>
                      <input
                        type="text"
                        value={vehicleDraft.registration}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            registration: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Model</span>
                      <input
                        type="text"
                        value={vehicleDraft.model}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Route</span>
                      <input
                        type="text"
                        value={vehicleDraft.route}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            route: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Assigned driver</span>
                      <select
                        value={vehicleDraft.assignedDriverId}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            assignedDriverId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {snapshot.drivers
                          .filter((driver) => driver.role === "Driver")
                          .map((driver) => (
                            <option key={driver.staffId} value={driver.staffId}>
                              {driver.name} / {driver.staffId}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="finance-field">
                      <span>Current odo</span>
                      <input
                        type="number"
                        value={vehicleDraft.currentOdometer}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            currentOdometer: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Last service odo</span>
                      <input
                        type="number"
                        value={vehicleDraft.lastServiceOdo}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            lastServiceOdo: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Service interval</span>
                      <input
                        type="number"
                        value={vehicleDraft.serviceIntervalKm}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            serviceIntervalKm: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Permit expiry</span>
                      <input
                        type="date"
                        value={vehicleDraft.permitExpiryDate}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            permitExpiryDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="finance-field">
                      <span>Disc expiry</span>
                      <input
                        type="date"
                        value={vehicleDraft.discExpiryDate}
                        onChange={(event) =>
                          setVehicleDraft((current) => ({
                            ...current,
                            discExpiryDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="finance-form-actions">
                    <button type="submit" className="action-button primary">
                      {vehicleDraft.id ? "Save vehicle" : "Create vehicle"}
                    </button>
                    <button type="button" className="action-button" onClick={handleAddVehicle}>
                      Add vehicle
                    </button>
                    {selectedVehicle.status !== "archived" && selectedVehicle.id && (
                      <button
                        type="button"
                        className="record-button danger"
                        onClick={() => pushFeedback(onArchiveVehicle(selectedVehicle.id))}
                      >
                        Archive vehicle
                      </button>
                    )}
                  </div>
                  <p className="finance-form-note" data-tone="info">
                    Drivers can be linked to multiple vehicles. Save more than one vehicle with the
                    same linked driver to extend that driver&apos;s active vehicle list.
                  </p>
                </form>
              )}
            </Panel>
          </div>

          {canViewVehicleProfile && (
            <div className="overview-board-grid">
              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Revenue outline</p>
                  <h3>Takings and route history</h3>
                </div>
                <div className="queue-stats">
                  <InfoPair label="Total revenue" value={formatMoney(revenueOutline.totalRevenue)} />
                  <InfoPair label="Standard routes" value={`${revenueOutline.shiftCount}`} />
                  <InfoPair label="Special trips" value={`${revenueOutline.specialTripCount}`} />
                  <InfoPair label="Special revenue" value={formatMoney(revenueOutline.specialRevenue)} />
                </div>
                <div className="finance-ledger">
                  {vehicleIncomeRecords.slice(0, 4).map((record) => (
                    <article key={record.id} className="ledger-row">
                      <div className="ledger-copy">
                        <strong>
                          {record.isSpecial ? record.description : record.route ?? selectedVehicle.route}
                        </strong>
                        <span>{formatStamp(record.timestamp)}</span>
                      </div>
                      <div className="ledger-meta">
                        <span className="status-chip" data-tone={getTransactionTone(record)}>
                          {record.isSpecial ? "special" : "route"}
                        </span>
                        <strong>{formatMoney(record.amountClaimed ?? record.amount)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Route history</p>
                  <h3>Recent earning lanes</h3>
                </div>
                <div className="compact-feed">
                  {routeHistory.map((route) => (
                    <CompactFeedItem
                      key={route.title}
                      title={route.title}
                      subtitle={`${route.trips} logged runs`}
                      tone={route.subtitle === "Special trip" ? "info" : "success"}
                      meta={formatMoney(route.revenue)}
                    />
                  ))}
                  {routeHistory.length === 0 && (
                    <CompactFeedItem
                      title="No route history yet"
                      subtitle="Awaiting recorded shifts"
                      tone="info"
                      meta={selectedVehicle.route}
                    />
                  )}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Driver and health history</p>
                  <h3>Operators and vehicle condition</h3>
                </div>
                <div className="compact-feed">
                  {driverHistory.map((entry) => (
                    <CompactFeedItem
                      key={entry.name}
                      title={entry.name}
                      subtitle={entry.meta}
                      tone={entry.tone}
                      meta={selectedVehicle.registration}
                    />
                  ))}
                  {healthHighlights.map((entry) => (
                    <CompactFeedItem
                      key={entry.title}
                      title={entry.title}
                      subtitle={entry.subtitle}
                      tone={entry.tone}
                      meta={entry.meta}
                    />
                  ))}
                </div>
              </article>
            </div>
          )}

      <Panel eyebrow="Defect management" title="Immutable audit trail" icon={AlertTriangle}>
        {canResolveDefects && (
          <article className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Manager controls</p>
              <h3>Update logged defects</h3>
            </div>
            <p className="panel-note">
              Managers can open any logged defect for editing, then resolve it once repair costs are
              confirmed.
            </p>
            <div className="finance-form-actions">
              <button
                type="button"
                className="action-button primary"
                onClick={() => openDefectsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <AlertTriangle size={16} />
                Open logged defects
              </button>
              <button
                type="button"
                className="action-button"
                onClick={() => defectFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <Settings2 size={16} />
                Update defect form
              </button>
              <span
                className="status-chip"
                data-tone={vehicleDefects.some((defect) => defect.status !== "resolved") ? "warning" : "success"}
              >
                {vehicleDefects.filter((defect) => defect.status !== "resolved").length} open
              </span>
            </div>
          </article>
        )}

        <div className="finance-board-grid finance-board-grid-3">
          <article ref={defectFormRef} className="overview-board">
            <div className="overview-board-head">
              <p className="eyebrow">Defect form</p>
              <h3>
                {defectDraft.id
                  ? "Update logged defect"
                  : isDriver
                    ? "My assigned vehicle"
                    : "Log a defect"}
              </h3>
            </div>
                <form className="finance-form" onSubmit={handleDefectSubmit}>
                  {!isDriver && (
                    <label className="finance-field">
                      <span>Vehicle</span>
                      <select
                        value={defectDraft.vehicleId}
                        onChange={(event) =>
                          setDefectDraft((current) => ({
                            ...current,
                            vehicleId: event.target.value,
                          }))
                        }
                      >
                        {snapshot.vehicles
                          .filter((vehicle) => vehicle.status !== "archived")
                          .map((vehicle) => (
                            <option key={vehicle.id} value={vehicle.id}>
                              {vehicle.registration} / {vehicle.route}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className="finance-field">
                    <span>Category</span>
                    <select
                      value={defectDraft.category}
                      onChange={(event) =>
                        setDefectDraft((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    >
                      {DEFECT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="finance-field finance-field-wide">
                    <span>Detail</span>
                    <input
                      type="text"
                      value={defectDraft.detail}
                      onChange={(event) =>
                        setDefectDraft((current) => ({
                          ...current,
                          detail: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="finance-form-actions">
                    <button type="submit" className="action-button primary">
                      {defectDraft.id ? "Update defect" : "Log defect"}
                    </button>
                    {defectDraft.id && (
                      <button
                        type="button"
                        className="action-button"
                        onClick={() =>
                          setDefectDraft(createDefectDraft(isDriver ? assignedVehicleId : selectedVehicle?.id))
                        }
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
              </article>

              <article ref={openDefectsRef} className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Open defects</p>
                  <h3>Resolution chain</h3>
                </div>
                <div className="finance-ledger">
                  {vehicleDefects
                    .filter((defect) => defect.status !== "resolved")
                    .map((defect) => (
                      <article key={defect.id} className="ledger-row">
                        <div className="ledger-copy">
                          <strong>{defect.category}</strong>
                          <span>{defect.detail}</span>
                        </div>
                        <div className="ledger-meta">
                          <span className="status-chip" data-tone={getDefectTone(defect.severity)}>
                            {defect.severity}
                          </span>
                          <span>{defect.reportedAtLabel}</span>
                        </div>
                        {canResolveDefects ? (
                          <div className="verification-actions">
                            <button
                              type="button"
                              className="action-button"
                              onClick={() => handleEditDefect(defect)}
                            >
                              <Settings2 size={16} />
                              Update defect
                            </button>
                            <input
                              className="verification-input"
                              type="number"
                              min="0"
                              step="1"
                              value={resolutionCosts[defect.id] ?? ""}
                              onChange={(event) =>
                                setResolutionCosts((current) => ({
                                  ...current,
                                  [defect.id]: event.target.value,
                                }))
                              }
                              placeholder="Repair cost"
                            />
                            <button
                              type="button"
                              className="action-button primary"
                              onClick={() => handleResolve(defect.id)}
                            >
                              Resolve defect
                            </button>
                          </div>
                        ) : (
                          <span className="status-chip" data-tone="warning">
                            Awaiting manager resolution
                          </span>
                        )}
                      </article>
                    ))}
                </div>
              </article>

              <article className="overview-board">
                <div className="overview-board-head">
                  <p className="eyebrow">Resolved history</p>
                  <h3>Read-only trail</h3>
                </div>
                <div className="finance-ledger">
                  {vehicleDefects
                    .filter((defect) => defect.status === "resolved")
                    .map((defect) => (
                      <article key={defect.id} className="ledger-row">
                        <div className="ledger-copy">
                          <strong>{defect.category}</strong>
                          <span>{defect.detail}</span>
                        </div>
                        <div className="ledger-meta">
                          <span className="status-chip" data-tone="success">
                            Resolved
                          </span>
                          <strong>{formatMoney(defect.repairCost ?? 0)}</strong>
                          <span>{defect.resolvedAtLabel}</span>
                        </div>
                      </article>
                    ))}
                </div>
              </article>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function CompliancePanel({ snapshot }) {
  return (
    <div className="content-stack">
      <div className="two-up">
        <Panel
          eyebrow="Countdown engine"
          title="Service and document alerts"
          icon={ShieldAlert}
        >
          <div className="traffic-grid">
            {snapshot.serviceSchedule.slice(0, 3).map((item) => (
              <article
                key={item.vehicle}
                className="traffic-card"
                data-tone={item.tone}
              >
                <span className="eyebrow">
                  {item.dueInKm <= 0 ? "Immediate" : `${item.dueInKm} km`}
                </span>
                <h3>{item.vehicle}</h3>
                <p>{item.serviceType}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Expiry engine" title="Expiring documents" icon={FileText}>
          <div className="list-stack">
            {snapshot.documents.map((document) => (
              <StatusRow
                key={document.id ?? `${document.subject}-${document.document}`}
                title={`${document.subject} / ${document.document}`}
                detail={document.action}
                tone={getDocumentTone(document.daysLeft)}
                meta={`${document.daysLeft} days / ${document.owner}`}
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DriversPanel({
  snapshot,
  activeRole,
  onShortcutAction,
  shortcutIntent,
  onSaveStandardIncome,
  onSaveSpecialIncome,
  onSelectDriverVehicle,
}) {
  const isDriver = activeRole === "Driver";
  const linkedVehicles = getDriverLinkedVehicles(snapshot);
  const linkedVehicleIds = new Set(linkedVehicles.map((vehicle) => vehicle.id));
  const linkedVehicleRegistrations = new Set(
    linkedVehicles.map((vehicle) => vehicle.registration),
  );
  const filteredDrivers =
    activeRole === "Driver"
      ? snapshot.drivers.filter(
          (driver) => driver.name === snapshot.driverTerminal.activeDriver,
        )
      : snapshot.drivers;
  const assignedVehicleId =
    snapshot.driverTerminal.assignedVehicleId ?? linkedVehicles[0]?.id ?? snapshot.vehicles[0]?.id ?? "";
  const [driverAction, setDriverAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [shiftDraft, setShiftDraft] = useState(() =>
    createStandardDraft(
      assignedVehicleId,
      snapshot.finance.vehicleOpenings?.[assignedVehicleId],
    ),
  );
  const [specialDraft, setSpecialDraft] = useState(() => createSpecialDraft(assignedVehicleId));
  const assignedVehicle =
    (isDriver
      ? linkedVehicles.find((vehicle) => vehicle.id === assignedVehicleId) ?? linkedVehicles[0]
      : null) ??
    snapshot.vehicles.find((vehicle) => vehicle.id === assignedVehicleId) ??
    snapshot.vehicles[0];
  const visibleDefects = isDriver
    ? snapshot.defects.filter(
        (defect) =>
          linkedVehicleIds.has(defect.vehicleId) || linkedVehicleRegistrations.has(defect.vehicle),
      )
    : snapshot.defects;
  const shiftDistance =
    Number(shiftDraft.closingOdo || 0) - Number(shiftDraft.openingOdo || 0);
  const shiftValidationError = getStandardDraftValidationError({
    ...shiftDraft,
    vehicleId: assignedVehicleId,
  });

  useEffect(() => {
    if (!assignedVehicleId) {
      return;
    }

    setShiftDraft((current) => ({
      ...current,
      vehicleId: assignedVehicleId,
      openingOdo:
        current.vehicleId === assignedVehicleId && current.openingOdo
          ? current.openingOdo
          : String(snapshot.finance.vehicleOpenings?.[assignedVehicleId] ?? ""),
    }));
    setSpecialDraft((current) => ({
      ...current,
      vehicleId: assignedVehicleId,
    }));
  }, [assignedVehicleId, snapshot.finance.vehicleOpenings]);

  useEffect(() => {
    if (!shortcutIntent) {
      return;
    }

    if (shortcutIntent.type === "Log shift takings") {
      setDriverAction("shift");
    }
    if (shortcutIntent.type === "Capture special trip") {
      setDriverAction("special");
    }
  }, [shortcutIntent]);

  const handleShortcut = (shortcut) => {
    if (shortcut === "Log shift takings") {
      setDriverAction("shift");
      return;
    }
    if (shortcut === "Capture special trip") {
      setDriverAction("special");
      return;
    }
    onShortcutAction(shortcut);
  };

  const handleShiftSubmit = (event) => {
    event.preventDefault();
    const response = onSaveStandardIncome({
      ...shiftDraft,
      vehicleId: assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setShiftDraft(
        createStandardDraft(assignedVehicleId, response.nextOpeningOdo),
      );
      setDriverAction(null);
    }
  };

  const handleSpecialSubmit = (event) => {
    event.preventDefault();
    const response = onSaveSpecialIncome({
      ...specialDraft,
      vehicleId: assignedVehicleId,
    });

    setFeedback({
      tone: response.ok ? "success" : "danger",
      message: response.message ?? response.error,
    });

    if (response.ok) {
      setSpecialDraft(createSpecialDraft(assignedVehicleId));
      setDriverAction(null);
    }
  };

  return (
    <div className="content-stack">
      {feedback && (
        <div className="finance-feedback" data-tone={feedback.tone}>
          <span className="status-chip" data-tone={feedback.tone}>
            {feedback.message}
          </span>
        </div>
      )}

      {isDriver && linkedVehicles.length > 1 && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Linked vehicles</p>
            <h3>Choose active vehicle</h3>
          </div>
          <div className="finance-sub-switch">
            {linkedVehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                className={
                  vehicle.id === assignedVehicleId ? "finance-sub-pill active" : "finance-sub-pill"
                }
                onClick={() => onSelectDriverVehicle(vehicle.id)}
              >
                {vehicle.registration}
              </button>
            ))}
          </div>
        </article>
      )}

      <div className="two-up">
        <Panel eyebrow="Driver UX" title="Terminal preview" icon={LayoutDashboard}>
          <div className="terminal-card">
            <div className="terminal-header">
              <div>
                <p className="eyebrow">Signed in</p>
                <h3>{snapshot.driverTerminal.activeDriver}</h3>
                <p>
                  {snapshot.driverTerminal.assignedVehicle} /{" "}
                  {snapshot.driverTerminal.assignedRoute}
                </p>
              </div>
              <span className="status-chip" data-tone="success">
                <CheckCircle2 size={14} />
                <span>{snapshot.driverTerminal.lastShift.status}</span>
              </span>
            </div>

            <div className="queue-stats">
              <InfoPair
                label="Opening odo"
                value={`${snapshot.driverTerminal.lastShift.openOdo.toLocaleString()} km`}
              />
              <InfoPair
                label="Closing odo"
                value={`${snapshot.driverTerminal.lastShift.closeOdo.toLocaleString()} km`}
              />
              <InfoPair
                label="Last revenue"
                value={formatMoney(snapshot.driverTerminal.lastShift.revenue)}
              />
              <InfoPair label="Terminal mode" value="High contrast" />
            </div>

            <div className="shortcut-grid">
              {snapshot.driverTerminal.shortcuts.map((shortcut) => (
                <button
                  key={shortcut}
                  type="button"
                  className="shortcut-button"
                  onClick={() => handleShortcut(shortcut)}
                >
                  {shortcut}
                </button>
              ))}
            </div>

            {driverAction && (
              <div className="driver-action-panel">
                <div className="overview-board-head">
                  <p className="eyebrow">Quick capture</p>
                  <h3>
                    {driverAction === "shift" ? "Log shift takings" : "Capture special trip"}
                  </h3>
                </div>

                {driverAction === "shift" && (
                  <form className="finance-form" onSubmit={handleShiftSubmit}>
                    <div className="finance-form-grid">
                      <label className="finance-field">
                        <span>Vehicle</span>
                        <input type="text" value={assignedVehicle?.registration ?? ""} disabled />
                      </label>
                      <label className="finance-field">
                        <span>Opening odo</span>
                        <input
                          type="number"
                          value={shiftDraft.openingOdo}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              openingOdo: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Closing odo</span>
                        <input
                          type="number"
                          min={Number(shiftDraft.openingOdo || 0) + 1}
                          value={shiftDraft.closingOdo}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              closingOdo: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Amount claimed</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={shiftDraft.amountClaimed}
                          onChange={(event) =>
                            setShiftDraft((current) => ({
                              ...current,
                              amountClaimed: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="info">
                        Expected opening{" "}
                        {Number(
                          snapshot.finance.vehicleOpenings?.[assignedVehicleId] ?? 0,
                        ).toLocaleString()}{" "}
                        km
                      </span>
                      <span
                        className="status-chip"
                        data-tone={shiftDistance > 0 ? "success" : "danger"}
                      >
                        Distance {Math.max(shiftDistance, 0).toLocaleString()} km
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button
                        type="submit"
                        className="action-button primary"
                        disabled={Boolean(shiftValidationError)}
                      >
                        Save shift
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => setDriverAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    <p
                      className="finance-form-note"
                      data-tone={shiftValidationError ? "danger" : "info"}
                    >
                      {shiftValidationError ?? "Shift details are complete and ready to save."}
                    </p>
                  </form>
                )}

                {driverAction === "special" && (
                  <form className="finance-form" onSubmit={handleSpecialSubmit}>
                    <div className="finance-form-grid">
                      <label className="finance-field">
                        <span>Vehicle</span>
                        <input type="text" value={assignedVehicle?.registration ?? ""} disabled />
                      </label>
                      <label className="finance-field finance-field-wide">
                        <span>Description</span>
                        <input
                          type="text"
                          value={specialDraft.description}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="finance-field">
                        <span>Amount</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={specialDraft.amount}
                          onChange={(event) =>
                            setSpecialDraft((current) => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="finance-form-meta">
                      <span className="status-chip" data-tone="info">
                        Tagged as special-trip income
                      </span>
                    </div>
                    <div className="finance-form-actions">
                      <button type="submit" className="action-button primary">
                        Save trip
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => setDriverAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel eyebrow="People operations" title="Roster and performance" icon={Users}>
          <div className="list-stack">
            {filteredDrivers.map((driver) => (
              <article key={driver.name} className="person-row">
                <div className="person-copy">
                  <h3>{driver.name}</h3>
                  <p>
                    {driver.role} / {driver.route}
                  </p>
                </div>
                <div className="person-metrics">
                  <span
                    className="status-chip"
                    data-tone={driver.cashAccuracy >= 98 ? "success" : "warning"}
                  >
                    {driver.cashAccuracy}% accuracy
                  </span>
                  <span
                    className="status-chip"
                    data-tone={driver.prdpDays && driver.prdpDays <= 30 ? "danger" : "info"}
                  >
                    {driver.prdpDays ? `${driver.prdpDays} days PrDP` : driver.shiftStatus}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Maintenance handoff" title="Live defect feed" icon={AlertTriangle}>
        <div className="queue-grid">
          {visibleDefects.map((defect) => (
            <article key={`${defect.vehicle}-${defect.issue}`} className="queue-card">
              <div className="queue-header">
                <div>
                  <h3>{defect.vehicle}</h3>
                  <p>{defect.issue}</p>
                </div>
                <span className="status-chip" data-tone={getDefectTone(defect.severity)}>
                  {defect.severity}
                </span>
              </div>

              <div className="queue-stats">
                <InfoPair label="Reported" value={defect.reportedAtLabel ?? defect.reportedAt} />
                <InfoPair label="Status" value={defect.statusLabel ?? defect.status} />
                <InfoPair label="Estimate" value={formatMoney(defect.costEstimate)} />
                <InfoPair label="Owner" value="Fleet Manager" />
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function InsightCard({ title, metric, meta, icon: Icon, tone, children }) {
  return (
    <article className="insight-card" data-tone={tone}>
      <div className="insight-head">
        <div>
          <p className="eyebrow">{title}</p>
          <strong>{metric}</strong>
          <span>{meta}</span>
        </div>
        <div className="panel-icon">
          <Icon size={18} />
        </div>
      </div>
      <div className="insight-visual">{children}</div>
    </article>
  );
}

function MiniBars({ items, tone = "info" }) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="mini-bars">
      {items.map((item) => (
        <div key={item.label} className="mini-bar-group">
          <div className="mini-bar-track vertical">
            <div
              className="mini-bar-fill"
              data-tone={tone}
              style={{ height: `${Math.max((item.value / maxValue) * 100, 12)}%` }}
            />
          </div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function MiniCompareChart({ items }) {
  const maxValue = Math.max(
    ...items.flatMap((item) => [item.primary, item.secondary]),
    1,
  );

  return (
    <div className="mini-bars compare">
      {items.map((item) => (
        <div key={item.label} className="mini-bar-group">
          <div className="mini-bar-track vertical compare">
            <div
              className="mini-bar-fill secondary"
              data-tone="info"
              style={{ height: `${Math.max((item.secondary / maxValue) * 100, 12)}%` }}
            />
            <div
              className="mini-bar-fill primary"
              data-tone="success"
              style={{ height: `${Math.max((item.primary / maxValue) * 100, 12)}%` }}
            />
          </div>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function SegmentMeter({ segments }) {
  const total = Math.max(
    segments.reduce((sum, segment) => sum + segment.value, 0),
    1,
  );

  return (
    <div className="segment-meter">
      <div className="segment-bar">
        {segments.map((segment) => (
          <span
            key={segment.label}
            className="segment-piece"
            data-tone={segment.tone}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="segment-legend">
        {segments.map((segment) => (
          <span key={segment.label} className="segment-label">
            <i data-tone={segment.tone} />
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RingMeter({ value, total, label, tone, sublabel }) {
  const progress = Math.max(Math.min((value / Math.max(total, 1)) * 360, 360), 0);
  const colorMap = {
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    info: "var(--info)",
    navy: "var(--navy)",
  };

  return (
    <div className="ring-wrap">
      <div
        className="ring-meter"
        style={{
          background: `conic-gradient(${colorMap[tone] ?? "var(--info)"} ${progress}deg, rgba(11, 37, 69, 0.08) ${progress}deg 360deg)`,
        }}
      >
        <div className="ring-core">
          <strong>{label}</strong>
        </div>
      </div>
      {sublabel && <span className="ring-subtitle">{sublabel}</span>}
    </div>
  );
}

function CompactFeedItem({ title, subtitle, meta, tone }) {
  return (
    <article className="compact-feed-item">
      <div className="compact-feed-head">
        <div>
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>
        <span className="compact-badge" data-tone={tone}>
          {toneLabel[tone]}
        </span>
      </div>
      <span className="compact-meta">{meta}</span>
    </article>
  );
}

function FlowLane({ owner, title, tone }) {
  return (
    <article className="flow-lane" data-tone={tone}>
      <span>{owner}</span>
      <strong>{title}</strong>
    </article>
  );
}

function FinanceModeButton({ active, label, meta, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      className={active ? "finance-mode-button active" : "finance-mode-button"}
      onClick={onClick}
    >
      <div className="finance-mode-head">
        <div className="module-button-icon">
          <Icon size={16} />
        </div>
      </div>
      <span className="module-button-label">{label}</span>
      <span className="module-button-sub">{meta}</span>
    </button>
  );
}

function ModuleButton({ active, icon: Icon, label, stat, sub, onClick }) {
  return (
    <button
      type="button"
      className={active ? "module-button active" : "module-button"}
      onClick={onClick}
    >
      <div className="module-button-head">
        <div className="module-button-icon">
          <Icon size={18} />
        </div>
        {stat && <strong>{stat}</strong>}
      </div>
      <span className="module-button-label">{label}</span>
      {sub && <span className="module-button-sub">{sub}</span>}
    </button>
  );
}

function Panel({ eyebrow, title, icon: Icon, children }) {
  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="panel-icon">
          <Icon size={18} />
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }) {
  return (
    <article className="metric-card" data-tone={tone}>
      <div className="metric-head">
        <span>{label}</span>
        <div className="metric-icon">
          <Icon size={16} />
        </div>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function StatusRow({ title, detail, meta, tone }) {
  return (
    <article className="status-row">
      <div className="status-copy">
        <div className="status-title-row">
          <h3>{title}</h3>
          <span className="status-chip" data-tone={tone}>
            {toneLabel[tone]}
          </span>
        </div>
        <p>{detail}</p>
      </div>
      <span className="status-meta">{meta}</span>
    </article>
  );
}

function TimelineRow({ title, detail }) {
  return (
    <article className="timeline-row">
      <div className="timeline-dot" />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function InfoPair({ label, value }) {
  return (
    <div className="info-pair">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;
