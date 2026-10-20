"use client";

import Link from "next/link";
import { LineChart } from "@/components/charts/charts";
import { tickPlain } from "@/components/charts/points";
import { riseStyle, Swatch, VENDOR, VendorLine } from "@/components/detail/shared-b/parts";
import { ROUTES } from "@/components/shell/nav";
import { WithData } from "@/components/shell/shell";
import { PageHead, TileShell } from "@/components/ui/tile";
import {
  bodyAge,
  latestValue,
  longRecords,
  seriesChange,
  vo2maxLevel,
  vo2maxWeeks,
  weeklyMeans,
  type AgeContribution,
  type LongRecord,
} from "@/lib/detail-longterm";
import { todayIn } from "@/lib/dates";
import { approx, DASH, formatDay, formatDayMonth, formatDecimal, formatDistance, formatDuration, formatInt, plural, workoutLabel } from "@/lib/format";
import { formatStrain, SCORE_NAMES } from "@/lib/scores";
import type { Dataset } from "@/lib/types";
import { UTH_COLOR, Vo2Chart, WATCH_COLOR } from "./vo2-chart";

const TILE = "flex-auto gap-5 p-6 sm:p-[30px]";

function years(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  const word = Number.isInteger(rounded) ? plural(rounded, "rok", "roky", "rokov") : "roka";
  return `${formatDecimal(rounded, Number.isInteger(rounded) ? 0 : 1)} ${word}`;
}

function signedYears(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0 r.";
  return `${rounded > 0 ? "+" : "−"}${formatDecimal(Math.abs(rounded), 1)} r.`;
}

// ---------------------------------------------------------------------------------------

