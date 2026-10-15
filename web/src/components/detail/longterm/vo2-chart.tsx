"use client";

// VO2max per week: the watch's value as a solid line and the Uth–Sørensen estimate dashed,
// over a soft band of the typical range. Both lines carry dots on every week with a value,
// so sparse watch readings never pretend to be continuous.

import { niceTicks, Plot, Tip } from "@/components/charts/plot";
import { formatDayMonth, formatDecimal } from "@/lib/format";
import type { Vo2Week } from "@/lib/detail-longterm";

export const WATCH_COLOR = "var(--accent)";
export const UTH_COLOR = "var(--heart)";

/** Typical range for a 17-year-old male, and where "excellent" begins. */
const TYPICAL: [number, number] = [45, 50];
const EXCELLENT = 55;

function linePath(values: (number | null)[], x: (index: number) => number, y: (value: number) => number): string {
  let path = "";
  values.forEach((value, index) => {
    if (value === null) return;
    path += `${path ? "L" : "M"}${x(index)},${y(value)}`;
  });
  return path;
}

export function Vo2Chart({ weeks }: { weeks: Vo2Week[] }) {
  const values = weeks.flatMap((week) => [week.watch, week.uth]).filter((value): value is number => value !== null);
  const low = Math.min(...values, TYPICAL[0]) - 2;
  const high = Math.max(...values, EXCELLENT) + 2;
  const ticks = niceTicks(Math.floor(low), Math.ceil(high), 4);
  const show = (value: number | null) => (value === null ? "bez dát" : formatDecimal(value, 1));

  return (
    <Plot
      count={weeks.length}
      domain={[ticks[0], ticks[ticks.length - 1]]}
      ticks={ticks}
      formatTick={(value) => String(value)}
      xLabel={(index) => formatDayMonth(weeks[index].week)}
      ariaLabel="VO2max po týždňoch: hodinky a odhad Uth–Sørensen"
      height={230}
      crosshair
      tooltip={(index) => (
        <Tip
          title={`Týždeň od ${formatDayMonth(weeks[index].week)}`}
          rows={[
            { color: WATCH_COLOR, value: show(weeks[index].watch), label: "hodinky" },
            { color: UTH_COLOR, value: show(weeks[index].uth), label: "odhad z tepu" },
          ]}
        />
      )}
    >
      {({ x, y, left, band, active }) => {
        const watch = weeks.map((week) => week.watch);
        const uth = weeks.map((week) => week.uth);
        const edge = x(weeks.length - 1) + band / 2;
        const dots = (series: (number | null)[], color: string, radius: number) =>
          series.map((value, index) =>
            value === null ? null : (
              <circle key={index} cx={x(index)} cy={y(value)} r={index === active ? radius + 1.5 : radius} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
            ),
          );
        return (
          <>
            <rect
              x={left}
              width={Math.max(edge - left, 0)}
              y={y(TYPICAL[1])}
              height={Math.max(y(TYPICAL[0]) - y(TYPICAL[1]), 0)}
              fill="color-mix(in oklab, var(--good) 12%, transparent)"
            />
            <text x={left + 6} y={y(TYPICAL[1]) + 13} className="chart-tick" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
              bežné 45–50
            </text>
            <line x1={left} x2={edge} y1={y(EXCELLENT)} y2={y(EXCELLENT)} stroke="var(--good)" strokeWidth={1} strokeDasharray="3 4" />
            <text x={edge - 6} y={y(EXCELLENT) - 5} textAnchor="end" className="chart-tick" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
              výborné 55+
            </text>
            <path d={linePath(uth, x, y)} fill="none" stroke={UTH_COLOR} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
            {dots(uth, UTH_COLOR, 2.5)}
            <path d={linePath(watch, x, y)} fill="none" stroke={WATCH_COLOR} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {dots(watch, WATCH_COLOR, 3)}
          </>
        );
      }}
    </Plot>
  );
}
