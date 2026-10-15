"use client";

// /tep: resting heart rate today and over 30 or 90 days, the day's lowest, mean and highest
// heart rate, time in zones and the night heart rate against its baseline.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LineChart } from "@/components/charts/charts";
import { dayPoints, tickPlain } from "@/components/charts/points";
import { WithData } from "@/components/shell/shell";
import { EmptyState } from "@/components/ui/parts";
import { mix, TileShell } from "@/components/ui/tile";
import { nightHeartSeries, restingBaseline, restingComparison, restingTrend } from "@/lib/detail-heart";
import { DASH, formatDay, formatDayMonth, formatDecimal, formatInt } from "@/lib/format";
import { average, windowEnding } from "@/lib/metrics";
import type { Dataset, Day } from "@/lib/types";
import { DetailHead, Figure, Keys, riseStyle, RunningHint, VendorLine } from "../common/bits";
import { ChartTile, Switch } from "../common/controls";
import { focusOf } from "../common/focus";
import { TrendChart } from "../common/trend-chart";
import { ZonesTile } from "../common/zones";

const PERIODS = [
  { value: 30, label: "30 dní" },
  { value: 90, label: "90 dní" },
];

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function TodayHeartTile({ dataset, day, isToday }: { dataset: Dataset; day: Day; isToday: boolean }) {
  const running = day.complete === false;
  const trend = restingTrend(dataset.days, day.day, 30);
  const baseline = restingBaseline(dataset.days, day.day);
  const low = isNumber(day.hr_min) ? day.hr_min : null;
  const high = isNumber(day.hr_max) ? day.hr_max : null;
  const scaleFrom = 30;
  const scaleTo = Math.max(200, high ?? 0);
  const at = (value: number) => ((value - scaleFrom) / (scaleTo - scaleFrom)) * 100;
  const change = trend.change === null ? null : Math.round(trend.change);
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">{isToday ? "Pokojový tep dnes" : `Pokojový tep · ${formatDay(day.day)}`}</h2>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <div className="figure text-[clamp(64px,8vw,104px)] tracking-[-0.045em]">{formatInt(day.hr_resting)}</div>
        <div className="text-[15px] text-ink2">bpm</div>
      </div>
      <p className="text-[14px] text-ink2">{restingComparison(day.hr_resting, baseline)}</p>
      <p className="text-[13px] text-muted">
        {change === null
          ? "Na porovnanie s minulým mesiacom je zatiaľ málo dát."
          : change === 0
            ? `Týždenný priemer ${formatInt(trend.recent)} bpm, rovnako ako pred mesiacom.`
            : `Týždenný priemer ${formatInt(trend.recent)} bpm, o ${formatInt(Math.abs(change))} bpm ${change < 0 ? "nižší" : "vyšší"} než pred mesiacom.`}
      </p>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-[14px] font-semibold">Tep počas dňa</h3>
          {running && <RunningHint />}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Figure size="sm" label="Najnižší" value={formatInt(low)} unit="bpm" />
          <Figure size="sm" label="Priemer" value={formatInt(day.hr_avg)} unit="bpm" />
          <Figure size="sm" label="Najvyšší" value={formatInt(high)} unit="bpm" />
        </div>
        {low !== null && high !== null && (
          <div
            className="relative h-2.5 rounded-full bg-track"
            role="img"
            aria-label={`Rozsah tepu ${isToday ? "dnes" : "v ten deň"} od ${formatInt(low)} do ${formatInt(high)} bpm, priemer ${formatInt(day.hr_avg)}`}
          >
            <div
              className="absolute inset-y-0 rounded-full"
              style={{ left: `${at(low)}%`, width: `${Math.max(at(high) - at(low), 1)}%`, background: mix("var(--heart)", 45) }}
            />
            {isNumber(day.hr_avg) && (
              <div
                className="absolute -top-1.5 h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-heart"
                style={{ left: `${at(day.hr_avg)}%`, boxShadow: "0 0 0 2px var(--surface)" }}
              />
            )}
          </div>
        )}
        <div className="mono flex justify-between text-[10px] text-muted" aria-hidden="true">
          <span>{scaleFrom}</span>
          <span>{Math.round((scaleFrom + scaleTo) / 2)}</span>
          <span>{scaleTo} bpm</span>
        </div>
        <p className="text-[12px] text-muted">
          Pokojový tep je najnižší 30-minútový priemer dňa. Najnižší a najvyšší tep sú z minútových priemerov.
        </p>
      </div>
    </TileShell>
  );
}

function RestingTrendTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(30);
  const slots = windowEnding(dataset.days, date, period);
  const points = dayPoints(slots, (day) => day.hr_resting, { partial: false });
  const values = points.map((point) => point.value);
  const mean = average(values);
  const known = values.filter(isNumber);
  return (
    <ChartTile
      label={`Pokojový tep · ${period} dní`}
      note={
        mean === null
          ? "Za toto obdobie bez pokojového tepu."
          : `Priemer ${formatInt(mean)} bpm · najnižší ${formatInt(Math.min(...known))}, najvyšší ${formatInt(Math.max(...known))} · nižší pokojový tep zvyčajne sprevádza lepšiu kondíciu`
      }
      table={{
        columns: ["Deň", "Pokojový tep", "Najnižší", "Priemer", "Najvyšší"],
        rows: slots
          .filter((slot) => slot.data)
          .map((slot) => {
            const day = slot.data as Day;
            return [formatDay(day.day), `${formatInt(day.hr_resting)} bpm`, formatInt(day.hr_min), formatInt(day.hr_avg), formatInt(day.hr_max)];
          })
          .reverse(),
      }}
    >
      <Switch options={PERIODS} value={period} onChange={setPeriod} label="Obdobie" className="self-start" />
      <LineChart
        points={points}
        color="var(--heart)"
        ariaLabel={`Pokojový tep za ${period} dní, priemer ${formatInt(mean)} bpm`}
        formatValue={(value) => `${formatInt(value)} bpm`}
        formatTick={tickPlain}
        onSelect={(key) => router.push(`/den/${key}`)}
        height={300}
      />
    </ChartTile>
  );
}

