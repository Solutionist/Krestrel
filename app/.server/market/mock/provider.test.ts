import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bar, ConnectionStatus, Tick } from "~/lib/market";
import type { MarketDataProvider, ProviderHandlers } from "../provider";
import { createMockProvider, type MockDeps } from "./provider";

const logger = pino({ level: "silent" });

function makeProvider(env: Record<string, string> = {}, deps: Partial<MockDeps> = {}) {
  return createMockProvider({ env, logger }, deps);
}

async function collectBars(
  provider: MarketDataProvider,
  symbols: string[],
  start: string,
  end: string,
): Promise<Bar[]> {
  const bars: Bar[] = [];
  for await (const page of provider.getBars(symbols, new Date(start), new Date(end))) {
    expect(page.length).toBeLessThanOrEqual(10_000);
    bars.push(...page);
  }
  return bars;
}

function recorder() {
  const ticks: Tick[] = [];
  const bars: Bar[] = [];
  const statuses: ConnectionStatus[] = [];
  const handlers: ProviderHandlers = {
    onTick: (tick) => ticks.push(tick),
    onBar: (bar) => bars.push(bar),
    onStatus: (status) => statuses.push(status),
  };
  return { ticks, bars, statuses, handlers };
}

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  weekday: "short",
  hour: "numeric",
});

afterEach(() => {
  vi.useRealTimers();
});

describe("config", () => {
  it("rejects a tick interval below 50 ms with a readable error", () => {
    expect(() => makeProvider({ MOCK_TICK_MS: "10" })).toThrow(/MOCK_TICK_MS/);
  });
});

describe("getBars", () => {
  it("returns identical bars for the same seed and different bars per symbol or seed", async () => {
    const range = ["2026-10-12T13:00:00Z", "2026-10-12T15:00:00Z"] as const;
    const a = await collectBars(makeProvider(), ["AAPL"], ...range);
    const b = await collectBars(makeProvider(), ["AAPL"], ...range);
    const other = await collectBars(makeProvider(), ["MSFT"], ...range);
    const reseeded = await collectBars(makeProvider({ MOCK_SEED: "7" }), ["AAPL"], ...range);

    expect(a).toHaveLength(120);
    expect(b).toEqual(a);
    expect(other.map((bar) => bar.close)).not.toEqual(a.map((bar) => bar.close));
    expect(reseeded.map((bar) => bar.close)).not.toEqual(a.map((bar) => bar.close));
  });

  it("agrees across overlapping windows and forms a continuous, valid OHLC path", async () => {
    const provider = makeProvider();
    const wide = await collectBars(
      provider,
      ["AAPL"],
      "2026-10-12T13:00:00Z",
      "2026-10-12T16:00:00Z",
    );
    const narrow = await collectBars(
      provider,
      ["AAPL"],
      "2026-10-12T14:00:00Z",
      "2026-10-12T14:30:00Z",
    );
    expect(wide.slice(60, 90)).toEqual(narrow);

    for (const [i, bar] of wide.entries()) {
      expect(bar.source).toBe("mock_hist");
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.low).toBeGreaterThan(0);
      const next = wide[i + 1];
      if (next) expect(next.open).toBe(bar.close);
    }
  });

  it("only emits weekday 04:00–20:00 New York minutes across the spring DST change", async () => {
    // Fri 2026-03-06 is EST (UTC−5); DST starts Sun 2026-03-08; Mon 2026-03-09 is EDT (UTC−4).
    const bars = await collectBars(
      makeProvider(),
      ["AAPL"],
      "2026-03-06T05:00:00Z",
      "2026-03-10T00:00:00Z",
    );

    expect(bars).toHaveLength(2 * 960);
    for (const bar of bars) {
      expect(bar.ts % 60_000).toBe(0);
      const parts = nyParts.formatToParts(bar.ts);
      const weekday = parts.find((part) => part.type === "weekday")?.value;
      const hour = Number(parts.find((part) => part.type === "hour")?.value);
      expect(["Sat", "Sun"]).not.toContain(weekday);
      expect(hour).toBeGreaterThanOrEqual(4);
      expect(hour).toBeLessThan(20);
    }
    const times = bars.map((bar) => new Date(bar.ts).toISOString());
    expect(times[0]).toBe("2026-03-06T09:00:00.000Z");
    expect(times[959]).toBe("2026-03-07T00:59:00.000Z");
    expect(times[960]).toBe("2026-03-09T08:00:00.000Z");
    expect(times[1919]).toBe("2026-03-09T23:59:00.000Z");
  });

  it("pages large requests at 10 000 bars in ascending time", async () => {
    const symbols = [
      "AAPL",
      "MSFT",
      "NVDA",
      "TSLA",
      "AMZN",
      "META",
      "GOOG",
      "AMD",
      "INTC",
      "NFLX",
      "IBM",
    ];
    const pages: Bar[][] = [];
    const start = new Date("2026-10-12T08:00:00Z");
    const end = new Date("2026-10-13T00:00:00Z");
    for await (const page of makeProvider().getBars(symbols, start, end)) pages.push(page);

    expect(pages.map((page) => page.length)).toEqual([10_000, 560]);
    const all = pages.flat();
    for (const [i, bar] of all.entries()) {
      const prev = all[i - 1];
      if (prev) expect(bar.ts).toBeGreaterThanOrEqual(prev.ts);
    }
  });
});

