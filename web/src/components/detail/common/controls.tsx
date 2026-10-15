"use client";

// Client pieces of the detail pages: a pill switch, a choice remembered per viewer and a
// chart tile with its table twin.

import { useCallback, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { DataTable, type TableData } from "@/components/ui/parts";

/** Pills in a thin outline, one pressed. Buttons keep the 44px height of the A2 pills. */
export function Switch<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex max-w-full flex-wrap gap-1 rounded-[26px] border border-line p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="pill text-[13px]"
          style={{ padding: "0 15px" }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// A choice remembered in localStorage. Storage can be blocked or empty (private windows,
// previews); the choice then lives in memory until the page is reloaded.

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function readChoice(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useStoredChoice<T extends string>(
  key: string,
  accept: (value: unknown) => value is T,
  fallback: T,
): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readChoice(key),
    () => null,
  );
  const set = useCallback(
    (next: T) => {
      memory.set(key, next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage blocked: the choice holds in memory.
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );
  return [accept(raw) ? raw : fallback, set];
}

// ---------------------------------------------------------------------------------------

/** A chart in a glass tile: eyebrow title, an optional note, the chart or its table twin. */
export function ChartTile({
  label,
  note,
  legend,
  table,
  tableHeight = 320,
  className = "",
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  /** Keys under the chart, e.g. <Keys>. */
  legend?: ReactNode;
  table: TableData;
  tableHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <figure aria-labelledby={titleId} className={`glass flex min-w-0 flex-col gap-4 p-5 sm:p-7 ${className}`}>
      <figcaption className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id={titleId} className="eyebrow">
            {label}
          </h3>
          {note && <p className="mt-2 text-[13px] text-ink2">{note}</p>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((value) => !value)}
          aria-pressed={asTable}
          className="-my-1 min-h-9 shrink-0 rounded-full border border-line px-3 text-[12px] font-semibold text-ink2 transition-colors hover:bg-sunk hover:text-ink"
        >
          {asTable ? "Graf" : "Tabuľka"}
        </button>
      </figcaption>
      {asTable ? (
        <DataTable {...table} maxHeight={tableHeight} />
      ) : (
        <>
          {children}
          {legend}
        </>
      )}
    </figure>
  );
}
