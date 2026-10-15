import { describe, expect, it } from "vitest";

import { makeDay, ZONE } from "@/lib/test-fixtures";
import type { Dataset, Day } from "@/lib/types";
import { focusOf, latestFocusOf } from "./focus";

// Noon of 15 Oct in Bratislava.
const NOW = new Date("2026-10-15T10:00:00Z");

function dataset(days: Day[]): Dataset {
  return { timezone: ZONE, first_day: days[0]?.day ?? null, last_day: days.at(-1)?.day ?? null, synced_at: null, days };
}

describe("latestFocusOf", () => {
  it("keeps today once it has data of its own", () => {
    const data = dataset([makeDay("2026-10-14", { steps: 9000 }), makeDay("2026-10-15", { steps: 120, complete: false })]);

    const focus = latestFocusOf(data, NOW);

    expect(focus).toMatchObject({ date: "2026-10-15", isToday: true, label: null });
  });

  it("shows the latest day with data while today is an empty shell", () => {
    const data = dataset([makeDay("2026-10-14", { steps: 9000 }), makeDay("2026-10-15", { complete: false })]);

    const focus = latestFocusOf(data, NOW);

    expect(focus).toMatchObject({ today: "2026-10-15", date: "2026-10-14", isToday: false, label: "posledné dáta: včera" });
    expect(focus.day?.steps).toBe(9000);
    expect(focusOf(data, NOW).date).toBe("2026-10-15");
  });
});
