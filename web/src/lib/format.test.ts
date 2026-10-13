import { describe, expect, it } from "vitest";

import {
  DASH,
  approx,
  formatBpm,
  formatChange,
  formatClock,
  formatClockMinutes,
  formatDay,
  formatDayLong,
  formatDayMonth,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatInt,
  formatKcal,
  formatMonth,
  formatRelative,
  stepsSourceLabel,
  workoutLabel,
} from "./format";

const ZONE = "Europe/Bratislava";
const MINUS = "−";

// The thousands separator is whatever Intl prints for Slovak: a no-break space, not a plain one.
const GROUP = new Intl.NumberFormat("sk-SK", { useGrouping: "always" })
  .formatToParts(1000)
  .find((part) => part.type === "group")!.value;

const missing = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY];

describe("thousands separator", () => {
  it("is a no-break space", () => {
    expect([" ", " "]).toContain(GROUP);
  });
});

describe("formatInt", () => {
  it("groups thousands the Slovak way", () => {
    expect(formatInt(12345)).toBe(`12${GROUP}345`);
    expect(formatInt(2130)).toBe(`2${GROUP}130`);
    expect(formatInt(1234567)).toBe(`1${GROUP}234${GROUP}567`);
    expect(formatInt(999)).toBe("999");
    expect(formatInt(0)).toBe("0");
  });

  it("rounds to a whole number", () => {
    expect(formatInt(52.4)).toBe("52");
    expect(formatInt(52.5)).toBe("53");
    expect(formatInt(-0.2)).toBe("0");
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatInt(value)).toBe(DASH);
  });
});

describe("formatDecimal", () => {
  it("uses a decimal comma and one digit by default", () => {
    expect(formatDecimal(8.94)).toBe("8,9");
    expect(formatDecimal(8.96)).toBe("9,0");
    expect(formatDecimal(8)).toBe("8,0");
    expect(formatDecimal(0)).toBe("0,0");
  });

  it("takes the number of digits", () => {
    expect(formatDecimal(8.946, 2)).toBe("8,95");
    expect(formatDecimal(8.94, 0)).toBe("9");
    expect(formatDecimal(1234.56, 1)).toBe(`1${GROUP}234,6`);
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatDecimal(value)).toBe(DASH);
  });
});

describe("formatDuration", () => {
  it("writes hours and minutes", () => {
    expect(formatDuration(440)).toBe("7 h 20 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(61)).toBe("1 h 1 min");
    expect(formatDuration(1500)).toBe("25 h");
  });

  it("rounds to whole minutes", () => {
    expect(formatDuration(59.6)).toBe("1 h");
    expect(formatDuration(44.4)).toBe("44 min");
    expect(formatDuration(439.5)).toBe("7 h 20 min");
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatDuration(value)).toBe(DASH);
  });
});

describe("formatDurationShort", () => {
  it("writes h:mm", () => {
    expect(formatDurationShort(440)).toBe("7:20");
    expect(formatDurationShort(45)).toBe("0:45");
    expect(formatDurationShort(60)).toBe("1:00");
    expect(formatDurationShort(5)).toBe("0:05");
    expect(formatDurationShort(0)).toBe("0:00");
    expect(formatDurationShort(659.6)).toBe("11:00");
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatDurationShort(value)).toBe(DASH);
  });
});

describe("formatDistance", () => {
  it("switches from metres to kilometres at one kilometre", () => {
    expect(formatDistance(8940)).toBe("8,9 km");
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(999.4)).toBe("999 m");
    expect(formatDistance(999.6)).toBe("1,0 km");
    expect(formatDistance(1000)).toBe("1,0 km");
    expect(formatDistance(42195)).toBe("42,2 km");
    expect(formatDistance(1234500)).toBe(`1${GROUP}234,5 km`);
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatDistance(value)).toBe(DASH);
  });
});

describe("formatKcal and formatBpm", () => {
  it("round and add the unit", () => {
    expect(formatKcal(2130.4)).toBe(`2${GROUP}130 kcal`);
    expect(formatKcal(480)).toBe("480 kcal");
    expect(formatKcal(0)).toBe("0 kcal");
    expect(formatBpm(52.4)).toBe("52 bpm");
    expect(formatBpm(168)).toBe("168 bpm");
  });

  it("show a dash for a missing value", () => {
    for (const value of missing) {
      expect(formatKcal(value)).toBe(DASH);
      expect(formatBpm(value)).toBe(DASH);
    }
  });
});

