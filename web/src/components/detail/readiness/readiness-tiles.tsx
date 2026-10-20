"use client";

// Tiles of the readiness page: the score and its parts, resting heart rate against its
// baseline, the night signal of last night and the flagged nights of the last 90 days.

import Link from "next/link";
import { Ring, TileShell } from "@/components/ui/tile";
import { addDays, dateRange } from "@/lib/dates";
import {
  READINESS_PARTS,
  restingComparison,
  signalNightText,
  signalStatus,
  type Baseline,
  type SignalLevel,
  type SignalNight,
} from "@/lib/detail-heart";
import { DASH, formatDay, formatDayMonth, formatDecimal, formatDuration, formatInt, plural } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import { learningText, scoreParts } from "@/lib/samsung";
import { formatScore, formatStrain, noteText, readinessBand, SCORE_NAMES, scoreValue } from "@/lib/scores";
import type { Dataset, Day } from "@/lib/types";
import { Figure, Keys, NoteLine, PartsList, ScoreDial, VendorLine } from "../common/bits";
import { LearningBox } from "../common/calibration";
import { ChartTile } from "../common/controls";
import { partRows, presentPartRows, type PartSpec } from "../common/score-parts";
import { TrendChart } from "../common/trend-chart";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function ReadinessTile({ day, isToday }: { day: Day; isToday: boolean }) {
  const score = day.scores?.readiness ?? null;
  const value = scoreValue(score);
  const band = readinessBand(value);
  const note = noteText(score?.note);
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-col gap-2">
        <h2 className="eyebrow">{isToday ? "Readiness · dnes ráno" : `Readiness · ${formatDay(day.day)}`}</h2>
        <VendorLine>Metóda podľa Oura · {score?.components.hrv_balance != null ? "s HRV, bez teploty" : "bez HRV a teploty"}</VendorLine>
      </div>
      <ScoreDial
        share={value === null ? 0 : value / 100}
        color="var(--heart)"
        value={formatScore(score)}
        band={band?.label ?? note ?? "zatiaľ bez skóre"}
        sub="odhad · zo 100"
        label={value === null ? "Readiness zatiaľ nie je" : `Readiness približne ${formatInt(value)} zo 100, ${band?.label ?? ""}`}
      />
      <p className="text-[13px] text-ink2">
        Ako je telo pripravené na deň, zo spánku, nočného tepu a záťaže posledných dní. HRV sa pridá, keď je dostupné spolu
        s použiteľnou históriou rovnakého typu. Skóre zostáva odhadom; teplota sa doň nezapočítava.
      </p>
      <p className="text-[12px] text-muted">85 a viac optimálna · 70–84 dobrá · 60–69 slabšia · pod 60 pozor</p>
      {note && value !== null && note !== "odhad" && <NoteLine>Poznámka: {note}</NoteLine>}
    </TileShell>
  );
}

export function ReadinessPartsTile({ day, previous }: { day: Day; previous: Day | null }) {
  const score = day.scores?.readiness ?? null;
  const sleepTotal = isNumber(day.sleep_minutes) ? day.sleep_minutes + (day.nap_minutes ?? 0) : null;
  const facts: Record<string, string | null> = {
    hrv_balance: isNumber(day.hrv_ms) ? `${formatDecimal(day.hrv_ms, 1)} ms · ${day.hrv_kind?.toUpperCase() ?? "HRV"}` : null,
    sleep: sleepTotal === null ? null : `${formatDuration(sleepTotal)} za 24 h`,
    resting_hr: isNumber(day.hr_resting) ? `${formatInt(day.hr_resting)} bpm` : null,
    previous_day_activity: isNumber(previous?.scores?.strain) ? `včera strain ${formatStrain(previous?.scores?.strain)}` : null,
    sleep_regularity: isNumber(day.scores?.sleep_regularity) ? `SRI ${formatInt(day.scores?.sleep_regularity)}` : null,
  };
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Z čoho sa skladá</h2>
        <p className="text-[12px] text-muted">každá časť 0–100, relatívne váhy vlastného modelu</p>
      </div>
      <PartsList rows={partRows(score, score?.components.hrv_balance == null ? READINESS_PARTS : [...READINESS_PARTS.map((part) => ({ ...part, weight: part.weight * 0.88 })), { key: "hrv_balance", max: 100, weight: 0.12, explain: "nočná variabilita tepu oproti vlastnej histórii rovnakého typu merania" }])} color="var(--heart)" facts={facts} columns={2} />
    </TileShell>
  );
}

