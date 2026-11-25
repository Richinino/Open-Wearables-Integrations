"use client";

import { CountUp, useFirstTime } from "@/components/ui/motion";
import { formatInt } from "@/lib/format";

export interface RingPart {
  key: string;
  label: string;
  /** 0..100, or null when the score is missing. */
  value: number | null;
  color: string;
}

const RADII = [132, 108, 84];
const STROKE = 16;

/**
 * The day score as three tracks around one number: Pripravenosť outside, Výkon spánku in
 * the middle, Aktivita inside. The first time a date's score is shown in this browser the
 * tracks draw in one after another, the number counts up and a glow blooms behind it; on
 * later visits it simply stands there (the overview is opened many times a day).
 */
export function TripleRing({
  parts,
  score,
  caption,
  date,
}: {
  parts: RingPart[];
  score: number | null;
  caption: string;
  date: string;
}) {
  const first = useFirstTime(`day-score:${date}:${score === null ? "none" : "ready"}`);
  const play = first && score !== null;
  const label =
    score === null
      ? "Skóre dňa zatiaľ nie je"
      : `Skóre dňa ${formatInt(score)} zo 100. ${parts.map((part) => `${part.label} ${part.value === null ? "bez dát" : formatInt(part.value)}`).join(", ")}.`;

  return (
    <div className="relative w-full max-w-[280px] self-center">
      {play && (
        <div
          aria-hidden="true"
          className="score-glow pointer-events-none absolute -inset-10 rounded-full"
          style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--accent) 30%, transparent), transparent)" }}
        />
      )}
      <svg viewBox="0 0 300 300" className="relative block h-auto w-full overflow-visible" role="img" aria-label={label}>
        <g transform="rotate(-90 150 150)" fill="none" strokeWidth={STROKE} strokeLinecap="round">
          {parts.map((part, index) => (
            <circle key={`track-${part.key}`} cx={150} cy={150} r={RADII[index]} stroke="var(--track)" />
          ))}
          {parts.map((part, index) =>
            part.value === null || part.value <= 0 ? null : (
              <circle
                key={part.key}
                cx={150}
                cy={150}
                r={RADII[index]}
                stroke={part.color}
                pathLength={100}
                strokeDasharray={100}
                strokeDashoffset={100 - Math.min(100, part.value)}
                className={play ? "arc-draw" : undefined}
                style={play ? { animationDelay: `${index * 110}ms` } : undefined}
              />
            ),
          )}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="figure tabular text-[clamp(54px,5.4vw,72px)] leading-[0.9] tracking-[-0.05em]">
          {play ? <CountUp value={score} format={formatInt} id={`day-score:${date}`} duration={700} delay={260} /> : formatInt(score)}
        </span>
        <span className="mt-1.5 text-[13px] text-ink2">{caption}</span>
      </div>
    </div>
  );
}
