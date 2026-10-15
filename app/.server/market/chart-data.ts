// Chart candles for a symbol/interval, shared by /api/bars and /api/signals so both see the
// same data. Intraday intervals come from bars_1m; 1D…1Y from bars_1d + today's minutes (ADR 0011).
import { type Candle, isCalendarTimeframe, type Timeframe } from "~/lib/market";
import type { Database } from "./db/client";
import { getCalendarCandles, getCandles } from "./db/queries/bars";

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

/**
 * Default look-back per interval, roughly TradingView's default visible range. Intraday data only
 * exists for BACKFILL_DAYS (minute bars); 1D…1Y use daily history (DAILY_HISTORY_YEARS).
 */
export const DEFAULT_LOOKBACK_MS: Record<Timeframe, number> = {
  "1m": 2 * DAY,
  "5m": 7 * DAY,
  "15m": 14 * DAY,
  "30m": 30 * DAY,
  "1h": 60 * DAY,
  "4h": 180 * DAY,
  "1D": 2 * YEAR,
  "1W": 5 * YEAR,
  "2W": 10 * YEAR,
  "1M": 20 * YEAR,
  "1Y": 30 * YEAR,
};

export interface ChartCandleQuery {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
  sources: { history: string; live: string };
}

export function loadChartCandles(db: Database, query: ChartCandleQuery): Promise<Candle[]> {
  const to = query.to ?? new Date(Date.now() + 60_000);
  const from = query.from ?? new Date(to.getTime() - DEFAULT_LOOKBACK_MS[query.timeframe]);
  const base = {
    symbol: query.symbol,
    from,
    to,
    historySource: query.sources.history,
    liveSource: query.sources.live,
  };
  return isCalendarTimeframe(query.timeframe)
    ? getCalendarCandles(db, { ...base, timeframe: query.timeframe })
    : getCandles(db, { ...base, timeframe: query.timeframe });
}
