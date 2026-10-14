import { PencilSimpleIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useFetcher } from "react-router";

import { IconButton } from "~/components/ui/button";
import { formatMoney } from "~/lib/currency";
import { formatShares } from "~/lib/format";
import type { PortfolioActionResult, Trade, TradeSide } from "~/lib/portfolio";

import { TH } from "./holdings-table";

const CELL = "px-3 py-2";
const NUMERIC = `${CELL} text-right tabular-nums`;

const SIDE_CHIP: Record<TradeSide, string> = {
  buy: "bg-rise/10 text-rise",
  sell: "bg-fall/10 text-fall",
};

/** Dimmed until the row is hovered or focused; never hidden, so it stays clickable. */
const ROW_ACTION = "opacity-60 group-hover:opacity-100 group-focus-within:opacity-100";

/** The trade ledger, newest first, in USD as recorded. */
export function TradeHistory({
  trades,
  portfolioNames,
  editingId,
  onEdit,
}: {
  trades: readonly Trade[];
  /** Shown as a column when listing several portfolios. */
  portfolioNames: Record<string, string> | null;
  editingId: string | null;
  onEdit: (trade: Trade) => void;
}) {
  const remove = useFetcher<PortfolioActionResult>();
  const error = remove.data && !remove.data.ok ? remove.data.error.message : null;

  function confirmDelete(trade: Trade) {
    const what = `${trade.side} of ${formatShares(trade.shares)} ${trade.symbol} on ${trade.tradedOn}`;
    if (!window.confirm(`Delete the ${what}?`)) return;
    remove.submit(
      { intent: "deleteTrade", id: trade.id },
      { method: "post", action: "/api/portfolios", encType: "application/json" },
    );
  }

  if (trades.length === 0) {
    return <p className="py-2 text-sm text-muted">No trades yet. Record a buy above.</p>;
  }

  return (
    <div className="grid gap-2">
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
          {error}
        </p>
      )}
      <div className="-mx-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Trades, in USD</caption>
          <thead>
            <tr className="border-b border-rule/60">
              <th scope="col" className={`${TH} text-left`}>
                Date
              </th>
              <th scope="col" className={`${TH} text-left`}>
                Trade
              </th>
              {portfolioNames && (
                <th scope="col" className={`${TH} text-left`}>
                  Portfolio
                </th>
              )}
              <th scope="col" className={`${TH} text-right`}>
                Shares
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Price
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Fee
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Total
              </th>
              <th scope="col" className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/60">
            {trades.map((trade) => {
              const gross = trade.shares * trade.price;
              const total = trade.side === "buy" ? gross + trade.fee : gross - trade.fee;
              const when = `${trade.side} ${trade.symbol} on ${trade.tradedOn}`;
              return (
                <tr
                  key={trade.id}
                  className={`group transition-colors duration-150 ${trade.id === editingId ? "bg-accent/8" : "hover:bg-subtle"}`}
                >
                  <td className={`${CELL} text-muted tabular-nums`}>{trade.tradedOn}</td>
                  <td className={CELL}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${SIDE_CHIP[trade.side]}`}
                      >
                        {trade.side === "buy" ? "Buy" : "Sell"}
                      </span>
                      <span className="font-semibold tracking-tight text-text">{trade.symbol}</span>
                    </span>
                  </td>
                  {portfolioNames && (
                    <td className={`${CELL} text-muted`}>{portfolioNames[trade.portfolioId]}</td>
                  )}
                  <td className={`${NUMERIC} text-text`}>{formatShares(trade.shares)}</td>
                  <td className={`${NUMERIC} text-text`}>{formatMoney(trade.price, "USD")}</td>
                  <td className={`${NUMERIC} text-muted`}>
                    {trade.fee > 0 ? formatMoney(trade.fee, "USD") : "—"}
                  </td>
                  <td className={`${NUMERIC} font-medium text-text`}>
                    {formatMoney(total, "USD")}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <span className="inline-flex gap-0.5">
                      <IconButton
                        label={`Edit ${when}`}
                        onClick={() => onEdit(trade)}
                        className={ROW_ACTION}
                      >
                        <PencilSimpleIcon aria-hidden size={14} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${when}`}
                        variant="danger"
                        onClick={() => confirmDelete(trade)}
                        className={ROW_ACTION}
                      >
                        <TrashIcon aria-hidden size={14} />
                      </IconButton>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
