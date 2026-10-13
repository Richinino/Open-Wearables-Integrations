import { describe, expect, it } from "vitest";

import {
  addDays,
  dateRange,
  diffDays,
  isValidDay,
  localDay,
  localMinutesOfDay,
  todayIn,
  weekdayIndex,
} from "./dates";

const ZONE = "Europe/Bratislava";

// In 2026 the clocks in this zone change at 01:00 UTC on Sunday 29 March (02:00 → 03:00)
// and on Sunday 25 October (03:00 → 02:00).
const SPRING = "2026-03-29";
const AUTUMN = "2026-10-25";

describe("isValidDay", () => {
  it("accepts real calendar days", () => {
    expect(isValidDay("2026-10-13")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2026-12-31")).toBe(true);
  });

  it("rejects impossible or malformed values", () => {
    for (const value of [
      "",
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-1-5",
      "26-01-05",
      "2026/01/05",
      "2026-01-05T00:00:00Z",
      " 2026-01-05",
      "dnes",
    ]) {
      expect(isValidDay(value), value).toBe(false);
    }
    expect(isValidDay(undefined as unknown as string)).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-10-13", 0)).toBe("2026-10-13");
    expect(addDays("2026-10-13", 365)).toBe("2027-10-13");
  });

  it("neither skips nor repeats a day when the clocks change", () => {
    expect(addDays("2026-03-28", 1)).toBe(SPRING);
    expect(addDays(SPRING, 1)).toBe("2026-03-30");
    expect(addDays("2026-03-30", -1)).toBe(SPRING);
    expect(addDays("2026-10-24", 1)).toBe(AUTUMN);
    expect(addDays(AUTUMN, 1)).toBe("2026-10-26");
    expect(addDays("2026-10-26", -1)).toBe(AUTUMN);
  });

  it("throws on an invalid day", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("diffDays", () => {
  it("returns to minus from", () => {
    expect(diffDays("2026-10-13", "2026-10-13")).toBe(0);
    expect(diffDays("2026-10-13", "2026-10-20")).toBe(7);
    expect(diffDays("2026-10-20", "2026-10-13")).toBe(-7);
    expect(diffDays("2026-12-31", "2027-01-01")).toBe(1);
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
    expect(diffDays("2028-01-01", "2029-01-01")).toBe(366);
  });

  it("counts whole days across both clock changes", () => {
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
    expect(diffDays("2026-10-24", "2026-10-26")).toBe(2);
    expect(diffDays("2026-03-01", "2026-11-01")).toBe(245);
  });
});

describe("dateRange", () => {
  it("includes both ends", () => {
    expect(dateRange("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(dateRange("2026-10-13", "2026-10-13")).toEqual(["2026-10-13"]);
  });

  it("is empty when from is after to", () => {
    expect(dateRange("2026-10-14", "2026-10-13")).toEqual([]);
  });

  it("has one entry per day around the clock changes", () => {
    expect(dateRange("2026-03-28", "2026-03-30")).toEqual(["2026-03-28", SPRING, "2026-03-30"]);
    expect(dateRange("2026-10-24", "2026-10-26")).toEqual(["2026-10-24", AUTUMN, "2026-10-26"]);
    expect(dateRange("2026-01-01", "2026-12-31")).toHaveLength(365);
  });
});

describe("todayIn", () => {
  it("uses the zone's calendar, not UTC", () => {
    // 22:30 UTC is already half past midnight in summer time (UTC+2).
    expect(todayIn(ZONE, new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
    // In winter time (UTC+1) the same UTC hour is still 23:30 the same day.
    expect(todayIn(ZONE, new Date("2026-01-14T22:30:00Z"))).toBe("2026-01-14");
    expect(todayIn(ZONE, new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
    expect(todayIn("UTC", new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-14");
  });

  it("is right on both clock-change days", () => {
    expect(todayIn(ZONE, new Date("2026-03-28T22:59:00Z"))).toBe("2026-03-28");
    expect(todayIn(ZONE, new Date("2026-03-28T23:00:00Z"))).toBe(SPRING);
    expect(todayIn(ZONE, new Date("2026-03-29T21:59:00Z"))).toBe(SPRING);
    expect(todayIn(ZONE, new Date("2026-03-29T22:00:00Z"))).toBe("2026-03-30");

    expect(todayIn(ZONE, new Date("2026-10-24T21:59:00Z"))).toBe("2026-10-24");
    expect(todayIn(ZONE, new Date("2026-10-24T22:00:00Z"))).toBe(AUTUMN);
    expect(todayIn(ZONE, new Date("2026-10-25T22:59:00Z"))).toBe(AUTUMN);
    expect(todayIn(ZONE, new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  });

  it("defaults to the current time", () => {
    expect(isValidDay(todayIn(ZONE))).toBe(true);
  });
});

describe("localDay", () => {
  it("switches at local midnight in summer time", () => {
    expect(localDay("2026-07-14T21:59:59+00:00", ZONE)).toBe("2026-07-14");
    expect(localDay("2026-07-14T22:00:00+00:00", ZONE)).toBe("2026-07-15");
  });

  it("switches at local midnight in winter time", () => {
    expect(localDay("2026-01-14T22:59:59+00:00", ZONE)).toBe("2026-01-14");
    expect(localDay("2026-01-14T23:00:00+00:00", ZONE)).toBe("2026-01-15");
  });

  it("keeps the day across the spring change", () => {
    expect(localDay("2026-03-28T22:59:00+00:00", ZONE)).toBe("2026-03-28");
    expect(localDay("2026-03-28T23:00:00+00:00", ZONE)).toBe(SPRING);
    expect(localDay("2026-03-29T00:59:00+00:00", ZONE)).toBe(SPRING);
    expect(localDay("2026-03-29T01:00:00+00:00", ZONE)).toBe(SPRING);
    expect(localDay("2026-03-29T21:59:00+00:00", ZONE)).toBe(SPRING);
    expect(localDay("2026-03-29T22:00:00+00:00", ZONE)).toBe("2026-03-30");
  });

  it("keeps the day across the autumn change", () => {
    expect(localDay("2026-10-24T21:59:00+00:00", ZONE)).toBe("2026-10-24");
    expect(localDay("2026-10-24T22:00:00+00:00", ZONE)).toBe(AUTUMN);
    expect(localDay("2026-10-25T00:59:00+00:00", ZONE)).toBe(AUTUMN);
    expect(localDay("2026-10-25T01:00:00+00:00", ZONE)).toBe(AUTUMN);
    expect(localDay("2026-10-25T22:59:00+00:00", ZONE)).toBe(AUTUMN);
    expect(localDay("2026-10-25T23:00:00+00:00", ZONE)).toBe("2026-10-26");
  });

  it("understands other offsets and the Z suffix", () => {
    expect(localDay("2026-07-15T00:30:00+02:00", ZONE)).toBe("2026-07-15");
    expect(localDay("2026-07-14T22:30:00Z", ZONE)).toBe("2026-07-15");
  });

  it("throws on an unparsable timestamp", () => {
    expect(() => localDay("yesterday", ZONE)).toThrow(RangeError);
  });
});

describe("localMinutesOfDay", () => {
  it("counts from local midnight on either side of it", () => {
    expect(localMinutesOfDay("2026-07-14T21:59:00+00:00", ZONE)).toBe(1439);
    expect(localMinutesOfDay("2026-07-14T22:00:00+00:00", ZONE)).toBe(0);
    expect(localMinutesOfDay("2026-07-14T22:01:00+00:00", ZONE)).toBe(1);
    expect(localMinutesOfDay("2026-01-14T22:59:00+00:00", ZONE)).toBe(1439);
    expect(localMinutesOfDay("2026-01-14T23:00:00+00:00", ZONE)).toBe(0);
  });

  it("drops seconds", () => {
    expect(localMinutesOfDay("2026-07-14T20:41:59+00:00", ZONE)).toBe(22 * 60 + 41);
  });

  it("jumps from 01:59 to 03:00 on the spring change", () => {
    expect(localMinutesOfDay("2026-03-29T00:59:00+00:00", ZONE)).toBe(119);
    expect(localMinutesOfDay("2026-03-29T01:00:00+00:00", ZONE)).toBe(180);
    expect(localMinutesOfDay("2026-03-29T05:00:00+00:00", ZONE)).toBe(7 * 60);
  });

  it("repeats the hour from 02:00 on the autumn change", () => {
    expect(localMinutesOfDay("2026-10-25T00:00:00+00:00", ZONE)).toBe(120);
    expect(localMinutesOfDay("2026-10-25T00:59:00+00:00", ZONE)).toBe(179);
    expect(localMinutesOfDay("2026-10-25T01:00:00+00:00", ZONE)).toBe(120);
    expect(localMinutesOfDay("2026-10-25T01:59:00+00:00", ZONE)).toBe(179);
    expect(localMinutesOfDay("2026-10-25T06:00:00+00:00", ZONE)).toBe(7 * 60);
  });

  it("stays within 0..1439 through a whole day", () => {
    for (let minute = 0; minute < 1440; minute += 7) {
      const iso = new Date(Date.UTC(2026, 9, 25, 0, minute)).toISOString();
      const value = localMinutesOfDay(iso, ZONE);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1439);
    }
  });
});

describe("weekdayIndex", () => {
  it("starts the week on Monday", () => {
    expect(weekdayIndex("2026-10-12")).toBe(0);
    expect(weekdayIndex("2026-10-13")).toBe(1);
    expect(weekdayIndex("2026-10-17")).toBe(5);
    expect(weekdayIndex("2026-10-18")).toBe(6);
    expect(weekdayIndex("2026-10-19")).toBe(0);
  });

  it("is Sunday on both clock-change days", () => {
    expect(weekdayIndex(SPRING)).toBe(6);
    expect(weekdayIndex(AUTUMN)).toBe(6);
  });
});
