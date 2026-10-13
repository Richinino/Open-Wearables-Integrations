"use client";

import { niceTicks, Plot, Tip } from "./plot";

export interface ChartPoint {
  /** Stable id handed to `onSelect`, here the day. */
  key: string;
  /** Short x-axis label. */
  label: string;
  /** Tooltip heading. */
  title: string;
  value: number | null;
  /** The period is still running, so the value will grow. */
  partial?: boolean;
}

interface BaseProps {
  ariaLabel: string;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  onSelect?: (key: string) => void;
  height?: number;
}

const MAX_BAR = 24;
const GAP = 2;
const PARTIAL_NOTE = "deň ešte beží";

/** Ticks for a duration axis in minutes, on whole quarter-hours or hours. */
export function durationTicks(maxMinutes: number): number[] {
  const step = [15, 30, 60, 120, 180, 240, 360].find((s) => maxMinutes / s <= 4.5) ?? 480;
  const ticks: number[] = [];
  for (let value = 0; value < maxMinutes + step * 0.999; value += step) ticks.push(value);
  return ticks;
}

/** Bar that is round at the data end and square on the baseline. */
function barPath(x: number, yTop: number, width: number, yBase: number, round = true) {
  const height = yBase - yTop;
  if (height <= 0 || width <= 0) return "";
  const r = round ? Math.min(4, width / 2, height) : 0;
  return (
    `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}` +
    `H${x + width - r}Q${x + width},${yTop} ${x + width},${yTop + r}V${yBase}Z`
  );
}

function barWidth(band: number) {
  return Math.max(Math.min(MAX_BAR, band - GAP), 1);
}

export function ColumnChart({
  points,
  color,
  reference = null,
  ticks,
  ...base
}: BaseProps & {
  points: ChartPoint[];
  color: string;
  reference?: { value: number; label: string } | null;
  ticks?: number[];
}) {
  const top = Math.max(...points.map((p) => p.value ?? 0), reference?.value ?? 0, 1);
  const axis = ticks ?? niceTicks(0, top);
  return (
    <Plot
      count={points.length}
      domain={[0, axis[axis.length - 1]]}
      ticks={axis}
      formatTick={base.formatTick}
      xLabel={(index) => points[index].label}
      ariaLabel={base.ariaLabel}
      height={base.height}
      reference={reference}
      onSelect={base.onSelect && ((index) => base.onSelect?.(points[index].key))}
      tooltip={(index) => {
        const point = points[index];
        return (
          <Tip
            title={point.title}
            rows={[{ value: point.value === null ? "bez dát" : base.formatValue(point.value) }]}
            note={point.partial ? PARTIAL_NOTE : undefined}
          />
        );
      }}
    >
      {({ x, y, band }) => {
        const width = barWidth(band);
        return points.map((point, index) =>
          point.value === null ? null : (
            <path
              key={point.key}
              d={barPath(x(index) - width / 2, y(point.value), width, y(0))}
              fill={color}
              opacity={point.partial ? 0.45 : 1}
            />
          ),
        );
      }}
    </Plot>
  );
}

export interface StackSeries {
  label: string;
  color: string;
}

export interface StackPoint extends Omit<ChartPoint, "value"> {
  /** One value per series, bottom first. Null when the day has no data. */
  values: (number | null)[] | null;
}

export function StackedColumnChart({
  points,
  series,
  ticks,
  totalLabel,
  ...base
}: BaseProps & {
  points: StackPoint[];
  series: StackSeries[];
  ticks?: number[];
  /** Adds a total row to the tooltip. */
  totalLabel?: string;
}) {
  const total = (point: StackPoint) =>
    point.values ? point.values.reduce<number>((acc, value) => acc + (value ?? 0), 0) : 0;
  const axis = ticks ?? niceTicks(0, Math.max(...points.map(total), 1));
  return (
    <Plot
      count={points.length}
      domain={[0, axis[axis.length - 1]]}
      ticks={axis}
      formatTick={base.formatTick}
      xLabel={(index) => points[index].label}
      ariaLabel={base.ariaLabel}
      height={base.height}
      onSelect={base.onSelect && ((index) => base.onSelect?.(points[index].key))}
      tooltip={(index) => {
        const point = points[index];
        if (!point.values) return <Tip title={point.title} rows={[{ value: "bez dát" }]} />;
        const rows = series
          .map((item, at) => ({
            label: item.label,
            color: item.color,
            value: point.values?.[at] == null ? "–" : base.formatValue(point.values[at] as number),
          }))
          .reverse();
        if (totalLabel) rows.unshift({ label: totalLabel, color: "", value: base.formatValue(total(point)) });
        return (
          <Tip title={point.title} rows={rows} note={point.partial ? PARTIAL_NOTE : undefined} />
        );
      }}
    >
      {({ x, y, band }) => {
        const width = barWidth(band);
        return points.map((point, index) => {
          if (!point.values) return null;
          const last = point.values.reduce<number>((acc, value, at) => (value ? at : acc), -1);
          let sum = 0;
          return (
            <g key={point.key} opacity={point.partial ? 0.45 : 1}>
              {point.values.map((value, at) => {
                if (!value) return null;
                const base0 = y(sum);
                sum += value;
                // The gap is taken from the top of each lower segment, in the surface colour.
                const yTop = y(sum) + (at === last ? 0 : GAP);
                return (
                  <path
                    key={at}
                    d={barPath(x(index) - width / 2, Math.min(yTop, base0 - 1), width, base0, at === last)}
                    fill={series[at].color}
                  />
                );
              })}
            </g>
          );
        });
      }}
    </Plot>
  );
}

