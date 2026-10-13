// The two server entry points built on the modules in this folder: the login actions and the
// data route. Their collaborators are replaced, so only their own decisions are tested here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/data/route";
import { login, logout } from "@/app/login/actions";

import { DatasetUnavailableError } from "./owi";
import type { Dataset } from "./types";

const mocks = vi.hoisted(() => ({
  checkPassword: vi.fn<(submitted: string) => Promise<boolean>>(),
  startSession: vi.fn<() => Promise<void>>(),
  endSession: vi.fn<() => Promise<void>>(),
  hasValidSession: vi.fn<() => Promise<boolean>>(),
  loadDataset: vi.fn<() => Promise<Dataset>>(),
}));

vi.mock("./auth", () => ({
  checkPassword: mocks.checkPassword,
  startSession: mocks.startSession,
  endSession: mocks.endSession,
  hasValidSession: mocks.hasValidSession,
}));

vi.mock("./owi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./owi")>()),
  loadDataset: mocks.loadDataset,
}));

// The real redirect() also works by throwing; this one just makes the target easy to read.
class Redirected extends Error {
  constructor(readonly target: string) {
    super(`redirect to ${target}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Redirected(target);
  },
}));

const DATASET: Dataset = {
  timezone: "Europe/Bratislava",
  first_day: null,
  last_day: null,
  synced_at: null,
  days: [],
};

function form(password?: string | File): FormData {
  const data = new FormData();
  if (password !== undefined) data.set("password", password);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.startSession.mockResolvedValue();
  mocks.endSession.mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("login", () => {
  /** Runs the action and reports whether it had settled before the delay was over. */
  async function attempt(data: FormData) {
    let settled = false;
    const outcome = login({ error: null }, data).then(
      (state) => ({ state, redirected: null as string | null }),
      (error: unknown) => {
        if (!(error instanceof Redirected)) throw error;
        return { state: null, redirected: error.target };
      },
    );
    void outcome.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(790);
    const settledEarly = settled;
    await vi.advanceTimersByTimeAsync(20);
    return { ...(await outcome), settledEarly };
  }

  it("starts a session and redirects home for the right password", async () => {
    mocks.checkPassword.mockResolvedValue(true);
    const result = await attempt(form("correct"));
    expect(mocks.checkPassword).toHaveBeenCalledWith("correct");
    expect(mocks.startSession).toHaveBeenCalledTimes(1);
    expect(result.redirected).toBe("/");
    expect(result.settledEarly).toBe(true);
  });

  it("waits about 800 ms, then reports a wrong password", async () => {
    mocks.checkPassword.mockResolvedValue(false);
    const result = await attempt(form("wrong"));
    expect(result.state).toEqual({ error: "Nesprávne heslo" });
    expect(result.settledEarly).toBe(false);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("gives the same answer, after the same wait, for a missing or unusable field", async () => {
    for (const data of [form(), form(""), form(new File(["x"], "password.txt"))]) {
      const result = await attempt(data);
      expect(result.state).toEqual({ error: "Nesprávne heslo" });
      expect(result.settledEarly).toBe(false);
    }
    expect(mocks.checkPassword).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("ends the session, then redirects to the login page", async () => {
    await expect(logout()).rejects.toMatchObject({ target: "/login" });
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/data", () => {
  it("answers 401 without a session and does not touch the data", async () => {
    mocks.hasValidSession.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.loadDataset).not.toHaveBeenCalled();
  });

  it("returns the dataset, never cacheable", async () => {
    mocks.hasValidSession.mockResolvedValue(true);
    mocks.loadDataset.mockResolvedValue(DATASET);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DATASET);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 503 when the dataset is unavailable and logs only the reason", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.hasValidSession.mockResolvedValue(true);
    mocks.loadDataset.mockRejectedValue(new DatasetUnavailableError("upstream answered 502"));

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual(["api/data: dataset unavailable (upstream answered 502)"]);
  });

  it("does not disguise an unexpected error as 'unavailable'", async () => {
    mocks.hasValidSession.mockResolvedValue(true);
    mocks.loadDataset.mockRejectedValue(new TypeError("a bug"));
    await expect(GET()).rejects.toThrow("a bug");
  });
});
