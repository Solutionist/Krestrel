import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { Asset, Bar, NewsItem, QuoteSnapshot } from "~/lib/market";
import type { StreamEvent } from "~/lib/stream-events";

import { setupTestDatabase } from "../../../tests/db/test-db";
import { getCandles } from "./db/queries/bars";
import { listWatchlist } from "./db/queries/watchlist";
import { MarketHub } from "./hub";
import type { MarketDataProvider, ProviderHandlers } from "./provider";

const db = setupTestDatabase();
const NOW = Date.parse("2026-10-14T18:00:00Z");
const MINUTE = 60_000;

function fakeProvider(overrides: Partial<MarketDataProvider> = {}) {
  let handlers: ProviderHandlers | undefined;
  const subscribed = new Set<string>();
  const provider: MarketDataProvider = {
    id: "fake",
    displayName: "Fake",
    liveDataLabel: "Fake data",
    maxSymbols: 2,
    liveSource: "fake_live",
    historySource: "fake_hist",
    historyDelayMs: 15 * MINUTE,
    maxSymbolsPerHistoryRequest: 30,
    connect: (h) => {
      handlers = h;
      h.onStatus({ state: "live", reason: null, code: null, retryAt: null });
    },
    disconnect: async () => {},
    subscribe: (symbols) => {
      for (const symbol of symbols) subscribed.add(symbol);
    },
    unsubscribe: (symbols) => {
      for (const symbol of symbols) subscribed.delete(symbol);
    },
    async *getBars(symbols, start) {
      yield symbols.map((symbol) => histBar(symbol, start.getTime(), 100));
    },
    async *getDailyBars(symbols, startDay) {
      yield symbols.map((symbol) => ({
        symbol,
        source: "fake_hist",
        day: startDay,
        open: 90,
        high: 95,
        low: 85,
        close: 92,
        volume: 1000,
      }));
    },
    getSnapshots: async (symbols): Promise<QuoteSnapshot[]> =>
      symbols.map((symbol) => ({
        symbol,
        lastPrice: 100,
        lastTs: NOW - MINUTE,
        previousClose: 90,
      })),
    getClock: async () => ({ phase: "open", phaseUntil: null, nextOpen: null, nextClose: null }),
    getAsset: async (symbol): Promise<Asset | null> =>
      symbol === "NOPE" ? null : { symbol, name: symbol, exchange: "NASDAQ" },
    listAssets: async (): Promise<Asset[]> => [
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
      { symbol: "AMD", name: "Advanced Micro Devices, Inc.", exchange: "NASDAQ" },
    ],
    getNews: async (): Promise<NewsItem[]> => [],
    ...overrides,
  };
  const live = () => {
    if (!handlers) throw new Error("hub never connected");
    return handlers;
  };
  return { provider, subscribed, live };
}

function histBar(symbol: string, ts: number, close: number, source = "fake_hist"): Bar {
  return {
    symbol,
    source,
    ts,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
    tradeCount: 1,
    vwap: close,
  };
}

async function startedHub(provider: MarketDataProvider) {
  const hub = new MarketHub({
    provider,
    db,
    logger: pino({ level: "silent" }),
    backfillDays: 1,
    dailyHistoryYears: 1,
    now: () => NOW,
  });
  const events: StreamEvent[] = [];
  hub.on((event) => {
    if (event.event !== "shutdown") events.push(event);
  });
  await hub.start();
  return { hub, events };
}

