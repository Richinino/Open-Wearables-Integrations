import Link from "next/link";
import { ROUTES } from "@/components/shell/nav";
import type { Insight } from "@/lib/overview";
import type { NightAlert } from "@/lib/scores";
import { InsightDeck } from "./insight-deck";

/** The yellow or red night-signal warning, on its own, above everything else. */
export function NightBanner({ alert }: { alert: NightAlert }) {
  const color = alert.level === "red" ? "var(--bad)" : "var(--warn)";
  return (
    <section
      aria-labelledby="night-alert-title"
      className="glass ns-in flex flex-wrap items-start gap-x-4 gap-y-3 p-5 sm:flex-nowrap sm:p-6"
      style={{
        borderRadius: 24,
        borderColor: `color-mix(in oklab, ${color} 65%, transparent)`,
        background: `color-mix(in oklab, ${color} 10%, var(--glass))`,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 16 16" className="mt-0.5 shrink-0" aria-hidden="true">
        <path d="M8 1.5 15 14H1L8 1.5Z" fill={color} />
        <path d="M8 6v4m0 2v.5" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <div className="min-w-0 flex-1 basis-[240px]">
        <p className="eyebrow">Nočný tep · {alert.level === "red" ? "červená" : "žltá"}</p>
        <h2 id="night-alert-title" className="mt-1.5 text-[18px] leading-snug font-semibold tracking-[-0.01em]">
          {alert.title}
        </h2>
        <p className="mt-1.5 max-w-[75ch] text-[14px] text-ink2">{alert.text}</p>
      </div>
      <Link href={ROUTES.readiness} className="pill pill-outline shrink-0">
        Podrobnosti
      </Link>
    </section>
  );
}

/** "Ranný / Večerný súhrn · čo si všimnúť": one sentence and a few observations. */
export function SummaryTile({
  morning,
  sentence,
  insights,
}: {
  morning: boolean;
  sentence: string;
  insights: Insight[];
}) {
  return (
    <section className="glass flex flex-wrap gap-x-10 gap-y-6 p-6 sm:p-[30px]" aria-labelledby="summary-title">
      <Link
        href={morning ? ROUTES.readiness : ROUTES.activity}
        className="row-link flex min-w-0 flex-[1_1_300px] flex-col gap-3.5 !p-2"
      >
        <span id="summary-title" className="eyebrow">
          {morning ? "Ranný súhrn" : "Večerný súhrn"} · čo si všimnúť
        </span>
        <span className="text-[clamp(22px,2.4vw,30px)] leading-[1.2] font-normal tracking-[-0.02em] text-pretty">{sentence}</span>
        <span className="mt-auto text-[12px] text-muted">Z dát za posledné 4 týždne · pozorovania, nie zdravotné rady</span>
      </Link>
      <InsightDeck insights={insights} />
    </section>
  );
}
