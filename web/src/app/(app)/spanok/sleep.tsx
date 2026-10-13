"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { durationTicks, RangeChart, StackedColumnChart } from "@/components/charts/charts";
import { tickDuration } from "@/components/charts/points";
import { COLOR, STAGES } from "@/components/domain";
import { WithData } from "@/components/shell/shell";
import {
  Card,
  ChartCard,
  DataTable,
  Delta,
  EmptyState,
  SectionTitle,
  Segmented,
  StatTile,
} from "@/components/ui/parts";
import { todayIn } from "@/lib/dates";
import {
  DASH,
  formatClockMinutes,
  formatDay,
  formatDayMonth,
  formatDuration,
  formatInt,
} from "@/lib/format";
import {
  average,
  averageClock,
  indexByDay,
  periodSummary,
  sleepNights,
  sum,
  windowEnding,
} from "@/lib/metrics";
import type { Dataset } from "@/lib/types";

const PERIODS = [
  { value: 14, label: "14 nocí" },
  { value: 30, label: "30 nocí" },
  { value: 90, label: "90 nocí" },
];

const CLOCK_STEP = 120;

function Sleep({ dataset, now }: { dataset: Dataset; now: Date }) {
  const router = useRouter();
  const [period, setPeriod] = useState(30);
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);
  const nightByDay = useMemo(
    () => new Map(sleepNights(dataset.days, dataset.timezone).map((night) => [night.day, night])),
    [dataset.days, dataset.timezone],
  );

  const today = todayIn(dataset.timezone, now);
  const end = byDay.has(today) ? today : (dataset.last_day ?? today);
  const slots = windowEnding(dataset.days, end, period);
  const nights = slots.flatMap((slot) => nightByDay.get(slot.day) ?? []);
  const open = (key: string) => router.push(`/den/${key}`);
  const versus = `oproti predošlým ${period} nociam`;

  const duration = periodSummary(dataset.days, end, period, "sleep_minutes", {
    includeIncomplete: true,
  });
  const bedtime = averageClock(nights.map((night) => night.bedMinutes));
  const wake = averageClock(nights.map((night) => night.wakeMinutes));
  const deep = average(nights.map((night) => night.deep));
  const staged = nights.filter((night) => night.deep !== null && night.minutes);
  const deepShare =
    staged.length === 0
      ? null
      : (sum(staged.map((night) => night.deep)) ?? 0) /
        (sum(staged.map((night) => night.minutes)) ?? 1);

  const stagePoints = slots.map(({ day }) => {
    const night = nightByDay.get(day);
    const values = night ? [night.deep, night.rem, night.light, night.awake] : null;
    return {
      key: day,
      label: formatDayMonth(day),
      title: formatDay(day),
      values: values && values.some((value) => value !== null) ? values : null,
    };
  });
  const tallest = Math.max(
    ...stagePoints.map((point) => point.values?.reduce<number>((acc, v) => acc + (v ?? 0), 0) ?? 0),
    60,
  );

  const first = Math.floor(Math.min(...nights.map((night) => night.bedMinutes), 600) / CLOCK_STEP);
  const last = Math.ceil(Math.max(...nights.map((night) => night.wakeMinutes), 1200) / CLOCK_STEP);
  const clockTicks = Array.from({ length: last - first + 1 }, (_, at) => (first + at) * CLOCK_STEP);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="rise">
          <p className="eyebrow">Spánok</p>
          <h1 className="figure mt-3 text-[56px] sm:text-[76px]">{formatDuration(duration.average)}</h1>
          <p className="mt-3 text-[14px] text-ink-2">
            priemerne za noc ·{" "}
            <Delta change={duration.change} upIsGood label={versus} />
          </p>
        </div>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Obdobie" />
      </div>

      {nights.length === 0 ? (
        <EmptyState title="Za toto obdobie nie sú žiadne noci">
          Skús dlhšie obdobie, alebo počkaj na ďalšiu synchronizáciu.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              className="rise"
              label="Zaspávanie"
              value={formatClockMinutes(bedtime)}
              hint="priemerný čas"
            />
            <StatTile
              className="rise"
              style={{ "--i": 1 } as React.CSSProperties}
              label="Vstávanie"
              value={formatClockMinutes(wake)}
              hint="priemerný čas"
            />
            <StatTile
              className="rise"
              style={{ "--i": 2 } as React.CSSProperties}
              label="Hlboký spánok"
              value={deepShare === null ? DASH : `${formatInt(deepShare * 100)} %`}
              hint={deep === null ? undefined : `priemerne ${formatDuration(deep)}`}
            />
            <StatTile
              className="rise"
              style={{ "--i": 3 } as React.CSSProperties}
              label="Zaznamenané noci"
              value={formatInt(nights.length)}
              hint={`z ${period}`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Fázy spánku"
              subtitle="Koľko z noci pripadlo na ktorú fázu"
              legend={[...STAGES]}
              height={260}
              table={{
                columns: ["Deň", ...STAGES.map((stage) => stage.label)],
                rows: nights
                  .map((night) => [
                    formatDay(night.day),
                    formatDuration(night.deep),
                    formatDuration(night.rem),
                    formatDuration(night.light),
                    formatDuration(night.awake),
                  ])
                  .reverse(),
              }}
            >
              <StackedColumnChart
                points={stagePoints}
                series={[...STAGES]}
                totalLabel="V posteli"
                ticks={durationTicks(tallest)}
                ariaLabel={`Fázy spánku za posledných ${period} nocí`}
                formatValue={formatDuration}
                formatTick={tickDuration}
                onSelect={open}
                height={260}
              />
            </ChartCard>

            <ChartCard
              title="Kedy spíš"
              subtitle="Od zaspatia po zobudenie, noc po noci"
              height={260}
              table={{
                columns: ["Deň", "Zaspatie", "Zobudenie"],
                rows: nights
                  .map((night) => [
                    formatDay(night.day),
                    formatClockMinutes(night.bedMinutes),
                    formatClockMinutes(night.wakeMinutes),
                  ])
                  .reverse(),
              }}
            >
              <RangeChart
                points={slots.map(({ day }) => {
                  const night = nightByDay.get(day);
                  return {
                    key: day,
                    label: formatDayMonth(day),
                    title: formatDay(day),
                    range: night ? ([night.bedMinutes, night.wakeMinutes] as [number, number]) : null,
                  };
                })}
                color={COLOR.sleep}
                ticks={clockTicks}
                ariaLabel={`Časy zaspatia a zobudenia za posledných ${period} nocí`}
                formatTick={formatClockMinutes}
                formatRange={([from, to]) =>
                  `${formatClockMinutes(from)} – ${formatClockMinutes(to)}`
                }
                onSelect={open}
                height={260}
              />
            </ChartCard>
          </div>

          <section>
            <SectionTitle>Noci</SectionTitle>
            <Card className="!py-2">
              <DataTable
                columns={[
                  "Deň",
                  "Zaspatie",
                  "Zobudenie",
                  "Spánok",
                  "Hlboký",
                  "REM",
                  "Ľahký",
                  "Bdenie",
                  "Zdriemnutie",
                ]}
                rows={nights
                  .map((night) => [
                    formatDay(night.day),
                    formatClockMinutes(night.bedMinutes),
                    formatClockMinutes(night.wakeMinutes),
                    formatDuration(night.minutes),
                    formatDuration(night.deep),
                    formatDuration(night.rem),
                    formatDuration(night.light),
                    formatDuration(night.awake),
                    night.nap ? formatDuration(night.nap) : DASH,
                  ])
                  .reverse()}
              />
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

export function SleepView() {
  return <WithData>{(dataset, now) => <Sleep dataset={dataset} now={now} />}</WithData>;
}