describe("day formats", () => {
  it("formatDay gives the short weekday with day and month", () => {
    expect(formatDay("2026-10-12")).toBe("po 12. 10.");
    expect(formatDay("2026-10-13")).toBe("ut 13. 10.");
    expect(formatDay("2026-10-14")).toBe("st 14. 10.");
    expect(formatDay("2026-10-15")).toBe("št 15. 10.");
    expect(formatDay("2026-10-16")).toBe("pi 16. 10.");
    expect(formatDay("2026-10-17")).toBe("so 17. 10.");
    expect(formatDay("2026-10-18")).toBe("ne 18. 10.");
    expect(formatDay("2026-03-01")).toBe("ne 1. 3.");
  });

  it("formatDayMonth gives day and month without leading zeroes", () => {
    expect(formatDayMonth("2026-10-12")).toBe("12. 10.");
    expect(formatDayMonth("2026-01-05")).toBe("5. 1.");
  });

  it("formatDayLong writes the month in the genitive", () => {
    expect(formatDayLong("2026-10-12")).toBe("pondelok 12. októbra 2026");
    expect(formatDayLong("2026-03-29")).toBe("nedeľa 29. marca 2026");
    expect(formatDayLong("2027-01-01")).toBe("piatok 1. januára 2027");
    expect(formatDayLong("2026-06-18")).toBe("štvrtok 18. júna 2026");
  });

  it("formatMonth writes the month in the nominative", () => {
    expect(formatMonth("2026-10-12")).toBe("október 2026");
    expect(formatMonth("2026-03-01")).toBe("marec 2026");
    expect(formatMonth("2027-01-31")).toBe("január 2027");
  });

  it("agrees with Intl for every weekday and month", () => {
    const intl = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("sk-SK", { ...options, timeZone: "UTC" });
    const long = intl({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const short = intl({ weekday: "short", day: "numeric", month: "numeric" });
    const month = intl({ month: "long", year: "numeric" });
    for (let index = 0; index < 12; index++) {
      const date = new Date(Date.UTC(2026, index, 10 + index));
      const day = date.toISOString().slice(0, 10);
      expect(formatDayLong(day)).toBe(long.format(date));
      expect(formatDay(day)).toBe(short.format(date));
      expect(formatMonth(day)).toBe(month.format(date));
    }
  });

  it("show a dash for something that is not a day", () => {
    for (const value of ["", "2026-02-30", "včera", "2026-10-12T10:00:00Z"]) {
      expect(formatDay(value)).toBe(DASH);
      expect(formatDayMonth(value)).toBe(DASH);
      expect(formatDayLong(value)).toBe(DASH);
      expect(formatMonth(value)).toBe(DASH);
    }
    expect(formatDay(null as unknown as string)).toBe(DASH);
  });
});

describe("formatClock", () => {
  it("shows the local time of an instant", () => {
    expect(formatClock("2026-07-14T20:41:00+00:00", ZONE)).toBe("22:41");
    expect(formatClock("2026-01-14T20:41:00+00:00", ZONE)).toBe("21:41");
    expect(formatClock("2026-07-15T04:05:00+00:00", ZONE)).toBe("06:05");
    expect(formatClock("2026-07-14T22:00:00+00:00", ZONE)).toBe("00:00");
    expect(formatClock("2026-07-14T20:41:00+00:00", "UTC")).toBe("20:41");
  });

  it("follows the clock change", () => {
    expect(formatClock("2026-03-29T00:59:00+00:00", ZONE)).toBe("01:59");
    expect(formatClock("2026-03-29T01:00:00+00:00", ZONE)).toBe("03:00");
    expect(formatClock("2026-10-25T00:59:00+00:00", ZONE)).toBe("02:59");
    expect(formatClock("2026-10-25T01:00:00+00:00", ZONE)).toBe("02:00");
  });

  it("shows a dash for a missing or unreadable time", () => {
    expect(formatClock(null, ZONE)).toBe(DASH);
    expect(formatClock(undefined, ZONE)).toBe(DASH);
    expect(formatClock("", ZONE)).toBe(DASH);
    expect(formatClock("not a time", ZONE)).toBe(DASH);
    expect(formatClock("2026-07-14T20:41:00+00:00", "Nowhere/Nothing")).toBe(DASH);
  });
});

describe("formatClockMinutes", () => {
  it("turns minutes from noon back into a clock time", () => {
    expect(formatClockMinutes(630)).toBe("22:30");
    expect(formatClockMinutes(1140)).toBe("07:00");
    expect(formatClockMinutes(0)).toBe("12:00");
    expect(formatClockMinutes(720)).toBe("00:00");
    expect(formatClockMinutes(735)).toBe("00:15");
    expect(formatClockMinutes(719)).toBe("23:59");
  });

  it("wraps past twenty-four hours and rounds", () => {
    expect(formatClockMinutes(1440)).toBe("12:00");
    expect(formatClockMinutes(2580)).toBe("07:00");
    expect(formatClockMinutes(-60)).toBe("11:00");
    expect(formatClockMinutes(682.5)).toBe("23:23");
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatClockMinutes(value)).toBe(DASH);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it("says 'práve teraz' within the first minute", () => {
    expect(formatRelative(ago(0), now)).toBe("práve teraz");
    expect(formatRelative(ago(0.98), now)).toBe("práve teraz");
    expect(formatRelative(ago(-5), now)).toBe("práve teraz");
  });

  it("counts minutes up to an hour", () => {
    expect(formatRelative(ago(1), now)).toBe("pred 1 min");
    expect(formatRelative(ago(12), now)).toBe("pred 12 min");
    expect(formatRelative(ago(59.9), now)).toBe("pred 59 min");
  });

  it("counts hours up to a day", () => {
    expect(formatRelative(ago(60), now)).toBe("pred 1 h");
    expect(formatRelative(ago(3 * 60 + 20), now)).toBe("pred 3 h");
    expect(formatRelative(ago(23 * 60 + 59), now)).toBe("pred 23 h");
  });

  it("says 'včera' for the second day back", () => {
    expect(formatRelative(ago(24 * 60), now)).toBe("včera");
    expect(formatRelative(ago(47 * 60 + 59), now)).toBe("včera");
  });

  it("uses 'dňami' for every count from two days on", () => {
    expect(formatRelative(ago(2 * 24 * 60), now)).toBe("pred 2 dňami");
    expect(formatRelative(ago(4 * 24 * 60 + 300), now)).toBe("pred 4 dňami");
    expect(formatRelative(ago(5 * 24 * 60), now)).toBe("pred 5 dňami");
    expect(formatRelative(ago(21 * 24 * 60), now)).toBe("pred 21 dňami");
    expect(formatRelative(ago(100 * 24 * 60), now)).toBe("pred 100 dňami");
  });

  it("reads the API's timestamp format", () => {
    expect(formatRelative("2026-10-13T11:48:00+00:00", now)).toBe("pred 12 min");
  });

  it("shows a dash for a missing or unreadable time", () => {
    expect(formatRelative(null, now)).toBe(DASH);
    expect(formatRelative(undefined, now)).toBe(DASH);
    expect(formatRelative("", now)).toBe(DASH);
    expect(formatRelative("not a time", now)).toBe(DASH);
  });
});

describe("formatChange", () => {
  it("signs the percentage, with a real minus sign", () => {
    expect(formatChange(0.123)).toBe("+12 %");
    expect(formatChange(-0.04)).toBe(`${MINUS}4 %`);
    expect(formatChange(1)).toBe("+100 %");
    expect(formatChange(-0.5)).toBe(`${MINUS}50 %`);
    expect(formatChange(-0.04)).not.toContain("-");
  });

  it("shows zero without a sign", () => {
    expect(formatChange(0)).toBe("0 %");
    expect(formatChange(0.004)).toBe("0 %");
    expect(formatChange(-0.004)).toBe("0 %");
  });

  it("groups very large changes", () => {
    expect(formatChange(12.5)).toBe(`+1${GROUP}250 %`);
  });

  it("shows a dash for a missing value", () => {
    for (const value of missing) expect(formatChange(value)).toBe(DASH);
  });
});

describe("approx", () => {
  it("marks an estimate and leaves a missing value alone", () => {
    expect(approx("8,9 km")).toBe("≈ 8,9 km");
    expect(approx(formatKcal(480))).toBe("≈ 480 kcal");
    expect(approx(DASH)).toBe(DASH);
    expect(approx(formatKcal(null))).toBe(DASH);
  });
});

describe("workoutLabel", () => {
  it("translates every known type", () => {
    const expected: Record<string, string> = {
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
    };
    for (const [type, label] of Object.entries(expected)) {
      expect(workoutLabel(type), type).toBe(label);
    }
  });

  it("makes an unknown type readable", () => {
    expect(workoutLabel("kite_surfing")).toBe("Kite surfing");
    expect(workoutLabel("padel")).toBe("Padel");
    expect(workoutLabel("constructor")).toBe("Constructor");
    expect(workoutLabel("toString")).toBe("ToString");
  });

  it("ignores case and falls back to a generic label for nothing", () => {
    expect(workoutLabel("RUNNING")).toBe("Beh");
    expect(workoutLabel("")).toBe("Tréning");
  });
});

describe("stepsSourceLabel", () => {
  it("names the three sources", () => {
    expect(stepsSourceLabel("samsung_health_total")).toBe("Samsung Health");
    expect(stepsSourceLabel("samsung_hourly")).toBe("Samsung (hodinové)");
    expect(stepsSourceLabel("phone")).toBe("Telefón");
  });

  it("shows a dash for none and something readable for an unknown one", () => {
    expect(stepsSourceLabel(null)).toBe(DASH);
    expect(stepsSourceLabel(undefined)).toBe(DASH);
    expect(stepsSourceLabel("")).toBe(DASH);
    expect(stepsSourceLabel("garmin_daily")).toBe("Garmin daily");
  });
});
