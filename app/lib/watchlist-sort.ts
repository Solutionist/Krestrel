import type { QuoteSnapshot } from "./market";
import { priceChange } from "./price-change";
import type { RsiSignal } from "./rsi-signal";

export const WATCHLIST_SORT_KEYS = [
  "manual",
  "symbol",
  "price",
  "changePercent",
  "change",
  "rsi",
] as const;
export type WatchlistSortKey = (typeof WATCHLIST_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export interface WatchlistSort {
  key: WatchlistSortKey;
  direction: SortDirection;
}

export const WATCHLIST_SORT_LABELS: Record<WatchlistSortKey, string> = {
  manual: "My order",
  symbol: "Symbol",
  price: "Price",
  changePercent: "Change %",
  change: "Change",
  rsi: "RSI (daily)",
};

type NumericKey = Exclude<WatchlistSortKey, "manual" | "symbol">;

const NUMERIC_VALUE: Record<
  NumericKey,
  (quote: QuoteSnapshot | undefined, signal: RsiSignal | null | undefined) => number | null
> = {
  price: (quote) => quote?.lastPrice ?? null,
  changePercent: (quote) => (quote ? (priceChange(quote)?.fraction ?? null) : null),
  change: (quote) => (quote ? (priceChange(quote)?.absolute ?? null) : null),
  rsi: (_quote, signal) => signal?.rsi ?? null,
};

/**
 * Display order for the watchlist. `manual` keeps the saved (server) order. Symbols without a
 * known value sort last in either direction; ties fall back to symbol A–Z. Never mutates input.
 */
export function sortSymbols(
  symbols: readonly string[],
  quotes: Record<string, QuoteSnapshot>,
  sort: WatchlistSort,
  /** Daily RSI signals, for the `rsi` key. */
  signals: Record<string, RsiSignal | null> = {},
): string[] {
  const { key, direction } = sort;
  if (key === "manual") return [...symbols];
  const sign = direction === "asc" ? 1 : -1;
  if (key === "symbol") return [...symbols].sort((a, b) => sign * a.localeCompare(b, "en"));

  const metric = NUMERIC_VALUE[key];
  const values = new Map(
    symbols.map((symbol) => [symbol, metric(quotes[symbol], signals[symbol])]),
  );
  return [...symbols].sort((a, b) => {
    const va = values.get(a) ?? null;
    const vb = values.get(b) ?? null;
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return sign * (va - vb);
    }
    return a.localeCompare(b, "en");
  });
}

/** Direction a key starts with when chosen: A–Z for symbols, largest first for numbers. */
export const DEFAULT_SORT_DIRECTION: Record<WatchlistSortKey, SortDirection> = {
  manual: "desc",
  symbol: "asc",
  price: "desc",
  changePercent: "desc",
  change: "desc",
  // Most oversold first.
  rsi: "asc",
};
