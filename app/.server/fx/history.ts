// Daily USD reference rates over a date range from the European Central Bank, via Frankfurter
// (ADR 0027). Only the currency code and a start date leave this machine; no trade, portfolio or
// account data does (ADR 0013).

import type { Logger } from "pino";
import * as z from "zod";

import { BASE_CURRENCY } from "~/lib/currency";
import { FX_HISTORY_START, type FxHistory, MAX_RATE_AGE_DAYS, shiftDay } from "~/lib/fx-history";

export const ECB_HISTORY_URL = "https://api.frankfurter.dev/v2/providers/ecb/rates";

/**
 * Days fetched before the requested start, so a start on a weekend or holiday still has the
 * previous business day's rate: as far back as `rateOnDay` accepts a rate. A longer gap (the ECB
 * paused some currencies for years) leaves those days without a rate.
 */
export const LEAD_DAYS = MAX_RATE_AGE_DAYS;

const HOUR_MS = 60 * 60 * 1000;
/** The ECB publishes once per business day; a few refreshes a day keep the newest day current. */
const FRESH_FOR_MS = 6 * HOUR_MS;
/** After a failed fetch, wait before asking again rather than hitting the API per request. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** A series since 1999 is ~450 KB; allow longer than the latest-rates request. */
const TIMEOUT_MS = 20_000;

const UpstreamSchema = z.array(
  z.object({ date: z.iso.date(), base: z.string(), quote: z.string(), rate: z.number() }),
);

export type FxHistoryResult = { ok: true; rates: FxHistory } | { ok: false; message: string };

export interface FxHistoryCacheDeps {
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Series {
  /** First day asked of the upstream; the series has every published rate since. */
  from: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * Caches one rate series per currency in memory. A request for an earlier start refetches from
 * there; otherwise the series is refreshed when older than 6 h. On failure it keeps serving the
 * cached series and only reports an error when it doesn't cover the requested start.
 */
export class FxHistoryCache {
  readonly #log: Logger;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #series = new Map<string, Series>();
  readonly #failedAt = new Map<string, number>();
  readonly #loading = new Map<string, Promise<FxHistoryResult>>();

  constructor(deps: FxHistoryCacheDeps) {
    this.#log = deps.logger;
    this.#fetch = deps.fetch ?? fetch;
    this.#now = deps.now ?? Date.now;
  }

  /** Rates for `quote` per 1 USD from `LEAD_DAYS` before `from` up to the latest published day. */
  get(quote: string, from: string): Promise<FxHistoryResult> {
    const lead = shiftDay(from, -LEAD_DAYS);
    const start = lead < FX_HISTORY_START ? FX_HISTORY_START : lead;
    const now = this.#now();
    const series = this.#series.get(quote);
    const covers = series !== undefined && series.from <= start;
    const fresh = covers && now - series.fetchedAt < FRESH_FOR_MS;
    const backingOff =
      now - (this.#failedAt.get(quote) ?? Number.NEGATIVE_INFINITY) < RETRY_AFTER_MS;
    if (covers && (fresh || backingOff)) return Promise.resolve(since(series, start));
    if (backingOff) return Promise.resolve({ ok: false, message: UNAVAILABLE });

    const fetchFrom = series && series.from < start ? series.from : start;
    const key = `${quote}:${fetchFrom}`;
    let loading = this.#loading.get(key);
    if (!loading) {
      loading = this.#refresh(quote, fetchFrom).finally(() => this.#loading.delete(key));
      this.#loading.set(key, loading);
    }
    return loading.then((result) => {
      const latest = this.#series.get(quote);
      return result.ok && latest ? since(latest, start) : result;
    });
  }

  async #refresh(quote: string, from: string): Promise<FxHistoryResult> {
    const url = `${ECB_HISTORY_URL}?base=${BASE_CURRENCY}&quotes=${encodeURIComponent(quote)}&from=${from}`;
    try {
      const response = await this.#fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = UpstreamSchema.parse(await response.json());
      const rates: Record<string, number> = {};
      for (const row of rows) {
        if (row.base === BASE_CURRENCY && row.quote === quote && row.rate > 0) {
          rates[row.date] = row.rate;
        }
      }
      if (Object.keys(rates).length === 0) throw new Error(`no ${quote} rates since ${from}`);
      const current = this.#series.get(quote);
      // A slower request for a later start must not replace a longer series fetched meanwhile.
      if (!current || current.from >= from) {
        this.#series.set(quote, { from, rates, fetchedAt: this.#now() });
      }
      this.#failedAt.delete(quote);
      return { ok: true, rates };
    } catch (err) {
      this.#failedAt.set(quote, this.#now());
      this.#log.warn({ err, quote, from }, "exchange rate history fetch failed");
      const current = this.#series.get(quote);
      return current && current.from <= from
        ? { ok: true, rates: current.rates }
        : { ok: false, message: UNAVAILABLE };
    }
  }
}

/** The series' rates from `start` on (the lead days included in `start` by the caller). */
function since(series: Series, start: string): FxHistoryResult {
  const rates: Record<string, number> = {};
  for (const [day, rate] of Object.entries(series.rates)) {
    if (day >= start) rates[day] = rate;
  }
  return { ok: true, rates };
}

const UNAVAILABLE =
  "Couldn't load past exchange rates (European Central Bank via frankfurter.dev). Amounts are shown in USD.";
