// What the detail pages say about tuning on the user's Samsung Health entries: the line
// under owi's estimates, and the box of a Samsung-style score that is still learning.
// Server-safe.

import Link from "next/link";
import { ROUTES } from "@/components/shell/nav";
import { Arrow } from "@/components/ui/tile";
import { formatInt } from "@/lib/format";
import { calibrationNote, learningText } from "@/lib/samsung";
import type { Calibration, QualityTarget, Score } from "@/lib/types";

export function CalibrationNote({
  calibration,
  targets,
}: {
  calibration: Calibration | null | undefined;
  targets: readonly { key: QualityTarget; label?: string }[];
}) {
  const text = calibrationNote(calibration, targets);
  if (!text) return null;
  return (
    <p className="flex items-start gap-2 text-[12px] text-muted">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="mt-[3px] shrink-0">
        <path d="M2 6.5 4.6 9 10 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{text}</span>
    </p>
  );
}

/** Active time and the two calorie estimates, as the activity and day pages show them. */
export const ACTIVITY_TARGETS = [
  { key: "active_minutes", label: "aktívny čas" },
  { key: "active_kcal", label: "z aktivity" },
  { key: "total_kcal", label: "spolu" },
] as const satisfies readonly { key: QualityTarget; label: string }[];

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** While a Samsung-style score learns: how many entries it still needs, and where to add them. */
export function LearningBox({ score, what }: { score: Score | null | undefined; what: string }) {
  const text = learningText(score);
  if (!text) return null;
  const needed = score?.components?.needed;
  return (
    <div className="flex flex-col gap-2 rounded-[18px] border border-dashed border-line-strong p-4">
      <p className="text-[15px] font-semibold">{capitalize(text)}</p>
      <p className="text-[12px] text-muted">
        Odhad sa ukáže od {formatInt(typeof needed === "number" ? needed : 10)} zápisov {what} zo Samsung Health.
      </p>
      <Link href={ROUTES.entries} className="title-link inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-ink2">
        Doplniť zápisy <Arrow />
      </Link>
    </div>
  );
}
