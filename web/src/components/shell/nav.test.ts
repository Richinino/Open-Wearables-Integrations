import { describe, expect, it } from "vitest";

import { isActive, ROUTES } from "./nav";

describe("isActive", () => {
  it("marks the overview only on the home page", () => {
    expect(isActive("/", ROUTES.overview)).toBe(true);
    expect(isActive("/spanok", ROUTES.overview)).toBe(false);
    expect(isActive(ROUTES.day("2026-10-14"), ROUTES.overview)).toBe(false);
  });

  it("marks the calendar on day pages", () => {
    expect(isActive(ROUTES.calendar, ROUTES.calendar)).toBe(true);
    expect(isActive(ROUTES.day("2026-10-14"), ROUTES.calendar)).toBe(true);
    expect(isActive("/spanok", ROUTES.calendar)).toBe(false);
  });

  it("matches a route and its subpaths but not a longer name", () => {
    expect(isActive("/spanok", ROUTES.sleep)).toBe(true);
    expect(isActive("/spanok/x", ROUTES.sleep)).toBe(true);
    expect(isActive("/spanokx", ROUTES.sleep)).toBe(false);
  });
});
