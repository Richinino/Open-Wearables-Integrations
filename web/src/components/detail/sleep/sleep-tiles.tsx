"use client";

// The top tiles of the sleep page: the score of last night with the switch between Sleep
// Performance and Sleep Score, the night itself, the sleep need for tonight and how regular
// the sleep is.

import { mix, STAGE_COLORS, STAGE_LABELS, StageStrip, TileShell } from "@/components/ui/tile";
import {
  regularityBand,
  SLEEP_KINDS,
  sleepScoreOf,
  splitTimeline,
  SRI_MEDIAN,
  SRI_QUINTILES,
  stageTotals,
  type NeedPlan,
  type SleepKind,
} from "@/lib/detail-sleep";
import {
  approx,
  DASH,
  formatClock,
  formatDay,
  formatDecimal,
  formatDuration,
  formatDurationCompact,
  formatInt,
  formatTimeOfDay,
} from "@/lib/format";
import { sleepSegments } from "@/lib/overview";
import { learningText, scoreParts } from "@/lib/samsung";
import { formatScore, formatStrain, noteText, scoreValue, strainBand } from "@/lib/scores";
import type { Day } from "@/lib/types";
import { Figure, NoteLine, PartsList, RunningHint, ScoreDial, Swatch, VendorLine } from "../common/bits";
import { LearningBox } from "../common/calibration";
import { Switch } from "../common/controls";
import { partRows, presentPartRows } from "../common/score-parts";
import { Hypnogram } from "./hypnogram";

const KIND_OPTIONS: { value: SleepKind; label: string }[] = (["performance", "apple", "samsung"] as const).map((kind) => ({
  value: kind,
  label: SLEEP_KINDS[kind].option ?? SLEEP_KINDS[kind].label,
}));

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Last night's score; the switch picks Sleep Performance (WHOOP), Sleep Score (Apple) or Samsung. */
export function SleepScoreTile({
  night,
  previous,
  kind,
  onKind,
  timeZone,
}: {
  night: Day | null;
  previous: Day | null;
  kind: SleepKind;
  onKind: (kind: SleepKind) => void;
  timeZone: string;
}) {
  const info = SLEEP_KINDS[kind];
  const score = sleepScoreOf(night, kind);
  const value = scoreValue(score);
  const band = info.band(value);
  const learning = learningText(score);
  const note = learning || info.estimate ? null : noteText(score?.note);
  const minutes = night?.sleep_minutes ?? null;
  const awake = night?.sleep_awake_min ?? null;
  const need = previous?.scores?.sleep_need_minutes ?? null;
  const asleep = isNumber(minutes) ? `${formatDuration(minutes)} spánku` : null;
  const awakeFact = isNumber(awake) ? `bdenie ${formatDuration(awake)}` : null;
  const deepFact = isNumber(night?.sleep_deep_min) ? `${formatDuration(night?.sleep_deep_min)} hlbokého` : null;
  const remFact = isNumber(night?.sleep_rem_min) ? `${formatDuration(night?.sleep_rem_min)} REM` : null;
  const facts: Record<string, string | null> =
    kind === "performance"
      ? {
          hours_vs_needed: isNumber(minutes) && isNumber(need) ? `${formatDuration(minutes)} z ${formatDuration(need)}` : null,
          efficiency: awakeFact,
        }
      : kind === "apple"
        ? {
            duration: asleep,
            bedtime: night?.sleep_start ? `zaspatie ${formatClock(night.sleep_start, timeZone)}` : null,
            interruptions: awakeFact,
          }
        : { duration: asleep, deep: deepFact, rem: remFact, interruptions: awakeFact };
  const shown = value === null ? DASH : info.estimate ? approx(formatInt(value)) : formatScore(score);
  const rows = info.onlyPresent ? presentPartRows(scoreParts(score), info.parts) : partRows(score, info.parts);

  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-col gap-3">
        <h2 className="eyebrow">Skóre spánku</h2>
        <Switch options={KIND_OPTIONS} value={kind} onChange={onKind} label="Ktoré skóre spánku ukázať" />
        <VendorLine>
          Metóda podľa {info.vendor}
          {info.estimate ? " · odhad" : ""}
        </VendorLine>
      </div>
      <ScoreDial
        share={value === null ? 0 : value / 100}
        color="var(--sleep)"
        value={shown}
        band={learning ? "učí sa" : (band?.label ?? note ?? "zatiaľ bez skóre")}
        sub={info.estimate ? "odhad · zo 100" : "zo 100"}
        label={
          value === null
            ? `${info.label} zatiaľ nie je${learning ? `, ${learning}` : ""}`
            : `${info.label} ${info.estimate ? "približne " : ""}${formatInt(value)} zo 100, ${band?.label ?? ""}`
        }
      />
      <p className="text-[13px] text-ink2">{info.about}</p>
      {learning ? (
        <LearningBox score={score} what="Sleep Score" />
      ) : (
        <>
          {note && value !== null && <NoteLine>Poznámka: {note}</NoteLine>}
          {rows.length > 0 && <PartsList rows={rows} color="var(--sleep)" facts={facts} />}
        </>
      )}
    </TileShell>
  );
}

