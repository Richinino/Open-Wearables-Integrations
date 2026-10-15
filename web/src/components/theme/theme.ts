// The viewer's light/dark choice. Without a stored choice the page follows the system.

export type Theme = "light" | "dark";

export const THEME_KEY = "zdravie-theme";

/**
 * Runs in <head> before the first paint: applies a stored choice so the page never flashes
 * the other theme. Kept tiny and dependency-free; storage may be blocked, hence try/catch.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** The theme on screen now: the explicit choice, else the system's. */
export function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice holds until the page is reloaded.
  }
}
