import "server-only";

import { todayIn } from "./dates";
import { demoDataset } from "./demo-data";
import type { Dataset } from "./types";

/** The data source is not configured, not reachable, or answered with something unusable. */
export class DatasetUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DatasetUnavailableError";
  }
}

const DEMO_TIME_ZONE = "Europe/Bratislava";
const DEMO_DAYS = 120;
const DEMO_SYNC_AGE_MS = 7 * 60 * 1000;
const TIMEOUT_MS = 10_000;

function hasDays(body: unknown): body is Dataset {
  return typeof body === "object" && body !== null && Array.isArray((body as { days?: unknown }).days);
}

function demo(): Dataset {
  const now = new Date();
  const syncedAt = new Date(now.getTime() - DEMO_SYNC_AGE_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
  return demoDataset(todayIn(DEMO_TIME_ZONE, now), DEMO_DAYS, syncedAt);
}

// Error messages below name the kind of failure only. The token, the URL and the response
// body must never reach a log, so none of them is ever put into a message.
export async function loadDataset(): Promise<Dataset> {
  const baseUrl = process.env.OWI_API_URL;
  const token = process.env.OWI_API_TOKEN;

  if (!baseUrl && process.env.NODE_ENV !== "production") return demo();
  if (!baseUrl || !token) {
    throw new DatasetUnavailableError("OWI_API_URL or OWI_API_TOKEN is not set");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/days`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Fresh on every request: a cached copy made a reload show the previous data. owi serves
      // the whole history gzipped in well under a second, so there is little to save.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new DatasetUnavailableError(timedOut ? "request timed out" : "request failed");
  }

  if (response.status !== 200) {
    throw new DatasetUnavailableError(`upstream answered ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DatasetUnavailableError("response is not JSON");
  }
  if (!hasDays(body)) throw new DatasetUnavailableError("response has no days array");
  return body;
}
