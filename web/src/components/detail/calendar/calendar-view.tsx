"use client";

import { dayFigure, periodHasEstimate } from "@/lib/day-values";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { capitalize, riseStyle, RoundNav, Rows, Swatch } from "@/components/detail/shared-b/parts";
import { ROUTES } from "@/components/shell/nav";
import { WithData } from "@/components/shell/shell";
import { Segmented } from "@/components/ui/parts";
import { Arrow } from "@/components/ui/tile";
import {
  adjacentPeriod,
  averagesTitle,
  calendarCells,
  latestDataDay,
  monthTitle,
  periodAverages,
  periodOf,
  periodRange,
  periodsWithData,
  selectionIn,
  weekTitle,
  type CalendarView as View,
} from "@/lib/calendar";
import { isValidDay, todayIn } from "@/lib/dates";
import {
  approx,
  DASH,
  formatBpm,
  formatClock,
  formatDayLong,
  formatDuration,
  formatDurationCompact,
  formatInt,
  formatKcal,
  workoutLabel,
} from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import { dayScoreLabel, formatStrain } from "@/lib/scores";
import type { Dataset, Day } from "@/lib/types";
import { MonthCell, WeekCard, WeekdayHeader } from "./cells";

const VIEWS: { value: View; label: string }[] = [
  { value: "month", label: "Mesiac" },
  { value: "week", label: "Týždeň" },
];

function SelectedDay({ date, day, timeZone }: { date: string | null; day: Day | null; timeZone: string }) {
  if (!date || !day) {
    return (
      <section className="glass flex flex-col gap-3 p-[26px]" aria-live="polite">
        <h2 className="eyebrow">Vybraný deň</h2>
        <p className="text-[14px] text-ink2">V tomto období nie je deň s dátami. Prejdi na iný mesiac alebo týždeň.</p>
      </section>
    );
  }
  const score = day.scores?.day_score ?? null;
  const workouts = [...day.workouts].sort((a, b) => b.duration_s - a.duration_s);
  return (
    <section
      className="glass flex flex-col gap-3.5 p-[26px]"
      style={{ borderColor: "var(--accent)" }}
      aria-live="polite"
      aria-labelledby="calendar-picked"
    >
      <h2 id="calendar-picked" className="eyebrow">
        {formatDayLong(date).replace(/\s\d{4}$/, "")}
      </h2>
      <div className="flex items-baseline gap-2.5">
        <div className="figure text-[84px] leading-[0.9] tracking-[-0.05em]">{formatInt(score)}</div>
        <div className="text-[14px] text-ink2">{score === null ? "skóre zatiaľ nie je" : `skóre dňa · ${dayScoreLabel(score)}`}</div>
      </div>
      <Rows
        rows={[
          { k: day.complete === false ? "Kroky zatiaľ" : "Kroky", v: formatInt(day.steps) },
          { k: "Spánok", v: formatDuration(day.sleep_minutes) },
          {
            k: "Zaspatie → vstávanie",
            v: day.sleep_start && day.sleep_end ? `${formatClock(day.sleep_start, timeZone)} → ${formatClock(day.sleep_end, timeZone)}` : DASH,
          },
          { k: "Aktívny čas", v: approx(formatDuration(day.active_minutes_est)) },
          { k: "Kalórie", v: dayFigure(day, "totalEnergy", formatKcal) },
          { k: "Pokojový tep", v: dayFigure(day, "restingHr", formatBpm) },
          { k: "Strain dňa", v: formatStrain(day.scores?.strain) },
          {
            k: workouts.length > 1 ? "Tréningy" : "Tréning",
            v: workouts.length
              ? workouts.map((workout) => `${workoutLabel(workout.type)} ${formatDurationCompact(workout.duration_s / 60)}`).join(", ")
              : "žiadny",
          },
        ]}
      />
      <Link href={ROUTES.day(date)} className="pill pill-outline title-link self-start">
        Celý deň <Arrow />
      </Link>
    </section>
  );
}

function Averages({ title, dataset, from, to, today }: { title: string; dataset: Dataset; from: string; to: string; today: string }) {
  const result = periodAverages(dataset.days, from, to, today);
  const restingFigure = formatBpm(result.restingHr);
  const estimatedResting = periodHasEstimate(dataset.days.filter((day) => day.day >= from && day.day <= to && day.day <= today), "restingHr");
  const trainings = result.workouts ? `${result.workouts}× · ${formatDurationCompact(result.workoutSeconds / 60)}` : "žiadne";
  return (
    <section className="glass flex flex-auto flex-col gap-1 p-[26px]">
      <h2 className="eyebrow pb-2">{title}</h2>
      <Rows
        size="lg"
        rows={[
          { k: "Skóre", v: formatInt(result.dayScore) },
          { k: "Kroky za deň", v: formatInt(result.steps) },
          { k: "Spánok za noc", v: formatDurationCompact(result.sleepMinutes) },
          { k: "Tréningy", v: trainings },
          { k: "Pokojový tep", v: estimatedResting ? approx(restingFigure) : restingFigure },
        ]}
      />
      <p className="pt-2 text-[12px] text-muted">
        {result.daysWithData ? `z ${result.daysWithData} ${result.daysWithData === 1 ? "dňa" : "dní"} s dátami` : "v tomto období nie sú dáta"}
      </p>
    </section>
  );
}

