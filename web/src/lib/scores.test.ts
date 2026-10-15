import { describe, expect, it } from "vitest";

import { DASH } from "./format";
import {
  activityBand,
  appleSleepBand,
  bedtimeFor,
  cardioStatusLabel,
  componentExtremes,
  componentLabel,
  dayScoreLabel,
  eveningSummary,
  formatScore,
  formatStrain,
  isEstimate,
  morningSummary,
  nightSignalAlert,
  noteText,
  readinessBand,
  resolveMode,
  sleepPerformanceBand,
  strainBand,
  subScores,
  typicalWake,
} from "./scores";
import { makeDay, makeScore, makeScores, makeWorkout, ZONE } from "./test-fixtures";

// Spaces inside numbers are whatever Intl prints for Slovak; compare without them.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("strainBand", () => {
  it("follows WHOOP's four bands", () => {
    expect(strainBand(0)?.key).toBe("light");
    expect(strainBand(9.9)?.key).toBe("light");
    expect(strainBand(10)?.key).toBe("moderate");
    expect(strainBand(13.9)?.key).toBe("moderate");
    expect(strainBand(14)?.key).toBe("high");
    expect(strainBand(17.9)?.key).toBe("high");
    expect(strainBand(18)?.key).toBe("max");
    expect(strainBand(21)?.label).toBe("maximálna záťaž");
  });

  it("has no band without a value", () => {
    expect(strainBand(null)).toBeNull();
    expect(strainBand(undefined)).toBeNull();
    expect(strainBand(Number.NaN)).toBeNull();
  });
});

describe("score bands", () => {
  it("cuts readiness at 85, 70 and 60", () => {
    expect([90, 85, 84.9, 70, 69, 60, 59.9].map((v) => readinessBand(v)?.key)).toEqual([
      "optimal",
      "optimal",
      "good",
      "good",
      "fair",
      "fair",
      "low",
    ]);
  });

  it("cuts Sleep Performance at 85 and 70", () => {
    expect([100, 85, 84, 70, 69].map((v) => sleepPerformanceBand(v)?.label)).toEqual([
      "optimálny",
      "optimálny",
      "dostačujúci",
      "dostačujúci",
      "slabý",
    ]);
  });

  it("cuts the Apple score at 96, 81, 61 and 41 on whole points", () => {
    expect([100, 96, 95, 81, 80.6, 61, 60, 41, 40].map((v) => appleSleepBand(v)?.key)).toEqual([
      "very_high",
      "very_high",
      "high",
      "high",
      "high",
      "ok",
      "low",
      "low",
      "very_low",
    ]);
  });

  it("cuts activity at 85 and 70", () => {
    expect([85, 70, 69.9].map((v) => activityBand(v)?.key)).toEqual(["optimal", "good", "low"]);
    expect(activityBand(null)).toBeNull();
  });

  it("names the day", () => {
    expect(dayScoreLabel(92)).toBe("výborný deň");
    expect(dayScoreLabel(78)).toBe("dobrý deň");
    expect(dayScoreLabel(64)).toBe("priemerný deň");
    expect(dayScoreLabel(40)).toBe("slabší deň");
    expect(dayScoreLabel(null)).toBe("skóre zatiaľ nie je");
  });

  it("names the cardio load status", () => {
    expect(cardioStatusLabel("productive")).toBe("produktívna záťaž");
    expect(cardioStatusLabel("overreaching")).toBe("preťaženie");
    expect(cardioStatusLabel(null)).toBe(DASH);
  });
});

describe("formatting scores", () => {
  it("rounds to whole points and marks estimates", () => {
    expect(formatScore(makeScore(81.4))).toBe("81");
    expect(formatScore(makeScore(81.6, {}, "estimate"))).toBe("≈ 82");
    expect(formatScore(makeScore(70, {}, "estimate; without sleep"))).toBe("≈ 70");
    expect(formatScore(makeScore(null, {}, "estimate"))).toBe(DASH);
    expect(formatScore(null)).toBe(DASH);
    expect(isEstimate(makeScore(5, {}, "without estimate_x"))).toBe(false);
  });

  it("keeps one decimal of strain", () => {
    expect(formatStrain(13.42)).toBe("13,4");
    expect(formatStrain(4)).toBe("4,0");
    expect(formatStrain(null)).toBe(DASH);
  });

  it("translates owi's notes and component names", () => {
    expect(noteText("estimate")).toBe("odhad");
    expect(noteText("too little history")).toBe("zatiaľ málo dát");
    expect(noteText("without stay_active, move_every_hour")).toBe("bez: menej sedenia, pohyb každú hodinu");
    expect(noteText("no sleep stages, no stage deductions; without bedtime")).toBe(
      "bez fáz spánku; bez: čas zaspatia",
    );
    expect(noteText("something new")).toBe("something new");
    expect(noteText(null)).toBeNull();
    expect(componentLabel("unknown_part")).toBe("unknown part");
    expect(componentLabel("constructor")).toBe("constructor");
  });
});

