import { describe, expect, it } from "vitest";
import { confirmation, passwordField, profileInput, settingsInput } from "./account-input";
import { sortAccounts } from "@/components/admin/helpers";
import { visibleDetailNav } from "@/components/shell/nav";

function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
const profile = { first_name: " Jana ", last_name: " ", email: " JANA@example.test ", sex: "female", birth_date: "1990-03-02", training_consent: "on" };

describe("account forms", () => {
  it("maps only permitted profile fields, normalizes email and handles optional fields", () => {
    expect(profileInput(form({ ...profile, id: "victim", role: "admin", ow_user_id: "foreign" }))).toEqual({ first_name: "Jana", last_name: null, email: "jana@example.test", sex: "female", birth_date: "1990-03-02", training_consent: true });
    expect(profileInput(form({ ...profile, sex: "", birth_date: "", training_consent: "" }))).toMatchObject({ sex: null, birth_date: null, training_consent: false });
  });
  it.each(["2026-02-30", "2050-01-01", "not-a-date"])("rejects invalid or future birth dates: %s", (birth_date) => expect(() => profileInput(form({ ...profile, birth_date }))).toThrow("dátum"));
  it("rejects invalid sex, email and files", () => {
    expect(() => profileInput(form({ ...profile, sex: "other" }))).toThrow("pohlavie");
    expect(() => profileInput(form({ ...profile, email: "invalid" }))).toThrow("e-mail");
    const data = form(profile); data.set("first_name", new File(["x"], "name.txt"));
    expect(() => profileInput(data)).toThrow("meno");
  });
  it("accepts settings enums and rejects arbitrary values", () => {
    expect(settingsInput(form({ theme: "system", sleep_score: "apple", overview_mode: "morning" }))).toEqual({ theme: "system", sleep_score: "apple", overview_mode: "morning" });
    expect(() => settingsInput(form({ theme: "sepia", sleep_score: "apple", overview_mode: "auto" }))).toThrow("vzhľad");
  });
  it("does not trim passwords and requires exact destructive confirmation", () => {
    expect(passwordField(form({ password: "  secure phrase  " }), "password")).toBe("  secure phrase  ");
    expect(() => confirmation(form({ confirmation: "zmazať" }), "ZMAZAŤ")).toThrow("ZMAZAŤ");
  });
});

describe("account navigation", () => {
  it("prioritizes pending accounts without mutating the input", () => {
    const items = [{ status: "active" as const, first_name: "Anna", last_name: null }, { status: "pending" as const, first_name: "Zora", last_name: null }];
    expect(sortAccounts(items)[0].first_name).toBe("Zora");
    expect(items[0].first_name).toBe("Anna");
  });
  it("shows Samsung entries only for a Samsung data account with write access", () => {
    expect(visibleDetailNav(true, false).some((item) => item.href === "/zapis")).toBe(true);
    for (const [samsung, viewing] of [[false, false], [false, true], [true, true]]) expect(visibleDetailNav(samsung, viewing).some((item) => item.href === "/zapis")).toBe(false);
  });
});
