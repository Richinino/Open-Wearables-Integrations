// The parts of a score as rows for a labelled bar list: documented parts first, in their
// order, then any part owi sends that the table does not know. Shared by the sleep,
// readiness and activity detail pages.

import { componentLabel } from "@/lib/scores";
import type { Score } from "@/lib/types";

export interface PartSpec {
  key: string;
  max: number;
  explain: string;
  weight?: number;
}

/** Oura's words for a contributor: 85+ optimal, 70-84 good, below 70 pay attention. */
export type PartTone = "optimal" | "good" | "attention";

export const PART_TONE_LABEL: Record<PartTone, string> = {
  optimal: "optimálne",
  good: "dobré",
  attention: "pozor",
};

export interface PartRow {
  key: string;
  label: string;
  value: number | null;
  max: number;
  /** value / max, 0..1. */
  share: number | null;
  explain: string | null;
  weight: number | null;
  tone: PartTone | null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function partTone(share: number | null): PartTone | null {
  if (share === null) return null;
  const percent = Math.round(share * 100);
  if (percent >= 85) return "optimal";
  if (percent >= 70) return "good";
  return "attention";
}

/**
 * Like partRows, but the listed parts appear only when the score has them: for the scores
 * whose part names owi may choose, so a guessed name never shows as an empty row.
 */
export function presentPartRows(score: Score | null | undefined, specs: PartSpec[]): PartRow[] {
  const components = score?.components ?? {};
  return partRows(score, specs.filter((spec) => Object.hasOwn(components, spec.key)));
}

export function partRows(score: Score | null | undefined, specs: PartSpec[]): PartRow[] {
  const components = score?.components ?? {};
  const known = new Set(specs.map((spec) => spec.key));
  const extra = Object.keys(components)
    .filter((key) => !known.has(key))
    .sort()
    .map((key): PartSpec => ({ key, max: 100, explain: "" }));
  return [...specs, ...extra].map((spec) => {
    const raw = Object.hasOwn(components, spec.key) ? components[spec.key] : null;
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    const share = value === null || spec.max <= 0 ? null : Math.max(0, Math.min(1, value / spec.max));
    return {
      key: spec.key,
      label: capitalize(componentLabel(spec.key)),
      value,
      max: spec.max,
      share,
      explain: spec.explain || null,
      weight: spec.weight ?? null,
      tone: partTone(share),
    };
  });
}