describe("MarketHub watchlist", () => {
  it("validates symbols and enforces the provider's own symbol limit", async () => {
    const lookupFailure = vi.fn(async () => {
      throw new Error("network down");
    });
    const { provider } = fakeProvider();
    const { hub } = await startedHub(provider);

    expect(await hub.addSymbol("not a ticker")).toMatchObject({ ok: false, code: "invalid" });
    expect(await hub.addSymbol("NOPE")).toMatchObject({ ok: false, code: "unknown" });
    expect(await hub.addSymbol("aapl")).toEqual({ ok: true, symbol: "AAPL" });
    expect(await hub.addSymbol("MSFT")).toMatchObject({ ok: true });
    expect(await hub.addSymbol("NVDA")).toMatchObject({ ok: false, code: "limit" });

    provider.getAsset = lookupFailure;
    expect(await hub.addSymbol("TSLA")).toMatchObject({ ok: false, code: "upstream" });
    await hub.stop();
  });

  it("subscribes, backfills history, and announces an added symbol", async () => {
    const { provider, subscribed } = fakeProvider();
    const { hub, events } = await startedHub(provider);

    await hub.addSymbol("AAPL");
    await vi.waitFor(async () => {
      const candles = await getCandles(db, {
        symbol: "AAPL",
        timeframe: "1m",
        from: new Date(NOW - 2 * 24 * 60 * MINUTE),
        to: new Date(NOW),
        historySource: "fake_hist",
        liveSource: "fake_live",
      });
      expect(candles).toHaveLength(1);
    });

    expect([...subscribed]).toEqual(["AAPL"]);
    expect(events).toContainEqual({ event: "watchlist", data: { symbols: ["AAPL"] } });
    expect(hub.snapshot().quotes).toEqual([
      { symbol: "AAPL", lastPrice: 100, lastTs: NOW - MINUTE, previousClose: 90 },
    ]);
    await hub.stop();
  });

  it("resubscribes the stored watchlist on start", async () => {
    const first = fakeProvider();
    const { hub } = await startedHub(first.provider);
    await hub.addSymbol("AAPL");
    await hub.addSymbol("MSFT");
    await hub.stop();

    const second = fakeProvider();
    const { hub: restarted } = await startedHub(second.provider);
    expect([...second.subscribed]).toEqual(["AAPL", "MSFT"]);
    expect(restarted.snapshot().watchlist).toEqual(["AAPL", "MSFT"]);
    await restarted.stop();
  });

  it("unsubscribes a removed symbol and stops forwarding its ticks", async () => {
    const { provider, subscribed, live } = fakeProvider();
    const { hub, events } = await startedHub(provider);
    await hub.addSymbol("AAPL");

    expect(await hub.removeSymbol("AAPL")).toBe(true);
    expect(await hub.removeSymbol("AAPL")).toBe(false);
    live().onTick({ symbol: "AAPL", price: 101, size: 1, ts: NOW });

    expect(subscribed.size).toBe(0);
    expect(events.filter((event) => event.event === "tick")).toEqual([]);
    expect(await listWatchlist(db)).toEqual([]);
    await hub.stop();
  });
});

describe("MarketHub symbol search", () => {
  it("loads the provider listing once and serves later searches from the cache", async () => {
    const { provider } = fakeProvider();
    const listAssets = vi.spyOn(provider, "listAssets");
    const { hub } = await startedHub(provider);

    const [first, second] = await Promise.all([hub.searchAssets("a"), hub.searchAssets("adv")]);
    expect(first.map((asset) => asset.symbol)).toEqual(["AMD", "AAPL"]);
    expect(second.map((asset) => asset.symbol)).toEqual(["AMD"]);
    await hub.searchAssets("apple");
    expect(listAssets).toHaveBeenCalledTimes(1);
    await hub.stop();
  });

  it("fails the search when the first listing load fails, and retries next time", async () => {
    const { provider } = fakeProvider();
    const listAssets = vi
      .spyOn(provider, "listAssets")
      .mockRejectedValueOnce(new Error("trading API down"));
    const { hub } = await startedHub(provider);

    await expect(hub.searchAssets("a")).rejects.toThrow("trading API down");
    await expect(hub.searchAssets("a")).resolves.toHaveLength(2);
    expect(listAssets).toHaveBeenCalledTimes(2);
    await hub.stop();
  });
});

