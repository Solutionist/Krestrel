import { describe, expect, it } from "vitest";

import type { Analysis } from "./analysis";
import type { Candle } from "./market";
import { describePoint, tradeContexts } from "./trade-context";

function candles(): Candle[] {
  // 60 falling closes (oversold), then a high-volume bottom, then recovery.
  return Array.from({ length: 80 }, (_, i) => {
    const close = i < 60 ? 160 - i : 100 + (i - 60) * 3;
    return {
      time: i,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: i === 60 ? 3000 : 1000,
    };
  });
}

const analysis: Analysis = {
  swingThreshold: 0.05,
  pivots: [],
  trades: [
    { id: "T1", buy: { time: 60, price: 99 }, sell: { time: 79, price: 158 }, returnFraction: 0.6 },
  ],
  levels: [{ id: "S1", kind: "support", price: 99.5, touches: 2, lastTouchTime: 60 }],
  trendSupport: null,
};

describe("tradeContexts", () => {
  it("reports the facts at the entry candle: oversold RSI, volume spike, below EMA50, at support", () => {
    const [context] = tradeContexts(candles(), analysis);
    expect(context?.bars).toBe(19);
    expect(context?.buy.rsi).toBeLessThan(30);
    expect(context?.buy.volumeRatio).toBeCloseTo(3);
    expect(context?.buy.vsEma50).toBeLessThan(-0.1);
    expect(context?.buy.nearLevel?.id).toBe("S1");
    expect(context?.sell.rsi).toBeGreaterThan(70);
    expect(context?.sell.nearLevel).toBeNull();
  });

  it("formats a compact fact line", () => {
    expect(
      describePoint({
        rsi: 27.4,
        volumeRatio: 2.06,
        vsEma50: -0.042,
        nearLevel: { id: "S1", distance: 0.002 },
      }),
    ).toBe("RSI 27 · vol 2.1× · 4.2% < EMA50 · at S1");
    expect(describePoint({ rsi: null, volumeRatio: null, vsEma50: null, nearLevel: null })).toBe(
      "",
    );
  });
});
