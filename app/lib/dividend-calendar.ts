// Dividend calendar (ADR 0025): the payments current holdings are expected to bring over the
// coming months, month by month. Built on `dividendTally` (ADR 0022), so a payout already past its
// ex-date counts the shares held before it, and later ones the shares held now.

import {
  type DividendInfo,
  dividendTally,
  type ExpectedPayment,
  type TradeLike,
} from "./dividends";

export interface CalendarMonth {
  /** `YYYY-MM`, by pay date (else ex-date). */
  month: string;
  /** By pay date; `cash` is after the owner's withholding rate. */
  payments: ExpectedPayment[];
  /** Sum of the payments' cash, USD. */
  cash: number;
}

const DAY_MS = 86_400_000;

/**
 * Expected payments from `today` to the end of the month `months − 1` after this one, every month
 * listed even when nothing pays. `unknown`: held stocks without dividend data (left out).
 */
export function dividendCalendar(input: {
  positions: ReadonlyArray<{ symbol: string; shares: number; marketValue: number | null }>;
  trades: readonly TradeLike[];
  dividends: Readonly<Record<string, DividendInfo | null>>;
  today: string;
  months: number;
  /** Percent taken at source, 0–100. */
  withholding: number;
}): { months: CalendarMonth[]; unknown: string[] } {
  const year = Number(input.today.slice(0, 4));
  const month = Number(input.today.slice(5, 7)) - 1;
  // Day 0 of the month after the window is its last day.
  const lastDay = Date.UTC(year, month + input.months, 0);
  const tally = dividendTally({
    positions: input.positions,
    trades: input.trades,
    dividends: input.dividends,
    today: input.today,
    horizonDays: Math.round((lastDay - Date.parse(`${input.today}T00:00:00Z`)) / DAY_MS),
  });
  const keep = 1 - input.withholding / 100;
  const months: CalendarMonth[] = Array.from({ length: input.months }, (_, index) => ({
    month: new Date(Date.UTC(year, month + index, 1)).toISOString().slice(0, 7),
    payments: [],
    cash: 0,
  }));
  for (const payment of tally.payments) {
    // A pending payout without a pay date may carry last month's ex-date: it's due now.
    const due = (payment.payDate ?? payment.exDate).slice(0, 7);
    const slot =
      months.find((entry) => entry.month === due) ?? (due < input.today ? months[0] : undefined);
    if (!slot) continue;
    const cash = payment.cash * keep;
    slot.payments.push({ ...payment, cash });
    slot.cash += cash;
  }
  return { months, unknown: tally.unknown };
}
