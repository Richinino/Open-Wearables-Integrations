// The night as a hypnogram: one lane per stage (awake on top, deep at the bottom) and a
// block for every stretch of the stage timeline, in clock time. Stages keep their own
// colours and the lanes are labelled, so the chart never relies on colour alone.

import { STAGE_COLORS } from "@/components/ui/tile";
import { localMinutesOfDay } from "@/lib/dates";
import { formatClock, formatDuration } from "@/lib/format";
import type { SleepInterval, SleepStage } from "@/lib/types";

const LANES: { stage: SleepStage; label: string }[] = [
  { stage: "awake", label: "Bdenie" },
  { stage: "rem", label: "REM" },
  { stage: "light", label: "Ľahký" },
  { stage: "deep", label: "Hlboký" },
];

function lane(stage: SleepStage): number {
  // A night without stages ("asleep") sits with the light sleep.
  return stage === "asleep" ? 2 : LANES.findIndex((item) => item.stage === stage);
}

export interface HypnogramProps {
  timeline: SleepInterval[];
  /** The main sleep, ISO 8601; the timeline is cut to it. */
  start: string;
  end: string;
  timeZone: string;
  label: string;
}

/** The stretches of the main sleep, clipped to it, with their place on a 0..1 scale. */
export function hypnogramBlocks(timeline: SleepInterval[], start: string, end: string) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  const span = to - from;
  if (!(span > 0)) return [];
  return timeline
    .map((item) => ({ stage: item.stage, from: Math.max(Date.parse(item.start), from), to: Math.min(Date.parse(item.end), to) }))
    .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > item.from)
    .map((item) => ({ stage: item.stage, left: (item.from - from) / span, width: (item.to - item.from) / span, minutes: (item.to - item.from) / 60_000 }));
}

/** Whole hours between `start` and `end`, every second one when the night is long. */
function hourTicks(start: string, end: string, timeZone: string) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  const minutes = localMinutesOfDay(start, timeZone);
  const first = from + ((60 - (minutes % 60)) % 60) * 60_000;
  const ticks: { at: number; label: string }[] = [];
  for (let instant = first; instant <= to; instant += 3_600_000) {
    ticks.push({ at: (instant - from) / (to - from), label: formatClock(new Date(instant).toISOString(), timeZone) });
  }
  return ticks;
}

export function Hypnogram({ timeline, start, end, timeZone, label }: HypnogramProps) {
  const blocks = hypnogramBlocks(timeline, start, end);
  const ticks = hourTicks(start, end, timeZone);
  const totals = LANES.map(({ stage, label: name }) => ({
    name,
    minutes: blocks.filter((block) => block.stage === stage || (stage === "light" && block.stage === "asleep")).reduce((sum, block) => sum + block.minutes, 0),
  }));
  const summary = `${label}: ${totals.map((total) => `${total.name.toLowerCase()} ${formatDuration(total.minutes)}`).join(", ")}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2.5">
        <div aria-hidden="true" className="flex w-[52px] shrink-0 flex-col text-[11px] text-ink2">
          {LANES.map((item) => (
            <div key={item.stage} className="flex h-7 items-center gap-1.5">
              <span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: STAGE_COLORS[item.stage] }} />
              {item.label}
            </div>
          ))}
        </div>
        <div className="relative h-28 min-w-0 flex-1" role="img" aria-label={summary}>
          {LANES.map((item, index) => (
            <div key={item.stage} aria-hidden="true" className="absolute inset-x-0 h-7 border-t border-line" style={{ top: index * 28 }} />
          ))}
          {ticks.map((tick) => (
            <div key={tick.at} aria-hidden="true" className="absolute inset-y-0 border-l border-line" style={{ left: `${tick.at * 100}%` }} />
          ))}
          {blocks.map((block, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="absolute rounded-[3px]"
              style={{
                left: `${block.left * 100}%`,
                width: `max(2px, calc(${block.width * 100}% - 1px))`,
                top: lane(block.stage) * 28 + 4,
                height: 20,
                background: STAGE_COLORS[block.stage] ?? "var(--lsleep)",
              }}
            />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="mono relative ml-[62px] h-4 text-[10px] text-muted">
        {ticks.map((tick, index) => (
          <span
            key={tick.at}
            className={`absolute -translate-x-1/2 whitespace-nowrap ${index % 2 ? "max-sm:hidden" : ""}`}
            style={{ left: `${tick.at * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
