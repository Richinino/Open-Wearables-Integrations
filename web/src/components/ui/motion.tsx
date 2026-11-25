"use client";

// Small motion pieces shared by the pages. The curves and lengths live in globals.css;
// these only decide when something moves. Rule of thumb: what you see tens of times a day
// moves fast or not at all, one authored moment per page plays once.

import { useEffect, useLayoutEffect, useRef, useState, ViewTransition, type CSSProperties, type ReactNode } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------------------
// "Once": per page load (module memory) or per browser and day (localStorage).

const playedThisLoad = new Set<string>();

/** True only the first time `key` asks during this page load. */
export function firstThisLoad(key: string): boolean {
  if (playedThisLoad.has(key)) return false;
  playedThisLoad.add(key);
  return true;
}

/**
 * True the first time this browser shows `key` (e.g. the score of one date). Storage can
 * be blocked; then it falls back to once per page load. Read once per mount.
 */
export function useFirstTime(key: string): boolean {
  const [first] = useState(() => {
    if (typeof window === "undefined") return false;
    const storageKey = `zdravie-seen:${key}`;
    try {
      if (localStorage.getItem(storageKey)) return false;
      localStorage.setItem(storageKey, "1");
      pruneSeen();
      return true;
    } catch {
      return firstThisLoad(storageKey);
    }
  });
  return first;
}

/** Keeps the "seen" marks from piling up: the newest 60 stay. */
function pruneSeen() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("zdravie-seen:")) keys.push(key);
    }
    if (keys.length > 60) keys.sort().slice(0, keys.length - 60).forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing to prune.
  }
}

// ---------------------------------------------------------------------------------------

/**
 * A number that counts up from zero the first time it appears in a page load. Later
 * renders (data refreshes, coming back to the page) show the value at once.
 */
export function CountUp({
  value,
  format,
  id,
  duration = 600,
  delay = 0,
}: {
  value: number | null;
  format: (value: number | null) => string;
  /** Identity for "first time": the same id counts only once per page load. */
  id: string;
  duration?: number;
  delay?: number;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const ran = useRef(false);

  useIsoLayoutEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (value === null || value === 0 || prefersReducedMotion() || !firstThisLoad(`count:${id}`)) return;
    let frame = 0;
    const target = value;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - progress, 4);
      if (progress >= 1) {
        setShown(null);
        return;
      }
      setShown(target * eased);
      frame = requestAnimationFrame(step);
    };
    setShown(0);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setShown(null);
    };
    // Only the first value counts up; later values roll (see below).
  }, []);

  // Counting: plain text. Settled: rolling digits, so a refreshed value turns like a counter.
  if (shown !== null) {
    return (
      <>
        <span aria-hidden="true">{format(Number.isInteger(value ?? 0) ? Math.round(shown) : shown)}</span>
        <span className="sr-only">{format(value)}</span>
      </>
    );
  }
  return <RollingNumber text={format(value)} />;
}

/**
 * Digits that roll like a counter when the value changes while the page is open, e.g.
 * after a data refresh. Same digit count: each column turns, right to left. Otherwise the
 * new text simply replaces the old one.
 */
export function RollingNumber({ text, className = "" }: { text: string; className?: string }) {
  const chars = [...text];
  return (
    <>
    <span className="sr-only">{text}</span>
    <span className={`odo tabular ${className}`} aria-hidden="true">
      {chars.map((char, index) =>
        /\d/.test(char) ? (
          <span
            key={`${chars.length}-${index}`}
            className="odo-col"
            aria-hidden="true"
            style={{ transform: `translateY(${-Number(char) * 10}%)`, transitionDelay: `${(chars.length - 1 - index) * 30}ms` }}
          >
            {DIGITS.map((digit) => (
              <span key={digit}>{digit}</span>
            ))}
          </span>
        ) : (
          <span key={`${chars.length}-${index}`} aria-hidden="true" style={{ whiteSpace: "pre" }}>
            {char}
          </span>
        ),
      )}
    </span>
    </>
  );
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

// ---------------------------------------------------------------------------------------

/**
 * A figure that travels between pages: the same `name` on an overview tile and on the
 * detail page makes the number move from one to the other instead of vanishing.
 */
export function Morph({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      <span className="inline-block">{children}</span>
    </ViewTransition>
  );
}

// ---------------------------------------------------------------------------------------

/**
 * A group of `.pill` buttons with one pressed. A dark indicator slides under the pressed
 * pill instead of the colour jumping from one to the next.
 */
export function PillGroup({
  label,
  className = "",
  style,
  children,
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ready, setReady] = useState(false);

  useIsoLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const measure = () => {
      const pressed = group.querySelector<HTMLElement>(':scope > .pill[aria-pressed="true"]');
      setBox(pressed ? { x: pressed.offsetLeft, y: pressed.offsetTop, w: pressed.offsetWidth, h: pressed.offsetHeight } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    const mutations = new MutationObserver(measure);
    mutations.observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  // Turn the sliding on one frame after the first placement, so it does not fly in.
  useEffect(() => {
    if (!box || ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [box, ready]);

  return (
    <div ref={ref} role="group" aria-label={label} className={`pill-group ${className}`} style={style} data-ready={ready && box ? "true" : "false"}>
      <span
        aria-hidden="true"
        className="pill-ind"
        style={
          box
            ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)`, transition: ready ? undefined : "none" }
            : { display: "none" }
        }
      />
      {children}
    </div>
  );
}
