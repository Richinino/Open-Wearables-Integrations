"use client";

// Line chart for the detail pages, on the shared Plot: one or more series, an optional band
// (e.g. the usual range), dashed guide lines with labels, named regions and flagged points.
// Missing days break the lines; nothing is ever drawn as zero.

import { niceTicks, Plot, Tip } from "@/components/charts/plot";

export interface TrendSeries {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Thinner, for a reference such as a baseline. */
  thin?: boolean;
}

export interface TrendGuide {
  value: number;
  label?: string;
  /** Where the label sits; the end is also where the latest value is written. */
  labelAt?: "start" | "end";
}

export interface TrendRegion {
  from: number;
  to: number;
  label: string;
}

export interface TrendMark {
  index: number;
  color: string;
  /** A ring instead of a dot, so two kinds of marks differ by shape too. */
  ring?: boolean;
}

export interface TrendBand {
  low: (number | null)[];
  high: (number | null)[];
  color: string;
}

function linePath(values: (number | null)[], x: (index: number) => number, y: (value: number) => number) {
  let path = "";
  let pen = false;
  const lonely: number[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    if (!pen && (values[index + 1] ?? null) === null) lonely.push(index);
    path += `${pen ? "L" : "M"}${x(index)},${y(value)}`;
    pen = true;
  });
  return { path, lonely };
}

function bandPath(band: TrendBand, x: (index: number) => number, y: (value: number) => number) {
  let path = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length > 0) {
      const top = run.map((index) => `${x(index)},${y(band.high[index] as number)}`);
      const bottom = [...run].reverse().map((index) => `${x(index)},${y(band.low[index] as number)}`);
      path += `M${top.join("L")}L${bottom.join("L")}Z`;
    }
    run = [];
  };
  band.low.forEach((low, index) => {
    if (low === null || band.high[index] === null) flush();
    else run.push(index);
  });
  flush();
  return path;
}

export function TrendChart({
  keys,
  labels,
  titles,
  series,
  band,
  guides = [],
  regions = [],
  marks = [],
  ticks,
  formatValue,
  formatTick,
  ariaLabel,
  onSelect,
  notes,
  height = 220,
  endLabel = true,
}: {
  keys: string[];
  /** Short x-axis labels. */
  labels: string[];
  /** Tooltip headings. */
  titles: string[];
  series: TrendSeries[];
  band?: TrendBand;
  guides?: TrendGuide[];
  regions?: TrendRegion[];
  marks?: TrendMark[];
  ticks?: number[];
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  ariaLabel: string;
  onSelect?: (key: string) => void;
  /** An extra line in the tooltip of a position. */
  notes?: (index: number) => string | undefined;
  height?: number;
  /** Writes the latest value of the first series at its end. */
  endLabel?: boolean;
}) {
  const count = keys.length;
  const known = [
    ...series.flatMap((item) => item.values),
    ...(band ? [...band.low, ...band.high] : []),
    ...guides.map((guide) => guide.value),
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  const low = known.length ? Math.min(...known) : 0;
  const high = known.length ? Math.max(...known) : 1;
  const pad = Math.max((high - low) * 0.15, 1);
  const axis = ticks ?? niceTicks(Math.floor(low - pad), Math.ceil(high + pad));
  const first = series[0];
  const lastIndex = first ? first.values.reduce<number>((at, value, index) => (value === null ? at : index), -1) : -1;
  const lastText = endLabel && lastIndex >= 0 ? formatTick(first.values[lastIndex] as number) : "";

  return (
    <Plot
      count={count}
      domain={[axis[0], axis[axis.length - 1]]}
      ticks={axis}
      formatTick={formatTick}
      xLabel={(index) => labels[index]}
      ariaLabel={ariaLabel}
      height={height}
      crosshair
      rightPad={lastText ? lastText.length * 7 + 14 : 8}
      onSelect={onSelect && ((index) => onSelect(keys[index]))}
      tooltip={(index) => (
        <Tip
          title={titles[index]}
          rows={series.map((item) => ({
            label: item.label,
            color: item.color,
            value: item.values[index] === null ? "bez dát" : formatValue(item.values[index] as number),
          }))}
          note={notes?.(index)}
        />
      )}
    >
      {({ x, y, band: slot, active, left }) => {
        const right = x(count - 1) + slot / 2;
        const clampY = (value: number) => Math.min(Math.max(value, axis[0]), axis[axis.length - 1]);
        return (
          <>
            {regions.map((region) => {
              const top = y(clampY(region.to));
              const bottom = y(clampY(region.from));
              if (bottom - top < 12) return null;
              return (
                <text
                  key={region.label}
                  x={left + 6}
                  y={(top + bottom) / 2}
                  dy="0.32em"
                  className="chart-tick"
                  stroke="var(--surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {region.label}
                </text>
              );
            })}
            {band && <path d={bandPath(band, x, y)} fill={band.color} />}
            {guides.map((guide) => (
              <g key={guide.value}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(guide.value)}
                  y2={y(guide.value)}
                  stroke="var(--ink-2)"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  shapeRendering="crispEdges"
                />
                {guide.label && (
                  <text
                    x={guide.labelAt === "start" ? left + 4 : right}
                    y={y(guide.value) - 5}
                    textAnchor={guide.labelAt === "start" ? "start" : "end"}
                    className="chart-label"
                    stroke="var(--surface)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {guide.label}
                  </text>
                )}
              </g>
            ))}
            {series.map((item) => {
              const { path, lonely } = linePath(item.values, x, y);
              return (
                <g key={item.label}>
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={item.thin ? 1.5 : 2}
                    strokeDasharray={item.dashed ? "5 4" : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {lonely.map((index) => (
                    <circle key={index} cx={x(index)} cy={y(item.values[index] as number)} r={2.5} fill={item.color} />
                  ))}
                </g>
              );
            })}
            {marks.map((mark) => {
              const value = first?.values[mark.index];
              if (value === null || value === undefined) return null;
              return (
                <circle
                  key={mark.index}
                  cx={x(mark.index)}
                  cy={y(value)}
                  r={mark.ring ? 5 : 4.5}
                  fill={mark.ring ? "var(--surface)" : mark.color}
                  stroke={mark.ring ? mark.color : "var(--surface)"}
                  strokeWidth={mark.ring ? 2.5 : 2}
                />
              );
            })}
            {first && lastIndex >= 0 && (
              <>
                <circle cx={x(lastIndex)} cy={y(first.values[lastIndex] as number)} r={4.5} fill={first.color} stroke="var(--surface)" strokeWidth={2} />
                {lastText && (
                  <text x={x(lastIndex) + 10} y={y(first.values[lastIndex] as number)} dy="0.32em" className="chart-label">
                    {lastText}
                  </text>
                )}
              </>
            )}
            {first && active !== null && active !== lastIndex && first.values[active] !== null && (
              <circle cx={x(active)} cy={y(first.values[active] as number)} r={4.5} fill={first.color} stroke="var(--surface)" strokeWidth={2} />
            )}
          </>
        );
      }}
    </Plot>
  );
}
