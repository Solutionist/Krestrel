import { describe, expect, it } from "vitest";

import type { Bar } from "~/lib/market";

import { setupTestDatabase } from "../../../../../tests/db/test-db";
import {
  getCalendarCandles,
  getCandles,
  latestBarTime,
  latestDailyDay,
  upsertBars,
  upsertDailyBars,
} from "./bars";

const db = setupTestDatabase();

const MINUTE = 60_000;
const HIST = "alpaca_sip";
const LIVE = "alpaca_iex";

function bar(ts: string | number, close: number, overrides: Partial<Bar> = {}): Bar {
  return {
    symbol: "AAPL",
    source: HIST,
    ts: typeof ts === "number" ? ts : Date.parse(ts),
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
    tradeCount: 10,
    vwap: close,
    ...overrides,
  };
}

function minutes(startIso: string, closes: number[], overrides: Partial<Bar> = {}): Bar[] {
  const start = Date.parse(startIso);
  return closes.map((close, index) => bar(start + index * MINUTE, close, overrides));
}

const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });

describe("upsertBars", () => {
  it("is idempotent and lets a later write (e.g. a late-trade correction) replace the bar", async () => {
    const original = minutes("2026-10-14T14:30:00Z", [10, 11, 12]);
    await upsertBars(db, original);
    await upsertBars(db, original);
    await upsertBars(db, [bar("2026-10-14T14:31:00Z", 11.5, { volume: 250 })]);

    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1m",
      ...range("2026-10-14T14:30:00Z", "2026-10-14T14:33:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => [c.close, c.volume])).toEqual([
      [10, 100],
      [11.5, 250],
      [12, 100],
    ]);
  });

  it("accepts a bar and its correction in the same batch, keeping the later one", async () => {
    await upsertBars(db, [bar("2026-10-14T14:30:00Z", 10), bar("2026-10-14T14:30:00Z", 10.5)]);
    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1m",
      ...range("2026-10-14T14:30:00Z", "2026-10-14T14:31:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => c.close)).toEqual([10.5]);
  });

  it("keeps the same minute from different sources as separate rows", async () => {
    await upsertBars(db, [
      bar("2026-10-14T14:30:00Z", 10),
      bar("2026-10-14T14:30:00Z", 9, { source: LIVE }),
    ]);
    expect(await latestBarTime(db, "AAPL", HIST)).toEqual(new Date("2026-10-14T14:30:00Z"));
    expect(await latestBarTime(db, "AAPL", LIVE)).toEqual(new Date("2026-10-14T14:30:00Z"));
    expect(await latestBarTime(db, "MSFT", HIST)).toBeNull();
  });

  it("writes batches larger than one statement's parameter budget", async () => {
    const many = minutes(
      "2026-10-01T08:00:00Z",
      Array.from({ length: 2500 }, (_, i) => 100 + i / 100),
    );
    await upsertBars(db, many);
    expect(await latestBarTime(db, "AAPL", HIST)).toEqual(new Date(many.at(-1)?.ts ?? 0));
  });
});

describe("getCandles", () => {
  it("prefers history and uses live bars only after the newest history bar", async () => {
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [10, 11]));
    // Live overlaps history at 14:30–14:31 (ignored) and extends past it (used).
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [90, 91, 12, 13], { source: LIVE }));

    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1m",
      ...range("2026-10-14T14:00:00Z", "2026-10-14T15:00:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => c.close)).toEqual([10, 11, 12, 13]);
  });

  it("falls back to live bars entirely when there is no history", async () => {
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [5, 6], { source: LIVE }));
    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1m",
      ...range("2026-10-14T14:00:00Z", "2026-10-14T15:00:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => c.close)).toEqual([5, 6]);
  });

  it("aggregates 5m buckets with first open, max high, min low, last close, summed volume", async () => {
    // 14:28..14:37 → buckets 14:25 (2 bars), 14:30 (5 bars), 14:35 (3 bars).
    const bars = minutes("2026-10-14T14:28:00Z", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map((b, i) => ({
      ...b,
      open: b.close - 0.5,
      high: b.close + i,
      low: b.close - 1,
    }));
    await upsertBars(db, bars);

    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "5m",
      ...range("2026-10-14T14:00:00Z", "2026-10-14T15:00:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles).toEqual([
      {
        time: Date.parse("2026-10-14T14:25:00Z") / 1000,
        open: 0.5,
        high: 3,
        low: 0,
        close: 2,
        volume: 200,
      },
      {
        time: Date.parse("2026-10-14T14:30:00Z") / 1000,
        open: 2.5,
        high: 13,
        low: 2,
        close: 7,
        volume: 500,
      },
      {
        time: Date.parse("2026-10-14T14:35:00Z") / 1000,
        open: 7.5,
        high: 19,
        low: 7,
        close: 10,
        volume: 300,
      },
    ]);
  });

  it("aligns 1h buckets to clock hours", async () => {
    await upsertBars(db, minutes("2026-10-14T13:59:00Z", [1, 2, 3]));
    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1h",
      ...range("2026-10-14T13:00:00Z", "2026-10-14T15:00:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => [c.time, c.close])).toEqual([
      [Date.parse("2026-10-14T13:00:00Z") / 1000, 1],
      [Date.parse("2026-10-14T14:00:00Z") / 1000, 3],
    ]);
  });

  it("groups 1D by New York trading day across a DST change", async () => {
    // 2026-11-01 is the US DST end. 03:59Z on Nov 2 is 22:59 EST on Nov 1, and
    // 03:30Z on Oct 31 is 23:30 EDT on Oct 30.
    await upsertBars(db, [
      bar("2026-10-31T03:30:00Z", 1),
      bar("2026-10-31T13:30:00Z", 2),
      bar("2026-11-02T03:59:00Z", 3),
      bar("2026-11-02T05:00:00Z", 4),
    ]);
    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1D",
      ...range("2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => [new Date(c.time * 1000).toISOString(), c.close])).toEqual([
      ["2026-10-30T04:00:00.000Z", 1], // midnight EDT Oct 30
      ["2026-10-31T04:00:00.000Z", 2], // midnight EDT Oct 31
      ["2026-11-01T04:00:00.000Z", 3], // midnight EDT Nov 1 (DST ends 06:00Z)
      ["2026-11-02T05:00:00.000Z", 4], // midnight EST Nov 2
    ]);
  });

  it("returns only the requested symbol and half-open range", async () => {
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [1, 2, 3]));
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [7, 8, 9], { symbol: "MSFT" }));
    const candles = await getCandles(db, {
      symbol: "AAPL",
      timeframe: "1m",
      ...range("2026-10-14T14:31:00Z", "2026-10-14T14:32:00Z"),
      historySource: HIST,
      liveSource: LIVE,
    });
    expect(candles.map((c) => c.close)).toEqual([2]);
  });
});

