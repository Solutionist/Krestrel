// Dividend schedule from the provider's cash-dividend records (ADR 0022): how often a stock pays,
// the latest regular amount, and the next payment, announced or, when not yet announced,
// expected from the usual schedule. Shared by the server (GET /api/dividends) and the page.

import * as z from "zod";

import { SHARE_EPSILON } from "./portfolio";

/** One cash dividend as the provider reports it. Dates are `YYYY-MM-DD`. */
export interface DividendPayment {
  /** Buy before this date to receive the payment. */
  exDate: string;
  payDate: string | null;
  /** Per share, in the listing's currency (USD). */
  amount: number;
  /** One-off extra payment; not part of the regular schedule. */
  special: boolean;
}

export const DIVIDEND_FREQUENCIES = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "irregular",
] as const;
export type DividendFrequency = (typeof DIVIDEND_FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<DividendFrequency, string> = {
  monthly: "Pays monthly",
  quarterly: "Pays quarterly",
  semiannual: "Pays twice a year",
  annual: "Pays yearly",
  irregular: "Pays irregularly",
};

/** Regular payments a year, for an annual rate; null when the schedule isn't regular. */
export const PAYMENTS_PER_YEAR: Record<DividendFrequency, number | null> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
  irregular: null,
};

/**
 * Yearly yield in percent at `price`: the next (or last) amount × payments a year ÷ price. Null for
 * an irregular payer or without a price.
 */
export function dividendYield(info: DividendInfo, price: number | null): number | null {
  const perYear = PAYMENTS_PER_YEAR[info.frequency];
  if (perYear === null || price === null || price <= 0) return null;
  return ((info.next?.amount ?? info.last.amount) * perYear * 100) / price;
}

const DividendDatesSchema = z.object({
  exDate: z.iso.date(),
  payDate: z.iso.date().nullable(),
  amount: z.number().positive(),
});

export const DividendInfoSchema = z.object({
  frequency: z.enum(DIVIDEND_FREQUENCIES),
  /** The newest regular payment whose ex-date has passed (its pay date may still be ahead). */
  last: DividendDatesSchema,
  /** The next regular payment: announced by the company, or expected from the schedule. */
  next: DividendDatesSchema.extend({ expected: z.boolean() }).nullable(),
});
export type DividendInfo = z.infer<typeof DividendInfoSchema>;

export const DividendsResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** New York date the schedules were worked out for. */
    today: z.iso.date(),
    /** Per symbol; null when it pays no regular dividend (or none in the last 15 months). */
    dividends: z.record(z.string(), DividendInfoSchema.nullable()),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type DividendsResponse = z.infer<typeof DividendsResponseSchema>;

/** A stock whose latest regular ex-date is older than this no longer counts as paying a dividend. */
export const DIVIDEND_STALE_DAYS = 455;
/**
 * History asked of the provider (its window is by pay date). A yearly payer needs two payments in
 * it to be told apart, even when its latest is almost stale: that one, a year before it, and the
 * usual few weeks between an ex-date and its pay date.
 */
export const DIVIDEND_LOOKBACK_DAYS = DIVIDEND_STALE_DAYS + 366 + 45;
/** How far ahead announced payments are fetched. */
export const DIVIDEND_LOOKAHEAD_DAYS = 120;
/** Symbols per GET /api/dividends request; the page splits larger sets into several requests. */
export const MAX_DIVIDEND_SYMBOLS = 100;

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, days: number) =>
  new Date(dayMs(day) + days * DAY_MS).toISOString().slice(0, 10);

