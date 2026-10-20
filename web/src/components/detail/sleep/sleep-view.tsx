"use client";

// /spanok: last night (score with the Sleep Performance / Sleep Score switch, hypnogram,
// stages, naps), the sleep need for tonight, regularity, and 14, 30 or 90 nights of history.

import { useState } from "react";
import { useAccount } from "@/lib/account-context";
import { WithData } from "@/components/shell/shell";
import { EmptyState } from "@/components/ui/parts";
import { addDays } from "@/lib/dates";
import { isSleepKind, lastNight, needTonight, SLEEP_KIND_KEY, sleepHistory, type SleepKind } from "@/lib/detail-sleep";
import { formatClock, formatDay, formatDuration } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import type { Dataset } from "@/lib/types";
import { DetailHead, riseStyle, SectionBar } from "../common/bits";
import { Switch, useStoredChoice } from "../common/controls";
import { focusOf } from "../common/focus";
import { SleepHistory } from "./sleep-history";
import { NeedTile, NightTile, RegularityTile, SleepScoreTile } from "./sleep-tiles";

const PERIODS = [
  { value: 14, label: "14 nocí" },
  { value: 30, label: "30 nocí" },
  { value: 90, label: "90 nocí" },
];

function Sleep({ dataset, now }: { dataset: Dataset; now: Date }) {
  const account = useAccount();
  const tz = dataset.timezone;
  const focus = focusOf(dataset, now);
  const byDay = indexByDay(dataset.days);
  const night = lastNight(dataset.days, focus.date);
  const previous = night ? (byDay.get(addDays(night.day, -1)) ?? null) : null;
  const [storedKind, setStoredKind] = useStoredChoice(SLEEP_KIND_KEY, isSleepKind, "performance");
  const [chosenKind, setChosenKind] = useState<SleepKind | null>(null);
  const kind = chosenKind ?? account?.dataAccount.settings.sleep_score ?? storedKind;
  const setKind = (value: SleepKind) => account ? setChosenKind(value) : setStoredKind(value);
  const [period, setPeriod] = useState(30);
  const plan = needTonight(dataset.days, tz, focus.date);
  const isLastNight = night?.day === focus.today;
  const sri = night?.scores?.sleep_regularity ?? focus.day?.scores?.sleep_regularity ?? null;
  const points = sleepHistory(dataset.days, focus.date, period, kind);

  return (
    <>
      <DetailHead section="Spánok" title="Spánok">
        {night
          ? `${isLastNight ? "Minulá noc" : "Posledná zaznamenaná noc"} · ${formatDay(night.day)} · ${formatClock(night.sleep_start, tz)} → ${formatClock(night.sleep_end, tz)} · ${formatDuration(night.sleep_minutes)} spánku`
          : "Zatiaľ žiadna zaznamenaná noc."}
      </DetailHead>

      {!night && <EmptyState title="Žiadna noc na zobrazenie">Spánok sa objaví po prvej noci s hodinkami.</EmptyState>}

      <div className={`grid gap-[18px] ${night ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]" : ""}`}>
        {night && (
          <div className="rise grid min-w-0" style={riseStyle(1)}>
            <SleepScoreTile night={night} previous={previous} kind={kind} onKind={setKind} timeZone={tz} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {night && (
            <div className="rise grid min-w-0" style={riseStyle(2)}>
              <NightTile night={night} timeZone={tz} isLastNight={isLastNight} />
            </div>
          )}
          <div className="grid flex-1 gap-[18px] sm:grid-cols-2">
            <div className="rise grid min-w-0" style={riseStyle(3)}>
              <NeedTile plan={plan} isToday={focus.isToday} />
            </div>
            <div className="rise grid min-w-0" style={riseStyle(4)}>
              <RegularityTile sri={sri} />
            </div>
          </div>
        </div>
      </div>

      <SectionBar title="História">
        <Switch options={PERIODS} value={period} onChange={setPeriod} label="Obdobie histórie" />
      </SectionBar>
      <SleepHistory dataset={dataset} points={points} kind={kind} />
    </>
  );
}

export function SleepView() {
  const account = useAccount();
  const key = `${account?.dataAccount.id ?? "demo"}:${account?.dataAccount.settings.sleep_score ?? "performance"}`;
  return <WithData>{(dataset, now) => <Sleep key={key} dataset={dataset} now={now} />}</WithData>;
}
