// Cash dividends cached per symbol for 6 hours, shared by the hub's schedule (ADR 0022) and the
// past dividends a portfolio has received (ADR 0025), each with its own cache and window.
import type { Logger } from "pino";

import { nyDay } from "~/lib/candles";
import type { DividendPayment } from "~/lib/dividends";

import type { MarketDataProvider } from "./provider";

/** Payouts change a few times a year and announcements can lag; a few refreshes a day keep up. */
const DIVIDEND_TTL_MS = 6 * 60 * 60_000;

interface CachedDividends {
  at: number;
  /** Start of the window the payments were asked for (`YYYY-MM-DD`). */
  fromDay: string;
  payments: DividendPayment[];
}

export interface DividendCache {
  /**
   * Each symbol's cached payouts, refreshing in one provider call `[fromDay, toDay]` every symbol
   * that isn't cached, is older than 6 hours or whose cache `covers` rejects. On failure those
   * symbols are left out (unknown), never reported as paying nothing; so is a cached symbol
   * `covers` rejects.
   */
  get(
    symbols: readonly string[],
    window: { fromDay: string; toDay: string },
    covers: (cached: CachedDividends) => boolean,
  ): Promise<Map<string, DividendPayment[]>>;
}

export function createDividendCache(deps: {
  provider: Pick<MarketDataProvider, "getDividends">;
  logger: Logger;
  now: () => number;
  /** Log message when the provider call fails. */
  failure: string;
}): DividendCache {
  const cache = new Map<string, CachedDividends>();
  return {
    async get(symbols, { fromDay, toDay }, covers) {
      const now = deps.now();
      const unique = [...new Set(symbols)];
      const stale = unique.filter((symbol) => {
        const cached = cache.get(symbol);
        return !cached || !covers(cached) || now - cached.at > DIVIDEND_TTL_MS;
      });
      if (stale.length > 0) {
        try {
          const payments = await deps.provider.getDividends(stale, fromDay, toDay);
          for (const symbol of stale) cache.set(symbol, { at: now, fromDay, payments: [] });
          for (const { symbol, ...payment } of payments) cache.get(symbol)?.payments.push(payment);
        } catch (err) {
          deps.logger.warn({ err, symbols: stale.length }, deps.failure);
        }
      }
      return new Map(
        unique.flatMap((symbol) => {
          const cached = cache.get(symbol);
          return cached && covers(cached) ? [[symbol, cached.payments] as const] : [];
        }),
      );
    },
  };
}

export interface DividendHistory {
  /**
   * Each symbol's cash payouts paid (by pay date, else ex-date) from `fromDay` to today, oldest
   * first. One provider call for whatever isn't cached that far back; on failure those symbols
   * are left out (unknown), never reported as paying nothing.
   */
  get(symbols: readonly string[], fromDay: string): Promise<Map<string, DividendPayment[]>>;
}

/**
 * Past cash dividends since a given day (ADR 0025), for the dividends a portfolio has received.
 * Its own cache, apart from the hub's schedule cache (ADR 0022), which only reaches about 28
 * months back.
 */
export function createDividendHistory(deps: {
  provider: Pick<MarketDataProvider, "getDividends">;
  logger: Logger;
  now: () => number;
}): DividendHistory {
  const cache = createDividendCache({ ...deps, failure: "dividend history request failed" });
  return {
    async get(symbols, fromDay) {
      // A cache reaching less far back (its refresh failed) would undercount: unknown instead.
      const cached = await cache.get(
        symbols,
        { fromDay, toDay: nyDay(deps.now()) },
        (entry) => entry.fromDay <= fromDay,
      );
      return new Map(
        [...cached].map(([symbol, payments]) => [
          symbol,
          payments.filter((payment) => (payment.payDate ?? payment.exDate) >= fromDay),
        ]),
      );
    },
  };
}
