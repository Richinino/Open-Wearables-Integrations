"use client";

// Sleep per night as columns with the need of that night as a short dark tick across each
// column, on the shared Plot. A night without data leaves its slot empty.

import { durationTicks } from "@/components/charts/charts";
import { Plot, Tip } from "@/components/charts/plot";
import { tickDuration } from "@/components/charts/points";
import type { NightPoint } from "@/lib/detail-sleep";
import { formatDay, formatDayMonth, formatDuration } from "@/lib/format";

const MAX_BAR = 24;

export function NeedChart({
  points,
  ariaLabel,
  onSelect,
  height = 220,
}: {
  points: NightPoint[];
  ariaLabel: string;
  onSelect?: (day: string) => void;
  height?: number;
}) {
  const top = Math.max(60, ...points.map((point) => Math.max(point.minutes ?? 0, point.need ?? 0)));
  const ticks = durationTicks(top);
  return (
    <Plot
      count={points.length}
      domain={[0, ticks[ticks.length - 1]]}
      ticks={ticks}
      formatTick={tickDuration}
      xLabel={(index) => formatDayMonth(points[index].day)}
      ariaLabel={ariaLabel}
      height={height}
      onSelect={onSelect && ((index) => onSelect(points[index].day))}
      tooltip={(index) => {
        const point = points[index];
        const gap = point.minutes !== null && point.need !== null ? point.need - point.minutes : null;
        return (
          <Tip
            title={formatDay(point.day)}
            rows={[
              { label: "spánok", color: "var(--sleep)", value: point.minutes === null ? "bez dát" : formatDuration(point.minutes) },
              { label: "potreba", color: "var(--ink)", value: point.need === null ? "–" : formatDuration(point.need) },
            ]}
            note={gap === null ? undefined : gap > 0 ? `chýbalo ${formatDuration(gap)}` : "potreba pokrytá"}
          />
        );
      }}
    >
      {({ x, y, band }) => {
        const width = Math.max(Math.min(MAX_BAR, band - 2), 1);
        const tick = Math.min(width + 6, band);
        return points.map((point, index) => (
          <g key={point.day}>
            {point.minutes !== null && (
              <rect
                x={x(index) - width / 2}
                y={y(point.minutes)}
                width={width}
                height={Math.max(y(0) - y(point.minutes), 1)}
                rx={Math.min(3, width / 2)}
                fill="var(--sleep)"
              />
            )}
            {point.need !== null && (
              <rect x={x(index) - tick / 2} y={y(point.need) - 1.5} width={tick} height={3} rx={1.5} fill="var(--ink)" />
            )}
          </g>
        ));
      }}
    </Plot>
  );
}
