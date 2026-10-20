"use client";

// /kroky: steps today with their source, 30 or 90 days with the average, the weekday
// pattern, the distance estimate and the best days.

import { dayFigure, periodFigure } from "@/lib/day-values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ColumnChart } from "@/components/charts/charts";
import { dayPoints, tickCompact } from "@/components/charts/points";
import { WithData } from "@/components/shell/shell";
import { EmptyState } from "@/components/ui/parts";
import { mix, ScoreBar, TileShell } from "@/components/ui/tile";
import {
  bestStepDays,
  STEPS_CATEGORIES,
  stepsCategory,
  stepsStats,
  weekdaySteps,
  weekendShare,
  type WeekdaySteps,
} from "@/lib/detail-activity";
import { DASH, formatDay, formatDecimal, formatDistance, formatInt, stepsSourceLabel } from "@/lib/format";
import { windowEnding } from "@/lib/metrics";
import { WEEKDAY_LETTERS } from "@/lib/overview";
import type { Dataset, Day } from "@/lib/types";
import { DetailHead, Figure, riseStyle, RunningHint } from "../common/bits";
import { CalibrationNote } from "../common/calibration";
import { ChartTile, Switch } from "../common/controls";
import { latestFocusOf } from "../common/focus";
import { Chip } from "../shared-b/parts";

const PERIODS = [
  { value: 30, label: "30 dní" },
  { value: 90, label: "90 dní" },
];
const PATTERN_DAYS = 90;

function StepsTodayTile({ day, isToday, average }: { day: Day; isToday: boolean; average: number | null }) {
  const running = day.complete === false;
  const steps = day.steps;
  const share = steps !== null && average ? steps / average : null;
  const category = stepsCategory(average);
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">{isToday ? "Kroky dnes" : `Kroky · ${formatDay(day.day)}`}</h2>
        {running && <RunningHint />}
      </div>
      <div className="figure text-[clamp(64px,8vw,104px)] tracking-[-0.045em]">{formatInt(steps)}</div>
      <div className="flex flex-col gap-2">
        <ScoreBar share={share === null ? null : Math.min(1, share)} color="var(--accent)" />
        <p className="text-[13px] text-ink2">
          {share === null
            ? "Na porovnanie s priemerom je zatiaľ málo dní."
            : `${formatInt(share * 100)} % tvojho priemeru za 30 dní (${formatInt(average)})${running ? ", deň ešte beží" : ""}`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Figure label="Vzdialenosť" value={dayFigure(day, "distance", formatDistance)} note="zo zariadenia alebo odhad z krokov" />
        <Figure label="Zdroj" value={<span className="text-[18px]">{stepsSourceLabel(day.steps_source)}</span>} note="vybraný zdroj bez sčítania duplicít" />
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-4">
        <p className="text-[14px] text-ink2">
          Priemer 30 dní: <span className="font-semibold text-ink">{category?.label ?? DASH}</span>
        </p>
        <p className="text-[12px] text-muted">
          {[...STEPS_CATEGORIES].reverse().map((item, index, list) => (
            <span key={item.label} className={item === category ? "font-semibold text-ink" : undefined}>
              {index > 0 && " · "}
              {index === list.length - 1 ? `od ${formatInt(item.from)}` : `do ${formatInt(list[index + 1].from - 1)}`} {item.label}
            </span>
          ))}
        </p>
        <p className="text-[12px] text-muted">Kategórie podľa Tudor-Locke. Prínos pre zdravie rastie zhruba do 8 000–10 000 krokov.</p>
      </div>
    </TileShell>
  );
}

function StepsChartTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(30);
  const slots = windowEnding(dataset.days, date, period);
  const points = dayPoints(slots, (day) => day.steps);
  const stats = stepsStats(dataset.days, date, period);
  return (
    <ChartTile
      label={`Kroky · ${period} dní`}
      note={
        stats.average === null
          ? "Za toto obdobie bez krokov."
          : `Priemer ${formatInt(stats.average)} za deň z ${formatInt(stats.days)} ukončených dní · spolu ${formatInt(stats.total)}`
      }
      table={{
        columns: ["Deň", "Kroky", "Vzdialenosť", "Zdroj"],
        rows: slots
          .filter((slot) => slot.data)
          .map((slot) => {
            const day = slot.data as Day;
            return [
              formatDay(day.day),
              `${formatInt(day.steps)}${day.complete === false ? " (zatiaľ)" : ""}`,
              dayFigure(day, "distance", formatDistance),
              stepsSourceLabel(day.steps_source),
            ];
          })
          .reverse(),
      }}
    >
      <Switch options={PERIODS} value={period} onChange={setPeriod} label="Obdobie" className="self-start" />
      <ColumnChart
        points={points}
        color="var(--accent)"
        reference={stats.average === null ? null : { value: stats.average, label: `priemer ${formatInt(stats.average)}` }}
        ariaLabel={`Kroky za ${period} dní, priemer ${formatInt(stats.average)} za deň`}
        formatValue={(value) => `${formatInt(value)} krokov`}
        formatTick={tickCompact}
        onSelect={(key) => router.push(`/den/${key}`)}
        height={300}
      />
    </ChartTile>
  );
}

function WeekdayBars({ pattern }: { pattern: WeekdaySteps[] }) {
  const top = Math.max(...pattern.map((item) => item.average ?? 0), 1);
  return (
    <div className="grid grid-cols-7 items-end gap-1.5 sm:gap-2.5">
      {pattern.map((item) => (
        <div key={item.weekday} className="flex min-w-0 flex-col items-center gap-1.5">
          <span className="mono text-[10px] whitespace-nowrap text-ink2 sm:text-[11px]">
            {item.average === null ? DASH : `${formatDecimal(item.average / 1000, 1)}`}
          </span>
          <div className="flex h-[120px] w-full items-end">
            <div
              className="w-full rounded-t-[4px] rounded-b-[1px]"
              style={{
                height: item.average === null ? 0 : `${Math.max(4, (item.average / top) * 100)}%`,
                background: item.weekday >= 5 ? "var(--accent)" : mix("var(--accent)", 55),
              }}
            />
          </div>
          <span className="text-[12px] text-ink2">{WEEKDAY_LETTERS[item.weekday]}</span>
        </div>
      ))}
    </div>
  );
}

function WeekdayTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const pattern = weekdaySteps(dataset.days, date, PATTERN_DAYS);
  const share = weekendShare(pattern);
  const busiest = pattern.reduce<WeekdaySteps | null>((best, item) => (item.average !== null && (!best || item.average > (best.average ?? 0)) ? item : best), null);
  const names = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"];
  const sentence =
    share === null
      ? "Na porovnanie dní v týždni je zatiaľ málo dát."
      : Math.abs(share) < 0.1
        ? "Cez víkend a v pracovné dni prejdeš zhruba rovnako."
        : share > 0
          ? `Cez víkend prejdeš o ${formatInt(share * 100)} % viac než v pracovné dni.`
          : `V pracovné dni prejdeš o ${formatInt(-share / (1 + share) * 100)} % viac než cez víkend.`;
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <h2 className="eyebrow">Dni v týždni · {PATTERN_DAYS} dní</h2>
      <p className="text-[19px] leading-snug font-medium tracking-[-0.01em]">{sentence}</p>
      <div role="img" aria-label={`Priemerné kroky podľa dňa v týždni: ${pattern.map((item) => `${names[item.weekday]} ${formatInt(item.average)}`).join(", ")}`}>
        <WeekdayBars pattern={pattern} />
      </div>
      <p className="text-[12px] text-muted">
        Tisíce krokov priemerne za deň, len ukončené dni. Víkend sýtejšou farbou.
        {busiest ? ` Najviac chodíš v ${busiest.weekday === 2 ? "stredu" : busiest.weekday === 5 ? "sobotu" : busiest.weekday === 6 ? "nedeľu" : names[busiest.weekday]}.` : ""}
      </p>
    </TileShell>
  );
}

