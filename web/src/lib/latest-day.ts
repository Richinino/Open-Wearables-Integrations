// Which day the "today" tiles of the overview show. Right after midnight, or while the watch
// has not synced yet, today exists only as an empty shell: no steps and no sleep. The tiles
// then show the latest day that has data, with a small label saying how old it is, instead
// of a row of dashes. Once today has anything of its own, its partial values win.

import { diffDays } from "./dates";
import { formatDay } from "./format";
import type { Day } from "./types";
import { dayValue, dayValueSource } from "./day-values";

function isPositive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** A device RHR is a real observation too; a carried rolling fallback alone is not. */
export function hasDayData(day: Day | null | undefined): boolean {
  if (!day) return false;
  return isPositive(day.steps) || isPositive(day.sleep_minutes) || (day.workouts?.length ?? 0) > 0 || (dayValueSource(day, "restingHr") === "measured" && isPositive(dayValue(day, "restingHr")));
}

export interface LatestDay {
  /** The day the tiles show; null when nothing up to `focus` has data. */
  day: Day | null;
  /** Its date; `focus` when there is no day to show. */
  date: string;
  /** True when the tiles show an older day than `focus`. */
  fallback: boolean;
  /** "posledné dáta: včera" when falling back, else null. */
  label: string | null;
}

/** How old the shown day is, as a short label: "včera", "predvčerom" or "po 12. 10.". */
export function ageLabel(date: string, today: string): string {
  const days = diffDays(date, today);
  if (days === 0) return "dnes";
  if (days === 1) return "včera";
  if (days === 2) return "predvčerom";
  return formatDay(date);
}

/**
 * The day for the today tiles: `focus` when it has data of its own (even partial), otherwise
 * the latest earlier day that has data. `today` only words the label.
 */
export function latestDay(days: Day[], focus: string, today: string): LatestDay {
  let own: Day | null = null;
  for (let index = days.length - 1; index >= 0; index--) {
    const day = days[index];
    if (day.day > focus) continue;
    if (day.day === focus) {
      own = day;
      if (hasDayData(day)) return { day, date: focus, fallback: false, label: null };
      continue;
    }
    if (hasDayData(day)) {
      return { day, date: day.day, fallback: true, label: `posledné dáta: ${ageLabel(day.day, today)}` };
    }
  }
  return { day: own, date: focus, fallback: false, label: null };
}