describe("resolveMode", () => {
  // Bratislava is two hours ahead of UTC in October 2026.
  it("is morning from 04:00 to 14:59 and evening from 15:00", () => {
    expect(resolveMode(new Date("2026-10-15T02:00:00Z"), ZONE)).toEqual({ mode: "morning", day: "2026-10-15" });
    expect(resolveMode(new Date("2026-10-15T12:59:00Z"), ZONE)).toEqual({ mode: "morning", day: "2026-10-15" });
    expect(resolveMode(new Date("2026-10-15T13:00:00Z"), ZONE)).toEqual({ mode: "evening", day: "2026-10-15" });
    expect(resolveMode(new Date("2026-10-15T21:59:00Z"), ZONE)).toEqual({ mode: "evening", day: "2026-10-15" });
  });

  it("keeps the evening of the day before until 04:00", () => {
    expect(resolveMode(new Date("2026-10-15T22:30:00Z"), ZONE)).toEqual({ mode: "evening", day: "2026-10-15" });
    expect(resolveMode(new Date("2026-10-16T01:59:00Z"), ZONE)).toEqual({ mode: "evening", day: "2026-10-15" });
  });

  it("can be forced with rano or vecer", () => {
    const morning = new Date("2026-10-15T06:00:00Z");
    expect(resolveMode(morning, ZONE, "vecer")).toEqual({ mode: "evening", day: "2026-10-15" });
    expect(resolveMode(morning, ZONE, "rano")).toEqual({ mode: "morning", day: "2026-10-15" });
    expect(resolveMode(morning, ZONE, "nonsense")).toEqual({ mode: "morning", day: "2026-10-15" });
    // At night a forced morning is about the new day.
    expect(resolveMode(new Date("2026-10-16T00:30:00Z"), ZONE, "rano")).toEqual({ mode: "morning", day: "2026-10-16" });
    expect(resolveMode(new Date("2026-10-16T00:30:00Z"), ZONE, "vecer")).toEqual({ mode: "evening", day: "2026-10-15" });
  });
});

describe("nightSignalAlert", () => {
  it("stays quiet for green, missing or unknown levels", () => {
    expect(nightSignalAlert({ level: "green", night_hr: 58, baseline: 58, delta: 0 })).toBeNull();
    expect(nightSignalAlert({ level: null, night_hr: null, baseline: null, delta: null })).toBeNull();
    expect(nightSignalAlert(null)).toBeNull();
  });

  it("words yellow and red plainly, with the numbers", () => {
    const yellow = nightSignalAlert({ level: "yellow", night_hr: 62.4, baseline: 59.1, delta: 3.3 });
    expect(yellow?.level).toBe("yellow");
    expect(yellow?.text).toContain("o 3 bpm");
    expect(yellow?.text).toContain("bežne okolo 59 bpm");

    const red = nightSignalAlert({ level: "red", night_hr: 64, baseline: 59, delta: 5 });
    expect(red?.level).toBe("red");
    expect(red?.title).toContain("druhú noc po sebe");
    expect(red?.text).toContain("o 5 bpm");
    expect(red?.text).toContain("nie diagnóza");
  });

  it("copes without numbers", () => {
    expect(nightSignalAlert({ level: "red", night_hr: null, baseline: null, delta: null })?.text).toContain("citeľne");
  });
});

describe("componentExtremes", () => {
  it("finds the lowest and highest present component", () => {
    const score = makeScore(70, { sleep: 90, resting_hr: 40, sleep_balance: null, recovery_index: 95 });
    expect(componentExtremes(score)).toEqual({ weakest: ["resting_hr", 40], strongest: ["recovery_index", 95] });
    expect(componentExtremes(makeScore(null, { sleep: null }))).toEqual({ weakest: null, strongest: null });
    expect(componentExtremes(null)).toEqual({ weakest: null, strongest: null });
  });
});

