import { and, asc, eq, gte, inArray, lt, lte, max, min, type SQL, sql } from "drizzle-orm";

import { aggregateDays, type DayCandle, nyDay } from "~/lib/candles";
import type {
  Bar,
  BarSource,
  CalendarTimeframe,
  Candle,
  DailyBar,
  IntradayTimeframe,
} from "~/lib/market";

import type { Database } from "../client";
import { bars1d, bars1m } from "../schema";

// Postgres caps a statement at 65,535 bind parameters; 10 columns per bar → stay well below.
const UPSERT_CHUNK = 1000;

/**
 * Idempotent bulk upsert keyed by (symbol, source, ts). Safe to repeat or overlap. When the input
 * repeats a key (a bar and its late correction in one batch), the last occurrence wins; Postgres
 * rejects an INSERT … ON CONFLICT that touches the same row twice.
 */
export async function upsertBars(db: Database, bars: readonly Bar[]): Promise<void> {
  const latestByKey = new Map<string, Bar>();
  for (const bar of bars) latestByKey.set(`${bar.symbol}\u0000${bar.source}\u0000${bar.ts}`, bar);
  const unique = [...latestByKey.values()];
  for (let start = 0; start < unique.length; start += UPSERT_CHUNK) {
    const rows = unique.slice(start, start + UPSERT_CHUNK).map((bar) => ({
      symbol: bar.symbol,
      source: bar.source,
      ts: new Date(bar.ts),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      tradeCount: bar.tradeCount,
      vwap: bar.vwap,
    }));
    await db
      .insert(bars1m)
      .values(rows)
      .onConflictDoUpdate({
        target: [bars1m.symbol, bars1m.source, bars1m.ts],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
          tradeCount: sql`excluded.trade_count`,
          vwap: sql`excluded.vwap`,
        },
      });
  }
}

/** Open time of the newest stored bar for `symbol` from `source`, or null when none. */
export async function latestBarTime(
  db: Database,
  symbol: string,
  source: BarSource,
): Promise<Date | null> {
  const [row] = await db
    .select({ latest: max(bars1m.ts) })
    .from(bars1m)
    .where(and(eq(bars1m.symbol, symbol), eq(bars1m.source, source)));
  return row?.latest ?? null;
}

// Fixed UTC-midnight origin: every intraday stride divides an hour and ET offsets are whole hours,
// so buckets start on clock :00/:05/:15 in New York too. 1h bars are clock-hour aligned
// (09:00–10:00 contains the 09:30 open); see ai/database.md.
const BUCKET_ORIGIN = "2000-01-03 00:00:00+00";

/** SQL bucket per intraday timeframe, plus "1D" for days derived from minute bars. */
const BUCKET_SQL: Record<IntradayTimeframe | "1D", SQL> = {
  "1m": sql`ts`,
  "5m": sql.raw(`date_bin(interval '5 minutes', ts, timestamptz '${BUCKET_ORIGIN}')`),
  "15m": sql.raw(`date_bin(interval '15 minutes', ts, timestamptz '${BUCKET_ORIGIN}')`),
  "30m": sql.raw(`date_bin(interval '30 minutes', ts, timestamptz '${BUCKET_ORIGIN}')`),
  "1h": sql.raw(`date_bin(interval '1 hour', ts, timestamptz '${BUCKET_ORIGIN}')`),
  // UTC-aligned like the client's INTRADAY_STEP_MS: 00/04/08/12/16/20 UTC.
  "4h": sql.raw(`date_bin(interval '4 hours', ts, timestamptz '${BUCKET_ORIGIN}')`),
  // Exchange trading day from minute bars, DST-correct (recent days not yet in bars_1d).
  "1D": sql.raw(`date_trunc('day', ts, 'America/New_York')`),
};

export interface CandleQuery {
  symbol: string;
  /** Intraday interval, or "1D" for days built from 1-minute bars. */
  timeframe: IntradayTimeframe | "1D";
  from: Date;
  to: Date;
  /** Complete-market source; preferred wherever it has data (ADR 0005). */
  historySource: BarSource;
  /** Live-stream source; only used after the newest history bar. */
  liveSource: BarSource;
}

type CandleRow = Record<"time" | "open" | "high" | "low" | "close" | "volume", string | number>;

/**
 * OHLCV candles for [from, to), aggregated in SQL from 1-minute bars. History bars win; live bars
 * fill only the tail newer than the latest history bar (the delayed window).
 */
