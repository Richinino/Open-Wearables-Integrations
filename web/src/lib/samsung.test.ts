import { describe, expect, it } from "vitest";

import { addDays, dateRange } from "./dates";
import {
  calibrationNote,
  difference,
  formatError,
  formatFieldValue,
  isLearning,
  learningGap,
  learningText,
  missingDaysText,
  missingEntryDays,
  owiFigure,
  owiFigureText,
  qualityRows,
  savedEntryDays,
  scoreParts,
  withEntry,
} from "./samsung";
import { makeCalibration, makeDay, makeEntry, makeScore, makeScores } from "./test-fixtures";
import type { Dataset } from "./types";

const TODAY = "2026-10-16";
const NBSP = " ";
/** The expected text with the no-break spaces formatError puts around the number. */
const nb = (text: string) => text.replace(/± (\S+) (%|bodu)/g, "±\u00a0$1\u00a0$2");
const learning = (entries: number, needed = 10) => makeScore(null, { entries, needed }, "learning");

describe("missingEntryDays and savedEntryDays", () => {
  // 40 days up to today; entries on the 10th, 12th and 15th of October; the 13th is absent.
  const days = dateRange(addDays(TODAY, -39), TODAY)
    .filter((day) => day !== "2026-10-13")
    .map((day) =>
      makeDay(day, {
        complete: day !== TODAY,
        samsung: ["2026-10-10", "2026-10-12", "2026-10-15"].includes(day) ? makeEntry(day, { steps: 9000 }) : null,
      }),
    );

  it("lists completed days of the last 30 without an entry, newest first", () => {
    const missing = missingEntryDays(days, TODAY);
    expect(missing[0]).toBe("2026-10-14");
    expect(missing).not.toContain(TODAY);
    expect(missing).not.toContain("2026-10-13");
    expect(missing).not.toContain("2026-10-15");
    expect(missing[missing.length - 1]).toBe(addDays(TODAY, -30));
    // 30 calendar days, minus the absent day and the three with an entry.
    expect(missing).toHaveLength(26);
    expect([...missing].sort().reverse()).toEqual(missing);
  });

  it("does not count an entry without numbers, nor an unfinished day", () => {
    const changed = days.map((day) =>
      day.day === "2026-10-15" ? { ...day, samsung: makeEntry(day.day, { saved_at: null }) } : day.day === "2026-10-14" ? { ...day, complete: false } : day,
    );
    const missing = missingEntryDays(changed, TODAY);
    expect(missing[0]).toBe("2026-10-15");
    expect(missing).not.toContain("2026-10-14");
  });

  it("lists the days that have one, newest first", () => {
    expect(savedEntryDays(days, TODAY)).toEqual(["2026-10-15", "2026-10-12", "2026-10-10"]);
    expect(savedEntryDays(days, TODAY, 5)).toEqual(["2026-10-15", "2026-10-12"]);
  });

  it("works on days in any order and on older responses without entries", () => {
    const shuffled = [...days].reverse();
    expect(missingEntryDays(shuffled, TODAY)).toEqual(missingEntryDays(days, TODAY));
    const old = days.map((day) => {
      const copy = { ...day };
      delete copy.samsung;
      return copy;
    });
    expect(missingEntryDays(old, TODAY)).toHaveLength(29);
  });

  it("counts in Slovak", () => {
    expect(missingDaysText(1)).toBe("1 deň bez zápisu");
    expect(missingDaysText(3)).toBe("3 dni bez zápisu");
    expect(missingDaysText(12)).toBe("12 dní bez zápisu");
  });
});

describe("withEntry", () => {
  const dataset: Dataset = {
    timezone: "Europe/Bratislava",
    first_day: "2026-10-14",
    last_day: TODAY,
    synced_at: null,
    days: [makeDay("2026-10-14"), makeDay("2026-10-15", { samsung: makeEntry("2026-10-15", { steps: 1 }) })],
  };

  it("sets the entry on its day without touching the others", () => {
    const entry = makeEntry("2026-10-14", { steps: 9500 });
    const updated = withEntry(dataset, entry);
    expect(updated.days[0].samsung).toEqual(entry);
    expect(updated.days[1]).toBe(dataset.days[1]);
    expect(dataset.days[0].samsung).toBeUndefined();
  });

  it("removes the entry after a deletion and ignores days owi does not have", () => {
    expect(withEntry(dataset, makeEntry("2026-10-15", { saved_at: null })).days[1].samsung).toBeNull();
    expect(withEntry(dataset, makeEntry("2026-09-01", { steps: 1 }))).toBe(dataset);
  });
});

