"use client";

import { Switch } from "@/components/detail/common/controls";
import { ROUTES } from "@/components/shell/nav";
import { TileShell, TileTitle } from "@/components/ui/tile";
import { addDays, weekdayIndex } from "@/lib/dates";
import { formatDuration, formatInt } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import type { Dataset, Day } from "@/lib/types";
import { useMemo, useState } from "react";

type Measure = "steps" | "sleep" | "active";

const MEASURES: { value: Measure; label: string }[] = [
  { value: "steps", label: "Kroky" },
  { value: "sleep", label: "Spánok" },
  { value: "active", label: "Aktívny čas" },
];

const LOOK: Record<Measure, { color: string; read: (day: Day | undefined) => number | null; show: (value: number) => string; noun: string }> = {
  steps: { color: "var(--accent)", read: (day) => day?.steps ?? null, show: (value) => `${formatInt(value)} krokov`, noun: "krokov" },
  sleep: { color: "var(--sleep)", read: (day) => day?.sleep_minutes ?? null, show: (value) => formatDuration(value), noun: "spánku" },
  active: { color: "var(--accent)", read: (day) => day?.active_minutes_est ?? null, show: (value) => formatDuration(value), noun: "aktívneho času" },
};

const WEEKDAYS = ["po", "ut", "st", "št", "pi", "so", "ne"];
const WEEKDAY_NAMES = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"];

/**
 * This week next to the last one, day by day: solid bars are this week, dashed outlines
 * the same weekday a week earlier. A day still running is hatched. Switching the measure
 * rescales the same bars instead of drawing new ones.
 */
export function WeekCompareTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const [measure, setMeasure] = useState<Measure>("steps");
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);
  const monday = addDays(date, -weekdayIndex(date));
  const look = LOOK[measure];
  const days = WEEKDAYS.map((_, index) => {
    const current = addDays(monday, index);
    const before = addDays(current, -7);
    const day = current <= date ? byDay.get(current) : undefined;
    return {
      current,
      now: current <= date ? look.read(day) : null,
      running: day?.complete === false,
      then: look.read(byDay.get(before)),
    };
  });
  const top = Math.max(1, ...days.flatMap((item) => [item.now ?? 0, item.then ?? 0]));

  // Compare like with like: the days of this week so far against the same weekdays before.
  const pairs = days.filter((item) => item.now !== null && item.then !== null && !item.running);
  const nowSum = pairs.reduce((sum, item) => sum + (item.now ?? 0), 0);
  const thenSum = pairs.reduce((sum, item) => sum + (item.then ?? 0), 0);
  const note =
    pairs.length === 0
      ? "Tento týždeň ešte nie je s čím porovnať."
      : `${pairs.length === 1 ? capitalize(WEEKDAY_NAMES[weekdayIndex(pairs[0].current)]) : `Za ${pairs.length} ${pairs.length < 5 ? "ukončené dni" : "ukončených dní"}`}: ${look.show(nowSum)}, minulý týždeň ${look.show(thenSum)}.`;

  const label = days
    .map((item, index) => `${WEEKDAY_NAMES[index]}: ${item.now === null ? "bez dát" : look.show(item.now)}, týždeň predtým ${item.then === null ? "bez dát" : look.show(item.then)}`)
    .join("; ");

  return (
    <TileShell className="gap-4 p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TileTitle href={ROUTES.calendar} stretch={false}>
          Tento týždeň oproti minulému
        </TileTitle>
        <Switch options={MEASURES} value={measure} onChange={setMeasure} label="Údaj na porovnanie" className="tile-raise" />
      </div>
      <div className="grid h-[150px] grid-cols-7 items-end gap-2.5 sm:gap-4" role="img" aria-label={label}>
        {days.map((item) => (
          <div key={item.current} className="relative flex h-full items-end justify-center">
            <span
              aria-hidden="true"
              className="bar-y absolute bottom-0 left-[14%] h-full w-[72%] rounded-t-[6px] rounded-b-[2px] border-[1.5px] border-dashed border-line-strong"
              style={{ transform: `scaleY(${item.then === null ? 0 : Math.max(0.02, item.then / top)})` }}
            />
            <span
              aria-hidden="true"
              className="bar-y relative h-full w-[46%] rounded-t-[6px] rounded-b-[2px]"
              style={{
                transform: `scaleY(${item.now === null ? 0 : Math.max(0.02, item.now / top)})`,
                backgroundColor: look.color,
                backgroundImage: item.running
                  ? "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklab, var(--bg) 55%, transparent) 4px 7px)"
                  : undefined,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mono grid grid-cols-7 gap-2.5 text-center text-[11px] text-muted sm:gap-4" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <p className="text-[14px] text-ink2">{note}</p>
    </TileShell>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