describe("subScores", () => {
  const previous = makeDay("2026-10-14", { scores: makeScores("2026-10-14", { sleep_need_minutes: 500 }) });

  it("gives each sub-score a value, a band and a reason from its parts", () => {
    const day = makeDay("2026-10-15", {
      hr_resting: 51,
      steps: 6480,
      sleep_minutes: 456,
      workouts: [makeWorkout("w", { type: "running", duration_s: 55 * 60 })],
      scores: makeScores("2026-10-15", {
        readiness: makeScore(81.2, { resting_hr: 98, sleep: 80, sleep_balance: 52 }, "estimate"),
        sleep_performance: makeScore(86, { hours_vs_needed: 91 }),
        activity: makeScore(64, { stay_active: 40 }),
      }),
    });
    const [readiness, sleep, activity] = subScores(day, previous);
    expect(readiness).toMatchObject({ key: "readiness", label: "Readiness", value: 81.2, display: "≈ 81" });
    expect(readiness.band?.key).toBe("good");
    expect(readiness.reason).toBe("pokojový tep 51, pod tvojím priemerom · brzdí spánková bilancia");
    expect(sleep.label).toBe("Sleep Performance");
    expect(sleep.reason).toBe("7 h 36 min z potrebných 8 h 20 min");
    expect(activity.label).toBe("Activity");
    expect(plain(activity.reason)).toBe("6 480 krokov · beh 55 min");
  });

  it("says when the need was covered and names the weakest activity part without a workout", () => {
    const day = makeDay("2026-10-15", {
      hr_resting: 58,
      steps: 3000,
      sleep_minutes: 520,
      scores: makeScores("2026-10-15", {
        readiness: makeScore(60, { resting_hr: 50, sleep: 90 }, "estimate"),
        sleep_performance: makeScore(100, {}),
        activity: makeScore(50, { stay_active: 40, training_volume: 70 }),
      }),
    });
    const [readiness, sleep, activity] = subScores(day, previous);
    expect(readiness.reason).toBe("pokojový tep 58, nad tvojím priemerom");
    expect(sleep.reason).toBe("8 h 40 min, potreba spánku pokrytá");
    expect(plain(activity.reason)).toBe("3 000 krokov · slabšie: menej sedenia");
  });

  it("explains missing scores with owi's note", () => {
    const day = makeDay("2026-10-15", {
      scores: makeScores("2026-10-15", {
        readiness: makeScore(null, {}, "too little history"),
        sleep_performance: makeScore(null, {}, "no sleep recorded"),
        activity: makeScore(null, {}, null),
      }),
    });
    const [readiness, sleep, activity] = subScores(day, null);
    expect(readiness).toMatchObject({ value: null, display: DASH, band: null, reason: "zatiaľ málo dát" });
    expect(sleep.reason).toBe("spánok sa nezaznamenal");
    expect(activity.reason).toBe("zatiaľ sa nedá spočítať");
  });

  it("works on a day the API has not scored yet", () => {
    const result = subScores(makeDay("2026-10-15"), null);
    expect(result.map((item) => item.display)).toEqual([DASH, DASH, DASH]);
  });
});

describe("typicalWake and bedtimeFor", () => {
  // Wake-ups at 06:40 local on school days and 08:30 on weekends, in UTC+2.
  const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map(
    (day, index) =>
      makeDay(day, {
        sleep_start: `${day}T00:00:00+00:00`,
        sleep_end: index >= 5 ? `${day}T06:30:00+00:00` : `${day}T04:${index === 2 ? "50" : "40"}:00+00:00`,
      }),
  );

  it("takes the median wake-up of the same kind of day", () => {
    expect(typicalWake(days, ZONE, "2026-10-12")).toBe(6 * 60 + 40);
    expect(typicalWake(days, ZONE, "2026-10-17")).toBe(8 * 60 + 30);
    expect(typicalWake([], ZONE, "2026-10-12")).toBeNull();
  });

  it("counts back the need and a short time to fall asleep, on five minutes", () => {
    expect(bedtimeFor(520, 6 * 60 + 40)).toBe(21 * 60 + 45);
    expect(bedtimeFor(480, 5 * 60)).toBe(20 * 60 + 45);
    expect(bedtimeFor(null, 400)).toBeNull();
    expect(bedtimeFor(500, null)).toBeNull();
  });
});

describe("summaries", () => {
  const good = makeScores("2026-10-15", {
    readiness: makeScore(88),
    sleep_performance: makeScore(90),
    strain: 13.4,
    sleep_need_minutes: 520,
  });

  it("reads the morning from readiness and sleep", () => {
    expect(morningSummary(good)).toContain("oddýchnuté");
    expect(morningSummary({ ...good, sleep_performance: makeScore(60) })).toContain("Spal si menej");
    expect(morningSummary({ ...good, readiness: makeScore(65) })).toContain("zotavuje");
    expect(morningSummary({ ...good, readiness: makeScore(75), sleep_performance: makeScore(80) })).toContain("v poriadku");
    expect(
      morningSummary({ ...good, night_signal: { level: "red", night_hr: 64, baseline: 59, delta: 5 } }),
    ).toContain("Nočný tep");
    expect(morningSummary({ ...good, readiness: makeScore(null), sleep_performance: makeScore(null) })).toContain("chýbajú");
    expect(morningSummary(null)).toContain("ešte nie je");
  });

  it("reads the evening from strain and sleep need", () => {
    expect(eveningSummary(good, 22 * 60 + 5)).toBe(
      "Dnešný strain je 13,4, stredná záťaž. Na dnešnú noc potrebuješ asi 8 h 40 min spánku, takže je dobré zaspať okolo 22:05.",
    );
    expect(eveningSummary({ ...good, strain: null }, null)).toBe("Na dnešnú noc potrebuješ asi 8 h 40 min spánku.");
    expect(eveningSummary(makeScores("2026-10-15"), null)).toContain("chýbajú");
  });
});
