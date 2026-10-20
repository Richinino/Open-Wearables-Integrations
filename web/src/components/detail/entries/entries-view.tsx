"use client";

// /zapis: how close owi gets to Samsung, the completed days of the last 30 without an entry
// (newest first, one open at a time), the days that already have one, and a jump to any
// older day. A save updates the loaded data, so the overview's count drops at once; on this
// page the day stays where it was, marked "uložené ✓", and the next missing day opens.

import { useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { WithData } from "@/components/shell/shell";
import { addDays, isValidDay, todayIn } from "@/lib/dates";
import { hasEntry } from "@/lib/entries";
import { formatDay, formatInt } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import { ENTRY_WINDOW_DAYS, missingDaysText, missingEntryDays, savedEntryDays, withEntry } from "@/lib/samsung";
import type { Dataset, Entry } from "@/lib/types";
import { useDataset } from "@/lib/use-dataset";
import { useAccount } from "@/lib/account-context";
import { EmptyState } from "@/components/ui/parts";
import { DetailHead, riseStyle, SectionBar } from "../common/bits";
import { EntryCard, type CardStatus } from "./entry-card";
import { QualityTile } from "./quality-tile";

function JumpForm({ first, last, onJump }: { first: string | null; last: string; onJump: (day: string) => void }) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidDay(value)) {
      setProblem("Vyber deň.");
      return;
    }
    if (value > last || (first !== null && value < first)) {
      setProblem(`Deň musí byť ${first ? `od ${formatDay(first)} ` : ""}do ${formatDay(last)}.`);
      return;
    }
    setProblem(null);
    onJump(value);
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="zapis-den" className="text-[13px] text-ink2">
          Iný deň
        </label>
        <input
          id="zapis-den"
          type="date"
          min={first ?? undefined}
          max={last}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "zapis-den-error" : undefined}
          className="tabular h-11 rounded-[14px] border border-line-strong bg-glass px-3 text-[15px] outline-none focus:border-ink focus:ring-1 focus:ring-ink"
        />
        <button type="submit" className="pill pill-outline">
          Otvoriť
        </button>
      </div>
      {problem && (
        <p id="zapis-den-error" role="alert" className="text-[12px] font-semibold text-bad">
          {problem}
        </p>
      )}
    </form>
  );
}

