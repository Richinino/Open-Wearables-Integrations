import { describe, expect, it } from "vitest";

import { trendPaths } from "./paths";

describe("trendPaths", () => {
  it("spreads values over the width and maps low to the bottom", () => {
    const { line, area } = trendPaths([0, 50, 100], 200, 100, { low: 0, high: 100 });
    expect(line).toBe("M0,100L100,50L200,0");
    expect(area).toBe("M0,100L0,100L100,50L200,0L200,100Z");
  });

  it("keeps a margin above the highest value", () => {
    expect(trendPaths([0, 100], 10, 100, { low: 0, high: 100, topPad: 20 }).line).toBe("M0,100L10,20");
  });

  it("breaks the line at missing values and keeps lone points visible", () => {
    const { line, area } = trendPaths([10, null, 10, 10, null], 40, 10, { low: 0, high: 10 });
    expect(line).toBe("M0,0L0,0M20,0L30,0");
    expect(area.match(/Z/g)).toHaveLength(2);
  });

  it("draws nothing without values and survives a flat range", () => {
    expect(trendPaths([null, null], 10, 10, { low: 0, high: 1 })).toEqual({ line: "", area: "" });
    expect(trendPaths([5, 5], 10, 10, { low: 5, high: 5 }).line).toBe("M0,10L10,10");
  });
});