/** Parts of the Energy Score in display order, keyed as owi's samsung_scores.py names them. */
const ENERGY_PARTS: PartSpec[] = [
  { key: "sleep", max: 100, explain: "spánok za 7 dní oproti potrebe" },
  { key: "regularity", max: 100, explain: "pravidelnosť spánku, SRI za 14 dní" },
  { key: "timing", max: 100, explain: "stred spánku oproti posledným 14 dňom" },
  { key: "load", max: 100, explain: "včerajšia záťaž oproti 4 týždňom" },
  { key: "night_hr", max: 100, explain: "nočný tep oproti tvojmu normálu" },
];

/** Samsung-style Energy Score: an estimate tuned on the entries, "učí sa" until there are enough. */
export function EnergyScoreTile({ day, isToday }: { day: Day; isToday: boolean }) {
  const score = day.scores?.energy_score ?? null;
  const value = scoreValue(score);
  const learning = learningText(score);
  const rows = presentPartRows(scoreParts(score), ENERGY_PARTS);
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-col gap-2">
        <h2 className="eyebrow">
          {SCORE_NAMES.energy} (odhad) · {isToday ? "dnes" : formatDay(day.day)}
        </h2>
        <VendorLine>Metóda podľa Samsung · bez HRV</VendorLine>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Ring
          share={value === null ? 0 : value / 100}
          color="var(--heart)"
          sweep={0.75}
          from={225}
          thickness={9}
          size={132}
          label={
            value === null
              ? `${SCORE_NAMES.energy} zatiaľ nie je${learning ? `, ${learning}` : ""}`
              : `${SCORE_NAMES.energy} približne ${formatInt(value)} zo 100`
          }
        >
          <span className="figure text-[46px] leading-none tracking-[-0.04em]">{formatInt(value)}</span>
          <span className="mt-1 text-[12px] text-ink2">{learning ? "učí sa" : "odhad"}</span>
        </Ring>
        <p className="min-w-0 flex-1 basis-[220px] text-[13px] text-ink2">
          Koľko energie má telo na deň, podobne ako v Samsung Health: spánok, jeho pravidelnosť a načasovanie, včerajšia
          záťaž a nočný tep. V tomto modeli Energy Score sa HRV nepoužíva.
        </p>
      </div>
      {learning ? (
        <LearningBox score={score} what="Energy Score" />
      ) : (
        rows.length > 0 && <PartsList rows={rows} color="var(--heart)" columns={2} />
      )}
    </TileShell>
  );
}

