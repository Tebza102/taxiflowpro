const TIME_ONLY_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const toFiniteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
};

const toPositiveNumber = (value) => {
  const numeric = toFiniteNumber(value);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const roundMetric = (value) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(2));
};

const average = (values = []) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);

  return roundMetric(total / values.length);
};

const getTripTimeInValue = (trip = {}) => trip.timeIn ?? trip.time_in ?? null;
const getTripTimeOutValue = (trip = {}) => trip.timeOut ?? trip.time_out ?? null;
const getOdometerStartValue = (trip = {}) =>
  trip.odometerStart ?? trip.odometer_start ?? trip.openingOdo ?? trip.opening_odo ?? null;
const getOdometerEndValue = (trip = {}) =>
  trip.odometerEnd ?? trip.odometer_end ?? trip.closingOdo ?? trip.closing_odo ?? null;
const getDayStartOdometerValue = (record = {}) =>
  record.dayStartOdometer ??
  record.day_start_odometer ??
  record.openingOdo ??
  record.opening_odo ??
  null;
const getDayEndOdometerValue = (record = {}) =>
  record.dayEndOdometer ??
  record.day_end_odometer ??
  record.closingOdo ??
  record.closing_odo ??
  null;
const getTripTakingsValue = (trip = {}) =>
  trip.amountCollected ??
  trip.amount_collected ??
  trip.amountClaimed ??
  trip.amount_claimed ??
  trip.amount ??
  null;

export const parseTimeToMinutes = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const timeOnlyMatch = normalized.match(TIME_ONLY_PATTERN);
  if (timeOnlyMatch) {
    const hours = Number(timeOnlyMatch[1]);
    const minutes = Number(timeOnlyMatch[2]);

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  const parsedDate = new Date(normalized);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.getHours() * 60 + parsedDate.getMinutes();
};

export const calculateTripDurationMin = (trip = {}) => {
  const timeInMinutes = parseTimeToMinutes(getTripTimeInValue(trip));
  const timeOutMinutes = parseTimeToMinutes(getTripTimeOutValue(trip));

  if (!Number.isFinite(timeInMinutes) || !Number.isFinite(timeOutMinutes)) {
    return null;
  }

  const duration = timeOutMinutes - timeInMinutes;

  return duration > 0 ? duration : null;
};

export const calculateKmComputed = (trip = {}) => {
  const odometerStart = toFiniteNumber(getOdometerStartValue(trip));
  const odometerEnd = toFiniteNumber(getOdometerEndValue(trip));

  if (!Number.isFinite(odometerStart) || !Number.isFinite(odometerEnd)) {
    return null;
  }

  const distance = odometerEnd - odometerStart;

  return distance >= 0 ? distance : null;
};

export const calculateDayKm = (record = {}) => {
  const odometerStart = toFiniteNumber(getDayStartOdometerValue(record));
  const odometerEnd = toFiniteNumber(getDayEndOdometerValue(record));

  if (!Number.isFinite(odometerStart) || !Number.isFinite(odometerEnd)) {
    return null;
  }

  const distance = odometerEnd - odometerStart;

  return distance >= 0 ? distance : null;
};

export const calculateTripAnalytics = (trip = {}) => {
  const existingDuration = toFiniteNumber(trip.tripDurationMin ?? trip.trip_duration_min);
  const existingKm = toFiniteNumber(trip.kmComputed ?? trip.km_computed);

  return {
    tripDurationMin: existingDuration ?? calculateTripDurationMin(trip),
    kmComputed: existingKm ?? calculateKmComputed(trip),
    passengerCount: toPositiveNumber(trip.passengerCount ?? trip.passenger_count),
    takingsExpected: toPositiveNumber(getTripTakingsValue(trip)),
  };
};

