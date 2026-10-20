import "server-only";

import { addDays, todayIn } from "./dates";
import { emptyValues, ENTRY_FIELDS, hasEntry, type DayBounds, type FieldErrors } from "./entries";
import { DEMO_DAYS, DEMO_TIME_ZONE } from "./owi";
import type { Entry, EntryValues } from "./types";

// Saving an entry through `PUT /v1/entries/{day}` of owi serve, with OWI_WRITE_TOKEN. The
// reading token (OWI_API_TOKEN) cannot write and is never sent here. As in owi.ts, reasons
// name the kind of failure only: the token, the URL and owi's response body must never reach
// a log, so none of them is ever put into a reason.

const TIMEOUT_MS = 10_000;
/** UTC+14: no later calendar day has begun anywhere, so owi's own today is never past it. */
const EARLIEST_ZONE = "Pacific/Kiritimati";
const MAX_FIELD_ERRORS = 12;
const MAX_MESSAGE_CHARS = 80;

export type SaveOutcome =
  | { kind: "saved"; entry: Entry }
  | { kind: "invalid"; fields: FieldErrors }
  | { kind: "unavailable"; reason: string };

/** Explicit local synthetic mode; saves for its fixture identity are echoed, never stored. */
function isDemo(): boolean {
  return !process.env.OWI_API_URL && process.env.NODE_ENV !== "production" && process.env.OWI_LOCAL_DEMO === "1";
}

function isoNow(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/**
 * Days the web lets through to owi. owi checks the exact span (its first stored day to its
 * today); the web only refuses days that cannot have begun yet. Demo mode knows its span.
 */
export function entryDayBounds(now: Date = new Date()): DayBounds {
  if (isDemo()) {
    const today = todayIn(DEMO_TIME_ZONE, now);
    return { first: addDays(today, -(DEMO_DAYS - 1)), last: today };
  }
  return { first: null, last: todayIn(EARLIEST_ZONE, now) };
}

/** owi's 200 body as an Entry with the known keys only, or null when it is not one. */
function toEntry(body: unknown, day: string): Entry | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.day !== day) return null;
  const savedAt = record.saved_at;
  if (savedAt !== null && savedAt !== undefined && typeof savedAt !== "string") return null;
  const entry: Entry = { day, ...emptyValues(), saved_at: savedAt ?? null };
  for (const spec of ENTRY_FIELDS) {
    const value = record[spec.key];
    if (value === null || value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    entry[spec.key] = value;
  }
  return entry;
}

/** owi's 400 field messages: strings only, a bounded number of short ones. */
function toFields(body: unknown): FieldErrors {
  const raw = typeof body === "object" && body !== null ? (body as { fields?: unknown }).fields : null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((pair): pair is [string, string] => typeof pair[1] === "string" && /^[a-z_]{1,40}$/.test(pair[0]))
      .slice(0, MAX_FIELD_ERRORS)
      .map(([key, message]) => [key, message.slice(0, MAX_MESSAGE_CHARS)]),
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Saves already checked values for `day`. All values null deletes the day's entry in owi. */
export async function saveEntry(accountId: string, day: string, values: EntryValues, now: Date = new Date()): Promise<SaveOutcome> {
  const baseUrl = process.env.OWI_API_URL;
  const token = process.env.OWI_WRITE_TOKEN;

  if (!accountId || !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) return { kind: "unavailable", reason: "account is required" };
  if (isDemo() && accountId === "local-demo") {
    // Nothing is stored: the page can be tried, and the next load shows the demo data again.
    const entry: Entry = { day, ...values, saved_at: null };
    return { kind: "saved", entry: hasEntry(entry) ? { ...entry, saved_at: isoNow(now) } : entry };
  }
  if (!baseUrl || !token) return { kind: "unavailable", reason: "OWI_API_URL or OWI_WRITE_TOKEN is not set" };

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/entries/${encodeURIComponent(day)}?account=${encodeURIComponent(accountId)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(values),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { kind: "unavailable", reason: timedOut ? "request timed out" : "request failed" };
  }

  if (response.status === 200) {
    const entry = toEntry(await readJson(response), day);
    return entry ? { kind: "saved", entry } : { kind: "unavailable", reason: "response is not an entry" };
  }
  if (response.status === 400) {
    return { kind: "invalid", fields: toFields(await readJson(response)) };
  }
  return { kind: "unavailable", reason: `upstream answered ${response.status}` };
}
