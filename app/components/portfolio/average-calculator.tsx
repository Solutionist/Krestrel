import { CalculatorIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { DisplayCurrency } from "~/hooks/use-currency";
import { BASE_CURRENCY, formatMoney } from "~/lib/currency";
import { formatPrice, formatShares } from "~/lib/format";
import type { QuoteSnapshot } from "~/lib/market";
import { sharesToReachAverage, type ValuedPosition } from "~/lib/portfolio";

import { FIELD, LABEL } from "../ui/styles";

const INPUT = `${FIELD} h-9 w-full tabular-nums`;
const CUSTOM = "__custom";

/** Buy prices for the "what if" table: the given price, then 5/10/15% lower. */
const STEPS = [0, 0.05, 0.1, 0.15] as const;

const REASON: Record<"invalid" | "already" | "unreachable", string> = {
  invalid: "Enter shares held, average cost, buy price and target (all above 0).",
  already: "Your average already equals the target.",
  unreachable:
    "Can't reach that average at this buy price: the target must sit between the buy price and your current average.",
};

const usd = (amount: number) => formatMoney(amount, BASE_CURRENCY);

/**
 * Average-down (or up) calculator: how many shares to buy at a price to move the average cost to
 * a target. Pre-fills from a holding (shares, average, live price); everything is editable.
 */
export function AverageCalculator({
  positions,
  quotes,
  display,
}: {
  positions: readonly ValuedPosition[];
  quotes: Record<string, QuoteSnapshot>;
  display: DisplayCurrency;
}) {
  const held = positions.filter((position) => position.shares > 0 && position.averageCost !== null);
  const [symbol, setSymbol] = useState(CUSTOM);
  const [shares, setShares] = useState("");
  const [average, setAverage] = useState("");
  const [price, setPrice] = useState("");
  const [target, setTarget] = useState("");
  const [fee, setFee] = useState("");

  function pick(next: string) {
    setSymbol(next);
    const position = held.find((p) => p.symbol === next);
    if (!position) return;
    setShares(String(position.shares));
    setAverage(position.averageCost === null ? "" : position.averageCost.toFixed(2));
    const last = quotes[next]?.lastPrice ?? position.lastPrice;
    setPrice(last === null ? "" : String(last));
    setTarget("");
  }

  const numbers = {
    held: Number(shares),
    average: Number(average),
    price: Number(price),
    target: Number(target),
    fee: fee === "" ? 0 : Number(fee),
  };
  const filled = shares !== "" && average !== "" && price !== "" && target !== "";
  const plan = filled ? sharesToReachAverage(numbers) : null;
  const converted = (amount: number) =>
    display.currency === BASE_CURRENCY ? "" : ` (≈ ${display.money(amount)})`;

  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <CalculatorIcon aria-hidden size={14} className="text-accent" />
        How many shares to buy at a lower price to bring your average cost down to a target.
      </p>
      <div className="grid gap-4 rounded-xl bg-subtle p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-3 self-start">
          <label className="col-span-2 grid gap-1.5">
            <span className={LABEL}>Stock</span>
            <select
              value={symbol}
              onChange={(e) => pick(e.target.value)}
              className={`${INPUT} cursor-pointer`}
            >
              <option value={CUSTOM}>Enter my own numbers</option>
              {held.map((position) => (
                <option key={position.symbol} value={position.symbol}>
                  {position.symbol} · {formatShares(position.shares)} @{" "}
                  {position.averageCost === null ? "—" : formatPrice(position.averageCost)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Shares you hold</span>
            <input
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              inputMode="decimal"
              placeholder="50"
              className={INPUT}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Your average cost (USD)</span>
            <input
              value={average}
              onChange={(e) => setAverage(e.target.value)}
              inputMode="decimal"
              placeholder="150"
              className={INPUT}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Buy price (USD)</span>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="80"
              className={INPUT}
            />
          </label>
          <label className="grid gap-1.5">
            <span className={LABEL}>Target average (USD)</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              placeholder="120"
              className={INPUT}
            />
          </label>
          <label className="col-span-2 grid gap-1.5 sm:col-span-1">
            <span className={LABEL}>Fee (USD, optional)</span>
            <input
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className={INPUT}
            />
          </label>
        </div>

        <div
          aria-live="polite"
          className="grid content-start gap-3 rounded-lg bg-panel p-4 ring-1 ring-rule/70"
        >
          {!plan ? (
            <p className="text-sm text-muted">
              Fill in the four numbers to see how many shares to buy. Example: 50 shares at $150,
              buy at $80, target $120 → buy 37.5 shares ($3,000).
            </p>
          ) : !plan.ok ? (
            <p className="flex items-start gap-1.5 text-sm text-fall">
              <WarningCircleIcon aria-hidden size={16} className="mt-px shrink-0" />
              {REASON[plan.reason]}
            </p>
          ) : (
            <>
              <div>
                <p className={LABEL}>Buy</p>
                <p className="text-2xl font-semibold tracking-tight tabular-nums text-text">
                  {formatShares(Number(plan.shares.toFixed(4)))} shares
                  <span className="text-base font-medium text-muted"> at {usd(numbers.price)}</span>
                </p>
                <p className="text-sm tabular-nums text-text">
                  Costs {usd(plan.cost)}
                  <span className="text-muted">{converted(plan.cost)}</span>
                </p>
              </div>
              <p className="text-sm tabular-nums text-muted">
                Whole shares: <span className="text-text">{plan.wholeShares}</span> for{" "}
                <span className="text-text">{usd(plan.wholeCost)}</span>, new average{" "}
                <span className="text-text">{usd(plan.wholeAverage)}</span>. You'd then hold{" "}
                {formatShares(numbers.held + plan.wholeShares)} shares.
              </p>
              <table className="w-full text-sm tabular-nums">
                <caption className={`${LABEL} mb-1 text-left`}>
                  If you buy at a different price
                </caption>
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="py-1 text-left font-normal">
                      Buy price
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      Shares
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule/60">
                  {STEPS.map((step) => {
                    const at = numbers.price * (1 - step);
                    const row = sharesToReachAverage({ ...numbers, price: at });
                    return (
                      <tr key={step}>
                        <td className="py-1.5 text-text">
                          {usd(at)}
                          {step > 0 && (
                            <span className="ml-1 text-xs text-muted">−{step * 100}%</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-text">
                          {row.ok ? formatShares(Number(row.shares.toFixed(2))) : "—"}
                        </td>
                        <td className="py-1.5 text-right text-text">
                          {row.ok ? usd(row.cost) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted">
                A lower average only helps if the stock recovers. Buying more of a falling stock
                adds to the risk. Not financial advice.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
