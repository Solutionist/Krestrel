import { describe, expect, it } from "vitest";

import {
  analyzeChart,
  bestTrades,
  type Pivot,
  supportResistance,
  swingPivots,
  trendSupport,
} from "./analysis";
import type { Candle } from "./market";

/** Candles whose high/low equal the given close path (time = index). */
function path(closes: number[]): Candle[] {
  return closes.map((close, index) => ({
    time: index,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

const pivot = (index: number, price: number, kind: Pivot["kind"]): Pivot => ({
  index,
  time: index,
  price,
  kind,
  confirmed: true,
});

describe("swingPivots", () => {
  it("alternates highs and lows, ignoring moves smaller than the threshold", () => {
    // 100 → 120 (+20%) → 119 (noise) → 90 (−25%) → 110 (+22%)
    const pivots = swingPivots(path([100, 110, 120, 119, 120, 100, 90, 95, 110]), 0.1);
    expect(pivots.map((p) => [p.kind, p.price, p.confirmed])).toEqual([
      ["low", 100, true],
      ["high", 120, true],
      ["low", 90, true],
      ["high", 110, false],
    ]);
  });

  it("uses the bar's high for swing highs and low for swing lows", () => {
    const candles: Candle[] = [
      { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { time: 1, open: 100, high: 130, low: 100, close: 125, volume: 1 },
      { time: 2, open: 125, high: 126, low: 80, close: 85, volume: 1 },
    ];
    const pivots = swingPivots(candles, 0.1);
    expect(pivots.map((p) => [p.kind, p.price])).toEqual([
      ["low", 99],
      ["high", 130],
      ["low", 80],
    ]);
  });
});

describe("bestTrades", () => {
  const pivots = [
    pivot(0, 100, "low"),
    pivot(1, 110, "high"), // +10%
    pivot(2, 50, "low"),
    pivot(3, 150, "high"), // +200%
    pivot(4, 140, "low"),
    pivot(5, 154, "high"), // +10%
  ];

  it("picks the single most profitable round trip, holding through a shallow dip", () => {
    // 50 → 154 (+208%) beats 50 → 150 (+200%): the 150 → 140 dip is worth holding through.
    const [trade, ...rest] = bestTrades(pivots, 1);
    expect(rest).toEqual([]);
    expect(trade).toMatchObject({
      id: "T1",
      buy: { time: 2, price: 50 },
      sell: { time: 5, price: 154 },
    });
    expect(trade?.returnFraction).toBeCloseTo(2.08);
  });

  it("finds the best non-overlapping set and numbers trades in time order", () => {
    // (100 → 110) + (50 → 154) = log 1.10 + log 3.08 beats (50 → 150) + (140 → 154).
    expect(bestTrades(pivots, 2).map((t) => [t.id, t.buy.time, t.sell.time])).toEqual([
      ["T1", 0, 1],
      ["T2", 2, 5],
    ]);
    // With room for three, every profitable swing is taken.
    expect(bestTrades(pivots, 3).map((t) => [t.buy.time, t.sell.time])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("prefers one long trade over two shorter ones when it returns more", () => {
    // Buy 100 → sell 300 beats (100 → 150) + (140 → 300)? log(3)=1.10 vs log(1.5)+log(2.14)=1.17 → two trades win.
    // And with k = 1 the long trade is chosen.
    const swings = [
      pivot(0, 100, "low"),
      pivot(1, 150, "high"),
      pivot(2, 140, "low"),
      pivot(3, 300, "high"),
    ];
    expect(bestTrades(swings, 1).map((t) => [t.buy.price, t.sell.price])).toEqual([[100, 300]]);
    expect(bestTrades(swings, 2).map((t) => [t.buy.price, t.sell.price])).toEqual([
      [100, 150],
      [140, 300],
    ]);
  });

  it("returns nothing when price only fell", () => {
    expect(bestTrades([pivot(0, 100, "high"), pivot(1, 80, "low")], 3)).toEqual([]);
  });
});

describe("supportResistance", () => {
  const pivots = [
    pivot(0, 100.2, "low"),
    pivot(1, 120, "high"),
    pivot(2, 99.8, "low"),
    pivot(3, 119.5, "high"),
    pivot(4, 100.1, "low"),
    pivot(5, 140, "high"), // single touch: no level
  ];

  it("clusters repeated swing prices into levels on each side of the last close", () => {
    expect(
      supportResistance(pivots, 110, 1).map((l) => [l.id, l.kind, Math.round(l.price), l.touches]),
    ).toEqual([
      ["S1", "support", 100, 3],
      ["R1", "resistance", 120, 2],
    ]);
  });
});

describe("trendSupport", () => {
  it("draws a rising line through the last two higher lows, extended to the last candle", () => {
    const candles = path([100, 120, 110, 130, 120, 140, 135]);
    const line = trendSupport(candles, [
      pivot(0, 100, "low"),
      pivot(2, 110, "low"),
      pivot(4, 120, "low"),
    ]);
    expect(line).toEqual({
      from: { time: 2, price: 110 },
      to: { time: 6, price: 130 },
      broken: false,
    });
  });

  it("is null when the last two lows fall, and marks a close below the line as broken", () => {
    const candles = path([100, 120, 110, 130, 90]);
    expect(trendSupport(candles, [pivot(0, 100, "low"), pivot(2, 95, "low")])).toBeNull();
    expect(trendSupport(candles, [pivot(0, 100, "low"), pivot(2, 110, "low")])?.broken).toBe(true);
  });
});

describe("analyzeChart", () => {
  it("returns empty results for short histories instead of guessing", () => {
    expect(analyzeChart(path([1, 2, 3]))).toMatchObject({
      trades: [],
      levels: [],
      trendSupport: null,
    });
  });

  it("finds round trips on a clear oscillation", () => {
    const wave = Array.from({ length: 120 }, (_, i) => 100 + 20 * Math.sin(i / 8));
    const result = analyzeChart(path(wave), 3);
    expect(result.trades).toHaveLength(3);
    for (const trade of result.trades) {
      expect(trade.sell.time).toBeGreaterThan(trade.buy.time);
      // Troughs ≈ 80, peaks ≈ 120 (the first trade may start mid-wave at 100).
      expect(trade.returnFraction).toBeGreaterThan(0.15);
    }
  });
});
