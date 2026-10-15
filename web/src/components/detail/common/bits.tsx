// Small server-safe pieces of the detail pages: the page head with its way back, the vendor
// line, the "deň ešte beží" hint, labelled figures and the part bars of a score.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { PageHead, Ring, ScoreBar } from "@/components/ui/tile";
import { formatInt } from "@/lib/format";
import { PART_TONE_LABEL, type PartRow } from "./score-parts";

/** The `--i` custom property for the staggered `.rise` entrance. */
export function riseStyle(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/** PageHead with "← Prehľad" in the eyebrow, so every detail page leads back to the overview. */
export function DetailHead({ section, title, children }: { section: string; title: ReactNode; children?: ReactNode }) {
  return (
    <PageHead
      eyebrow={
        <>
          <Link
            href="/"
            className="-mx-2 -my-3 inline-flex items-center gap-1.5 rounded-full px-2 py-3 no-underline transition-colors hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
              <path d="M10 6H2.5M5.5 2.5 2 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Prehľad
          </Link>
          <span aria-hidden="true" className="mx-2 text-muted">
            /
          </span>
          {section}
        </>
      }
      title={title}
    >
      {children}
    </PageHead>
  );
}

/** Whose method a score follows: subtle, detail pages only. */
export function VendorLine({ children }: { children: ReactNode }) {
  return <p className="mono text-[11px] tracking-[0.04em] text-muted uppercase">{children}</p>;
}

/** Marks a running total of an unfinished day; dashed like the running day in the heatmap. */
export function RunningHint({ children = "deň ešte beží" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-ink2/60 px-2.5 py-0.5 text-[12px] whitespace-nowrap text-ink2">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-ink2" />
      {children}
    </span>
  );
}

/** Why a value is missing or limited, in a muted line. */
export function NoteLine({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-muted">{children}</p>;
}

/** A small labelled figure: eyebrow-like label, value, optional unit and note. */
export function Figure({
  label,
  value,
  unit,
  note,
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const valueClass =
    size === "lg" ? "figure text-[44px] leading-none tracking-[-0.03em]" : size === "sm" ? "figure-sm text-[20px]" : "figure-sm text-[28px]";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="text-[12px] text-ink2">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={`${valueClass} whitespace-nowrap`}>{value}</span>
        {unit && <span className="text-[13px] text-ink2">{unit}</span>}
      </div>
      {note && <div className="text-[12px] text-muted">{note}</div>}
    </div>
  );
}

/** The open score dial of the overview, with the value and its band in the middle. */
export function ScoreDial({
  share,
  color,
  value,
  band,
  sub,
  label,
}: {
  share: number | null;
  color: string;
  value: string;
  band: ReactNode;
  sub?: ReactNode;
  label: string;
}) {
  return (
    <Ring share={share ?? 0} color={color} sweep={0.75} from={225} thickness={12} className="w-full max-w-[230px] self-center" label={label}>
      <span className="figure text-[clamp(64px,7vw,88px)] leading-[0.9] tracking-[-0.05em] whitespace-nowrap">{value}</span>
      <span className="mt-1.5 text-center text-[14px] text-ink2">{band}</span>
      {sub && <span className="mono mt-1 text-[11px] text-muted">{sub}</span>}
    </Ring>
  );
}

/** The parts of a score: name and value, a 4px bar, Oura's word for it and what it measures. */
export function PartsList({
  rows,
  color,
  facts = {},
  columns = 1,
}: {
  rows: PartRow[];
  color: string;
  /** A measured fact per part, shown before the explanation, e.g. "7 h 36 min z 8 h 20 min". */
  facts?: Record<string, string | null | undefined>;
  columns?: 1 | 2;
}) {
  return (
    <ul className={`grid gap-x-8 gap-y-5 ${columns === 2 ? "lg:grid-cols-2" : ""}`}>
      {rows.map((row) => {
        const fact = facts[row.key];
        return (
          <li key={row.key} className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-[14px] text-ink2">{row.label}</span>
              <span className="whitespace-nowrap">
                {row.tone && (
                  <span className={`mr-2 text-[12px] ${row.tone === "attention" ? "font-semibold text-ink" : "text-muted"}`}>
                    {PART_TONE_LABEL[row.tone]}
                  </span>
                )}
                <span className="text-[20px] font-medium">{formatInt(row.value)}</span>
                {row.max !== 100 && <span className="text-[13px] text-muted"> / {row.max}</span>}
              </span>
            </div>
            <ScoreBar share={row.share} color={color} />
            <span className="text-[12px] text-muted">
              {fact && <span className="text-ink2">{fact} · </span>}
              {row.explain ?? (row.value === null ? "bez dát" : "")}
              {row.weight !== null && ` · váha ${formatInt(row.weight * 100)} %`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A coloured key next to a label, for legends that sit beside numbers. */
export function Swatch({ color, line = false }: { color: string; line?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={line ? "h-0.5 w-3 shrink-0 rounded-full" : "size-[9px] shrink-0 rounded-[3px]"}
      style={{ background: color }}
    />
  );
}

export interface KeyItem {
  label: ReactNode;
  color: string;
  /** A line key (for lines and markers) instead of a box (for bars and areas). */
  line?: boolean;
  dashed?: boolean;
}

/** Legend under a chart; each key may be a box or a line. */
export function Keys({ items }: { items: KeyItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2">
      {items.map((item, index) => (
        <li key={index} className="flex items-center gap-1.5">
          {item.dashed ? (
            <span aria-hidden="true" className="w-3.5 shrink-0 border-t-2 border-dashed" style={{ borderColor: item.color }} />
          ) : (
            <Swatch color={item.color} line={item.line} />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A section heading between tiles, with an optional control on the right. */
export function SectionBar({ title, children, id }: { title: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-4">
      <h2 id={id} className="text-[22px] font-medium tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </div>
  );
}
