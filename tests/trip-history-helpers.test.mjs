import assert from "node:assert/strict";
import test from "node:test";

import {
  createTripRecord,
  getTripRecords,
  getTripsByDate,
  getTripsByDateRange,
  getTripsByDriver,
  getTripsByVehicle,
  updateTripRecord,
} from "../src/lib/tripHistory.js";

const sourceSnapshot = {
  routes: [
    {
      id: "route-noord-alex",
      name: "Noord -> Alexandra",
    },
    {
      id: "route-cbd-soweto",
      name: "CBD -> Soweto",
    },
  ],
  drivers: [
    {
      staffId: "drv-1",
      name: "Sizwe Mokoena",
    },
  ],
  vehicles: [
    {
      id: "veh-1",
      registration: "JHB 457 GP",
      route: "Noord -> Alexandra",
      currentRouteId: "route-noord-alex",
      assignedDriverId: "drv-1",
    },
    {
      id: "veh-2",
      registration: "JHB 777 GP",
      route: "CBD -> Soweto",
      currentRouteId: "route-cbd-soweto",
      assignedDriverId: "drv-1",
    },
  ],
  financeTransactions: [
    {
      id: "txn-inc-1",
      type: "income",
      incomeKind: "standard",
      tripDate: "2026-04-05",
      timeIn: "06:00",
      amount: 920,
      amountClaimed: 920,
      vehicleId: "veh-1",
      vehicle: "JHB 457 GP",
      route: "Noord -> Alexandra",
      driverStaffId: "drv-1",
      driverName: "Sizwe Mokoena",
      createdBy: "drv-1",
      createdByRole: "Driver",
      createdAt: "2026-04-05T06:05:00+02:00",
      notes: "Morning shift",
    },
    {
      id: "txn-inc-2",
      type: "income",
      incomeKind: "special",
      tripDate: "2026-04-05",
      amount: 500,
      amountClaimed: 500,
      vehicleId: "veh-2",
      vehicle: "JHB 777 GP",
      route: "CBD -> Soweto",
      driverStaffId: "drv-1",
      driverName: "Sizwe Mokoena",
      createdBy: "drv-1",
      createdByRole: "Driver",
      createdAt: "2026-04-05T12:00:00+02:00",
      description: "School contract run",
    },
    {
      id: "txn-inc-3",
      type: "income",
      incomeKind: "standard",
      tripDate: "2026-04-06",
      timeIn: "05:45",
      amount: 760,
      amountClaimed: 760,
      vehicleId: "veh-1",
      vehicle: "JHB 457 GP",
      route: "Noord -> Alexandra",
      driverStaffId: "drv-1",
      driverName: "Sizwe Mokoena",
      createdBy: "drv-1",
      createdByRole: "Driver",
      createdAt: "2026-04-06T05:50:00+02:00",
      lastEditReason: "Corrected date typo",
      lastEditSummary: "Trip date",
      lastEditedAt: "2026-04-06T06:10:00+02:00",
      lastEditedBy: "owner-1",
      lastEditedByRole: "Owner",
    },
    {
      id: "txn-exp-1",
      type: "expense",
      expenseKind: "asset",
      amount: 120,
      vehicleId: "veh-1",
    },
  ],
};

test("getTripRecords enriches legacy trip rows with traceability metadata and trip numbers", () => {
  const trips = getTripRecords(sourceSnapshot, { source: sourceSnapshot });

  assert.equal(trips.length, 3);
  assert.deepEqual(
    trips
      .filter((trip) => trip.tripDate === "2026-04-05")
      .map((trip) => ({ tripId: trip.tripId, tripNumber: trip.tripNumber })),
    [
      { tripId: "txn-inc-1", tripNumber: 1 },
      { tripId: "txn-inc-2", tripNumber: 2 },
    ],
  );

  const firstTrip = trips.find((trip) => trip.tripId === "txn-inc-1");
  assert.equal(firstTrip.driverId, "drv-1");
  assert.equal(firstTrip.vehicleRegistration, "JHB 457 GP");
  assert.equal(firstTrip.routeId, "route-noord-alex");
  assert.equal(firstTrip.originalCreatedAt, "2026-04-05T06:05:00+02:00");

  const legacyEditedTrip = trips.find((trip) => trip.tripId === "txn-inc-3");
  assert.equal(legacyEditedTrip.correctionFlag, true);
  assert.equal(legacyEditedTrip.editHistory.length, 1);
  assert.equal(legacyEditedTrip.editHistory[0].reason, "Corrected date typo");
});