describe("live stream", () => {
  const T0 = Date.parse("2026-10-12T14:00:00Z");

  it("reports connecting, then live on the next tick, and connect is idempotent", async () => {
    vi.useFakeTimers({ now: T0 });
    const provider = makeProvider();
    const rec = recorder();
    provider.connect(rec.handlers);
    provider.connect(rec.handlers);
    expect(rec.statuses.map((s) => s.state)).toEqual(["connecting"]);

    await vi.advanceTimersByTimeAsync(0);
    expect(rec.statuses).toEqual([
      { state: "connecting", reason: expect.any(String), code: null, retryAt: null },
      { state: "live", reason: null, code: null, retryAt: null },
    ]);

    await provider.disconnect();
    expect(rec.statuses.at(-1)?.state).toBe("stopped");
    const tickCount = rec.ticks.length;
    provider.subscribe(["AAPL"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rec.ticks).toHaveLength(tickCount);
  });

  it("starts live ticks at the history price and walks in small positive steps", async () => {
    vi.useFakeTimers({ now: T0 });
    const provider = makeProvider();
    const [lastHist] = await collectBars(
      provider,
      ["AAPL"],
      "2026-10-12T13:59:00Z",
      "2026-10-12T14:00:00Z",
    );
    const rec = recorder();
    provider.subscribe(["AAPL"]);
    provider.connect(rec.handlers);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(rec.ticks).toHaveLength(30);
    const first = rec.ticks[0];
    expect(first && lastHist && Math.abs(first.price / lastHist.close - 1)).toBeLessThan(0.002);
    for (const [i, tick] of rec.ticks.entries()) {
      expect(tick.symbol).toBe("AAPL");
      expect(tick.price).toBeGreaterThan(0.01);
      expect(tick.size).toBeGreaterThanOrEqual(1);
      expect(tick.size).toBeLessThanOrEqual(500);
      const prev = rec.ticks[i - 1];
      if (prev) expect(Math.abs(tick.price / prev.price - 1)).toBeLessThan(0.002);
    }
  });

  it("emits exactly one completed bar per symbol on minute rollover, built from the ticks", async () => {
    vi.useFakeTimers({ now: T0 });
    const provider = makeProvider();
    const rec = recorder();
    provider.subscribe(["AAPL", "MSFT"]);
    provider.connect(rec.handlers);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(rec.bars).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(rec.bars).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rec.bars).toHaveLength(2);

    for (const symbol of ["AAPL", "MSFT"]) {
      const bar = rec.bars.find((b) => b.symbol === symbol);
      const ticks = rec.ticks.filter((t) => t.symbol === symbol && t.ts < T0 + 60_000);
      const prices = ticks.map((t) => t.price);
      const volume = ticks.reduce((sum, t) => sum + t.size, 0);
      const notional = ticks.reduce((sum, t) => sum + t.price * t.size, 0);
      expect(ticks).toHaveLength(59);
      expect(bar).toEqual({
        symbol,
        source: "mock_live",
        ts: T0,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices.at(-1),
        volume,
        tradeCount: 59,
        vwap: expect.closeTo(notional / volume, 8),
      });
    }
  });

  it("stops ticks for an unsubscribed symbol and resumes from its last price", async () => {
    vi.useFakeTimers({ now: T0 });
    const provider = makeProvider();
    const rec = recorder();
    provider.subscribe(["AAPL", "MSFT"]);
    provider.connect(rec.handlers);
    await vi.advanceTimersByTimeAsync(5_000);
    provider.unsubscribe(["MSFT"]);
    const msftBefore = rec.ticks.filter((t) => t.symbol === "MSFT");
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rec.ticks.filter((t) => t.symbol === "MSFT")).toEqual(msftBefore);
    expect(rec.bars.filter((b) => b.symbol === "MSFT")).toEqual([]);
    expect(rec.bars.filter((b) => b.symbol === "AAPL")).toHaveLength(2);

    provider.subscribe(["MSFT"]);
    await vi.advanceTimersByTimeAsync(1_000);
    const resumed = rec.ticks.filter((t) => t.symbol === "MSFT").at(-1);
    const lastBefore = msftBefore.at(-1);
    expect(resumed && lastBefore && Math.abs(resumed.price / lastBefore.price - 1)).toBeLessThan(
      0.002,
    );
  });

  it("applies subscriptions made before connect", async () => {
    vi.useFakeTimers({ now: T0 });
    const provider = makeProvider({}, { tickIntervalMs: 250 });
    const rec = recorder();
    provider.subscribe(["NVDA"]);
    provider.connect(rec.handlers);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rec.ticks.map((t) => t.symbol)).toEqual(["NVDA", "NVDA", "NVDA", "NVDA"]);
  });
});

