// The only contract between a market-data source and the rest of Krestrel (ADR 0009).
// Provider modules translate upstream payloads into these normalized types; nothing outside a
// provider's folder may know upstream field names, URLs, or error codes.
import type { Logger } from "pino";

import type { DividendPayment } from "~/lib/dividends";
import type {
  Asset,
  Bar,
  BarSource,
  ConnectionStatus,
  DailyBar,
  MarketClock,
  NewsItem,
  ProviderInfo,
  QuoteSnapshot,
  Tick,
} from "~/lib/market";

export interface ProviderHandlers {
  onTick(tick: Tick): void;
  /** Live 1-minute bars, including late corrections for an earlier minute (same `ts` = replace). */
  onBar(bar: Bar): void;
  onStatus(status: ConnectionStatus): void;
}

export interface ProviderCapabilities extends ProviderInfo {
  /** `source` written for bars from the live stream. */
  liveSource: BarSource;
  /** `source` written for complete-market history from `getBars`. Preferred by chart queries. */
  historySource: BarSource;
  /** History newer than now − historyDelayMs is unavailable (Alpaca free SIP: 15 min). */
  historyDelayMs: number;
  /** Upper bound on symbols per `getBars` call; the backfill batches accordingly. */
  maxSymbolsPerHistoryRequest: number;
}

export interface MarketDataProvider extends ProviderCapabilities {
  /** Opens the single upstream stream. Idempotent. Reconnects internally; reports via onStatus. */
  connect(handlers: ProviderHandlers): void;
  disconnect(): Promise<void>;
  /** Adds symbols to the live subscription; kept across reconnects. */
  subscribe(symbols: readonly string[]): void;
  unsubscribe(symbols: readonly string[]): void;

  /** Complete-market 1-minute bars in [start, end), yielded page by page in ascending time. */
  getBars(symbols: readonly string[], start: Date, end: Date): AsyncIterable<Bar[]>;
  /**
   * Complete-market daily bars for New York trading dates in [startDay, endDay) (`YYYY-MM-DD`),
   * split-adjusted, source = `historySource`. Feeds 1D…1Y charts (ADR 0011).
   */
  getDailyBars(
    symbols: readonly string[],
    startDay: string,
    endDay: string,
  ): AsyncIterable<DailyBar[]>;
  getSnapshots(symbols: readonly string[]): Promise<QuoteSnapshot[]>;
  getClock(): Promise<MarketClock>;
  /** Exact-symbol lookup; `null` when the symbol is not a listed, active equity this provider serves. */
  getAsset(symbol: string): Promise<Asset | null>;
  /**
   * Every listed, active equity this provider can stream, for symbol search. May be large
   * (Alpaca: ~11k); the hub caches it and refreshes daily.
   */
  listAssets(): Promise<Asset[]>;
  /** Headlines mentioning `symbol` published since `since`, newest first, at most `limit`. */
  getNews(symbol: string, since: Date, limit: number): Promise<NewsItem[]>;
  /**
   * Cash dividends for `symbols` paid or announced around [startDay, endDay] (`YYYY-MM-DD`),
   * oldest first (ADR 0022). Symbols that pay nothing simply don't appear.
   */
  getDividends(
    symbols: readonly string[],
    startDay: string,
    endDay: string,
  ): Promise<Array<DividendPayment & { symbol: string }>>;
}

export interface ProviderContext {
  /** Raw environment; each provider validates the variables it owns with its own schema. */
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
}

export type ProviderFactory = (context: ProviderContext) => MarketDataProvider;
