"use client";

import Link from "next/link";
import { useMemo } from "react";
import { capitalize, Chip, riseStyle, RoundNav } from "@/components/detail/shared-b/parts";
import { ROUTES } from "@/components/shell/nav";
import { WithData } from "@/components/shell/shell";
import { EmptyState } from "@/components/ui/parts";
import { Arrow, PageHead } from "@/components/ui/tile";
import { addDays, isValidDay, todayIn } from "@/lib/dates";
import { formatDay, formatDayLong } from "@/lib/format";
import { indexByDay } from "@/lib/metrics";
import type { Dataset } from "@/lib/types";
import { ActivityTile, DayScoreTile, DayWorkoutsTile, HeartTile, SleepTile, StrainTile } from "./day-tiles";

function Head({ date, today, previous, next, chip }: { date: string; today: string; previous: string | null; next: string | null; chip?: React.ReactNode }) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        <p className="eyebrow">
          <Link href={`${ROUTES.calendar}?den=${date}`} className="no-underline hover:text-ink">
            Kalendár
          </Link>{" "}
          / {date === today ? "Dnes" : "Deň"}
        </p>
        <h1 className="figure mt-3 text-[clamp(36px,5vw,64px)] leading-[1.02]">{capitalize(formatDayLong(date))}</h1>
        {chip && <div className="mt-3">{chip}</div>}
      </div>
      <nav aria-label="Iné dni" className="flex shrink-0 gap-2">
        <RoundNav label={previous ? `Predošlý deň, ${formatDay(previous)}` : "Predošlý deň"} href={previous && ROUTES.day(previous)}>
          ←
        </RoundNav>
        <RoundNav label={next ? `Nasledujúci deň, ${formatDay(next)}` : "Nasledujúci deň"} href={next && ROUTES.day(next)}>
          →
        </RoundNav>
      </nav>
    </div>
  );
}

function DayDetail({ dataset, now, date }: { dataset: Dataset; now: Date; date: string }) {
  const byDay = useMemo(() => indexByDay(dataset.days), [dataset.days]);
  const tz = dataset.timezone;
  const today = todayIn(tz, now);
  const day = byDay.get(date) ?? null;
  const previousDay = byDay.get(addDays(date, -1)) ?? null;
  const first = dataset.first_day ?? date;
  // Days run from the first stored day to today; from outside that span the arrows lead back in.
  const previous = date > today ? today : date > first ? addDays(date, -1) : null;
  const next = date < first ? first : date < today ? addDays(date, 1) : null;

  if (!day) {
    const future = date > today;
    const before = date < first;
    return (
      <>
        <Head date={date} today={today} previous={previous} next={next} />
        <EmptyState title={future ? "Tento deň ešte nenastal" : "Pre tento deň nie sú dáta"}>
          {future
            ? "Dáta sa objavia, keď deň príde a hodinky sa zosynchronizujú."
            : before
              ? "Záznamy začínajú neskôr. Skús prvý deň s dátami."
              : "Hodinky ani telefón za tento deň nič neposlali, alebo ešte neprebehla synchronizácia."}
        </EmptyState>
        <Link href={future ? ROUTES.day(today) : before ? ROUTES.day(first) : ROUTES.calendar} className="pill pill-outline title-link self-start">
          {future ? "Na dnešok" : before ? "Na prvý deň s dátami" : "Do kalendára"} <Arrow />
        </Link>
      </>
    );
  }

  const running = day.complete === false;
  const noScores = !day.scores;
  return (
    <>
      <Head
        date={date}
        today={today}
        previous={previous}
        next={next}
        chip={
          running || noScores ? (
            <span className="flex flex-wrap gap-2">
              {running && <Chip>deň ešte beží · hodnoty budú rásť</Chip>}
              {noScores && <Chip>skóre za tento deň zatiaľ nie sú spočítané</Chip>}
            </span>
          ) : undefined
        }
      />
      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)]">
        <div className="rise flex min-w-0 flex-col" style={riseStyle(1)}>
          <DayScoreTile day={day} previous={previousDay} />
        </div>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="rise flex min-w-0 flex-col" style={riseStyle(2)}>
            <SleepTile day={day} previous={previousDay} timeZone={tz} />
          </div>
          <div className="rise flex min-w-0 flex-auto flex-col" style={riseStyle(3)}>
            <StrainTile day={day} />
          </div>
        </div>
      </div>
      <div className="grid gap-[18px] md:grid-cols-2">
        <div className="rise flex min-w-0 flex-col" style={riseStyle(4)}>
          <ActivityTile day={day} />
        </div>
        <div className="rise flex min-w-0 flex-col" style={riseStyle(5)}>
          <HeartTile day={day} />
        </div>
      </div>
      <div className="rise" style={riseStyle(6)}>
        <DayWorkoutsTile day={day} timeZone={tz} />
      </div>
    </>
  );
}

export function DayView({ date }: { date: string }) {
  if (!isValidDay(date)) {
    return (
      <>
        <PageHead eyebrow="Deň" title="Neplatný dátum">
          Adresa dňa má tvar /den/2026-07-15.
        </PageHead>
        <Link href={ROUTES.calendar} className="pill pill-outline title-link self-start">
          Do kalendára <Arrow />
        </Link>
      </>
    );
  }
  return <WithData>{(dataset, now) => <DayDetail dataset={dataset} now={now} date={date} />}</WithData>;
}
