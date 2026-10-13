import { formatDay, formatDayMonth, formatDecimal, formatInt } from "@/lib/format";
import type { DaySlot } from "@/lib/metrics";
import type { Day } from "@/lib/types";
import type { ChartPoint } from "./charts";

/** Chart points for a run of days. A day that is still running is marked partial. */
export function dayPoints(
  slots: DaySlot[],
  pick: (day: Day) => number | null,
  options: { partial?: boolean } = {},
): ChartPoint[] {
  const { partial = true } = options;
  return slots.map(({ day, data }) => ({
    key: day,
    label: formatDayMonth(day),
    title: formatDay(day),
    value: data ? pick(data) : null,
    partial: partial && data?.complete === false,
  }));
}

/** Table twin of a chart: newest first, one formatted value per column. */
export function dayRows(slots: DaySlot[], cells: (day: Day) => string[]): string[][] {
  return slots
    .filter((slot) => slot.data)
    .map((slot) => [formatDay(slot.day), ...cells(slot.data as Day)])
    .reverse();
}

export function tickCompact(value: number): string {
  if (Math.abs(value) < 1000) return formatInt(value);
  return `${formatDecimal(value / 1000, value % 1000 === 0 ? 0 : 1)} tis.`;
}

export function tickDuration(minutes: number): string {
  if (minutes === 0) return "0";
  if (minutes < 60) return `${minutes} min`;
  return `${formatDecimal(minutes / 60, minutes % 60 === 0 ? 0 : 1)} h`;
}

export function tickPlain(value: number): string {
  return formatInt(value);
}
