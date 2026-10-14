import { describe, expect, it } from "vitest";

import type { Candle } from "./market";
import { rangeStats } from "./range-stats";

const candle = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume: 100,
});

const candles = [
  candle(60, 10, 11, 9, 10.5),
  candle(120, 10.5, 14, 10, 13),
  candle(180, 13, 13.5, 8, 9),
  candle(240, 9, 12, 8.5, 12),
];

describe("rangeStats", () => {
  it("measures first open to last close, with the span's extremes and volume", () => {
    expect(rangeStats(candles, 0.8, 2.2)).toEqual({
      bars: 2,
      from: 120,
      to: 180,
      change: 9 - 10.5,
      changeFraction: (9 - 10.5) / 10.5,
      high: 14,
      low: 8,
      volume: 200,
    });
  });

  it("accepts a right-to-left drag and clamps to the loaded candles", () => {
    expect(rangeStats(candles, 9, -3)).toMatchObject({ bars: 4, from: 60, to: 240, change: 2 });
  });

  it("is null when the span holds no candles", () => {
    expect(rangeStats(candles, 6, 9)).toBeNull();
    expect(rangeStats([], 0, 3)).toBeNull();
  });
});
