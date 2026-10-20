// The tiles of one day: the day score with its three parts, strain and sleep need, the night,
// activity, heart and workouts. Every score names the vendor its method comes from.

import { dayFigure } from "@/lib/day-values";
import Link from "next/link";
import { ACTIVITY_TARGETS, CalibrationNote } from "@/components/detail/common/calibration";
import { Chip, Rows, Swatch, VENDOR, VendorLine } from "@/components/detail/shared-b/parts";
import { WorkoutHeader, WorkoutRow, ZoneLegend } from "@/components/detail/shared-b/workout-row";
import { ROUTES } from "@/components/shell/nav";
import { Arrow, mix, Ring, ScoreBar, STAGE_COLORS, STAGE_LABELS, StageStrip, TileShell, ZoneBar } from "@/components/ui/tile";
import { ENTRY_FIELDS, hasEntry } from "@/lib/entries";
import {
  approx,
  DASH,
  formatBpm,
  formatClock,
  formatDay,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatDurationCompact,
  formatInt,
  formatKcal,
  plural,
  stepsSourceLabel,
} from "@/lib/format";
import { sleepSegments } from "@/lib/overview";
import {
  appleSleepBand,
  cardioStatusLabel,
  componentLabel,
  dayScoreLabel,
  formatScore,
  formatStrain,
  noteText,
  SCORE_NAMES,
  scoreValue,
  strainBand,
  subScores,
  type SubScore,
} from "@/lib/scores";
import { autoValue, difference, hasAuto, owiFigure, owiFigureText } from "@/lib/samsung";
import type { Calibration, Day, EntryField, Score } from "@/lib/types";
import { Hypnogram } from "./hypnogram";

const SUB_COLOR: Record<SubScore["key"], string> = {
  readiness: "var(--heart)",
  sleepPerformance: "var(--sleep)",
  activity: "var(--accent)",
};

const SUB_VENDOR: Record<SubScore["key"], string> = {
  readiness: VENDOR.readiness,
  sleepPerformance: VENDOR.sleepPerformance,
  activity: VENDOR.activity,
};

const TILE = "flex-auto gap-5 p-6 sm:p-7";

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="eyebrow">{children}</h2>
      {aside}
    </div>
  );
}

