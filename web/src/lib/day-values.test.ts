import { describe, expect, it } from "vitest";
import { dayFigure, dayValue, dayValueSource, periodHasEstimate, periodFigure } from "./day-values";
import { periodSummary } from "./metrics";
import { formatInt } from "./format";
import type { Day } from "./types";

const legacy = { distance_m_est: 900, activity_kcal_est: 100, total_kcal_est: 1900 } as Day;
describe("device value provenance", () => {
  it("uses a selected device value while preserving the original calibration estimate", () => {
    const day = { ...legacy, distance_m: 1200, distance_m_source: "measured" as const };
    expect(dayValue(day, "distance")).toBe(1200);
    expect(dayFigure(day, "distance", formatInt)).not.toContain("≈");
    expect(day.distance_m_est).toBe(900);
  });
  it("does not substitute an estimate for explicit missing device-selection output", () => {
    expect(dayValue({ ...legacy, distance_m: null }, "distance")).toBeNull();
    expect(dayValueSource({ ...legacy, distance_m: null }, "distance")).toBeNull();
  });
  it("supports legacy payloads and marks their inferred figures", () => {
    expect(dayValue(legacy, "distance")).toBe(900);
    expect(dayFigure(legacy, "distance", formatInt)).toContain("≈");
    expect(dayFigure(undefined, "distance", formatInt)).not.toContain("≈");
  });
  it("keeps measured zero and distinguishes exact sums from estimates", () => {
    const day = { ...legacy, active_kcal: 0, active_kcal_source: "measured" as const,
      total_kcal: 1800, total_kcal_source: "derived" as const };
    expect(dayValue(day, "activeEnergy")).toBe(0);
    expect(dayValueSource(day, "totalEnergy")).toBe("derived");
    expect(periodHasEstimate([day], "totalEnergy")).toBe(false);
    expect(periodHasEstimate([day, legacy], "totalEnergy")).toBe(true);
  });
  it("uses selected values in period summaries without changing calibration estimates", () => {
    const days = [
      { ...legacy, day: "2026-01-01", complete: true, distance_m: 1200, distance_m_source: "measured" as const },
      { ...legacy, day: "2026-01-02", complete: true, distance_m: 1800, distance_m_source: "derived" as const },
    ];
    const result = periodSummary(days, "2026-01-02", 2, "distance_m");
    expect(result.average).toBe(1500);
    expect(periodSummary(days, "2026-01-02", 2, "distance_m_est").average).toBe(900);
    expect(periodFigure(days, "2026-01-02", 2, "distance", result.average, formatInt)).not.toContain("≈");
  });
});
