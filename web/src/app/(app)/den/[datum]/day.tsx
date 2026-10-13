"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { COLOR, stageSegments, WorkoutHead, WorkoutRow, zoneSegments } from "@/components/domain";
import { WithData } from "@/components/shell/shell";
import { Card, EmptyState, SegmentBar, type Segment } from "@/components/ui/parts";
import { addDays, isValidDay, todayIn } from "@/lib/dates";
import {
  approx,
  DASH,
  formatBpm,
  formatClock,
  formatDayLong,
  formatDistance,
  formatDuration,
  formatInt,
  formatKcal,
  stepsSourceLabel,
} from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import type { Dataset } from "@/lib/types";

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="text-[14px] text-ink-2">{label}</dt>
      <dd className="tabular text-[14px] font-semibold">{value}</dd>
    </div>
  );
}

/** A part-to-whole bar with each part's label and value written out below it. */
function Breakdown({ segments, ariaLabel }: { segments: Segment[]; ariaLabel: string }) {
  return (
    <div>
      <SegmentBar segments={segments} ariaLabel={ariaLabel} />
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: segment.color }} />
            <span className="text-ink-2">{segment.label}</span>
            <span className="tabular ml-auto font-semibold">{formatDuration(segment.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Headline({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: color }} />
        <h2 className="eyebrow">{label}</h2>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="figure text-[52px]">{value}</span>
        {unit && <span className="text-[14px] font-medium text-ink-2">{unit}</span>}
      </div>
    </div>
  );
}

function Stepper({ href, label, children }: { href: string | null; label: string; children: string }) {
  const style =
    "grid size-10 place-items-center rounded-full text-[18px] ring-1 ring-ring transition-colors";
  if (!href) {
    return (
      <span aria-hidden="true" className={`${style} text-line-strong`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={`${style} text-ink hover:bg-sunk`}>
      {children}
    </Link>
  );
}

function DayDetail({ dataset, now, date }: { dataset: Dataset; now: Date; date: string }) {
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);
  const day = byDay.get(date) ?? null;
  const today = todayIn(dataset.timezone, now);
  const previous = dataset.first_day && date > dataset.first_day ? addDays(date, -1) : null;
  const next = date < today ? addDays(date, 1) : null;
  const tz = dataset.timezone;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div className="rise min-w-0">
          <p className="eyebrow">
            <Link href="/" className="hover:text-ink">
              Prehľad
            </Link>{" "}
            / {date === today ? "Dnes" : "Deň"}
          </p>
          <h1 className="mt-3 text-[30px] leading-tight font-semibold tracking-tight sm:text-[40px]">
            {capitalize(formatDayLong(date))}
          </h1>
          {day?.complete === false && (
            <p className="mt-2 text-[13px] text-ink-2">Deň ešte beží, hodnoty budú rásť.</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Stepper href={previous && `/den/${previous}`} label="Predošlý deň">
            ←
          </Stepper>
          <Stepper href={next && `/den/${next}`} label="Nasledujúci deň">
            →
          </Stepper>
        </div>
      </div>

      {!day ? (
        <EmptyState title="Pre tento deň nie sú dáta">
          Hodinky ani telefón za tento deň nič neposlali, alebo ešte neprebehla synchronizácia.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="rise">
              <Headline label="Aktivita" value={formatInt(day.steps)} unit="krokov" color={COLOR.activity} />
              <dl className="mt-5">
                <Row label="Zdroj krokov" value={stepsSourceLabel(day.steps_source)} />
                <Row label="Vzdialenosť" value={approx(formatDistance(day.distance_m_est))} />
                <Row label="Aktívny čas" value={approx(formatDuration(day.active_minutes_est))} />
                <Row label="Kalórie spolu" value={approx(formatKcal(day.total_kcal_est))} />
                <Row label="z toho aktivita" value={approx(formatKcal(day.activity_kcal_est))} />
                <Row label="z toho bazál" value={formatKcal(day.basal_kcal)} />
              </dl>
            </Card>

            <Card className="rise" style={{ "--i": 1 } as React.CSSProperties}>
              <Headline label="Tep" value={formatInt(day.hr_resting)} unit="bpm v pokoji" color={COLOR.heart} />
              <dl className="mt-5">
                <Row label="Priemer" value={formatBpm(day.hr_avg)} />
                <Row label="Najnižší" value={formatBpm(day.hr_min)} />
                <Row label="Najvyšší" value={formatBpm(day.hr_max)} />
              </dl>
              <h3 className="eyebrow mt-6 mb-3">Čas podľa intenzity</h3>
              <Breakdown segments={zoneSegments(day)} ariaLabel="Čas v zónach intenzity" />
            </Card>

            <Card className="rise" style={{ "--i": 2 } as React.CSSProperties}>
              <Headline label="Spánok" value={formatDuration(day.sleep_minutes)} color={COLOR.sleep} />
              <dl className="mt-5">
                <Row label="Zaspatie" value={formatClock(day.sleep_start, tz)} />
                <Row label="Zobudenie" value={formatClock(day.sleep_end, tz)} />
                <Row label="Zdriemnutie" value={day.nap_minutes ? formatDuration(day.nap_minutes) : DASH} />
              </dl>
              <h3 className="eyebrow mt-6 mb-3">Fázy</h3>
              <Breakdown
                segments={stageSegments({
                  deep: day.sleep_deep_min,
                  rem: day.sleep_rem_min,
                  light: day.sleep_light_min,
                  awake: day.sleep_awake_min,
                })}
                ariaLabel="Fázy spánku"
              />
            </Card>
          </div>

          <section>
            <h2 className="mb-4 text-[19px] font-semibold tracking-tight">
              Tréningy{day.workouts.length > 0 && <span className="ml-2 text-muted">{day.workouts.length}</span>}
            </h2>
            {day.workouts.length === 0 ? (
              <p className="text-[14px] text-ink-2">V tento deň nebol zaznamenaný žiadny tréning.</p>
            ) : (
              <div className="rounded-2xl bg-surface px-5 py-3 ring-1 ring-ring sm:px-6">
                <WorkoutHead />
                <div className="divide-y divide-line">
                  {day.workouts.map((workout) => (
                    <WorkoutRow key={workout.id} workout={workout} timeZone={tz} showDay={false} />
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function DayView() {
  const { datum } = useParams<{ datum: string }>();
  if (!isValidDay(datum)) {
    return (
      <EmptyState title="Neplatný dátum">
        Adresa má mať tvar /den/2026-07-15.
      </EmptyState>
    );
  }
  return <WithData>{(dataset, now) => <DayDetail dataset={dataset} now={now} date={datum} />}</WithData>;
}
