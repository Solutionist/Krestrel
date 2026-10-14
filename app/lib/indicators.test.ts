import { describe, expect, it } from "vitest";

import { bollinger, ema, rsi } from "./indicators";

describe("ema", () => {
  it("is null until the window fills, seeded with the simple average", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("weights recent values by 2 / (period + 1)", () => {
    const [, , seed, next] = ema([10, 10, 10, 20], 3);
    expect(seed).toBe(10);
    expect(next).toBeCloseTo(15); // 0.5 × 20 + 0.5 × 10
  });

  it("returns all nulls when there are fewer values than the period", () => {
    expect(ema([1, 2], 20)).toEqual([null, null]);
  });
});

describe("bollinger", () => {
  it("uses the SMA middle and population standard deviation", () => {
    const { upper, middle, lower } = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    // Classic example: mean 5, population σ 2.
    expect(middle.at(-1)).toBe(5);
    expect(upper.at(-1)).toBeCloseTo(9);
    expect(lower.at(-1)).toBeCloseTo(1);
    expect(middle.slice(0, 7)).toEqual(Array(7).fill(null));
  });

  it("collapses to the price for a flat series", () => {
    const { upper, lower } = bollinger(Array(25).fill(100), 20, 2);
    expect(upper.at(-1)).toBeCloseTo(100);
    expect(lower.at(-1)).toBeCloseTo(100);
  });
});

describe("rsi", () => {
  it("is 100 when price only rises, 0 when it only falls, 50 when flat", () => {
    const up = Array.from({ length: 20 }, (_, i) => i);
    expect(rsi(up, 14).at(-1)).toBe(100);
    expect(rsi(up.toReversed(), 14).at(-1)).toBe(0);
    expect(rsi(Array(20).fill(5), 14).at(-1)).toBe(50);
  });

  it("matches Wilder's reference values", () => {
    // StockCharts' worked Wilder example; RSI(14) at the 15th close ≈ 70.53, then 66.32.
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
      45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028,
    ];
    const values = rsi(closes, 14);
    expect(values.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(values[14]).toBeCloseTo(70.53, 1);
    expect(values[15]).toBeCloseTo(66.32, 1);
  });
});
