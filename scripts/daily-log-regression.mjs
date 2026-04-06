import { buildDailyLogReportView } from "../api/_lib/dailyLogReportView.js";

if (process.env.NODE_ENV === "production") {
  console.error("This regression script is dev-only and cannot run with NODE_ENV=production.");
  process.exit(1);
}

const formatMoney = (value) =>
  `R ${Number(value ?? 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatMetric = (value, suffix = "") => {
  if (value == null || !Number.isFinite(Number(value))) {
    return "n/a";
  }

  return `${Number(value).toLocaleString("en-ZA", {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    maximumFractionDigits: 2,
  })}${suffix}`;
};

const roundAmount = (value) => Number(Number(value ?? 0).toFixed(2));

const buildTrip = ({
  id,
  departingFromPoint,
  goingToPoint,
  departureTime,
  arrivalTime,
  odometerStart,
  odometerEnd,
  passengerCount,
  fareAmount,
}) => ({
  id,
  departingFromPoint,
  goingToPoint,
  timeIn: departureTime,
  timeOut: arrivalTime,
  odometerStart,
  odometerEnd,
  passengerCount,
  amountCollected: roundAmount(passengerCount * fareAmount),
});

const sampleRoute = {
  id: "route-regression-001",
  name: "Bree Taxi Rank to Fourways Mall",
  code: "BR4W",
  type: "route_service",
  primaryOrigin: "Bree Taxi Rank",
  primaryDestination: "Fourways Mall",
  fareAmount: 24,
  currency: "ZAR",
  isActive: true,
  routePoints: [
    {
      id: "route-regression-001-point-1",
      label: "Bree Taxi Rank",
      sequence: 1,
      stopType: "origin",
    },
    {
      id: "route-regression-001-point-2",
      label: "Fourways Mall",
      sequence: 2,
      stopType: "destination",
    },
  ],
};

const sampleVehicle = {
  id: "veh-regression-001",
  registration: "DEV 001 GP",
  vehicleNo: "DEV 001 GP",
  model: "Toyota Quantum",
  seatCapacity: 16,
  route: sampleRoute.name,
  currentRouteId: sampleRoute.id,
  assignedDriverId: "drv-regression-001",
};

const sampleDriver = {
  staffId: "drv-regression-001",
  name: "Regression Driver",
  role: "Driver",
  route: sampleRoute.name,
};

const sampleTrips = [
  buildTrip({
    id: "trip-reg-1",
    departingFromPoint: sampleRoute.primaryOrigin,
    goingToPoint: sampleRoute.primaryDestination,
    departureTime: "05:40",
    arrivalTime: "06:08",
    odometerStart: 150220,
    odometerEnd: 150238,
    passengerCount: 12,
    fareAmount: sampleRoute.fareAmount,
  }),
  buildTrip({
    id: "trip-reg-2",
    departingFromPoint: sampleRoute.primaryOrigin,
    goingToPoint: sampleRoute.primaryDestination,
    departureTime: "06:20",
    arrivalTime: "06:47",
    odometerStart: 150238,
    odometerEnd: 150257,
    passengerCount: 10,
    fareAmount: sampleRoute.fareAmount,
  }),
  buildTrip({
    id: "trip-reg-3",
    departingFromPoint: sampleRoute.primaryOrigin,
    goingToPoint: sampleRoute.primaryDestination,
    departureTime: "07:02",
    arrivalTime: "07:33",
    odometerStart: 150257,
    odometerEnd: 150279,
    passengerCount: 14,
    fareAmount: sampleRoute.fareAmount,
  }),
  buildTrip({
    id: "trip-reg-4",
    departingFromPoint: sampleRoute.primaryOrigin,
    goingToPoint: sampleRoute.primaryDestination,
    departureTime: "07:45",
    arrivalTime: "08:14",
    odometerStart: 150279,
    odometerEnd: 150301,
    passengerCount: 11,
    fareAmount: sampleRoute.fareAmount,
  }),
];

const sampleExpenses = [
  {
    id: "expense-reg-1",
    type: "expense",
    expenseKind: "asset",
    category: "Fuel",
    amount: 180,
    description: "Morning fuel top-up",
    reference: "DEV-FUEL-001",
    vehicleId: sampleVehicle.id,
    vehicle: sampleVehicle.registration,
    expenseDate: "2026-04-05",
  },
  {
    id: "expense-reg-2",
    type: "expense",
    expenseKind: "asset",
    category: "Wash",
    amount: 60,
    description: "After-shift wash bay",
    reference: "DEV-WASH-001",
    vehicleId: sampleVehicle.id,
    vehicle: sampleVehicle.registration,
    expenseDate: "2026-04-05",
  },
];

const collectedExpected = roundAmount(
  sampleTrips.reduce((sum, trip) => sum + Number(trip.amountCollected ?? 0), 0),
);
const spentTotal = roundAmount(
  sampleExpenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0),
);
const netExpected = roundAmount(collectedExpected - spentTotal);
const submitted = roundAmount(netExpected - 25);

const dailyLogRecord = {
  id: "daily-log-regression-001",
  type: "income",
  incomeKind: "standard",
  vehicleId: sampleVehicle.id,
  vehicle: sampleVehicle.registration,
  route: sampleRoute.name,
  tripDate: "2026-04-05",
  tripCount: sampleTrips.length,
  totalPassengers: sampleTrips.reduce((sum, trip) => sum + Number(trip.passengerCount ?? 0), 0),
  amountClaimed: collectedExpected,
  actualCashReceived: submitted,
  amount: collectedExpected,
  discrepancy: false,
  isSpecial: false,
  status: "counted",
  openingOdo: sampleTrips[0].odometerStart,
  closingOdo: sampleTrips[sampleTrips.length - 1].odometerEnd,
  dayStartOdometer: sampleTrips[0].odometerStart,
  dayEndOdometer: sampleTrips[sampleTrips.length - 1].odometerEnd,
  timestamp: "2026-04-05T18:10:00+02:00",
  createdAt: "2026-04-05T08:15:00+02:00",
  createdBy: sampleDriver.staffId,
  createdByRole: "Driver",
  countedAt: "2026-04-05T18:22:00+02:00",
  countedBy: "admin-regression-001",
  countedByRole: "Admin",
  notes: "Dev-only regression sample for daily log analytics and report view.",
  tripLogbook: sampleTrips,
};

const sampleSnapshot = {
  routes: [sampleRoute],
  vehicles: [sampleVehicle],
  drivers: [sampleDriver],
  verificationQueue: [
    {
      id: dailyLogRecord.id,
      driver: sampleDriver.name,
      route: sampleRoute.name,
      vehicle: sampleVehicle.registration,
      submittedAt: "18:22",
      claimed: collectedExpected,
      counted: submitted,
      shortage: roundAmount(Math.max(netExpected - submitted, 0)),
      gapKm: 0,
      status: "Admin hand-in recorded",
    },
  ],
  financeTransactions: [dailyLogRecord, ...sampleExpenses],
};

const reportView = buildDailyLogReportView(sampleSnapshot, dailyLogRecord.id);
const shouldPrintJson = process.argv.includes("--json");

console.log("Daily log regression seed");
console.log(`Route: ${sampleRoute.code} / ${sampleRoute.name} / fare ${formatMoney(sampleRoute.fareAmount)}`);
console.log(`Daily log: ${dailyLogRecord.id}`);
console.log("");
console.log("Financial summary");
console.log(`  collectedExpected: ${formatMoney(reportView.bankingCheckin.collectedExpected)}`);
console.log(`  spentTotal: ${formatMoney(reportView.bankingCheckin.spentTotal)}`);
console.log(`  netExpected: ${formatMoney(netExpected)}`);
console.log(`  submitted: ${formatMoney(reportView.bankingCheckin.submitted)}`);
console.log(`  variance: ${formatMoney(reportView.bankingCheckin.variance)}`);
console.log("");
console.log("Analytics summary");
console.log(`  totalTrips: ${reportView.totals.totalTrips}`);
console.log(`  totalPassengers: ${reportView.totals.totalPassengers}`);
console.log(`  avgTripKm: ${formatMetric(reportView.analytics.avgTripKm, " km")}`);
console.log(
  `  avgTripDurationMin: ${formatMetric(reportView.analytics.avgTripDurationMin, " min")}`,
);
console.log(`  avgWaitingMin: ${formatMetric(reportView.analytics.avgWaitingMin, " min")}`);
console.log(`  avgTripTakings: ${formatMoney(reportView.analytics.avgTripTakings)}`);
console.log(`  avgPassengers: ${formatMetric(reportView.analytics.avgPassengers)}`);

if (shouldPrintJson) {
  console.log("");
  console.log("DailyLogReportView JSON");
  console.log(JSON.stringify(reportView, null, 2));
}
