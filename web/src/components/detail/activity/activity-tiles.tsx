"use client";

// Tiles of the activity page: Activity and its six parts, the strain of the day with its
// workouts, the cardio load status with its 12-week trend, and active time and calories.

import { useRouter } from "next/navigation";
import { ColumnChart, durationTicks } from "@/components/charts/charts";
import { dayPoints, tickDuration, tickPlain } from "@/components/charts/points";
import { mix, Ring, ScoreBar, TileShell } from "@/components/ui/tile";
import { addDays, dateRange } from "@/lib/dates";
import {
  ACTIVITY_PARTS,
  CARDIO_BANDS,
  CARDIO_THRESHOLDS,
  cardioText,
  cardioTrend,
  cardioWeeks,
  STRAIN_BANDS,
  STRAIN_MAX,
  zoneTotals,
} from "@/lib/detail-activity";
import {
  approx,
  DASH,
  formatClock,
  formatDay,
  formatDayMonth,
  formatDecimal,
  formatDuration,
  formatInt,
  plural,
  workoutLabel,
} from "@/lib/format";
import { average, indexByDay, periodSummary, windowEnding } from "@/lib/metrics";
import { activityBand, cardioStatusLabel, formatScore, formatStrain, noteText, scoreValue, strainBand } from "@/lib/scores";
import type { Dataset, Day } from "@/lib/types";
import { Figure, NoteLine, PartsList, RunningHint, ScoreDial, VendorLine } from "../common/bits";
import { ACTIVITY_TARGETS, CalibrationNote } from "../common/calibration";
import { ChartTile } from "../common/controls";
import { partRows } from "../common/score-parts";
import { TrendChart } from "../common/trend-chart";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function DayLabel({ day, isToday }: { day: Day; isToday: boolean }) {
  return <>{isToday ? "dnes" : formatDay(day.day)}</>;
}

export function ActivityTile({ day, isToday }: { day: Day; isToday: boolean }) {
  const score = day.scores?.activity ?? null;
  const value = scoreValue(score);
  const band = activityBand(value);
  const note = noteText(score?.note);
  const running = day.complete === false;
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow">
            Activity · <DayLabel day={day} isToday={isToday} />
          </h2>
          {running && <RunningHint />}
        </div>
        <VendorLine>Metóda podľa Oura</VendorLine>
      </div>
      <ScoreDial
        share={value === null ? 0 : value / 100}
        color="var(--accent)"
        value={formatScore(score)}
        band={band?.label ?? note ?? "zatiaľ bez skóre"}
        sub={running ? "zatiaľ · zo 100" : "zo 100"}
        label={value === null ? "Activity zatiaľ nie je" : `Activity ${formatInt(value)} zo 100, ${band?.label ?? ""}`}
      />
      <p className="text-[13px] text-ink2">
        Ako sa hýbeš počas dňa aj týždňa: denný cieľ, sedenie, tréningy a čas na oddych.
        {running && " Deň ešte beží, číslo sa môže zmeniť."}
      </p>
      <p className="text-[12px] text-muted">85 a viac optimálna · 70–84 dobrá · pod 70 pozor</p>
      {note && value !== null && <NoteLine>Poznámka: {note}</NoteLine>}
    </TileShell>
  );
}

export function ActivityPartsTile({ dataset, day }: { dataset: Dataset; day: Day }) {
  const week = zoneTotals(dataset.days, day.day, 7);
  const trainingDays = windowEnding(dataset.days, day.day, 7).filter((slot) => (slot.data?.workouts.length ?? 0) > 0).length;
  const facts: Record<string, string | null> = {
    stay_active: isNumber(day.active_minutes_est) ? `aktívny čas ${approx(formatDuration(day.active_minutes_est))}` : null,
    training_volume: week ? `7 dní: stredná ${formatDuration(week.moderate)}, vysoká ${formatDuration(week.vigorous)}` : null,
    training_frequency: `dni s tréningom za 7 dní: ${formatInt(trainingDays)}`,
  };
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Z čoho sa skladá</h2>
        <p className="text-[12px] text-muted">každá časť 0–100, váha podľa owi</p>
      </div>
      <PartsList rows={partRows(day.scores?.activity, ACTIVITY_PARTS)} color="var(--accent)" facts={facts} columns={2} />
    </TileShell>
  );
}