function Calendar({ dataset, now }: { dataset: Dataset; now: Date }) {
  const params = useSearchParams();
  const today = todayIn(dataset.timezone, now);
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);

  const [state, setState] = useState(() => {
    const asked = params.get("den");
    const view: View = params.get("pohlad") === "tyzden" ? "week" : "month";
    const selected = asked && isValidDay(asked) && asked <= today ? asked : latestDataDay(dataset.days, today);
    return { view, period: periodOf(view, selected), selected: selected as string | null };
  });
  const { view, period, selected } = state;

  const stops = useMemo(() => periodsWithData(dataset.days, view, today), [dataset.days, view, today]);
  const previous = adjacentPeriod(stops, period, -1);
  const next = adjacentPeriod(stops, period, 1);
  const { from, to } = periodRange(view, period);
  const cells = calendarCells(dataset.days, view, period, today);
  const heading = view === "month" ? monthTitle(period, today) : weekTitle(period, today);

  const goTo = (target: string) =>
    setState((current) => ({ ...current, period: target, selected: selectionIn(dataset.days, current.view, target, today, current.selected) }));
  const switchView = (target: View) =>
    setState((current) => {
      const anchor = current.selected ?? periodRange(current.view, current.period).from;
      const nextPeriod = periodOf(target, anchor);
      return { view: target, period: nextPeriod, selected: selectionIn(dataset.days, target, nextPeriod, today, current.selected) };
    });
  const select = (day: string) => setState((current) => ({ ...current, selected: day }));

  const step = view === "month" ? "mesiac" : "týždeň";
  const pickedDay = selected ? (byDay.get(selected) ?? null) : null;

  return (
    <>
      <div className="rise flex flex-wrap items-end justify-between gap-4 px-1">
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3">
          <h1 className="figure text-[clamp(44px,6vw,76px)] leading-none" aria-live="polite">
            <span className="sr-only">Kalendár · </span>
            {capitalize(heading)}
          </h1>
          <div className="flex gap-2">
            <RoundNav label={`Predošlý ${step}`} onClick={previous ? () => goTo(previous) : null}>
              ←
            </RoundNav>
            <RoundNav label={`Nasledujúci ${step}`} onClick={next ? () => goTo(next) : null}>
              →
            </RoundNav>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-[22px] gap-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5" aria-hidden="true">
            <Swatch shape="ring" color="var(--accent)" label="skóre dňa" />
            <Swatch shape="line" color="var(--sleep)" label="spánok" />
            <Swatch shape="dot" color="var(--heart)" label="tréning" />
          </div>
          <Segmented options={VIEWS} value={view} onChange={switchView} label="Rozsah kalendára" />
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-[18px]">
        <section
          className="glass rise min-w-0 overflow-x-auto p-2.5 sm:p-[22px]"
          style={riseStyle(1, { flex: "2.4 1 680px" })}
          aria-label={view === "month" ? `Mesiac ${heading}` : `Týždeň ${heading}`}
        >
          {view === "month" ? (
            <div className="flex flex-col gap-2 sm:min-w-[660px]">
              <WeekdayHeader />
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {cells.map((cell) => (
                  <MonthCell key={cell.day} cell={cell} selected={cell.day === selected} onSelect={select} />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(168px,100%),1fr))] gap-2.5">
              {cells.map((cell) => (
                <WeekCard key={cell.day} cell={cell} selected={cell.day === selected} onSelect={select} timeZone={dataset.timezone} />
              ))}
            </div>
          )}
        </section>

        <div className="rise flex min-w-0 flex-col gap-[18px]" style={riseStyle(2, { flex: "1 1 320px" })}>
          <SelectedDay date={selected} day={pickedDay} timeZone={dataset.timezone} />
          <Averages title={averagesTitle(view, period, today)} dataset={dataset} from={from} to={to} today={today} />
        </div>
      </div>
    </>
  );
}

export function CalendarView() {
  return <WithData>{(dataset, now) => <Calendar dataset={dataset} now={now} />}</WithData>;
}
