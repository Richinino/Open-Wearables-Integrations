// The day cells of the calendar: compact month cells and tall week cards. Each day with data
// is a real button; the selected one is outlined in the accent and announced as pressed.

import { Ring } from "@/components/ui/tile";
import { WEEKDAY_LETTERS } from "@/lib/overview";
import { type CalendarCell } from "@/lib/calendar";
import { weekdayIndex } from "@/lib/dates";
import {
  approx,
  DASH,
  formatBpm,
  formatClock,
  formatDayLong,
  formatDayMonth,
  formatDecimal,
  formatDuration,
  formatDurationCompact,
  formatDurationShort,
  formatInt,
  workoutLabel,
} from "@/lib/format";
import { formatStrain } from "@/lib/scores";
import { capitalize } from "@/components/detail/shared-b/parts";

const WEEKDAY_NAMES = ["Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota", "Nedeľa"];

/** "6,5 tis." for a calendar cell; small counts stay whole. */
export function stepsShort(steps: number | null): string {
  if (steps === null) return DASH;
  if (steps < 1000) return formatInt(steps);
  return `${formatDecimal(steps / 1000, 1)} tis.`;
}

/** What a screen reader hears for a day button. */
export function cellLabel(cell: CalendarCell): string {
  const parts = [capitalize(formatDayLong(cell.day))];
  if (cell.isToday) parts.push("dnes");
  parts.push(cell.dayScore === null ? "skóre zatiaľ nie je" : `skóre ${formatInt(cell.dayScore)}`);
  if (cell.steps !== null) parts.push(`${formatInt(cell.steps)} krokov${cell.running ? " zatiaľ" : ""}`);
  if (cell.sleepMinutes !== null) parts.push(`spánok ${formatDuration(cell.sleepMinutes)}`);
  if (cell.workouts.length) parts.push(cell.workouts.map((workout) => workoutLabel(workout.type)).join(", "));
  return parts.join(", ");
}

function scoreRing(cell: CalendarCell, size: number, thickness: number) {
  return <Ring share={cell.dayScore === null ? 0 : cell.dayScore / 100} size={size} thickness={thickness} />;
}

const SELECTED: React.CSSProperties = {
  borderColor: "var(--accent)",
  background: "color-mix(in oklab, var(--accent) 12%, transparent)",
};

function DateNumber({ cell, className = "" }: { cell: CalendarCell; className?: string }) {
  const date = Number(cell.day.slice(8, 10));
  if (!cell.isToday) return <span className={className}>{date}</span>;
  return (
    <span className={`inline-grid min-w-[1.6em] place-items-center rounded-full bg-ink px-1 text-bg ${className}`}>{date}</span>
  );
}

