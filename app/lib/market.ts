// Isomorphic market-data types shared by server, SSE payloads, and UI.
// Nothing here may name a specific provider: providers plug in via app/.server/market/registry.ts.
import * as z from "zod";

/**
 * Where a bar came from (ADR 0005, ADR 0009). Each provider declares its own source ids,
 * e.g. Alpaca: `alpaca_sip` (history) and `alpaca_iex` (live). Lowercase snake_case.
 */
export const BarSourceSchema = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
export type BarSource = z.infer<typeof BarSourceSchema>;

/** Chart intervals, TradingView-style (ai/ui.md). */
export const INTRADAY_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h"] as const;
/** Built from daily bars in New York calendar terms. */
export const CALENDAR_TIMEFRAMES = ["1D", "1W", "2W", "1M", "1Y"] as const;
export const TIMEFRAMES = [...INTRADAY_TIMEFRAMES, ...CALENDAR_TIMEFRAMES] as const;
export type IntradayTimeframe = (typeof INTRADAY_TIMEFRAMES)[number];
export type CalendarTimeframe = (typeof CALENDAR_TIMEFRAMES)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];

export function isCalendarTimeframe(timeframe: Timeframe): timeframe is CalendarTimeframe {
  return (CALENDAR_TIMEFRAMES as readonly string[]).includes(timeframe);
}

/** One exchange trading day of history (ADR 0011). `day` is the New York date, `YYYY-MM-DD`. */
export const DailyBarSchema = z.object({
  symbol: z.string(),
  source: BarSourceSchema,
  day: z.iso.date(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export type DailyBar = z.infer<typeof DailyBarSchema>;

/** US listed equity ticker: letters, optionally a class suffix (BRK.B). */
export const SymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/, { error: "Enter a ticker like AAPL or BRK.B" });

export const TickSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  size: z.number(),
  /** Epoch milliseconds, UTC. */
  ts: z.number(),
});
export type Tick = z.infer<typeof TickSchema>;

export const BarSchema = z.object({
  symbol: z.string(),
  source: BarSourceSchema,
  /** Bar open time, epoch milliseconds, UTC. */
  ts: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  tradeCount: z.number().nullable(),
  vwap: z.number().nullable(),
});
export type Bar = z.infer<typeof BarSchema>;

export const CONNECTION_STATES = [
  "idle",
  "connecting",
  "live",
  "reconnecting",
  "error",
  "stopped",
] as const;

export const ConnectionStatusSchema = z.object({
  state: z.enum(CONNECTION_STATES),
  /** Plain-language explanation for the UI when not live. */
  reason: z.string().nullable(),
  /** Upstream error code (e.g. Alpaca 406) when known. */
  code: z.number().nullable(),
  /** Epoch ms of the next reconnect attempt, when scheduled. */
  retryAt: z.number().nullable(),
});
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const MARKET_PHASES = ["pre", "open", "post", "closed"] as const;
export type MarketPhase = (typeof MARKET_PHASES)[number];

export const MarketClockSchema = z.object({
  phase: z.enum(MARKET_PHASES),
  /** Epoch ms when the phase is expected to change. */
  phaseUntil: z.number().nullable(),
  nextOpen: z.number().nullable(),
  nextClose: z.number().nullable(),
});
export type MarketClock = z.infer<typeof MarketClockSchema>;

/** One OHLCV candle as served to the chart. `time` is the bucket start in epoch seconds (UTC). */
export const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});
export type Candle = z.infer<typeof CandleSchema>;

/**
 * What the UI needs to know about the active provider. Comes from the provider's own
 * declaration, so limits and labels change with the provider, not with UI code.
 */
export const ProviderInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** Persistent honesty label, e.g. "Live data: IEX only". */
  liveDataLabel: z.string(),
  /** Max symbols the live stream accepts; the watchlist limit is enforced against this. */
  maxSymbols: z.number().int().positive(),
});
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

/** Latest known prices for a symbol, used to seed the UI and compute change vs previous close. */
export const QuoteSnapshotSchema = z.object({
  symbol: z.string(),
  lastPrice: z.number().nullable(),
  /** Epoch ms of the last trade. */
  lastTs: z.number().nullable(),
  previousClose: z.number().nullable(),
});
export type QuoteSnapshot = z.infer<typeof QuoteSnapshotSchema>;

export const AssetSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** A headline from the market-data provider's news feed (newest first when listed). */
export const NewsItemSchema = z.object({
  id: z.string(),
  headline: z.string(),
  summary: z.string(),
  /** Publisher or wire, e.g. "benzinga". */
  source: z.string(),
  url: z.string().nullable(),
  /** ISO 8601 publication time. */
  createdAt: z.iso.datetime(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;
