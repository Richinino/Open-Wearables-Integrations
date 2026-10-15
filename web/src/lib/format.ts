// Slovak display strings. Nothing here throws: a missing or unusable value becomes DASH.
// Day and month names come from the tables below rather than from Intl, so the server and
// every browser print exactly the same text.

import { isValidDay, localMinutesOfDay, weekdayIndex } from "./dates";

export const DASH = "–";

const MINUS = "−";
const LOCALE = "sk-SK";

const WEEKDAYS_SHORT = ["po", "ut", "st", "št", "pi", "so", "ne"];
const WEEKDAYS_LONG = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"];
const MONTHS = [
  "január",
  "február",
  "marec",
  "apríl",
  "máj",
  "jún",
  "júl",
  "august",
  "september",
  "október",
  "november",
  "december",
];
const MONTHS_GENITIVE = [
  "januára",
  "februára",
  "marca",
  "apríla",
  "mája",
  "júna",
  "júla",
  "augusta",
  "septembra",
  "októbra",
  "novembra",
  "decembra",
];

// Maps, not plain objects: a type named "constructor" must not resolve to an inherited member.
const WORKOUT_LABELS = new Map<string, string>(
  Object.entries({
    running: "Beh",
    trail_running: "Trailový beh",
    treadmill: "Bežecký pás",
    walking: "Chôdza",
    hiking: "Turistika",
    cycling: "Bicykel",
    mountain_biking: "Horský bicykel",
    indoor_cycling: "Stacionárny bicykel",
    swimming: "Plávanie",
    pool_swimming: "Plávanie",
    open_water_swimming: "Plávanie vonku",
    strength_training: "Silový tréning",
    cardio_training: "Kardio",
    yoga: "Joga",
    pilates: "Pilates",
    stretching: "Strečing",
    soccer: "Futbal",
    basketball: "Basketbal",
    volleyball: "Volejbal",
    tennis: "Tenis",
    badminton: "Bedminton",
    table_tennis: "Stolný tenis",
    hockey: "Hokej",
    floorball: "Florbal",
    rowing: "Veslovanie",
    dance: "Tanec",
    alpine_skiing: "Lyžovanie",
    downhill_skiing: "Lyžovanie",
    cross_country_skiing: "Bežky",
    snowboarding: "Snowboard",
    ice_skating: "Korčuľovanie",
    rock_climbing: "Lezenie",
    indoor_climbing: "Lezenie",
    bouldering: "Lezenie",
    generic: "Tréning",
    other: "Tréning",
    sport: "Tréning",
  }),
);

const STEPS_SOURCE_LABELS = new Map<string, string>(
  Object.entries({
    samsung_health_total: "Samsung Health",
    samsung_hourly: "Samsung (hodinové)",
    phone: "Telefón",
  }),
);

const GENERIC_WORKOUT = "Tréning";

const integerFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
  useGrouping: "always",
});
const decimalFormats = new Map<number, Intl.NumberFormat>();

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "snake_case" → "Snake case", for values the tables above do not know. */
function humanize(text: string): string {
  const words = text.replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dayParts(day: string) {
  if (!isValidDay(day)) return null;
  return {
    year: Number(day.slice(0, 4)),
    month: Number(day.slice(5, 7)),
    date: Number(day.slice(8, 10)),
    weekday: weekdayIndex(day),
  };
}

export function formatInt(value: number | null | undefined): string {
  if (!isNumber(value)) return DASH;
  const rounded = Math.round(value);
  // Folds negative zero into zero so a small negative never prints as "-0".
  return integerFormat.format(rounded === 0 ? 0 : rounded);
}

export function formatDecimal(value: number | null | undefined, digits: number = 1): string {
  if (!isNumber(value)) return DASH;
  let format = decimalFormats.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: "always",
    });
    decimalFormats.set(digits, format);
  }
  return format.format(value);
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return DASH;
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Tight duration for legends and small tiles: "1 h 30", "2 h", "8 min". */
export function formatDurationCompact(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return DASH;
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${pad(rest)}`;
}

/** Clock time from minutes since local midnight; values outside one day wrap around. */
export function formatTimeOfDay(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return DASH;
  const ofDay = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(ofDay / 60))}:${pad(ofDay % 60)}`;
}

export function formatDurationShort(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return DASH;
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (!isNumber(meters)) return DASH;
  if (Math.round(meters) < 1000) return `${formatInt(meters)} m`;
  return `${formatDecimal(meters / 1000, 1)} km`;
}

export function formatKcal(value: number | null | undefined): string {
  return isNumber(value) ? `${formatInt(value)} kcal` : DASH;
}

export function formatBpm(value: number | null | undefined): string {
  return isNumber(value) ? `${formatInt(value)} bpm` : DASH;
}

export function formatDay(day: string): string {
  const parts = dayParts(day);
  return parts ? `${WEEKDAYS_SHORT[parts.weekday]} ${parts.date}. ${parts.month}.` : DASH;
}

export function formatDayMonth(day: string): string {
  const parts = dayParts(day);
  return parts ? `${parts.date}. ${parts.month}.` : DASH;
}

export function formatDayLong(day: string): string {
  const parts = dayParts(day);
  if (!parts) return DASH;
  return `${WEEKDAYS_LONG[parts.weekday]} ${parts.date}. ${MONTHS_GENITIVE[parts.month - 1]} ${parts.year}`;
}

export function formatMonth(day: string): string {
  const parts = dayParts(day);
  return parts ? `${MONTHS[parts.month - 1]} ${parts.year}` : DASH;
}

export function formatClock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return DASH;
  try {
    const minutes = localMinutesOfDay(iso, timeZone);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  } catch {
    return DASH;
  }
}

/** Clock time from the minutes-from-noon convention described in metrics.ts. */
export function formatClockMinutes(minutesFromNoon: number | null | undefined): string {
  if (!isNumber(minutesFromNoon)) return DASH;
  const ofDay = (((Math.round(minutesFromNoon) + 720) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(ofDay / 60))}:${pad(ofDay % 60)}`;
}

/**
 * Elapsed time, not calendar days: "včera" means 24 to 48 hours ago. From two days on the
 * noun is always "dňami", the instrumental plural that follows "pred".
 */
export function formatRelative(iso: string | null | undefined, now: Date): string {
  if (!iso) return DASH;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return DASH;

  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "práve teraz";
  if (minutes < 60) return `pred ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `pred ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "včera" : `pred ${formatInt(days)} dňami`;
}

export function formatChange(fraction: number | null | undefined): string {
  if (!isNumber(fraction)) return DASH;
  const percent = Math.round(fraction * 100);
  if (percent === 0) return "0 %";
  return `${percent > 0 ? "+" : MINUS}${formatInt(Math.abs(percent))} %`;
}

/**
 * Slovak noun form for a count: 1 → one ("tréning"), 2–4 → few ("tréningy"), otherwise many
 * ("tréningov"), which also covers 0 and fractions.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (Number.isInteger(count) && count >= 2 && count <= 4) return few;
  return many;
}

/** Marks an estimate. A missing value stays a plain dash. */
export function approx(text: string): string {
  return text === DASH ? DASH : `≈ ${text}`;
}

export function workoutLabel(type: string): string {
  const key = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (!key) return GENERIC_WORKOUT;
  return WORKOUT_LABELS.get(key) ?? humanize(type);
}

export function stepsSourceLabel(source: string | null | undefined): string {
  if (!source) return DASH;
  return STEPS_SOURCE_LABELS.get(source) ?? humanize(source);
}