export async function getCandles(db: Database, query: CandleQuery): Promise<Candle[]> {
  const { symbol, historySource, liveSource } = query;
  // ISO strings with explicit casts: Drizzle replaces postgres.js timestamp serializers.
  const from = sql`${query.from.toISOString()}::timestamptz`;
  const to = sql`${query.to.toISOString()}::timestamptz`;
  const liveTail =
    liveSource === historySource
      ? sql``
      : sql`
        UNION ALL
        SELECT b.ts, b.open, b.high, b.low, b.close, b.volume
        FROM bars_1m b
        CROSS JOIN history_end h
        WHERE b.symbol = ${symbol} AND b.source = ${liveSource}
          AND b.ts >= ${from} AND b.ts < ${to}
          AND (h.latest IS NULL OR b.ts > h.latest)`;

  const rows = await db.execute<CandleRow>(sql`
    WITH history_end AS (
      SELECT max(ts) AS latest FROM bars_1m WHERE symbol = ${symbol} AND source = ${historySource}
    ),
    merged AS (
      SELECT ts, open, high, low, close, volume
      FROM bars_1m
      WHERE symbol = ${symbol} AND source = ${historySource} AND ts >= ${from} AND ts < ${to}
      ${liveTail}
    ),
    bucketed AS (
      SELECT ${BUCKET_SQL[query.timeframe]} AS bucket, ts, open, high, low, close, volume FROM merged
    )
    SELECT
      extract(epoch FROM bucket)::bigint AS time,
      (array_agg(open ORDER BY ts))[1] AS open,
      max(high) AS high,
      min(low) AS low,
      (array_agg(close ORDER BY ts DESC))[1] AS close,
      sum(volume) AS volume
    FROM bucketed
    GROUP BY bucket
    ORDER BY bucket`);

  // Raw postgres.js rows: numeric/bigint arrive as strings.
  return rows.map((row) => ({
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

/** Idempotent bulk upsert of daily history keyed by (symbol, source, day). */
export async function upsertDailyBars(db: Database, bars: readonly DailyBar[]): Promise<void> {
  const latestByKey = new Map<string, DailyBar>();
  for (const bar of bars) latestByKey.set(`${bar.symbol}\u0000${bar.source}\u0000${bar.day}`, bar);
  const unique = [...latestByKey.values()];
  for (let start = 0; start < unique.length; start += UPSERT_CHUNK) {
    await db
      .insert(bars1d)
      .values(unique.slice(start, start + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [bars1d.symbol, bars1d.source, bars1d.day],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
        },
      });
  }
}

/** Newest stored trading date (`YYYY-MM-DD`) of daily history, or null. */
export async function latestDailyDay(
  db: Database,
  symbol: string,
  source: BarSource,
): Promise<string | null> {
  const [row] = await db
    .select({ latest: max(bars1d.day) })
    .from(bars1d)
    .where(and(eq(bars1d.symbol, symbol), eq(bars1d.source, source)));
  return row?.latest ?? null;
}

/** Each symbol's first and last stored trading date (`YYYY-MM-DD`) of daily history; missing when none. */
export async function dailyBounds(
  db: Database,
  symbols: readonly string[],
  source: BarSource,
): Promise<Map<string, { first: string; last: string }>> {
  if (symbols.length === 0) return new Map();
  const rows = await db
    .select({ symbol: bars1d.symbol, first: min(bars1d.day), last: max(bars1d.day) })
    .from(bars1d)
    .where(and(inArray(bars1d.symbol, [...symbols]), eq(bars1d.source, source)))
    .groupBy(bars1d.symbol);
  return new Map(
    rows.flatMap(({ symbol, first, last }) =>
      first !== null && last !== null ? [[symbol, { first, last }] as const] : [],
    ),
  );
}

/** Daily closes of `symbols` for trading dates in [fromDay, toDay), by symbol then date. */
export async function listDailyCloses(
  db: Database,
  symbols: readonly string[],
  source: BarSource,
  fromDay: string,
  toDay: string,
): Promise<Array<{ symbol: string; day: string; close: number }>> {
  if (symbols.length === 0) return [];
  return db
    .select({ symbol: bars1d.symbol, day: bars1d.day, close: bars1d.close })
    .from(bars1d)
    .where(
      and(
        inArray(bars1d.symbol, [...symbols]),
        eq(bars1d.source, source),
        gte(bars1d.day, fromDay),
        lt(bars1d.day, toDay),
      ),
    )
    .orderBy(asc(bars1d.symbol), asc(bars1d.day));
}

export interface CalendarCandleQuery extends Omit<CandleQuery, "timeframe"> {
  timeframe: CalendarTimeframe;
}

/**
 * 1D/1W/2W/1M/1Y candles (ADR 0011): daily history from `bars_1d`, plus days after the newest
 * daily bar built from 1-minute bars (today, and anything not yet backfilled), rolled up with the
 * same `aggregateDays` the browser uses for live updates. Same [from, to) range as `getCandles`:
 * a day counts when its New York midnight (the candle's time) is before `to`, so asking for the
 * history before the first loaded candle (`to` = its time) never returns that candle again.
 */
export async function getCalendarCandles(
  db: Database,
  query: CalendarCandleQuery,
): Promise<Candle[]> {
  const { symbol, historySource } = query;
  const fromDay = nyDay(query.from.getTime());
  const toDay = nyDay(query.to.getTime() - 1);

  const daily = await db
    .select()
    .from(bars1d)
    .where(
      and(
        eq(bars1d.symbol, symbol),
        eq(bars1d.source, historySource),
        gte(bars1d.day, fromDay),
        lte(bars1d.day, toDay),
      ),
    )
    .orderBy(asc(bars1d.day));
  const lastDailyDay = daily.at(-1)?.day ?? null;

  const minuteDays = (await getCandles(db, { ...query, timeframe: "1D" }))
    .map((candle): DayCandle => ({ ...candle, day: nyDay(candle.time * 1000) }))
    .filter((candle) => lastDailyDay === null || candle.day > lastDailyDay);

  return aggregateDays([...daily, ...minuteDays], query.timeframe);
}
