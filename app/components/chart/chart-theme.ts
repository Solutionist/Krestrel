// Chart colours derived from the app tokens (app.css), softened for long viewing: faint
// horizontal grid only, translucent volume, quiet crosshair. Read when the chart is created; the
// dashboard remounts the chart on theme change, so no live re-theming is needed.

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`; Lightweight Charts' colour parser has no `color-mix()`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export interface ChartTheme {
  background: string;
  text: string;
  muted: string;
  grid: string;
  crosshair: string;
  labelBackground: string;
  rise: string;
  fall: string;
  riseVolume: string;
  fallVolume: string;
  /** Indicator line colours by CSS token name. */
  line(tokenName: string, alpha?: number): string;
  font: string;
}

export function readChartTheme(): ChartTheme {
  const rule = token("--color-rule");
  const muted = token("--color-muted");
  const rise = token("--color-rise");
  const fall = token("--color-fall");
  return {
    // The chart sits inside the main card, so it shares the card surface.
    background: token("--color-panel"),
    text: token("--color-text"),
    muted,
    grid: withAlpha(rule, 0.6),
    crosshair: withAlpha(muted, 0.5),
    // Mid-tone chip: the chart picks light or dark label text by contrast, in both themes.
    labelBackground: muted,
    rise,
    fall,
    riseVolume: withAlpha(rise, 0.14),
    fallVolume: withAlpha(fall, 0.14),
    line: (tokenName, alpha = 0.9) => withAlpha(token(tokenName), alpha),
    font: token("--font-sans"),
  };
}
