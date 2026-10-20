// PUT /api/entries/[date]: the session and origin checks, owi's ranges, the hand-over to owi
// with the write token, owi's errors, and the echo of demo mode. The session is replaced;
// owi is a stubbed fetch. Every address and token here is invented.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUT } from "@/app/api/entries/[date]/route";

const mocks = vi.hoisted(() => ({ currentSession: vi.fn() }));

vi.mock("./auth", () => ({ currentSession: mocks.currentSession }));

// .test is a reserved top-level domain that never resolves.
const API_URL = "https://owi.example.test/owi";
const WRITE_TOKEN = "unit-test-write-token-0123456789-abcdefghij";
const READ_TOKEN = "unit-test-read-token-0123456789-abcdefghijk";
const SITE = "zdravie.example.test";
const DAY = "2026-10-15";
const NOW = new Date("2026-10-16T10:00:00Z");

const VALUES = {
  steps: 23588,
  distance_km: 17.9,
  active_minutes: 210,
  active_kcal: 980,
  total_kcal: 2610,
  sleep_score: 82,
  energy_score: 76,
};
const SAVED = { day: DAY, ...VALUES, saved_at: "2026-10-16T10:00:00+00:00" };

const fetchMock = vi.fn<typeof fetch>();

function configure(values: { url?: string; token?: string; production?: boolean }) {
  vi.stubEnv("OWI_API_URL", values.url ?? "");
  vi.stubEnv("OWI_WRITE_TOKEN", values.token ?? "");
  vi.stubEnv("OWI_API_TOKEN", READ_TOKEN);
  vi.stubEnv("NODE_ENV", values.production ? "production" : "development");
}

function put(
  options: { day?: string; body?: unknown; raw?: string; origin?: string | null; host?: string; forwardedHost?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json", host: options.host ?? SITE });
  const origin = options.origin === undefined ? `https://${SITE}` : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.forwardedHost) headers.set("x-forwarded-host", options.forwardedHost);
  const day = options.day ?? DAY;
  const request = new Request(`https://${SITE}/api/entries/${day}`, {
    method: "PUT",
    headers,
    body: options.raw ?? JSON.stringify(options.body === undefined ? VALUES : options.body),
  });
  return PUT(request, { params: Promise.resolve({ date: day }) });
}

