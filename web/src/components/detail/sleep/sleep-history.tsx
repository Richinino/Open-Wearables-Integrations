"use client";

// The history half of the sleep page: the chosen score night by night, sleep against the
// need, bed and wake times, regularity, and every night as a table row.

import { useRouter } from "next/navigation";
import { ColumnChart, estimateSwatch, RangeChart } from "@/components/charts/charts";
import { tickPlain } from "@/components/charts/points";
import { DataTable } from "@/components/ui/parts";
import { TileShell } from "@/components/ui/tile";
import {
  clockSummary,
  needCoverage,
  nightScore,
  SLEEP_KINDS,
  sleepScoreOf,
  SRI_MEDIAN,
  type NightPoint,
  type SleepKind,
} from "@/lib/detail-sleep";
import {
  approx,
  DASH,
  formatClock,
  formatClockMinutes,
  formatDay,
  formatDayMonth,
  formatDuration,
  formatInt,
  formatTimeOfDay,
  plural,
} from "@/lib/format";
import { average, sleepNights } from "@/lib/metrics";
import { learningText } from "@/lib/samsung";
import { formatScore, scoreValue } from "@/lib/scores";
import type { Dataset, Day } from "@/lib/types";
import { Keys } from "../common/bits";
import { ChartTile } from "../common/controls";
import { TrendChart } from "../common/trend-chart";
import { NeedChart } from "./need-chart";

const CLOCK_STEP = 120;

function nightsWord(count: number) {
  return plural(count, "noci", "nocí", "nocí");
}

export function SleepHistory({
  dataset,
  points,
  kind,
}: {
  dataset: Dataset;
  points: NightPoint[];
  kind: SleepKind;
}) {
  const router = useRouter();
  const open = (day: string) => router.push(`/den/${day}`);
  const tz = dataset.timezone;
  const info = SLEEP_KINDS[kind];
  const end = points[points.length - 1].day;
  const period = points.length;
  const scored = points.filter((point) => point.score !== null);
  const mean = average(scored.map((point) => point.score));
  const topFrom = info.top;
  const strong = scored.filter((point) => (point.score as number) >= topFrom).length;
  const estimated = scored.filter((point) => point.estimate).length;
  const sent = scored.length - estimated;
  const shownScore = (value: number, estimate: boolean) => (estimate ? approx(formatInt(value)) : formatInt(value));
  // A mean with any estimate in it is an estimate too.
  const shownMean = (value: number) => shownScore(value, estimated > 0);
  const learning = learningText(sleepScoreOf(points[points.length - 1].data, kind));
  // For Samsung: how many nights are its own number and how many owi's estimate.
  const sources =
    kind === "samsung" && scored.length > 0
      ? estimated === 0
        ? "všetko zo Samsungu"
        : sent === 0
          ? "odhad owi"
          : `zo Samsungu ${formatInt(sent)}, odhad owi (≈) ${formatInt(estimated)}`
      : null;
  const coverage = needCoverage(points);
  const clock = clockSummary(dataset.days, tz, end, period);
  const nights = sleepNights(
    points.flatMap((point) => (point.data ? [point.data] : [])),
    tz,
  );
  const nightByDay = new Map(nights.map((night) => [night.day, night]));
  const first = Math.floor(Math.min(...nights.map((night) => night.bedMinutes), 600) / CLOCK_STEP);
  const last = Math.ceil(Math.max(...nights.map((night) => night.wakeMinutes), 1200) / CLOCK_STEP);
  const clockTicks = Array.from({ length: last - first + 1 }, (_, at) => (first + at) * CLOCK_STEP);
  const regular = points.map((point) => point.regularity);

  return (
    <>
      <div className="grid gap-[18px] lg:grid-cols-2">
        <ChartTile
          label={`${info.label} po nociach`}
          note={
            scored.length === 0
              ? learning
                ? `${info.label} ${learning}.`
                : "Za toto obdobie zatiaľ bez skóre."
              : `Priemer ${shownMean(mean as number)} · ${topFrom} a viac v ${formatInt(strong)} z ${formatInt(scored.length)} ${nightsWord(scored.length)} · ${
                  sources ?? `metóda podľa ${info.vendor}${info.estimate ? ", odhad" : ""}`
                }`
          }
          legend={
            sent > 0 && estimated > 0 ? (
              <Keys
                items={[
                  { label: "zo Samsungu", color: "var(--sleep)" },
                  { label: "odhad owi", color: estimateSwatch("var(--sleep)") },
                ]}
              />
            ) : undefined
          }
          table={{
            columns: ["Deň", info.label, "Pásmo"],
            rows: scored
              .map((point) => [formatDay(point.day), shownScore(point.score as number, point.estimate), info.band(point.score)?.label ?? DASH])
              .reverse(),
          }}
        >
          <ColumnChart
            points={points.map((point) => ({
              key: point.day,
              label: formatDayMonth(point.day),
              title: formatDay(point.day),
              value: point.score,
              estimate: point.estimate,
            }))}
            color="var(--sleep)"
            ticks={[0, 25, 50, 75, 100]}
            reference={mean === null ? null : { value: mean, label: `priemer ${shownMean(mean)}` }}
            ariaLabel={`${info.label} za posledných ${period} nocí, priemer ${formatInt(mean)}${
              estimated > 0 ? `, ${formatInt(estimated)} ${nightsWord(estimated)} odhad owi` : ""
            }`}
            formatValue={(value) => formatInt(value)}
            formatTick={tickPlain}
            onSelect={open}
          />
        </ChartTile>

        <ChartTile
          label="Spánok oproti potrebe"
          note={
            coverage.nights === 0
              ? "Potreba spánku sa za toto obdobie zatiaľ nepočítala."
              : `Potrebu si pokryl v ${formatInt(coverage.covered)} z ${formatInt(coverage.nights)} ${nightsWord(coverage.nights)}${
                  coverage.shortfall === null ? "." : `; keď nie, chýbalo priemerne ${formatDuration(coverage.shortfall)}.`
                }`
          }
          legend={
            <Keys
              items={[
                { label: "spánok", color: "var(--sleep)" },
                { label: "potreba", color: "var(--ink)", line: true },
              ]}
            />
          }
          table={{
            columns: ["Deň", "Spánok", "Potreba", "Rozdiel"],
            rows: points
              .filter((point) => point.minutes !== null || point.need !== null)
              .map((point) => [
                formatDay(point.day),
                formatDuration(point.minutes),
                formatDuration(point.need),
                point.minutes === null || point.need === null
                  ? DASH
                  : point.minutes >= point.need
                    ? `+${formatDuration(point.minutes - point.need)}`
                    : `−${formatDuration(point.need - point.minutes)}`,
              ])
              .reverse(),
          }}
        >
          <NeedChart points={points} ariaLabel={`Spánok a potreba spánku za posledných ${period} nocí`} onSelect={open} />
        </ChartTile>

        <ChartTile
          label="Kedy spíš"
          note={
            clock
              ? `Zaspávaš ${formatTimeOfDay(clock.bedEarliest)}–${formatTimeOfDay(clock.bedLatest)}, priemerne ${formatTimeOfDay(clock.bedMean)} (± ${clock.bedSpread} min). Vstávaš ${formatTimeOfDay(clock.wakeEarliest)}–${formatTimeOfDay(clock.wakeLatest)}, priemerne ${formatTimeOfDay(clock.wakeMean)}.`
              : "Za toto obdobie bez nocí."
          }
          table={{
            columns: ["Deň", "Zaspatie", "Zobudenie"],
            rows: nights
              .map((night) => [formatDay(night.day), formatClock(night.start, tz), formatClock(night.end, tz)])
              .reverse(),
          }}
        >
          <RangeChart
            points={points.map((point) => {
              const night = nightByDay.get(point.day);
              return {
                key: point.day,
                label: formatDayMonth(point.day),
                title: formatDay(point.day),
                range: night ? ([night.bedMinutes, night.wakeMinutes] as [number, number]) : null,
              };
            })}
            color="var(--sleep)"
            ticks={clockTicks}
            ariaLabel={`Časy zaspatia a zobudenia za posledných ${period} nocí`}
            formatTick={formatClockMinutes}
            formatRange={([from, to]) => `${formatClockMinutes(from)} – ${formatClockMinutes(to)}`}
            onSelect={open}
          />
        </ChartTile>

        <ChartTile
          label="Pravidelnosť (SRI) deň po dni"
          note={`Index za vždy posledných 14 dní. Čiarkovaná čiara je medián dospelých, ${SRI_MEDIAN}.`}
          table={{
            columns: ["Deň", "SRI"],
            rows: points.filter((point) => point.regularity !== null).map((point) => [formatDay(point.day), formatInt(point.regularity)]).reverse(),
          }}
        >
          <TrendChart
            keys={points.map((point) => point.day)}
            labels={points.map((point) => formatDayMonth(point.day))}
            titles={points.map((point) => formatDay(point.day))}
            series={[{ label: "SRI", color: "var(--sleep)", values: regular }]}
            guides={[{ value: SRI_MEDIAN, label: `medián ${SRI_MEDIAN}`, labelAt: "start" }]}
            formatValue={(value) => formatInt(value)}
            formatTick={tickPlain}
            ariaLabel={`Pravidelnosť spánku za posledných ${period} dní`}
            onSelect={open}
          />
        </ChartTile>
      </div>

      <NightsTable dataset={dataset} points={points} />
    </>
  );
}