describe("MarketHub live data", () => {
  it("forwards ticks for watched symbols and updates the quote", async () => {
    const { provider, live } = fakeProvider();
    const { hub, events } = await startedHub(provider);
    await hub.addSymbol("AAPL");

    live().onTick({ symbol: "AAPL", price: 101.25, size: 5, ts: NOW + 1000 });
    live().onTick({ symbol: "ZZZZ", price: 1, size: 1, ts: NOW + 1000 });

    expect(events.filter((event) => event.event === "tick").map((event) => event.data)).toEqual([
      { symbol: "AAPL", price: 101.25, size: 5, ts: NOW + 1000 },
    ]);
    expect(hub.snapshot().quotes[0]).toMatchObject({ lastPrice: 101.25, lastTs: NOW + 1000 });
    await hub.stop();
  });

  it("persists live bars, with late corrections replacing the same minute", async () => {
    const { provider, live } = fakeProvider();
    const { hub } = await startedHub(provider);
    const minute = NOW - 5 * MINUTE;

    live().onBar(histBar("AAPL", minute, 50, "fake_live"));
    live().onBar(histBar("AAPL", minute, 51, "fake_live"));
    await hub.stop(); // flushes the bar writer

    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1m",
      from: new Date(minute),
      to: new Date(minute + MINUTE),
      historySource: "fake_hist",
      liveSource: "fake_live",
    });
    expect(candles.map((candle) => candle.close)).toEqual([51]);
  });
});

describe("MarketHub news", () => {
  const hubFor = (provider: MarketDataProvider) =>
    new MarketHub({
      provider,
      db,
      logger: pino({ level: "silent" }),
      backfillDays: 1,
      dailyHistoryYears: 1,
      now: () => NOW,
    });

  it("asks the provider for the last 30 days, at most 20 headlines", async () => {
    const getNews = vi.fn<MarketDataProvider["getNews"]>(async () => []);
    const { provider } = fakeProvider({ getNews });
    await hubFor(provider).getNews("AAPL");
    expect(getNews).toHaveBeenCalledWith("AAPL", new Date(NOW - 30 * 24 * 60 * MINUTE), 20);
  });

  it("returns no headlines instead of failing when the feed is down", async () => {
    const { provider } = fakeProvider({
      getNews: async () => {
        throw new Error("HTTP 500");
      },
    });
    await expect(hubFor(provider).getNews("AAPL")).resolves.toEqual([]);
  });
});

describe("MarketHub lookups for ideas", () => {
  it("verifies exact tickers against the listing, never by prefix", async () => {
    const { provider } = fakeProvider();
    const { hub } = await startedHub(provider);
    const checked = await hub.verifyListed(["amd", "AA"]);
    expect(checked.get("AMD")).toEqual({
      symbol: "AMD",
      name: "Advanced Micro Devices, Inc.",
      exchange: "NASDAQ",
    });
    expect(checked.get("AA")).toBeNull();
    expect(hub.snapshot().watchlist).toEqual([]);
    await hub.stop();
  });

  it("checks tickers one by one when the listing can't load, leaving out ones it can't check", async () => {
    const { provider } = fakeProvider();
    vi.spyOn(provider, "listAssets").mockRejectedValue(new Error("trading API down"));
    const getAsset = vi.spyOn(provider, "getAsset").mockImplementation(async (symbol) => {
      if (symbol === "JNJ") throw new Error("socket hang up");
      return symbol === "AMD"
        ? { symbol: "AMD", name: "Advanced Micro Devices, Inc.", exchange: "NASDAQ" }
        : null;
    });
    const { hub } = await startedHub(provider);
    const checked = await hub.verifyListed(["AMD", "ZZZQ", "JNJ"]);
    expect(checked.get("AMD")?.exchange).toBe("NASDAQ");
    expect(checked.get("ZZZQ")).toBeNull();
    expect(checked.has("JNJ")).toBe(false);
    expect(getAsset).toHaveBeenCalledTimes(3);
    await hub.stop();
  });

  it("quotes symbols without subscribing them, and yields no quotes when the provider fails", async () => {
    const { provider, subscribed } = fakeProvider();
    const { hub } = await startedHub(provider);
    const quotes = await hub.getQuotes(["JNJ", "XOM", "JNJ"]);
    expect([...quotes.keys()]).toEqual(["JNJ", "XOM"]);
    expect(subscribed.size).toBe(0);

    vi.spyOn(provider, "getSnapshots").mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(hub.getQuotes(["JNJ"])).resolves.toEqual(new Map());
    await hub.stop();
  });
});