async function expectJson(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(body);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.currentSession.mockReset();
  mocks.currentSession.mockResolvedValue({ account: { id: "account-a", status: "active", paired: true, has_samsung: true }, claims: { a: "account-a", x: null } });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  configure({ url: API_URL, token: WRITE_TOKEN, production: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PUT /api/entries/[date] before owi", () => {
  it("denies view mode, pending accounts and accounts without Samsung", async () => {
    for (const [account, claims, code] of [
      [{ status: "active", paired: true, has_samsung: true }, { x: "account-b" }, "read_only"],
      [{ status: "pending", paired: false, has_samsung: true }, { x: null }, "pending"],
      [{ status: "active", paired: true, has_samsung: false }, { x: null }, "unsupported_source"],
    ] as const) {
      mocks.currentSession.mockResolvedValue({ account: { id: "account-a", ...account }, claims });
      await expectJson(await put(), 403, { error: code });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 401 without a session and touches nothing", async () => {
    mocks.currentSession.mockResolvedValue(null);
    await expectJson(await put(), 401, { error: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 403 to a request from another site or without an origin", async () => {
    for (const origin of [null, "https://evil.example.test", "null", "not a url", `https://${SITE}.evil.example.test`]) {
      await expectJson(await put({ origin }), 403, { error: "forbidden" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts its own origin, by Host or by the proxy's forwarded host, on any port and case", async () => {
    fetchMock.mockImplementation(async () => Response.json(SAVED));
    expect((await put({ origin: `https://${SITE.toUpperCase()}` })).status).toBe(200);
    expect((await put({ host: "internal.example.test", forwardedHost: SITE })).status).toBe(200);
    expect((await put({ origin: "http://localhost:3101", host: "localhost:3101" })).status).toBe(200);
    await expectJson(await put({ origin: "http://localhost:3102", host: "localhost:3101" }), 403, { error: "forbidden" });
  });

  it("checks the session before the origin", async () => {
    mocks.currentSession.mockResolvedValue(null);
    await expectJson(await put({ origin: null }), 401, { error: "unauthorized" });
  });

  it("refuses values outside owi's ranges with one message per field", async () => {
    const response = await put({ body: { ...VALUES, steps: 100_001, sleep_score: 101, distance_km: "17,9" } });
    await expectJson(response, 400, {
      error: "invalid",
      fields: { steps: "0–100 000", distance_km: "číslo", sleep_score: "0–100" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a day that is not one or has not begun anywhere yet", async () => {
    await expectJson(await put({ day: "2026-02-30" }), 400, { error: "invalid", fields: { day: "neplatný dátum" } });
    await expectJson(await put({ day: "2026-10-18" }), 400, { error: "invalid", fields: { day: "mimo rozsahu" } });
    // 10:00 UTC is already the 17th at UTC+14, so owi decides about that day itself.
    fetchMock.mockResolvedValue(Response.json({ ...SAVED, day: "2026-10-17" }));
    expect((await put({ day: "2026-10-17" })).status).toBe(200);
  });

  it("reports the day and the fields together", async () => {
    await expectJson(await put({ day: "nope", body: { steps: -1 } }), 400, {
      error: "invalid",
      fields: { day: "neplatný dátum", steps: "0–100 000" },
    });
  });

  it("refuses a body that is not a JSON object, or too long to be a form", async () => {
    for (const raw of ["", "not json", "[1,2]", "null", JSON.stringify({ steps: 1, pad: "x".repeat(3000) })]) {
      await expectJson(await put({ raw }), 400, { error: "invalid", fields: { body: "neplatné údaje" } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/entries/[date] with owi", () => {
  it("sends only the seven fields with the write token, uncached and with a timeout", async () => {
    fetchMock.mockResolvedValue(Response.json(SAVED));
    const response = await put({ body: { steps: 9000, extra: "dropped", day: "2020-01-01" } });
    await expectJson(response, 200, { ...SAVED });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://owi.example.test/owi/v1/entries/${DAY}?account=account-a`);
    expect(init?.method).toBe("PUT");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WRITE_TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      steps: 9000,
      distance_km: null,
      active_minutes: null,
      active_kcal: null,
      total_kcal: null,
      sleep_score: null,
      energy_score: null,
    });
  });

  it("never sends the reading token", async () => {
    fetchMock.mockResolvedValue(Response.json(SAVED));
    await put();
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain(READ_TOKEN);
  });

  it("strips a trailing slash from the base URL", async () => {
    configure({ url: `${API_URL}/`, token: WRITE_TOKEN, production: true });
    fetchMock.mockResolvedValue(Response.json(SAVED));
    await put();
    expect(fetchMock.mock.calls[0][0]).toBe(`https://owi.example.test/owi/v1/entries/${DAY}?account=account-a`);
  });

  it("returns owi's entry with the known keys only, also a deletion", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...SAVED, internal: "x" }));
    await expectJson(await put(), 200, SAVED);

    const deleted = { day: DAY, steps: null, distance_km: null, active_minutes: null, active_kcal: null, total_kcal: null, sleep_score: null, energy_score: null, saved_at: null };
    fetchMock.mockResolvedValue(Response.json(deleted));
    await expectJson(await put({ body: {} }), 200, deleted);
  });

  it("passes owi's field messages through on 400", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "invalid", fields: { day: "mimo rozsahu", sleep_score: "0–100", "bad key": "x", steps: 5 } }, { status: 400 }),
    );
    await expectJson(await put(), 400, { error: "invalid", fields: { day: "mimo rozsahu", sleep_score: "0–100" } });

    fetchMock.mockResolvedValue(new Response("<html>bad</html>", { status: 400 }));
    await expectJson(await put(), 400, { error: "invalid", fields: {} });
  });

  it.each([401, 403, 404, 500, 502, 503])("answers 503 'unavailable' when owi answers %i", async (status) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(Response.json({ error: "x" }, { status }));
    await expectJson(await put(), 503, { error: "unavailable" });
    expect(log.mock.calls).toEqual([[`api/entries: owi unavailable (upstream answered ${status})`]]);
  });

  it("answers 503 on a network error, a timeout and an answer that is not an entry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${API_URL} with ${WRITE_TOKEN}`));
    await expectJson(await put(), 503, { error: "unavailable" });
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    await expectJson(await put(), 503, { error: "unavailable" });
    fetchMock.mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    await expectJson(await put(), 503, { error: "unavailable" });
    fetchMock.mockResolvedValueOnce(Response.json({ ...SAVED, day: "2026-10-14" }));
    await expectJson(await put(), 503, { error: "unavailable" });
    fetchMock.mockResolvedValueOnce(Response.json({ ...SAVED, steps: "many" }));
    await expectJson(await put(), 503, { error: "unavailable" });
    expect(log.mock.calls.map((call) => call[0])).toEqual([
      "api/entries: owi unavailable (request failed)",
      "api/entries: owi unavailable (request timed out)",
      "api/entries: owi unavailable (response is not an entry)",
      "api/entries: owi unavailable (response is not an entry)",
      "api/entries: owi unavailable (response is not an entry)",
    ]);
  });

  it("never logs the token, the address or owi's answer", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const outcomes = [
      () => fetchMock.mockResolvedValue(new Response("secret-body-marker", { status: 500 })),
      () => fetchMock.mockResolvedValue(new Response("secret-body-marker", { status: 200 })),
      () => fetchMock.mockResolvedValue(Response.json({ marker: "secret-body-marker" })),
      () => fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${API_URL} with ${WRITE_TOKEN}`)),
    ];
    for (const arrange of outcomes) {
      arrange();
      const response = await put();
      const text = await response.text();
      for (const secret of [WRITE_TOKEN, "example.test/owi", "secret-body-marker"]) expect(text).not.toContain(secret);
    }
    const logged = JSON.stringify([log.mock.calls, warn.mock.calls, info.mock.calls]);
    for (const secret of [WRITE_TOKEN, READ_TOKEN, "owi.example.test", "secret-body-marker"]) expect(logged).not.toContain(secret);
  });

  it("answers 503 without the write token, in production and outside it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configure({ url: API_URL, production: true });
    await expectJson(await put(), 503, { error: "unavailable" });
    configure({ url: API_URL });
    await expectJson(await put(), 503, { error: "unavailable" });
    configure({ token: WRITE_TOKEN, production: true });
    await expectJson(await put(), 503, { error: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/entries/[date] in demo mode", () => {
  beforeEach(() => { vi.stubEnv("OWI_LOCAL_DEMO", "1"); mocks.currentSession.mockResolvedValue({ account: { id: "local-demo", status: "active", paired: true, has_samsung: true }, claims: { a: "local-demo", x: null } }); });
  beforeEach(() => configure({}));

  it("echoes a valid entry back as saved, without calling anything", async () => {
    await expectJson(await put(), 200, { day: DAY, ...VALUES, saved_at: "2026-10-16T10:00:00+00:00" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("echoes an empty save as a deletion", async () => {
    const body = await (await put({ body: {} })).json();
    expect(body).toMatchObject({ day: DAY, steps: null, sleep_score: null, saved_at: null });
  });

  it("still checks ranges and the demo's span of days", async () => {
    await expectJson(await put({ body: { sleep_score: 120 } }), 400, { error: "invalid", fields: { sleep_score: "0–100" } });
    // The demo covers 120 days up to today in Bratislava.
    await expectJson(await put({ day: "2026-10-17" }), 400, { error: "invalid", fields: { day: "mimo rozsahu" } });
    await expectJson(await put({ day: "2026-06-18" }), 400, { error: "invalid", fields: { day: "mimo rozsahu" } });
    expect((await put({ day: "2026-06-19" })).status).toBe(200);
    expect((await put({ day: "2026-10-16" })).status).toBe(200);
  });

  it("still wants a session and the same origin", async () => {
    await expectJson(await put({ origin: "https://evil.example.test" }), 403, { error: "forbidden" });
    mocks.currentSession.mockResolvedValue(null);
    await expectJson(await put(), 401, { error: "unauthorized" });
  });
});