describe("getSnapshots", () => {
  it("reports the walk price and the previous weekday's 16:00 close", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-12T14:00:00Z") }); // Monday
    const provider = makeProvider();
    const rec = recorder();
    provider.subscribe(["AAPL"]);
    provider.connect(rec.handlers);
    await vi.advanceTimersByTimeAsync(3_000);

    // Friday 2026-10-09 16:00 EDT = 20:00Z; the 15:59 bar closes at that price.
    const [closingBar] = await collectBars(
      provider,
      ["AAPL"],
      "2026-10-09T19:59:00Z",
      "2026-10-09T20:00:00Z",
    );
    const [snapshot] = await provider.getSnapshots(["AAPL"]);
    const lastTick = rec.ticks.at(-1);
    expect(snapshot).toEqual({
      symbol: "AAPL",
      lastPrice: lastTick?.price,
      lastTs: lastTick?.ts,
      previousClose: closingBar?.close,
    });
  });
});

describe("getClock", () => {
  const clockAt = (iso: string) => makeProvider({}, { now: () => Date.parse(iso) }).getClock();

  it.each([
    // Wed 2026-10-14, EDT (UTC−4)
    ["2026-10-14T07:59:59Z", "closed", "2026-10-14T08:00:00Z"],
    ["2026-10-14T08:00:00Z", "pre", "2026-10-14T13:30:00Z"],
    ["2026-10-14T13:29:59Z", "pre", "2026-10-14T13:30:00Z"],
    ["2026-10-14T13:30:00Z", "open", "2026-10-14T20:00:00Z"],
    ["2026-10-14T20:00:00Z", "post", "2026-10-15T00:00:00Z"],
    ["2026-10-15T00:00:00Z", "closed", "2026-10-15T08:00:00Z"],
    // Sat 2026-10-17 noon NY → Monday 04:00
    ["2026-10-17T16:00:00Z", "closed", "2026-10-19T08:00:00Z"],
    // Fri 2026-10-30 evening (EDT) → Mon 2026-11-02 04:00 EST, after the fall DST change
    ["2026-10-31T00:30:00Z", "closed", "2026-11-02T09:00:00Z"],
  ])("at %s is %s until %s", async (iso, phase, until) => {
    const clock = await clockAt(iso);
    expect(clock.phase).toBe(phase);
    expect(clock.phaseUntil).toBe(Date.parse(until));
  });

  it("computes the next open and close", async () => {
    const open = await clockAt("2026-10-14T15:00:00Z");
    expect(open.nextOpen).toBe(Date.parse("2026-10-15T13:30:00Z"));
    expect(open.nextClose).toBe(Date.parse("2026-10-14T20:00:00Z"));

    const weekend = await clockAt("2026-10-17T16:00:00Z");
    expect(weekend.nextOpen).toBe(Date.parse("2026-10-19T13:30:00Z"));
    expect(weekend.nextClose).toBe(Date.parse("2026-10-19T20:00:00Z"));
  });
});

describe("getAsset", () => {
  it("returns the real listing for known tickers", async () => {
    await expect(makeProvider().getAsset("AAPL")).resolves.toEqual({
      symbol: "AAPL",
      name: "Apple Inc.",
      exchange: "NASDAQ",
    });
  });

  it.each(["ZZZZ", "Q", "ABC.D"])(
    "accepts any well-formed ticker %s as simulated",
    async (symbol) => {
      await expect(makeProvider().getAsset(symbol)).resolves.toEqual({
        symbol,
        name: `${symbol} (mock)`,
        exchange: "MOCK",
      });
    },
  );

  it("lists every known listing for search, each resolvable by getAsset", async () => {
    const provider = makeProvider();
    const listing = await provider.listAssets();
    expect(listing.map((asset) => asset.symbol)).toContain("BRK.B");
    for (const asset of listing)
      await expect(provider.getAsset(asset.symbol)).resolves.toEqual(asset);
  });

  it.each(["", "aapl", "TOOLONG", "BRK.BBB", "A1", "BRK."])("rejects %j", async (symbol) => {
    await expect(makeProvider().getAsset(symbol)).resolves.toBeNull();
  });
});

describe("getDailyBars", () => {
  it("returns weekdays only, agreeing with the minute path at the 09:30 open and 16:00 close", async () => {
    const provider = makeProvider();
    const pages = [];
    // Fri Oct 9 .. Mon Oct 12 2026 (end exclusive): Fri + Mon only.
    for await (const page of provider.getDailyBars(["AAPL"], "2026-10-09", "2026-10-13"))
      pages.push(page);
    const days = pages.flat();
    expect(days.map((bar) => bar.day)).toEqual(["2026-10-09", "2026-10-12"]);

    const minutes = [];
    for await (const page of provider.getBars(
      ["AAPL"],
      new Date("2026-10-12T13:30:00Z"),
      new Date("2026-10-12T13:31:00Z"),
    ))
      minutes.push(page);
    expect(days[1]?.open).toBe(minutes.flat()[0]?.open);
    for (const bar of days) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
    }
  });
});
