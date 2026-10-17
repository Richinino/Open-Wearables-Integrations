import { describe, expect, it } from "vitest";

import {
  checkBody,
  checkDay,
  checkValue,
  ENTRY_FIELDS,
  hasEntry,
  inputText,
  isEmpty,
  parseInput,
  rangeText,
  type EntryFieldSpec,
} from "./entries";
import type { Entry, EntryField } from "./types";

const field = (key: EntryField): EntryFieldSpec => ENTRY_FIELDS.find((spec) => spec.key === key)!;
const NBSP = " ";

const FULL = {
  steps: 23588,
  distance_km: 17.9,
  active_minutes: 210,
  active_kcal: 980,
  total_kcal: 2610,
  sleep_score: 82,
  energy_score: 76,
};

describe("ENTRY_FIELDS", () => {
  it("lists the seven fields in form order with owi's ranges", () => {
    expect(ENTRY_FIELDS.map((spec) => spec.key)).toEqual([
      "steps",
      "distance_km",
      "active_minutes",
      "active_kcal",
      "total_kcal",
      "sleep_score",
      "energy_score",
    ]);
    expect(ENTRY_FIELDS.map((spec) => [spec.min, spec.max])).toEqual([
      [0, 100_000],
      [0, 150],
      [0, 1_440],
      [0, 10_000],
      [500, 15_000],
      [0, 100],
      [0, 100],
    ]);
    expect(ENTRY_FIELDS.filter((spec) => spec.integer).map((spec) => spec.key)).toEqual(["steps"]);
    expect(field("distance_km").inputMode).toBe("decimal");
    expect(field("steps").inputMode).toBe("numeric");
  });

  it("writes ranges the Slovak way", () => {
    expect(rangeText(field("steps"))).toBe(`0–100${NBSP}000`);
    expect(rangeText(field("total_kcal"))).toBe(`500–15${NBSP}000`);
    expect(rangeText(field("sleep_score"))).toBe("0–100");
  });
});

