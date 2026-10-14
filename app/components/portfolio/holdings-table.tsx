import { Link } from "react-router";

import { toneOf } from "~/components/ui/styles";
import type { DisplayCurrency } from "~/hooks/use-currency";
import { formatPercentChange, formatShares } from "~/lib/format";
import type { ValuedPosition } from "~/lib/portfolio";
import type { RsiLevels, RsiSignal } from "~/lib/rsi-signal";

import { RsiSignalBadge } from "../rsi-signal-badge";

/** Background tint matching each `toneOf` text colour. */
const TINT: Record<string, string> = {
  "text-rise": "bg-rise/10",
  "text-fall": "bg-fall/10",
  "text-muted": "bg-subtle",
};

/** Small signed-percent pill tinted by the sign of `value`. */
export function ChangePill({ value, fraction }: { value: number | null; fraction: number }) {
  const tone = toneOf(value);
  return (
    <span
      className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${tone} ${TINT[tone] ?? ""}`}
    >
      {formatPercentChange(fraction)}
    </span>
  );
}

/** Table header cell look, shared with the trade ledger. */
export const TH = "px-3 pb-2 text-xs font-medium text-muted";
const NUMERIC = "px-3 py-2.5 text-right tabular-nums";

/**
 * Open positions by market value, then closed ones (realized P/L only). Amounts are converted to
 * the display currency; the symbol opens its chart.
 */
export function HoldingsTable({
  positions,
  display,
  signals,
  levels,
}: {
  positions: readonly ValuedPosition[];
  display: DisplayCurrency;
  /** Daily RSI signal per symbol (ADR 0014). */
  signals: Record<string, RsiSignal | null>;
  levels: RsiLevels;
}) {
  const open = positions
    .filter((position) => position.shares > 0)
    .sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
  const closed = positions.filter((position) => position.shares === 0);

  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full min-w-[54rem] border-collapse text-sm">
        <caption className="sr-only">Holdings</caption>
        <thead>
          <tr className="border-b border-rule/60">
            <th scope="col" className={`${TH} text-left`}>
              Symbol
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Shares
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Avg cost
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Last
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Value
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Unrealized P/L
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Today
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Realized
            </th>
            <th
              scope="col"
              className={`${TH} text-left`}
              title={`Daily RSI(14) with your levels ${levels.oversold}/${levels.overbought}. A momentum rule of thumb, not financial advice.`}
            >
              Signal
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule/60">
          {open.map((position) => (
            <tr key={position.symbol} className="transition-colors duration-150 hover:bg-subtle">
              <th scope="row" className="px-3 py-2.5 text-left">
                <Link
                  to={`/?symbol=${position.symbol}`}
                  className="font-semibold tracking-tight text-text transition-colors duration-150 hover:text-accent"
                >
                  {position.symbol}
                </Link>
              </th>
              <td className={`${NUMERIC} text-text`}>{formatShares(position.shares)}</td>
              <td className={`${NUMERIC} text-muted`}>
                {position.averageCost === null ? "—" : display.money(position.averageCost)}
              </td>
              <td className={`${NUMERIC} text-text`}>
                {position.lastPrice === null ? (
                  <span title="No live price: the symbol isn't on your watchlist or hasn't traded yet.">
                    —
                  </span>
                ) : (
                  display.money(position.lastPrice)
                )}
              </td>
              <td className={`${NUMERIC} font-medium text-text`}>
                {position.marketValue === null ? "—" : display.money(position.marketValue)}
              </td>
              <td className={`${NUMERIC} ${toneOf(position.unrealized)}`}>
                {position.unrealized === null ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center justify-end gap-2">
                    {display.money(position.unrealized, true)}
                    {position.unrealizedFraction !== null && (
                      <ChangePill
                        value={position.unrealized}
                        fraction={position.unrealizedFraction}
                      />
                    )}
                  </span>
                )}
              </td>
              <td className={`${NUMERIC} ${toneOf(position.dayChange)}`}>
                {position.dayChange === null ? "—" : display.money(position.dayChange, true)}
              </td>
              <td className={`${NUMERIC} ${toneOf(position.realized)}`}>
                {position.realized === 0 ? "—" : display.money(position.realized, true)}
              </td>
              <td className="px-3 py-2.5">
                <RsiSignalBadge signal={signals[position.symbol] ?? null} levels={levels} compact />
              </td>
            </tr>
          ))}
        </tbody>
        {closed.length > 0 && (
          <tbody className="divide-y divide-rule/60 text-muted">
            <tr>
              <th scope="rowgroup" colSpan={9} className={`${TH} pt-6 text-left`}>
                Closed positions
              </th>
            </tr>
            {closed.map((position) => (
              <tr key={position.symbol} className="transition-colors duration-150 hover:bg-subtle">
                <th scope="row" className="px-3 py-2.5 text-left">
                  <Link
                    to={`/?symbol=${position.symbol}`}
                    className="font-medium tracking-tight transition-colors duration-150 hover:text-accent"
                  >
                    {position.symbol}
                  </Link>
                </th>
                <td className={NUMERIC}>0</td>
                <td className={NUMERIC} colSpan={5} />
                <td className={`${NUMERIC} ${toneOf(position.realized)}`}>
                  {display.money(position.realized, true)}
                </td>
                <td />
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
