// SVG paths for the small trend charts of the overview (area under steps, resting heart rate).
// A missing value breaks the line, it is never drawn as zero.

export interface TrendPaths {
  line: string;
  area: string;
}

const fixed = (value: number) => (Math.round(value * 10) / 10).toString();

/**
 * Line and area paths for `values` spread evenly over `width`. `low` sits on the bottom edge,
 * `high` `topPad` units below the top edge. A lone value between gaps becomes a dot-length
 * segment so a round line cap still shows it.
 */
export function trendPaths(
  values: readonly (number | null)[],
  width: number,
  height: number,
  { low, high, topPad = 0 }: { low: number; high: number; topPad?: number },
): TrendPaths {
  const span = high - low || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const x = (index: number) => index * step;
  const y = (value: number) => height - ((value - low) / span) * (height - topPad);

  const runs: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (typeof value === "number" && Number.isFinite(value)) current.push({ index, value });
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  });
  if (current.length) runs.push(current);

  let line = "";
  let area = "";
  for (const run of runs) {
    const points = run.map(({ index, value }) => `${fixed(x(index))},${fixed(y(value))}`);
    if (run.length === 1) points.push(`${fixed(x(run[0].index) + 0.01)},${fixed(y(run[0].value))}`);
    line += `M${points.join("L")}`;
    const first = fixed(x(run[0].index));
    const last = fixed(x(run[run.length - 1].index) + (run.length === 1 ? 0.01 : 0));
    area += `M${first},${fixed(height)}L${points.join("L")}L${last},${fixed(height)}Z`;
  }
  return { line, area };
}