function Vo2Tile({ dataset, today }: { dataset: Dataset; today: string }) {
  const weeks = vo2maxWeeks(dataset.days, today);
  const watch = latestValue(dataset.days, today, (day) => day.scores?.vo2max);
  const uth = latestValue(dataset.days, today, (day) => day.scores?.vo2max_uth);
  const level = vo2maxLevel(watch?.value ?? uth?.value);
  const change = seriesChange(weeks.map((week) => week.watch));

  return (
    <TileShell className={TILE}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">VO2max · kondícia</h2>
        <span className="text-[13px] text-ink2">ml kyslíka na kg za minútu</span>
      </div>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <div className="flex items-baseline gap-2.5">
            <span className="figure text-[clamp(64px,7vw,88px)] leading-[0.9]">{watch ? formatDecimal(watch.value, 1) : DASH}</span>
            <span className="text-[14px] text-ink2">{level ?? "zatiaľ bez merania"}</span>
          </div>
          <div className="mt-2">
            <Swatch shape="line" color={WATCH_COLOR} label={watch ? `z hodiniek · ${formatDay(watch.day)}` : "z hodiniek"} />
          </div>
        </div>
        <div>
          <div className="figure-sm text-[34px]">{uth ? approx(formatDecimal(uth.value, 1)) : DASH}</div>
          <div className="mt-2">
            <Swatch shape="line" color={UTH_COLOR} label="odhad z tepu" />
          </div>
        </div>
        {change !== null && Math.abs(change) >= 0.3 && (
          <div className="text-[13px] text-ink2">
            {change > 0 ? "↑" : "↓"} o {formatDecimal(Math.abs(change), 1)} za {weeks.length} týždňov
          </div>
        )}
      </div>
      {weeks.length > 1 ? <Vo2Chart weeks={weeks} /> : <p className="text-[14px] text-ink2">Na graf je zatiaľ málo týždňov s VO2max.</p>}
      <div className="grid gap-4 border-t border-line pt-4 text-[14px] leading-relaxed text-ink2 md:grid-cols-2">
        <p>
          <strong className="font-semibold text-ink">Čo to je:</strong> najviac kyslíka, ktoré telo dokáže spracovať pri maximálnej námahe, na
          kilogram váhy za minútu. Čím vyššie, tým lepšia vytrvalostná kondícia; patrí k najsilnejším ukazovateľom dlhovekosti.
        </p>
        <p>
          Hodnota sa posudzuje podľa veku, pohlavia a spôsobu merania. Zariadenie ju môže
          odhadovať z behu a tepu; odhad z tepu je vzorec Uth–Sørensen (15,3 × max. tep ÷ pokojový tep), slúži len na kontrolu.
        </p>
      </div>
      <VendorLine>hodinky: Samsung · odhad: {VENDOR.vo2Uth} · týždenné priemery</VendorLine>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

function ContributionRow({ item, widest }: { item: AgeContribution; widest: number }) {
  const width = widest > 0 ? (Math.abs(item.raw) / widest) * 100 : 0;
  const younger = item.raw < 0;
  const bar = (
    <div className="h-2.5 rounded-[3px]" style={{ width: `${Math.max(width, 2)}%`, background: younger ? "var(--good)" : "var(--heart)" }} />
  );
  return (
    <li className="grid grid-cols-[minmax(84px,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_52px] items-center gap-x-2 text-[13px] sm:grid-cols-[minmax(120px,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_60px]">
      <span className="leading-tight text-ink2">{item.label}</span>
      <div className="flex justify-end border-r border-line-strong pr-1">{younger && bar}</div>
      <div className="flex pl-1">{!younger && bar}</div>
      <span className="tabular text-right font-semibold">{signedYears(item.years)}</span>
    </li>
  );
}

function BodyAgeTile({ dataset, today }: { dataset: Dataset; today: string }) {
  // The latest day with a body age; without one, the latest with its parts and the reason.
  const scored = [...dataset.days].reverse().filter((item) => item.day <= today && item.scores?.whoop_age);
  const day = scored.find((item) => item.scores?.whoop_age.value != null) ?? scored[0];
  const age = bodyAge(day?.scores?.whoop_age);
  const value = age?.value ?? null;
  const widest = Math.max(...(age?.contributions ?? []).map((item) => Math.abs(item.raw)), 0);
  const younger = (age?.contributions ?? []).filter((item) => item.raw < 0);
  const older = (age?.contributions ?? []).filter((item) => item.raw > 0).reverse();
  const zero = (age?.contributions ?? []).filter((item) => item.raw === 0);

  return (
    <TileShell className={TILE}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">{SCORE_NAMES.whoopAge}</h2>
        <span className="mono rounded-full border border-line px-2.5 py-[3px] text-[11px] tracking-[0.04em] text-ink2">odhad</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="figure text-[clamp(64px,7vw,88px)] leading-[0.9]">{value === null ? DASH : approx(formatDecimal(value, 1))}</span>
        <span className="text-[15px] text-ink2">
          {value === null
            ? (age?.note ?? "zatiaľ sa nedá spočítať")
            : age?.difference == null
              ? "rokov"
              : Math.abs(age.difference) < 0.05
                ? `rokov · rovnako ako skutočný vek ${age.realAge}`
                : `rokov · o ${years(age.difference)} ${age.difference < 0 ? "mladší" : "starší"} než skutočný vek ${age.realAge}`}
        </span>
      </div>
      {age && age.contributions.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="mono grid grid-cols-[minmax(84px,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_52px] gap-x-2 text-[10.5px] tracking-[0.08em] text-muted uppercase sm:grid-cols-[minmax(120px,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_60px]" aria-hidden="true">
            <span>Návyk</span>
            <span className="pr-1 text-right">← mladší</span>
            <span className="pl-1">starší →</span>
            <span className="text-right">rokov</span>
          </div>
          <ul className="flex flex-col gap-2" aria-label="Čo ťa robí mladším a starším">
            {[...younger, ...zero, ...older].map((item) => (
              <ContributionRow key={item.key} item={item} widest={widest} />
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-line pt-4 text-[13px] leading-relaxed text-ink2">
        {younger.length > 0 && (
          <p>
            <span className="font-semibold text-good-ink">Omladzuje ťa:</span> {younger.slice(0, 3).map((item) => item.label).join(", ")}.
          </p>
        )}
        {older.length > 0 && (
          <p>
            <span className="font-semibold text-ink">Pridáva roky:</span> {older.slice(0, 3).map((item) => item.label).join(", ")}.
          </p>
        )}
        {age && age.missing.length > 0 && <p className="text-muted">Bez dát: {age.missing.join(", ")}.</p>}
        <p className="text-[12px] text-muted">
          Každý návyk za posledných 6 mesiacov má vlastný dopad v rokoch.
          {age && age.factor < 1
            ? ` Návyky sa prekrývajú, preto sa ich súčet zmenšuje (× ${formatDecimal(age.factor, 2)}); čísla pri riadkoch sú už po tejto úprave.`
            : " Čísla pri riadkoch sa sčítajú na rozdiel oproti veku."}{" "}
          Dĺžka pruhu ukazuje, ako veľmi ktorý návyk váži.
        </p>
      </div>
      <VendorLine>{VENDOR.whoopAge} · Healthspan white paper · 9 návykov</VendorLine>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

function RestingTile({ dataset, today }: { dataset: Dataset; today: string }) {
  const weeks = weeklyMeans(dataset.days, today, (day) => day.hr_resting);
  const change = seriesChange(weeks.map((week) => week.value));
  const last = [...weeks].reverse().find((week) => week.value !== null);
  const note =
    change === null
      ? "Na porovnanie je zatiaľ málo týždňov."
      : Math.round(change) === 0
        ? `Za ${weeks.length} týždňov je stabilný.`
        : `Za ${weeks.length} týždňov ${change < 0 ? "klesol" : "stúpol"} o ${formatInt(Math.abs(change))} bpm${change < 0 ? ", čo často sprevádza lepšiu kondíciu" : ""}.`;
  return (
    <TileShell className={TILE}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Pokojový tep · dlhodobo</h2>
        <span className="text-[13px] text-ink2">týždenný priemer</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="figure text-[clamp(56px,6vw,72px)] leading-[0.9]">{last ? formatInt(last.value) : DASH}</span>
        <span className="text-[14px] text-ink2">bpm · {note}</span>
      </div>
      {weeks.length > 1 ? (
        <LineChart
          points={weeks.map((week) => ({
            key: week.week,
            label: formatDayMonth(week.week),
            title: `Týždeň od ${formatDayMonth(week.week)}`,
            value: week.value === null ? null : Math.round(week.value * 10) / 10,
          }))}
          color="var(--heart)"
          formatTick={tickPlain}
          formatValue={(value) => `${formatDecimal(value, 1)} bpm`}
          ariaLabel={`Pokojový tep po týždňoch. ${note}`}
          height={200}
        />
      ) : (
        <p className="text-[14px] text-ink2">Na graf je zatiaľ málo týždňov.</p>
      )}
      <p className="text-[12px] text-muted">Nižší pokojový tep zvyčajne znamená lepšiu kondíciu; krátkodobo ho zvyšuje choroba, stres a málo spánku.</p>
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

function recordText(item: LongRecord): { value: string; note: string } {
  const type = item.type ? workoutLabel(item.type).toLowerCase() : "";
  switch (item.key) {
    case "steps":
      return { value: formatInt(item.value), note: "najviac krokov za deň" };
    case "sleep":
      return { value: formatDuration(item.value), note: "najdlhší spánok" };
    case "resting":
      return { value: `${formatInt(item.value)} bpm`, note: "najnižší pokojový tep" };
    case "workout":
      return { value: formatDuration(item.value / 60), note: `najdlhší tréning · ${type}` };
    case "dayScore":
      return { value: formatInt(item.value), note: "najlepšie skóre dňa" };
    case "strain":
      return { value: formatStrain(item.value), note: "najvyšší strain dňa" };
    case "workoutStrain":
      return { value: formatStrain(item.value), note: `najnáročnejší tréning · ${type}` };
    case "distance":
      return { value: formatDistance(item.value), note: `najdlhšia trasa · ${type}` };
    case "active":
      return { value: approx(formatDuration(item.value)), note: "najviac aktívneho času" };
    case "vo2max":
      return { value: formatDecimal(item.value, 1), note: "najvyššie VO2max" };
  }
}

function RecordsTile({ dataset, today }: { dataset: Dataset; today: string }) {
  const items = longRecords(dataset.days, today);
  return (
    <TileShell className="flex-auto gap-4 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Rekordy · 90 dní</h2>
        <span className="text-[13px] text-ink2">klikni na deň</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[14px] text-ink2">Zatiaľ bez rekordov.</p>
      ) : (
        <ul className="grid flex-auto grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
          {items.map((item) => {
            const text = recordText(item);
            return (
              <li key={item.key} className="flex">
                <Link
                  href={ROUTES.day(item.day)}
                  className="flex w-full flex-col gap-1 rounded-[20px] border border-line p-4 no-underline transition-colors hover:bg-sunk"
                >
                  <span className="figure-sm text-[24px] leading-[1.1] sm:text-[26px]">{text.value}</span>
                  <span className="text-[12px] text-ink2">{text.note}</span>
                  <span className="mono mt-auto pt-1 text-[11px] text-muted">{formatDay(item.day)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </TileShell>
  );
}

// ---------------------------------------------------------------------------------------

function LongTerm({ dataset, now }: { dataset: Dataset; now: Date }) {
  const today = todayIn(dataset.timezone, now);
  return (
    <>
      <PageHead eyebrow="Dlhodobé" title="Dlhodobé">
        Ukazovatele, ktoré sa menia pomaly: kondícia, vek tela, pokojový tep a rekordy.
      </PageHead>
      <div className="rise" style={riseStyle(1)}>
        <Vo2Tile dataset={dataset} today={today} />
      </div>
      <div className="grid gap-[18px] lg:grid-cols-2">
        <div className="rise flex min-w-0 flex-col" style={riseStyle(2)}>
          <BodyAgeTile dataset={dataset} today={today} />
        </div>
        <div className="rise flex min-w-0 flex-col" style={riseStyle(3)}>
          <RecordsTile dataset={dataset} today={today} />
        </div>
      </div>
      <div className="rise" style={riseStyle(4)}>
        <RestingTile dataset={dataset} today={today} />
      </div>
    </>
  );
}

export function LongTermView() {
  return <WithData>{(dataset, now) => <LongTerm dataset={dataset} now={now} />}</WithData>;
}
