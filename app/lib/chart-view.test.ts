import { describe, expect, it } from "vitest";

import { captureWindow, windowToLogical } from "./chart-view";
import type { Candle } from "./market";

const HOUR = 3600;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 1) / 1000;

const candles = (step: number, count: number, start = T0): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    time: start + i * step,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));

const options = { minBars: 10, rightOffset: 6 };

describe("chart view across intervals", () => {
  it("keeps the same days when switching from daily to hourly candles", () => {
    const daily = candles(DAY, 60);
    // Looking at days 20..29.
    const window = captureWindow(daily, { from: 20, to: 29 });
    expect(window).toEqual({ from: T0 + 20 * DAY, toEnd: T0 + 30 * DAY });

    const hourly = candles(HOUR, 60 * 24);
    expect(windowToLogical(hourly, window ?? { from: 0, toEnd: null }, options)).toEqual({
      from: 20 * 24 - 0.5,
      to: 30 * 24 - 1 + 0.5,
    });
  });

  it("keeps following the latest candle when the view reaches it", () => {
    const hourly = candles(HOUR, 500);
    const window = captureWindow(hourly, { from: 400, to: 505 });
    expect(window?.toEnd).toBeNull();
    const daily = candles(DAY, 30);
    const range = windowToLogical(daily, window ?? { from: 0, toEnd: null }, options);
    expect(range?.to).toBe(29 + 6);
  });

  it("widens to a minimum number of bars when the new candles are coarser", () => {
    const hourly = candles(HOUR, 24 * 60);
    // Six hours on day 40 → on daily candles that's one bar: show 10 ending on that day.
    const window = captureWindow(hourly, { from: 40 * 24 + 8, to: 40 * 24 + 13 });
    const daily = candles(DAY, 60);
    expect(windowToLogical(daily, window ?? { from: 0, toEnd: null }, options)).toEqual({
      from: 31 - 0.5,
      to: 40 + 0.5,
    });
  });

  it("gives up (default view) when the new candles don't reach the window", () => {
    const daily = candles(DAY, 400);
    const window = captureWindow(daily, { from: 10, to: 20 });
    // Minute history only covers the last few days.
    const recent = candles(60, 1000, T0 + 395 * DAY);
    expect(windowToLogical(recent, window ?? { from: 0, toEnd: null }, options)).toBeNull();
  });

  it("shows what is loaded when the window starts before the new candles", () => {
    const daily = candles(DAY, 100);
    const window = captureWindow(daily, { from: 50, to: 99 });
    const hourly = candles(HOUR, 24 * 20, T0 + 80 * DAY);
    const range = windowToLogical(hourly, window ?? { from: 0, toEnd: null }, options);
    expect(range?.from).toBe(-0.5);
  });
});
