import type { Logger } from "pino";

import { nyDay } from "~/lib/candles";
import type { DailyBar } from "~/lib/market";

import type { Database } from "./db/client";
import { dailyBounds, latestBarTime, upsertBars, upsertDailyBars } from "./db/queries/bars";
import type { MarketDataProvider } from "./provider";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface BackfillDeps {
  provider: MarketDataProvider;
  db: Database;
  logger: Logger;
  /** Days of 1-minute history (intraday charts). */
  days: number;
  /** Years of daily history (1D…1Y charts, ADR 0011). */
  dailyYears: number;
  now?: () => number;
}

export interface Backfiller {
  /** Queues symbols for incremental history backfill; resolves when they are done. */
  enqueue(symbols: readonly string[]): Promise<void>;
  /** Stops accepting jobs and resolves once the running/queued ones have finished. */
  close(): Promise<void>;
}

/** Groups symbols by start key, then splits each group into provider-sized batches. */
export function batchesByStart<K>(
  starts: ReadonlyArray<[symbol: string, start: K]>,
  size: number,
): Array<[K, string[]]> {
  const byStart = new Map<K, string[]>();
  for (const [symbol, start] of starts) byStart.set(start, [...(byStart.get(start) ?? []), symbol]);
  return [...byStart].flatMap(([start, group]) => {
    const batches: Array<[K, string[]]> = [];
    for (let i = 0; i < group.length; i += size) batches.push([start, group.slice(i, i + size)]);
    return batches;
  });
}

export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/**
 * Incremental, idempotent history backfill (ADR 0005, ADR 0011), in two phases:
 * 1. Daily bars up to (excluding) today's New York date: the tail after the newest stored day,
 *    and once per process the head back to `dailyYears` before the oldest stored day.
 * 2. 1-minute bars from the later of (now − days) and the newest stored bar, up to
 *    now − provider.historyDelayMs.
 * Each resumes from what is already stored. Jobs run one at a time so provider rate limits are
 * respected; the provider paces requests.
 */
export function createBackfiller(deps: BackfillDeps): Backfiller {
  const { provider, db, logger } = deps;
  const now = deps.now ?? Date.now;
  let chain: Promise<void> = Promise.resolve();
  let closed = false;
  // Symbols whose daily head reached the floor (or as far back as the provider has data).
  const headDone = new Set<string>();

  /** Stores every page; true only when all pages arrived (false on error or shutdown). */
  async function fetchAll<T>(
    label: string,
    batch: string[],
    pages: AsyncIterable<T[]>,
    store: (page: T[]) => Promise<void>,
    range: Record<string, unknown>,
  ): Promise<boolean> {
    const log = logger.child({ symbols: batch, kind: label });
    let stored = 0;
    try {
      for await (const page of pages) {
        await store(page);
        stored += page.length;
        if (closed) {
          log.info({ stored, ...range }, "backfill stopped for shutdown");
          return false;
        }
      }
      log.info({ stored, ...range }, "backfill complete");
      return true;
    } catch (err) {
      // Partial pages are already stored; the next run resumes from the newest bar.
      log.error({ err, stored }, "backfill failed");
      return false;
    }
  }

  async function runDaily(symbols: readonly string[]): Promise<void> {
    if (deps.dailyYears === 0) return;
    // Exclusive: today comes from minute bars. Shifted by the history delay so the last included
    // day has been over for at least that long (just after midnight, yesterday is still "recent").
    const endDay = nyDay(now() - provider.historyDelayMs);
    const floorDay = nyDay(now() - deps.dailyYears * 365 * DAY);
    const stored = await dailyBounds(db, symbols, provider.historySource);
    // Each job's symbols share one range; the job object is the batching key.
    type Job = { start: string; end: string; head: boolean };
    const jobs = new Map<string, Job>();
    const starts: Array<[string, Job]> = [];
    const addJob = (symbol: string, start: string, end: string, head = false) => {
      if (start >= end) return;
      const key = `${start}/${end}/${head}`;
      const job = jobs.get(key) ?? { start, end, head };
      jobs.set(key, job);
      starts.push([symbol, job]);
    };
    for (const symbol of symbols) {
      const bounds = stored.get(symbol);
      if (!bounds || bounds.last < floorDay) {
        addJob(symbol, floorDay, endDay);
        continue;
      }
      if (floorDay < bounds.first && !headDone.has(symbol)) {
        addJob(symbol, floorDay, bounds.first, true);
      }
      addJob(symbol, nextDay(bounds.last), endDay);
    }
    for (const [job, batch] of batchesByStart(starts, provider.maxSymbolsPerHistoryRequest)) {
      if (closed) return;
      const range = { from: job.start, to: job.end };
      if (!job.head) {
        await fetchAll(
          "daily",
          batch,
          provider.getDailyBars(batch, job.start, job.end),
          (page) => upsertDailyBars(db, page),
          range,
        );
        continue;
      }
      // A partial head must never be stored: it would move the oldest stored day and look complete.
      const held: DailyBar[] = [];
      const complete = await fetchAll(
        "daily-head",
        batch,
        provider.getDailyBars(batch, job.start, job.end),
        async (page) => {
          held.push(...page);
        },
        range,
      );
      if (!complete) continue;
      if (held.length > 0) await upsertDailyBars(db, held);
      for (const symbol of batch) headDone.add(symbol);
    }
  }

  async function runMinutes(symbols: readonly string[]): Promise<void> {
    if (deps.days === 0) return;
    // A whole minute before the provider's delay limit, so the request never touches it.
    const end = Math.floor((now() - provider.historyDelayMs - MINUTE) / MINUTE) * MINUTE;
    const floor = now() - deps.days * DAY;
    const starts: Array<[string, number]> = [];
    for (const symbol of symbols) {
      const latest = await latestBarTime(db, symbol, provider.historySource);
      const start = Math.max(floor, latest ? latest.getTime() + MINUTE : floor);
      if (start < end) starts.push([symbol, start]);
    }
    for (const [start, batch] of batchesByStart(starts, provider.maxSymbolsPerHistoryRequest)) {
      if (closed) return;
      await fetchAll(
        "minute",
        batch,
        provider.getBars(batch, new Date(start), new Date(end)),
        (page) => upsertBars(db, page),
        { from: new Date(start), to: new Date(end) },
      );
    }
  }

  async function run(symbols: readonly string[]): Promise<void> {
    if (symbols.length === 0) return;
    await runDaily(symbols);
    await runMinutes(symbols);
  }

  return {
    enqueue(symbols) {
      if (closed) return Promise.resolve();
      const job = chain.then(() => (closed ? undefined : run(symbols)));
      chain = job.catch(() => {});
      return job;
    },
    close() {
      closed = true;
      return chain;
    },
  };
}
