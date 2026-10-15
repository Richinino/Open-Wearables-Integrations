"use client";

// Time in heart-rate zones: the focus day as a bar with labelled minutes, the last 7 and
// 30 days in totals and 30 days as stacked columns. Shared by the activity and heart pages.

import { useRouter } from "next/navigation";
import { durationTicks, StackedColumnChart } from "@/components/charts/charts";
import { tickDuration } from "@/components/charts/points";
import { mix, ZoneBar } from "@/components/ui/tile";
import { addDays, dateRange } from "@/lib/dates";
import { zoneTotals } from "@/lib/detail-activity";
import { formatDay, formatDayMonth, formatDuration, formatDurationCompact } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import type { Dataset, Day } from "@/lib/types";
import { Keys, RunningHint, Swatch } from "./bits";
import { ChartTile } from "./controls";

export const ZONE_KEYS = [
  { key: "light", label: "Ľahká", range: "50–70 %", color: mix("var(--accent)", 38) },
  { key: "moderate", label: "Stredná", range: "70–85 %", color: mix("var(--accent)", 68) },
  { key: "vigorous", label: "Vysoká", range: "nad 85 %", color: "var(--accent)" },
] as const;

function minutesOf(day: Day | null | undefined): [number | null, number | null, number | null] {
  return [day?.zone_light_min ?? null, day?.zone_moderate_min ?? null, day?.zone_vigorous_min ?? null];
}

export function ZonesTile({
  dataset,
  date,
  day,
  isToday,
  length = 30,
}: {
  dataset: Dataset;
  date: string;
  day: Day | null;
  isToday: boolean;
  length?: number;
}) {
  const router = useRouter();
  const byDay = indexByDay(dataset.days);
  const today = minutesOf(day);
  const week = zoneTotals(dataset.days, date, 7);
  const month = zoneTotals(dataset.days, date, length);
  const slots = dateRange(addDays(date, -(length - 1)), date);
  const points = slots.map((key) => {
    const data = byDay.get(key);
    const values = minutesOf(data);
    return {
      key,
      label: formatDayMonth(key),
      title: formatDay(key),
      values: values.every((value) => value === null) ? null : values,
      partial: data?.complete === false,
    };
  });
  const tallest = Math.max(60, ...points.map((point) => (point.values ?? []).reduce<number>((acc, value) => acc + (value ?? 0), 0)));
  const hasToday = today.some((value) => value !== null);

  return (
    <ChartTile
      label="Čas v zónach tepu"
      note="Podľa percent maximálneho tepu: ľahká 50–70 %, stredná 70–85 %, vysoká nad 85 %."
      legend={<Keys items={ZONE_KEYS.map((zone) => ({ label: zone.label, color: zone.color }))} />}
      table={{
        columns: ["Deň", "Ľahká", "Stredná", "Vysoká"],
        rows: points
          .filter((point) => point.values)
          .map((point) => [point.title, ...(point.values as (number | null)[]).map((value) => formatDuration(value))])
          .reverse(),
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[14px] text-ink2">{isToday ? "Dnes" : formatDay(date)}</span>
          {day?.complete === false && <RunningHint />}
        </div>
        <ZoneBar
          light={today[0] ?? 0}
          moderate={today[1] ?? 0}
          vigorous={today[2] ?? 0}
          height={10}
          label={
            hasToday
              ? `Zóny ${isToday ? "dnes" : formatDay(date)}: ${ZONE_KEYS.map((zone, index) => `${zone.label.toLowerCase()} ${formatDuration(today[index])}`).join(", ")}`
              : "Zóny: bez dát"
          }
        />
        <dl className="grid grid-cols-3 gap-3">
          {ZONE_KEYS.map((zone, index) => (
            <div key={zone.key} className="flex min-w-0 flex-col gap-1">
              <dt className="flex items-center gap-1.5 text-[12px] text-ink2">
                <Swatch color={zone.color} />
                {zone.label}
              </dt>
              <dd className="figure-sm text-[22px] whitespace-nowrap">{formatDurationCompact(today[index])}</dd>
              <dd className="text-[11px] text-muted">
                7 dní {formatDurationCompact(week ? [week.light, week.moderate, week.vigorous][index] : null)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <StackedColumnChart
        points={points}
        series={ZONE_KEYS.map((zone) => ({ label: zone.label, color: zone.color }))}
        totalLabel="Spolu"
        ticks={durationTicks(tallest)}
        ariaLabel={`Čas v zónach tepu za ${length} dní`}
        formatValue={formatDuration}
        formatTick={tickDuration}
        onSelect={(key) => router.push(`/den/${key}`)}
        height={200}
      />
      {month && (
        <p className="text-[12px] text-muted">
          {length} dní spolu: ľahká {formatDuration(month.light)}, stredná {formatDuration(month.moderate)}, vysoká {formatDuration(month.vigorous)}
        </p>
      )}
    </ChartTile>
  );
}
