// Portfolio value over time and time-weighted return against SPY (ADR 0024). Isomorphic and pure:
// the page feeds it the trades in view and daily closes from GET /api/performance.
import * as z from "zod";

import { replayOrder, SHARE_EPSILON, type Trade } from "./portfolio";

/** Benchmark: the same cash flows invested in this index fund. */
export const BENCHMARK_SYMBOL = "SPY";

/** Symbols per GET /api/performance request; the page splits larger sets into several requests. */
export const MAX_PERFORMANCE_SYMBOLS = 100;

/** One daily close: New York trading date (`YYYY-MM-DD`) and price in USD. */
export type DayClose = [day: string, close: number];

/** GET /api/performance */
export const PerformanceResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** New York date the closes run up to. */
    today: z.iso.date(),
    /** Every requested symbol: daily closes oldest first, the last one possibly today's latest price. */
    closes: z.record(z.string(), z.array(z.tuple([z.iso.date(), z.number()]))),
    /** Symbols whose history couldn't be downloaded: their closes may miss days. */
    incomplete: z.array(z.string()),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type PerformanceResponse = z.infer<typeof PerformanceResponseSchema>;

/** One day of a holding or its benchmark, USD. */
export interface Track {
  /** Value at the day's close. */
  value: number;
  /** Cash put in that day: buys, fees included. */
  inflow: number;
  /** Cash taken out that day: sell proceeds after fees. */
  outflow: number;
}

export interface PerformancePoint {
  day: string;
  portfolio: Track;
  /** The same cash flows bought and sold in SPY; null without SPY prices. */
  benchmark: Track | null;
}

export interface Performance {
  /** Every trading day (and trade day) from the first trade to today, oldest first. */
  points: PerformancePoint[];
  /** Traded symbols without any closes: valued at their latest trade price. */
  unpriced: string[];
}

/**
 * Daily portfolio value from the trades and closes. Each day applies that day's trades (buys
 * before sells), then values the shares held at the day's close; a day without a close carries
 * the last one, and a day with a trade but no close uses the trade price. The benchmark buys SPY
 * at the day's close with each buy's cash and sells SPY worth each sell's proceeds (never more
 * than it holds).
 */
export function performanceSeries(
  trades: readonly Trade[],
  closes: Readonly<Record<string, readonly DayClose[]>>,
  today: string,
): Performance {
  const ordered = trades.filter((trade) => trade.tradedOn <= today).sort(replayOrder);
  const first = ordered[0]?.tradedOn;
  if (first === undefined) return { points: [], unpriced: [] };

  const closeOn = new Map<string, Map<string, number>>();
  const days = new Set(ordered.map((trade) => trade.tradedOn));
  for (const [symbol, list] of Object.entries(closes)) {
    closeOn.set(symbol, new Map(list));
    for (const [day] of list) if (day >= first && day <= today) days.add(day);
  }
  const benchmarkCloses = closes[BENCHMARK_SYMBOL] ?? [];
  const benchmarkOn = closeOn.get(BENCHMARK_SYMBOL);
  const tradesOn = Map.groupBy(ordered, (trade) => trade.tradedOn);

  const shares = new Map<string, number>();
  const marks = new Map<string, number>();
  // Before SPY's first close (its data starting after the first trade), use that first close.
  let benchmarkPrice =
    benchmarkCloses.findLast(([day]) => day <= first)?.[1] ?? benchmarkCloses[0]?.[1];
  let benchmarkShares = 0;
  const points: PerformancePoint[] = [];

  for (const day of [...days].sort()) {
    benchmarkPrice = benchmarkOn?.get(day) ?? benchmarkPrice;
    const portfolio: Track = { value: 0, inflow: 0, outflow: 0 };
    const benchmark: Track = { value: 0, inflow: 0, outflow: 0 };

    for (const trade of tradesOn.get(day) ?? []) {
      const amount = trade.shares * trade.price;
      const held = shares.get(trade.symbol) ?? 0;
      marks.set(trade.symbol, trade.price);
      if (trade.side === "buy") {
        shares.set(trade.symbol, held + trade.shares);
        portfolio.inflow += amount + trade.fee;
        if (benchmarkPrice !== undefined) {
          benchmarkShares += (amount + trade.fee) / benchmarkPrice;
          benchmark.inflow += amount + trade.fee;
        }
      } else {
        const left = held - trade.shares;
        if (Math.abs(left) < SHARE_EPSILON) shares.delete(trade.symbol);
        else shares.set(trade.symbol, left);
        const proceeds = amount - trade.fee;
        portfolio.outflow += proceeds;
        if (benchmarkPrice !== undefined) {
          const sold = Math.min(benchmarkShares, Math.max(0, proceeds) / benchmarkPrice);
          benchmarkShares -= sold;
          benchmark.outflow += sold * benchmarkPrice;
        }
      }
    }

    for (const [symbol, count] of shares) {
      const close = closeOn.get(symbol)?.get(day);
      if (close !== undefined) marks.set(symbol, close);
      portfolio.value += count * (marks.get(symbol) ?? 0);
    }
    benchmark.value = benchmarkPrice === undefined ? 0 : benchmarkShares * benchmarkPrice;
    points.push({ day, portfolio, benchmark: benchmarkPrice === undefined ? null : benchmark });
  }

  const unpriced = [...new Set(ordered.map((trade) => trade.symbol))].filter(
    (symbol) => (closes[symbol]?.length ?? 0) === 0,
  );
  return { points, unpriced };
}