test("createTripRecord derives missing driver, vehicle, route, and sequence fields", () => {
  const createdTrip = createTripRecord(
    {
      incomeKind: "special",
      tripDate: "2026-04-05",
      vehicleId: "veh-2",
      route: "CBD -> Soweto",
      amount: 450,
      amountClaimed: 450,
      createdBy: "drv-1",
      createdByRole: "Driver",
    },
    {
      source: sourceSnapshot,
      existingTrips: sourceSnapshot.financeTransactions,
      timestamp: "2026-04-05T14:00:00+02:00",
    },
  );

  assert.ok(createdTrip.tripId);
  assert.equal(createdTrip.driverId, "drv-1");
  assert.equal(createdTrip.driverName, "Sizwe Mokoena");
  assert.equal(createdTrip.vehicleRegistration, "JHB 777 GP");
  assert.equal(createdTrip.routeId, "route-cbd-soweto");
  assert.equal(createdTrip.tripNumber, 3);
  assert.equal(createdTrip.originalCreatedAt, "2026-04-05T14:00:00+02:00");
});

test("updateTripRecord preserves original creation metadata and appends a detailed edit history entry", () => {
  const existingTrip = sourceSnapshot.financeTransactions.find((record) => record.id === "txn-inc-1");
  const updatedTrip = updateTripRecord(
    existingTrip,
    {
      amountClaimed: 980,
      amount: 980,
      notes: "Takings corrected after recount",
    },
    {
      source: sourceSnapshot,
      existingTrips: sourceSnapshot.financeTransactions,
      actorId: "owner-1",
      actorRole: "Owner",
      reason: "Corrected takings after recount",
      timestamp: "2026-04-05T18:00:00+02:00",
    },
  );

  assert.equal(updatedTrip.tripId, "txn-inc-1");
  assert.equal(updatedTrip.originalCreatedAt, "2026-04-05T06:05:00+02:00");
  assert.equal(updatedTrip.updatedBy, "owner-1");
  assert.equal(updatedTrip.updatedAt, "2026-04-05T18:00:00+02:00");
  assert.equal(updatedTrip.correctionFlag, true);
  assert.equal(updatedTrip.editHistory.length, 1);
  assert.equal(updatedTrip.editHistory[0].reason, "Corrected takings after recount");
  assert.equal(updatedTrip.editHistory[0].changes.some((change) => change.field === "amountClaimed"), true);
  assert.equal(updatedTrip.editHistory[0].changes.some((change) => change.field === "notes"), true);
});

test("trip filter helpers return the expected subsets by date, range, driver, and vehicle", () => {
  assert.equal(getTripsByDate(sourceSnapshot, "2026-04-05", { source: sourceSnapshot }).length, 2);
  assert.equal(
    getTripsByDateRange(sourceSnapshot, "2026-04-05", "2026-04-06", { source: sourceSnapshot }).length,
    3,
  );
  assert.equal(getTripsByDriver(sourceSnapshot, "Sizwe", { source: sourceSnapshot }).length, 3);
  assert.equal(getTripsByVehicle(sourceSnapshot, "457", { source: sourceSnapshot }).length, 2);
  assert.equal(getTripsByVehicle(sourceSnapshot, "veh-2", { source: sourceSnapshot }).length, 1);
});