describe("daily history and calendar candles (ADR 0011)", () => {
  const daily = (day: string, close: number) => ({
    symbol: "AAPL",
    source: HIST,
    day,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1000,
  });
  const query = (timeframe: "1D" | "1W" | "1M", from: string, to: string) => ({
    symbol: "AAPL",
    timeframe,
    ...range(from, to),
    historySource: HIST,
    liveSource: LIVE,
  });

  it("upserts daily bars idempotently and reports the newest day", async () => {
    await upsertDailyBars(db, [daily("2026-10-12", 10), daily("2026-10-13", 11)]);
    await upsertDailyBars(db, [daily("2026-10-13", 11.5)]);
    expect(await latestDailyDay(db, "AAPL", HIST)).toBe("2026-10-13");
    const candles = await getCalendarCandles(
      db,
      query("1D", "2026-10-01T00:00:00Z", "2026-10-14T00:00:00Z"),
    );
    expect(candles.map((c) => c.close)).toEqual([10, 11.5]);
  });

  it("uses minute bars only for days after the newest daily bar (today)", async () => {
    await upsertDailyBars(db, [daily("2026-10-12", 10), daily("2026-10-13", 11)]);
    // Minute bars on Oct 13 (already in daily: ignored) and Oct 14 (today: used).
    await upsertBars(db, minutes("2026-10-13T14:30:00Z", [99, 98]));
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [12, 13], { source: LIVE }));

    const candles = await getCalendarCandles(
      db,
      query("1D", "2026-10-01T00:00:00Z", "2026-10-15T00:00:00Z"),
    );
    expect(candles.map((c) => [new Date(c.time * 1000).toISOString(), c.close])).toEqual([
      ["2026-10-12T04:00:00.000Z", 10],
      ["2026-10-13T04:00:00.000Z", 11],
      ["2026-10-14T04:00:00.000Z", 13],
    ]);
  });

  it("rolls days up into weeks and months, including today's minute-built day", async () => {
    await upsertDailyBars(db, [
      daily("2026-09-30", 8),
      daily("2026-10-12", 10),
      daily("2026-10-13", 11),
    ]);
    await upsertBars(db, minutes("2026-10-14T14:30:00Z", [12, 13], { source: LIVE }));

    const weeks = await getCalendarCandles(
      db,
      query("1W", "2026-09-01T00:00:00Z", "2026-10-15T00:00:00Z"),
    );
    expect(weeks.map((c) => [new Date(c.time * 1000).toISOString(), c.open, c.close])).toEqual([
      ["2026-09-28T04:00:00.000Z", 7, 8],
      ["2026-10-12T04:00:00.000Z", 9, 13],
    ]);
    const months = await getCalendarCandles(
      db,
      query("1M", "2026-09-01T00:00:00Z", "2026-10-15T00:00:00Z"),
    );
    expect(months.map((c) => c.close)).toEqual([8, 13]);
    expect(months[1]?.volume).toBe(2000 + 200);
  });

  it("treats `to` as exclusive, so loading older history never repeats the first candle", async () => {
    await upsertDailyBars(db, [
      daily("2026-10-02", 7),
      daily("2026-10-09", 8),
      daily("2026-10-12", 10),
      daily("2026-10-13", 11),
    ]);
    // The chart asks for history before its first candle with `to` = that candle's time
    // (New York midnight): Oct 13 must not come back.
    const days = await getCalendarCandles(
      db,
      query("1D", "2026-10-01T00:00:00Z", "2026-10-13T04:00:00.000Z"),
    );
    expect(days.map((c) => c.close)).toEqual([7, 8, 10]);
    // Same for a week: `to` = the start of the week of Oct 12.
    const weeks = await getCalendarCandles(
      db,
      query("1W", "2026-09-01T00:00:00Z", "2026-10-12T04:00:00.000Z"),
    );
    expect(weeks.map((c) => c.close)).toEqual([7, 8]);
  });
});
