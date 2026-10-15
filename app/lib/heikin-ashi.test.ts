import { describe, expect, it } from "vitest";

import { heikinAshi, type Ohlc, syncLastHeikinAshi } from "./heikin-ashi";

const candles: Ohlc[] = [
  { time: 1, open: 10, high: 12, low: 9, close: 11 },
  { time: 2, open: 11, high: 14, low: 10, close: 13 },
  { time: 3, open: 13, high: 13.5, low: 8, close: 9 },
];

describe("heikinAshi", () => {
  it("averages each bar and opens at the previous bar's midpoint", () => {
    const [first, second] = heikinAshi(candles);
    // First bar: open = (O+C)/2 of the real candle.
    expect(first).toEqual({ time: 1, open: 10.5, high: 12, low: 9, close: 10.5 });
    // close = (11+14+10+13)/4 = 12; open = (10.5+10.5)/2 = 10.5.
    expect(second).toEqual({ time: 2, open: 10.5, high: 14, low: 10, close: 12 });
  });

  it("widens high/low to include the averaged open and close", () => {
    // After a gap down the averaged open (100) sits above the real high (81): it becomes the high.
    const gapDown: Ohlc[] = [
      { time: 1, open: 100, high: 101, low: 99, close: 100 },
      { time: 2, open: 80, high: 81, low: 79, close: 80 },
    ];
    const [, bar] = heikinAshi(gapDown);
    expect(bar?.open).toBe(100);
    expect(bar?.high).toBe(100);
    expect(bar?.low).toBe(79);
  });

  it("returns nothing for no candles", () => {
    expect(heikinAshi([])).toEqual([]);
  });
});

describe("syncLastHeikinAshi (live ticks)", () => {
  it("matches a full recompute when the last candle changes in place", () => {
    const bars = heikinAshi(candles);
    const ticked = [...candles.slice(0, 2), { time: 3, open: 13, high: 15, low: 8, close: 14.5 }];
    syncLastHeikinAshi(bars, ticked);
    expect(bars).toEqual(heikinAshi(ticked));
  });

  it("matches a full recompute when a new candle is appended", () => {
    const bars = heikinAshi(candles);
    const grown = [...candles, { time: 4, open: 9, high: 10, low: 8.5, close: 9.5 }];
    const last = syncLastHeikinAshi(bars, grown);
    expect(bars).toEqual(heikinAshi(grown));
    expect(last).toEqual(heikinAshi(grown).at(-1));
  });
});
