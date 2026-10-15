"use client";

// /aktivita: Activity with its six parts, Strain of the day and its workouts, the strain of
// 30 days, the cardio load status, time in zones and the estimated active time and calories.

import { WithData } from "@/components/shell/shell";
import { EmptyState } from "@/components/ui/parts";
import { formatDay } from "@/lib/format";
import type { Dataset } from "@/lib/types";
import { DetailHead, riseStyle, RunningHint } from "../common/bits";
import { focusOf } from "../common/focus";
import { ZonesTile } from "../common/zones";
import { ActivityPartsTile, ActivityTile, CardioTile, EstimatesTile, StrainHistoryTile, StrainTile } from "./activity-tiles";

function Activity({ dataset, now }: { dataset: Dataset; now: Date }) {
  const focus = focusOf(dataset, now);
  const day = focus.day;
  if (!day) {
    return <EmptyState title="Pre tento deň nie sú dáta">Aktivita sa objaví po ďalšej synchronizácii.</EmptyState>;
  }
  const running = day.complete === false;
  return (
    <>
      <DetailHead section="Aktivita" title="Aktivita">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          Pohyb, záťaž a tréningy · {focus.isToday ? "dnes" : formatDay(day.day)}
          {running && <RunningHint />}
        </span>
      </DetailHead>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rise grid min-w-0" style={riseStyle(1)}>
          <ActivityTile day={day} isToday={focus.isToday} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(2)}>
          <ActivityPartsTile dataset={dataset} day={day} />
        </div>
      </div>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rise grid min-w-0" style={riseStyle(3)}>
          <StrainTile dataset={dataset} day={day} isToday={focus.isToday} />
        </div>
        <div className="rise grid min-w-0" style={riseStyle(4)}>
          <StrainHistoryTile dataset={dataset} date={day.day} />
        </div>
      </div>

      <CardioTile dataset={dataset} day={day} />

      <div className="grid gap-[18px] lg:grid-cols-2">
        <div className="grid min-w-0">
          <ZonesTile dataset={dataset} date={day.day} day={day} isToday={focus.isToday} />
        </div>
        <div className="grid min-w-0">
          <EstimatesTile dataset={dataset} day={day} isToday={focus.isToday} />
        </div>
      </div>
    </>
  );
}

export function ActivityView() {
  return <WithData>{(dataset, now) => <Activity dataset={dataset} now={now} />}</WithData>;
}
