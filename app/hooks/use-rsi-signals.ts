import { useEffect, useMemo, useState } from "react";

import { rsi } from "~/lib/indicators";
import type { QuoteSnapshot } from "~/lib/market";
import {
  liveCloses,
  RSI_PERIOD,
  type RsiLevels,
  type RsiSignal,
  rsiSignal,
  type SignalsResponse,
  SignalsResponseSchema,
} from "~/lib/rsi-signal";

/** Daily history changes slowly; live prices are folded in on every quote update. */
const REFRESH_MS = 10 * 60 * 1000;

/**
 * Daily RSI(14) signal per watchlist symbol, live: history from `/api/signals` (refetched when the
 * watchlist or downloaded history changes, and every 10 minutes) plus the latest trade price.
 */
export function useRsiSignals(
  symbols: readonly string[],
  quotes: Record<string, QuoteSnapshot>,
  levels: RsiLevels,
  /** Changes when the server finishes downloading history. */
  historyStamp: number,
): Record<string, RsiSignal | null> {
  const [series, setSeries] = useState<SignalsResponse["series"]>({});
  const symbolsKey = [...symbols].sort().join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: symbolsKey and historyStamp are refetch triggers.
  useEffect(() => {
    const abort = new AbortController();
    const load = () =>
      fetch("/api/signals", { signal: abort.signal })
        .then(async (response) => {
          const parsed = SignalsResponseSchema.safeParse(await response.json());
          if (parsed.success) setSeries(parsed.data.series);
        })
        .catch(() => {
          // Signals are an aid; keep the last ones rather than showing an error.
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [symbolsKey, historyStamp]);

  return useMemo(() => {
    const signals: Record<string, RsiSignal | null> = {};
    for (const symbol of symbols) {
      const history = series[symbol];
      const closes = liveCloses(history?.closes ?? [], history?.lastTime ?? null, quotes[symbol]);
      signals[symbol] = rsiSignal(rsi(closes, RSI_PERIOD), levels);
    }
    return signals;
  }, [symbols, series, quotes, levels]);
}