function frequencyOf(gapDays: number | null): DividendFrequency {
  if (gapDays === null) return "irregular";
  if (gapDays <= 45) return "monthly";
  if (gapDays <= 120) return "quarterly";
  if (gapDays <= 240) return "semiannual";
  if (gapDays <= 420) return "annual";
  return "irregular";
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * The dividend schedule as of `today` (`YYYY-MM-DD`, New York), or null for a stock without a
 * regular dividend in the last 15 months. Frequency is the median gap between the latest regular
 * ex-dates. The next payment is the first announced one after today; otherwise the last one
 * moved on by that frequency in calendar months (and again until it lies after today), marked
 * `expected`.
 */
export function dividendInfo(
  payments: readonly DividendPayment[],
  today: string,
): DividendInfo | null {
  const regular = payments
    .filter((payment) => !payment.special && payment.amount > 0)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  const past = regular.filter((payment) => payment.exDate <= today);
  const last = past.at(-1);
  if (!last || dayMs(today) - dayMs(last.exDate) > DIVIDEND_STALE_DAYS * DAY_MS) return null;

  const recent = regular.slice(-7);
  const gaps = recent
    .slice(1)
    .map((payment, index) => {
      const previous = recent[index];
      return previous ? (dayMs(payment.exDate) - dayMs(previous.exDate)) / DAY_MS : 0;
    })
    .filter((gap) => gap > 0);
  const gap = median(gaps);
  const frequency = frequencyOf(gap);

  const announced = regular.find((payment) => payment.exDate > today);
  let next: DividendInfo["next"] = announced
    ? {
        exDate: announced.exDate,
        payDate: announced.payDate,
        amount: announced.amount,
        expected: false,
      }
    : null;
  const perYear = PAYMENTS_PER_YEAR[frequency];
  if (!next && perYear !== null) {
    // Calendar months, not days: a month-end payer's ~31-day gap would skip February.
    const stepMonths = 12 / perYear;
    // Overdue but not yet announced: the schedule still says one is coming.
    for (let k = 1; !next || next.exDate <= today; k++) {
      next = {
        exDate: addMonths(last.exDate, stepMonths * k),
        payDate: last.payDate ? addMonths(last.payDate, stepMonths * k) : null,
        amount: last.amount,
        expected: true,
      };
    }
  }

  return {
    frequency,
    last: { exDate: last.exDate, payDate: last.payDate, amount: last.amount },
    next,
  };
}

export interface UpcomingDividend {
  exDate: string;
  payDate: string | null;
  amount: number;
  /** Estimated from the schedule; the company hasn't announced it yet. */
  expected: boolean;
  /** Ex-date has passed, payment still to come: shares held before the ex-date are paid. */
  pending: boolean;
}

/** The payment a holder is waiting for: one already past its ex-date but unpaid, else the next. */
export function upcomingDividend(info: DividendInfo, today: string): UpcomingDividend | null {
  if (info.last.payDate && info.last.payDate >= today) {
    return { ...info.last, expected: false, pending: true };
  }
  return info.next ? { ...info.next, pending: false } : null;
}

/**
 * `day` moved by `months` calendar months, kept on the same day of the month or the month's last
 * day when it has fewer (Jan 31 → Feb 28), so a monthly payer lands in every month.
 */
function addMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Every payment from `today` up to and including `untilDay` (by pay date, else ex-date): a payout
 * still pending, the next one, then further ones projected by the usual gap in calendar months
 * (always `expected`).
 */
export function projectDividends(
  info: DividendInfo,
  today: string,
  untilDay: string,
): UpcomingDividend[] {
  const payments: UpcomingDividend[] = [];
  const within = (payment: { exDate: string; payDate: string | null }) =>
    (payment.payDate ?? payment.exDate) <= untilDay;
  if (info.last.payDate && info.last.payDate >= today && within(info.last)) {
    payments.push({ ...info.last, expected: false, pending: true });
  }
  const first = info.next;
  const perYear = PAYMENTS_PER_YEAR[info.frequency];
  // Months between payments: 1 monthly, 3 quarterly, 6 twice a year, 12 yearly.
  const stepMonths = perYear === null ? null : 12 / perYear;
  // The next payment as known, then the same amount every usual gap after it.
  for (let k = 0; first && k < 400; k++) {
    const months = k === 0 || stepMonths === null ? 0 : stepMonths * k;
    const payment: UpcomingDividend = {
      exDate: addMonths(first.exDate, months),
      payDate: first.payDate ? addMonths(first.payDate, months) : null,
      amount: first.amount,
      expected: k > 0 || first.expected,
      pending: false,
    };
    if (!within(payment)) break;
    payments.push(payment);
    if (stepMonths === null) break;
  }
  return payments;
}

/** What `sharesHeldBefore` needs from a trade (`Trade` from `~/lib/portfolio` fits). */
export interface TradeLike {
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  /** New York date, `YYYY-MM-DD`. */
  tradedOn: string;
}

/**
 * Shares of `symbol` held at the start of `exDate` (trades dated before it), which is what a
 * dividend with that ex-date is paid on. Trades are New York dates (`YYYY-MM-DD`).
 */
export function sharesHeldBefore(
  trades: readonly TradeLike[],
  symbol: string,
  exDate: string,
): number {
  let shares = 0;
  for (const trade of trades) {
    if (trade.symbol !== symbol || trade.tradedOn >= exDate) continue;
    shares += trade.side === "buy" ? trade.shares : -trade.shares;
  }
  // Float residue from buys and sells that cancel out is not a holding.
  return shares < SHARE_EPSILON ? 0 : shares;
}

export interface ExpectedPayment extends UpcomingDividend {
  symbol: string;
  /** Shares the payment is on: held before its ex-date if that has passed, else held now. */
  shares: number;
  /** shares × amount, USD before tax. */
  cash: number;
}

export interface DividendTally {
  /** Yearly income at the current rate on the shares held now, USD. */
  yearly: number;
  /**
   * The part of `yearly` from holdings that have a live price: the same holdings the portfolio's
   * value and cost totals cover, so yields compare like with like.
   */
  pricedYearly: number;
  /** Payments due within the horizon, by pay date. */
  payments: ExpectedPayment[];
  /** Each holding's next payment (no horizon), for the holdings table. */
  nextBySymbol: Record<string, ExpectedPayment>;
  /**
   * Held stocks the provider couldn't be asked about (not "no dividend"): their income is missing
   * from the totals, which must say so rather than claim the portfolio pays nothing.
   */
  unknown: string[];
}

/**
 * Expected dividend income for a portfolio (ADR 0022): the yearly rate on current shares, the
 * payments due over the next `horizonDays`, and each holding's next payment. A payout whose
 * ex-date has passed counts only the shares held before it (from the trades), so a buy after the
 * ex-date adds nothing and a sell after it still collects.
 */
export function dividendTally(input: {
  /**
   * Every position in view, including closed ones (a pending payout can outlive the shares).
   * `marketValue` null means no live price: such a holding is left out of `pricedYearly`.
   */
  positions: ReadonlyArray<{ symbol: string; shares: number; marketValue: number | null }>;
  trades: readonly TradeLike[];
  dividends: Readonly<Record<string, DividendInfo | null>>;
  today: string;
  horizonDays: number;
}): DividendTally {
  const { positions, trades, dividends, today } = input;
  const untilDay = addDays(today, input.horizonDays);
  const tally: DividendTally = {
    yearly: 0,
    pricedYearly: 0,
    payments: [],
    nextBySymbol: {},
    unknown: [],
  };
  const priced = (symbol: string, payment: UpcomingDividend, sharesNow: number) => {
    const shares = payment.pending ? sharesHeldBefore(trades, symbol, payment.exDate) : sharesNow;
    return { ...payment, symbol, shares, cash: shares * payment.amount };
  };
  for (const { symbol, shares, marketValue } of positions) {
    if (!(symbol in dividends)) {
      if (shares > 0) tally.unknown.push(symbol);
      continue;
    }
    const info = dividends[symbol];
    if (!info) continue;
    const perYear = PAYMENTS_PER_YEAR[info.frequency];
    if (perYear !== null) {
      const income = shares * (info.next?.amount ?? info.last.amount) * perYear;
      tally.yearly += income;
      if (marketValue !== null) tally.pricedYearly += income;
    }
    for (const payment of projectDividends(info, today, untilDay)) {
      const expected = priced(symbol, payment, shares);
      if (expected.shares > 0) tally.payments.push(expected);
    }
    // The first payment this holding actually gets: a pending one only if held before its ex-date.
    const pending = upcomingDividend(info, today);
    const candidates = [
      ...(pending?.pending ? [pending] : []),
      ...(info.next ? [{ ...info.next, pending: false }] : []),
    ];
    const next = candidates
      .map((payment) => priced(symbol, payment, shares))
      .find((p) => p.shares > 0);
    if (next) tally.nextBySymbol[symbol] = next;
  }
  tally.payments.sort(
    (a, b) =>
      (a.payDate ?? a.exDate).localeCompare(b.payDate ?? b.exDate) ||
      a.symbol.localeCompare(b.symbol),
  );
  return tally;
}
