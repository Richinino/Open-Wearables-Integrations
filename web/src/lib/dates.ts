// Calendar days are "YYYY-MM-DD" strings. All arithmetic runs on UTC midnights, where every
// day has exactly 24 hours, so daylight-saving changes cannot shift or duplicate a date.

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day: string): number | null {
  const match = typeof day === "string" ? DAY_PATTERN.exec(day) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, date));
  // Date.UTC rolls 02-30 over into March and maps years below 100 to 19xx; both are rejected.
  const roundTrips =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
  return roundTrips ? utc.getTime() : null;
}

function dayToMs(day: string): number {
  const ms = parseDay(day);
  if (ms === null) throw new RangeError(`Invalid day: ${String(day)}`);
  return ms;
}

function msToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function instantOf(iso: string): Date {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Invalid timestamp: ${String(iso)}`);
  return instant;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    // Some engines print midnight as hour 24 even with hourCycle h23.
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

export function isValidDay(value: string): boolean {
  return parseDay(value) !== null;
}

export function addDays(day: string, n: number): string {
  return msToDay(dayToMs(day) + Math.trunc(n) * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: string, to: string): number {
  return Math.round((dayToMs(to) - dayToMs(from)) / DAY_MS);
}

/** Every day from `from` to `to`, both included; empty when `from` is after `to`. */
export function dateRange(from: string, to: string): string[] {
  const end = dayToMs(to);
  const days: string[] = [];
  for (let ms = dayToMs(from); ms <= end; ms += DAY_MS) days.push(msToDay(ms));
  return days;
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return wallClock(now, timeZone).day;
}

/** Calendar day of an instant as seen in `timeZone`. */
export function localDay(iso: string, timeZone: string): string {
  return wallClock(instantOf(iso), timeZone).day;
}

/** Minutes since local midnight of an instant as seen in `timeZone`, 0..1439. */
export function localMinutesOfDay(iso: string, timeZone: string): number {
  return wallClock(instantOf(iso), timeZone).minutes;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (new Date(dayToMs(day)).getUTCDay() + 6) % 7;
}
