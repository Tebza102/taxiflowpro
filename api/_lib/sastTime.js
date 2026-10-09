export const SAST_TIME_ZONE = "Africa/Johannesburg";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const toParts = (date) => {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return { ...parts, month: MONTHS[Number(parts.month) - 1] };
};

const toDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
};

// "28 Sep 2026, 14:03:11 SAST"
export const formatSastTimestamp = (value = new Date()) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  const p = toParts(date);

  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} SAST`;
};

// "25 Mar 2026, 19:05" for a stored ISO timestamp, shown in South African time.
export const formatSastDateTime = (value) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  const p = toParts(date);

  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
};

// Operating dates are calendar dates ("2026-03-25"), not instants, so they are
// formatted without any timezone conversion.
export const formatOperatingDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day)) {
    return null;
  }

  return `${WEEKDAYS[date.getUTCDay()]}, ${day} ${MONTHS[Number(month) - 1]} ${year}`;
};
