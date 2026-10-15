"use client";

import { useMemo, useState } from "react";
import { durationTicks, ColumnChart } from "@/components/charts/charts";
import { tickDuration, tickPlain } from "@/components/charts/points";
import { capitalize, riseStyle, VENDOR, VendorLine } from "@/components/detail/shared-b/parts";
import { WorkoutHeader, WorkoutRow, ZoneLegend } from "@/components/detail/shared-b/workout-row";
import { WithData } from "@/components/shell/shell";
import { EmptyState, Segmented } from "@/components/ui/parts";
import { TileShell } from "@/components/ui/tile";
import { averageWorkoutStrain, trainingWeeks } from "@/lib/calendar";
import { addDays, todayIn } from "@/lib/dates";
import {
  approx,
  formatDayMonth,
  formatDistance,
  formatDuration,
  formatDurationCompact,
  formatInt,
  formatMonth,
  plural,
  workoutLabel,
} from "@/lib/format";
import { allWorkouts, workoutTotals } from "@/lib/metrics";
import { formatStrain } from "@/lib/scores";
import type { Dataset, Workout } from "@/lib/types";

const ALL = 0;
const PERIODS = [
  { value: 30, label: "30 dní" },
  { value: 90, label: "90 dní" },
  { value: ALL, label: "Všetko" },
];

function byMonth(workouts: Workout[]) {
  const months: { month: string; items: Workout[] }[] = [];
  for (const workout of workouts) {
    const month = workout.day.slice(0, 7);
    const current = months[months.length - 1];
    if (current?.month === month) current.items.push(workout);
    else months.push({ month, items: [workout] });
  }
  return months;
}

function Stat({ label, value, unit, note, index, className = "" }: { label: string; value: string; unit?: string; note?: string; index: number; className?: string }) {
  return (
    <TileShell radius={24} className={`rise gap-2.5 p-[18px] sm:p-[22px] ${className}`} style={riseStyle(index)}>
      <span className="text-[12px] text-ink2">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="figure-sm text-[26px] whitespace-nowrap sm:text-[30px]">{value}</span>
        {unit && <span className="text-[13px] text-ink2">{unit}</span>}
      </span>
      {note && <span className="text-[12px] text-muted">{note}</span>}
    </TileShell>
  );
}

