import { useSyncExternalStore } from "react";

import { formatPercentChange, formatPrice } from "~/lib/format";

export interface LegendIndicator {
  /** State shown after the values (RSI: Overbought, Buy signal, …); `rising` picks the colour. */
  note?: { text: string; rising: boolean };
  label: string;
  /** CSS colour of the series line. */
  color: string;
  values: Array<number | null>;
  /** RSI and similar oscillators print without price formatting. */
  integer?: boolean;
}

export interface LegendState {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Close vs. previous candle's close, as a fraction; null for the first candle. */
  change: number | null;
  indicators: LegendIndicator[];
  /** Set when the bars aren't plain candles, e.g. "Heikin Ashi"; the numbers stay real. */
  barStyle: string | null;
}

/** Legend data written by the chart and read by the legend via `useSyncExternalStore`. */
export interface LegendStore {
  set(next: LegendState | null): void;
  get(): LegendState | null;
  subscribe(listener: () => void): () => void;
}

/**
 * External store for the legend: the chart writes on crosshair moves (up to every frame) and
 * only the legend re-renders, never the chart component.
 */
export function createLegendStore(): LegendStore {
  let state: LegendState | null = null;
  const listeners = new Set<() => void>();
  return {
    set(next) {
      state = next;
      for (const listener of listeners) listener();
    },
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Floating readout at the top-left of the chart: OHLC at the cursor plus indicators. */
export function ChartLegend({ store }: { store: LegendStore }) {
  const state = useSyncExternalStore(store.subscribe, store.get, () => null);
  if (!state) return null;
  const tone =
    state.change === null || state.change === 0
      ? "text-muted"
      : state.change > 0
        ? "text-rise"
        : "text-fall";
  return (
    // Faint panel backing so the readout stays legible over candles in both themes.
    <div className="pointer-events-none absolute top-2 left-3 z-10 space-y-0.5 rounded-lg bg-panel/80 px-2 py-1 text-[11px] leading-4 tabular-nums backdrop-blur-sm">
      <div className="flex flex-wrap gap-x-2.5 text-muted">
        {state.barStyle && (
          <span
            className="rounded bg-accent/15 px-1 text-accent"
            title="The bars are averaged; open, high, low, close and change are the real prices."
          >
            {state.barStyle}
          </span>
        )}
        <span>
          O <span className="text-text">{formatPrice(state.open)}</span>
        </span>
        <span>
          H <span className="text-text">{formatPrice(state.high)}</span>
        </span>
        <span>
          L <span className="text-text">{formatPrice(state.low)}</span>
        </span>
        <span>
          C <span className="text-text">{formatPrice(state.close)}</span>
        </span>
        {state.change !== null && (
          <span className={tone}>
            {state.change > 0 ? "▲ " : state.change < 0 ? "▼ " : ""}
            {formatPercentChange(state.change)}
          </span>
        )}
        <span>
          Vol <span className="text-text">{compact.format(state.volume)}</span>
        </span>
      </div>
      {state.indicators.map((indicator) => (
        <div key={indicator.label} className="flex items-center gap-2 text-muted">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ backgroundColor: indicator.color }}
            />
            {indicator.label}
          </span>
          {indicator.values.map((value, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position values (e.g. upper/middle/lower band)
            <span key={index} className="text-text">
              {value === null ? "—" : indicator.integer ? value.toFixed(0) : formatPrice(value)}
            </span>
          ))}
          {indicator.note && (
            <span className={indicator.note.rising ? "text-rise" : "text-fall"}>
              {indicator.note.text}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
