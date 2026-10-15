// One workout as a row: type and time, duration, intensity zones, heart rate, distance,
// calories (an estimate) and strain. Shared by the day page and the workouts list.

import Link from "next/link";
import { ROUTES } from "@/components/shell/nav";
import { mix, ZoneBar } from "@/components/ui/tile";
import { approx, DASH, formatClock, formatDay, formatDistance, formatDuration, formatInt, workoutLabel } from "@/lib/format";
import { formatStrain } from "@/lib/scores";
import type { Workout } from "@/lib/types";
import { Swatch } from "./parts";

const GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1.3fr)_84px_minmax(0,1.3fr)_104px_76px_100px_56px] md:gap-x-4";

function zonesLabel(workout: Workout): string {
  return `Intenzita: ľahká ${workout.zone_light_min} min, stredná ${workout.zone_moderate_min} min, vysoká ${workout.zone_vigorous_min} min`;
}

function heart(workout: Workout): string {
  if (workout.hr_avg === null) return "bez tepu";
  return `${formatInt(workout.hr_avg)} / ${formatInt(workout.hr_max)}`;
}

/** Column names above the rows; hidden on phones, where each row labels itself. */
export function WorkoutHeader() {
  return (
    <div aria-hidden="true" className={`${GRID} mono hidden pb-2 text-[10.5px] tracking-[0.08em] text-muted uppercase md:grid`}>
      <div>Tréning</div>
      <div>Trvanie</div>
      <div>Intenzita</div>
      <div>Tep ø / max</div>
      <div className="text-right">Vzdialenosť</div>
      <div className="text-right">Kalórie</div>
      <div className="text-right">Strain</div>
    </div>
  );
}

/** The zone colours, for a legend above a list of rows. */
export function ZoneLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      <span className="text-[12px] text-muted">Intenzita</span>
      <Swatch color={mix("var(--accent)", 38)} label="ľahká" />
      <Swatch color={mix("var(--accent)", 68)} label="stredná" />
      <Swatch color="var(--accent)" label="vysoká" />
    </div>
  );
}

export function WorkoutRow({
  workout,
  timeZone,
  showDate = true,
  link = false,
}: {
  workout: Workout;
  timeZone: string;
  /** Lists across days show the date; the day page only the time. */
  showDate?: boolean;
  /** The row opens its day. */
  link?: boolean;
}) {
  const when = showDate ? `${formatDay(workout.day)} · ${formatClock(workout.start, timeZone)}` : `${formatClock(workout.start, timeZone)} – ${formatClock(workout.end, timeZone)}`;
  const content = (
    <>
      <div className="col-start-1 row-start-1 min-w-0">
        <div className="truncate text-[16px] font-semibold">{workoutLabel(workout.type)}</div>
        <div className="mono text-[11px] text-muted">{when}</div>
      </div>
      <div className="col-start-2 row-start-1 text-right text-[16px] font-medium whitespace-nowrap md:text-left">
        {formatDuration(workout.duration_s / 60)}
      </div>
      <div className="col-span-3 col-start-1 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1">
        <ZoneBar light={workout.zone_light_min} moderate={workout.zone_moderate_min} vigorous={workout.zone_vigorous_min} label={zonesLabel(workout)} />
      </div>
      <div className="mono col-span-3 col-start-1 row-start-3 flex flex-wrap gap-x-3 text-[12px] text-ink2 md:contents">
        <span className="whitespace-nowrap md:col-start-4 md:row-start-1">
          {heart(workout)}
          {workout.hr_avg !== null && <span className="text-muted"> bpm</span>}
        </span>
        <span className="md:col-start-5 md:row-start-1 md:text-right">
          {workout.distance_m === null ? <span className="md:hidden">bez trasy</span> : formatDistance(workout.distance_m)}
          {workout.distance_m === null && <span className="hidden md:inline">{DASH}</span>}
        </span>
        <span className="whitespace-nowrap md:col-start-6 md:row-start-1 md:text-right">
          {workout.kcal_est === null ? DASH : `${approx(formatInt(workout.kcal_est))} kcal`}
        </span>
      </div>
      <div className="col-start-3 row-start-1 flex items-baseline justify-end gap-1.5 md:col-start-7">
        <span className="text-[16px] font-medium">{formatStrain(workout.strain)}</span>
        <span className="mono text-[11px] text-muted md:hidden">strain</span>
      </div>
    </>
  );

  if (!link) return <div className={`${GRID} border-t border-line py-[13px]`}>{content}</div>;
  return (
    <div className="border-t border-line py-1">
      <Link
        href={ROUTES.day(workout.day)}
        aria-label={`${workoutLabel(workout.type)}, ${formatDay(workout.day)} o ${formatClock(workout.start, timeZone)}, ${formatDuration(workout.duration_s / 60)}, strain ${formatStrain(workout.strain)}. Otvoriť deň.`}
        className={`${GRID} -mx-2 rounded-[14px] px-2 py-[9px] no-underline transition-colors hover:bg-sunk`}
      >
        {content}
      </Link>
    </div>
  );
}
