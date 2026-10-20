"use client";

// One day on /zapis: a header that opens and closes it, the seven fields with owi's own
// figure beside each, and "Uložiť deň". Fields Samsung already sent by itself for the day
// (steps, active calories, Sleep Score) show its number, read-only, and are not saved. The
// fields keep what was typed while the card is closed, so switching between days loses
// nothing.

import { useId, useRef, useState, type FormEvent } from "react";
import { putEntry } from "@/lib/entry-client";
import { ENTRY_FIELDS, hasEntry, inputText, isEmpty, emptyValues, parseInput, type FieldErrors } from "@/lib/entries";
import { formatDayLong, formatInt } from "@/lib/format";
import { autoValue, formatFieldValue, owiFigureText, withoutAutoFields } from "@/lib/samsung";
import type { Day, Entry, EntryField } from "@/lib/types";
import { useAccount } from "@/lib/account-context";

const AUTO_NOTE = "automaticky zo Samsungu";

type Texts = Record<EntryField, string>;

function textsFrom(entry: Entry | null): Texts {
  return Object.fromEntries(ENTRY_FIELDS.map((spec) => [spec.key, inputText(entry?.[spec.key], spec)])) as Texts;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Štvrtok 15. októbra": the year only when it is not the current one. */
function dayTitle(day: string, today: string): string {
  const long = formatDayLong(day);
  return capitalize(day.slice(0, 4) === today.slice(0, 4) ? long.replace(/\s\d{4}$/, "") : long);
}

function summary(entry: Entry | null, data: Day | null): string {
  if (hasEntry(entry)) {
    const parts = [
      entry.steps === null ? null : `${formatInt(entry.steps)} krokov`,
      entry.distance_km === null ? null : formatFieldValue("distance_km", entry.distance_km),
      entry.steps === null && entry.total_kcal !== null ? `${formatInt(entry.total_kcal)} kcal spolu` : null,
      entry.steps === null && entry.active_minutes !== null ? `${formatInt(entry.active_minutes)} min aktívne` : null,
      entry.sleep_score === null ? null : `Sleep ${formatInt(entry.sleep_score)}`,
      entry.energy_score === null ? null : `Energy ${formatInt(entry.energy_score)}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "zápis";
  }
  if (!data) return "owi za tento deň nemá dáta";
  const steps = autoValue(data, "steps");
  const sleep = autoValue(data, "sleep_score");
  if (steps !== null || sleep !== null) {
    const sent = [steps === null ? null : `${formatInt(steps)} krokov`, sleep === null ? null : `Sleep ${formatInt(sleep)}`].filter(Boolean);
    return `automaticky: ${sent.join(" · ")}`;
  }
  const parts = [
    data.steps === null ? null : `${owiFigureText(data, "steps")} krokov`,
    data.distance_m_est === null ? null : owiFigureText(data, "distance_km"),
  ].filter(Boolean);
  return parts.length > 0 ? `owi: ${parts.join(" · ")}` : "owi bez krokov";
}

export type CardStatus = "missing" | "saved" | "deleted";

const STATUS: Record<CardStatus, { text: string; className: string }> = {
  missing: { text: "bez zápisu", className: "border-dashed border-line-strong text-ink2" },
  saved: { text: "uložené ✓", className: "border-[color-mix(in_oklab,var(--good)_55%,transparent)] text-good-ink" },
  deleted: { text: "zmazané", className: "border-line text-ink2" },
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }}>
      <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EntryCard({
  day,
  today,
  data,
  entry,
  status,
  open,
  onToggle,
  onSaved,
}: {
  day: string;
  today: string;
  /** owi's day, for the figures beside the fields; null when owi has no data for it. */
  data: Day | null;
  entry: Entry | null;
  status: CardStatus;
  open: boolean;
  onToggle: () => void;
  onSaved: (entry: Entry) => void;
}) {
  const account = useAccount();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [texts, setTexts] = useState<Texts>(() => textsFrom(entry));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const had = hasEntry(entry);
  const panelId = `${id}-panel`;
  const autoCount = ENTRY_FIELDS.filter((spec) => autoValue(data, spec.key) !== null).length;

  function focusField(key: string) {
    form.current?.querySelector<HTMLInputElement>(`[name="${key}"]`)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !account || account.viewOnly) return;
    const typed = emptyValues();
    const problems: FieldErrors = {};
    for (const spec of ENTRY_FIELDS) {
      // Samsung's own number stands in for the field; whatever an older entry held is not sent.
      if (autoValue(data, spec.key) !== null) continue;
      const parsed = parseInput(texts[spec.key], spec);
      if (parsed.ok) typed[spec.key] = parsed.value;
      else problems[spec.key] = parsed.message;
    }
    const values = withoutAutoFields(typed, data);
    const firstProblem = ENTRY_FIELDS.find((spec) => problems[spec.key]);
    if (firstProblem) {
      setErrors(problems);
      setMessage(null);
      focusField(firstProblem.key);
      return;
    }
    if (isEmpty(values) && !had) {
      setErrors({});
      setMessage(autoCount > 0 ? "Vyplň aspoň jedno z ostatných čísel." : "Vyplň aspoň jedno číslo.");
      return;
    }

    setSaving(true);
    setErrors({});
    setMessage(null);
    const result = await putEntry(day, values, { actorId: account.account.id, dataAccountId: account.dataAccount.id, viewOnly: account.viewOnly });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fields);
      setMessage(result.message);
      const field = ENTRY_FIELDS.find((spec) => result.fields[spec.key]);
      if (field) focusField(field.key);
      return;
    }
    setTexts(textsFrom(result.entry));
    onSaved(result.entry);
  }

  return (
    <article id={`den-${day}`} className="glass min-w-0 scroll-mt-6" style={{ borderRadius: 22 }}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-[64px] w-full cursor-pointer items-center justify-between gap-3 rounded-[22px] px-5 py-3.5 text-left transition-colors hover:bg-sunk"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[16px] font-semibold tracking-[-0.01em]">{dayTitle(day, today)}</span>
            <span className="truncate text-[12px] text-muted">{summary(entry, data)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2.5 text-ink2">
            <span className={`mono rounded-full border px-2.5 py-[3px] text-[11px] tracking-[0.04em] whitespace-nowrap ${STATUS[status].className}`}>
              {STATUS[status].text}
            </span>
            <Chevron open={open} />
          </span>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="border-t border-line px-5 pt-4 pb-5">
        <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {ENTRY_FIELDS.map((spec) => {
              const inputId = `${id}-${spec.key}`;
              const error = errors[spec.key];
              const sent = autoValue(data, spec.key);
              if (sent !== null) {
                return (
                  <div key={spec.key} className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor={inputId} className="text-[13px] text-ink2">
                      {spec.label}
                      {spec.unit && <span className="text-muted"> · {spec.unit}</span>}
                    </label>
                    <input
                      id={inputId}
                      name={spec.key}
                      type="text"
                      readOnly
                      value={inputText(sent, spec)}
                      aria-describedby={`${inputId}-auto`}
                      className="tabular h-11 w-full min-w-0 cursor-default rounded-[14px] border border-dashed border-line-strong bg-sunk px-3 text-[17px] text-ink2 outline-none"
                    />
                    <span id={`${inputId}-auto`} className="text-[12px] text-muted">
                      <span className="block font-semibold text-ink2">{AUTO_NOTE}</span>
                      {data && <span className="block">owi {owiFigureText(data, spec.key)}</span>}
                    </span>
                  </div>
                );
              }
              return (
                <div key={spec.key} className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={inputId} className="text-[13px] text-ink2">
                    {spec.label}
                    {spec.unit && <span className="text-muted"> · {spec.unit}</span>}
                  </label>
                  <input
                    id={inputId}
                    name={spec.key}
                    type="text"
                    inputMode={spec.inputMode}
                    autoComplete="off"
                    enterKeyHint="next"
                    spellCheck={false}
                    value={texts[spec.key]}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTexts((current) => ({ ...current, [spec.key]: value }));
                    }}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`${inputId}-owi${error ? ` ${inputId}-error` : ""}`}
                    className="tabular h-11 w-full min-w-0 rounded-[14px] border border-line-strong bg-glass px-3 text-[17px] outline-none transition-colors placeholder:text-muted focus:border-ink focus:ring-1 focus:ring-ink aria-[invalid=true]:border-bad"
                  />
                  <span id={`${inputId}-owi`} className="text-[12px] text-muted">
                    owi {data ? owiFigureText(data, spec.key) : "–"}
                    {spec.key === "sleep_score" && " · noc do rána"}
                  </span>
                  {error && (
                    <span id={`${inputId}-error`} className="text-[12px] font-semibold text-bad">
                      {error}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={saving}
              className="h-11 rounded-[22px] bg-ink px-6 text-[14px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Ukladám…" : "Uložiť deň"}
            </button>
            <p className="text-[12px] text-muted">
              {had ? "Keď vymažeš všetky polia, uložením zápis zmažeš." : "Vyplň, čo máš; prázdne pole sa nezapíše."}
              {autoCount > 0 && " Čísla zo Samsungu sa doplnili samy."}
            </p>
          </div>
          {message && (
            <p role="alert" className="text-[13px] font-medium text-bad">
              {message}
            </p>
          )}
        </form>
      </div>
    </article>
  );
}
