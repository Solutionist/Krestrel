// Daily closes for any symbols, watched or not, for portfolio performance (ADR 0024). Reads the
// split-adjusted daily history in `bars_1d` and downloads what is missing over REST
// (`provider.getDailyBars`), storing it like the backfill does; never opens a stream.
import type { Logger } from "pino";

import { nyDay } from "~/lib/candles";
import type { DailyBar } from "~/lib/market";
import type { DayClose } from "~/lib/performance";

import { batchesByStart, nextDay } from "./backfill";
import type { Database } from "./db/client";
import { dailyBounds, listDailyCloses, upsertDailyBars } from "./db/queries/bars";
import type { MarketDataProvider } from "./provider";

export interface DailyClosesDeps {
  provider: MarketDataProvider;
  db: Database;
  logger: Logger;
  now: () => number;
}

export interface DailyClosesResult {
  /**
   * Closes per symbol (every symbol present, possibly empty) from `fromDay` to today's New York
   * date, oldest first, with today's (or the latest session's) last price appended when newer
   * than the stored days.
   */
  closes: Map<string, DayClose[]>;
  /** Symbols whose history download failed (logged): their stored closes may miss days. */
  incomplete: string[];
}

export interface DailyCloses {
  get(symbols: readonly string[], fromDay: string): Promise<DailyClosesResult>;
}

export function createDailyCloses(deps: DailyClosesDeps): DailyCloses {
  const { provider, db, logger, now } = deps;
  // Per symbol, the dates [from, to) already stored or asked for in this process. Saves asking the
  // provider again for days it has nothing for (weekends, before a listing, the latest session).
  const covered = new Map<string, { from: string; to: string }>();
  // One download at a time: the page asks again while one runs (portfolio switch, remount).
  let chain: Promise<void> = Promise.resolve();

  /**
   * Stores the bars for [startDay, endDay). `whole`: store nothing unless every page arrived, for
   * a head before stored history, whose partial download would leave a gap the stored bounds hide.
   */
  async function download(
    batch: string[],
    startDay: string,
    endDay: string,
    whole: boolean,
  ): Promise<boolean> {
    try {
      const held: DailyBar[] = [];
      for await (const page of provider.getDailyBars(batch, startDay, endDay)) {
        if (whole) held.push(...page);
        else await upsertDailyBars(db, page);
      }
      if (held.length > 0) await upsertDailyBars(db, held);
      return true;
    } catch (err) {
      logger.warn(
        { err, symbols: batch, from: startDay, to: endDay },
        "daily closes download failed",
      );
      return false;
    }
  }

  /** Downloads what is missing; returns the symbols whose download failed. */
  async function fill(
    symbols: readonly string[],
    fromDay: string,
    endDay: string,
  ): Promise<Set<string>> {
    const pending = symbols.filter((symbol) => {
      const known = covered.get(symbol);
      return !known || known.from > fromDay || known.to < endDay;
    });
    if (pending.length === 0) return new Set();

    const stored = await dailyBounds(db, pending, provider.historySource);
    // Each job's symbols share one range; the job object is the batching key.
    const jobs = new Map<string, { start: string; end: string; whole: boolean }>();
    const starts: Array<[string, { start: string; end: string; whole: boolean }]> = [];
    const addJob = (symbol: string, start: string, end: string, whole = false) => {
      if (start >= end) return;
      const key = `${start}/${end}/${whole}`;
      const job = jobs.get(key) ?? { start, end, whole };
      jobs.set(key, job);
      starts.push([symbol, job]);
    };
    for (const symbol of pending) {
      const known = covered.get(symbol);
      const bounds = stored.get(symbol);
      if (!bounds) {
        addJob(symbol, fromDay, endDay);
        continue;
      }
      if (fromDay < bounds.first && !(known && known.from <= fromDay)) {
        addJob(symbol, fromDay, bounds.first, true);
      }
      const after = nextDay(bounds.last);
      if (after < endDay && !(known && known.to >= endDay)) addJob(symbol, after, endDay);
    }

    const failed = new Set<string>();
    for (const [job, batch] of batchesByStart(starts, provider.maxSymbolsPerHistoryRequest)) {
      if (!(await download(batch, job.start, job.end, job.whole))) {
        for (const symbol of batch) failed.add(symbol);
      }
    }
    for (const symbol of pending) {
      if (failed.has(symbol)) continue;
      const from = covered.get(symbol)?.from;
      covered.set(symbol, { from: from && from < fromDay ? from : fromDay, to: endDay });
    }
    return failed;
  }

  return {
    async get(symbols, fromDay) {
      const unique = [...new Set(symbols)];
      // Exclusive, like the backfill: today comes from the latest price below.
      const endDay = nyDay(now() - provider.historyDelayMs);
      const job = chain.then(() => fill(unique, fromDay, endDay));
      chain = job.then(
        () => {},
        () => {},
      );
      const failed = await job;

      const result = new Map<string, DayClose[]>(unique.map((symbol) => [symbol, []]));
      const rows = await listDailyCloses(db, unique, provider.historySource, fromDay, endDay);
      for (const row of rows) result.get(row.symbol)?.push([row.day, row.close]);

      try {
        for (const snapshot of await provider.getSnapshots(unique)) {
          if (snapshot.lastPrice === null || snapshot.lastTs === null) continue;
          const day = nyDay(snapshot.lastTs);
          const list = result.get(snapshot.symbol);
          const lastDay = list?.at(-1)?.[0];
          if (list && day >= fromDay && (lastDay === undefined || day > lastDay)) {
            list.push([day, snapshot.lastPrice]);
          }
        }
      } catch (err) {
        logger.warn({ err, symbols: unique.length }, "latest prices for performance failed");
      }
      return { closes: result, incomplete: unique.filter((symbol) => failed.has(symbol)) };
    },
  };
}
