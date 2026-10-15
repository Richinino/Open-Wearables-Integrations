import Link from "next/link";
import { ROUTES } from "@/components/shell/nav";
import { Ring, ScoreBar, TileShell, TileTitle } from "@/components/ui/tile";
import { addDays } from "@/lib/dates";
import { DASH, formatDay, formatDecimal, formatDuration, formatInt, formatTimeOfDay } from "@/lib/format";
import {
  bedtimeFor,
  cardioStatusLabel,
  dayScoreLabel,
  formatStrain,
  SCORE_NAMES,
  strainBand,
  subScores,
  typicalWake,
  type SubScore,
} from "@/lib/scores";
import type { Dataset, Day } from "@/lib/types";

const SUB_HREF: Record<SubScore["key"], string> = {
  readiness: ROUTES.readiness,
  sleepPerformance: ROUTES.sleep,
  activity: ROUTES.activity,
};

const SUB_COLOR: Record<SubScore["key"], string> = {
  readiness: "var(--heart)",
  sleepPerformance: "var(--sleep)",
  activity: "var(--accent)",
};

/** One labelled row under the ring: name and value, a 4px bar, one line of why. */
function ScoreRow({
  href,
  label,
  value,
  share,
  color,
  reason,
  textValue = false,
}: {
  href: string;
  label: string;
  value: string;
  share: number | null;
  color: string;
  reason: string;
  /** Words rather than a number: smaller, so long labels fit. */
  textValue?: boolean;
}) {
  return (
    <Link href={href} className="tile-raise row-link flex flex-col gap-2">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[14px] text-ink2">{label}</span>
        <span className={textValue ? "text-[15px] font-semibold" : "text-[20px] font-medium"}>{value}</span>
      </span>
      <ScoreBar share={share} color={color} />
      <span className="text-[12px] text-muted">{reason}</span>
    </Link>
  );
}

const RING_CLASS = "w-full max-w-[260px] self-center";

/** Morning: the day score ring with Readiness, Sleep Performance and Activity under it. */
export function DayScoreTile({
  day,
  previous,
  date,
  isToday,
}: {
  day: Day | null;
  previous: Day | null;
  date: string;
  isToday: boolean;
}) {
  const value = day?.scores?.day_score ?? null;
  const parts = day ? subScores(day, previous) : [];
  return (
    <TileShell className="gap-6 p-6 sm:p-[30px]">
      <TileTitle href={ROUTES.day(date)}>{isToday ? SCORE_NAMES.day : `${SCORE_NAMES.day} · ${formatDay(date)}`}</TileTitle>
      <Ring
        share={value === null ? 0 : value / 100}
        sweep={0.75}
        from={225}
        thickness={12}
        className={RING_CLASS}
        label={value === null ? "Skóre dňa zatiaľ nie je" : `Skóre dňa ${formatInt(value)} zo 100`}
      >
        <span className="figure text-[clamp(76px,8vw,104px)] leading-[0.9] tracking-[-0.05em]">{formatInt(value)}</span>
        <span className="mt-1.5 text-[14px] text-ink2">{dayScoreLabel(value)}</span>
      </Ring>
      <div className="flex flex-col gap-4">
        {parts.map((part) => (
          <ScoreRow
            key={part.key}
            href={SUB_HREF[part.key]}
            label={part.label}
            value={part.display}
            share={part.value === null ? 0 : part.value / 100}
            color={SUB_COLOR[part.key]}
            reason={part.band ? `${part.band.label} · ${part.reason}` : part.reason}
          />
        ))}
        {parts.length === 0 && <p className="text-[13px] text-muted">Pre tento deň nie sú dáta.</p>}
      </div>
    </TileShell>
  );
}

/** Evening: the strain of the day up front, then the sleep need for tonight. */
export function EveningTile({
  dataset,
  day,
  date,
  isToday,
}: {
  dataset: Dataset;
  day: Day | null;
  date: string;
  isToday: boolean;
}) {
  const scores = day?.scores ?? null;
  const strain = scores?.strain ?? null;
  const band = strainBand(strain);
  const need = scores?.sleep_need_minutes ?? null;
  const wake = typicalWake(dataset.days, dataset.timezone, addDays(date, 1));
  const bedtime = bedtimeFor(need, wake);
  const load = scores?.cardio_load ?? null;
  const parts = day ? subScores(day, null) : [];

  return (
    <TileShell className="gap-6 p-6 sm:p-[30px]">
      <TileTitle href={ROUTES.activity}>{isToday ? "Strain dňa" : `Strain · ${formatDay(date)}`}</TileTitle>
      <Ring
        share={strain === null ? 0 : strain / 21}
        sweep={0.75}
        from={225}
        thickness={12}
        className={RING_CLASS}
        label={strain === null ? "Strain zatiaľ nie je" : `Strain ${formatStrain(strain)} z 21`}
      >
        <span className="figure text-[clamp(64px,7vw,92px)] leading-[0.9] tracking-[-0.05em]">{formatStrain(strain)}</span>
        <span className="mt-1.5 text-[14px] text-ink2">{band ? band.label : "zatiaľ bez dát"}</span>
        <span className="mono mt-1 text-[11px] text-muted">z 21</span>
      </Ring>
      <div className="flex flex-col gap-4">
        <ScoreRow
          href={ROUTES.sleep}
          label="Potreba spánku na dnešnú noc"
          value={formatDuration(need)}
          share={need === null ? 0 : need / 600}
          color="var(--sleep)"
          reason={
            bedtime !== null && wake !== null
              ? `zaspi okolo ${formatTimeOfDay(bedtime)}, ak vstávaš ${formatTimeOfDay(wake)}`
              : "podľa dnešnej záťaže a minulej noci"
          }
        />
        <ScoreRow
          href={ROUTES.activity}
          label="Stav záťaže · 7 dní"
          value={cardioStatusLabel(load?.status)}
          textValue
          share={load?.ratio == null ? 0 : load.ratio / 1.6}
          color="var(--accent)"
          reason={load?.ratio == null ? "potrebuje aspoň pár týždňov dát" : `7 dní oproti 4 týždňom: ${formatDecimal(load.ratio, 2)}`}
        />
        <ScoreRow
          href={ROUTES.day(date)}
          label={SCORE_NAMES.day}
          value={formatInt(scores?.day_score ?? null)}
          share={scores?.day_score == null ? 0 : scores.day_score / 100}
          color="var(--heart)"
          reason={parts.length ? parts.map((part) => `${part.label} ${part.display}`).join(" · ") : DASH}
        />
      </div>
    </TileShell>
  );
}