const STAGE_ORDER = ["deep", "rem", "light", "awake"] as const;

/** Last night as a hypnogram with the minutes per stage, and the day's naps apart. */
export function NightTile({ night, timeZone, isLastNight }: { night: Day; timeZone: string; isLastNight: boolean }) {
  const { main, naps } = splitTimeline(night);
  const totals = stageTotals(night);
  const minutes = night.sleep_minutes;
  const inBed = isNumber(minutes) && isNumber(night.sleep_awake_min) ? minutes + night.sleep_awake_min : null;
  const summary = totals
    .filter((item) => item.minutes !== null)
    .map((item) => `${STAGE_LABELS[item.stage].toLowerCase()} ${formatDuration(item.minutes)}`)
    .join(", ");
  const clock = `${formatClock(night.sleep_start, timeZone)} → ${formatClock(night.sleep_end, timeZone)}`;
  const napNote = (night.nap_minutes ?? 0) > 0 && naps.length === 0;

  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">{isLastNight ? "Priebeh minulej noci" : `Priebeh noci · ${formatDay(night.day)}`}</h2>
        <div className="mono text-[12px] text-ink2">{clock}</div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="figure text-[clamp(40px,4vw,52px)] leading-none tracking-[-0.03em]">{formatDuration(minutes)}</div>
        <div className="text-[14px] text-ink2">spánku{inBed !== null ? ` · v posteli ${formatDuration(inBed)}` : ""}</div>
      </div>
      {main ? (
        <Hypnogram session={main} timeZone={timeZone} label={`Priebeh noci ${clock} po fázach: ${summary || "bez fáz"}`} />
      ) : (
        <div className="flex flex-col gap-2">
          <StageStrip segments={sleepSegments(night)} label={`Fázy noci: ${summary || "bez fáz"}`} />
          <NoteLine>Podrobný priebeh fáz pre túto noc chýba, pás ukazuje len ich súčty.</NoteLine>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {STAGE_ORDER.map((stage) => {
          const total = totals.find((item) => item.stage === stage);
          return (
            <div key={stage} className="flex min-w-0 flex-col gap-1">
              <dt className="flex items-center gap-2 text-[13px] text-ink2">
                <Swatch color={STAGE_COLORS[stage]} />
                {STAGE_LABELS[stage]}
              </dt>
              <dd className="figure-sm text-[22px] whitespace-nowrap">{formatDurationCompact(total?.minutes)}</dd>
              <dd className="text-[12px] text-muted">
                {total?.share != null ? `${formatInt(total.share * 100)} % spánku` : stage === "awake" ? "počas noci" : DASH}
              </dd>
            </div>
          );
        })}
      </dl>
      {(naps.length > 0 || napNote) && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="text-[14px] font-semibold">Zdriemnutie {isLastNight ? "dnes" : `· ${formatDay(night.day)}`}</h3>
          {naps.map((nap) => {
            const from = formatClock(new Date(nap.start).toISOString(), timeZone);
            const to = formatClock(new Date(nap.end).toISOString(), timeZone);
            return (
              <div key={nap.start} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
                <span className="mono text-[12px] text-ink2">
                  {from} → {to}
                </span>
                <span className="text-[15px] font-semibold">{formatDuration(nap.asleepMinutes)}</span>
                <div className="col-span-2">
                  <StageStrip
                    height={12}
                    segments={nap.blocks.map((block) => ({ stage: block.stage, minutes: (block.end - block.start) / 60_000 }))}
                    label={`Zdriemnutie ${from}–${to}, ${formatDuration(nap.asleepMinutes)}`}
                  />
                </div>
              </div>
            );
          })}
          {napNote && <p className="text-[13px] text-ink2">{formatDuration(night.nap_minutes)} spolu, bez priebehu fáz.</p>}
        </div>
      )}
    </TileShell>
  );
}

