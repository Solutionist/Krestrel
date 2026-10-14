import { loadChartCandles } from "~/.server/market/chart-data";
import { db } from "~/.server/market/db/instance";
import { getMarketHub } from "~/.server/market/instance";
import type { SignalsResponse } from "~/lib/rsi-signal";

/** About a year of trading days: plenty for Wilder's RSI to settle (it needs ~10× the period). */
const LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * GET /api/signals → daily closes per watchlist symbol (oldest first) for the RSI signals in the
 * watchlist, chart header and portfolio (ADR 0014). The browser folds in live prices.
 */
export async function loader() {
  const hub = getMarketHub();
  const from = new Date(Date.now() - LOOKBACK_MS);
  const entries = await Promise.all(
    hub.snapshot().watchlist.map(async (symbol) => {
      const candles = await loadChartCandles(db, {
        symbol,
        timeframe: "1D",
        from,
        sources: hub.sources,
      });
      return [
        symbol,
        { closes: candles.map((candle) => candle.close), lastTime: candles.at(-1)?.time ?? null },
      ] as const;
    }),
  );
  return Response.json({ series: Object.fromEntries(entries) } satisfies SignalsResponse);
}