const LEVEL_WORD = { green: "zelená", yellow: "žltá", red: "červená" } as const;

function NightHeartTile({ dataset, date, length = 30 }: { dataset: Dataset; date: string; length?: number }) {
  const router = useRouter();
  const series = nightHeartSeries(dataset.days, date, length);
  const flagged = series
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.level === "yellow" || point.level === "red");
  const last = [...series].reverse().find((point) => point.nightHr !== null) ?? null;
  return (
    <ChartTile
      label={`Nočný tep oproti normálu · ${length} dní`}
      note={
        last
          ? `Posledná noc ${formatInt(last.nightHr)} bpm, normál ${formatInt(last.baseline)} bpm. ${
              flagged.length === 0 ? "Žiadna noc nebola zvýšená." : `Zvýšené noci: ${formatInt(flagged.length)}.`
            }`
          : "Za toto obdobie bez nočného tepu."
      }
      table={{
        columns: ["Deň", "Nočný tep", "Normál", "Rozdiel", "Stav"],
        rows: series
          .filter((point) => point.nightHr !== null)
          .map((point) => [
            formatDay(point.day),
            `${formatDecimal(point.nightHr, 1)} bpm`,
            `${formatDecimal(point.baseline, 1)} bpm`,
            point.nightHr !== null && point.baseline !== null
              ? `${point.nightHr >= point.baseline ? "+" : "−"}${formatDecimal(Math.abs(point.nightHr - point.baseline), 1)}`
              : DASH,
            point.level ? LEVEL_WORD[point.level] : DASH,
          ])
          .reverse(),
      }}
    >
      <TrendChart
        keys={series.map((point) => point.day)}
        labels={series.map((point) => formatDayMonth(point.day))}
        titles={series.map((point) => formatDay(point.day))}
        series={[
          { label: "nočný tep", color: "var(--heart)", values: series.map((point) => point.nightHr) },
          { label: "normál", color: "var(--ink2)", values: series.map((point) => point.baseline), dashed: true, thin: true },
        ]}
        marks={flagged.map(({ point, index }) => ({
          index,
          color: point.level === "red" ? "var(--bad)" : "var(--warn)",
          ring: point.level === "yellow",
        }))}
        notes={(index) => {
          const level = series[index].level;
          return level === "yellow" || level === "red" ? `${LEVEL_WORD[level]} noc` : undefined;
        }}
        formatValue={(value) => `${formatDecimal(value, 1)} bpm`}
        formatTick={tickPlain}
        ariaLabel={`Nočný tep za ${length} dní oproti tvojmu normálu`}
        onSelect={(key) => router.push(`/den/${key}`)}
        height={240}
      />
      <Keys
        items={[
          { label: "nočný tep", color: "var(--heart)", line: true },
          { label: "tvoj normál", color: "var(--ink2)", dashed: true },
          { label: "žltá noc (krúžok)", color: "var(--warn)" },
          { label: "červená noc (bod)", color: "var(--bad)" },
        ]}
      />
      <p className="text-[12px] text-muted">
        Priemer tepu počas spánku medzi polnocou a 7:00. Normál je medián predošlých nocí. Podrobnosti a história varovaní
        sú v Pripravenosti. Pozorovanie z dát, nie diagnóza.
      </p>
      <VendorLine>Metóda NightSignal · Alavi 2022</VendorLine>
    </ChartTile>
  );
}

function Heart({ dataset, now }: { dataset: Dataset; now: Date }) {
  const focus = focusOf(dataset, now);
  const day = focus.day;
  if (!day) return <EmptyState title="Pre tento deň nie sú dáta">Tep sa objaví po ďalšej synchronizácii.</EmptyState>;
  return (
    <>
      <DetailHead section="Pokojový tep" title="Pokojový tep">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {focus.isToday ? "Dnes" : formatDay(day.day)} · {formatInt(day.hr_resting)} bpm
          {isNumber(day.hr_min) && isNumber(day.hr_max) ? ` · počas dňa ${formatInt(day.hr_min)}–${formatInt(day.hr_max)} bpm` : ""}
        </span>
      </DetailHead>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rise grid min-w-0" style={riseStyle(1)}>
          <TodayHeartTile dataset={dataset} day={day} isToday={focus.isToday} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(2)}>
          <RestingTrendTile dataset={dataset} date={day.day} />
        </div>
      </div>

      <div className="grid gap-[18px] lg:grid-cols-2">
        <div className="rise grid min-w-0" style={riseStyle(3)}>
          <NightHeartTile dataset={dataset} date={day.day} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(4)}>
          <ZonesTile dataset={dataset} date={day.day} day={day} isToday={focus.isToday} />
        </div>
      </div>
    </>
  );
}

export function HeartView() {
  return <WithData>{(dataset, now) => <Heart dataset={dataset} now={now} />}</WithData>;
}
