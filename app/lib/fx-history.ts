// Historical USD reference rates (isomorphic), for converting each amount at its own date's rate
// (ADR 0027). The latest-rate conversion for display lives in ./currency (ADR 0013).

import * as z from "zod";

import { nyDay } from "./candles";

/** The ECB's first reference rates are from 1999-01-04; earlier start dates are refused. */
export const FX_HISTORY_START = "1999-01-01";

/**
 * The oldest a published rate may be and still count as a day's rate, in calendar days. The ECB's
 * own closures (Christmas to New Year, Easter) are shorter; a longer gap means the ECB stopped
 * publishing that currency for a while (ISK: 2008-12-03 to 2018-02-01), so those days have no rate.
 */
export const MAX_RATE_AGE_DAYS = 10;

/** Rates per 1 USD keyed by publication day (`YYYY-MM-DD`); weekends and holidays are missing. */
export type FxHistory = Readonly<Record<string, number>>;

/**
 * GET /api/fx/history query: a three-letter currency code (whether the ECB publishes it is checked
 * against the latest rates) and a start date from 1999 up to today (New York).
 */
export const FxHistoryQuerySchema = z.object({
  quote: z.string().regex(/^[A-Z]{3}$/, { error: "Give a three-letter currency code." }),
  from: z.iso
    .date({ error: "Give the start date as YYYY-MM-DD." })
    .refine((day) => day >= FX_HISTORY_START, { error: "Rates start in 1999." })
    .refine((day) => day <= nyDay(Date.now()), { error: "The start date is in the future." }),
});

/** GET /api/fx/history?quote=THB&from=YYYY-MM-DD */
export const FxHistoryResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    quote: z.string(),
    rates: z.record(z.iso.date(), z.number().positive()),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type FxHistoryResponse = z.infer<typeof FxHistoryResponseSchema>;

/** `day` moved by `days` calendar days (negative = earlier). */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The ECB's first reference-rate day; no currency has a rate before it. */
const ECB_FIRST_DAY = "1999-01-04";

/**
 * A lookup of the rate in force on a day: the latest rate published on or before it, so weekends,
 * holidays and today before the ECB publishes use the previous business day's rate. null for a day
 * whose latest rate is more than `MAX_RATE_AGE_DAYS` older (a gap in publication), never a stale
 * rate. A day before the first known rate uses the first one only when the series starts on the
 * ECB's first day (1999-01-04); a series that starts later (a currency published later, or a
 * fetched window) gives null rather than a rate from years after. The lookup itself is null when
 * there are no rates at all.
 */
export function rateOnDay(history: FxHistory): ((day: string) => number | null) | null {
  const days = Object.keys(history).sort();
  const rates = days.map((day) => history[day] ?? Number.NaN);
  const first = rates[0];
  if (first === undefined) return null;
  return (day) => {
    // Binary search for the last published day ≤ `day`.
    let low = 0;
    let high = days.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((days[middle] ?? "") <= day) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (found < 0) return (days[0] ?? "") <= ECB_FIRST_DAY ? first : null;
    if ((days[found] ?? "") < shiftDay(day, -MAX_RATE_AGE_DAYS)) return null;
    return rates[found] ?? null;
  };
}
