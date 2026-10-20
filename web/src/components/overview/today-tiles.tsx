"use client";

import { dayFigure, dayValue, periodFigure } from "@/lib/day-values";
import { useId } from "react";
import { trendPaths } from "@/components/charts/paths";
import { ROUTES } from "@/components/shell/nav";
import { MiniBars, STAGE_COLORS, STAGE_LABELS, StageStrip, Tile, TileShell, TileTitle } from "@/components/ui/tile";
import { addDays } from "@/lib/dates";
import {
  approx,
  DASH,
  formatClock,
  formatDay,
  formatDayMonth,
  formatDistance,
  formatDuration,
  formatDurationCompact,
  formatInt,
  formatTimeOfDay,
} from "@/lib/format";
import { average, indexByDay, periodSummary, windowEnding, type NumericDayKey } from "@/lib/metrics";
import { sleepSegments, sleepWindow } from "@/lib/overview";
import type { Dataset, Day } from "@/lib/types";

interface TodayProps {
  dataset: Dataset;
  day: Day | null;
  date: string;
  isToday: boolean;
  /** "posledné dáta: včera" when the tiles show an older day because today has no data yet. */
  latest?: string | null;
}

/** The small note that the tile shows an older day while today has no data yet. */
function LatestNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <span className="mono inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-[3px] text-[11px] tracking-[0.04em] text-ink2">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
      {text}
    </span>
  );
}

function values(dataset: Dataset, end: string, length: number, key: NumericDayKey): (number | null)[] {
  return windowEnding(dataset.days, end, length).map(({ data }) => {
    const value = key === "resting_hr" ? dayValue(data, "restingHr") : data?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  });
}

/** Steps of the day in big, with the last 30 days as an area. */
export function StepsTile({ dataset, day, date, isToday, latest }: TodayProps) {
  // useId may contain characters that url(#…) does not accept.
  const gradient = `steps${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const month = values(dataset, date, 30, "steps");
  const summary = periodSummary(dataset.days, date, 30, "steps");
  const top = Math.max(...month.map((value) => value ?? 0), 1000);
  const paths = trendPaths(month, 600, 150, { low: 0, high: top, topPad: 10 });
  const ticks = [0, 7, 14, 21, 29].map((offset) => addDays(date, offset - 29));
  const change = summary.change;
  const percent = change === null ? null : Math.round(change * 100);

  return (
    <TileShell className="flex-auto gap-[18px] p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <TileTitle href={ROUTES.steps}>{isToday ? "Kroky dnes" : `Kroky · ${formatDay(date)}`}</TileTitle>
          <div className="figure mt-1 text-[clamp(64px,9vw,120px)] tracking-[-0.045em]">{formatInt(day?.steps ?? null)}</div>
        </div>
        <div className="flex flex-col items-start gap-1 pb-2.5 sm:items-end">
          <LatestNote text={latest} />
          <div className="text-[14px] text-ink2">30 dní · priemer {formatInt(summary.average)}</div>
          {percent !== null && percent !== 0 && (
            <div className={`text-[13px] ${percent > 0 ? "text-good-ink" : "text-ink2"}`}>
              {percent > 0 ? "↑" : "↓"} {formatInt(Math.abs(percent))} % oproti minulému mesiacu
            </div>
          )}
        </div>
      </div>
      <svg
        viewBox="0 0 600 150"
        preserveAspectRatio="none"
        className="block h-[150px] w-full overflow-visible"
        role="img"
        aria-label={`Kroky za posledných 30 dní, priemer ${formatInt(summary.average)} za deň`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.38 }} />
            <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d={paths.area} fill={`url(#${gradient})`} />
        <path
          d={paths.line}
          vectorEffect="non-scaling-stroke"
          style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }}
        />
      </svg>
      <div className="mono flex justify-between text-[11px] text-muted" aria-hidden="true">
        {ticks.map((tick, index) => (
          <div key={tick}>{index === ticks.length - 1 && isToday ? "dnes" : formatDayMonth(tick)}</div>
        ))}
      </div>
    </TileShell>
  );
}

