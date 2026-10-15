import type { Logger } from "pino";

import { nyDay } from "~/lib/candles";

import type { Database } from "./db/client";
import { latestBarTime, latestDailyDay, upsertBars, upsertDailyBars } from "./db/queries/bars";
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
function batchesByStart<K>(
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

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/**
 * Incremental, idempotent history backfill (ADR 0005, ADR 0011), in two phases:
 * 1. Daily bars for the last `dailyYears`, up to (excluding) today's New York date.
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

  async function fetchAll<T>(
    label: string,
    batch: string[],
    pages: AsyncIterable<T[]>,
    store: (page: T[]) => Promise<void>,
    range: Record<string, unknown>,
  ): Promise<void> {
    const log = logger.child({ symbols: batch, kind: label });
    let stored = 0;
    try {
      for await (const page of pages) {
        await store(page);
        stored += page.length;
      }
      log.info({ stored, ...range }, "backfill complete");
    } catch (err) {
      // Partial pages are already stored; the next run resumes from the newest bar.
      log.error({ err, stored }, "backfill failed");
    }
  }

  async function runDaily(symbols: readonly string[]): Promise<void> {
    if (deps.dailyYears === 0) return;
    // Exclusive: today comes from minute bars. Shifted by the history delay so the last included
    // day has been over for at least that long (just after midnight, yesterday is still "recent").
    const endDay = nyDay(now() - provider.historyDelayMs);
    const floorDay = nyDay(now() - deps.dailyYears * 365 * DAY);
    const starts: Array<[string, string]> = [];
    for (const symbol of symbols) {
      const latest = await latestDailyDay(db, symbol, provider.historySource);
      const start = latest && latest >= floorDay ? nextDay(latest) : floorDay;
      if (start < endDay) starts.push([symbol, start]);
    }
    for (const [startDay, batch] of batchesByStart(starts, provider.maxSymbolsPerHistoryRequest)) {
      if (closed) return;
      await fetchAll(
        "daily",
        batch,
        provider.getDailyBars(batch, startDay, endDay),
        (page) => upsertDailyBars(db, page),
        { from: startDay, to: endDay },
      );
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
