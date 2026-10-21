"use client";

import { useLayoutEffect, useState, useTransition } from "react";
import { applyTheme, currentTheme, storedTheme } from "./theme";
import { useAccount } from "@/lib/account-context";
import { updateTheme } from "@/lib/account-actions";

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
  const context = useAccount();
  const preference = context?.dataAccount.settings.theme;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // React's development remount resets <html> attributes; put the stored choice back
  // before paint. In production the inline script has already done this.
  useLayoutEffect(() => {
    if (preference === "system") { document.documentElement.removeAttribute("data-theme"); return; }
    const theme = preference ?? storedTheme();
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }, [preference]);

  const toggle = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    if (!context) { applyTheme(next); return; }
    if (context.viewOnly) return;
    startTransition(async () => {
      const result = await updateTheme(next, { actorId: context.account.id, dataAccountId: context.dataAccount.id, viewOnly: context.viewOnly, sessionVersion: context.account.session_version });
      if (result.reload) { window.location.reload(); return; }
      setError(result.error ?? "");
      if (!result.error) document.documentElement.setAttribute("data-theme", next);
    });
  };

  if (compact) {
    return (
      <><button
        type="button"
        onClick={toggle}
        disabled={pending || context?.viewOnly}
        title={context?.viewOnly ? "Vzhľad je pri prezeraní účtu zamknutý" : undefined}
        className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-glass text-ink disabled:opacity-50"
      >
        <HalfMoon />
        <span className="sr-only when-light">Tmavý režim</span>
        <span className="sr-only when-dark">Svetlý režim</span>
      </button>{error && <span role="alert" className="text-xs text-bad">{error}</span>}</>
    );
  }

  return (
    <><button type="button" onClick={toggle} disabled={pending || context?.viewOnly} title={context?.viewOnly ? "Vzhľad je pri prezeraní účtu zamknutý" : undefined} className="pill pill-outline gap-[9px] disabled:opacity-50">
      <HalfMoon />
      <span className="when-light">Tmavý režim</span>
      <span className="when-dark">Svetlý režim</span>
    </button>{error && <span role="alert" className="text-xs text-bad">{error}</span>}</>
  );
}
