// Daily USD reference rates from the European Central Bank, via Frankfurter (ADR 0013). Only the
// currency codes leave this machine; no market data, portfolio, or account information does.

import type { Logger } from "pino";
import * as z from "zod";

import { BASE_CURRENCY, type FxRates } from "~/lib/currency";

export const ECB_RATES_URL = "https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD";

const HOUR_MS = 60 * 60 * 1000;
/** The ECB publishes once per business day (~16:00 CET); a few refreshes a day is plenty. */
const FRESH_FOR_MS = 6 * HOUR_MS;
/** After a failed refresh, wait before trying again rather than hitting the API per request. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const UpstreamSchema = z
  .array(z.object({ date: z.iso.date(), base: z.string(), quote: z.string(), rate: z.number() }))
  .min(1);

export type FxResult = { ok: true; fx: FxRates } | { ok: false; message: string };

export interface FxRateCacheDeps {
  logger: Logger;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Caches the latest rates in memory. Refreshes when older than 6 h; on failure keeps serving the
 * last good rates (they change slowly) and only reports an error when there were none yet.
 */
export class FxRateCache {
  readonly #log: Logger;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #rates: FxRates | null = null;
  #fetchedAt = 0;
  #failedAt = Number.NEGATIVE_INFINITY;
  #loading: Promise<FxResult> | null = null;

  constructor(deps: FxRateCacheDeps) {
    this.#log = deps.logger;
    this.#fetch = deps.fetch ?? fetch;
    this.#now = deps.now ?? Date.now;
  }

  get(): Promise<FxResult> {
    const now = this.#now();
    const fresh = this.#rates && now - this.#fetchedAt < FRESH_FOR_MS;
    const backingOff = now - this.#failedAt < RETRY_AFTER_MS;
    if (this.#rates && (fresh || backingOff)) {
      return Promise.resolve({ ok: true, fx: this.#rates });
    }
    if (!this.#rates && backingOff) {
      return Promise.resolve({ ok: false, message: UNAVAILABLE });
    }
    this.#loading ??= this.#refresh().finally(() => {
      this.#loading = null;
    });
    return this.#loading;
  }

  async #refresh(): Promise<FxResult> {
    try {
      const response = await this.#fetch(ECB_RATES_URL, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = UpstreamSchema.parse(await response.json());
      const rates: Record<string, number> = { [BASE_CURRENCY]: 1 };
      for (const row of rows) {
        if (row.base === BASE_CURRENCY && row.rate > 0) rates[row.quote] = row.rate;
      }
      const date = rows.reduce((latest, row) => (row.date > latest ? row.date : latest), "");
      this.#rates = { rates, date, source: "European Central Bank" };
      this.#fetchedAt = this.#now();
      return { ok: true, fx: this.#rates };
    } catch (err) {
      this.#failedAt = this.#now();
      this.#log.warn({ err }, "exchange rate refresh failed");
      return this.#rates ? { ok: true, fx: this.#rates } : { ok: false, message: UNAVAILABLE };
    }
  }
}

const UNAVAILABLE =
  "Couldn't load exchange rates (European Central Bank via frankfurter.dev). Amounts are shown in USD.";
