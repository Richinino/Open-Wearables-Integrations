"use client";

import { useId, useState } from "react";
import { Sparkline } from "@/components/charts/charts";
import { formatChange } from "@/lib/format";

export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`glass p-5 sm:p-7 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-[19px] font-semibold tracking-tight">{children}</h2>
      {aside && <div className="text-[13px] text-ink-2">{aside}</div>}
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
}

export function Legend({ items, line = false }: { items: LegendItem[]; line?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]"}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export interface TableData {
  columns: string[];
  rows: string[][];
}

export function DataTable({ columns, rows, maxHeight }: TableData & { maxHeight?: number }) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={`sticky top-0 border-b border-line-strong bg-surface py-2 pr-4 font-semibold whitespace-nowrap text-ink-2 ${index ? "text-right" : ""}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, at) => (
            <tr key={at} className="border-b border-line last:border-0">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`py-2 pr-4 whitespace-nowrap ${index ? "tabular text-right" : "text-ink-2"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A chart with its title, legend and a table twin of the same numbers. */
export function ChartCard({
  title,
  subtitle,
  legend,
  legendLine,
  table,
  height = 220,
  className = "",
  style,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  legend?: LegendItem[];
  legendLine?: boolean;
  table: TableData;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      className={`glass p-5 sm:p-7 ${className}`}
      style={style}
    >
      <figcaption className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[15px] font-semibold tracking-tight">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((value) => !value)}
          aria-pressed={asTable}
          className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink2 transition-colors hover:bg-sunk hover:text-ink"
        >
          {asTable ? "Graf" : "Tabuľka"}
        </button>
      </figcaption>
      {asTable ? (
        <DataTable {...table} maxHeight={height + (legend ? 28 : 0)} />
      ) : (
        <>
          {children}
          {legend && (
            <div className="mt-3">
              <Legend items={legend} line={legendLine} />
            </div>
          )}
        </>
      )}
    </figure>
  );
}

/** Signed change against the previous period; an arrow and a sign, never colour alone. */
export function Delta({
  change,
  upIsGood,
  label,
}: {
  change: number | null;
  /** Null when neither direction is better. */
  upIsGood: boolean | null;
  /** What the change is measured against, when the surroundings do not say. */
  label?: string;
}) {
  if (change === null) return <span className="text-[12px] text-muted">bez porovnania</span>;
  const flat = Math.abs(change) < 0.005;
  const good = upIsGood === null || flat ? null : change > 0 === upIsGood;
  const tone = good === null ? "text-ink-2" : good ? "text-good-ink" : "text-bad";
  return (
    <span className="text-[12px] text-muted">
      <span className={`font-semibold tabular ${tone}`}>
        {flat ? "→" : change > 0 ? "↑" : "↓"} {formatChange(change)}
      </span>
      {label && ` ${label}`}
    </span>
  );
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  trend,
  color,
  hint,
  className = "",
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: React.ReactNode;
  trend?: (number | null)[];
  color?: string;
  hint?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`glass flex flex-col p-4 sm:p-[22px] ${className}`}
      style={{ borderRadius: 24, ...style }}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="figure text-[30px] whitespace-nowrap xs:text-[34px] sm:text-[40px]">{value}</span>
        {unit && <span className="text-[13px] font-medium text-ink-2">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[12px] text-muted">{hint}</div>}
      {(trend || delta) && (
        <div className="mt-auto pt-3">
          {trend && color && (
            <div className="mb-1.5 w-[120px] max-w-full">
              <Sparkline values={trend} color={color} />
            </div>
          )}
          {delta}
        </div>
      )}
    </div>
  );
}

export interface Segment {
  label: string;
  value: number | null;
  color: string;
}

/** Horizontal part-to-whole bar; a surface gap separates the segments. */
export function SegmentBar({
  segments,
  height = 10,
  ariaLabel,
}: {
  segments: Segment[];
  height?: number;
  ariaLabel: string;
}) {
  const shown = segments.filter((segment) => (segment.value ?? 0) > 0);
  if (shown.length === 0) {
    return <div className="rounded-full bg-sunk" style={{ height }} role="img" aria-label={`${ariaLabel}: bez dát`} />;
  }
  return (
    <div
      className="flex gap-0.5 overflow-hidden rounded-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      {shown.map((segment) => (
        <div
          key={segment.label}
          style={{ flexGrow: segment.value ?? 0, background: segment.color, minWidth: 3 }}
        />
      ))}
    </div>
  );
}

/** A value against a reference; the track is a lighter step of the same hue. */
export function Meter({
  value,
  limit,
  color,
  track,
  ariaLabel,
}: {
  value: number;
  limit: number;
  color: string;
  track: string;
  ariaLabel: string;
}) {
  const share = limit > 0 ? Math.min(value / limit, 1) : 0;
  return (
    <div
      className="h-2 overflow-hidden rounded-full"
      style={{ background: track }}
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(limit)}
      aria-valuenow={Math.round(Math.min(value, limit))}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${share * 100}%`, background: color }}
      />
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="glass inline-flex gap-1.5 p-1" style={{ borderRadius: 26 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className="pill border-0"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="glass px-6 py-14 text-center" style={{ borderStyle: "dashed", borderColor: "var(--line-strong)" }}>
      <p className="text-[17px] font-semibold tracking-tight">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-sm text-[14px] text-ink-2">{children}</p>}
    </div>
  );
}
