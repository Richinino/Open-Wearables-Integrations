import { IDENTITY_HEADER } from "./account-identity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { putEntry, SAVE_MESSAGES, splitFieldErrors } from "./entry-client";
import { emptyValues } from "./entries";
import { makeEntry } from "./test-fixtures";

const IDENTITY = { actorId: "account-a", dataAccountId: "account-a", viewOnly: false };
const HEADERS = { [IDENTITY_HEADER]: JSON.stringify(IDENTITY) };
const DAY = "2026-10-15";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("putEntry", () => {
  it("puts the values to the day's address and returns the saved entry", async () => {
    const entry = makeEntry(DAY, { steps: 9000 });
    fetchMock.mockResolvedValue(Response.json(entry, { headers: HEADERS }));
    const values = { ...emptyValues(), steps: 9000 };
    expect(await putEntry(DAY, values, IDENTITY)).toEqual({ ok: true, entry });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/entries/${DAY}`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual(values);
  });

  it("puts field messages under their fields and the rest into one sentence", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "invalid", fields: { sleep_score: "0–100", day: "mimo rozsahu" } }, { status: 400 }));
    expect(await putEntry(DAY, emptyValues(), IDENTITY)).toEqual({
      ok: false,
      fields: { sleep_score: "0–100" },
      message: "Deň: mimo rozsahu.",
    });
  });

  it("explains the other failures", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    expect(await putEntry(DAY, emptyValues(), IDENTITY)).toEqual({ ok: false, fields: {}, message: SAVE_MESSAGES.unavailable });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
    expect(await putEntry(DAY, emptyValues(), IDENTITY)).toEqual({ ok: false, fields: {}, message: SAVE_MESSAGES.forbidden });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await putEntry(DAY, emptyValues(), IDENTITY)).toEqual({ ok: false, fields: {}, message: SAVE_MESSAGES.network });
    // A 200 that is not this day's entry is not a save.
    fetchMock.mockResolvedValueOnce(Response.json(makeEntry("2026-10-14"), { headers: HEADERS }));
    expect((await putEntry(DAY, emptyValues(), IDENTITY)).ok).toBe(false);
  });
});

describe("splitFieldErrors", () => {
  it("falls back to a general sentence when owi names no field", () => {
    expect(splitFieldErrors({})).toEqual({ fields: {}, message: SAVE_MESSAGES.invalid });
    expect(splitFieldErrors(null)).toEqual({ fields: {}, message: SAVE_MESSAGES.invalid });
    expect(splitFieldErrors({ body: "neplatné údaje", other: "x" })).toEqual({ fields: {}, message: SAVE_MESSAGES.invalid });
    expect(splitFieldErrors({ steps: "celé číslo", odd: 5 })).toEqual({ fields: { steps: "celé číslo" }, message: null });
  });
});
