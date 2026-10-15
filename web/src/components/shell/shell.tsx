"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { logout } from "@/app/login/actions";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { EmptyState } from "@/components/ui/parts";
import { todayIn } from "@/lib/dates";
import { formatDayLong, formatRelative } from "@/lib/format";
import { isStale } from "@/lib/metrics";
import type { Dataset } from "@/lib/types";
import { useDataset } from "@/lib/use-dataset";
import { DETAIL_NAV, isActive, PRIMARY_NAV, ROUTES, TILE_ONLY_NAV } from "./nav";

/** Current time, refreshed every minute so relative labels and the day mode stay honest. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Half gold, half violet: the day and the night, the two subjects of the site. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 rounded-full"
      style={{ width: size, height: size, background: "linear-gradient(90deg, var(--accent) 50%, var(--sleep) 50%)" }}
    />
  );
}

/** The two soft background glows of the artboards; the calendar mirrors them. */
export function Glows({ mirrored = false }: { mirrored?: boolean }) {
  const blob = (color: string, size: number, place: React.CSSProperties) => (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(closest-side, color-mix(in oklab, ${color} 60%, transparent), transparent)`,
        opacity: "var(--glow)",
        ...place,
      }}
    />
  );
  return mirrored ? (
    <>
      {blob("var(--sleep)", 900, { right: -300, top: -420 })}
      {blob("var(--accent)", 900, { left: -320, top: 520 })}
    </>
  ) : (
    <>
      {blob("var(--accent)", 900, { left: -260, top: -380 })}
      {blob("var(--sleep)", 1000, { right: -340, top: 420 })}
    </>
  );
}

/** Closes a popup on a press outside `ref`, and on Escape with focus back on `trigger`. */
function useDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
  trigger?: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      trigger?.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref, trigger]);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined }}>
      <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const POPUP = "glass absolute z-40 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.28)]";
const POPUP_STYLE: React.CSSProperties = {
  borderRadius: 22,
  background: "color-mix(in oklab, var(--surface) 94%, transparent)",
};

/** "Detaily" in the header: the detail pages in a small menu. */
function DetailMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = [...DETAIL_NAV, ...TILE_ONLY_NAV].find((item) => isActive(pathname, item.href));
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, button);

  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="pill"
        style={current ? { background: "var(--ink)", color: "var(--bg)" } : undefined}
      >
        {current ? current.label : "Detaily"}
        <Chevron open={open} />
      </button>
      {open && (
        <div id={id} className={`${POPUP} top-[52px] left-0 w-[290px]`} style={POPUP_STYLE}>
          <ul>
            {DETAIL_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="row-link !m-0 flex flex-col !px-3.5 !py-2.5 aria-[current=page]:bg-track"
                >
                  <span className="text-[15px] font-semibold">{item.label}</span>
                  <span className="text-[12px] text-ink2">{item.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SyncStatus({ dataset, now }: { dataset: Dataset; now: Date }) {
  const stale = isStale(dataset.synced_at, now);
  return (
    <div
      className="flex items-center gap-2"
      title={stale ? "Zdroj dát sa dlhšie neozval" : "Dáta sa obnovujú každých pár minút"}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: stale ? "var(--warn)" : "var(--good)" }} />
      <span>
        {stale ? "offline · " : <span className="sr-only">Aktualizované </span>}
        {formatRelative(dataset.synced_at, now)}
      </span>
    </div>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TAB_ICONS: Record<string, string> = {
  [ROUTES.overview]: "M4 19V10m5.3 9V5m5.4 14v-6M20 19V8",
  [ROUTES.calendar]: "M4 9h16M8 3v4m8-4v4M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z",
  [ROUTES.sleep]: "M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7Z",
  [ROUTES.workouts]: "M3 12h4l2.5-6 4 12 2.5-6h5",
};

const TABS = [PRIMARY_NAV[0], PRIMARY_NAV[1], DETAIL_NAV[0], DETAIL_NAV[3]];

/** Phone navigation: four tabs and "Viac" with the rest and the logout. */
function TabBar({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, more);
  const extra = [...DETAIL_NAV.filter((item) => !TABS.includes(item)), ...TILE_ONLY_NAV];
  const moreActive = extra.some((item) => isActive(pathname, item.href));

  const tab = (active: boolean) =>
    `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? "text-ink" : "text-ink2"}`;
  const icon = (path: string, active: boolean) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );

  return (
    <nav
      ref={ref}
      aria-label="Hlavná navigácia"
      className="fixed inset-x-3 bottom-3 z-30 sm:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {open && (
        <div id={id} className={`${POPUP} right-0 bottom-[70px] left-0`} style={POPUP_STYLE}>
          <ul className="grid grid-cols-2 gap-1">
            {extra.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  className="row-link !m-0 flex min-h-11 items-center !px-3.5 text-[15px] font-semibold aria-[current=page]:bg-track"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <form action={logout}>
                <button type="submit" className="row-link !m-0 flex min-h-11 w-full items-center !px-3.5 text-left text-[15px] font-semibold text-ink2">
                  Odhlásiť
                </button>
              </form>
            </li>
          </ul>
        </div>
      )}
      <div className="glass flex px-1" style={{ borderRadius: 24, background: "color-mix(in oklab, var(--surface) 88%, transparent)" }}>
        {TABS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={tab(active)}>
              {icon(TAB_ICONS[item.href], active)}
              {item.label}
            </Link>
          );
        })}
        <button
          ref={more}
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className={tab(moreActive || open)}
        >
          {icon("M5 12h.01M12 12h.01M19 12h.01", moreActive || open)}
          Viac
        </button>
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { dataset } = useDataset();
  const now = useNow();
  const today = dataset ? todayIn(dataset.timezone, now) : null;

  return (
    <div className="relative min-h-dvh overflow-clip">
      <Glows mirrored={pathname.startsWith(ROUTES.calendar)} />
      <div className="relative mx-auto flex max-w-[1360px] flex-col gap-[18px] px-[clamp(16px,3vw,40px)] pt-5 pb-28 sm:pt-7 sm:pb-12">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1 pb-2">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
            <Link href="/" className="flex items-center gap-3 no-underline">
              <Mark />
              <span className="text-[19px] font-semibold tracking-[-0.01em]">Zdravie</span>
            </Link>
            <nav aria-label="Hlavná navigácia" className="hidden gap-1.5 sm:flex">
              {PRIMARY_NAV.map((item) => (
                <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="pill">
                  {item.label}
                </Link>
              ))}
              <DetailMenu pathname={pathname} />
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="mono flex items-center gap-5 text-[12px] tracking-[0.04em] text-ink2 uppercase">
              {today && <div className="hidden md:block">{capitalize(formatDayLong(today).replace(/\s\d{4}$/, ""))}</div>}
              {dataset && <SyncStatus dataset={dataset} now={now} />}
            </div>
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <div className="sm:hidden">
              <ThemeToggle compact />
            </div>
            <form action={logout} className="hidden sm:block">
              <button type="submit" className="pill pill-outline">
                Odhlásiť
              </button>
            </form>
          </div>
        </header>

        <main className="flex min-w-0 flex-col gap-[18px]">{children}</main>
      </div>
      <TabBar pathname={pathname} />
    </div>
  );
}

/**
 * Loads the data once for a page and covers the states around it: first load,
 * nothing to show, and a source that has gone quiet.
 */
export function WithData({ children }: { children: (dataset: Dataset, now: Date) => React.ReactNode }) {
  const { dataset, error, isValidating } = useDataset();
  const now = useNow();

  if (!dataset) {
    if (error) {
      return (
        <EmptyState title="Dáta sú teraz nedostupné">
          Zdroj dát je vypnutý alebo sa k nemu nedá pripojiť. Stránka to skúsi znova sama.
        </EmptyState>
      );
    }
    return (
      <div className="flex items-center gap-3 px-1 py-24 text-[14px] text-ink2" role="status">
        <span className="size-2 animate-pulse rounded-full bg-accent" />
        Načítavam dáta…
      </div>
    );
  }
  if (dataset.days.length === 0) {
    return (
      <EmptyState title="Zatiaľ tu nič nie je">
        Program owi ešte nespočítal žiadny deň. Dáta sa objavia po prvej synchronizácii.
      </EmptyState>
    );
  }

  const stale = isStale(dataset.synced_at, now);
  return (
    <div className="flex flex-col gap-[18px] transition-opacity duration-300" style={{ opacity: isValidating && stale ? 0.7 : 1 }}>
      {stale && (
        <p
          role="status"
          className="glass flex items-start gap-3 px-5 py-4 text-[14px]"
          style={{ borderRadius: 20, borderColor: "color-mix(in oklab, var(--warn) 55%, transparent)" }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0" aria-hidden="true">
            <path d="M8 1.5 15 14H1L8 1.5Z" fill="var(--warn)" />
            <path d="M8 6v4m0 2v.5" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>
            <strong className="font-semibold">Zdroj dát je offline.</strong> Vidíš posledné načítané hodnoty,
            aktualizované {formatRelative(dataset.synced_at, now)}.
          </span>
        </p>
      )}
      {children(dataset, now)}
    </div>
  );
}
