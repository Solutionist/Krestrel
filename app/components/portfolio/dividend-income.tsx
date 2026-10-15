import { CoinsIcon } from "@phosphor-icons/react";

import type { DisplayCurrency } from "~/hooks/use-currency";
import type { DividendTally } from "~/lib/dividends";
import { formatShares } from "~/lib/format";
import type { PortfolioTotals } from "~/lib/portfolio";

import { formatDay } from "../dividend-text";
import { HEADING, LABEL } from "../ui/styles";

/** Days of upcoming payments listed (and summed) under the yearly figure. */
export const DIVIDEND_HORIZON_DAYS = 90;
const MAX_ROWS = 8;

const percent = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;

/**
 * Expected dividend income for the portfolio in view (ADR 0022): the yearly rate on the shares
 * held now with its yield on value and on cost, then each payment due in the next 90 days.
 */
export function DividendIncome({
  tally,
  today,
  totals,
  display,
}: {
  tally: DividendTally;
  today: string;
  totals: PortfolioTotals;
  display: DisplayCurrency;
}) {
  if (tally.yearly === 0 && tally.payments.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <CoinsIcon aria-hidden size={14} className="text-accent" />
        {tally.unknown.length > 0
          ? "Dividend data is unavailable right now. Reload the page to try again."
          : "No dividend stocks in this portfolio."}
      </p>
    );
  }
  const soon = tally.payments.reduce((sum, payment) => sum + payment.cash, 0);
  const anyExpected = tally.payments.some((payment) => payment.expected);
  return (
    <section aria-labelledby="dividends-heading" className="grid gap-3 rounded-xl bg-subtle p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="dividends-heading" className={`${HEADING} flex items-center gap-1.5`}>
          <CoinsIcon aria-hidden size={16} className="text-accent" />
          Expected dividends
        </h2>
        <span className="text-xs text-muted">Before tax, at each stock's current dividend</span>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div className="grid gap-0.5">
          <dt className={LABEL}>A year</dt>
          <dd className="text-lg font-semibold tracking-tight text-text tabular-nums">
            {display.money(tally.yearly)}
            <span className="ml-2 text-sm font-normal text-muted">
              ≈ {display.money(tally.yearly / 12)} a month
            </span>
          </dd>
        </div>
        {totals.marketValue > 0 && (
          <div className="grid gap-0.5">
            <dt className={LABEL}>Yield on value</dt>
            <dd className="text-lg font-semibold tracking-tight text-text tabular-nums">
              {percent(tally.pricedYearly / totals.marketValue)}
            </dd>
          </div>
        )}
        {totals.costBasis > 0 && (
          <div className="grid gap-0.5">
            <dt className={LABEL}>Yield on cost</dt>
            <dd className="text-lg font-semibold tracking-tight text-text tabular-nums">
              {percent(tally.pricedYearly / totals.costBasis)}
            </dd>
          </div>
        )}
        <div className="grid gap-0.5">
          <dt className={LABEL}>Next {DIVIDEND_HORIZON_DAYS} days</dt>
          <dd className="text-lg font-semibold tracking-tight text-text tabular-nums">
            {display.money(soon)}
            <span className="ml-2 text-sm font-normal text-muted">
              {tally.payments.length} {tally.payments.length === 1 ? "payment" : "payments"}
            </span>
          </dd>
        </div>
      </dl>

      {tally.payments.length > 0 && (
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">
            Dividend payments in the next {DIVIDEND_HORIZON_DAYS} days
          </caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1 text-left font-normal">
                Paid
              </th>
              <th scope="col" className="py-1 text-left font-normal">
                Stock
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Shares × per share
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/60">
            {tally.payments.slice(0, MAX_ROWS).map((payment) => (
              <tr key={`${payment.symbol}:${payment.exDate}`}>
                <td className="py-1.5 text-text">
                  {formatDay(payment.payDate ?? payment.exDate, today)}
                  {payment.expected && <span className="ml-1 text-xs text-muted">expected</span>}
                </td>
                <td className="py-1.5 font-medium text-text">{payment.symbol}</td>
                <td className="py-1.5 text-right text-muted">
                  {formatShares(payment.shares)} × {display.money(payment.amount)}
                </td>
                <td className="py-1.5 text-right text-text">{display.money(payment.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">
        {tally.unknown.length > 0 &&
          `Not included (dividend data unavailable): ${tally.unknown.join(", ")}. `}
        {tally.payments.length > MAX_ROWS && `+${tally.payments.length - MAX_ROWS} more payments. `}
        {anyExpected && "“Expected” dates are estimated from each stock's usual schedule. "}A payout
        whose ex-dividend date has passed counts the shares you held before it.
      </p>
    </section>
  );
}
