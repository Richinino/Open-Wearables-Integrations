import Link from "next/link";
import { Arrow, PageHead } from "@/components/ui/tile";

/**
 * Stand-in for a detail page that is still being built: says so plainly, lists what will be
 * there and leads back. Replace the whole page when the detail is ready.
 */
export function DetailPlaceholder({
  eyebrow,
  title,
  intro,
  coming,
  source,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  coming: string[];
  /** Where the numbers come from; named in detail views only, not on the overview cards. */
  source?: string;
}) {
  return (
    <>
      <PageHead eyebrow={eyebrow} title={title}>
        {intro}
      </PageHead>
      <section className="glass rise flex max-w-[760px] flex-col gap-5 p-6 sm:p-[30px]" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Podrobný pohľad sa pripravuje</h2>
        </div>
        <ul className="flex flex-col">
          {coming.map((item) => (
            <li key={item} className="border-t border-line py-3 text-[15px] text-ink2">
              {item}
            </li>
          ))}
        </ul>
        {source && <p className="mono text-[11px] tracking-[0.04em] text-muted uppercase">Zdroj výpočtu: {source}</p>}
        <Link href="/" className="pill pill-outline self-start">
          Späť na prehľad <Arrow />
        </Link>
      </section>
    </>
  );
}
