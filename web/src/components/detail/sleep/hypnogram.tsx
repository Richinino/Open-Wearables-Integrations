"use client";

// The night as a hypnogram: one row per stage (awake on top, deep at the bottom), blocks in
// stage colours along a local time axis, thin steps between rows. The rows carry the stage
// names, so the stage never rests on colour alone.

import { useWidth } from "@/components/charts/plot";
import { STAGE_COLORS, STAGE_LABELS } from "@/components/ui/tile";
import { hourTicks, type SleepSession } from "@/lib/detail-sleep";
import { formatClock, formatDuration } from "@/lib/format";
import type { SleepStage } from "@/lib/types";

const ROW = 26;
const ROW_GAP = 6;
const LABEL_WIDTH = 58;
const AXIS = 24;
const RIGHT = 6;

const ORDER: SleepStage[] = ["awake", "rem", "light", "asleep", "deep"];

export function Hypnogram({ session, timeZone, label }: { session: SleepSession; timeZone: string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = ORDER.filter((stage) => stage !== "asleep" || session.blocks.some((block) => block.stage === "asleep"));
  const rowOf = new Map(rows.map((stage, index) => [stage, index]));
  const height = rows.length * ROW + (rows.length - 1) * ROW_GAP + AXIS;
  const inner = Math.max(width - LABEL_WIDTH - RIGHT, 1);
  const span = session.end - session.start || 1;
  const x = (at: number) => LABEL_WIDTH + ((at - session.start) / span) * inner;
  const rowY = (stage: SleepStage) => (rowOf.get(stage) ?? 0) * (ROW + ROW_GAP);
  const hours = span / 3_600_000;
  const step = inner / Math.max(hours, 1) < 46 ? 120 : 60;
  const ticks = hourTicks(session.start, session.end, timeZone, step);
  const plotBottom = height - AXIS;

  return (
    <div ref={ref} className="w-full" style={{ height }} role="img" aria-label={label}>
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="block overflow-visible">
          {rows.map((stage) => (
            <g key={stage}>
              <rect x={LABEL_WIDTH} y={rowY(stage)} width={inner} height={ROW} rx={6} fill="var(--track)" opacity={0.55} />
              <text x={0} y={rowY(stage) + ROW / 2} dy="0.32em" className="chart-label">
                {STAGE_LABELS[stage]}
              </text>
            </g>
          ))}
          {ticks.map((tick) => (
            <g key={tick.at}>
              <line x1={x(tick.at)} x2={x(tick.at)} y1={0} y2={plotBottom} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
              <text
                x={Math.min(Math.max(x(tick.at), LABEL_WIDTH + 16), width - 16)}
                y={plotBottom + 16}
                textAnchor="middle"
                className="chart-tick"
              >
                {tick.label}
              </text>
            </g>
          ))}
          {session.blocks.slice(1).map((block, index) => {
            const previous = session.blocks[index];
            if (previous.stage === block.stage) return null;
            const from = rowY(previous.stage) + ROW / 2;
            const to = rowY(block.stage) + ROW / 2;
            return (
              <line
                key={block.start}
                x1={x(block.start)}
                x2={x(block.start)}
                y1={from}
                y2={to}
                stroke="var(--line-strong)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            );
          })}
          {session.blocks.map((block) => (
            <rect
              key={block.start}
              x={x(block.start)}
              y={rowY(block.stage) + 2}
              width={Math.max(x(block.end) - x(block.start), 1.5)}
              height={ROW - 4}
              rx={3}
              fill={STAGE_COLORS[block.stage] ?? "var(--lsleep)"}
            >
              <title>
                {`${STAGE_LABELS[block.stage] ?? block.stage} ${formatClock(new Date(block.start).toISOString(), timeZone)}–${formatClock(new Date(block.end).toISOString(), timeZone)} · ${formatDuration((block.end - block.start) / 60_000)}`}
              </title>
            </rect>
          ))}
        </svg>
      )}
    </div>
  );
}
