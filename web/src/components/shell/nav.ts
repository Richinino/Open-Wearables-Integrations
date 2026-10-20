// Routes of the site, in one place for the header, the tab bar and the overview tiles.

export const ROUTES = {
  overview: "/",
  calendar: "/kalendar",
  sleep: "/spanok",
  readiness: "/pripravenost",
  activity: "/aktivita",
  steps: "/kroky",
  heart: "/tep",
  workouts: "/treningy",
  longTerm: "/dlhodobe",
  entries: "/zapis",
  /** /zapis with one day open, e.g. from the day page. */
  entryFor: (date: string) => `/zapis?den=${date}`,
  day: (date: string) => `/den/${date}`,
} as const;

export interface NavItem {
  href: string;
  label: string;
  note?: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: ROUTES.overview, label: "Prehľad" },
  { href: ROUTES.calendar, label: "Kalendár" },
];

export const DETAIL_NAV: NavItem[] = [
  { href: ROUTES.sleep, label: "Spánok", note: "noci, fázy, potreba spánku" },
  { href: ROUTES.readiness, label: "Pripravenosť", note: "Readiness a nočný tep" },
  { href: ROUTES.activity, label: "Aktivita", note: "Activity, Strain a záťaž" },
  { href: ROUTES.workouts, label: "Tréningy", note: "zoznam a intenzita" },
  { href: ROUTES.longTerm, label: "Dlhodobé", note: "VO2max, vek tela, rekordy" },
  { href: ROUTES.entries, label: "Zápis", note: "doplň čísla zo Samsungu" },
];

/** Routes reached from overview tiles that have no menu entry of their own. */
export const TILE_ONLY_NAV: NavItem[] = [
  { href: ROUTES.steps, label: "Kroky" },
  { href: ROUTES.heart, label: "Pokojový tep" },
];

export function visibleDetailNav(hasSamsung: boolean, viewOnly: boolean): NavItem[] {
  return DETAIL_NAV.filter((item) => item.href !== ROUTES.entries || (hasSamsung && !viewOnly));
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // A day page sits under the calendar: its breadcrumb leads back there.
  if (href === ROUTES.calendar && pathname.startsWith("/den/")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}
