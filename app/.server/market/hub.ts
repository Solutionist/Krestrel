// MarketHub: owns the single upstream connection and fans data out (ADR 0004). Provider-agnostic:
// everything source-specific comes from the MarketDataProvider it is given (ADR 0009).
import type { Logger } from "pino";

import { nyDay } from "~/lib/candles";
import {
  DIVIDEND_LOOKAHEAD_DAYS,
  DIVIDEND_LOOKBACK_DAYS,
  type DividendPayment,
} from "~/lib/dividends";
import {
  type Asset,
  type ConnectionStatus,
  type MarketClock,
  type NewsItem,
  type ProviderInfo,
  type QuoteSnapshot,
  SymbolSchema,
} from "~/lib/market";
import type { SnapshotPayload, StreamEvent } from "~/lib/stream-events";
import { AlertEngine } from "./alert-engine";
import { type AssetIndex, createAssetIndex } from "./asset-search";
import { type Backfiller, createBackfiller } from "./backfill";
import { type BarWriter, createBarWriter } from "./bar-writer";
import { createDailyCloses, type DailyCloses, type DailyClosesResult } from "./daily-closes";
import type { Database } from "./db/client";
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  reorderWatchlist,
} from "./db/queries/watchlist";
import {
  createDividendCache,
  createDividendHistory,
  type DividendCache,
  type DividendHistory,
} from "./dividend-history";
import type { MarketDataProvider } from "./provider";

const MINUTE = 60_000;
/** Re-run incremental backfill so the live tail is replaced by complete history (ADR 0005). */
const BACKFILL_INTERVAL_MS = 15 * MINUTE;
const CLOCK_MIN_DELAY_MS = 30_000;
const CLOCK_MAX_DELAY_MS = 30 * MINUTE;
const CLOCK_RETRY_MS = MINUTE;
/** Listings change rarely (IPOs, delistings); refresh the search index daily. */
const ASSET_LIST_TTL_MS = 24 * 60 * MINUTE;
const NEWS_LOOKBACK_MS = 30 * 24 * 60 * MINUTE;
const NEWS_LIMIT = 20;
const DAY = 24 * 60 * MINUTE;

export type HubListener = (event: StreamEvent | { event: "shutdown" }) => void;

export type AddSymbolResult =
  | { ok: true; symbol: string }
  | {
      ok: false;
      code: "invalid" | "unknown" | "duplicate" | "limit" | "upstream";
      message: string;
    };

export interface MarketHubDeps {
  provider: MarketDataProvider;
  db: Database;
  logger: Logger;
  backfillDays: number;
  dailyHistoryYears: number;
  now?: () => number;
}

export class MarketHub {
  readonly #provider: MarketDataProvider;
  readonly #db: Database;
  readonly #log: Logger;
  readonly #now: () => number;
  readonly #writer: BarWriter;
  readonly #backfill: Backfiller;
  readonly #alerts: AlertEngine;
  readonly #listeners = new Set<HubListener>();
  readonly #quotes = new Map<string, QuoteSnapshot>();
  #watchlist: string[] = [];
  #status: ConnectionStatus = { state: "idle", reason: null, code: null, retryAt: null };
  #clock: MarketClock | null = null;
  #started: Promise<void> | null = null;
  #clockTimer: NodeJS.Timeout | undefined;
  #backfillTimer: NodeJS.Timeout | undefined;
  #stopped = false;
  #assets: { index: AssetIndex; loadedAt: number } | null = null;
  #assetsLoading: Promise<AssetIndex> | null = null;

