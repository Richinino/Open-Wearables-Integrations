// Which day a detail page is about: today when the source has it, otherwise the latest day
// with data before it (the source can be a sync behind).

import { todayIn } from "@/lib/dates";
import { latestDay } from "@/lib/latest-day";
import { indexByDay } from "@/lib/metrics";
import type { Dataset, Day } from "@/lib/types";

export interface Focus {
  today: string;
  date: string;
  day: Day | null;
  isToday: boolean;
}

export function focusOf(dataset: Dataset, now: Date): Focus {
  const today = todayIn(dataset.timezone, now);
  const byDay = indexByDay(dataset.days);
  const date = byDay.has(today)
    ? today
    : ([...dataset.days].reverse().find((item) => item.day <= today)?.day ?? dataset.last_day ?? today);
  return { today, date, day: byDay.get(date) ?? null, isToday: date === today };
}

/**
 * Like focusOf, but while the focus day is an empty shell (no steps, sleep or workout yet),
 * the latest earlier day with data, as on the overview, with a label saying how old it is.
 */
export function latestFocusOf(dataset: Dataset, now: Date): Focus & { label: string | null } {
  const focus = focusOf(dataset, now);
  const shown = latestDay(dataset.days, focus.date, focus.today);
  return { today: focus.today, date: shown.date, day: shown.day, isToday: shown.date === focus.today, label: shown.label };
}
