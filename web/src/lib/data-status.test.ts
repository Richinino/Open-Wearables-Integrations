import { describe, expect, it } from "vitest";
import { dataStatus } from "./data-status";
import type { Dataset } from "./types";

const now = new Date("2026-10-19T10:00:00Z");
const dataset: Dataset = {
  timezone: "Europe/Bratislava", first_day: null, last_day: null, days: [],
  synced_at: "2026-10-19T09:59:00Z",
  last_compute_success_at: "2026-10-19T09:59:00Z",
  latest_measurement_at: "2026-10-17T09:59:00Z",
};

describe("data availability", () => {
  it("does not mistake a fresh recomputation of old data for fresh measurements", () => {
    expect(dataStatus(dataset, now).title).toBe("Chýbajú nové merania zo zariadení.");
  });
  it("reports a failed fetch immediately even when cached results were recent", () => {
    expect(dataStatus({ ...dataset, latest_measurement_at: dataset.synced_at }, now, true).title)
      .toBe("Spojenie so zdrojom zlyhalo.");
  });
  it("distinguishes stalled computation from missing measurements", () => {
    expect(dataStatus({ ...dataset, last_compute_success_at: "2026-10-17T10:00:00Z" }, now).title)
      .toBe("Prepočet dát sa dlhšie neozval.");
  });
});
