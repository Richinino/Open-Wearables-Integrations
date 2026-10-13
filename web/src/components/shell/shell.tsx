"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/login/actions";
import { EmptyState } from "@/components/ui/parts";
import { formatRelative } from "@/lib/format";
import { isStale } from "@/lib/metrics";
import type { Dataset } from "@/lib/types";
import { useDataset } from "@/lib/use-dataset";

const NAV = [
  { href: "/", label: "Prehľad", icon: "M4 19V10m5.3 9V5m5.4 14v-6M20 19V8" },
  { href: "/spanok", label: "Spánok", icon: "M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7Z" },
  { href: "/treningy", label: "Tréningy", icon: "M3 12h4l2.5-6 4 12 2.5-6h5" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/den") : pathname.startsWith(href);
}

/** Current time, refreshed every minute so relative labels stay honest. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Day by day, night on the other half: the two subjects of the site. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M11 1a10 10 0 0 0 0 20Z" fill="var(--activity)" />
      <path d="M11 1a10 10 0 0 1 0 20Z" fill="var(--sleep)" />
    </svg>
  );
}

function SyncStatus({ dataset, now }: { dataset: Dataset; now: Date }) {
  const stale = isStale(dataset.synced_at, now);
  return (
    <span
      className="flex items-center gap-1.5 text-[12px] text-ink-2"
      title={stale ? "Zdroj dát sa dlhšie neozval" : "Dáta sa obnovujú každých pár minút"}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: stale ? "var(--warn)" : "var(--good)" }}
      />
      <span>
        <span className="hidden xs:inline">{stale ? "Offline · " : "Aktualizované "}</span>
        {formatRelative(dataset.synced_at, now)}
      </span>
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { dataset } = useDataset();
  const now = useNow();

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1180px] flex-col px-5 sm:px-8">
      <header className="flex h-16 items-center justify-between gap-4 sm:h-20">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
            <Mark />
            Zdravie
          </Link>
          <nav aria-label="Hlavná navigácia" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors ${
                    active ? "bg-ink text-page" : "text-ink-2 hover:bg-sunk hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {dataset && <SyncStatus dataset={dataset} now={now} />}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink-2 ring-1 ring-ring transition-colors hover:bg-sunk hover:text-ink"
            >
              Odhlásiť
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 pt-2 pb-28 sm:pt-4 sm:pb-16">{children}</main>

      <nav
        aria-label="Hlavná navigácia"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        <div className="mx-auto flex max-w-md">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.2 : 1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * Loads the data once for a page and covers the states around it: first load,
 * nothing to show, and a source that has gone quiet.
 */
export function WithData({
  children,
}: {
  children: (dataset: Dataset, now: Date) => React.ReactNode;
}) {
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
      <div className="flex items-center gap-3 py-24 text-[14px] text-ink-2" role="status">
        <span className="size-2 animate-pulse rounded-full bg-ink" />
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
    <div
      className="transition-opacity duration-300"
      style={{ opacity: isValidating && stale ? 0.7 : 1 }}
    >
      {stale && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2.5 rounded-xl bg-warn-bg px-4 py-3 text-[13px] text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0" aria-hidden="true">
            <path d="M8 1.5 15 14H1L8 1.5Z" fill="var(--warn)" />
            <path d="M8 6v4m0 2v.5" stroke="var(--warn-bg)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>
            <strong className="font-semibold">Zdroj dát je offline.</strong> Vidíš posledné načítané
            hodnoty, aktualizované {formatRelative(dataset.synced_at, now)}.
          </span>
        </p>
      )}
      {children(dataset, now)}
    </div>
  );
}
