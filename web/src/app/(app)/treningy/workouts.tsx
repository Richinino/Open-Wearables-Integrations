"use client";

import { useMemo, useState } from "react";
import { WorkoutHead, WorkoutRow, ZONES } from "@/components/domain";
import { WithData } from "@/components/shell/shell";
import { EmptyState, Legend, Segmented, StatTile } from "@/components/ui/parts";
import { addDays, todayIn } from "@/lib/dates";
import {
  approx,
  formatDistance,
  formatDuration,
  formatInt,
  formatMonth,
  workoutLabel,
} from "@/lib/format";
import { allWorkouts, workoutTotals } from "@/lib/metrics";
import type { Dataset, Workout } from "@/lib/types";

const ALL = 0;
const PERIODS = [
  { value: 30, label: "30 dní" },
  { value: 90, label: "90 dní" },
  { value: ALL, label: "Všetko" },
];

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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

function Workouts({ dataset, now }: { dataset: Dataset; now: Date }) {
  const [period, setPeriod] = useState(30);
  const [type, setType] = useState<string | null>(null);
  const everything = useMemo(() => allWorkouts(dataset.days), [dataset.days]);

  const today = todayIn(dataset.timezone, now);
  const from = period === ALL ? "" : addDays(today, -(period - 1));
  const inPeriod = everything.filter((workout) => workout.day >= from);
  const types = workoutTotals(inPeriod).byType;
  // A type that drops out of the period must not leave an invisible filter behind.
  const selected = types.some((item) => item.type === type) ? type : null;
  const shown = selected ? inPeriod.filter((workout) => workout.type === selected) : inPeriod;
  const totals = workoutTotals(shown);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="rise">
          <p className="eyebrow">Tréningy</p>
          <h1 className="mt-3 flex items-baseline gap-3">
            <span className="figure text-[56px] sm:text-[76px]">{formatInt(totals.count)}</span>
            <span className="text-[15px] font-medium text-ink-2">
              {period === ALL ? "spolu" : `za ${period} dní`}
            </span>
          </h1>
        </div>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Obdobie" />
      </div>

      {types.length > 1 && (
        <div role="group" aria-label="Typ tréningu" className="-mt-4 flex flex-wrap gap-2">
          {[{ type: null as string | null, count: inPeriod.length }, ...types].map((item) => {
            const active = item.type === selected;
            return (
              <button
                key={item.type ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => setType(item.type)}
                className="pill border-line"
              >
                {item.type === null ? "Všetky" : workoutLabel(item.type)}
                <span className={`tabular ml-1.5 ${active ? "opacity-70" : "text-muted"}`}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState title="Za toto obdobie nie je žiadny tréning">
          Skús dlhšie obdobie.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile className="rise" label="Celkový čas" value={formatDuration(totals.seconds / 60)} />
            <StatTile
              className="rise"
              style={{ "--i": 1 } as React.CSSProperties}
              label="Priemerné trvanie"
              value={formatDuration(totals.seconds / 60 / totals.count)}
            />
            <StatTile
              className="rise"
              style={{ "--i": 2 } as React.CSSProperties}
              label="Vzdialenosť"
              value={formatDistance(totals.distanceM)}
              hint="len tréningy so záznamom trasy"
            />
            <StatTile
              className="rise"
              style={{ "--i": 3 } as React.CSSProperties}
              label="Kalórie"
              value={approx(formatInt(totals.kcal))}
              unit="kcal"
              hint="odhad z tepu"
            />
          </div>

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[19px] font-semibold tracking-tight">Zoznam</h2>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-muted">Intenzita</span>
                <Legend items={[...ZONES]} />
              </div>
            </div>
            <div className="space-y-6">
              {byMonth(shown).map(({ month, items }) => (
                <div key={month} className="glass px-5 py-4 sm:px-7">
                  <div className="mb-3 flex items-baseline justify-between gap-4">
                    <h3 className="text-[15px] font-semibold tracking-tight">
                      {capitalize(formatMonth(`${month}-01`))}
                    </h3>
                    <span className="tabular text-[12px] text-muted">
                      {items.length}× ·{" "}
                      {formatDuration(items.reduce((acc, w) => acc + w.duration_s, 0) / 60)}
                    </span>
                  </div>
                  <WorkoutHead />
                  <div className="divide-y divide-line">
                    {items.map((workout) => (
                      <WorkoutRow key={workout.id} workout={workout} timeZone={dataset.timezone} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function WorkoutsView() {
  return <WithData>{(dataset, now) => <Workouts dataset={dataset} now={now} />}</WithData>;
}