/** One day of the month grid. Compact on phones, with steps, sleep and workout from `sm`. */
export function MonthCell({
  cell,
  selected,
  onSelect,
}: {
  cell: CalendarCell;
  selected: boolean;
  onSelect: (day: string) => void;
}) {
  const base =
    "flex min-h-[64px] min-w-0 flex-col rounded-[14px] border p-1.5 text-left sm:min-h-[128px] sm:gap-2 sm:rounded-[18px] sm:p-3";

  if (!cell.inPeriod || cell.future || !cell.data) {
    // Neighbouring months, days to come and days without data: the date only, dimmed.
    const opacity = !cell.inPeriod ? 0.3 : cell.future ? 0.4 : 0.5;
    return (
      <div className={`${base} border-line`} style={{ opacity }} aria-hidden={!cell.inPeriod || cell.future ? true : undefined}>
        <span className="flex items-center justify-between gap-1">
          <DateNumber cell={cell} className="text-[14px] font-semibold sm:text-[17px]" />
          {cell.inPeriod && !cell.future && <span className="sr-only">{capitalize(formatDayLong(cell.day))}: bez dát</span>}
        </span>
      </div>
    );
  }

  const workout = cell.workouts[0];
  return (
    <button
      type="button"
      onClick={() => onSelect(cell.day)}
      aria-pressed={selected}
      aria-label={cellLabel(cell)}
      className={`${base} cursor-pointer gap-1 border-line text-ink transition-colors hover:border-[color-mix(in_oklab,var(--ink)_28%,transparent)]`}
      style={selected ? SELECTED : undefined}
    >
      {/* Phones: date, ring, a thin sleep bar and a dot for a workout. */}
      <span className="flex flex-1 flex-col items-center gap-1 sm:hidden">
        <DateNumber cell={cell} className="text-[14px] font-semibold" />
        {scoreRing(cell, 22, 3.5)}
        <span className="mt-auto flex w-full items-center gap-1">
          <span className="h-[3px] flex-1 rounded-sm bg-track">
            <span className="block h-full rounded-sm bg-sleep" style={{ width: `${(cell.sleepShare ?? 0) * 100}%` }} />
          </span>
          <span className="size-[5px] shrink-0 rounded-full" style={{ background: workout ? "var(--heart)" : "transparent" }} />
        </span>
      </span>

      {/* From sm: the cell of the design. */}
      <span className="hidden items-center justify-between gap-1.5 sm:flex">
        <DateNumber cell={cell} className="text-[17px] font-semibold" />
        {scoreRing(cell, 26, 4)}
      </span>
      <span className="hidden min-h-[19px] text-[15px] font-medium tracking-[-0.01em] sm:block">
        {stepsShort(cell.steps)}
        {cell.running && <span className="ml-1 text-[11px] font-normal text-muted">zatiaľ</span>}
      </span>
      <span className="hidden min-h-4 items-center gap-2 sm:flex">
        <span className="h-1 flex-1 rounded-sm bg-track">
          <span className="block h-full rounded-sm bg-sleep" style={{ width: `${(cell.sleepShare ?? 0) * 100}%` }} />
        </span>
        <span className="mono text-[11px] text-ink2">{cell.sleepMinutes === null ? DASH : formatDurationShort(cell.sleepMinutes)}</span>
      </span>
      <span className="mt-auto hidden min-h-4 min-w-0 items-center gap-1.5 text-[12px] font-semibold sm:flex">
        {workout && <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-heart" />}
        <span className="truncate">
          {workout ? workoutLabel(workout.type) : ""}
          {cell.workouts.length > 1 && <span className="font-normal text-muted"> +{cell.workouts.length - 1}</span>}
        </span>
      </span>
    </button>
  );
}

/** The weekday header of the month grid. */
export function WeekdayHeader() {
  return (
    <div aria-hidden="true" className="mono grid grid-cols-7 gap-1 px-1 pb-1 text-[11px] tracking-[0.08em] text-muted uppercase sm:gap-2 sm:px-1.5">
      {WEEKDAY_LETTERS.map((letter) => (
        <div key={letter} className="text-center sm:text-left">
          {letter}
        </div>
      ))}
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex flex-wrap justify-between gap-x-2 text-[13px]">
      <span className="text-ink2">{k}</span>
      <span className="font-semibold">{v}</span>
    </span>
  );
}

/** One tall day card of the week view. */
export function WeekCard({
  cell,
  selected,
  onSelect,
  timeZone,
}: {
  cell: CalendarCell;
  selected: boolean;
  onSelect: (day: string) => void;
  timeZone: string;
}) {
  const name = WEEKDAY_NAMES[weekdayIndex(cell.day)];
  const date = formatDayMonth(cell.day);
  const base = "flex min-w-0 flex-col gap-3.5 rounded-[20px] border px-4 py-[18px] text-left";
  const head = (
    <span className="flex items-baseline justify-between gap-1.5">
      <span className="text-[15px] font-semibold">
        {name}
        {cell.isToday && <span className="ml-1.5 text-[12px] font-normal text-ink2">dnes</span>}
      </span>
      <span className="mono text-[12px] text-ink2">{date}</span>
    </span>
  );

  if (cell.future || !cell.data) {
    return (
      <div className={`${base} border-line`} style={{ opacity: 0.45 }}>
        {head}
        <span className="text-[13px] text-ink2">{cell.future ? "ešte nenastal" : "bez dát"}</span>
      </div>
    );
  }

  const data = cell.data;
  return (
    <button
      type="button"
      onClick={() => onSelect(cell.day)}
      aria-pressed={selected}
      aria-label={cellLabel(cell)}
      className={`${base} cursor-pointer border-line text-ink transition-colors lg:min-h-[420px] hover:border-[color-mix(in_oklab,var(--ink)_28%,transparent)]`}
      style={selected ? SELECTED : undefined}
    >
      {head}
      <span className="flex items-baseline gap-1.5">
        <span className="figure text-[56px] leading-[0.9]">{formatInt(cell.dayScore)}</span>
        <span className="text-[12px] text-ink2">skóre</span>
      </span>
      <span className="block h-1 rounded-sm bg-track">
        <span className="block h-full rounded-sm bg-accent" style={{ width: `${cell.dayScore ?? 0}%` }} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] text-ink2">Kroky{cell.running ? " · zatiaľ" : ""}</span>
        <span className="figure-sm text-[22px] font-medium">{formatInt(cell.steps)}</span>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] text-ink2">Spánok</span>
        <span className="figure-sm text-[22px] font-medium">{formatDuration(cell.sleepMinutes)}</span>
        {data.sleep_start && data.sleep_end && (
          <span className="mono text-[11px] text-muted">
            {formatClock(data.sleep_start, timeZone)} → {formatClock(data.sleep_end, timeZone)}
          </span>
        )}
      </span>
      <span className="flex flex-col gap-1.5">
        <Pair k="Aktívny čas" v={approx(formatDuration(data.active_minutes_est))} />
        <Pair k="Kalórie" v={approx(formatInt(data.total_kcal_est))} />
        <Pair k="Pokojový tep" v={formatBpm(data.hr_resting)} />
        <Pair k="Strain" v={formatStrain(data.scores?.strain)} />
      </span>
      <span className="mt-auto flex flex-col gap-1.5">
        {cell.workouts.length === 0 && <span className="text-[13px] font-semibold text-ink2">bez tréningu</span>}
        {cell.workouts.map((workout) => (
          <span key={workout.id} className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-heart" />
            <span className="min-w-0 truncate">
              {workoutLabel(workout.type)} {formatDurationCompact(workout.duration_s / 60)}
            </span>
            <span className="mono ml-auto shrink-0 text-[11px] font-normal text-ink2">{formatStrain(workout.strain)}</span>
          </span>
        ))}
      </span>
    </button>
  );
}
