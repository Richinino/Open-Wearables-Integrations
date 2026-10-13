import Link from "next/link";
import { SegmentBar, type Segment } from "@/components/ui/parts";
import {
  approx,
  DASH,
  formatClock,
  formatDay,
  formatDistance,
  formatDuration,
  formatInt,
  formatKcal,
  workoutLabel,
} from "@/lib/format";
import type { Workout } from "@/lib/types";

export const COLOR = {
  activity: "var(--activity)",
  activitySoft: "var(--activity-soft)",
  sleep: "var(--sleep)",
  heart: "var(--heart)",
  context: "var(--context)",
} as const;

export const ZONES = [
  { label: "Ľahká", color: "var(--zone-light)" },
  { label: "Stredná", color: "var(--zone-moderate)" },
  { label: "Vysoká", color: "var(--zone-vigorous)" },
] as const;

/** Bottom of the stack first. */
export const STAGES = [
  { label: "Hlboký", color: "var(--stage-deep)" },
  { label: "REM", color: "var(--stage-rem)" },
  { label: "Ľahký", color: "var(--stage-light)" },
  { label: "Bdenie", color: "var(--stage-awake)" },
] as const;

export function zoneSegments(source: {
  zone_light_min: number | null;
  zone_moderate_min: number | null;
  zone_vigorous_min: number | null;
}): Segment[] {
  const values = [source.zone_light_min, source.zone_moderate_min, source.zone_vigorous_min];
  return ZONES.map((zone, index) => ({ ...zone, value: values[index] }));
}

export function stageSegments(source: {
  deep: number | null;
  rem: number | null;
  light: number | null;
  awake: number | null;
}): Segment[] {
  const values = [source.deep, source.rem, source.light, source.awake];
  return STAGES.map((stage, index) => ({ ...stage, value: values[index] }));
}

export function heartRange(workout: { hr_avg: number | null; hr_max: number | null }): string {
  if (workout.hr_avg === null) return DASH;
  const max = workout.hr_max === null ? "" : ` / ${formatInt(workout.hr_max)}`;
  return `${formatInt(workout.hr_avg)}${max} bpm`;
}

export function WorkoutRow({
  workout,
  timeZone,
  showDay = true,
}: {
  workout: Workout;
  timeZone: string;
  showDay?: boolean;
}) {
  const when = `${showDay ? `${formatDay(workout.day)} · ` : ""}${formatClock(workout.start, timeZone)}`;
  const zones = zoneSegments(workout);
  const body = (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3.5 md:grid-cols-[minmax(0,1.5fr)_5.5rem_6.5rem_7.5rem_minmax(0,1.2fr)_6rem]">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight">
          {workoutLabel(workout.type)}
        </div>
        <div className="text-[12px] text-muted">{when}</div>
      </div>
      <div className="figure-sm text-right text-[19px] md:text-left">
        {formatDuration(workout.duration_s / 60)}
      </div>
      <div className="tabular hidden text-[13px] text-ink-2 md:block">
        {formatDistance(workout.distance_m)}
      </div>
      <div className="tabular hidden text-[13px] text-ink-2 md:block">{heartRange(workout)}</div>
      <div className="col-span-2 md:col-span-1">
        <SegmentBar
          segments={zones}
          height={8}
          ariaLabel={`Intenzita: ${zones
            .map((zone) => `${zone.label.toLowerCase()} ${formatInt(zone.value)} min`)
            .join(", ")}`}
        />
      </div>
      <div className="tabular col-span-2 flex justify-between text-[13px] text-ink-2 md:col-span-1 md:block md:text-right">
        <span className="md:hidden">
          {[
            workout.distance_m === null ? null : formatDistance(workout.distance_m),
            workout.hr_avg === null ? null : heartRange(workout),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span>{approx(formatKcal(workout.kcal_est))}</span>
      </div>
    </div>
  );
  // The wrapper carries the list divider, so the link can keep its rounded hover area.
  if (!showDay) return body;
  return (
    <div>
      <Link
        href={`/den/${workout.day}`}
        className="-mx-3 block rounded-xl px-3 transition-colors hover:bg-sunk"
      >
        {body}
      </Link>
    </div>
  );
}

/** Column captions matching `WorkoutRow` on wide screens. */
export function WorkoutHead() {
  return (
    <div className="eyebrow hidden grid-cols-[minmax(0,1.5fr)_5.5rem_6.5rem_7.5rem_minmax(0,1.2fr)_6rem] gap-x-4 border-b border-line pb-2 md:grid">
      <span>Tréning</span>
      <span>Trvanie</span>
      <span>Vzdialenosť</span>
      <span>Tep ⌀ / max</span>
      <span>Intenzita</span>
      <span className="text-right">Kalórie</span>
    </div>
  );
}