/**
 * Time-weighted return of the days in `tracks`, starting from `startValue`: each day grows by
 * (close value + cash out) ÷ (previous value + cash in), so buys and sells never count as gains,
 * and a buy earns from its price to the close on its first day. Days with nothing invested are
 * skipped; null when no day had anything invested.
 */
export function timeWeightedReturn(tracks: readonly Track[], startValue: number): number | null {
  let growth = 1;
  let counted = false;
  let previous = startValue;
  for (const track of tracks) {
    const invested = previous + track.inflow;
    if (invested > SHARE_EPSILON) {
      growth *= (track.value + track.outflow) / invested;
      counted = true;
    }
    previous = track.value;
  }
  return counted ? growth - 1 : null;
}

export const PERFORMANCE_RANGES = ["1M", "3M", "YTD", "1Y", "ALL"] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];

const RANGE_MONTHS: Record<Exclude<PerformanceRange, "YTD" | "ALL">, number> = {
  "1M": 1,
  "3M": 3,
  "1Y": 12,
};

/**
 * The day whose close is the range's starting value: `today` minus 1, 3 or 12 calendar months
 * (clamped to the month's end, so Mar 31 − 1M is Feb 28), Dec 31 of last year for YTD, null
 * for "ALL" (from zero before the first trade).
 */
export function rangeBaseDay(range: PerformanceRange, today: string): string | null {
  if (range === "ALL") return null;
  const date = new Date(`${today}T00:00:00Z`);
  const year = date.getUTCFullYear();
  if (range === "YTD") return `${year - 1}-12-31`;
  const target = new Date(Date.UTC(year, date.getUTCMonth() - RANGE_MONTHS[range], 1));
  const lastOfMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastOfMonth));
  return target.toISOString().slice(0, 10);
}

export interface RangeTotals {
  /** Value at the start (0 when the range starts before the first trade). */
  start: number;
  end: number;
  /** Cash in minus cash out during the range. */
  netFlow: number;
  /** Market gain: end − start − net cash flow. */
  gain: number;
  /** Time-weighted return as a fraction; null when nothing was invested. */
  twr: number | null;
}

export interface RangeSummary {
  /** From the starting day (when inside the history) to the last day, for the chart. */
  points: PerformancePoint[];
  /** Day of the starting value; null when the range begins before the first trade. */
  startDay: string | null;
  endDay: string;
  portfolio: RangeTotals;
  /** The same cash flows in SPY; null without SPY prices. */
  benchmark: RangeTotals | null;
}

function totals(tracks: readonly Track[], start: number): RangeTotals {
  const end = tracks.at(-1)?.value ?? start;
  const netFlow = tracks.reduce((sum, track) => sum + track.inflow - track.outflow, 0);
  return {
    start,
    end,
    netFlow,
    gain: end - start - netFlow,
    twr: timeWeightedReturn(tracks, start),
  };
}

/**
 * Value change and time-weighted returns over a range. The range runs from the close of
 * `rangeBaseDay` (or the last trading day before it) through the last day; null without points.
 */
export function summarizeRange(
  performance: Performance,
  range: PerformanceRange,
  today: string,
): RangeSummary | null {
  const { points } = performance;
  const last = points.at(-1);
  if (!last) return null;
  const baseDay = rangeBaseDay(range, today);
  const baseIndex = baseDay === null ? -1 : points.findLastIndex((point) => point.day <= baseDay);
  const base = baseIndex >= 0 ? points[baseIndex] : null;
  const inRange = points.slice(baseIndex + 1);

  const benchmarkTracks = inRange.flatMap((point) => (point.benchmark ? [point.benchmark] : []));
  const hasBenchmark = last.benchmark !== null && benchmarkTracks.length === inRange.length;
  return {
    points: points.slice(Math.max(baseIndex, 0)),
    startDay: base?.day ?? null,
    endDay: last.day,
    portfolio: totals(
      inRange.map((point) => point.portfolio),
      base?.portfolio.value ?? 0,
    ),
    benchmark: hasBenchmark ? totals(benchmarkTracks, base?.benchmark?.value ?? 0) : null,
  };
}
