// Display-currency conversion (isomorphic). Prices and P/L are computed in USD; amounts are
// converted at the latest daily reference rate only for display (ADR 0013).

import * as z from "zod";

export const BASE_CURRENCY = "USD";

export const FxRatesSchema = z.object({
  /** Rates are units of `quote` per 1 USD; always includes USD itself (1). */
  rates: z.record(z.string(), z.number().positive()),
  /** Business day the rates are for (YYYY-MM-DD). */
  date: z.iso.date(),
  /** Who publishes the rates, for attribution. */
  source: z.string(),
});
export type FxRates = z.infer<typeof FxRatesSchema>;

/** GET /api/fx */
export const FxResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), fx: FxRatesSchema }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);
export type FxResponse = z.infer<typeof FxResponseSchema>;

// U+2212 MINUS SIGN, matching ~/lib/format.
const MINUS = "\u2212";

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats an amount in `currency`, e.g. `$1,234.50`, `฿41,470.00`, `¥3,200` (decimals per ISO
 * 4217). `signed` prefixes + / − unless the amount rounds to zero.
 */
export function formatMoney(amount: number, currency: string, signed = false): string {
  const key = `${currency}:${signed}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      signDisplay: signed ? "exceptZero" : "auto",
    });
    formatters.set(key, formatter);
  }
  return formatter.format(amount).replace("-", MINUS);
}

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

/** "Thai Baht" for "THB"; the code itself when the runtime doesn't know it. */
export function currencyName(code: string): string {
  return currencyNames.of(code) ?? code;
}
