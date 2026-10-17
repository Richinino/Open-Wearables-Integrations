// The browser's side of a save: PUT /api/entries/{day} and what its answer means for the
// form. Field messages go under their fields; everything else becomes one sentence.

import { ENTRY_FIELDS, type FieldErrors } from "./entries";
import type { Entry, EntryValues } from "./types";

export type SaveResponse = { ok: true; entry: Entry } | { ok: false; fields: FieldErrors; message: string | null };

const FIELD_KEYS = new Set<string>(ENTRY_FIELDS.map((spec) => spec.key));

export const SAVE_MESSAGES = {
  network: "Spojenie zlyhalo. Skús to znova.",
  unavailable: "owi je teraz nedostupné. Skús to o chvíľu.",
  forbidden: "Zápis neprešiel kontrolou. Obnov stránku a skús znova.",
  invalid: "owi tieto čísla neprijalo.",
} as const;

function isEntry(body: unknown, day: string): body is Entry {
  return typeof body === "object" && body !== null && (body as { day?: unknown }).day === day;
}

/** Splits owi's 400 messages into those for the seven fields and one sentence for the rest. */
export function splitFieldErrors(raw: unknown): { fields: FieldErrors; message: string | null } {
  const fields: FieldErrors = {};
  const rest: string[] = [];
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      if (FIELD_KEYS.has(key)) fields[key] = value;
      else rest.push(key === "day" ? `Deň: ${value}.` : SAVE_MESSAGES.invalid);
    }
  }
  const message = [...new Set(rest)].join(" ") || (Object.keys(fields).length === 0 ? SAVE_MESSAGES.invalid : null);
  return { fields, message };
}

export async function putEntry(day: string, values: EntryValues): Promise<SaveResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/entries/${encodeURIComponent(day)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(values),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, fields: {}, message: SAVE_MESSAGES.network };
  }

  if (response.status === 401) {
    // The session is gone; a full page load takes the client state with it, as in use-dataset.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    return new Promise<SaveResponse>(() => {});
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status === 200 && isEntry(body, day)) return { ok: true, entry: body };
  if (response.status === 400) return { ok: false, ...splitFieldErrors((body as { fields?: unknown } | null)?.fields) };
  if (response.status === 403) return { ok: false, fields: {}, message: SAVE_MESSAGES.forbidden };
  return { ok: false, fields: {}, message: SAVE_MESSAGES.unavailable };
}
