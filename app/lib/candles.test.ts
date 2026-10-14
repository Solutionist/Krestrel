import { describe, expect, it } from "vitest";

import {
  aggregateDays,
  bucketStart,
  dayBucketStart,
  formatExchangeTime,
  mergeBar,
  mergeTick,
} from "./candles";
import type { Bar, Candle } from "./market";

const sec = (iso: string) => Date.parse(iso) / 1000;
const tick = (iso: string, price: number, size = 10) => ({
  symbol: "AAPL",
  price,
  size,
  ts: Date.parse(iso),
});

describe("bucketStart (must match the SQL bucketing)", () => {
  it("aligns intraday buckets to UTC multiples", () => {
    expect(bucketStart(Date.parse("2026-10-14T14:37:59Z"), "1m")).toBe(sec("2026-10-14T14:37:00Z"));
    expect(bucketStart(Date.parse("2026-10-14T14:37:59Z"), "5m")).toBe(sec("2026-10-14T14:35:00Z"));
    expect(bucketStart(Date.parse("2026-10-14T14:37:59Z"), "15m")).toBe(
      sec("2026-10-14T14:30:00Z"),
    );
    expect(bucketStart(Date.parse("2026-10-14T14:37:59Z"), "1h")).toBe(sec("2026-10-14T14:00:00Z"));
  });

  it("uses New York midnight for daily candles, across the DST change", () => {
    // Same cases as bars.test.ts "groups 1D by New York trading day across a DST change".
    expect(bucketStart(Date.parse("2026-10-31T03:30:00Z"), "1D")).toBe(sec("2026-10-30T04:00:00Z"));
    expect(bucketStart(Date.parse("2026-10-31T13:30:00Z"), "1D")).toBe(sec("2026-10-31T04:00:00Z"));
    expect(bucketStart(Date.parse("2026-11-02T03:59:00Z"), "1D")).toBe(sec("2026-11-01T04:00:00Z"));
    expect(bucketStart(Date.parse("2026-11-02T05:00:00Z"), "1D")).toBe(sec("2026-11-02T05:00:00Z"));
  });
});

describe("mergeTick", () => {
  const latest: Candle = {
    time: sec("2026-10-14T14:35:00Z"),
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 100,
  };

  it("extends the current candle's high/low/close and volume", () => {
    expect(mergeTick(latest, tick("2026-10-14T14:36:10Z", 11.5, 5), "5m")).toEqual({
      ...latest,
      high: 11.5,
      close: 11.5,
      volume: 105,
    });
    expect(mergeTick(latest, tick("2026-10-14T14:36:10Z", 8.5), "5m")).toMatchObject({
      low: 8.5,
      high: 11,
    });
  });

  it("opens a new candle when the trade falls in the next bucket", () => {
    expect(mergeTick(latest, tick("2026-10-14T14:40:00Z", 12, 3), "5m")).toEqual({
      time: sec("2026-10-14T14:40:00Z"),
      open: 12,
      high: 12,
      low: 12,
      close: 12,
      volume: 3,
    });
  });

  it("ignores trades older than the latest candle instead of corrupting history", () => {
    expect(mergeTick(latest, tick("2026-10-14T14:34:59Z", 99), "5m")).toBeNull();
  });
});

describe("mergeBar", () => {
  const bar = (iso: string, close: number): Bar => ({
    symbol: "AAPL",
    source: "alpaca_iex",
    ts: Date.parse(iso),
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 50,
    tradeCount: 5,
    vwap: close,
  });
  const latest: Candle = {
    time: sec("2026-10-14T14:36:00Z"),
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 70,
  };

  it("replaces the minute on 1m (stream bar or late correction is authoritative)", () => {
    expect(mergeBar(latest, bar("2026-10-14T14:36:00Z", 10.75), "1m")).toMatchObject({
      time: latest.time,
      close: 10.75,
      volume: 50,
    });
  });

  it("leaves a larger timeframe's tick-built candle alone", () => {
    const fiveMinute = { ...latest, time: sec("2026-10-14T14:35:00Z") };
    expect(mergeBar(fiveMinute, bar("2026-10-14T14:36:00Z", 10.75), "5m")).toBeNull();
    expect(mergeBar(fiveMinute, bar("2026-10-14T14:40:00Z", 10.75), "5m")).toMatchObject({
      time: sec("2026-10-14T14:40:00Z"),
    });
  });
});