export const calculateWaitingIntervals = (trips = []) => {
  const timeline = (Array.isArray(trips) ? trips : [])
    .map((trip, index) => ({
      id: trip?.id ?? `trip-${index + 1}`,
      sequence: index,
      timeInMinutes: parseTimeToMinutes(getTripTimeInValue(trip)),
      timeOutMinutes: parseTimeToMinutes(getTripTimeOutValue(trip)),
    }))
    .sort((left, right) => {
      const leftOrder = left.timeInMinutes ?? left.timeOutMinutes ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.timeInMinutes ?? right.timeOutMinutes ?? Number.MAX_SAFE_INTEGER;

      return leftOrder - rightOrder || left.sequence - right.sequence;
    });

  const waitingIntervals = [];

  for (let index = 0; index < timeline.length - 1; index += 1) {
    const currentTrip = timeline[index];
    const nextTrip = timeline[index + 1];

    if (
      !Number.isFinite(currentTrip.timeOutMinutes) ||
      !Number.isFinite(nextTrip.timeInMinutes)
    ) {
      continue;
    }

    const waitingMin = nextTrip.timeInMinutes - currentTrip.timeOutMinutes;

    if (waitingMin < 0) {
      continue;
    }

    waitingIntervals.push({
      fromTripId: currentTrip.id,
      toTripId: nextTrip.id,
      waitingMin,
    });
  }

  const dailyWaitingTotalMin = waitingIntervals.reduce(
    (sum, interval) => sum + interval.waitingMin,
    0,
  );

  return {
    waitingIntervals,
    dailyWaitingTotalMin,
    avgWaitingMin: average(waitingIntervals.map((interval) => interval.waitingMin)),
  };
};

export const calculateDailyAnalytics = ({
  trips = [],
  expenses = [],
  totalExpenses = null,
  totalTakingsExpected = null,
  dayRecord = null,
  dayStartOdometer = null,
  dayEndOdometer = null,
} = {}) => {
  const safeTrips = Array.isArray(trips) ? trips : [];
  const tripAnalytics = safeTrips.map((trip) => ({
    id: trip?.id ?? null,
    ...calculateTripAnalytics(trip),
  }));
  const tripCount = safeTrips.length;
  const totalPassengers = tripAnalytics.reduce(
    (sum, trip) => sum + Number(trip.passengerCount ?? 0),
    0,
  );
  const computedTakings = tripAnalytics.reduce(
    (sum, trip) => sum + Number(trip.takingsExpected ?? 0),
    0,
  );
  const computedExpenses = (Array.isArray(expenses) ? expenses : []).reduce(
    (sum, expense) => sum + toPositiveNumber(expense?.amount),
    0,
  );
  const safeTakings =
    toFiniteNumber(totalTakingsExpected) ?? roundMetric(computedTakings);
  const safeExpenses = toFiniteNumber(totalExpenses) ?? roundMetric(computedExpenses);
  const validKmValues = tripAnalytics
    .map((trip) => trip.kmComputed)
    .filter((value) => Number.isFinite(value));
  const validDurationValues = tripAnalytics
    .map((trip) => trip.tripDurationMin)
    .filter((value) => Number.isFinite(value));
  const waitingAnalytics = calculateWaitingIntervals(safeTrips);
  const dayKm = calculateDayKm({
    ...(dayRecord ?? {}),
    dayStartOdometer:
      dayStartOdometer ??
      dayRecord?.dayStartOdometer ??
      dayRecord?.day_start_odometer ??
      null,
    dayEndOdometer:
      dayEndOdometer ??
      dayRecord?.dayEndOdometer ??
      dayRecord?.day_end_odometer ??
      null,
  });

  return {
    totalTrips: tripCount,
    totalPassengers,
    totalTakingsExpected: roundMetric(safeTakings),
    totalExpenses: roundMetric(safeExpenses),
    netExpected: roundMetric(safeTakings - safeExpenses),
    avgTripKm: average(validKmValues),
    avgTripDurationMin: average(validDurationValues),
    avgPassengersPerTrip: tripCount > 0 ? roundMetric(totalPassengers / tripCount) : 0,
    avgTakingsPerTrip: tripCount > 0 ? roundMetric(safeTakings / tripCount) : 0,
    dayKm,
    observedTripKmCount: validKmValues.length,
    observedTripDurationCount: validDurationValues.length,
    dailyWaitingTotalMin: waitingAnalytics.dailyWaitingTotalMin,
    avgWaitingMin: waitingAnalytics.avgWaitingMin,
    waitingIntervalCount: waitingAnalytics.waitingIntervals.length,
    waitingIntervals: waitingAnalytics.waitingIntervals,
    tripAnalytics,
  };
};