/** Samsung's own Sleep Score as is, owi's estimate with ≈, or a dash. */
function samsungCell(day: Day): string {
  const night = nightScore(day, "samsung");
  if (night.value === null) return DASH;
  return night.estimate ? approx(formatInt(night.value)) : formatInt(night.value);
}

function NightsTable({ dataset, points }: { dataset: Dataset; points: NightPoint[] }) {
  const tz = dataset.timezone;
  const rows = points
    .flatMap((point) => {
      const day = point.data;
      if (!day || (point.minutes === null && !day.sleep_start)) return [];
      return [[
        formatDay(point.day),
        formatClock(day.sleep_start, tz),
        formatClock(day.sleep_end, tz),
        formatDuration(day.sleep_minutes),
        formatDuration(point.need),
        scoreValue(day.scores?.sleep_performance) === null ? DASH : formatScore(day.scores?.sleep_performance),
        scoreValue(day.scores?.apple_sleep) === null ? DASH : formatScore(day.scores?.apple_sleep),
        samsungCell(day),
        formatDuration(day.sleep_deep_min),
        formatDuration(day.sleep_rem_min),
        formatDuration(day.sleep_light_min),
        formatDuration(day.sleep_awake_min),
        day.nap_minutes ? formatDuration(day.nap_minutes) : DASH,
      ]];
    })
    .reverse();
  return (
    <TileShell className="gap-4 p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Noci · {formatInt(rows.length)}</h2>
        <p className="text-[12px] text-muted">deň = ráno, keď sa noc skončila · posúvaj do strany</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-[14px] text-ink2">Za toto obdobie nie sú žiadne noci.</p>
      ) : (
        <DataTable
          columns={["Deň", "Zaspatie", "Zobudenie", "Spánok", "Potreba", "Sleep Perf.", "Sleep Score", "Samsung", "Hlboký", "REM", "Ľahký", "Bdenie", "Zdriemnutie"]}
          rows={rows}
          maxHeight={460}
        />
      )}
    </TileShell>
  );
}