function DistanceTile({ dataset, day }: { dataset: Dataset; day: Day }) {
  const week = stepsStats(dataset.days, day.day, 7);
  const month = stepsStats(dataset.days, day.day, 30);
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <h2 className="eyebrow">Vzdialenosť</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Figure label={day.complete === false ? "Dnes, zatiaľ" : "V ten deň"} value={dayFigure(day, "distance", formatDistance)} />
        <Figure label="Priemer za deň · 30 dní" value={periodFigure(dataset.days, day.day, 30, "distance", month.distanceAverage, formatDistance)} />
        <Figure label="Posledných 7 dní" value={periodFigure(dataset.days, day.day, 7, "distance", week.distance, formatDistance)} note="ukončené dni" />
        <Figure label="Posledných 30 dní" value={periodFigure(dataset.days, day.day, 30, "distance", month.distance, formatDistance)} note="ukončené dni" />
      </div>
      <CalibrationNote calibration={dataset.calibration} targets={[{ key: "distance_km" }]} />
      <p className="text-[12px] text-muted">
        Vzdialenosť má prednosť zo zariadenia. Keď chýba, používa sa odhad z krokov označený ≈. Tréningy môžu mať vlastnú GPS vzdialenosť.
      </p>
    </TileShell>
  );
}

function BestDaysTile({ dataset, date }: { dataset: Dataset; date: string }) {
  const best = bestStepDays(dataset.days, date, PATTERN_DAYS, 5);
  return (
    <TileShell className="gap-2 p-6 sm:p-[30px]">
      <h2 className="eyebrow pb-2">Najlepšie dni · {PATTERN_DAYS} dní</h2>
      {best.length === 0 ? (
        <p className="text-[14px] text-ink2">Zatiaľ žiadny ukončený deň s krokmi.</p>
      ) : (
        <ol className="flex flex-col">
          {best.map((item, index) => (
            <li key={item.day} className="border-t border-line first:border-0">
              <Link href={`/den/${item.day}`} className="row-link !mx-[-8px] !my-0 grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 !py-3">
                <span className="mono text-[12px] text-muted">{index + 1}.</span>
                <span className="figure-sm text-[24px] whitespace-nowrap">{formatInt(item.steps)}</span>
                <span className="text-right text-[12px] text-ink2">
                  {formatDay(item.day)}
                  <br />
                  {dayFigure(dataset.days.find((day) => day.day === item.day), "distance", formatDistance)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </TileShell>
  );
}

function Steps({ dataset, now }: { dataset: Dataset; now: Date }) {
  const focus = latestFocusOf(dataset, now);
  const day = focus.day;
  if (!day) return <EmptyState title="Pre tento deň nie sú dáta">Kroky sa objavia po ďalšej synchronizácii.</EmptyState>;
  const month = stepsStats(dataset.days, day.day, 30);
  return (
    <>
      <DetailHead section="Kroky" title="Kroky">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {focus.isToday ? "Dnes" : formatDay(day.day)} · {formatInt(day.steps)} krokov · zdroj {stepsSourceLabel(day.steps_source)}
          {day.complete === false && <RunningHint />}
          {focus.label && <Chip tone="warn">{focus.label}</Chip>}
        </span>
      </DetailHead>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rise grid min-w-0" style={riseStyle(1)}>
          <StepsTodayTile day={day} isToday={focus.isToday} average={month.average} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(2)}>
          <StepsChartTile dataset={dataset} date={day.day} />
        </div>
      </div>

      <div className="grid gap-[18px] md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rise grid min-w-0 md:col-span-2 xl:col-span-1" style={riseStyle(3)}>
          <WeekdayTile dataset={dataset} date={day.day} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(4)}>
          <DistanceTile dataset={dataset} day={day} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(5)}>
          <BestDaysTile dataset={dataset} date={day.day} />
        </div>
      </div>
    </>
  );
}

export function StepsView() {
  return <WithData>{(dataset, now) => <Steps dataset={dataset} now={now} />}</WithData>;
}