function Workouts({ dataset, now }: { dataset: Dataset; now: Date }) {
  const [period, setPeriod] = useState(30);
  const [type, setType] = useState<string | null>(null);
  const everything = useMemo(() => allWorkouts(dataset.days), [dataset.days]);

  const today = todayIn(dataset.timezone, now);
  const firstDay = dataset.first_day ?? today;
  const from = period === ALL ? firstDay : addDays(today, -(period - 1));
  const inPeriod = everything.filter((workout) => workout.day >= from && workout.day <= today);
  const types = workoutTotals(inPeriod).byType;
  // A type that drops out of the period must not leave an invisible filter behind.
  const selected = types.some((item) => item.type === type) ? type : null;
  const shown = selected ? inPeriod.filter((workout) => workout.type === selected) : inPeriod;
  const totals = workoutTotals(shown);
  // "Všetko" draws at most a year of weeks; the list below still has everything.
  const chartFrom = period === ALL ? (addDays(today, -364) > firstDay ? addDays(today, -364) : firstDay) : from;
  const weeks = trainingWeeks(dataset.days, shown, chartFrom, today, today);
  const fullWeeks = weeks.filter((week) => !week.partial);
  const perWeek = fullWeeks.length ? fullWeeks.reduce((sum, week) => sum + week.seconds, 0) / fullWeeks.length / 60 : null;
  const strain = averageWorkoutStrain(shown);
  const span = period === ALL ? "spolu" : `za ${period} dní`;

  const volumePoints = weeks.map((week) => ({
    key: week.week,
    label: formatDayMonth(week.week),
    title: `Týždeň od ${formatDayMonth(week.week)} · ${week.count} ${plural(week.count, "tréning", "tréningy", "tréningov")}`,
    value: week.seconds / 60,
    partial: week.partial,
  }));
  const strainPoints = weeks.map((week) => ({
    key: week.week,
    label: formatDayMonth(week.week),
    title: `Týždeň od ${formatDayMonth(week.week)}`,
    value: week.dayStrain,
    partial: week.partial,
  }));
  const topMinutes = Math.max(...volumePoints.map((point) => point.value), 60);

  return (
    <>
      <div className="rise flex flex-wrap items-end justify-between gap-4 px-1">
        <div>
          <p className="eyebrow">Tréningy</p>
          <h1 className="mt-3 flex items-baseline gap-3">
            <span className="figure text-[clamp(56px,6vw,76px)]">{formatInt(totals.count)}</span>
            <span className="text-[15px] font-medium text-ink2">
              {plural(totals.count, "tréning", "tréningy", "tréningov")} {span}
              {selected ? ` · ${workoutLabel(selected).toLowerCase()}` : ""}
            </span>
          </h1>
        </div>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Obdobie" />
      </div>

      {types.length > 1 && (
        <div role="group" aria-label="Typ tréningu" className="rise flex flex-wrap gap-2 px-1" style={riseStyle(1)}>
          {[{ type: null as string | null, count: inPeriod.length }, ...types].map((item) => {
            const active = item.type === selected;
            return (
              <button
                key={item.type ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setType(item.type)}
                className="pill border-line"
                style={{ padding: "0 16px" }}
              >
                {item.type === null ? "Všetky" : workoutLabel(item.type)}
                <span className={`tabular ${active ? "opacity-70" : "text-muted"}`}>{item.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState title="Za toto obdobie nie je žiadny tréning">Skús dlhšie obdobie.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-[18px] lg:grid-cols-5">
            <Stat index={2} label="Celkový čas" value={formatDurationCompact(totals.seconds / 60)} note={`${formatInt(totals.count)}× · priemerne ${formatDuration(totals.seconds / 60 / totals.count)}`} />
            <Stat index={3} label="Za týždeň" value={formatDurationCompact(perWeek)} note={fullWeeks.length ? `priemer ${fullWeeks.length} celých týždňov` : "zatiaľ žiadny celý týždeň"} />
            <Stat index={4} label="Strain tréningu" value={formatStrain(strain)} note="priemer, 0–21" />
            <Stat index={5} label="Vzdialenosť" value={formatDistance(totals.distanceM)} note="len tréningy so záznamom trasy" />
            <Stat index={6} className="col-span-2 lg:col-span-1" label="Kalórie" value={approx(formatInt(totals.kcal))} unit="kcal" note="odhad z tepu" />
          </div>

          <div className="grid gap-[18px] lg:grid-cols-2">
            <TileShell className="rise gap-3 p-6 sm:p-7" style={riseStyle(7)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="eyebrow">Objem tréningu · hodiny za týždeň</h2>
                <span className="text-[13px] text-ink2">{selected ? workoutLabel(selected) : "všetky typy"}</span>
              </div>
              <ColumnChart
                points={volumePoints}
                color="var(--accent)"
                ticks={durationTicks(topMinutes)}
                formatTick={tickDuration}
                formatValue={(minutes) => formatDurationCompact(minutes)}
                reference={perWeek === null ? null : { value: perWeek, label: `priemer ${formatDurationCompact(perWeek)}` }}
                ariaLabel={`Čas tréningu po týždňoch, priemer ${formatDurationCompact(perWeek)} za týždeň`}
                height={200}
              />
              <p className="text-[12px] text-muted">Svetlejší stĺpec je týždeň, ktorý ešte beží.</p>
            </TileShell>
            <TileShell className="rise gap-3 p-6 sm:p-7" style={riseStyle(8)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="eyebrow">Strain · priemer dňa za týždeň</h2>
                <span className="text-[13px] text-ink2">celý deň, 0–21</span>
              </div>
              <ColumnChart
                points={strainPoints}
                color="var(--heart)"
                ticks={[0, 7, 14, 21]}
                formatTick={tickPlain}
                formatValue={(value) => formatStrain(value)}
                ariaLabel="Priemerný strain dňa po týždňoch"
                height={200}
              />
              <VendorLine>{VENDOR.strain} · strainy sa nesčítavajú, preto priemer dní týždňa</VendorLine>
            </TileShell>
          </div>

          <section className="flex flex-col gap-[18px]" aria-labelledby="workouts-list">
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 id="workouts-list" className="eyebrow">
                Zoznam
              </h2>
              <ZoneLegend />
            </div>
            {byMonth(shown).map(({ month, items }) => {
              const seconds = items.reduce((sum, workout) => sum + workout.duration_s, 0);
              return (
                <TileShell key={month} className="gap-2 p-5 sm:p-7">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
                    <h3 className="text-[19px] font-semibold tracking-[-0.01em]">{capitalize(formatMonth(`${month}-01`))}</h3>
                    <span className="text-[13px] text-ink2">
                      {items.length}× · {formatDurationCompact(seconds / 60)} · strain ø {formatStrain(averageWorkoutStrain(items))}
                    </span>
                  </div>
                  <WorkoutHeader />
                  <div>
                    {items.map((workout) => (
                      <WorkoutRow key={workout.id} workout={workout} timeZone={dataset.timezone} link />
                    ))}
                  </div>
                </TileShell>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}

export function WorkoutsView() {
  return <WithData>{(dataset, now) => <Workouts dataset={dataset} now={now} />}</WithData>;
}
