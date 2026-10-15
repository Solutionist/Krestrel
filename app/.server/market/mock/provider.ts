// Offline market-data provider (MARKET_PROVIDER=mock): deterministic history plus a simulated
// live random walk. No network; useful for development and tests (ADR 0009).
import * as z from "zod";

import { parseConfig } from "~/.server/env-schema";
import type { Bar, ConnectionStatus, DailyBar, NewsItem, QuoteSnapshot, Tick } from "~/lib/market";
import type { MarketDataProvider, ProviderContext, ProviderHandlers } from "../provider";
import { MOCK_ASSETS } from "./assets";
import {
  CLOSE_MIN,
  isExtendedHoursMinute,
  marketClock,
  nyWallToEpoch,
  OPEN_MIN,
  previousWeekdayClose,
} from "./market-hours";
import { basePrice, createRandom, hashSymbol, hashToUnit } from "./random";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const PAGE_SIZE = 10_000;
const ASSET_SYMBOL = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

const MockConfigSchema = z.object({
  MOCK_SEED: z.coerce.number().int().default(42),
  MOCK_TICK_MS: z.coerce.number().int().min(50).default(1000),
});

export interface MockDeps {
  now(): number;
  random(): number;
  tickIntervalMs: number;
}

interface MinuteAggregate {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  notional: number;
}

const roundCents = (price: number) => Math.round(price * 100) / 100;

/**
 * Deterministic price at the start of minute `minuteIndex` (minutes since epoch). A stateless
 * function of (seed, symbol, minute) so any history window agrees with any other, and so live
 * ticks can start exactly where history leaves off.
 */
function pathPrice(seed: number, symbolHash: number, base: number, minuteIndex: number): number {
  const phase = (n: number) => hashToUnit(seed, symbolHash, n) * 2 * Math.PI;
  const drift =
    0.08 * Math.sin((2 * Math.PI * minuteIndex) / (390 * 7) + phase(1)) +
    0.025 * Math.sin((2 * Math.PI * minuteIndex) / 390 + phase(2)) +
    0.008 * Math.sin((2 * Math.PI * minuteIndex) / 37 + phase(3)) +
    0.002 * (hashToUnit(seed, symbolHash, minuteIndex) - 0.5);
  return Math.max(0.01, roundCents(base * Math.exp(drift)));
}

