// Small A2 pieces shared by the calendar, day, workouts and long-term pages.
// Server-safe (no hooks).

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where a score's method comes from; detail pages name it subtly, the overview never does. */
export const VENDOR = {
  readiness: "podľa Oura · dostupné vstupy, odhad",
  sleepPerformance: "podľa WHOOP",
  appleSleep: "podľa Apple",
  activity: "podľa Oura",
  strain: "podľa WHOOP",
  sleepNeed: "podľa WHOOP",
  cardioLoad: "podľa Polar",
  nightSignal: "podľa štúdie NightSignal (Alavi 2022)",
  whoopAge: "podľa WHOOP",
  vo2Uth: "vzorec Uth–Sørensen",
  regularity: "Sleep Regularity Index",
} as const;

export function VendorLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mono text-[11px] tracking-[0.02em] text-muted ${className}`}>{children}</p>;
}

/** The staggered entrance of the page: `rise` with its position. */
export function riseStyle(index: number, style?: CSSProperties): CSSProperties {
  return { "--i": index, ...style } as CSSProperties;
}

const ROUND =
  "grid size-11 shrink-0 place-items-center rounded-full border border-line text-[18px] transition-colors";

/** A round previous/next control: a link, a button, or a dimmed stop at either end. */
export function RoundNav({
  label,
  href,
  onClick,
  children,
}: {
  label: string;
  href?: string | null;
  onClick?: (() => void) | null;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={`${ROUND} bg-glass text-ink no-underline hover:bg-sunk`}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" aria-label={label} title={label} onClick={onClick} className={`${ROUND} cursor-pointer bg-glass text-ink hover:bg-sunk`}>
        {children}
      </button>
    );
  }
  return (
    <button type="button" aria-label={label} disabled className={`${ROUND} bg-transparent text-muted opacity-60`}>
      {children}
    </button>
  );
}

/** Label and value rows with a hairline above each, as in the calendar's side panel. */
export function Rows({
  rows,
  size = "md",
}: {
  rows: { k: ReactNode; v: ReactNode; key?: string }[];
  size?: "md" | "lg";
}) {
  return (
    <dl className="flex flex-col">
      {rows.map((row, index) => (
        <div
          key={row.key ?? index}
          className={`flex items-baseline justify-between gap-3 border-t border-line ${size === "lg" ? "py-3" : "py-2.5"}`}
        >
          <dt className={`text-[14px] text-ink2`}>{row.k}</dt>
          <dd className={`tabular text-right ${size === "lg" ? "figure-sm text-[22px] font-medium" : "text-[14px] font-semibold"}`}>
            {row.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A legend item: a small swatch and its label. */
export function Swatch({ color, label, shape = "square" }: { color: string; label: ReactNode; shape?: "square" | "line" | "dot" | "ring" }) {
  const mark =
    shape === "line" ? (
      <span aria-hidden="true" className="h-1 w-4 rounded-sm" style={{ background: color }} />
    ) : shape === "dot" ? (
      <span aria-hidden="true" className="size-[7px] rounded-full" style={{ background: color }} />
    ) : shape === "ring" ? (
      <span aria-hidden="true" className="size-[13px] rounded-full border-[3px]" style={{ borderColor: color }} />
    ) : (
      <span aria-hidden="true" className="size-[9px] rounded-[3px]" style={{ background: color }} />
    );
  return (
    <span className="inline-flex items-center gap-[7px] text-[12px] text-ink2">
      {mark}
      {label}
    </span>
  );
}

/** A small bordered note next to a heading, such as "deň ešte beží". */
export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] tracking-[0.04em]"
      style={{
        borderColor: tone === "warn" ? "color-mix(in oklab, var(--warn) 55%, transparent)" : "var(--line)",
        color: tone === "warn" ? "var(--warn)" : "var(--ink2)",
      }}
    >
      {children}
    </span>
  );
}