function Entries({ dataset, now, requested }: { dataset: Dataset; now: Date; requested: string | null }) {
  const { update } = useDataset();
  const today = todayIn(dataset.timezone, now);
  const last = addDays(today, -1);
  const first = dataset.first_day;
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);
  const asked =
    requested && isValidDay(requested) && requested <= last && (first === null || requested >= first) ? requested : null;

  // Both lists as they were when the page opened: a day saved here stays in its place.
  const [missing] = useState(() => missingEntryDays(dataset.days, today));
  const [saved] = useState(() => savedEntryDays(dataset.days, today));
  const [extra, setExtra] = useState<string[]>(() => (asked && !missing.includes(asked) && !saved.includes(asked) ? [asked] : []));
  const [open, setOpen] = useState<string | null>(() => asked ?? missing[0] ?? null);
  const [showSaved, setShowSaved] = useState(() => asked !== null && saved.includes(asked));
  // Saves of this visit win over the loaded data, also for days owi has no data for.
  const [local, setLocal] = useState<Record<string, Entry>>({});

  const entryOf = (day: string): Entry | null => local[day] ?? byDay.get(day)?.samsung ?? null;
  const statusOf = (day: string): CardStatus => {
    if (hasEntry(entryOf(day))) return "saved";
    return local[day] ? "deleted" : "missing";
  };
  const stillMissing = missingEntryDays(dataset.days, today).filter((day) => !hasEntry(local[day])).length;

  function reveal(day: string) {
    requestAnimationFrame(() => document.getElementById(`den-${day}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function saveDone(day: string, entry: Entry) {
    setLocal((current) => ({ ...current, [day]: entry }));
    update((current) => withEntry(current, entry));
    const order = [...extra, ...missing];
    const after = order.slice(order.indexOf(day) + 1);
    const next = after.find((item) => missing.includes(item) && !hasEntry(entryOf(item))) ?? null;
    setOpen(next);
    if (next) reveal(next);
  }

  function jump(day: string) {
    if (saved.includes(day)) setShowSaved(true);
    else if (!missing.includes(day) && !extra.includes(day)) setExtra((current) => [day, ...current]);
    setOpen(day);
    reveal(day);
  }

  const card = (day: string) => (
    <EntryCard
      key={day}
      day={day}
      today={today}
      data={byDay.get(day) ?? null}
      entry={entryOf(day)}
      status={statusOf(day)}
      open={open === day}
      onToggle={() => setOpen((current) => (current === day ? null : day))}
      onSaved={(entry) => saveDone(day, entry)}
    />
  );

  return (
    <>
      <DetailHead section="Zápis" title="Zápis zo Samsungu">
        Prepíš čísla zo Samsung Health za dni, keď máš čas. owi podľa nich doladí svoje odhady.
      </DetailHead>

      <div className="rise" style={riseStyle(1)}>
        <QualityTile calibration={dataset.calibration} now={now} />
      </div>

      {extra.length > 0 && (
        <section aria-label="Vybrané dni" className="rise flex flex-col gap-3" style={riseStyle(2)}>
          {extra.map(card)}
        </section>
      )}

      <section aria-labelledby="zapis-chyba" className="rise flex flex-col gap-3" style={riseStyle(2)}>
        <SectionBar id="zapis-chyba" title={stillMissing > 0 ? missingDaysText(stillMissing) : "Všetko zapísané"}>
          <JumpForm first={first} last={last} onJump={jump} />
        </SectionBar>
        <p className="px-1 text-[13px] text-ink2">
          Ukončené dni za posledných {formatInt(ENTRY_WINDOW_DAYS)}, od najnovšieho. Sleep Score patrí k noci, ktorá sa skončila
          ráno v ten deň. Kroky, aktívne kalórie a Sleep Score, ktoré Samsung pošle sám, sa doplnia automaticky.
        </p>
        {missing.length === 0 ? (
          <p className="glass px-6 py-8 text-center text-[14px] text-ink2" style={{ borderRadius: 22, borderStyle: "dashed", borderColor: "var(--line-strong)" }}>
            Všetkých {formatInt(ENTRY_WINDOW_DAYS)} dní má zápis. Ďalší deň pribudne zajtra.
          </p>
        ) : (
          missing.map(card)
        )}
      </section>

      {saved.length > 0 && (
        <section aria-labelledby="zapis-ulozene" className="flex flex-col gap-3">
          <SectionBar id="zapis-ulozene" title={`Uložené · ${formatInt(saved.length)}`}>
            <button
              type="button"
              aria-expanded={showSaved}
              aria-controls="zapis-ulozene-zoznam"
              onClick={() => setShowSaved((value) => !value)}
              className="pill pill-outline"
            >
              {showSaved ? "Skryť" : "Ukázať a opraviť"}
            </button>
          </SectionBar>
          <div id="zapis-ulozene-zoznam" hidden={!showSaved} className="flex flex-col gap-3">
            {saved.map(card)}
          </div>
        </section>
      )}
    </>
  );
}

export function EntriesView() {
  const account = useAccount();
  const requested = useSearchParams().get("den");
  if (account?.viewOnly) return <EmptyState title="Prezeranie je len na čítanie">Počas prezerania iného účtu sa zápisy nemenia.</EmptyState>;
  if (account && !account.dataAccount.has_samsung) return <EmptyState title="Zápisy pre Samsung Health">Tento účet nepoužíva zdroj Samsung Health.</EmptyState>;
  // A new ?den= starts the page afresh, with that day open.
  return <WithData>{(dataset, now) => <Entries key={requested ?? ""} dataset={dataset} now={now} requested={requested} />}</WithData>;
}