describe("owi's figures beside the fields", () => {
  const day = makeDay("2026-10-15", {
    steps: 9812,
    distance_m_est: 7324.9,
    active_minutes_est: 85,
    activity_kcal_est: 650,
    total_kcal_est: 2340,
    scores: makeScores("2026-10-15", { samsung_sleep: makeScore(78.4), energy_score: learning(6) }),
  });

  it("takes each field from the matching estimate, in the field's unit", () => {
    expect(owiFigure(day, "steps")).toBe(9812);
    expect(owiFigure(day, "distance_km")).toBeCloseTo(7.3249);
    expect(owiFigure(day, "active_minutes")).toBe(85);
    expect(owiFigure(day, "active_kcal")).toBe(650);
    expect(owiFigure(day, "total_kcal")).toBe(2340);
    expect(owiFigure(day, "sleep_score")).toBe(78.4);
    expect(owiFigure(day, "energy_score")).toBeNull();
    expect(owiFigure(makeDay("2026-10-15"), "sleep_score")).toBeNull();
    expect(owiFigure(null, "steps")).toBeNull();
  });

  it("marks everything but the steps as an estimate and shows a dash without a figure", () => {
    expect(owiFigureText(day, "steps")).toBe(`9${NBSP}812`);
    expect(owiFigureText(day, "distance_km")).toBe("≈ 7,32 km");
    expect(owiFigureText(day, "active_minutes")).toBe("≈ 85 min");
    expect(owiFigureText(day, "total_kcal")).toBe(`≈ 2${NBSP}340 kcal`);
    expect(owiFigureText(day, "sleep_score")).toBe("≈ 78");
    expect(owiFigureText(day, "energy_score")).toBe("–");
  });

  it("formats Samsung's numbers the same way", () => {
    expect(formatFieldValue("steps", 23588)).toBe(`23${NBSP}588`);
    expect(formatFieldValue("distance_km", 17.9)).toBe("17,90 km");
    expect(formatFieldValue("active_kcal", 980)).toBe("980 kcal");
    expect(formatFieldValue("energy_score", null)).toBe("–");
  });

  it("gives owi against Samsung in percent, and in points for the scores", () => {
    expect(difference("total_kcal", 2340, 2600)).toBe("−10 %");
    expect(difference("active_kcal", 1012, 980)).toBe("+3 %");
    expect(difference("steps", 9000, 9000)).toBe("rovnako");
    expect(difference("sleep_score", 78.4, 82)).toBe("−4 b.");
    expect(difference("energy_score", 80, 76)).toBe("+4 b.");
    expect(difference("steps", null, 9000)).toBeNull();
    expect(difference("active_kcal", 120, 0)).toBeNull();
  });
});

describe("calibration quality", () => {
  const calibration = makeCalibration({
    fitted_at: "2026-10-16T09:30:00+00:00",
    entries: 12,
    quality: {
      distance_km: { n: 10, error: 4.1, previous_error: 6.0, unit: "%" },
      active_minutes: { n: 9, error: 12.0, previous_error: 11.0, unit: "%" },
      total_kcal: { n: 1, error: 3, previous_error: null, unit: "%" },
      sleep_score: { n: 12, error: 5.5, previous_error: null, unit: "body" },
    },
  });

  it("formats the error with its unit", () => {
    expect(formatError(4.1, "%")).toBe(nb("± 4,1 %"));
    expect(formatError(5.5, "body")).toBe(nb("± 5,5 bodu"));
    expect(formatError(-2, "%")).toBe(nb("± 2,0 %"));
    expect(formatError(null, "%")).toBe("–");
  });

  it("lists the targets that have an error, in a fixed order, with the improvement", () => {
    const rows = qualityRows(calibration);
    expect(rows.map((row) => row.key)).toEqual(["distance_km", "active_minutes", "total_kcal", "sleep_score"]);
    expect(rows[0]).toEqual({
      key: "distance_km",
      label: "Vzdialenosť",
      error: nb("± 4,1 %"),
      basis: "na 10 dňoch",
      improved: true,
      previous: nb("± 6,0 %"),
    });
    expect(rows[1].improved).toBe(false);
    expect(rows[2]).toMatchObject({ basis: "na 1 dni", improved: false, previous: null });
    expect(rows[3].error).toBe(nb("± 5,5 bodu"));
    expect(qualityRows(null)).toEqual([]);
    expect(qualityRows(makeCalibration())).toEqual([]);
  });

  it("writes the note under one or several estimates", () => {
    expect(calibrationNote(calibration, [{ key: "distance_km" }])).toBe(nb("doladené podľa 12 zápisov · odchýlka ± 4,1 %"));
    expect(
      calibrationNote(calibration, [
        { key: "active_minutes", label: "aktívny čas" },
        { key: "active_kcal", label: "z aktivity" },
        { key: "total_kcal", label: "spolu" },
      ]),
    ).toBe(nb("doladené podľa 12 zápisov · odchýlka: aktívny čas ± 12,0 %, spolu ± 3,0 %"));
    expect(calibrationNote(calibration, [{ key: "active_kcal" }])).toBe("doladené podľa 12 zápisov");
    expect(calibrationNote(makeCalibration({ entries: 1 }), [{ key: "distance_km" }])).toBe("doladené podľa 1 zápisu");
  });

  it("says nothing before the first entry or without calibration", () => {
    expect(calibrationNote(makeCalibration(), [{ key: "distance_km" }])).toBeNull();
    expect(calibrationNote(null, [{ key: "distance_km" }])).toBeNull();
    expect(calibrationNote(undefined, [{ key: "distance_km" }])).toBeNull();
  });
});

describe("learning scores", () => {
  it("counts the entries still missing", () => {
    expect(isLearning(learning(6))).toBe(true);
    expect(learningGap(learning(6))).toBe(4);
    expect(learningGap(learning(12))).toBe(0);
    expect(learningGap(makeScore(null, {}, "learning"))).toBe(10);
    expect(learningGap(makeScore(80))).toBeNull();
    expect(learningGap(null)).toBeNull();
  });

  it("says it in Slovak", () => {
    expect(learningText(learning(9))).toBe("učí sa, chýba ešte 1 zápis");
    expect(learningText(learning(7))).toBe("učí sa, chýbajú ešte 3 zápisy");
    expect(learningText(learning(6))).toBe("učí sa, chýbajú ešte 4 zápisy");
    expect(learningText(learning(2))).toBe("učí sa, chýba ešte 8 zápisov");
    expect(learningText(learning(10))).toBe("učí sa");
    expect(learningText(makeScore(70))).toBeNull();
  });

  it("hides the counters from the parts while learning", () => {
    expect(scoreParts(learning(3))?.components).toEqual({});
    const scored = makeScore(80, { deep: 70 });
    expect(scoreParts(scored)).toBe(scored);
    expect(scoreParts(null)).toBeNull();
  });
});