/** The parts of a 0–100 score, as short bars, folded away until asked for. */
function Components({ score, title = "Z čoho sa skladá" }: { score: Score | null | undefined; title?: string }) {
  const entries = Object.entries(score?.components ?? {});
  if (entries.length === 0) return null;
  return (
    <details className="group text-[13px]">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-[12px] font-semibold text-ink2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {title}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {entries.map(([key, value]) => (
          <li key={key} className="grid grid-cols-[minmax(0,1fr)_64px_28px] items-center gap-2.5">
            <span className="truncate text-ink2">{componentLabel(key)}</span>
            <ScoreBar share={value === null ? 0 : value / 100} color="var(--ink2)" />
            <span className="tabular text-right font-semibold">{value === null ? DASH : formatInt(value)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------------------

export function DayScoreTile({ day, previous }: { day: Day; previous: Day | null }) {
  const scores = day.scores ?? null;
  const value = scores?.day_score ?? null;
  const parts = subScores(day, previous);
  const capped = scores?.night_signal?.level === "red" && value !== null && value <= 50;
  const sources = { readiness: scores?.readiness, sleepPerformance: scores?.sleep_performance, activity: scores?.activity };

  return (
    <TileShell className={TILE}>
      <Heading>{SCORE_NAMES.day}</Heading>
      <Ring
        share={value === null ? 0 : value / 100}
        sweep={0.75}
        from={225}
        thickness={12}
        className="w-full max-w-[240px] self-center"
        label={value === null ? "Skóre dňa zatiaľ nie je" : `Skóre dňa ${formatInt(value)} zo 100`}
      >
        <span className="figure text-[clamp(68px,7vw,96px)] leading-[0.9] tracking-[-0.05em]">{formatInt(value)}</span>
        <span className="mt-1.5 text-[14px] text-ink2">{dayScoreLabel(value)}</span>
      </Ring>
      <p className="text-[12px] text-muted">
        Priemer troch častí nižšie, každá má rovnakú váhu.
        {capped && " Pre zvýšený nočný tep je skóre obmedzené na 50."}
      </p>
      <div className="flex flex-col gap-5">
        {parts.map((part) => (
          <div key={part.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[14px] text-ink2">{part.label}</span>
              <span className="text-[20px] font-medium">{part.display}</span>
            </div>
            <ScoreBar share={part.value === null ? 0 : part.value / 100} color={SUB_COLOR[part.key]} />
            <span className="text-[12px] text-muted">{part.band ? `${part.band.label} · ${part.reason}` : part.reason}</span>
            <VendorLine>{SUB_VENDOR[part.key]}</VendorLine>
            <Components score={sources[part.key]} />
          </div>
        ))}
      </div>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

export function StrainTile({ day }: { day: Day }) {
  const scores = day.scores ?? null;
  const strain = scores?.strain ?? null;
  const band = strainBand(strain);
  const need = scores?.sleep_need_minutes ?? null;
  const load = scores?.cardio_load ?? null;
  const column = "flex min-w-0 flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0 sm:border-t-0 sm:pt-0";
  return (
    <TileShell className={TILE}>
      <Heading aside={day.complete === false ? <Chip>strain zatiaľ rastie</Chip> : undefined}>Záťaž a zotavenie</Heading>
      <div className="grid gap-4 sm:grid-cols-3 sm:gap-6">
        <div className={column}>
          <span className="text-[13px] text-ink2">{SCORE_NAMES.strain} dňa</span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="figure text-[52px] leading-none">{formatStrain(strain)}</span>
            <span className="text-[13px] text-ink2">z 21</span>
          </span>
          <ScoreBar share={strain === null ? 0 : strain / 21} color="var(--accent)" />
          <span className="text-[12px] text-muted">{band ? band.label : "zatiaľ bez dát"} · srdce a svaly za celý deň</span>
          <VendorLine>{VENDOR.strain}</VendorLine>
        </div>
        <div className={column}>
          <span className="text-[13px] text-ink2">Potreba spánku na ďalšiu noc</span>
          <span className="figure-sm text-[34px]">{formatDurationCompact(need)}</span>
          <ScoreBar share={need === null ? 0 : need / 600} color="var(--sleep)" />
          <span className="text-[12px] text-muted">rastie so strainom a spánkovým dlhom</span>
          <VendorLine>{VENDOR.sleepNeed}</VendorLine>
        </div>
        <div className={column}>
          <span className="text-[13px] text-ink2">Stav záťaže · 7 dní</span>
          <span className="figure-sm text-[24px] leading-[1.15]">{cardioStatusLabel(load?.status)}</span>
          <ScoreBar share={load?.ratio == null ? 0 : load.ratio / 1.6} color="var(--accent)" />
          <span className="text-[12px] text-muted">
            {load?.ratio == null ? "potrebuje aspoň pár týždňov dát" : `7 dní oproti 4 týždňom: ${formatDecimal(load.ratio, 2)}`}
          </span>
          <VendorLine>{VENDOR.cardioLoad}</VendorLine>
        </div>
      </div>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

function NightScore({ label, score, band, vendor, extra }: { label: string; score: Score | null | undefined; band: string | null; vendor: string; extra?: string }) {
  const value = scoreValue(score);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[18px] border border-line p-4">
      <span className="text-[13px] text-ink2">{label}</span>
      <span className="figure-sm text-[34px]">{formatScore(score)}</span>
      <ScoreBar share={value === null ? 0 : value / 100} color="var(--sleep)" />
      <span className="text-[12px] text-muted">{value === null ? (noteText(score?.note) ?? "zatiaľ sa nedá spočítať") : [band, extra].filter(Boolean).join(" · ")}</span>
      <VendorLine>{vendor}</VendorLine>
      <Components score={score} title="Zložky" />
    </div>
  );
}

const STAGES = [
  { stage: "deep", key: "sleep_deep_min" },
  { stage: "rem", key: "sleep_rem_min" },
  { stage: "light", key: "sleep_light_min" },
  { stage: "awake", key: "sleep_awake_min" },
] as const;

export function SleepTile({ day, previous, timeZone }: { day: Day; previous: Day | null; timeZone: string }) {
  const scores = day.scores ?? null;
  const hasSleep = day.sleep_minutes !== null;
  const timeline = day.sleep_timeline ?? [];
  const need = previous?.scores?.sleep_need_minutes ?? null;
  const performanceBand = subScores(day, previous).find((part) => part.key === "sleepPerformance")?.band?.label ?? null;
  const apple = appleSleepBand(scoreValue(scores?.apple_sleep))?.label ?? null;
  const asleep = (day.sleep_minutes ?? 0) || 1;

  return (
    <TileShell className={TILE}>
      <Heading aside={hasSleep ? <span className="mono text-[12px] text-ink2">{formatClock(day.sleep_start, timeZone)} → {formatClock(day.sleep_end, timeZone)}</span> : undefined}>
        Spánok · noc na {formatDay(day.day)}
      </Heading>
      <div className="figure text-[clamp(44px,4.4vw,56px)] leading-none tracking-[-0.03em]">{hasSleep ? formatDuration(day.sleep_minutes) : DASH}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NightScore
          label={SCORE_NAMES.sleepPerformance}
          score={scores?.sleep_performance}
          band={performanceBand}
          vendor={`${VENDOR.sleepPerformance} · spánok oproti potrebe`}
          extra={need === null ? undefined : `potreba ${formatDurationCompact(need)}`}
        />
        <NightScore label={SCORE_NAMES.appleSleep} score={scores?.apple_sleep} band={apple} vendor={`${VENDOR.appleSleep} · dĺžka, čas zaspatia, prerušenia`} />
      </div>
      {!hasSleep ? (
        <p className="text-[14px] text-ink2">Spánok, ktorý skončil v tento deň, sa nezaznamenal.</p>
      ) : timeline.length > 0 && day.sleep_start && day.sleep_end ? (
        <Hypnogram timeline={timeline} start={day.sleep_start} end={day.sleep_end} timeZone={timeZone} label="Priebeh noci po fázach" />
      ) : (
        <div className="flex flex-col gap-2">
          <StageStrip segments={sleepSegments(day)} label={`Fázy spánku spolu, ${formatDuration(day.sleep_minutes)}`} />
          <span className="text-[12px] text-muted">Priebeh fáz v čase chýba, ukazujú sa len súčty.</span>
        </div>
      )}
      {hasSleep && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
          {STAGES.map(({ stage, key }) => {
            const minutes = day[key];
            return (
              <div key={stage} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-ink2">
                  <span aria-hidden="true" className="size-[9px] shrink-0 rounded-[3px]" style={{ background: STAGE_COLORS[stage] }} />
                  {STAGE_LABELS[stage]}
                </span>
                <span className="font-semibold">
                  {formatDurationCompact(minutes)}
                  {minutes !== null && stage !== "awake" && <span className="font-normal text-muted"> · {formatInt((minutes / asleep) * 100)} %</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
        <span>Zdriemnutie: {day.nap_minutes ? formatDuration(day.nap_minutes) : "žiadne"}</span>
        <span>
          Pravidelnosť spánku: {scores?.sleep_regularity == null ? DASH : formatInt(scores.sleep_regularity)}
          <span className="mono"> · {VENDOR.regularity}, 14 dní</span>
        </span>
      </div>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

export function ActivityTile({ day, calibration }: { day: Day; calibration?: Calibration | null }) {
  const running = day.complete === false;
  return (
    <TileShell className={TILE}>
      <Heading>Pohyb</Heading>
      <div>
        <div className="figure text-[64px] leading-none tracking-[-0.04em]">{formatInt(day.steps)}</div>
        <div className="mt-1.5 text-[13px] text-ink2">
          krokov{running ? " zatiaľ" : ""} · zdroj {stepsSourceLabel(day.steps_source)}
        </div>
      </div>
      <Rows
        rows={[
          { k: "Aktívny čas", v: approx(formatDuration(day.active_minutes_est)) },
          { k: "Vzdialenosť", v: dayFigure(day, "distance", formatDistance) },
          { k: "Kalórie spolu", v: dayFigure(day, "totalEnergy", formatKcal) },
          { k: "z toho aktivita", v: dayFigure(day, "activeEnergy", formatKcal) },
          { k: "z toho bazál", v: formatKcal(day.basal_kcal) },
        ]}
      />
      <p className="text-[12px] text-muted">≈ označuje odhad z tepu a krokov. Ostatné hodnoty pochádzajú zo zariadenia alebo súčtu jeho meraní.</p>
      <CalibrationNote calibration={calibration} targets={DAY_TARGETS} />
    </TileShell>
  );
}

const DAY_TARGETS = [{ key: "distance_km", label: "vzdialenosť" }, ...ACTIVITY_TARGETS] as const;

// ---------------------------------------------------------------------------------------

const ENTRY_LABELS: Record<EntryField, string> = {
  steps: "Kroky",
  distance_km: "Vzdialenosť",
  active_minutes: "Aktívny čas",
  active_kcal: "Kalórie z aktivity",
  total_kcal: "Kalórie spolu",
  sleep_score: "Sleep Score",
  energy_score: "Energy Score",
};

function entryNumber(field: EntryField, value: number | null): { value: string; unit?: string } {
  if (value === null) return { value: DASH };
  if (field === "distance_km") return { value: formatDecimal(value, 2), unit: "km" };
  if (field === "active_minutes") return { value: formatInt(value), unit: "min" };
  if (field === "active_kcal" || field === "total_kcal") return { value: formatInt(value), unit: "kcal" };
  return { value: formatInt(value) };
}

/**
 * The day's numbers from Samsung Health next to owi's own: the user's entry, and where it has
 * no number, what Samsung sent by itself (marked "automaticky"). Only for days with either.
 */
export function SamsungTile({ day }: { day: Day }) {
  const entry = hasEntry(day.samsung) ? day.samsung : null;
  if (!entry && !hasAuto(day)) return null;
  const cells = ENTRY_FIELDS.flatMap((spec) => {
    const entered = entry?.[spec.key] ?? null;
    const sent = entered === null ? autoValue(day, spec.key) : null;
    const samsung = entered ?? sent;
    const owi = owiFigure(day, spec.key);
    if (samsung === null && owi === null) return [];
    return [{ key: spec.key, samsung, owi, auto: sent !== null }];
  });
  return (
    <TileShell className={TILE}>
      <Heading
        aside={
          // /zapis takes finished days; a running day only has what Samsung sent so far.
          entry || day.complete ? (
            <Link href={ROUTES.entryFor(day.day)} className="title-link inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink2">
              {entry ? "Upraviť zápis" : "Doplniť zápis"} <Arrow />
            </Link>
          ) : undefined
        }
      >
        Samsung a owi
      </Heading>
      <p className="text-[12px] text-muted">
        Hore číslo zo Samsung Health, zo zápisu alebo automaticky, pod ním owi a jeho rozdiel. Sleep Score je za noc, ktorá
        skončila v tento deň.
      </p>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 xl:grid-cols-7">
        {cells.map((cell) => {
          const shown = entryNumber(cell.key, cell.samsung);
          const diff = difference(cell.key, cell.owi, cell.samsung);
          return (
            <div key={cell.key} className="flex min-w-0 flex-col gap-1.5 border-t border-line pt-3">
              <dt className="text-[12px] text-ink2">{ENTRY_LABELS[cell.key]}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="figure-sm text-[24px] whitespace-nowrap">{shown.value}</span>
                {shown.unit && cell.samsung !== null && <span className="text-[13px] text-ink2">{shown.unit}</span>}
              </dd>
              <dd className="text-[12px] text-muted">
                {cell.auto && <span className="mono block text-[10px] tracking-[0.04em] text-ink2">automaticky</span>}
                owi {owiFigureText(day, cell.key)}
                {diff && <span className="whitespace-nowrap"> · {diff}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

const SIGNAL_TEXT = {
  green: { label: "v norme", color: "var(--good)" },
  yellow: { label: "vyšší než zvyčajne", color: "var(--warn)" },
  red: { label: "zvýšený druhú noc po sebe", color: "var(--bad)" },
} as const;

export function HeartTile({ day }: { day: Day }) {
  const signal = day.scores?.night_signal ?? null;
  const level = signal?.level ? SIGNAL_TEXT[signal.level] : null;
  const light = day.zone_light_min ?? 0;
  const moderate = day.zone_moderate_min ?? 0;
  const vigorous = day.zone_vigorous_min ?? 0;
  const hasZones = day.zone_light_min !== null;
  return (
    <TileShell className={TILE}>
      <Heading>Srdce</Heading>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="figure text-[64px] leading-none tracking-[-0.04em]">{formatInt(day.hr_resting)}</span>
        <span className="text-[14px] text-ink2">bpm v pokoji</span>
      </div>
      <Rows
        rows={[
          { k: "Najnižší", v: formatBpm(day.hr_min) },
          { k: "Priemer", v: formatBpm(day.hr_avg) },
          { k: "Najvyšší", v: formatBpm(day.hr_max) },
        ]}
      />
      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] text-ink2">Čas v zónach{hasZones ? ` · spolu ${formatDurationCompact(light + moderate + vigorous)}` : ""}</span>
        <ZoneBar
          light={light}
          moderate={moderate}
          vigorous={vigorous}
          height={8}
          label={hasZones ? `Zóny tepu: ľahká ${light} min, stredná ${moderate} min, vysoká ${vigorous} min` : "Zóny tepu: bez dát"}
        />
        <div className="flex flex-wrap gap-x-3.5 gap-y-1">
          <Swatch color={mix("var(--accent)", 38)} label={`ľahká ${hasZones ? formatDurationCompact(light) : DASH}`} />
          <Swatch color={mix("var(--accent)", 68)} label={`stredná ${hasZones ? formatDurationCompact(moderate) : DASH}`} />
          <Swatch color="var(--accent)" label={`vysoká ${hasZones ? formatDurationCompact(vigorous) : DASH}`} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[14px] text-ink2">{SCORE_NAMES.nightSignal}</span>
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            {level && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: level.color }} />}
            {level ? level.label : DASH}
          </span>
        </div>
        {signal?.night_hr != null && (
          <span className="text-[12px] text-muted">
            v noci {formatDecimal(signal.night_hr, 1)} bpm · bežne {formatDecimal(signal.baseline, 1)}
            {signal.delta != null && ` (${signal.delta >= 0 ? "+" : "−"}${formatDecimal(Math.abs(signal.delta), 1)})`}
          </span>
        )}
        <VendorLine>{VENDOR.nightSignal}</VendorLine>
      </div>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

export function DayWorkoutsTile({ day, timeZone }: { day: Day; timeZone: string }) {
  const workouts = [...day.workouts].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const total = workouts.reduce((sum, workout) => sum + workout.duration_s, 0);
  return (
    <TileShell className="gap-3 p-6 sm:p-7">
      <Heading
        aside={
          workouts.length > 0 ? (
            <span className="text-[13px] text-ink2">
              {workouts.length} {plural(workouts.length, "tréning", "tréningy", "tréningov")} · {formatDuration(total / 60)}
            </span>
          ) : undefined
        }
      >
        Tréningy
      </Heading>
      {workouts.length === 0 ? (
        <p className="text-[14px] text-ink2">V tento deň nebol zaznamenaný žiadny tréning.</p>
      ) : (
        <>
          <ZoneLegend />
          <div className="pt-2">
            <WorkoutHeader />
            {workouts.map((workout) => (
              <WorkoutRow key={workout.id} workout={workout} timeZone={timeZone} showDate={false} />
            ))}
          </div>
          <VendorLine>strain tréningu {VENDOR.strain} · kalórie ≈ odhad z tepu</VendorLine>
        </>
      )}
    </TileShell>
  );
}
