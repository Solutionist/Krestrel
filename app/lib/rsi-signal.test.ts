import { describe, expect, it } from "vitest";

import { bucketStart } from "./candles";
import {
  DEFAULT_RSI_LEVELS,
  liveCloses,
  RsiLevelsSchema,
  rsiCrosses,
  rsiSignal,
} from "./rsi-signal";

const levels = DEFAULT_RSI_LEVELS;

describe("rsiSignal", () => {
  it("reports the zone while RSI is inside it, boundaries included", () => {
    expect(rsiSignal([50, 40, 30], levels)).toMatchObject({ kind: "oversold", rsi: 30 });
    expect(rsiSignal([50, 60, 70], levels)).toMatchObject({ kind: "overbought", rsi: 70 });
  });

  it("signals buy/sell when RSI leaves a zone, and only while fresh", () => {
    expect(rsiSignal([40, 28, 33], levels)).toEqual({ kind: "buy", rsi: 33, barsAgo: 0 });
    expect(rsiSignal([60, 75, 68, 66, 64], levels)).toEqual({ kind: "sell", rsi: 64, barsAgo: 2 });
    expect(rsiSignal([60, 75, 68, 66, 64, 62], levels)).toMatchObject({ kind: "neutral" });
  });

  it("uses the most recent cross and the configured levels", () => {
    expect(rsiSignal([25, 35, 45, 82, 76], { overbought: 80, oversold: 20 })).toEqual({
      kind: "sell",
      rsi: 76,
      barsAgo: 0,
    });
    expect(rsiSignal([25, 35, 45, 82, 76], levels)).toMatchObject({ kind: "overbought" });
  });

  it("is null without an RSI value and ignores crosses across gaps", () => {
    expect(rsiSignal([null, null], levels)).toBeNull();
    expect(rsiSignal([25, null, 40], levels)).toMatchObject({ kind: "neutral" });
  });
});

describe("rsiCrosses", () => {
  it("finds every exit from a zone", () => {
    expect(rsiCrosses([50, 29, 31, 72, 69, 30, 30, 31], levels)).toEqual([
      { index: 2, kind: "buy" },
      { index: 4, kind: "sell" },
      { index: 7, kind: "buy" },
    ]);
  });
});

describe("RsiLevelsSchema", () => {
  it("rejects levels that overlap or leave no neutral band", () => {
    expect(RsiLevelsSchema.safeParse({ overbought: 70, oversold: 30 }).success).toBe(true);
    expect(RsiLevelsSchema.safeParse({ overbought: 55, oversold: 60 }).success).toBe(false);
    expect(RsiLevelsSchema.safeParse({ overbought: 100, oversold: 30 }).success).toBe(false);
  });
});

describe("liveCloses", () => {
  const day = (iso: string) => bucketStart(Date.parse(iso), "1D");
  const quote = (iso: string, price: number) => ({
    symbol: "AAPL",
    lastPrice: price,
    lastTs: Date.parse(iso),
    previousClose: 1,
  });

  it("replaces today's close, appends a new day, and ignores stale ticks", () => {
    const lastTime = day("2026-10-13T15:00:00Z");
    expect(liveCloses([1, 2], lastTime, quote("2026-10-13T19:00:00Z", 9))).toEqual([1, 9]);
    expect(liveCloses([1, 2], lastTime, quote("2026-10-14T14:00:00Z", 9))).toEqual([1, 2, 9]);
    expect(liveCloses([1, 2], lastTime, quote("2026-10-12T19:00:00Z", 9))).toEqual([1, 2]);
    expect(liveCloses([], null, quote("2026-10-14T14:00:00Z", 9))).toEqual([9]);
  });
});
