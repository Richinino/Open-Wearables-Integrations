"use client";

// /pripravenost: Readiness (an estimate without HRV and temperature) with its parts, the
// 30-day trend, resting heart rate against its baseline and the night signal.

import { useRouter } from "next/navigation";
import { ColumnChart } from "@/components/charts/charts";
import { tickPlain } from "@/components/charts/points";
import { WithData } from "@/components/shell/shell";
import { EmptyState } from "@/components/ui/parts";
import { addDays, dateRange } from "@/lib/dates";
import { readinessDay, restingBaseline, signalNights } from "@/lib/detail-heart";
import { DASH, formatDay, formatDayMonth, formatInt } from "@/lib/format";
import { average, indexByDay } from "@/lib/metrics";
import { formatScore, readinessBand, scoreValue } from "@/lib/scores";
import type { Dataset } from "@/lib/types";
import { DetailHead, riseStyle } from "../common/bits";
import { ChartTile } from "../common/controls";
import { focusOf } from "../common/focus";
import {
  EnergyScoreTile,
  FlaggedNightsTile,
  NightSignalTile,
  ReadinessPartsTile,
  ReadinessTile,
  RestingBaselineTile,
} from "./readiness-tiles";

const TREND_DAYS = 30;
const SIGNAL_DAYS = 90;

function Readiness({ dataset, now }: { dataset: Dataset; now: Date }) {
  const router = useRouter();
  const focus = focusOf(dataset, now);
  const byDay = indexByDay(dataset.days);
  const day = readinessDay(dataset.days, focus.date);
  if (!day) {
    return <EmptyState title="Readiness zatiaľ nie je">Skóre sa objaví, keď owi spočíta prvé dni.</EmptyState>;
  }
  const isToday = day.day === focus.today;
  const previous = byDay.get(addDays(day.day, -1)) ?? null;
  const baseline = restingBaseline(dataset.days, day.day);
  const slots = dateRange(addDays(day.day, -(TREND_DAYS - 1)), day.day);
  const trend = slots.map((key) => ({ key, score: byDay.get(key)?.scores?.readiness ?? null }));
  const values = trend.map((item) => scoreValue(item.score));
  const mean = average(values);
  const nights = signalNights(dataset.days, day.day, SIGNAL_DAYS);

  return (
    <>
      <DetailHead section="Pripravenosť" title="Readiness">
        Ako je telo pripravené na deň · {isToday ? "dnes" : formatDay(day.day)} · odhad z dostupných údajov
      </DetailHead>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rise grid min-w-0" style={riseStyle(1)}>
          <ReadinessTile day={day} isToday={isToday} />
        </div>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="rise grid min-w-0" style={riseStyle(2)}>
            <ReadinessPartsTile day={day} previous={previous} />
          </div>
          <div className="rise grid min-w-0 flex-auto" style={riseStyle(3)}>
            <EnergyScoreTile day={day} isToday={isToday} />
          </div>
        </div>
      </div>

      <ChartTile
        label={`Readiness · ${TREND_DAYS} dní`}
        note={mean === null ? "Za toto obdobie zatiaľ bez skóre." : `Priemer ≈ ${formatInt(mean)} · ${readinessBand(mean)?.label ?? ""} · každý deň je odhad`}
        table={{
          columns: ["Deň", "Readiness", "Pásmo"],
          rows: trend
            .filter((item) => scoreValue(item.score) !== null)
            .map((item) => [formatDay(item.key), formatScore(item.score), readinessBand(scoreValue(item.score))?.label ?? DASH])
            .reverse(),
        }}
      >
        <ColumnChart
          points={trend.map((item, index) => ({ key: item.key, label: formatDayMonth(item.key), title: formatDay(item.key), value: values[index] }))}
          color="var(--heart)"
          ticks={[0, 25, 50, 75, 100]}
          reference={mean === null ? null : { value: mean, label: `priemer ≈ ${formatInt(mean)}` }}
          ariaLabel={`Readiness za ${TREND_DAYS} dní, priemer približne ${formatInt(mean)}`}
          formatValue={(value) => `≈ ${formatInt(value)}`}
          formatTick={tickPlain}
          onSelect={(key) => router.push(`/den/${key}`)}
        />
      </ChartTile>

      <div className="grid gap-[18px] lg:grid-cols-2">
        <div className="grid min-w-0">
          <RestingBaselineTile dataset={dataset} day={day} baseline={baseline} />
        </div>
        <div className="grid min-w-0">
          <NightSignalTile day={day} isToday={isToday} />
        </div>
      </div>

      <FlaggedNightsTile nights={nights} length={SIGNAL_DAYS} />
    </>
  );
}

export function ReadinessView() {
  return <WithData>{(dataset, now) => <Readiness dataset={dataset} now={now} />}</WithData>;
}
