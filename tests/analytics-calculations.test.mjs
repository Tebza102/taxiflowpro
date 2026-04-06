import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDailyAnalytics,
  calculateDayKm,
  calculateTripAnalytics,
  calculateTripDurationMin,
  calculateWaitingIntervals,
} from "../src/lib/analytics.js";

test("calculateTripDurationMin and calculateTripAnalytics derive time and km safely", () => {
  const analytics = calculateTripAnalytics({
    timeIn: "07:15",
    timeOut: "08:45",
    odometerStart: 120500,
    odometerEnd: 120536,
    passengerCount: "6",
    amountCollected: "180",
  });

  assert.equal(calculateTripDurationMin({ timeIn: "07:15", timeOut: "08:45" }), 90);
  assert.deepEqual(analytics, {
    tripDurationMin: 90,
    kmComputed: 36,
    passengerCount: 6,
    takingsExpected: 180,
  });
});

test("calculateDailyAnalytics aggregates trips, expenses, and waiting gaps without crashing on partial data", () => {
  const analytics = calculateDailyAnalytics({
    dayRecord: {
      dayStartOdometer: 1000,
      dayEndOdometer: 1060,
    },
    trips: [
      {
        id: "trip-1",
        timeIn: "07:00",
        timeOut: "07:25",
        odometerStart: 1000,
        odometerEnd: 1012,
        passengerCount: 2,
        amountCollected: 40,
      },
      {
        id: "trip-2",
        timeIn: "07:40",
        timeOut: "08:10",
        odometerStart: 1012,
        odometerEnd: 1030,
        passengerCount: 3,
        amountCollected: 55,
      },
      {
        id: "trip-3",
        passengerCount: 1,
        amountCollected: 25,
      },
    ],
    expenses: [{ amount: 30 }],
  });

  assert.equal(analytics.totalTrips, 3);
  assert.equal(analytics.totalPassengers, 6);
  assert.equal(analytics.totalTakingsExpected, 120);
  assert.equal(analytics.totalExpenses, 30);
  assert.equal(analytics.netExpected, 90);
  assert.equal(analytics.dayKm, 60);
  assert.equal(analytics.avgTripKm, 15);
  assert.equal(analytics.avgTripDurationMin, 27.5);
  assert.equal(analytics.avgPassengersPerTrip, 2);
  assert.equal(analytics.avgTakingsPerTrip, 40);
  assert.equal(analytics.observedTripKmCount, 2);
  assert.equal(analytics.observedTripDurationCount, 2);
  assert.equal(analytics.dailyWaitingTotalMin, 15);
  assert.equal(analytics.avgWaitingMin, 15);
  assert.equal(analytics.waitingIntervalCount, 1);
  assert.deepEqual(analytics.waitingIntervals, [
    {
      fromTripId: "trip-1",
      toTripId: "trip-2",
      waitingMin: 15,
    },
  ]);
});

test("calculateDayKm falls back to daily odometer values and returns null when incomplete", () => {
  assert.equal(
    calculateDayKm({
      dayStartOdometer: 50100,
      dayEndOdometer: 50188,
    }),
    88,
  );
  assert.equal(
    calculateDayKm({
      openingOdo: 384120,
      closingOdo: 384200,
    }),
    80,
  );
  assert.equal(calculateDayKm({ dayStartOdometer: 1000 }), null);
});

test("calculateWaitingIntervals skips incomplete or overlapping trip times", () => {
  const waiting = calculateWaitingIntervals([
    { id: "trip-a", timeIn: "09:00", timeOut: "09:20" },
    { id: "trip-b", timeIn: "09:10", timeOut: "09:35" },
    { id: "trip-c", amountCollected: 10 },
    { id: "trip-d", timeIn: "09:50", timeOut: "10:00" },
  ]);

  assert.deepEqual(waiting.waitingIntervals, [
    {
      fromTripId: "trip-b",
      toTripId: "trip-d",
      waitingMin: 15,
    },
  ]);
  assert.equal(waiting.dailyWaitingTotalMin, 15);
  assert.equal(waiting.avgWaitingMin, 15);
});
