import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetUnavailableError, loadDataset } from "./owi";
import type { Dataset } from "./types";

// Invented endpoint and token; .test is a reserved top-level domain that never resolves.
const API_URL = "https://owi.example.test/owi";
const TOKEN = "unit-test-token-0123456789-abcdefghijkl";

const BODY: Dataset = {
  timezone: "Europe/Bratislava",
  first_day: "2026-10-01",
  last_day: "2026-10-01",
  synced_at: "2026-10-01T10:00:00+00:00",
  days: [],
};

const fetchMock = vi.fn<typeof fetch>();

function configure(values: { url?: string; token?: string; production?: boolean }) {
  vi.stubEnv("OWI_API_URL", values.url ?? "");
  vi.stubEnv("OWI_API_TOKEN", values.token ?? "");
  vi.stubEnv("NODE_ENV", values.production ? "production" : "development");
}

async function failure(): Promise<DatasetUnavailableError> {
  const error = await loadDataset().then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(DatasetUnavailableError);
  return error as DatasetUnavailableError;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadDataset with a configured source", () => {
  it("asks the API with the bearer token, without a cache and with a timeout", async () => {
    configure({ url: API_URL, token: TOKEN, production: true });
    fetchMock.mockResolvedValue(Response.json(BODY));

    expect(await loadDataset()).toEqual(BODY);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://owi.example.test/owi/v1/days");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init?.cache).toBe("no-store");
    expect((init as { next?: unknown }).next).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("strips a trailing slash from the base URL", async () => {
    configure({ url: `${API_URL}/`, token: TOKEN });
    fetchMock.mockResolvedValue(Response.json(BODY));
    await loadDataset();
    expect(fetchMock.mock.calls[0][0]).toBe("https://owi.example.test/owi/v1/days");
  });

  it("uses the API, not demo data, in development once a URL is set", async () => {
    configure({ url: API_URL, token: TOKEN });
    fetchMock.mockResolvedValue(Response.json(BODY));
    expect(await loadDataset()).toEqual(BODY);
  });

  it.each([401, 404, 500, 503, 204])("is unavailable on status %i", async (status) => {
    configure({ url: API_URL, token: TOKEN, production: true });
    const body = status === 204 ? null : JSON.stringify({ error: "nope" });
    fetchMock.mockResolvedValue(new Response(body, { status }));
    expect((await failure()).message).toContain(String(status));
  });

  it("is unavailable on a network error", async () => {
    configure({ url: API_URL, token: TOKEN, production: true });
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${API_URL} with ${TOKEN}`));
    expect((await failure()).message).toBe("request failed");
  });

  it("is unavailable on a timeout", async () => {
    configure({ url: API_URL, token: TOKEN, production: true });
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    expect((await failure()).message).toBe("request timed out");
  });

  it("is unavailable when the body is not JSON", async () => {
    configure({ url: API_URL, token: TOKEN, production: true });
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    await failure();
  });

  it.each([
    ["an object without days", { timezone: "Europe/Bratislava" }],
    ["days that is not an array", { days: { "2026-10-01": {} } }],
    ["an array", [1, 2, 3]],
    ["null", null],
    ["a string", "ok"],
  ])("is unavailable when the body is %s", async (_label, body) => {
    configure({ url: API_URL, token: TOKEN, production: true });
    fetchMock.mockResolvedValue(Response.json(body));
    await failure();
  });

  it("never puts the token, the URL or the response body into the error", async () => {
    configure({ url: API_URL, token: TOKEN, production: true });
    const outcomes = [
      () => fetchMock.mockResolvedValue(new Response("secret-body-marker", { status: 500 })),
      () => fetchMock.mockResolvedValue(new Response("secret-body-marker", { status: 200 })),
      () => fetchMock.mockResolvedValue(Response.json({ marker: "secret-body-marker" })),
      () => fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${API_URL} with ${TOKEN}`)),
    ];
    for (const arrange of outcomes) {
      arrange();
      const text = String((await failure()).message);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("example.test");
      expect(text).not.toContain("secret-body-marker");
    }
  });
});

describe("loadDataset without a configured source", () => {
  it("serves demo data in development, synced seven minutes ago", async () => {
    configure({});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T22:30:00Z"));

    const dataset = await loadDataset();
    expect(fetchMock).not.toHaveBeenCalled();
    // 22:30 UTC is already 14 October in Bratislava.
    expect(dataset.last_day).toBe("2026-10-14");
    expect(dataset.synced_at).toBe("2026-10-13T22:23:00+00:00");
    expect(dataset.timezone).toBe("Europe/Bratislava");
    expect(dataset.days).toHaveLength(116);
    expect(dataset.days[dataset.days.length - 1].complete).toBe(false);
  });

  it("serves demo data even when only the token is set", async () => {
    configure({ token: TOKEN });
    expect((await loadDataset()).days.length).toBeGreaterThan(100);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never serves demo data in production", async () => {
    configure({ production: true });
    await failure();
    configure({ token: TOKEN, production: true });
    await failure();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unavailable when the URL is set but the token is not", async () => {
    configure({ url: API_URL, production: true });
    await failure();
    configure({ url: API_URL });
    await failure();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