/** Device values take precedence; only actual estimates carry the approximation mark. */
export function Minis({ dataset, day, date }: TodayProps) {
  const week = (key: NumericDayKey) => values(dataset, date, 7, key);
  const usual = (key: NumericDayKey) => periodSummary(dataset.days, date, 30, key).average;
  const minis = [
    {
      label: "Aktívny čas",
      href: ROUTES.activity,
      value: approx(formatDuration(day?.active_minutes_est)),
      note: `bežne ${approx(formatDuration(usual("active_minutes_est")))}`,
      bars: week("active_minutes_est"),
    },
    {
      label: "Kalórie",
      href: ROUTES.activity,
      value: dayFigure(day, "totalEnergy", formatInt),
      note: `z toho aktivita ${dayFigure(day, "activeEnergy", formatInt)}`,
      bars: week("total_kcal"),
    },
    {
      label: "Vzdialenosť",
      href: ROUTES.steps,
      value: dayFigure(day, "distance", formatDistance),
      note: `bežne ${periodFigure(dataset.days, date, 30, "distance", usual("distance_m"), formatDistance)}`,
      bars: week("distance_m"),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-[18px]">
      {minis.map((mini, index) => (
        <Tile
          key={mini.label}
          href={mini.href}
          label={mini.label}
          labelClassName="text-[12px] text-ink2"
          radius={24}
          // Two on a row on phones; the third takes the whole row instead of leaving a gap.
          className={`gap-3 p-[18px] sm:p-[22px] ${index === 2 ? "col-span-2 sm:col-span-1" : ""}`}
        >
          <div className="figure-sm text-[26px] whitespace-nowrap sm:text-[30px]">{mini.value}</div>
          <MiniBars values={mini.bars} color="var(--accent)" />
          <div className="text-[12px] text-muted">{mini.note}</div>
        </Tile>
      ))}
    </div>
  );
}

const LEGEND: { stage: "deep" | "rem" | "light" | "awake"; key: keyof Day }[] = [
  { stage: "deep", key: "sleep_deep_min" },
  { stage: "rem", key: "sleep_rem_min" },
  { stage: "light", key: "sleep_light_min" },
  { stage: "awake", key: "sleep_awake_min" },
];

/** Last night: length, the stage strip, the stages in minutes and the usual times. */
export function SleepTile({ dataset, day, date, latest }: TodayProps) {
  const tz = dataset.timezone;
  const hasSleep = day?.sleep_minutes != null;
  const segments = sleepSegments(day);
  const window = sleepWindow(dataset.days, tz, date);
  return (
    <TileShell className="flex-auto gap-4 p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <TileTitle href={ROUTES.sleep}>Spánok</TileTitle>
          <LatestNote text={latest} />
        </div>
        {hasSleep && (
          <div className="mono text-[12px] text-ink2">
            {formatClock(day?.sleep_start, tz)} → {formatClock(day?.sleep_end, tz)}
          </div>
        )}
      </div>
      <div className="figure text-[clamp(40px,3.6vw,48px)] leading-none tracking-[-0.03em]">
        {hasSleep ? formatDuration(day?.sleep_minutes) : DASH}
      </div>
      <StageStrip
        segments={segments}
        label={hasSleep ? `Priebeh noci po fázach, ${formatDuration(day?.sleep_minutes)} spánku` : "Priebeh noci"}
      />
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        {LEGEND.map(({ stage, key }) => (
          <div key={stage} className="flex items-center gap-2 text-ink2">
            <span aria-hidden="true" className="size-[9px] shrink-0 rounded-[3px]" style={{ background: STAGE_COLORS[stage] }} />
            {STAGE_LABELS[stage]}
            <span className="ml-auto font-semibold text-ink">{formatDurationCompact(day?.[key] as number | null | undefined)}</span>
          </div>
        ))}
      </div>
      <div className="text-[12px] text-muted">
        {!hasSleep
          ? "Minulú noc sa spánok nezaznamenal."
          : window
            ? `Zaspávaš okolo ${formatTimeOfDay(window.bedtime)}, vstávaš ${formatTimeOfDay(window.wake)} · ± ${window.spread} min`
            : "Na bežné časy je zatiaľ málo nocí."}
      </div>
    </TileShell>
  );
}

/** Resting heart rate of the day and its last 30 days. */
export function RestingTile({ dataset, day, date, isToday, latest }: TodayProps) {
  const month = values(dataset, date, 30, "resting_hr");
  const present = month.filter((value): value is number => value !== null);
  const low = present.length ? Math.min(...present) - 2 : 40;
  const high = present.length ? Math.max(...present) + 2 : 70;
  const paths = trendPaths(month, 300, 64, { low, high, topPad: 4 });
  const byDay = indexByDay(dataset.days);
  const weekMean = (end: string) =>
    average(Array.from({ length: 7 }, (_, offset) => dayValue(byDay.get(addDays(end, -offset)), "restingHr")));
  const recent = weekMean(date);
  const before = weekMean(addDays(date, -30));
  const change = recent === null || before === null ? null : Math.round(recent - before);
  const note =
    change === null
      ? "Na porovnanie s minulým mesiacom je zatiaľ málo dát."
      : change === 0
        ? "Rovnaký ako pred mesiacom"
        : `O ${formatInt(Math.abs(change))} bpm ${change < 0 ? "nižší" : "vyšší"} než pred mesiacom`;
  const range =
    day?.hr_min != null && day.hr_max != null ? ` · ${isToday ? "dnes" : "v ten deň"} ${formatInt(day.hr_min)} – ${formatInt(day.hr_max)}` : "";

  return (
    <Tile href={ROUTES.heart} label="Pokojový tep" aside={latest ? <LatestNote text={latest} /> : undefined} className="gap-3.5 p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <div className="figure text-[48px] leading-none tracking-[-0.03em]">{dayFigure(day, "restingHr", formatInt)}</div>
        <div className="text-[14px] text-ink2">bpm{range}</div>
      </div>
      <svg
        viewBox="0 0 300 64"
        preserveAspectRatio="none"
        className="block h-16 w-full overflow-visible"
        role="img"
        aria-label={`Pokojový tep za 30 dní: ${note.toLowerCase()}`}
      >
        <path
          d={paths.line}
          vectorEffect="non-scaling-stroke"
          style={{ fill: "none", stroke: "var(--heart)", strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }}
        />
      </svg>
      <div className="text-[12px] text-muted">{note}</div>
    </Tile>
  );
}
