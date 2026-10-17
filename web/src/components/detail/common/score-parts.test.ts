import { describe, expect, it } from "vitest";

import { makeScore } from "@/lib/test-fixtures";
import { partRows, partTone, presentPartRows } from "./score-parts";

describe("partRows", () => {
  const specs = [
    { key: "duration", max: 50, explain: "dĺžka" },
    { key: "bedtime", max: 30, explain: "čas", weight: 0.3 },
  ];

  it("keeps the documented order, scales to the part's maximum and adds unknown parts last", () => {
    const rows = partRows(makeScore(80, { bedtime: 15, duration: 50, zzz_new: 40 }), specs);
    expect(rows.map((row) => row.key)).toEqual(["duration", "bedtime", "zzz_new"]);
    expect(rows[0]).toMatchObject({ label: "Dĺžka", value: 50, share: 1, tone: "optimal", weight: null });
    expect(rows[1]).toMatchObject({ label: "Čas zaspatia", share: 0.5, tone: "attention", weight: 0.3 });
    expect(rows[2]).toMatchObject({ label: "Zzz new", max: 100, explain: null });
  });

  it("shows a missing part as null, not zero", () => {
    const rows = partRows(makeScore(null, { duration: null }), specs);
    expect(rows[0]).toMatchObject({ value: null, share: null, tone: null });
    expect(rows[1].value).toBeNull();
    expect(partRows(null, specs)).toHaveLength(2);
  });
});

describe("presentPartRows", () => {
  it("drops listed parts the score lacks but keeps its own extra parts", () => {
    const specs = [
      { key: "deep", max: 100, explain: "hlboký" },
      { key: "deep_sleep", max: 100, explain: "hlboký" },
      { key: "rem", max: 100, explain: "REM" },
    ];
    const rows = presentPartRows(makeScore(80, { rem: 60, deep_sleep: 90, latency: 70 }), specs);
    expect(rows.map((row) => row.key)).toEqual(["deep_sleep", "rem", "latency"]);
    expect(rows[0].explain).toBe("hlboký");
    expect(presentPartRows(null, specs)).toEqual([]);
  });
});

describe("partTone", () => {
  it("uses Oura's contributor limits", () => {
    expect(partTone(0.85)).toBe("optimal");
    expect(partTone(0.849)).toBe("optimal");
    expect(partTone(0.7)).toBe("good");
    expect(partTone(0.69)).toBe("attention");
    expect(partTone(null)).toBeNull();
  });
});
