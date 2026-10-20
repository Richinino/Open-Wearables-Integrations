import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestingTile } from "@/components/overview/today-tiles";
import { HeartTile } from "@/components/detail/day/day-tiles";
import { dataTypeLabel } from "@/components/admin/helpers";
import { dayValue } from "./day-values";
import { restingBaseline, restingTrend } from "./detail-heart";
import { weeklyMeans } from "./detail-longterm";
import { heatValue, records } from "./overview";
import { hasData, periodAverages } from "./calendar";
import { series } from "./metrics";
import { addDays, dateRange } from "./dates";
import { makeDay } from "./test-fixtures";
import type { Dataset } from "./types";

const END = "2026-10-15";
const appleDay = makeDay(END, { resting_hr: 63, resting_hr_source: "measured", hr_resting: null });
const dataset: Dataset = { timezone: "Europe/Bratislava", first_day: END, last_day: END, synced_at: null, days: [appleDay] };

describe("device-first resting heart rate across the UI", () => {
  it("renders an Apple-only RHR in overview and day tiles without an approximation sign", () => {
    const overview = renderToStaticMarkup(createElement(RestingTile, { dataset, day: appleDay, date: END, isToday: true }));
    const detail = renderToStaticMarkup(createElement(HeartTile, { day: appleDay }));
    for (const html of [overview, detail]) { expect(html).toContain(">63<"); expect(html).not.toMatch(/≈\s*63/); }
  });
  it("prefers the device number over the old rolling number and labels actual estimates", () => {
    const measured = { ...appleDay, hr_resting: 49 };
    const html = renderToStaticMarkup(createElement(HeartTile, { day: measured }));
    expect(html).toContain(">63<"); expect(html).not.toContain(">49<");
    expect(renderToStaticMarkup(createElement(HeartTile, { day: { ...measured, resting_hr_source: "estimated" } }))).toMatch(/≈\s*63/);
  });
  it("includes Apple-only data in calendar summaries, heatmap, records and numeric history", () => {
    expect(hasData(appleDay)).toBe(true);
    expect(periodAverages([appleDay], END, END, END).restingHr).toBe(63);
    expect(heatValue(appleDay, "resting")).toBe(63);
    expect(records([appleDay], END).find((item) => item.key === "resting")?.value).toBe(63);
    expect(series([{ day: END, data: appleDay }], "resting_hr")[0].value).toBe(63);
  });
  it("uses selected measured values consistently for baselines and weekly/monthly trends", () => {
    const days = dateRange(addDays(END, -40), END).map((date) => makeDay(date, { resting_hr: date > addDays(END, -7) ? 60 : 64, resting_hr_source: "measured", hr_resting: 49 }));
    expect(restingBaseline(days, END)).toMatchObject({ days: 40 });
    expect(restingBaseline(days, END)?.mean).toBeGreaterThan(60);
    expect(restingTrend(days, END, 30)).toEqual({ recent: 60, before: 64, change: -4 });
    const weeks = weeklyMeans(days, END, (day) => dayValue(day, "restingHr"));
    expect(weeks.every((week) => week.value === null || week.value >= 60)).toBe(true);
  });
  it("keeps derived rolling RHR when a measured field is null without changing score inputs", () => {
    const derived = { ...appleDay, resting_hr: null, resting_hr_source: null, hr_resting: 51 };
    expect(periodAverages([derived], END, END, END).restingHr).toBe(51);
    expect(renderToStaticMarkup(createElement(HeartTile, { day: derived }))).toContain(">51<");
    expect(derived.hr_resting).toBe(51);
  });
  it("uses Slovak names for Apple energy and distinct HRV measurement types", () => {
    expect(dataTypeLabel("active_energy")).toBe("Aktívna energia");
    expect(dataTypeLabel("heart_rate_variability_sdnn")).toBe("HRV · SDNN");
    expect(dataTypeLabel("heart_rate_variability_rmssd")).toBe("HRV · RMSSD");
  });
});
