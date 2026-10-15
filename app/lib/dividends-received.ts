// Dividends already received (ADR 0025): the provider's past payouts × the shares each portfolio
// held before the ex-date, less the owner's withholding rate, unless the owner entered the exact
// cash their broker paid. Shared by the server (GET/POST /api/dividends-received) and the page.

import * as z from "zod";

import { type DividendPayment, sharesHeldBefore, type TradeLike } from "./dividends";
import { SymbolSchema } from "./market";

export interface ReceivedDividend {
  portfolioId: string;
  symbol: string;
  exDate: string;
  payDate: string | null;
  shares: number;
  perShare: number;
  /** USD actually received: the owner's override if set, else shares × perShare × (1 − withholding/100). */
  cash: number;
  overridden: boolean;
}

/** Symbols per GET /api/dividends-received request (every stock a portfolio ever traded). */
export const MAX_RECEIVED_SYMBOLS = 500;
export const MAX_RECEIVED_PORTFOLIOS = 100;

/** Which payout an override corrects: one ex-date of one stock in one portfolio. */
export const DividendOverrideKeySchema = z.object({
  portfolioId: z.uuid(),
  symbol: SymbolSchema,
  exDate: z.iso.date(),
});

/** The owner's correction: the cash that actually arrived, USD after any withholding. */
export const DividendOverrideSchema = DividendOverrideKeySchema.extend({
  amount: z
    .number({ error: "Enter the amount received" })
    .min(0, { error: "The amount can't be negative" })
    .max(1e9),
});
export type DividendOverride = z.infer<typeof DividendOverrideSchema>;
export type DividendOverrideKey = z.infer<typeof DividendOverrideKeySchema>;

/** POST /api/dividends-received body. */
export const DividendOverrideActionSchema = z.discriminatedUnion("intent", [
  DividendOverrideSchema.extend({ intent: z.literal("set") }),
  DividendOverrideKeySchema.extend({ intent: z.literal("clear") }),
]);

const ErrorSchema = z.object({ code: z.string(), message: z.string() });

export const DividendOverrideResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: ErrorSchema }),
]);
export type DividendOverrideResult = z.infer<typeof DividendOverrideResultSchema>;

const PayoutSchema = z.object({
  exDate: z.iso.date(),
  payDate: z.iso.date().nullable(),
  amount: z.number().nonnegative(),
  special: z.boolean(),
});

/**
 * GET /api/dividends-received response: each symbol's cash payouts since `from` (missing when the
 * provider couldn't be asked) and the owner's overrides for the portfolios asked about.
 */
export const DividendsReceivedResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    today: z.iso.date(),
    payouts: z.record(z.string(), z.array(PayoutSchema)),
    overrides: z.array(DividendOverrideSchema),
  }),
  z.object({ ok: z.literal(false), error: ErrorSchema }),
]);
export type DividendsReceivedResponse = z.infer<typeof DividendsReceivedResponseSchema>;

/** What `receivedDividends` needs from a trade (`Trade` from `~/lib/portfolio` fits). */
export interface PortfolioTradeLike extends TradeLike {
  portfolioId: string;
}

/**
 * Every payout already paid (pay date, else ex-date, on or before `today`) that a portfolio was
 * entitled to: shares held before the ex-date, from that portfolio's trades alone. Regular and
 * special cash payouts both count; payouts sharing an ex-date are one payment (one override).
 * Oldest first.
 */
export function receivedDividends(input: {
  payouts: Readonly<Record<string, readonly DividendPayment[]>>;
  trades: readonly PortfolioTradeLike[];
  overrides: readonly DividendOverride[];
  /** Percent taken at source, 0–100; ignored where the owner entered the amount. */
  withholding: number;
  today: string;
}): ReceivedDividend[] {
  const keep = 1 - input.withholding / 100;
  const overrides = new Map(
    input.overrides.map((override) => [
      `${override.portfolioId} ${override.symbol} ${override.exDate}`,
      override.amount,
    ]),
  );
  const received: ReceivedDividend[] = [];
  for (const [portfolioId, trades] of Map.groupBy(input.trades, (trade) => trade.portfolioId)) {
    for (const symbol of new Set(trades.map((trade) => trade.symbol))) {
      const byExDate = new Map<string, { payDate: string | null; perShare: number }>();
      for (const payout of input.payouts[symbol] ?? []) {
        if (payout.amount <= 0 || (payout.payDate ?? payout.exDate) > input.today) continue;
        const same = byExDate.get(payout.exDate);
        byExDate.set(payout.exDate, {
          payDate: same?.payDate ?? payout.payDate,
          perShare: (same?.perShare ?? 0) + payout.amount,
        });
      }
      for (const [exDate, { payDate, perShare }] of byExDate) {
        const shares = sharesHeldBefore(trades, symbol, exDate);
        if (shares <= 0) continue;
        const override = overrides.get(`${portfolioId} ${symbol} ${exDate}`);
        received.push({
          portfolioId,
          symbol,
          exDate,
          payDate,
          shares,
          perShare,
          cash: override ?? shares * perShare * keep,
          overridden: override !== undefined,
        });
      }
    }
  }
  return received.sort(
    (a, b) =>
      (a.payDate ?? a.exDate).localeCompare(b.payDate ?? b.exDate) ||
      a.symbol.localeCompare(b.symbol) ||
      a.portfolioId.localeCompare(b.portfolioId),
  );
}

/** Cash received per calendar year of payment, oldest year first. */
export function receivedByYear(
  received: readonly ReceivedDividend[],
): Array<{ year: number; cash: number }> {
  const byYear = new Map<number, number>();
  for (const payment of received) {
    const year = Number((payment.payDate ?? payment.exDate).slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + payment.cash);
  }
  return [...byYear].map(([year, cash]) => ({ year, cash })).sort((a, b) => a.year - b.year);
}

/** Received this calendar year so far, in the whole of last year, and since the first trade. */
export function receivedSummary(
  received: readonly ReceivedDividend[],
  today: string,
): { thisYear: number; lastYear: number; allTime: number } {
  const year = Number(today.slice(0, 4));
  const byYear = receivedByYear(received);
  return {
    thisYear: byYear.find((entry) => entry.year === year)?.cash ?? 0,
    lastYear: byYear.find((entry) => entry.year === year - 1)?.cash ?? 0,
    allTime: byYear.reduce((sum, entry) => sum + entry.cash, 0),
  };
}