  constructor(deps: MarketHubDeps) {
    this.#provider = deps.provider;
    this.#db = deps.db;
    this.#log = deps.logger.child({ mod: "hub", provider: deps.provider.id });
    this.#now = deps.now ?? Date.now;
    this.#writer = createBarWriter(deps.db, this.#log.child({ mod: "bar-writer" }));
    this.#backfill = createBackfiller({
      provider: deps.provider,
      db: deps.db,
      logger: this.#log.child({ mod: "backfill" }),
      days: deps.backfillDays,
      dailyYears: deps.dailyHistoryYears,
      now: this.#now,
    });
    this.#alerts = new AlertEngine({
      db: deps.db,
      logger: this.#log.child({ mod: "alerts" }),
      emit: (fired) => this.#emit({ event: "alert", data: fired }),
      now: this.#now,
    });
  }

  get provider(): ProviderInfo {
    const { id, displayName, liveDataLabel, maxSymbols } = this.#provider;
    return { id, displayName, liveDataLabel, maxSymbols };
  }

  get sources(): { history: string; live: string } {
    return { history: this.#provider.historySource, live: this.#provider.liveSource };
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  /** Price alerts (ADR 0023): create, delete, list. Live ticks are checked by the hub. */
  get alerts(): AlertEngine {
    return this.#alerts;
  }

  /** Idempotent: connects upstream, subscribes the stored watchlist, starts clock and backfill. */
  start(): Promise<void> {
    this.#started ??= this.#start().catch((err: unknown) => {
      this.#started = null; // Let the next call retry (e.g. once Postgres is up).
      throw err;
    });
    return this.#started;
  }

  async #start(): Promise<void> {
    this.#watchlist = (await listWatchlist(this.#db)).map((entry) => entry.symbol);
    await this.#alerts.load();
    this.#log.info({ symbols: this.#watchlist.length }, "starting market hub");

    this.#provider.connect({
      onTick: (tick) => {
        const quote = this.#quotes.get(tick.symbol);
        if (!quote) return; // Not (or no longer) on the watchlist.
        quote.lastPrice = tick.price;
        quote.lastTs = tick.ts;
        this.#emit({ event: "tick", data: tick });
        this.#alerts.onPrice(tick.symbol, tick.price, tick.ts);
      },
      onBar: (bar) => {
        this.#writer.write(bar);
        this.#emit({ event: "bar", data: bar });
      },
      onStatus: (status) => {
        this.#status = status;
        const level = status.state === "error" ? "error" : "info";
        this.#log[level]({ status }, "upstream status");
        this.#emit({ event: "status", data: status });
      },
    });

    for (const symbol of this.#watchlist) this.#quotes.set(symbol, emptyQuote(symbol));
    this.#provider.subscribe(this.#watchlist);

    void this.#refreshQuotes(this.#watchlist);
    void this.#pollClock();
    void this.#backfillThenNotify(this.#watchlist);
    this.#backfillTimer = setInterval(
      () => void this.#backfill.enqueue(this.#watchlist),
      BACKFILL_INTERVAL_MS,
    );
  }

  /** Shuts the hub down for good (process exit): upstream, backfill, bar writer, SSE streams. */
  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#clockTimer);
    clearInterval(this.#backfillTimer);
    await this.#provider.disconnect();
    // Let an in-flight history download finish its page instead of writing after shutdown.
    await this.#backfill.close();
    await this.#writer.flush();
    await this.#alerts.settled();
    for (const listener of this.#listeners) listener({ event: "shutdown" });
    this.#listeners.clear();
  }

  /** Subscribes to hub events; returns the unsubscribe function. */
  on(listener: HubListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot(): SnapshotPayload {
    return {
      provider: this.provider,
      status: this.#status,
      clock: this.#clock,
      watchlist: [...this.#watchlist],
      quotes: this.#watchlist.flatMap((symbol) => {
        const quote = this.#quotes.get(symbol);
        return quote ? [{ ...quote }] : [];
      }),
    };
  }

  /**
   * Ticker/company search for the watchlist combobox. The provider's full listing is loaded on
   * first use and refreshed after a day; a failed load is retried on the next search.
   */
  async searchAssets(query: string, limit = 8): Promise<Asset[]> {
    const index = await this.#assetIndex();
    return index.search(query, limit);
  }

  #assetIndex(): Promise<AssetIndex> {
    if (this.#assets && this.#now() - this.#assets.loadedAt < ASSET_LIST_TTL_MS) {
      return Promise.resolve(this.#assets.index);
    }
    this.#assetsLoading ??= this.#provider
      .listAssets()
      .then((assets) => {
        const index = createAssetIndex(assets);
        this.#assets = { index, loadedAt: this.#now() };
        this.#log.info({ assets: index.size }, "asset listing loaded");
        return index;
      })
      .catch((err: unknown) => {
        this.#log.error({ err }, "asset listing failed");
        // Keep serving a stale listing rather than failing search outright.
        if (this.#assets) return this.#assets.index;
        throw err;
      })
      .finally(() => {
        this.#assetsLoading = null;
      });
    return this.#assetsLoading;
  }

  /** Starts loading the listing in the background (e.g. while Claude works), ignoring failure. */
  warmAssets(): void {
    this.#assetIndex().catch(() => {
      // Logged by #assetIndex; verifyListed retries and falls back to per-ticker checks.
    });
  }

  /**
   * Which `symbols` are listed equities this provider serves, without touching the watchlist:
   * the asset, or null when not listed. Symbols whose check failed (provider unreachable) are
   * left out, so callers can keep them rather than throw away minutes of AI work over a network
   * blip. Uses the cached listing; when it can't load, checks each ticker on its own.
   */
  async verifyListed(symbols: readonly string[]): Promise<Map<string, Asset | null>> {
    const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))];
    const result = new Map<string, Asset | null>();
    try {
      const index = await this.#assetIndex();
      for (const symbol of unique) {
        const [best] = index.search(symbol, 1);
        result.set(symbol, best?.symbol.toUpperCase() === symbol ? best : null);
      }
      return result;
    } catch (err) {
      this.#log.warn({ err }, "asset listing unavailable; checking tickers one by one");
    }
    for (const symbol of unique) {
      try {
        result.set(symbol, await this.#provider.getAsset(symbol));
      } catch (err) {
        this.#log.warn({ err, symbol }, "ticker check failed");
      }
    }
    return result;
  }

  /**
   * One-off quotes for any symbols, without subscribing them. Quotes are optional context, so a
   * failure is logged and yields an empty map.
   */
  async getQuotes(symbols: readonly string[]): Promise<Map<string, QuoteSnapshot>> {
    const unique = [...new Set(symbols)];
    if (unique.length === 0) return new Map();
    try {
      const snapshots = await this.#provider.getSnapshots(unique);
      return new Map(snapshots.map((snapshot) => [snapshot.symbol, snapshot]));
    } catch (err) {
      this.#log.warn({ err, symbols: unique.length }, "quote request failed");
      return new Map();
    }
  }

  /**
   * The provider's headlines for `symbol` from the last 30 days, newest first. News is optional
   * context for the AI outlook, so a failure is logged and yields no headlines.
   */
  async getNews(symbol: string): Promise<NewsItem[]> {
    try {
      return await this.#provider.getNews(
        symbol,
        new Date(this.#now() - NEWS_LOOKBACK_MS),
        NEWS_LIMIT,
      );
    } catch (err) {
      this.#log.warn({ err, symbol }, "news request failed");
      return [];
    }
  }

  #dividends: DividendCache | null = null;

  /**
   * Cash dividends per symbol (ADR 0022): about 15 months back and 4 months ahead, cached for 6
   * hours, one provider call for whatever isn't cached. Optional context: on failure the
   * uncached symbols are left out (unknown), never reported as paying nothing.
   */
  getDividends(symbols: readonly string[]): Promise<Map<string, DividendPayment[]>> {
    this.#dividends ??= createDividendCache({
      provider: this.#provider,
      logger: this.#log,
      now: this.#now,
      failure: "dividend request failed",
    });
    const now = this.#now();
    return this.#dividends.get(
      symbols,
      {
        fromDay: nyDay(now - DIVIDEND_LOOKBACK_DAYS * DAY),
        toDay: nyDay(now + DIVIDEND_LOOKAHEAD_DAYS * DAY),
      },
      () => true,
    );
  }

  #dividendHistory: DividendHistory | null = null;

  /**
   * Cash dividends paid since `fromDay` (ADR 0025), for dividends received: its own 6-hour cache,
   * as far back as asked. Symbols the provider couldn't be asked about are left out (unknown).
   */
  getDividendHistory(
    symbols: readonly string[],
    fromDay: string,
  ): Promise<Map<string, DividendPayment[]>> {
    this.#dividendHistory ??= createDividendHistory({
      provider: this.#provider,
      logger: this.#log.child({ mod: "dividend-history" }),
      now: this.#now,
    });
    return this.#dividendHistory.get(symbols, fromDay);
  }

  #dailyCloses: DailyCloses | null = null;

  /**
   * Daily closes from `fromDay` to today for any symbols, watched or not (ADR 0024): stored daily
   * history plus REST downloads of what is missing, and today's latest price.
   */
  getDailyCloses(symbols: readonly string[], fromDay: string): Promise<DailyClosesResult> {
    this.#dailyCloses ??= createDailyCloses({
      provider: this.#provider,
      db: this.#db,
      logger: this.#log.child({ mod: "daily-closes" }),
      now: this.#now,
    });
    return this.#dailyCloses.get(symbols, fromDay);
  }

  async addSymbol(input: string): Promise<AddSymbolResult> {
    const parsed = SymbolSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        code: "invalid",
        message: parsed.error.issues[0]?.message ?? "Invalid symbol",
      };
    }
    const symbol = parsed.data;

    let asset: Asset | null;
    try {
      asset = await this.#provider.getAsset(symbol);
    } catch (err) {
      this.#log.error({ err, symbol }, "asset lookup failed");
      return {
        ok: false,
        code: "upstream",
        message: `Couldn't check ${symbol} with ${this.#provider.displayName}. Try again in a moment.`,
      };
    }
    if (!asset) {
      return {
        ok: false,
        code: "unknown",
        message: `${symbol} isn't an active NYSE or Nasdaq listing. Check the ticker.`,
      };
    }

    const result = await addToWatchlist(this.#db, symbol, this.#provider.maxSymbols);
    if (!result.ok) return result;

    this.#watchlist = [...this.#watchlist, symbol];
    this.#quotes.set(symbol, emptyQuote(symbol));
    this.#provider.subscribe([symbol]);
    this.#emitWatchlist();
    void this.#refreshQuotes([symbol]);
    void this.#backfillThenNotify([symbol]);
    this.#log.info({ symbol }, "symbol added");
    return { ok: true, symbol };
  }

  async removeSymbol(symbol: string): Promise<boolean> {
    const removed = await removeFromWatchlist(this.#db, symbol);
    if (!removed) return false;
    this.#watchlist = this.#watchlist.filter((entry) => entry !== symbol);
    this.#alerts.forgetSymbol(symbol);
    this.#quotes.delete(symbol);
    this.#provider.unsubscribe([symbol]);
    this.#emitWatchlist();
    this.#log.info({ symbol }, "symbol removed");
    return true;
  }

  async reorder(symbols: readonly string[]): Promise<boolean> {
    const ok = await reorderWatchlist(this.#db, symbols);
    if (ok) {
      this.#watchlist = [...symbols];
      this.#emitWatchlist();
    }
    return ok;
  }

  #emit(event: StreamEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        this.#log.error({ err, event: event.event }, "hub listener failed");
      }
    }
  }

  /**
   * Backfills, then tells charts to reload. Used on startup and symbol add, where a chart may
   * already be open on near-empty history; not on the periodic refresh, which would reset zoom.
   */
  async #backfillThenNotify(symbols: readonly string[]): Promise<void> {
    if (symbols.length === 0) return;
    await this.#backfill.enqueue(symbols);
    const stillWatched = symbols.filter((symbol) => this.#watchlist.includes(symbol));
    if (stillWatched.length > 0) this.#emit({ event: "history", data: { symbols: stillWatched } });
  }

  #emitWatchlist(): void {
    this.#emit({ event: "watchlist", data: { symbols: [...this.#watchlist] } });
  }

  async #refreshQuotes(symbols: readonly string[]): Promise<void> {
    if (symbols.length === 0) return;
    try {
      for (const snapshot of await this.#provider.getSnapshots(symbols)) {
        if (!this.#quotes.has(snapshot.symbol)) continue;
        const current = this.#quotes.get(snapshot.symbol);
        // A live tick newer than the snapshot wins.
        const merged =
          current?.lastTs && snapshot.lastTs && current.lastTs > snapshot.lastTs
            ? { ...snapshot, lastPrice: current.lastPrice, lastTs: current.lastTs }
            : snapshot;
        this.#quotes.set(snapshot.symbol, merged);
        this.#emit({ event: "quote", data: { ...merged } });
      }
    } catch (err) {
      this.#log.error({ err }, "quote snapshot failed");
    }
  }

  async #pollClock(): Promise<void> {
    let delay = CLOCK_RETRY_MS;
    try {
      const clock = await this.#provider.getClock();
      const phaseChanged = this.#clock?.phase !== clock.phase;
      this.#clock = clock;
      this.#emit({ event: "market", data: clock });
      // New session → previous close moves; refresh quotes so change vs. previous close stays right.
      if (phaseChanged && this.#started) void this.#refreshQuotes(this.#watchlist);
      if (clock.phaseUntil !== null) {
        const untilChange = clock.phaseUntil - this.#now() + 1000 + Math.random() * 4000;
        delay = Math.min(CLOCK_MAX_DELAY_MS, Math.max(CLOCK_MIN_DELAY_MS, untilChange));
      } else {
        delay = CLOCK_MAX_DELAY_MS;
      }
    } catch (err) {
      this.#log.error({ err }, "market clock request failed");
    }
    // A poll in flight during stop() must not re-arm the timer.
    if (this.#stopped) return;
    this.#clockTimer = setTimeout(() => void this.#pollClock(), delay);
  }
}

function emptyQuote(symbol: string): QuoteSnapshot {
  return { symbol, lastPrice: null, lastTs: null, previousClose: null };
}
