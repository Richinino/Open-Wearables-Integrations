// A2 building blocks: glass tiles that are links, eyebrow labels, rings, bars and strips.
// Server-safe (no hooks), so detail pages can use them anywhere.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** A colour mixed into the page background, as the artboards do for steps of one hue. */
export function mix(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, var(--bg))`;
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`tile-arrow shrink-0 ${className}`}>
      <path d="M2 6h7.5M6.5 2.5 10 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The glass surface of a tile. Pair it with <TileTitle href>: the title link stretches over
 * the whole tile, so a click anywhere opens the detail and keyboard users get one tab stop
 * with a visible ring around the tile. Inner links and controls get `tile-raise`.
 */
export function TileShell({
  children,
  className = "",
  style,
  radius = 28,
  as: Tag = "section",
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  radius?: number;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={`tile glass flex min-w-0 flex-col ${className}`} style={{ borderRadius: radius, ...style }}>
      {children}
    </Tag>
  );
}

/**
 * The title of a tile; with `href` it is the link that covers the tile. Tiles whose parts
 * are links of their own pass `stretch={false}`: the title then links only itself.
 */
export function TileTitle({
  href,
  children,
  className = "eyebrow",
  id,
  stretch = true,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
  id?: string;
  stretch?: boolean;
}) {
  if (!href) {
    return (
      <h2 className={className} id={id}>
        {children}
      </h2>
    );
  }
  return (
    <Link
      href={href}
      className={`${stretch ? "tile-link" : "title-link"} inline-flex items-center gap-2 ${className}`}
      id={id}
    >
      {children}
      <Arrow />
    </Link>
  );
}

/** A tile with its title on top and an optional note on the right of the title row. */
export function Tile({
  href,
  label,
  labelClassName = "eyebrow",
  aside,
  children,
  className = "",
  style,
  radius = 28,
}: {
  href?: string;
  label: ReactNode;
  labelClassName?: string;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  radius?: number;
}) {
  const head = (
    <TileTitle href={href} className={labelClassName}>
      {label}
    </TileTitle>
  );
  return (
    <TileShell className={className} style={style} radius={radius}>
      {aside ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {head}
          {aside}
        </div>
      ) : (
        head
      )}
      {children}
    </TileShell>
  );
}

/** A conic ring with a disc of page colour inside, like the score ring of the overview. */
export function Ring({
  share,
  color = "var(--accent)",
  sweep = 1,
  from = 0,
  size,
  thickness,
  className = "",
  children,
  label,
}: {
  /** 0..1 of the sweep. */
  share: number | null;
  color?: string;
  /** Part of the circle the scale covers: 1 = full, 0.75 = the open score dial. */
  sweep?: number;
  /** Start angle in degrees. */
  from?: number;
  size?: number | string;
  thickness: number;
  className?: string;
  children?: ReactNode;
  /** Accessible text; without it the ring is decoration. */
  label?: string;
}) {
  const filled = Math.max(0, Math.min(1, share ?? 0)) * sweep * 100;
  const track = sweep * 100;
  const background =
    sweep >= 1
      ? `conic-gradient(from ${from}deg, ${color} 0 ${filled}%, var(--track) 0)`
      : `conic-gradient(from ${from}deg, ${color} 0 ${filled}%, var(--track) 0 ${track}%, transparent 0)`;
  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size, aspectRatio: "1" }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className="absolute inset-0 rounded-full" style={{ background }} />
      <div className="absolute rounded-full bg-bg" style={{ inset: thickness }} />
      {children && (
        <div className="absolute flex flex-col items-center justify-center rounded-full" style={{ inset: thickness }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A 4px bar for a value on a 0..1 scale. */
export function ScoreBar({ share, color }: { share: number | null; color: string }) {
  const width = Math.max(0, Math.min(1, share ?? 0)) * 100;
  return (
    <div className="h-1 rounded-sm bg-track" aria-hidden="true">
      <div className="h-full rounded-sm" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

/** Small bars, one per value; highlighted ones in `color`, the rest in the track colour. */
export function MiniBars({
  values,
  color,
  highlight,
  height = 36,
}: {
  values: (number | null)[];
  color: string;
  /** Indexes drawn in colour; default the last one. */
  highlight?: number[];
  height?: number;
}) {
  const top = Math.max(...values.map((value) => value ?? 0), 0);
  const marked = highlight ?? [values.length - 1];
  return (
    <div className="flex items-end gap-1" style={{ height }} aria-hidden="true">
      {values.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-t-[3px] rounded-b-[1px]"
          style={{
            height: value === null || top <= 0 ? "8%" : `${Math.max(8, Math.round((value / top) * 100))}%`,
            background: value === null ? "transparent" : marked.includes(index) ? color : "var(--track)",
            outline: value === null ? "1px dashed var(--line)" : undefined,
          }}
        />
      ))}
    </div>
  );
}

export const STAGE_COLORS: Record<string, string> = {
  deep: "var(--deep)",
  rem: "var(--rem)",
  light: "var(--lsleep)",
  asleep: "var(--lsleep)",
  awake: "var(--accent)",
};

export const STAGE_LABELS: Record<string, string> = {
  deep: "Hlboký",
  rem: "REM",
  light: "Ľahký",
  asleep: "Spánok",
  awake: "Bdenie",
};

/** The night as stage blocks in time order, 2px apart. */
export function StageStrip({
  segments,
  height = 28,
  label,
}: {
  segments: { stage: string; minutes: number }[];
  height?: number;
  label: string;
}) {
  if (segments.length === 0) {
    return <div className="rounded-lg bg-track" style={{ height }} role="img" aria-label={`${label}: bez dát`} />;
  }
  return (
    <div className="flex gap-0.5 overflow-hidden rounded-lg" style={{ height }} role="img" aria-label={label}>
      {segments.map((segment, index) => (
        <div
          key={index}
          style={{ flex: `${segment.minutes} 1 0`, minWidth: 2, background: STAGE_COLORS[segment.stage] ?? "var(--lsleep)" }}
        />
      ))}
    </div>
  );
}

/** Light, moderate and vigorous minutes as one thin bar in steps of the accent. */
export function ZoneBar({
  light,
  moderate,
  vigorous,
  height = 6,
  label,
}: {
  light: number;
  moderate: number;
  vigorous: number;
  height?: number;
  label: string;
}) {
  const parts = [
    { value: light, color: mix("var(--accent)", 38) },
    { value: moderate, color: mix("var(--accent)", 68) },
    { value: vigorous, color: "var(--accent)" },
  ].filter((part) => part.value > 0);
  return (
    <div className="flex gap-0.5 overflow-hidden rounded-[3px]" style={{ height }} role="img" aria-label={label}>
      {parts.length === 0 ? (
        <div className="flex-1 bg-track" />
      ) : (
        parts.map((part, index) => <div key={index} style={{ flex: `${part.value} 1 0`, background: part.color }} />)
      )}
    </div>
  );
}

/** Page title block of the detail pages: eyebrow, large light heading, optional line. */
export function PageHead({ eyebrow, title, children }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rise px-1">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="figure mt-3 text-[clamp(44px,6vw,76px)]">{title}</h1>
      {children && <div className="mt-3 text-[14px] text-ink2">{children}</div>}
    </div>
  );
}