describe("formatExchangeTime", () => {
  it("shows New York wall-clock time regardless of the viewer's zone", () => {
    expect(formatExchangeTime(Date.parse("2026-10-14T13:30:00Z"))).toBe("09:30");
    expect(formatExchangeTime(Date.parse("2026-12-14T14:30:00Z"))).toBe("09:30");
  });
});

describe("TradingView-style intervals", () => {
  const at = (iso: string) => Date.parse(iso);

  it("buckets 30m and 4h on UTC multiples (matches SQL date_bin)", () => {
    expect(bucketStart(at("2026-10-14T14:59:00Z"), "30m")).toBe(sec("2026-10-14T14:30:00Z"));
    expect(bucketStart(at("2026-10-14T15:59:00Z"), "4h")).toBe(sec("2026-10-14T12:00:00Z"));
  });

  it("starts weeks on Monday New York time, even late Sunday evening ET", () => {
    // Wed Oct 14 2026 → Mon Oct 12 (EDT midnight = 04:00Z).
    expect(bucketStart(at("2026-10-14T18:00:00Z"), "1W")).toBe(sec("2026-10-12T04:00:00Z"));
    // Mon 02:00Z is still Sunday 22:00 ET → previous week (Mon Oct 5).
    expect(bucketStart(at("2026-10-12T02:00:00Z"), "1W")).toBe(sec("2026-10-05T04:00:00Z"));
  });

  it("pairs weeks into fixed fortnights", () => {
    const start = bucketStart(at("2026-10-14T18:00:00Z"), "2W");
    const startMs = start * 1000;
    for (let day = 0; day < 14; day++) {
      expect(bucketStart(startMs + day * 86_400_000 + 12 * 3_600_000, "2W")).toBe(start);
    }
    expect(bucketStart(startMs + 14 * 86_400_000 + 12 * 3_600_000, "2W")).toBe(start + 14 * 86_400);
    // Fortnights start on a Monday.
    expect(new Date(startMs + 12 * 3_600_000).getUTCDay()).toBe(1);
  });

  it("starts months and years at New York midnight, DST-correct", () => {
    expect(bucketStart(at("2026-11-20T15:00:00Z"), "1M")).toBe(sec("2026-11-01T04:00:00Z"));
    expect(bucketStart(at("2026-12-20T15:00:00Z"), "1M")).toBe(sec("2026-12-01T05:00:00Z"));
    expect(bucketStart(at("2026-07-04T15:00:00Z"), "1Y")).toBe(sec("2026-01-01T05:00:00Z"));
    // 03:00Z on Jan 1 is still Dec 31 in New York.
    expect(bucketStart(at("2027-01-01T03:00:00Z"), "1Y")).toBe(sec("2026-01-01T05:00:00Z"));
  });

  it("aggregates daily candles: first open, max high, min low, last close, summed volume", () => {
    const days = [
      { day: "2026-10-09", open: 9, high: 10, low: 8, close: 9.5, volume: 1 }, // Fri
      { day: "2026-10-12", open: 10, high: 12, low: 9, close: 11, volume: 2 }, // Mon
      { day: "2026-10-13", open: 11, high: 15, low: 10, close: 14, volume: 3 },
      { day: "2026-10-16", open: 14, high: 14.5, low: 7, close: 8, volume: 4 }, // Fri
    ];
    expect(aggregateDays(days, "1W")).toEqual([
      { time: sec("2026-10-05T04:00:00Z"), open: 9, high: 10, low: 8, close: 9.5, volume: 1 },
      { time: sec("2026-10-12T04:00:00Z"), open: 10, high: 15, low: 7, close: 8, volume: 9 },
    ]);
    expect(aggregateDays(days, "1D")).toHaveLength(4);
    expect(dayBucketStart("2026-10-13", "1M")).toBe(sec("2026-10-01T04:00:00Z"));
  });

  it("folds a live trade into the current week's candle", () => {
    const week: Candle = {
      time: sec("2026-10-12T04:00:00Z"),
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: 5,
    };
    expect(mergeTick(week, tick("2026-10-16T19:59:00Z", 12.5, 2), "1W")).toEqual({
      ...week,
      high: 12.5,
      close: 12.5,
      volume: 7,
    });
  });
});
