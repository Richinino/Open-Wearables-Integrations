"use client";

import { useLayoutEffect } from "react";
import { applyTheme, currentTheme, storedTheme } from "./theme";

function HalfMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Switches between the light and the dark theme. The label names the theme it switches to
 * and is picked by CSS (.when-light / .when-dark), so server and client render the same.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // React's development remount resets <html> attributes; put the stored choice back
  // before paint. In production the inline script has already done this.
  useLayoutEffect(() => {
    const theme = storedTheme();
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }, []);

  const toggle = () => applyTheme(currentTheme() === "dark" ? "light" : "dark");

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-glass text-ink"
      >
        <HalfMoon />
        <span className="sr-only when-light">Tmavý režim</span>
        <span className="sr-only when-dark">Svetlý režim</span>
      </button>
    );
  }

  return (
    <button type="button" onClick={toggle} className="pill pill-outline gap-[9px]">
      <HalfMoon />
      <span className="when-light">Tmavý režim</span>
      <span className="when-dark">Svetlý režim</span>
    </button>
  );
}
