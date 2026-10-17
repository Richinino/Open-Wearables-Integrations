import { describe, expect, it } from "vitest";

import { DETAIL_NAV, isActive, ROUTES } from "./nav";

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

  it("lists the entry page among the details, with a link that opens one day", () => {
    expect(DETAIL_NAV.at(-1)).toEqual({ href: "/zapis", label: "Zápis", note: "doplň čísla zo Samsungu" });
    expect(isActive("/zapis", ROUTES.entries)).toBe(true);
    expect(isActive("/zapis", ROUTES.calendar)).toBe(false);
    expect(ROUTES.entryFor("2026-10-14")).toBe("/zapis?den=2026-10-14");
  });

  it("matches a route and its subpaths but not a longer name", () => {
    expect(isActive("/spanok", ROUTES.sleep)).toBe(true);
    expect(isActive("/spanok/x", ROUTES.sleep)).toBe(true);
    expect(isActive("/spanokx", ROUTES.sleep)).toBe(false);
  });
});
