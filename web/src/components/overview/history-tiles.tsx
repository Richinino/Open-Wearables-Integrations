"use client";

import Link from "next/link";
import { useState } from "react";
import { ROUTES } from "@/components/shell/nav";
import { mix, Ring, Tile, TileShell, TileTitle, ZoneBar } from "@/components/ui/tile";
import { addDays, weekdayIndex } from "@/lib/dates";
import {
  approx,
  DASH,
  formatClock,
  formatDay,
  formatDayMonth,
  formatDuration,
  formatDurationCompact,
  formatDurationShort,
  formatInt,
  formatKcal,
  formatMonth,
  plural,
  workoutLabel,
} from "@/lib/format";
import { allWorkouts, workoutTotals } from "@/lib/metrics";
import {
  HEAT_METRICS,
  heatmap,
  heatmapNote,
  records,
  WEEKDAY_LETTERS,
  weekCards,
  type HeatMetric,
  type RecordItem,
} from "@/lib/overview";
import { formatStrain } from "@/lib/scores";
import type { Dataset } from "@/lib/types";

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------------------

/** The last seven days as small cards, each a link to its day. */
export function WeekTile({ dataset, date, isToday }: { dataset: Dataset; date: string; isToday: boolean }) {
  const cards = weekCards(dataset.days, date);
  return (
    <TileShell className="gap-[18px] p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* The cards are links of their own, so this title does not stretch over the tile. */}
        <TileTitle href={ROUTES.calendar} stretch={false}>
          Týždeň v skratke
        </TileTitle>
        <div className="text-[12px] text-muted">kruh = kroky oproti priemeru</div>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(132px,100%),1fr))] gap-3">
        {cards.map((card) => {
          const current = card.day === date;
          const label = current && isToday ? "Dnes" : capitalize(formatDay(card.day));
          return (
            <li key={card.day} className="flex">
              <Link
                href={ROUTES.day(card.day)}
                aria-label={`${label}: ${formatInt(card.steps)} krokov, skóre ${formatInt(card.dayScore)}`}
                className="flex w-full flex-col gap-3 rounded-[20px] border p-4 no-underline transition-colors hover:bg-sunk"
                style={{ borderColor: current ? "var(--accent)" : "var(--line)" }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-ink2">{label}</span>
                  <Ring share={card.stepsShare} size={28} thickness={4} />
                </span>
                <span className="figure-sm text-[26px]">{formatInt(card.steps)}</span>
                <span className="flex flex-col gap-1 text-[12px] text-ink2">
                  <span className="flex justify-between gap-2">
                    <span>Spánok</span>
                    <span className="text-ink">{formatDurationShort(card.sleepMinutes)}</span>
                  </span>
                  <span className="flex justify-between gap-2">
                    <span>Skóre</span>
                    <span className="text-ink">{formatInt(card.dayScore)}</span>
                  </span>
                </span>
                <span className="truncate text-[12px] font-semibold">
                  {card.workout
                    ? `${workoutLabel(card.workout.type)} ${formatDurationCompact(card.workout.minutes)}`
                    : card.data
                      ? "bez tréningu"
                      : "bez dát"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

const HEAT_LOOK: Record<HeatMetric, { color: string; low: string; high: string; show: (value: number | null) => string }> = {
  steps: { color: "var(--accent)", low: "menej", high: "viac", show: (value) => formatInt(value) },
  sleep: { color: "var(--sleep)", low: "kratší", high: "dlhší", show: (value) => formatDuration(value) },
  active: { color: "var(--accent)", low: "menej", high: "viac", show: (value) => approx(formatDuration(value)) },
  resting: {
    color: "var(--heart)",
    low: "nižší",
    high: "vyšší",
    show: (value) => (value === null ? DASH : `${formatInt(value)} bpm`),
  },
};

const LEVEL_MIX = [0, 24, 48, 72, 100];
/** A day without data: an outlined empty slot, so it never reads as the lowest level. */
const NO_DATA: React.CSSProperties = { boxShadow: "inset 0 0 0 1px var(--line-strong)" };
/** Today while it runs: a dashed outline, not the "no data" slot. */
const RUNNING: React.CSSProperties = { border: "1px dashed var(--ink2)" };

/** Twelve weeks, day by day, for one chosen metric. */
export function HeatmapTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const [metric, setMetric] = useState<HeatMetric>("steps");
  const map = heatmap(dataset.days, date, metric);
  const look = HEAT_LOOK[metric];
  const label = HEAT_METRICS.find((item) => item.id === metric)?.label ?? "";
  const fill = (level: number) => (level >= 4 ? look.color : mix(look.color, LEVEL_MIX[level]));

  // Month names under the column where each month begins.
  const months: { column: number; text: string }[] = [];
  for (let column = 0; column < map.weeks; column++) {
    const first = map.cells.slice(column * 7, column * 7 + 7).find((cell) => cell.day.endsWith("-01"));
    if (first) months.push({ column, text: formatMonth(first.day).split(" ")[0] });
  }
  if (!months.some((month) => month.column < 2)) months.unshift({ column: 0, text: formatDayMonth(map.first) });

  return (
    <TileShell className="gap-4 p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TileTitle href={ROUTES.calendar}>12 týždňov po dňoch</TileTitle>
        <div role="group" aria-label="Čo kalendár ukazuje" className="tile-raise flex flex-wrap gap-1.5">
          {HEAT_METRICS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === metric}
              onClick={() => setMetric(item.id)}
              className="pill border-line text-[13px]"
              style={{ padding: "0 16px" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <div className="figure-sm text-[34px] tracking-[-0.03em]">{look.show(map.average)}</div>
        <div className="text-[13px] text-ink2">{heatmapNote(map)}</div>
      </div>
      <div className="flex gap-2.5">
        <div aria-hidden="true" className="mono flex h-[196px] flex-col justify-between py-1 text-[10px] text-muted">
          {[0, 2, 4, 6].map((index) => (
            <div key={index}>{WEEKDAY_LETTERS[index]}</div>
          ))}
        </div>
        <div
          className="grid h-[196px] flex-1 grid-flow-col grid-rows-7 gap-[5px]"
          style={{ gridAutoColumns: "minmax(0, 1fr)" }}
          role="img"
          aria-label={`Kalendár za 12 týždňov: ${label.toLowerCase()}, priemer ${look.show(map.average)}`}
        >
          {map.cells.map((cell) => (
            <div
              key={cell.day}
              title={cell.future ? undefined : `${formatDay(cell.day)} · ${cell.running ? "deň ešte beží" : look.show(cell.value)}`}
              className="rounded-[6px]"
              style={cell.future ? undefined : cell.running ? RUNNING : cell.level === 0 ? NO_DATA : { background: fill(cell.level) }}
            />
          ))}
        </div>
      </div>
      <div className="mono grid pl-6 text-[11px] text-muted" style={{ gridTemplateColumns: `repeat(${map.weeks}, minmax(0, 1fr))` }} aria-hidden="true">
        {months.map((month) => (
          <div key={month.column} className="whitespace-nowrap" style={{ gridColumn: `${month.column + 1} / span 3` }}>
            {month.text}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <div>{look.low}</div>
        <div aria-hidden="true" className="flex gap-[3px]">
          {[1, 2, 3, 4].map((level) => (
            <div key={level} className="size-3 rounded-[3px]" style={{ background: fill(level) }} />
          ))}
        </div>
        <div>{look.high}</div>
        <div aria-hidden="true" className="ml-3 size-3 rounded-[3px]" style={NO_DATA} />
        <div>bez dát</div>
      </div>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

function recordText(item: RecordItem): { value: string; note: string } {
  const when = formatDay(item.day);
  switch (item.key) {
    case "steps":
      return { value: `${formatInt(item.value)} krokov`, note: `najviac za deň · ${when}` };
    case "sleep":
      return { value: formatDuration(item.value), note: `najdlhší spánok · ${when}` };
    case "resting":
      return { value: `${formatInt(item.value)} bpm`, note: `najnižší pokojový tep · ${when}` };
    case "workout":
      return {
        value: formatDuration(item.value / 60),
        note: `najdlhší tréning · ${workoutLabel(item.type ?? "").toLowerCase()}, ${when}`,
      };
    case "dayScore": {
      const points = Math.round(item.value);
      return { value: `${formatInt(points)} ${plural(points, "bod", "body", "bodov")}`, note: `najlepšie skóre dňa · ${when}` };
    }
  }
}

export function RecordsTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const items = records(dataset.days, date);
  return (
    <Tile href={ROUTES.longTerm} label="Rekordy · 90 dní" className="gap-1 p-6 sm:p-7">
      <div className="pt-2.5">
        {items.map((item) => {
          const text = recordText(item);
          return (
            <div key={item.key} className="flex flex-col gap-0.5 border-t border-line py-3">
              <div className="figure-sm text-[26px] leading-[1.1]">{text.value}</div>
              <div className="text-[12px] text-ink2">{text.note}</div>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-[13px] text-muted">Zatiaľ bez rekordov.</p>}
      </div>
    </Tile>
  );
}

// ---------------------------------------------------------------------------------------

export function WorkoutsTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const from = addDays(date, -6);
  const recent = allWorkouts(dataset.days).filter((workout) => workout.day >= from && workout.day <= date);
  const totals = workoutTotals(recent);
  const tz = dataset.timezone;
  const summary =
    totals.count === 0
      ? "žiadny tréning"
      : `${totals.count} ${plural(totals.count, "tréning", "tréningy", "tréningov")} · ${formatDuration(totals.seconds / 60)} · ${approx(formatKcal(totals.kcal))}`;

  return (
    <Tile
      href={ROUTES.workouts}
      label="Tréningy · 7 dní"
      aside={<div className="text-[13px] text-ink2">{summary}</div>}
      className="gap-1.5 p-6 sm:p-7"
    >
      <div className="pt-2.5">
        {recent.map((workout) => (
          <div
            key={workout.id}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2.5 border-t border-line py-[13px] md:grid-cols-[minmax(0,1.2fr)_96px_minmax(0,2fr)_132px_84px] md:gap-x-[18px]"
          >
            <div className="col-start-1 row-start-1 min-w-0">
              <div className="text-[16px] font-semibold">{workoutLabel(workout.type)}</div>
              <div className="mono text-[11px] text-muted">
                {WEEKDAY_LETTERS[weekdayIndex(workout.day)]} {formatClock(workout.start, tz)}
              </div>
            </div>
            <div className="col-start-2 row-start-1 text-[16px] font-medium">{formatDuration(workout.duration_s / 60)}</div>
            <div className="col-span-2 col-start-1 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1">
              <ZoneBar
                light={workout.zone_light_min}
                moderate={workout.zone_moderate_min}
                vigorous={workout.zone_vigorous_min}
                label={`Intenzita: ľahká ${workout.zone_light_min} min, stredná ${workout.zone_moderate_min} min, vysoká ${workout.zone_vigorous_min} min`}
              />
            </div>
            <div className="mono col-start-3 row-start-2 text-right text-[12px] text-ink2 md:col-start-4 md:row-start-1 md:text-left">
              {workout.hr_avg === null ? "bez tepu" : `${formatInt(workout.hr_avg)} / ${formatInt(workout.hr_max)} bpm`}
            </div>
            <div className="col-start-3 row-start-1 flex items-baseline justify-end gap-1.5 md:col-start-5">
              <span className="text-[16px] font-medium">{formatStrain(workout.strain)}</span>
              <span className="mono text-[11px] text-muted">strain</span>
            </div>
          </div>
        ))}
        {recent.length === 0 && <p className="border-t border-line py-4 text-[14px] text-ink2">Za posledných 7 dní žiadny tréning.</p>}
      </div>
    </Tile>
  );
}