/** Resting heart rate of the last 30 days against the usual range of the 60 days before. */
export function RestingBaselineTile({
  dataset,
  day,
  baseline,
}: {
  dataset: Dataset;
  day: Day;
  baseline: Baseline | null;
}) {
  const byDay = indexByDay(dataset.days);
  const slots = dateRange(addDays(day.day, -29), day.day);
  const values = slots.map((key) => {
    const value = byDay.get(key)?.hr_resting;
    return isNumber(value) ? value : null;
  });
  const low = baseline ? baseline.mean - baseline.sd : null;
  const high = baseline ? baseline.mean + baseline.sd : null;
  return (
    <ChartTile
      label="Pokojový tep oproti normálu"
      note={restingComparison(day.hr_resting, baseline)}
      legend={
        <Keys
          items={[
            { label: "pokojový tep", color: "var(--heart)", line: true },
            { label: "tvoj bežný rozsah (priemer ± 1 odchýlka, 60 dní)", color: "color-mix(in oklab, var(--heart) 16%, transparent)" },
          ]}
        />
      }
      table={{
        columns: ["Deň", "Pokojový tep", "Oproti priemeru"],
        rows: slots
          .flatMap((key, index) =>
            values[index] === null
              ? []
              : [[formatDay(key), `${formatInt(values[index])} bpm`, baseline ? `${(values[index] as number) >= baseline.mean ? "+" : "−"}${formatDecimal(Math.abs((values[index] as number) - baseline.mean), 1)}` : DASH]],
          )
          .reverse(),
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <Figure size="sm" label="Dnes" value={formatInt(day.hr_resting)} unit="bpm" />
        <Figure size="sm" label="Priemer 60 dní" value={baseline ? formatInt(baseline.mean) : DASH} unit="bpm" />
        <Figure size="sm" label="Bežné kolísanie" value={baseline ? `± ${formatDecimal(baseline.sd, 1)}` : DASH} unit="bpm" />
      </div>
      <TrendChart
        keys={slots}
        labels={slots.map(formatDayMonth)}
        titles={slots.map(formatDay)}
        series={[{ label: "pokojový tep", color: "var(--heart)", values }]}
        band={low !== null && high !== null ? { low: slots.map(() => low), high: slots.map(() => high), color: "color-mix(in oklab, var(--heart) 16%, transparent)" } : undefined}
        guides={baseline ? [{ value: baseline.mean, label: `priemer ${formatInt(baseline.mean)}` }] : []}
        formatValue={(value) => `${formatInt(value)} bpm`}
        formatTick={(value) => formatInt(value)}
        ariaLabel="Pokojový tep za 30 dní oproti tvojmu bežnému rozsahu"
        height={200}
      />
    </ChartTile>
  );
}

const LEVEL_WORD: Record<SignalLevel, string> = { green: "zelená", yellow: "žltá", red: "červená" };
const LEVEL_COLOR: Record<SignalLevel, string> = { green: "var(--good)", yellow: "var(--warn)", red: "var(--bad)" };

/** Triangle for yellow and red, a tick for green, a dash for no reading. */
export function LevelIcon({ level, size = 18 }: { level: SignalLevel | null; size?: number }) {
  if (level === "yellow" || level === "red") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
        <path d="M8 1.5 15 14H1L8 1.5Z" fill={LEVEL_COLOR[level]} />
        <path d="M8 6v4m0 2v.5" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (level === "green") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill={LEVEL_COLOR.green} />
        <path d="m4.8 8.2 2.2 2.2 4.2-4.6" fill="none" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--muted)" strokeWidth="1.5" />
      <path d="M5.5 8h5" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function NightSignalTile({ day, isToday }: { day: Day; isToday: boolean }) {
  const signal = day.scores?.night_signal ?? null;
  const status = signalStatus(signal);
  const flagged = status.level === "yellow" || status.level === "red";
  const color = status.level ? LEVEL_COLOR[status.level] : "var(--line)";
  return (
    <TileShell
      className="gap-4 p-6 sm:p-[30px]"
      style={flagged ? { borderColor: `color-mix(in oklab, ${color} 65%, transparent)`, background: `color-mix(in oklab, ${color} 9%, var(--glass))` } : undefined}
    >
      <h2 className="eyebrow">{isToday ? "Nočný tep · minulá noc" : `Nočný tep · ${formatDay(day.day)}`}</h2>
      <div className="flex items-start gap-3">
        <LevelIcon level={status.level} size={22} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-[18px] leading-snug font-semibold tracking-[-0.01em]">
            {status.level ? `${LEVEL_WORD[status.level][0].toUpperCase()}${LEVEL_WORD[status.level].slice(1)} · ` : ""}
            {status.title}
          </p>
          <p className="text-[14px] text-ink2">{status.text}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Figure size="sm" label="Nočný tep" value={formatInt(signal?.night_hr ?? null)} unit="bpm" />
        <Figure size="sm" label="Tvoj normál" value={formatInt(signal?.baseline ?? null)} unit="bpm" />
        <Figure
          size="sm"
          label="Rozdiel"
          value={isNumber(signal?.delta) ? `${(signal?.delta as number) >= 0 ? "+" : "−"}${formatDecimal(Math.abs(signal?.delta as number), 1)}` : DASH}
          unit="bpm"
        />
      </div>
      <p className="text-[12px] text-muted">
        Priemerný tep počas spánku medzi polnocou a 7:00 oproti mediánu všetkých predošlých nocí. Žltá: o 3 bpm vyšší,
        červená: aspoň o 4 bpm vyšší dve noci po sebe. Bežné kolísanie je okolo ± 3 bpm. Pozorovanie z dát, nie diagnóza.
      </p>
      <VendorLine>Metóda NightSignal · Alavi 2022</VendorLine>
    </TileShell>
  );
}

export function FlaggedNightsTile({ nights, length }: { nights: SignalNight[]; length: number }) {
  const red = nights.filter((night) => night.level === "red").length;
  const yellow = nights.length - red;
  return (
    <TileShell className="gap-4 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Zvýšený nočný tep · {length} dní</h2>
        <p className="text-[13px] text-ink2">
          {nights.length === 0
            ? "žiadna žltá ani červená noc"
            : `${formatInt(yellow)} ${plural(yellow, "žltá", "žlté", "žltých")} · ${formatInt(red)} ${plural(red, "červená", "červené", "červených")}`}
        </p>
      </div>
      {nights.length === 0 ? (
        <p className="text-[15px] text-ink2">Za posledných {length} dní bol nočný tep vždy blízko tvojho normálu.</p>
      ) : (
        <ul className="flex flex-col">
          {nights.map((night) => (
            <li key={night.day} className="border-t border-line first:border-0">
              <Link href={`/den/${night.day}`} className="row-link !mx-[-8px] !my-0 flex items-start gap-3 !py-3">
                <LevelIcon level={night.level} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">
                    {formatDay(night.day)} · {LEVEL_WORD[night.level]}
                  </span>
                  <span className="text-[13px] text-ink2">{signalNightText(night)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">
        Zvýšený nočný tep sa často objavuje po náročnom dni, pri strese, nedostatku spánku alebo na začiatku choroby. Sú
        to pozorovania, nie zdravotné rady; ak sa necítiš dobre, poraď sa s lekárom.
      </p>
    </TileShell>
  );
}