/** Strain of the day on WHOOP's 0-21 scale, with each workout's own strain. */
export function StrainTile({ dataset, day, isToday }: { dataset: Dataset; day: Day; isToday: boolean }) {
  const strain = day.scores?.strain ?? null;
  const band = strainBand(strain);
  const running = day.complete === false;
  const workouts = [...day.workouts].sort((a, b) => (a.start < b.start ? -1 : 1));
  const current = STRAIN_BANDS.find((item) => isNumber(strain) && strain >= item.from && (strain < item.to || item.to === STRAIN_MAX));
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow">
            Strain · <DayLabel day={day} isToday={isToday} />
          </h2>
          {running && <RunningHint />}
        </div>
        <VendorLine>Metóda podľa WHOOP</VendorLine>
      </div>
      <Ring
        share={strain === null ? 0 : strain / STRAIN_MAX}
        sweep={0.75}
        from={225}
        thickness={12}
        className="w-full max-w-[230px] self-center"
        label={strain === null ? "Strain zatiaľ nie je" : `Strain ${formatStrain(strain)} z 21, ${band?.label ?? ""}`}
      >
        <span className="figure text-[clamp(60px,6.5vw,84px)] leading-[0.9] tracking-[-0.05em]">{formatStrain(strain)}</span>
        <span className="mt-1.5 text-[14px] text-ink2">{band ? band.label : "zatiaľ bez dát"}</span>
        <span className="mono mt-1 text-[11px] text-muted">{running ? "zatiaľ · z 21" : "z 21"}</span>
      </Ring>
      <p className="text-[12px] text-muted">
        {STRAIN_BANDS.map((item, index) => (
          <span key={item.key} className={item === current ? "font-semibold text-ink" : undefined}>
            {index > 0 && " · "}
            {formatInt(item.from)}–{item.to === STRAIN_MAX ? "21" : formatDecimal(item.to - 0.1, 1)} {item.label}
          </span>
        ))}
      </p>
      <p className="text-[13px] text-ink2">
        Záťaž srdca a svalov za celý deň na stupnici 0–21. Hodina chôdze dá okolo 6,5, hodina behu okolo 12. Strainy sa
        nesčítavajú: čím vyšší, tým ťažšie sa pridáva.
      </p>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-[14px] font-semibold">Tréningy {isToday ? "dnes" : `· ${formatDay(day.day)}`}</h3>
        {workouts.length === 0 ? (
          <p className="text-[13px] text-ink2">Bez tréningu; strain je z pohybu počas dňa.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {workouts.map((workout) => (
              <li key={workout.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[14px] font-semibold">
                    {workoutLabel(workout.type)}
                    <span className="mono ml-2 text-[11px] font-normal text-muted">
                      {formatClock(workout.start, dataset.timezone)} · {formatDuration(workout.duration_s / 60)}
                    </span>
                  </span>
                  <span className="text-[17px] font-medium">{formatStrain(workout.strain ?? null)}</span>
                </div>
                <ScoreBar share={isNumber(workout.strain) ? workout.strain / STRAIN_MAX : null} color="var(--accent)" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </TileShell>
  );
}

export function StrainHistoryTile({ dataset, date, length = 30 }: { dataset: Dataset; date: string; length?: number }) {
  const router = useRouter();
  const slots = windowEnding(dataset.days, date, length);
  const points = dayPoints(slots, (day) => day.scores?.strain ?? null);
  const finished = points.filter((point) => !point.partial).map((point) => point.value);
  const mean = average(finished);
  return (
    <ChartTile
      label={`Strain · ${length} dní`}
      note={mean === null ? "Za toto obdobie bez strainu." : `Priemer ukončených dní ${formatStrain(mean)} · ${strainBand(mean)?.label ?? ""}`}
      table={{
        columns: ["Deň", "Strain", "Pásmo"],
        rows: points
          .filter((point) => point.value !== null)
          .map((point) => [point.title, `${formatStrain(point.value)}${point.partial ? " (zatiaľ)" : ""}`, strainBand(point.value)?.label ?? DASH])
          .reverse(),
      }}
    >
      <ColumnChart
        points={points}
        color="var(--accent)"
        ticks={[0, 7, 14, 21]}
        reference={mean === null ? null : { value: mean, label: `priemer ${formatStrain(mean)}` }}
        ariaLabel={`Strain za ${length} dní, priemer ${formatStrain(mean)}`}
        formatValue={(value) => formatStrain(value)}
        formatTick={tickPlain}
        onSelect={(key) => router.push(`/den/${key}`)}
        height={320}
      />
      <dl className="grid grid-cols-4 gap-3 border-t border-line pt-4">
        {STRAIN_BANDS.map((band) => {
          const count = finished.filter((value) => isNumber(value) && strainBand(value)?.key === band.key).length;
          return (
            <div key={band.key} className="flex min-w-0 flex-col gap-1">
              <dt className="text-[12px] text-ink2">{band.label}</dt>
              <dd className="figure-sm text-[22px]">{formatInt(count)}</dd>
              <dd className="text-[11px] text-muted">{plural(count, "deň", "dni", "dní")}</dd>
            </div>
          );
        })}
      </dl>
    </ChartTile>
  );
}

const CARDIO_FROM = 0.4;
const CARDIO_TO = 1.7;

/** Polar's cardio load status: the last 7 days against the last 28, with 12 weeks of trend. */
export function CardioTile({ dataset, day }: { dataset: Dataset; day: Day }) {
  const router = useRouter();
  const load = day.scores?.cardio_load ?? null;
  const ratio = isNumber(load?.ratio) ? (load?.ratio as number) : null;
  const trend = cardioTrend(dataset.days, day.day, 84);
  const weeks = cardioWeeks(trend);
  const at = (value: number) => ((Math.min(Math.max(value, CARDIO_FROM), CARDIO_TO) - CARDIO_FROM) / (CARDIO_TO - CARDIO_FROM)) * 100;
  const edges = [CARDIO_FROM, ...CARDIO_THRESHOLDS, CARDIO_TO];
  const ratios = trend.map((point) => point.ratio);
  const known = ratios.filter(isNumber);
  const top = Math.max(1.6, Math.ceil((Math.max(...known, 0) + 0.1) * 5) / 5);
  const bottom = Math.min(0.4, Math.floor((Math.min(...known, 1) - 0.1) * 5) / 5);
  const ticks: number[] = [];
  for (let value = bottom; value <= top + 1e-9; value += 0.4) ticks.push(Math.round(value * 10) / 10);
  const status = load?.status ?? null;

  return (
    <ChartTile
      label="Stav záťaže · 7 dní oproti 28"
      note={
        ratio === null
          ? "Stav záťaže potrebuje aspoň 4 odmerané dni zo 7, 14 z 28 a pár tréningov."
          : `${cardioStatusLabel(status)[0].toUpperCase()}${cardioStatusLabel(status).slice(1)}: ${cardioText(status) ?? ""}.`
      }
      table={{
        columns: ["Týždeň do", "Záťaž 7 dní", "Tolerancia 28 dní", "Pomer", "Stav"],
        rows: weeks.map((week) => [
          formatDay(week.day),
          formatInt(week.strain7),
          formatInt(week.tolerance28),
          formatDecimal(week.ratio, 2),
          cardioStatusLabel(week.status),
        ]),
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <Figure size="sm" label="Pomer" value={formatDecimal(ratio, 2)} note={cardioStatusLabel(status)} />
        <Figure size="sm" label="Záťaž 7 dní" value={formatInt(load?.strain_7d ?? null)} note="priemer za deň" />
        <Figure size="sm" label="Tolerancia 28 dní" value={formatInt(load?.tolerance_28d ?? null)} note="na čo si zvyknutý" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="relative pt-1.5">
          <div
            className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`Pásma pomeru: pod 0,8 pokles formy, 0,8 až 1,0 udržiavanie, 1,0 až 1,3 produktívna záťaž, nad 1,3 preťaženie${ratio === null ? "" : `; teraz ${formatDecimal(ratio, 2)}`}`}
          >
            {edges.slice(1).map((to, index) => (
              <div key={to} style={{ flex: `${to - edges[index]} 1 0`, background: mix("var(--accent)", 25 + index * 25) }} />
            ))}
          </div>
          {ratio !== null && (
            <div
              aria-hidden="true"
              className="absolute top-0 h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${at(ratio)}%`, boxShadow: "0 0 0 2px var(--surface)" }}
            />
          )}
        </div>
        <p className="text-[12px] text-muted">
          {CARDIO_BANDS.map((band, index) => (
            <span key={band.status} className={band.status === status ? "font-semibold text-ink" : undefined}>
              {index > 0 && " · "}
              {index === 0 ? "pod 0,8" : band.to === Infinity ? "nad 1,3" : `${formatDecimal(band.from, 1)}–${formatDecimal(band.to, 1)}`}{" "}
              {cardioStatusLabel(band.status)}
            </span>
          ))}
        </p>
      </div>
      <TrendChart
        keys={trend.map((point) => point.day)}
        labels={trend.map((point) => formatDayMonth(point.day))}
        titles={trend.map((point) => formatDay(point.day))}
        series={[{ label: "pomer", color: "var(--accent)", values: ratios }]}
        guides={CARDIO_THRESHOLDS.map((value) => ({ value }))}
        regions={[
          { from: bottom, to: 0.8, label: "pokles formy" },
          { from: 1.0, to: 1.3, label: "produktívna" },
          { from: 1.3, to: top, label: "preťaženie" },
        ]}
        ticks={ticks}
        formatValue={(value) => formatDecimal(value, 2)}
        formatTick={(value) => formatDecimal(value, 1)}
        notes={(index) => (trend[index].status ? cardioStatusLabel(trend[index].status) : undefined)}
        ariaLabel="Pomer záťaže 7 dní ku 28 dňom za 12 týždňov"
        onSelect={(key) => router.push(`/den/${key}`)}
        height={210}
      />
      <VendorLine>Metóda podľa Polar · Cardio Load</VendorLine>
    </ChartTile>
  );
}

/** Active time and calories; both are estimates from heart rate and steps. */
export function EstimatesTile({ dataset, day, isToday, length = 30 }: { dataset: Dataset; day: Day; isToday: boolean; length?: number }) {
  const router = useRouter();
  const byDay = indexByDay(dataset.days);
  const slots = windowEnding(dataset.days, day.day, length);
  const points = dayPoints(slots, (item) => item.active_minutes_est);
  const active = periodSummary(dataset.days, day.day, length, "active_minutes_est");
  const total = periodSummary(dataset.days, day.day, length, "total_kcal_est");
  const running = day.complete === false;
  return (
    <ChartTile
      label={`Aktívny čas a kalórie · ${length} dní`}
      note="Oba údaje sú odhad: Samsung Health ich počíta sám a neposiela ich, owi ich približuje z tepu, krokov a tréningov."
      table={{
        columns: ["Deň", "Aktívny čas", "Kalórie spolu", "Z aktivity"],
        rows: dateRange(addDays(day.day, -(length - 1)), day.day)
          .flatMap((key) => {
            const item = byDay.get(key);
            if (!item) return [];
            const partial = item.complete === false ? " (zatiaľ)" : "";
            return [
              [
                formatDay(key),
                `${approx(formatDuration(item.active_minutes_est))}${partial}`,
                `${approx(formatInt(item.total_kcal_est))}${partial}`,
                approx(formatInt(item.activity_kcal_est)),
              ],
            ];
          })
          .reverse(),
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[14px] text-ink2">{isToday ? "Dnes" : formatDay(day.day)}</span>
        {running && <RunningHint />}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Aktívny čas" value={approx(formatDuration(day.active_minutes_est))} note={`bežne ${approx(formatDuration(active.average))}`} />
        <Figure label="Kalórie spolu" value={approx(formatInt(day.total_kcal_est))} unit="kcal" note={`bežne ${approx(formatInt(total.average))}`} />
        <Figure label="Z aktivity" value={approx(formatInt(day.activity_kcal_est))} unit="kcal" />
        <Figure label="Bazálny výdaj" value={formatInt(day.basal_kcal)} unit="kcal" note={running ? "zatiaľ za časť dňa" : "za celý deň"} />
      </div>
      <CalibrationNote calibration={dataset.calibration} targets={ACTIVITY_TARGETS} />
      <ColumnChart
        points={points}
        color="var(--accent)"
        ticks={durationTicks(Math.max(60, ...points.map((point) => point.value ?? 0)))}
        reference={active.average === null ? null : { value: active.average, label: `priemer ${approx(formatDuration(active.average))}` }}
        ariaLabel={`Aktívny čas za ${length} dní, priemer približne ${formatDuration(active.average)}`}
        formatValue={(value) => approx(formatDuration(value))}
        formatTick={tickDuration}
        onSelect={(key) => router.push(`/den/${key}`)}
        height={200}
      />
    </ChartTile>
  );
}