describe("checkValue", () => {
  it("accepts null and values inside the range, edges included", () => {
    expect(checkValue(null, field("steps"))).toBeNull();
    expect(checkValue(0, field("steps"))).toBeNull();
    expect(checkValue(100_000, field("steps"))).toBeNull();
    expect(checkValue(500, field("total_kcal"))).toBeNull();
    expect(checkValue(17.95, field("distance_km"))).toBeNull();
  });

  it("names the range for values outside it", () => {
    expect(checkValue(-1, field("steps"))).toBe(`0–100${NBSP}000`);
    expect(checkValue(100_001, field("steps"))).toBe(`0–100${NBSP}000`);
    expect(checkValue(150.01, field("distance_km"))).toBe("0–150");
    expect(checkValue(1_441, field("active_minutes"))).toBe(`0–1${NBSP}440`);
    expect(checkValue(10_001, field("active_kcal"))).toBe(`0–10${NBSP}000`);
    expect(checkValue(499, field("total_kcal"))).toBe(`500–15${NBSP}000`);
    expect(checkValue(15_001, field("total_kcal"))).toBe(`500–15${NBSP}000`);
    expect(checkValue(100.5, field("sleep_score"))).toBe("0–100");
    expect(checkValue(-0.5, field("energy_score"))).toBe("0–100");
  });

  it("wants whole steps and real numbers everywhere", () => {
    expect(checkValue(10.5, field("steps"))).toBe("celé číslo");
    for (const bad of ["82", true, {}, [], Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(checkValue(bad, field("sleep_score")), String(bad)).toBe("číslo");
    }
  });
});

describe("parseInput", () => {
  it("reads a Slovak decimal comma and a dot", () => {
    expect(parseInput("17,9", field("distance_km"))).toEqual({ ok: true, value: 17.9 });
    expect(parseInput("17.9", field("distance_km"))).toEqual({ ok: true, value: 17.9 });
    expect(parseInput(",5", field("distance_km"))).toEqual({ ok: true, value: 0.5 });
  });

  it("ignores spaces between thousands, also non-breaking ones", () => {
    expect(parseInput("23 588", field("steps"))).toEqual({ ok: true, value: 23588 });
    expect(parseInput(`23${NBSP}588`, field("steps"))).toEqual({ ok: true, value: 23588 });
    expect(parseInput(" 2 610 ", field("total_kcal"))).toEqual({ ok: true, value: 2610 });
  });

  it("reads dot or comma groups of three as thousands in the steps", () => {
    expect(parseInput("23.588", field("steps"))).toEqual({ ok: true, value: 23588 });
    expect(parseInput("1,234,567", field("steps"))).toEqual({ ok: false, message: `0–100${NBSP}000` });
    // In other fields a comma is always the decimal one.
    expect(parseInput("2,610", field("active_kcal"))).toEqual({ ok: true, value: 2.61 });
  });

  it("treats an empty field as not filled in", () => {
    expect(parseInput("", field("steps"))).toEqual({ ok: true, value: null });
    expect(parseInput("   ", field("sleep_score"))).toEqual({ ok: true, value: null });
  });

  it("explains what is wrong", () => {
    expect(parseInput("abc", field("steps"))).toEqual({ ok: false, message: "číslo" });
    expect(parseInput("12 km", field("distance_km"))).toEqual({ ok: false, message: "číslo" });
    expect(parseInput("1,2,3", field("distance_km"))).toEqual({ ok: false, message: "číslo" });
    expect(parseInput("10,5", field("steps"))).toEqual({ ok: false, message: "celé číslo" });
    expect(parseInput("101", field("sleep_score"))).toEqual({ ok: false, message: "0–100" });
    expect(parseInput("-3", field("sleep_score"))).toEqual({ ok: false, message: "0–100" });
    expect(parseInput("−3", field("sleep_score"))).toEqual({ ok: false, message: "0–100" });
    expect(parseInput("400", field("total_kcal"))).toEqual({ ok: false, message: `500–15${NBSP}000` });
  });
});

describe("inputText", () => {
  it("puts saved values back with a decimal comma and no grouping", () => {
    expect(inputText(23588, field("steps"))).toBe("23588");
    expect(inputText(17.9, field("distance_km"))).toBe("17,9");
    expect(inputText(7.3249, field("distance_km"))).toBe("7,32");
    expect(inputText(82, field("sleep_score"))).toBe("82");
    expect(inputText(null, field("sleep_score"))).toBe("");
  });

  it("round-trips through parseInput", () => {
    for (const spec of ENTRY_FIELDS) {
      const value = FULL[spec.key];
      expect(parseInput(inputText(value, spec), spec)).toEqual({ ok: true, value });
    }
  });
});

describe("checkBody", () => {
  it("passes the seven fields and fills missing ones with null", () => {
    expect(checkBody(FULL)).toEqual({ ok: true, values: FULL });
    const partial = checkBody({ steps: 9000, sleep_score: null });
    expect(partial).toEqual({
      ok: true,
      values: {
        steps: 9000,
        distance_km: null,
        active_minutes: null,
        active_kcal: null,
        total_kcal: null,
        sleep_score: null,
        energy_score: null,
      },
    });
  });

  it("drops unknown keys so only the seven fields travel on", () => {
    const checked = checkBody({ ...FULL, day: "2020-01-01", token: "x" });
    expect(checked).toEqual({ ok: true, values: FULL });
    // Inherited properties are not fields either.
    expect(checkBody(Object.create({ steps: 1 }))).toEqual(checkBody({}));
  });

  it("collects one message per bad field", () => {
    expect(checkBody({ ...FULL, steps: 1.5, sleep_score: 120, total_kcal: "2610" })).toEqual({
      ok: false,
      fields: { steps: "celé číslo", total_kcal: "číslo", sleep_score: "0–100" },
    });
  });

  it("refuses a body that is not an object", () => {
    for (const body of [undefined, null, [], "x", 42]) {
      expect(checkBody(body), JSON.stringify(body)).toEqual({ ok: false, fields: { body: "neplatné údaje" } });
    }
  });
});

describe("checkDay", () => {
  const bounds = { first: "2026-06-01", last: "2026-10-16" };

  it("accepts days inside the span, both ends included", () => {
    expect(checkDay("2026-06-01", bounds)).toBeNull();
    expect(checkDay("2026-10-16", bounds)).toBeNull();
    expect(checkDay("1999-01-01", { first: null, last: "2026-10-16" })).toBeNull();
  });

  it("refuses days outside it and strings that are not days", () => {
    expect(checkDay("2026-05-31", bounds)).toBe("mimo rozsahu");
    expect(checkDay("2026-10-17", bounds)).toBe("mimo rozsahu");
    for (const bad of ["2026-02-30", "16.10.2026", "2026-10-16T00:00", "", "..%2F"]) {
      expect(checkDay(bad, bounds), bad).toBe("neplatný dátum");
    }
  });
});

describe("hasEntry and isEmpty", () => {
  const entry = (values: Partial<Entry>): Entry => ({
    day: "2026-10-15",
    steps: null,
    distance_km: null,
    active_minutes: null,
    active_kcal: null,
    total_kcal: null,
    sleep_score: null,
    energy_score: null,
    saved_at: null,
    ...values,
  });

  it("counts an entry only when it holds a number", () => {
    expect(hasEntry(entry({ sleep_score: 0 }))).toBe(true);
    expect(hasEntry(entry({}))).toBe(false);
    expect(hasEntry(null)).toBe(false);
    expect(hasEntry(undefined)).toBe(false);
  });

  it("sees values without any number as empty", () => {
    expect(isEmpty(entry({}))).toBe(true);
    expect(isEmpty(entry({ steps: 0 }))).toBe(false);
  });
});
