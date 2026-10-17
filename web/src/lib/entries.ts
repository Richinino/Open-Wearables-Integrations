// Entries copied from Samsung Health: the seven fields with owi's ranges, parsing of what
// the user types (Slovak decimal comma, spaces between thousands) and the checks shared by
// the form and the route handler. Ranges and messages match `PUT /v1/entries/{day}` in owi,
// so a value the form accepts is one owi accepts. Pure functions, no environment.

import { isValidDay } from "./dates";
import { formatInt } from "./format";
import type { Entry, EntryField, EntryValues } from "./types";

export interface EntryFieldSpec {
  key: EntryField;
  label: string;
  unit: string | null;
  min: number;
  max: number;
  integer: boolean;
  /** Keyboard on phones: digits only, or digits with a decimal comma. */
  inputMode: "numeric" | "decimal";
  /** Decimals kept when a saved value goes back into the form. */
  decimals: number;
}

export const ENTRY_FIELDS: readonly EntryFieldSpec[] = [
  { key: "steps", label: "Kroky", unit: null, min: 0, max: 100_000, integer: true, inputMode: "numeric", decimals: 0 },
  { key: "distance_km", label: "Vzdialenosť", unit: "km", min: 0, max: 150, integer: false, inputMode: "decimal", decimals: 2 },
  { key: "active_minutes", label: "Aktívny čas", unit: "min", min: 0, max: 1_440, integer: false, inputMode: "numeric", decimals: 1 },
  { key: "active_kcal", label: "Aktívne kalórie", unit: "kcal", min: 0, max: 10_000, integer: false, inputMode: "numeric", decimals: 1 },
  { key: "total_kcal", label: "Kalórie spolu", unit: "kcal", min: 500, max: 15_000, integer: false, inputMode: "numeric", decimals: 1 },
  { key: "sleep_score", label: "Sleep Score", unit: null, min: 0, max: 100, integer: false, inputMode: "numeric", decimals: 1 },
  { key: "energy_score", label: "Energy Score", unit: null, min: 0, max: 100, integer: false, inputMode: "numeric", decimals: 1 },
];

/** Field errors keyed like the body, plus "day" and "body"; Slovak, a few words each. */
export type FieldErrors = Record<string, string>;

export const MESSAGES = {
  number: "číslo",
  integer: "celé číslo",
  day: "neplatný dátum",
  outOfRange: "mimo rozsahu",
  body: "neplatné údaje",
} as const;

export function rangeText(spec: EntryFieldSpec): string {
  return `${formatInt(spec.min)}–${formatInt(spec.max)}`;
}

/** Why `value` cannot be saved in the field, or null when it can (null itself is fine). */
export function checkValue(value: unknown, spec: EntryFieldSpec): string | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return MESSAGES.number;
  if (spec.integer && !Number.isInteger(value)) return MESSAGES.integer;
  if (value < spec.min || value > spec.max) return rangeText(spec);
  return null;
}

export type ParsedInput = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * What the user typed in a field. Empty means "not filled in". Accepts "17,9" and "17.9",
 * "23 588" (any space between thousands) and, in whole-number fields, "23.588" or "23,588".
 */
export function parseInput(text: string, spec: EntryFieldSpec): ParsedInput {
  let normalized = text.replace(/[\s  ]/g, "");
  if (normalized === "") return { ok: true, value: null };
  if (spec.integer && /^\d{1,3}([.,]\d{3})+$/.test(normalized)) normalized = normalized.replace(/[.,]/g, "");
  normalized = normalized.replace(",", ".").replace(/^−/, "-");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return { ok: false, message: MESSAGES.number };
  const value = Number(normalized);
  const problem = checkValue(value, spec);
  return problem ? { ok: false, message: problem } : { ok: true, value };
}

/** A number for the form: Slovak decimal comma, no grouping, at most the field's decimals. */
export function inputText(value: number | null | undefined, spec: EntryFieldSpec): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Number(value.toFixed(spec.decimals))).replace(".", ",");
}

export function emptyValues(): EntryValues {
  return {
    steps: null,
    distance_km: null,
    active_minutes: null,
    active_kcal: null,
    total_kcal: null,
    sleep_score: null,
    energy_score: null,
  };
}

export function isEmpty(values: EntryValues): boolean {
  return ENTRY_FIELDS.every((spec) => values[spec.key] === null);
}

/** True when the entry exists and holds at least one number. */
export function hasEntry(entry: Entry | null | undefined): entry is Entry {
  return Boolean(entry) && ENTRY_FIELDS.some((spec) => typeof entry?.[spec.key] === "number");
}

export type CheckedBody = { ok: true; values: EntryValues } | { ok: false; fields: FieldErrors };

/**
 * The JSON body of a save: an object with the seven fields; a missing field is null and
 * unknown keys are dropped, so only the seven fields ever travel on to owi.
 */
export function checkBody(body: unknown): CheckedBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fields: { body: MESSAGES.body } };
  }
  const record = body as Record<string, unknown>;
  const values = emptyValues();
  const fields: FieldErrors = {};
  for (const spec of ENTRY_FIELDS) {
    const raw = Object.hasOwn(record, spec.key) ? record[spec.key] : undefined;
    const value = raw === undefined ? null : raw;
    const problem = checkValue(value, spec);
    if (problem) fields[spec.key] = problem;
    else values[spec.key] = value as number | null;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, values };
}

export interface DayBounds {
  /** First day that can take an entry; null when the caller cannot know it. */
  first: string | null;
  last: string;
}

/** Why `day` cannot take an entry, or null. */
export function checkDay(day: string, bounds: DayBounds): string | null {
  if (!isValidDay(day)) return MESSAGES.day;
  if ((bounds.first !== null && day < bounds.first) || day > bounds.last) return MESSAGES.outOfRange;
  return null;
}