/** How much sleep tonight needs and when to fall asleep for it. */
export function NeedTile({ plan, isToday }: { plan: NeedPlan; isToday: boolean }) {
  const band = strainBand(plan.strain);
  return (
    <TileShell className="gap-4 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">{isToday ? "Potreba spánku · dnešná noc" : `Potreba spánku · noc po ${formatDay(plan.day)}`}</h2>
        {plan.partial && <RunningHint />}
      </div>
      <div className="figure text-[clamp(44px,5vw,64px)] leading-none tracking-[-0.03em]">{formatDuration(plan.need)}</div>
      <p className="text-[17px] leading-snug font-medium tracking-[-0.01em]">
        {plan.bedtime !== null && plan.wake !== null
          ? `Zaspi okolo ${formatTimeOfDay(plan.bedtime)}, ak vstávaš ${formatTimeOfDay(plan.wake)}.`
          : plan.need === null
            ? "Potreba sa zatiaľ nedá spočítať."
            : "Na odporúčaný čas zaspatia je zatiaľ málo nocí."}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Figure
          size="sm"
          label="Strain dňa"
          value={formatStrain(plan.strain)}
          note={band ? `${band.label}${plan.partial ? ", zatiaľ" : ""}` : "bez dát"}
        />
        <Figure
          size="sm"
          label="Vstávanie"
          value={formatTimeOfDay(plan.wake)}
          note="medián 4 týždňov, rovnaký typ dňa"
        />
      </div>
      <p className="text-[12px] text-muted">
        Potreba = základ pre tvoj vek (8–10 h) + záťaž dňa + polovica včerajšieho deficitu − zdriemnutia. Čas zaspatia
        počíta aj s 15 minútami na zaspanie.
        {plan.partial && " Deň ešte beží, s ďalšou záťažou môže potreba stúpnuť."}
      </p>
      <VendorLine>Metóda podľa WHOOP</VendorLine>
    </TileShell>
  );
}

const SRI_FROM = 40;
const SRI_TO = 100;
const SRI_STEPS = [SRI_FROM, ...SRI_QUINTILES, SRI_TO];

/** The Sleep Regularity Index of the last 14 days and where it sits among adults. */
export function RegularityTile({ sri }: { sri: number | null }) {
  const band = regularityBand(sri);
  const at = (value: number) => ((Math.min(Math.max(value, SRI_FROM), SRI_TO) - SRI_FROM) / (SRI_TO - SRI_FROM)) * 100;
  return (
    <TileShell className="gap-4 p-6 sm:p-[30px]">
      <h2 className="eyebrow">Pravidelnosť spánku · 14 dní</h2>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="figure text-[clamp(44px,5vw,64px)] leading-none tracking-[-0.03em]">{sri === null ? DASH : formatInt(sri)}</div>
        <div className="text-[14px] text-ink2">SRI{band ? ` · ${band.label}` : ""}</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative pt-1.5">
          <div
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`Pätiny dospelých podľa SRI: hranice ${SRI_QUINTILES.map((value) => formatDecimal(value, 1)).join(", ")}${sri === null ? "" : `; tvoja hodnota ${formatInt(sri)}`}`}
          >
            {SRI_STEPS.slice(1).map((to, index) => (
              <div key={to} style={{ flex: `${to - SRI_STEPS[index]} 1 0`, background: mix("var(--sleep)", 20 + index * 20) }} />
            ))}
          </div>
          {sri !== null && (
            <div
              aria-hidden="true"
              className="absolute top-0 h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${at(sri)}%`, boxShadow: "0 0 0 2px var(--surface)" }}
            />
          )}
        </div>
        <div className="relative h-4 text-[11px] text-muted" aria-hidden="true">
          <span className="absolute left-0">menej pravidelný</span>
          <span className="mono absolute -translate-x-1/2" style={{ left: `${at(SRI_MEDIAN)}%` }}>
            {SRI_MEDIAN}
          </span>
          <span className="absolute right-0">pravidelnejší</span>
        </div>
      </div>
      <p className="text-[14px] text-ink2">{band ? band.text : "Na pravidelnosť je zatiaľ málo nocí."}</p>
      <p className="text-[12px] text-muted">
        Porovnáva každú minútu dňa s tou istou minútou o 24 hodín neskôr: 100 znamená, že spíš a bdieš každý deň v rovnakých
        časoch, 0, že je to náhodné. Medián dospelých je 81, stupnica pätín z UK Biobank.
      </p>
      <VendorLine>Sleep Regularity Index · Phillips 2017</VendorLine>
    </TileShell>
  );
}
