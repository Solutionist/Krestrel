import { readFileSync } from "node:fs";

import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { assetToAsset, clockToMarketClock, snapshotToQuote, toBar, tradeToTick } from "./normalize";
import {
  AssetResponseSchema,
  ClockResponseSchema,
  parseStreamFrame,
  SnapshotsResponseSchema,
  type StreamMessage,
} from "./schemas";

const log = pino({ level: "silent" });

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../../../tests/fixtures/alpaca/${name}`, import.meta.url),
    "utf8",
  );
}

function streamMessages(name: string): StreamMessage[] {
  return parseStreamFrame(fixture(name), log);
}

describe("stream normalization", () => {
  it("turns trades into ticks with epoch ms, truncating nanosecond fractions", () => {
    const ticks = streamMessages("stream-trades.json").flatMap((message) =>
      message.T === "t" ? [tradeToTick(message)] : [],
    );
    expect(ticks).toEqual([
      { symbol: "AAPL", price: 126.55, size: 1, ts: Date.UTC(2021, 1, 22, 15, 51, 44, 208) },
      { symbol: "SPY", price: 389.115, size: 100, ts: Date.UTC(2021, 1, 22, 15, 51, 45, 335) },
    ]);
  });

  it("maps minute bars and their late updates onto the same minute-start key", () => {
    const bars = [
      ...streamMessages("stream-bar.json"),
      ...streamMessages("stream-updated-bar.json"),
    ].flatMap((message) =>
      message.T === "b" || message.T === "u" ? [toBar(message.S, message, "alpaca_iex")] : [],
    );
    const minute = Date.UTC(2021, 1, 22, 19, 15);
    expect(bars).toEqual([
      {
        symbol: "SPY",
        source: "alpaca_iex",
        ts: minute,
        open: 388.985,
        high: 389.13,
        low: 388.975,
        close: 389.12,
        volume: 49378,
        tradeCount: 461,
        vwap: 389.062639,
      },
      expect.objectContaining({ symbol: "SPY", ts: minute, close: 389.15, volume: 49512 }),
    ]);
  });

  it("uses null for missing trade count and vwap", () => {
    const bar = toBar(
      "AAPL",
      { t: "2021-02-22T15:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      "alpaca_sip",
    );
    expect(bar.tradeCount).toBeNull();
    expect(bar.vwap).toBeNull();
  });
});

describe("REST normalization", () => {
  it("reads last price from the latest trade and previous close from the prior daily bar", () => {
    const snapshots = SnapshotsResponseSchema.parse(JSON.parse(fixture("rest-snapshots.json")));
    const quotes = Object.entries(snapshots).flatMap(([symbol, snapshot]) =>
      snapshot ? [snapshotToQuote(symbol, snapshot)] : [],
    );
    expect(quotes).toEqual([
      {
        symbol: "AAPL",
        lastPrice: 126,
        lastTs: Date.UTC(2021, 1, 22, 20, 59, 59, 932),
        previousClose: 129.87,
      },
      { symbol: "TSLA", lastPrice: null, lastTs: null, previousClose: 781.3 },
    ]);
  });

  it("converts the v3 clock's ET offsets to epoch ms", () => {
    const [clock] = ClockResponseSchema.parse(JSON.parse(fixture("rest-clock-v3.json"))).clocks;
    expect(clock).toBeDefined();
    if (!clock) return;
    expect(clockToMarketClock(clock)).toEqual({
      phase: "pre",
      phaseUntil: Date.UTC(2025, 5, 24, 13, 30),
      nextOpen: Date.UTC(2025, 5, 24, 13, 30),
      nextClose: Date.UTC(2025, 5, 24, 20, 0),
    });
  });

  it.each([
    ["core", "open"],
    ["lunch", "open"],
    ["post", "post"],
    ["closed", "closed"],
  ] as const)("maps the %s phase to %s", (phase, expected) => {
    expect(clockToMarketClock({ phase, phase_until: null }).phase).toBe(expected);
  });

  it("accepts only active, tradable US equities on supported exchanges", () => {
    const aapl = AssetResponseSchema.parse(JSON.parse(fixture("rest-asset-aapl.json")));
    expect(assetToAsset(aapl)).toEqual({
      symbol: "AAPL",
      name: "Apple Inc. Common Stock",
      exchange: "NASDAQ",
    });
    expect(assetToAsset({ ...aapl, status: "inactive" })).toBeNull();
    expect(assetToAsset({ ...aapl, tradable: false })).toBeNull();
    expect(assetToAsset({ ...aapl, exchange: "OTC" })).toBeNull();
    expect(assetToAsset({ ...aapl, class: "crypto" })).toBeNull();
  });
});