export function LineChart({
  points,
  color,
  ...base
}: BaseProps & { points: ChartPoint[]; color: string }) {
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const low = Math.min(...values, Infinity);
  const high = Math.max(...values, -Infinity);
  const pad = Math.max((high - low) * 0.25, 2);
  const axis = values.length ? niceTicks(Math.floor(low - pad), Math.ceil(high + pad)) : [0, 1];
  const lastIndex = points.reduce((acc, p, index) => (p.value === null ? acc : index), -1);
  const endLabel = lastIndex >= 0 ? base.formatTick(points[lastIndex].value as number) : "";

  return (
    <Plot
      count={points.length}
      domain={[axis[0], axis[axis.length - 1]]}
      ticks={axis}
      formatTick={base.formatTick}
      xLabel={(index) => points[index].label}
      ariaLabel={base.ariaLabel}
      height={base.height}
      crosshair
      rightPad={endLabel.length * 7 + 14}
      onSelect={base.onSelect && ((index) => base.onSelect?.(points[index].key))}
      tooltip={(index) => {
        const point = points[index];
        return (
          <Tip
            title={point.title}
            rows={[
              { color, value: point.value === null ? "bez dát" : base.formatValue(point.value) },
            ]}
          />
        );
      }}
    >
      {({ x, y, active }) => {
        // Missing days break the line instead of being bridged.
        let path = "";
        let pen = false;
        const lonely: number[] = [];
        points.forEach((point, index) => {
          if (point.value === null) {
            pen = false;
            return;
          }
          const alone = !pen && (points[index + 1]?.value ?? null) === null;
          if (alone) lonely.push(index);
          path += `${pen ? "L" : "M"}${x(index)},${y(point.value)}`;
          pen = true;
        });
        const dot = (index: number, r: number) => (
          <circle
            key={index}
            cx={x(index)}
            cy={y(points[index].value as number)}
            r={r}
            fill={color}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        );
        return (
          <>
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {lonely.filter((index) => index !== lastIndex).map((index) => dot(index, 3))}
            {lastIndex >= 0 && dot(lastIndex, 4.5)}
            {lastIndex >= 0 && (
              <text
                x={x(lastIndex) + 10}
                y={y(points[lastIndex].value as number)}
                dy="0.32em"
                className="chart-label"
              >
                {endLabel}
              </text>
            )}
            {active !== null && active !== lastIndex && points[active].value !== null && dot(active, 4.5)}
          </>
        );
      }}
    </Plot>
  );
}

export interface RangePoint extends Omit<ChartPoint, "value"> {
  /** Start and end on the chart's own scale, here minutes after local noon. */
  range: [number, number] | null;
}

/** Floating bars: when each night began and ended. Earlier is higher. */
export function RangeChart({
  points,
  color,
  ticks,
  formatRange,
  ...base
}: Omit<BaseProps, "formatValue"> & {
  points: RangePoint[];
  color: string;
  ticks: number[];
  formatRange: (range: [number, number]) => string;
}) {
  return (
    <Plot
      count={points.length}
      domain={[ticks[ticks.length - 1], ticks[0]]}
      ticks={ticks}
      formatTick={base.formatTick}
      xLabel={(index) => points[index].label}
      ariaLabel={base.ariaLabel}
      height={base.height}
      onSelect={base.onSelect && ((index) => base.onSelect?.(points[index].key))}
      tooltip={(index) => {
        const point = points[index];
        return (
          <Tip
            title={point.title}
            rows={[{ value: point.range ? formatRange(point.range) : "bez dát" }]}
          />
        );
      }}
    >
      {({ x, y, band }) => {
        const width = Math.max(Math.min(12, band - GAP), 1);
        return points.map((point, index) => {
          if (!point.range) return null;
          const yStart = y(point.range[0]);
          const yEnd = y(point.range[1]);
          return (
            <rect
              key={point.key}
              x={x(index) - width / 2}
              y={yStart}
              width={width}
              height={Math.max(yEnd - yStart, 2)}
              rx={Math.min(4, width / 2)}
              fill={color}
            />
          );
        });
      }}
    </Plot>
  );
}

/** Trend for a stat tile: recessive line, the latest value marked in the subject's colour. */
export function Sparkline({
  values,
  color,
  height = 32,
}: {
  values: (number | null)[];
  color: string;
  height?: number;
}) {
  const known = values.flatMap((value) => (value === null ? [] : [value]));
  if (known.length < 2) return <div style={{ height }} />;
  const low = Math.min(...known);
  const high = Math.max(...known);
  const width = 120;
  const pad = 5;
  const x = (index: number) => pad + (index / (values.length - 1)) * (width - pad * 2);
  const y = (value: number) =>
    height - pad - ((value - low) / (high - low || 1)) * (height - pad * 2);
  let path = "";
  let pen = false;
  let last = -1;
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    pen = true;
    last = index;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="var(--spark)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(last)}
        cy={y(values[last] as number)}
        r={3}
        fill={color}
        stroke="var(--surface)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
