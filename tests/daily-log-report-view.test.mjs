import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyLogReportView } from "../api/_lib/dailyLogReportView.js";
import { mockSnapshot } from "../src/data/mockData.js";

test("buildDailyLogReportView maps a stored daily log into the PDF-ready JSON shape", () => {
  const reportView = buildDailyLogReportView(mockSnapshot, "txn-inc-0901");

  assert.equal(reportView.reportType, "DailyLogReportView");
  assert.equal(reportView.reportId, "txn-inc-0901");
  assert.equal(reportView.header.date, "2026-03-25");
  assert.equal(reportView.header.driver, "Sizwe Mokoena");
  assert.equal(reportView.header.vehicle, "JHB 457 GP");
  assert.equal(reportView.header.brandModel, "Toyota Ses'fikile");
  assert.equal(reportView.header.vehicleNo, "JHB 457 GP");
  assert.equal(reportView.tripsTable.length, 1);
  assert.deepEqual(reportView.tripsTable[0], {
    rowId: "txn-inc-0901-summary",
    timeOut: null,
    timeIn: null,
    odometerStart: 383520,
    odometerEnd: 383840,
    kmComputed: 320,
    routeName: "Noord -> Alexandra",
    passengerCount: null,
    tripAmountExpected: 4760,
  });
  assert.deepEqual(reportView.totals, {
    totalPassengers: 0,
    totalTrips: 1,
    totalTakingsExpected: 4760,
  });
  assert.deepEqual(reportView.dailyExpenses, []);
  assert.equal(reportView.expensesTotal, 0);
  assert.equal(reportView.analytics.avgTripKm, 320);
  assert.equal(reportView.analytics.avgTripDurationMin, null);
  assert.equal(reportView.analytics.avgWaitingMin, null);
  assert.equal(reportView.analytics.avgTripTakings, 4760);
  assert.equal(reportView.analytics.avgPassengers, 0);
  assert.equal(reportView.analytics.kmPerDay, 320);
  assert.deepEqual(reportView.bankingCheckin, {
    collectedExpected: 4760,
    spentTotal: 0,
    submitted: 4760,
    amountSubmitted: 4760,
    bankedAmount: 4760,
    variance: 0,
    discrepancyReason: null,
  });
  assert.deepEqual(reportView.verification, {
    adminStatus: "Deposited",
    notes: "Manager verification completed at 2026-03-25T19:05:00+02:00 by Manager. Included in deposit dep-0326-02.",
  });
});

test("buildDailyLogReportView uses trip logbook rows and same-day vehicle expenses when present", () => {
  const customSnapshot = {
    vehicles: [
      {
        id: "veh-1",
        registration: "TEST 100 GP",
        model: "Toyota Quantum",
        seatCapacity: 16,
        assignedDriverId: "drv-1",
      },
    ],
    drivers: [
      {
        staffId: "drv-1",
        name: "Test Driver",
        role: "Driver",
      },
    ],
    financeTransactions: [
      {
        id: "daily-1",
        type: "income",
        incomeKind: "standard",
        vehicleId: "veh-1",
        vehicle: "TEST 100 GP",
        route: "Point A to Point B",
        tripDate: "2026-04-05",
        tripCount: 2,
        totalPassengers: 5,
        amountClaimed: 140,
        actualCashReceived: 130,
        openingOdo: 1000,
        closingOdo: 1042,
        status: "counted",
        countedAt: "2026-04-05T18:00:00+02:00",
        countedByRole: "Admin",
        tripLogbook: [
          {
            id: "leg-1",
            timeOut: "06:00",
            timeIn: "06:25",
            odometerStart: 1000,
            odometerEnd: 1018,
            departingFromPoint: "Point A",
            goingToPoint: "Point B",
            passengerCount: 2,
            amountCollected: 60,
          },
          {
            id: "leg-2",
            timeOut: "06:40",
            timeIn: "07:05",
            odometerStart: 1018,
            odometerEnd: 1042,
            departingFromPoint: "Point A",
            goingToPoint: "Point B",
            passengerCount: 3,
            amountCollected: 80,
          },
        ],
      },
      {
        id: "expense-1",
        type: "expense",
        category: "Fuel",
        amount: 30,
        description: "Fuel top-up",
        reference: "REC-10",
        vehicleId: "veh-1",
        vehicle: "TEST 100 GP",
        expenseDate: "2026-04-05",
      },
    ],
  };

  const reportView = buildDailyLogReportView(customSnapshot, "daily-1");

  assert.equal(reportView.header.driver, "Test Driver");
  assert.equal(reportView.header.seatingCapacity, 16);
  assert.equal(reportView.tripsTable.length, 2);
  assert.equal(reportView.tripsTable[0].routeName, "Point A -> Point B");
  assert.equal(reportView.totals.totalPassengers, 5);
  assert.equal(reportView.totals.totalTrips, 2);
  assert.equal(reportView.totals.totalTakingsExpected, 140);
  assert.deepEqual(reportView.dailyExpenses, [
    {
      category: "Fuel",
      amount: 30,
      notes: "Fuel top-up",
      receiptRef: "REC-10",
    },
  ]);
  assert.equal(reportView.expensesTotal, 30);
  assert.equal(reportView.analytics.avgTripKm, 21);
  assert.equal(reportView.analytics.avgTripDurationMin, 25);
  assert.equal(reportView.analytics.avgWaitingMin, 15);
  assert.equal(reportView.analytics.avgTripTakings, 70);
  assert.equal(reportView.analytics.avgPassengers, 2.5);
  assert.equal(reportView.analytics.kmPerDay, 42);
  assert.equal(reportView.bankingCheckin.submitted, 130);
  assert.equal(reportView.bankingCheckin.variance, 20);
  assert.equal(
    reportView.bankingCheckin.discrepancyReason,
    "Submitted amount differs from expected net takings.",
  );
  assert.deepEqual(reportView.verification, {
    adminStatus: "Admin hand-in recorded",
    notes: "Admin hand-in recorded at 2026-04-05T18:00:00+02:00 by Admin.",
  });
});
