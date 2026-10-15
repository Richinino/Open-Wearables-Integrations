// Which day a detail page is about: today when the source has it, otherwise the latest day
// with data before it (the source can be a sync behind).

import { todayIn } from "@/lib/dates";
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
