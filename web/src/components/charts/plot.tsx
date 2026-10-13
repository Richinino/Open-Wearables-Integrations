"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface PlotContext {
  /** Horizontal centre of position `index`. */
  x: (index: number) => number;
  y: (value: number) => number;
  /** Width available to one position. */
  band: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  active: number | null;
}

interface PlotProps {
  /** Number of positions along the x axis. */
  count: number;
  /** Value at the bottom and at the top of the plot. Reversed domains are fine. */
  domain: readonly [number, number];
  ticks: readonly number[];
  formatTick: (value: number) => string;
  xLabel: (index: number) => string;
  ariaLabel: string;
  tooltip: (index: number) => React.ReactNode;
  onSelect?: (index: number) => void;
  /** Total height including the x-axis band. */
  height?: number;
  /** Vertical hairline at the active position, for line charts. */
  crosshair?: boolean;
  /** Dashed annotation line, e.g. the period average. */
  reference?: { value: number; label: string } | null;
  /** Room on the right for an end label. */
  rightPad?: number;
  children: (context: PlotContext) => React.ReactNode;
}

const X_LABEL_WIDTH = 40;
const X_LABEL_GAP = 10;
const AXIS_BAND = 24;
const TOP_PAD = 14;

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Whole-number ticks covering [min, max] in at most `maxIntervals` steps,
 * picked to leave as little empty room above the data as possible.
 */
export function niceTicks(min: number, max: number, maxIntervals = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max <= min) max = min + 1;
  const power = 10 ** Math.floor(Math.log10((max - min) / maxIntervals));
  let best: { first: number; last: number; step: number } | null = null;
  for (const scale of [power / 10, power, power * 10, power * 100]) {
    for (const multiple of [1, 2, 5]) {
      const step = scale * multiple;
      if (step < 1) continue;
      const first = Math.floor(min / step) * step;
      const last = Math.ceil(max / step) * step;
      if ((last - first) / step > maxIntervals) continue;
      if (!best || last - first < best.last - best.first) best = { first, last, step };
    }
  }
  if (!best) return [min, max];
  const ticks: number[] = [];
  for (let value = best.first; value <= best.last + best.step / 2; value += best.step) {
    ticks.push(Math.round(value));
  }
  return ticks;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), high);
}

