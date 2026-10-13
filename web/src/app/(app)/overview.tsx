"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ColumnChart, durationTicks, LineChart, StackedColumnChart } from "@/components/charts/charts";
import { dayPoints, dayRows, tickCompact, tickDuration, tickPlain } from "@/components/charts/points";
import { COLOR, WorkoutHead, WorkoutRow } from "@/components/domain";
import { WithData } from "@/components/shell/shell";
import { ChartCard, Delta, Meter, SectionTitle, Segmented, StatTile } from "@/components/ui/parts";
import { todayIn } from "@/lib/dates";
import {
  approx,
  formatBpm,
  formatClock,
  formatDayLong,
  formatDistance,
  formatDuration,
  formatInt,
  formatKcal,
  stepsSourceLabel,
} from "@/lib/format";
import { allWorkouts, indexByDay, periodSummary, series, windowEnding } from "@/lib/metrics";
import type { Dataset, Day } from "@/lib/types";

const PERIODS = [
  { value: 7, label: "7 dní" },
  { value: 30, label: "30 dní" },
  { value: 90, label: "90 dní" },
];

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
      <dt className="text-[14px] text-ink-2">{label}</dt>
      <dd className="text-right">
        <span className="figure-sm text-[19px]">{value}</span>
        {note && <span className="ml-2 text-[12px] text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function Today({ dataset, day, date, isToday }: { dataset: Dataset; day: Day | null; date: string; isToday: boolean }) {
  const usual = periodSummary(dataset.days, date, 30, "steps").average;
  const steps = day?.steps ?? null;
  const share = steps !== null && usual ? steps / usual : null;
  const running = day?.complete === false;
  const sleepTimes =
    day?.sleep_start && day.sleep_end
      ? `${formatClock(day.sleep_start, dataset.timezone)} – ${formatClock(day.sleep_end, dataset.timezone)}`
      : undefined;

  return (
    <section className="grid gap-x-12 gap-y-8 lg:grid-cols-[1.15fr_1fr] lg:items-end">
      <div className="rise">
        <p className="eyebrow">{isToday ? "Dnes" : "Posledný deň s dátami"}</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight sm:text-[26px]">
          {capitalize(formatDayLong(date).replace(/\s\d{4}$/, ""))}
        </h1>

        <div className="mt-8 flex items-end gap-3">
          <span className="figure text-[84px] sm:text-[120px]">{formatInt(steps)}</span>
          <span className="pb-2 text-[15px] font-medium text-ink-2 sm:pb-4">krokov</span>
        </div>

        <div className="mt-5 max-w-md">
          <Meter
            value={steps ?? 0}
            limit={usual ?? 0}
            color={COLOR.activity}
            track={COLOR.activitySoft}
            ariaLabel="Kroky oproti dennému priemeru za 30 dní"
          />
          <p className="mt-2.5 text-[13px] text-ink-2">
            {share === null ? (
              "Priemer za 30 dní zatiaľ nie je známy."
            ) : (
              <>
                <span className="font-semibold text-ink">{formatInt(share * 100)} %</span> denného
                priemeru ({formatInt(usual)})
              </>
            )}
            {day?.steps_source && <> · zdroj {stepsSourceLabel(day.steps_source)}</>}
            {running && <> · deň ešte beží</>}
          </p>
        </div>
      </div>

      <div className="rise" style={{ "--i": 2 } as React.CSSProperties}>
        <dl>
          <Fact label="Aktívny čas" value={approx(formatDuration(day?.active_minutes_est))} />
          <Fact
            label="Kalórie"
            value={approx(formatKcal(day?.total_kcal_est))}
            note={
              day?.activity_kcal_est == null
                ? undefined
                : `z aktivity ${approx(formatInt(day.activity_kcal_est))}`
            }
          />
          <Fact label="Vzdialenosť" value={approx(formatDistance(day?.distance_m_est))} />
          <Fact label="Pokojový tep" value={formatBpm(day?.hr_resting)} />
          <Fact label="Spánok" value={formatDuration(day?.sleep_minutes)} note={sleepTimes} />
        </dl>
        <Link
          href={`/den/${date}`}
          className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
        >
          Celý deň <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

function Overview({ dataset, now }: { dataset: Dataset; now: Date }) {
  const router = useRouter();
  const [period, setPeriod] = useState(30);
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);

  const today = todayIn(dataset.timezone, now);
  const date = byDay.has(today) ? today : (dataset.last_day ?? today);
  const day = byDay.get(date) ?? null;
  const slots = windowEnding(dataset.days, date, period);
  const open = (key: string) => router.push(`/den/${key}`);
  const versus = `oproti predošlým ${period} dňom`;

  const steps = periodSummary(dataset.days, date, period, "steps");
  const active = periodSummary(dataset.days, date, period, "active_minutes_est");
  const kcal = periodSummary(dataset.days, date, period, "total_kcal_est");
  const sleep = periodSummary(dataset.days, date, period, "sleep_minutes", { includeIncomplete: true });
  const resting = periodSummary(dataset.days, date, period, "hr_resting", { includeIncomplete: true });
  const trend = (key: Parameters<typeof series>[1], includeIncomplete = false) =>
    series(slots, key, { includeIncomplete }).map((point) => point.value);
  const recent = allWorkouts(dataset.days).slice(0, 5);

  return (
    <div className="space-y-14">
      <Today dataset={dataset} day={day} date={date} isToday={date === today} />

      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-semibold tracking-tight">Posledné obdobie</h2>
            <p className="mt-0.5 text-[13px] text-ink-2">Priemery za deň, zmena {versus}.</p>
          </div>
          <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Obdobie" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <StatTile
            className="rise col-span-2 lg:col-span-1"
            label="Kroky za deň"
            value={formatInt(steps.average)}
            trend={trend("steps")}
            color={COLOR.activity}
            delta={<Delta change={steps.change} upIsGood />}
          />
          <StatTile
            className="rise"
            style={{ "--i": 1 } as React.CSSProperties}
            label="Aktívny čas"
            value={approx(formatDuration(active.average))}
            trend={trend("active_minutes_est")}
            color={COLOR.activity}
            delta={<Delta change={active.change} upIsGood />}
          />
          <StatTile
            className="rise"
            style={{ "--i": 2 } as React.CSSProperties}
            label="Kalórie"
            value={approx(formatInt(kcal.average))}
            unit="kcal"
            trend={trend("total_kcal_est")}
            color={COLOR.activity}
            delta={<Delta change={kcal.change} upIsGood={null} />}
          />
          <StatTile
            className="rise"
            style={{ "--i": 3 } as React.CSSProperties}
            label="Spánok"
            value={formatDuration(sleep.average)}
            trend={trend("sleep_minutes", true)}
            color={COLOR.sleep}
            delta={<Delta change={sleep.change} upIsGood />}
          />
          <StatTile
            className="rise"
            style={{ "--i": 4 } as React.CSSProperties}
            label="Pokojový tep"
            value={formatInt(resting.average)}
            unit="bpm"
            trend={trend("hr_resting", true)}
            color={COLOR.heart}
            delta={<Delta change={resting.change} upIsGood={false} />}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ChartCard
            className="lg:col-span-2"
            title="Kroky"
            subtitle={`Priemer ${formatInt(steps.average)} za deň · spolu ${formatInt(steps.total)}`}
            height={240}
            table={{
              columns: ["Deň", "Kroky", "Zdroj"],
              rows: dayRows(slots, (d) => [formatInt(d.steps), stepsSourceLabel(d.steps_source)]),
            }}
          >
            <ColumnChart
              points={dayPoints(slots, (d) => d.steps)}
              color={COLOR.activity}
              ariaLabel={`Kroky za posledných ${period} dní`}
              formatValue={(value) => `${formatInt(value)} krokov`}
              formatTick={tickCompact}
              reference={
                steps.average === null
                  ? null
                  : { value: steps.average, label: `priemer ${formatInt(steps.average)}` }
              }
              onSelect={open}
              height={240}
            />
          </ChartCard>

          <ChartCard
            title="Spánok"
            subtitle={`Priemer ${formatDuration(sleep.average)} za noc`}
            table={{
              columns: ["Deň", "Spánok"],
              rows: dayRows(slots, (d) => [formatDuration(d.sleep_minutes)]),
            }}
          >
            <ColumnChart
              points={dayPoints(slots, (d) => d.sleep_minutes, { partial: false })}
              color={COLOR.sleep}
              ariaLabel={`Dĺžka spánku za posledných ${period} dní`}
              formatValue={formatDuration}
              formatTick={tickDuration}
              ticks={durationTicks(Math.max(...slots.map((s) => s.data?.sleep_minutes ?? 0), 60))}
              onSelect={open}
            />
          </ChartCard>

          <ChartCard
            title="Pokojový tep"
            subtitle={`Priemer ${formatBpm(resting.average)}`}
            table={{
              columns: ["Deň", "Pokojový tep"],
              rows: dayRows(slots, (d) => [formatBpm(d.hr_resting)]),
            }}
          >
            <LineChart
              points={dayPoints(slots, (d) => d.hr_resting, { partial: false })}
              color={COLOR.heart}
              ariaLabel={`Pokojový tep za posledných ${period} dní`}
              formatValue={formatBpm}
              formatTick={tickPlain}
              onSelect={open}
            />
          </ChartCard>

          <ChartCard
            title="Aktívny čas"
            subtitle={`Odhad · priemer ${approx(formatDuration(active.average))} za deň`}
            table={{
              columns: ["Deň", "Aktívny čas (odhad)"],
              rows: dayRows(slots, (d) => [approx(formatDuration(d.active_minutes_est))]),
            }}
          >
            <ColumnChart
              points={dayPoints(slots, (d) => d.active_minutes_est)}
              color={COLOR.activity}
              ariaLabel={`Odhad aktívneho času za posledných ${period} dní`}
              formatValue={(value) => approx(formatDuration(value))}
              formatTick={tickDuration}
              ticks={durationTicks(Math.max(...slots.map((s) => s.data?.active_minutes_est ?? 0), 30))}
              onSelect={open}
            />
          </ChartCard>

          <ChartCard
            title="Kalórie"
            subtitle={`Odhad · priemer ${approx(formatKcal(kcal.average))} za deň`}
            legend={[
              { label: "Bazál", color: COLOR.context },
              { label: "Aktivita (odhad)", color: COLOR.activity },
            ]}
            table={{
              columns: ["Deň", "Bazál", "Aktivita (odhad)", "Spolu (odhad)"],
              rows: dayRows(slots, (d) => [
                formatKcal(d.basal_kcal),
                approx(formatKcal(d.activity_kcal_est)),
                approx(formatKcal(d.total_kcal_est)),
              ]),
            }}
          >
            <StackedColumnChart
              points={slots.map(({ day: key, data }) => ({
                ...dayPoints([{ day: key, data }], () => null)[0],
                // Without the activity estimate the total is unknown; the basal part alone
                // would read as a low day.
                values:
                  data && data.total_kcal_est !== null
                    ? [data.basal_kcal, data.activity_kcal_est]
                    : null,
              }))}
              series={[
                { label: "Bazál", color: COLOR.context },
                { label: "Aktivita ≈", color: COLOR.activity },
              ]}
              totalLabel="Spolu ≈"
              ariaLabel={`Odhad kalórií za posledných ${period} dní`}
              formatValue={formatKcal}
              formatTick={tickCompact}
              onSelect={open}
            />
          </ChartCard>
        </div>
      </section>

      <section>
        <SectionTitle
          aside={
            <Link href="/treningy" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Všetky tréningy →
            </Link>
          }
        >
          Posledné tréningy
        </SectionTitle>
        {recent.length === 0 ? (
          <p className="text-[14px] text-ink-2">Zatiaľ žiadny tréning.</p>
        ) : (
          <div className="rounded-2xl bg-surface px-5 py-3 ring-1 ring-ring sm:px-6">
            <WorkoutHead />
            <div className="divide-y divide-line">
              {recent.map((workout) => (
                <WorkoutRow key={workout.id} workout={workout} timeZone={dataset.timezone} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function OverviewView() {
  return <WithData>{(dataset, now) => <Overview dataset={dataset} now={now} />}</WithData>;
}