export function createMockProvider(
  context: ProviderContext,
  deps: Partial<MockDeps> = {},
): MarketDataProvider {
  const config = parseConfig(MockConfigSchema, context.env, "Mock provider");
  const log = context.logger.child({ mod: "mock" });
  const seed = config.MOCK_SEED;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? createRandom(seed);
  const tickIntervalMs = deps.tickIntervalMs ?? config.MOCK_TICK_MS;

  const subscribed = new Set<string>();
  const lastPrice = new Map<string, number>();
  const lastTickTs = new Map<string, number>();
  const aggregates = new Map<string, MinuteAggregate>();
  let handlers: ProviderHandlers | null = null;
  let startTimer: NodeJS.Timeout | undefined;
  let tickTimer: NodeJS.Timeout | undefined;

  const priceAt = (symbol: string, minuteIndex: number) =>
    pathPrice(seed, hashSymbol(symbol), basePrice(symbol), minuteIndex);

  const currentPrice = (symbol: string) =>
    lastPrice.get(symbol) ?? priceAt(symbol, Math.floor(now() / MINUTE_MS));

  function emitStatus(state: ConnectionStatus["state"], reason: string | null): void {
    handlers?.onStatus({ state, reason, code: null, retryAt: null });
  }

  function emitBar(symbol: string, agg: MinuteAggregate): void {
    handlers?.onBar({
      symbol,
      source: "mock_live",
      ts: agg.ts,
      open: agg.open,
      high: agg.high,
      low: agg.low,
      close: agg.close,
      volume: agg.volume,
      tradeCount: agg.tradeCount,
      vwap: agg.notional / agg.volume,
    });
  }

  function step(): void {
    const ts = now();
    const minute = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
    for (const symbol of subscribed) {
      const previous = currentPrice(symbol);
      // Small symmetric move (±0.1%), floored so the price never reaches zero.
      const price = Math.max(0.01, roundCents(previous * (1 + (random() - 0.5) * 0.002)));
      const size = 1 + Math.floor(random() * 500);
      lastPrice.set(symbol, price);
      lastTickTs.set(symbol, ts);

      let agg = aggregates.get(symbol);
      if (agg && agg.ts !== minute) {
        emitBar(symbol, agg);
        agg = undefined;
      }
      if (agg) {
        agg.high = Math.max(agg.high, price);
        agg.low = Math.min(agg.low, price);
        agg.close = price;
        agg.volume += size;
        agg.tradeCount += 1;
        agg.notional += price * size;
      } else {
        aggregates.set(symbol, {
          ts: minute,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: size,
          tradeCount: 1,
          notional: price * size,
        });
      }
      const tick: Tick = { symbol, price, size, ts };
      handlers?.onTick(tick);
    }
  }

  function stopTimers(): void {
    clearTimeout(startTimer);
    clearInterval(tickTimer);
    startTimer = undefined;
    tickTimer = undefined;
  }

  async function* getBars(
    symbols: readonly string[],
    start: Date,
    end: Date,
  ): AsyncIterable<Bar[]> {
    const endMs = end.getTime();
    let page: Bar[] = [];
    for (let ts = Math.ceil(start.getTime() / MINUTE_MS) * MINUTE_MS; ts < endMs; ts += MINUTE_MS) {
      if (!isExtendedHoursMinute(ts)) continue;
      const minuteIndex = ts / MINUTE_MS;
      for (const symbol of symbols) {
        const symbolHash = hashSymbol(symbol);
        const open = priceAt(symbol, minuteIndex);
        const close = priceAt(symbol, minuteIndex + 1);
        const wiggle = 1 + 0.001 * hashToUnit(seed, symbolHash, minuteIndex, 7);
        const high = roundCents(Math.max(open, close) * wiggle);
        const low = Math.max(0.01, roundCents(Math.min(open, close) / wiggle));
        const volume = 100 + Math.floor(hashToUnit(seed, symbolHash, minuteIndex, 11) * 20_000);
        page.push({
          symbol,
          source: "mock_hist",
          ts,
          open,
          high,
          low,
          close,
          volume,
          tradeCount: Math.max(1, Math.floor(volume / 100)),
          vwap: roundCents((open + high + low + close) / 4),
        });
        if (page.length >= PAGE_SIZE) {
          yield page;
          page = [];
        }
      }
    }
    if (page.length > 0) yield page;
  }

  /** Weekday daily bars that agree with the minute path: open 09:30, close 16:00 New York. */
  async function* getDailyBars(
    symbols: readonly string[],
    startDay: string,
    endDay: string,
  ): AsyncIterable<DailyBar[]> {
    const end = Date.parse(`${endDay}T00:00:00Z`);
    let page: DailyBar[] = [];
    for (let date = Date.parse(`${startDay}T00:00:00Z`); date < end; date += DAY_MS) {
      const weekday = new Date(date).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const openMinute = nyWallToEpoch(date + OPEN_MIN * MINUTE_MS) / MINUTE_MS;
      const closeMinute = nyWallToEpoch(date + CLOSE_MIN * MINUTE_MS) / MINUTE_MS;
      const day = new Date(date).toISOString().slice(0, 10);
      for (const symbol of symbols) {
        const symbolHash = hashSymbol(symbol);
        const open = priceAt(symbol, openMinute);
        const close = priceAt(symbol, closeMinute);
        const middle = priceAt(symbol, Math.round((openMinute + closeMinute) / 2));
        const wiggle = 1 + 0.01 * hashToUnit(seed, symbolHash, openMinute, 13);
        page.push({
          symbol,
          source: "mock_hist",
          day,
          open,
          high: roundCents(Math.max(open, close, middle) * wiggle),
          low: Math.max(0.01, roundCents(Math.min(open, close, middle) / wiggle)),
          close,
          volume: 1_000_000 + Math.floor(hashToUnit(seed, symbolHash, openMinute, 17) * 20_000_000),
        });
        if (page.length >= PAGE_SIZE) {
          yield page;
          page = [];
        }
      }
    }
    if (page.length > 0) yield page;
  }

  return {
    id: "mock",
    displayName: "Mock data",
    liveDataLabel: "Simulated data (MARKET_PROVIDER=mock)",
    maxSymbols: 30,
    liveSource: "mock_live",
    historySource: "mock_hist",
    historyDelayMs: 15 * MINUTE_MS,
    maxSymbolsPerHistoryRequest: 30,

    connect(nextHandlers) {
      handlers = nextHandlers;
      if (startTimer || tickTimer) return;
      emitStatus("connecting", "Starting simulated market data.");
      startTimer = setTimeout(() => {
        startTimer = undefined;
        tickTimer = setInterval(step, tickIntervalMs);
        log.info({ tickIntervalMs, seed }, "mock stream live");
        emitStatus("live", null);
      }, 0);
    },

    async disconnect() {
      stopTimers();
      aggregates.clear();
      emitStatus("stopped", "Simulated market data is stopped. Restart the app to resume.");
    },

    subscribe(symbols) {
      for (const symbol of symbols) subscribed.add(symbol);
    },

    unsubscribe(symbols) {
      for (const symbol of symbols) {
        subscribed.delete(symbol);
        // An unsubscribed minute is incomplete; drop it rather than emit a partial bar later.
        aggregates.delete(symbol);
      }
    },

    getBars,
    getDailyBars,

    async getSnapshots(symbols) {
      const previousCloseMinute = previousWeekdayClose(now()) / MINUTE_MS;
      return symbols.map(
        (symbol): QuoteSnapshot => ({
          symbol,
          lastPrice: currentPrice(symbol),
          lastTs: lastTickTs.get(symbol) ?? Math.floor(now() / MINUTE_MS) * MINUTE_MS,
          previousClose: priceAt(symbol, previousCloseMinute),
        }),
      );
    },

    async getClock() {
      return marketClock(now());
    },

    async getAsset(symbol) {
      if (!ASSET_SYMBOL.test(symbol)) return null;
      // Known listings keep their real name; any other well-formed ticker is accepted as simulated.
      return (
        MOCK_ASSETS.find((asset) => asset.symbol === symbol) ?? {
          symbol,
          name: `${symbol} (mock)`,
          exchange: "MOCK",
        }
      );
    },

    async listAssets() {
      return [...MOCK_ASSETS];
    },

    async getNews(symbol, since, limit) {
      // Fixed, clearly simulated headlines at fixed ages, so prompts and UI have something to show.
      const stories = [
        { days: 1, headline: `${symbol} trades in a narrow range (simulated)` },
        { days: 4, headline: `${symbol} schedules its quarterly results call (simulated)` },
        { days: 9, headline: `Analyst note on ${symbol} keeps its rating unchanged (simulated)` },
      ];
      const today = Math.floor(now() / DAY_MS) * DAY_MS;
      return stories
        .map(
          ({ days, headline }, index): NewsItem => ({
            id: `mock-${symbol}-${index}`,
            headline,
            summary: "Simulated headline from MARKET_PROVIDER=mock; not real news.",
            source: "mock",
            url: null,
            createdAt: new Date(today - days * DAY_MS + 14 * 60 * MINUTE_MS).toISOString(),
          }),
        )
        .filter((item) => Date.parse(item.createdAt) >= since.getTime())
        .slice(0, limit);
    },

    async getDividends(symbols, startDay, endDay) {
      // Simulated, deterministic per symbol: about 40% pay nothing, most others quarterly, some
      // monthly; 1–5% a year of the reference price. Like real companies, only payments up to a
      // month ahead are "announced", so the page also shows expected ones.
      const start = Date.parse(`${startDay}T00:00:00Z`);
      const end = Math.min(Date.parse(`${endDay}T00:00:00Z`), now() + 30 * DAY_MS);
      const anchor = Date.parse("2000-01-03T00:00:00Z");
      return symbols
        .flatMap((symbol) => {
          const hash = hashSymbol(symbol);
          const kind = hashToUnit(seed, hash, 7);
          if (kind < 0.4) return [];
          const stepDays = kind > 0.85 ? 30 : 91;
          const perYear = stepDays === 30 ? 12 : 4;
          const amount =
            roundCents((basePrice(symbol) * (0.01 + 0.04 * hashToUnit(seed, hash, 8))) / perYear) ||
            0.01;
          const offset = Math.floor(hashToUnit(seed, hash, 9) * stepDays) * DAY_MS;
          const first = Math.ceil((start - anchor - offset) / (stepDays * DAY_MS));
          const payments = [];
          for (let n = first; anchor + offset + n * stepDays * DAY_MS <= end; n++) {
            const ex = anchor + offset + n * stepDays * DAY_MS;
            payments.push({
              symbol,
              exDate: new Date(ex).toISOString().slice(0, 10),
              payDate: new Date(ex + 14 * DAY_MS).toISOString().slice(0, 10),
              amount,
              special: false,
            });
          }
          return payments;
        })
        .sort((a, b) => a.exDate.localeCompare(b.exDate));
    },
  };
}