export function Plot({
  count,
  domain,
  ticks,
  formatTick,
  xLabel,
  ariaLabel,
  tooltip,
  onSelect,
  height = 220,
  crosshair = false,
  reference = null,
  rightPad = 4,
  children,
}: PlotProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pointerType = useRef("mouse");
  const primed = useRef<number | null>(null);
  const hintId = useId();

  const tickLabels = ticks.map(formatTick);
  const left = Math.max(...tickLabels.map((label) => label.length), 1) * 6.4 + 10;
  const right = rightPad;
  const top = TOP_PAD;
  const bottom = height - AXIS_BAND;
  const inner = Math.max(width - left - right, 0);
  const band = count > 0 ? inner / count : 0;
  const [low, high] = domain;
  const x = (index: number) => left + band * (index + 0.5);
  const y = (value: number) => bottom - ((value - low) / (high - low || 1)) * (bottom - top);

  // Labels are placed from the newest position backwards, each only if it clears the last one.
  const labelled: { index: number; centre: number }[] = [];
  let limit = Infinity;
  for (let index = count - 1; index >= 0 && width > 0; index--) {
    const centre = Math.min(x(index), width - X_LABEL_WIDTH / 2);
    if (centre + X_LABEL_WIDTH / 2 + X_LABEL_GAP > limit) continue;
    labelled.push({ index, centre });
    limit = centre - X_LABEL_WIDTH / 2;
  }

  const indexAt = (clientX: number, target: Element) => {
    const offset = clientX - target.getBoundingClientRect().left - left;
    return clamp(Math.floor(offset / (band || 1)), 0, count - 1);
  };

  const context: PlotContext = { x, y, band, top, bottom, left, right, active };
  const ready = width > 0 && count > 0;
  const activeX = active === null ? 0 : x(active);
  const align = activeX < 96 ? "start" : activeX > width - 96 ? "end" : "middle";
  const content = active === null ? null : tooltip(active);

  return (
    <div
      ref={ref}
      className="relative select-none outline-none focus-visible:[&>svg]:outline-2 focus-visible:[&>svg]:outline-offset-4 focus-visible:[&>svg]:outline-ink"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      aria-describedby={hintId}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (count === 0) return;
        const current = active ?? count - 1;
        const moves: Record<string, number> = {
          ArrowLeft: current - 1,
          ArrowRight: active === null ? current : current + 1,
          Home: 0,
          End: count - 1,
        };
        if (event.key in moves) {
          event.preventDefault();
          setActive(clamp(moves[event.key], 0, count - 1));
        } else if ((event.key === "Enter" || event.key === " ") && active !== null && onSelect) {
          event.preventDefault();
          onSelect(active);
        } else if (event.key === "Escape") {
          setActive(null);
        }
      }}
    >
      <span id={hintId} className="sr-only">
        Šípkami vľavo a vpravo prechádzaš hodnoty{onSelect ? ", Enter otvorí deň" : ""}.
      </span>
      {ready && (
        <svg
          width={width}
          height={height}
          className={onSelect ? "cursor-pointer" : undefined}
          aria-hidden="true"
          onPointerDown={(event) => {
            pointerType.current = event.pointerType;
          }}
          onPointerMove={(event) => {
            if (event.pointerType !== "touch") setActive(indexAt(event.clientX, event.currentTarget));
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setActive(null);
          }}
          onClick={(event) => {
            const index = indexAt(event.clientX, event.currentTarget);
            // A finger has no hover: the first tap shows the value, the second opens it.
            if (pointerType.current === "touch" && primed.current !== index) {
              primed.current = index;
              setActive(index);
              return;
            }
            onSelect?.(index);
          }}
        >
          {ticks.map((tick, index) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 && low === 0 ? "var(--line-strong)" : "var(--line)"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
                {tickLabels[index]}
              </text>
            </g>
          ))}

          {active !== null && (
            <rect
              x={x(active) - band / 2}
              y={top}
              width={band}
              height={bottom - top}
              fill="var(--surface-sunk)"
              opacity={crosshair ? 0 : 1}
            />
          )}
          {active !== null && crosshair && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={top}
              y2={bottom}
              stroke="var(--line-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          )}

          {children(context)}

          {reference && (
            <g>
              <line
                x1={left}
                x2={width - right}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke="var(--ink-2)"
                strokeWidth={1}
                strokeDasharray="2 4"
                shapeRendering="crispEdges"
              />
              <text
                x={width - right}
                y={y(reference.value) - 5}
                textAnchor="end"
                className="chart-label"
                stroke="var(--surface)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {reference.label}
              </text>
            </g>
          )}

          {labelled.map(({ index, centre }) => (
            <text key={index} x={centre} y={bottom + 16} textAnchor="middle" className="chart-tick">
              {xLabel(index)}
            </text>
          ))}
        </svg>
      )}

      {active !== null && content && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-ink px-3 py-2 text-[12px] leading-snug whitespace-nowrap text-page shadow-lg"
          style={{
            left: activeX,
            top: 2,
            transform: `translate(${align === "start" ? "-12px" : align === "end" ? "calc(-100% + 12px)" : "-50%"}, -100%)`,
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

/** Tooltip body: the value leads, the label follows. */
export function Tip({
  title,
  rows,
  note,
}: {
  title: string;
  rows: { label?: string; value: string; color?: string }[];
  note?: string;
}) {
  return (
    <div>
      <div className="mb-1 opacity-70">{title}</div>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          {row.color && (
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
          )}
          <span className="font-semibold tabular">{row.value}</span>
          {row.label && <span className="opacity-70">{row.label}</span>}
        </div>
      ))}
      {note && <div className="mt-1 opacity-70">{note}</div>}
    </div>
  );
}
