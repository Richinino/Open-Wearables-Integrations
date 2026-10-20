"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { HeatmapTile, RecordsTile, WeekTile, WorkoutsTile } from "@/components/overview/history-tiles";
import { DayScoreTile, EveningTile } from "@/components/overview/score-tiles";
import { NightBanner, SummaryTile } from "@/components/overview/summary-tiles";
import { Minis, RestingTile, SleepTile, StepsTile } from "@/components/overview/today-tiles";
import { ROUTES } from "@/components/shell/nav";
import { WithData } from "@/components/shell/shell";
import { Arrow } from "@/components/ui/tile";
import { addDays, todayIn } from "@/lib/dates";
import { formatDay } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import { latestDay } from "@/lib/latest-day";
import { insights } from "@/lib/overview";
import { missingDaysText, missingEntryDays } from "@/lib/samsung";
import {
  bedtimeFor,
  eveningSummary,
  morningSummary,
  nightSignalAlert,
  resolveMode,
  typicalWake,
} from "@/lib/scores";
import type { Dataset } from "@/lib/types";
import { useAccount } from "@/lib/account-context";

/**
 * The overview. Before 15:00 local time it leads with the day score (Readiness, Sleep
 * Performance, Activity); from 15:00, and until 04:00, with the strain of the day and the
 * sleep need for tonight. `?rezim=rano` or `?rezim=vecer` forces either layout.
 */
function Overview({ dataset, now, override }: { dataset: Dataset; now: Date; override: string | null }) {
  const account = useAccount();
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);
  const tz = dataset.timezone;
  const preferredMode = account?.dataAccount.settings.overview_mode === "morning" ? "rano" : null;
  const { mode, day: focus } = resolveMode(now, tz, override ?? preferredMode);
  const today = todayIn(tz, now);

  // The focus day, or the last day with data before it when the source is behind.
  const date = byDay.has(focus)
    ? focus
    : ([...dataset.days].reverse().find((item) => item.day <= focus)?.day ?? dataset.last_day ?? focus);
  const day = byDay.get(date) ?? null;
  const previous = byDay.get(addDays(date, -1)) ?? null;
  const isToday = date === today;
  const morning = mode === "morning";
  const alert = nightSignalAlert(day?.scores?.night_signal);

  const bedtime = bedtimeFor(day?.scores?.sleep_need_minutes ?? null, typicalWake(dataset.days, tz, addDays(date, 1)));
  const sentence = morning ? morningSummary(day?.scores) : eveningSummary(day?.scores, bedtime);
  const observations = insights(dataset.days, date);
  // While today is still an empty shell (no steps, no sleep yet), the today tiles show the
  // latest day with data and say how old it is; partial values of today win once they exist.
  const shown = latestDay(dataset.days, focus, today);
  const todayProps = { dataset, day: shown.day, date: shown.date, isToday: shown.date === today, latest: shown.label };
  const missing = missingEntryDays(dataset.days, today).length;

  return (
    <>
      <h1 className="sr-only">
        Prehľad · {morning ? "ráno" : "večer"}
        {isToday ? "" : ` · ${formatDay(date)}`}
      </h1>
      {alert && <NightBanner alert={alert} />}

      <div className="grid gap-[18px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)]">
        {morning ? (
          <DayScoreTile day={day} previous={previous} date={date} isToday={isToday} />
        ) : (
          <EveningTile dataset={dataset} day={day} date={date} isToday={isToday} />
        )}
        <div className="flex min-w-0 flex-col gap-[18px]">
          <StepsTile {...todayProps} />
          <Minis {...todayProps} />
        </div>
        <div className="grid min-w-0 gap-[18px] md:col-span-2 md:grid-cols-2 xl:col-span-1 xl:flex xl:flex-col">
          <SleepTile {...todayProps} />
          <RestingTile {...todayProps} />
        </div>
      </div>

      {missing > 0 && !account?.viewOnly && (account?.dataAccount.has_samsung ?? true) && (
        <div className="-my-1.5 flex justify-end px-1">
          <Link
            href={ROUTES.entries}
            className="title-link -my-2 inline-flex min-h-11 items-center gap-1.5 text-[13px] text-ink2"
            title="Doplň čísla zo Samsung Health, owi podľa nich doladí odhady"
          >
            {missingDaysText(missing)} <Arrow />
          </Link>
        </div>
      )}

      <SummaryTile morning={morning} sentence={sentence} insights={observations} />
      <WeekTile dataset={dataset} date={date} isToday={isToday} />

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <HeatmapTile dataset={dataset} date={date} />
        <RecordsTile dataset={dataset} date={date} />
      </div>

      <WorkoutsTile dataset={dataset} date={date} />
    </>
  );
}

export function OverviewView() {
  const override = useSearchParams().get("rezim");
  return <WithData>{(dataset, now) => <Overview dataset={dataset} now={now} override={override} />}</WithData>;
}
