import { WarningCircleIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { FIELD, LABEL } from "~/components/ui/styles";
import { nyDay } from "~/lib/candles";
import { formatPrice } from "~/lib/format";
import type { QuoteSnapshot } from "~/lib/market";
import {
  type PortfolioActionResult,
  TRADE_SIDES,
  type Trade,
  TradeInputSchema,
  type TradeSide,
} from "~/lib/portfolio";

const ACTION = "/api/portfolios";

const SIDE_LABEL: Record<TradeSide, string> = { buy: "Buy", sell: "Sell" };

const INPUT = `${FIELD} h-9 w-full tabular-nums`;

/** Chosen side tint: buys read as rise, sells as fall. */
const SIDE_ACTIVE: Record<TradeSide, string> = {
  buy: "bg-rise/12 text-rise",
  sell: "bg-fall/12 text-fall",
};

/**
 * Records a buy or sell (USD, as on the broker statement), or edits `editing`. The server
 * re-validates and refuses sells of more shares than were held on that date.
 */
export function TradeForm({
  portfolios,
  portfolioId,
  editing,
  suggestions,
  quotes,
  onDone,
}: {
  portfolios: readonly { id: string; name: string }[];
  /** Portfolio for new trades; null asks the owner to pick one. */
  portfolioId: string | null;
  editing: Trade | null;
  /** Symbols offered in the ticker field (watchlist and holdings). */
  suggestions: readonly string[];
  quotes: Record<string, QuoteSnapshot>;
  onDone: () => void;
}) {
  const fetcher = useFetcher<PortfolioActionResult>();
  const ids = useId();
  const [side, setSide] = useState<TradeSide>(editing?.side ?? "buy");
  const [target, setTarget] = useState(portfolioId ?? portfolios[0]?.id ?? "");
  const [symbol, setSymbol] = useState(editing?.symbol ?? "");
  const [shares, setShares] = useState(editing ? String(editing.shares) : "");
  const [price, setPrice] = useState(editing ? String(editing.price) : "");
  const [fee, setFee] = useState(editing && editing.fee > 0 ? String(editing.fee) : "");
  const [tradedOn, setTradedOn] = useState(editing?.tradedOn ?? nyDay(Date.now()));
  const [problem, setProblem] = useState<string | null>(null);

  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const last = quotes[symbol.trim().toUpperCase()]?.lastPrice ?? null;

  // After a successful save: leave edit mode, or clear the amounts for the next trade.
  useEffect(() => {
    if (fetcher.state !== "idle" || !result?.ok) return;
    if (editing) {
      onDone();
      return;
    }
    setShares("");
    setPrice("");
    setFee("");
  }, [fetcher.state, result, editing, onDone]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = TradeInputSchema.safeParse({
      symbol,
      side,
      shares,
      price,
      fee: fee === "" ? 0 : fee,
      tradedOn,
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "Check the trade");
      return;
    }
    if (!editing && !target) {
      setProblem("Create a portfolio first");
      return;
    }
    setProblem(null);
    fetcher.submit(
      editing
        ? { intent: "updateTrade", id: editing.id, ...parsed.data }
        : { intent: "addTrade", portfolioId: target, ...parsed.data },
      { method: "post", action: ACTION, encType: "application/json" },
    );
  }

  const message = problem ?? (result && !result.ok ? result.error.message : null);
  const warning = !problem && result?.ok ? result.warning : undefined;

  return (
    <form
      onSubmit={submit}
      aria-label={editing ? `Edit ${editing.symbol} trade` : "Record a trade"}
      className="grid gap-3 rounded-xl bg-subtle p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <span aria-hidden className={LABEL}>
            Side
          </span>
          {/* Radios styled as a segmented control: native keyboard (arrows) and form semantics. */}
          <fieldset className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-panel p-0.5 ring-1 ring-inset ring-rule">
            <legend className="sr-only">Side</legend>
            {TRADE_SIDES.map((value) => (
              <label
                key={value}
                className={`inline-flex h-full cursor-pointer items-center rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 ${
                  side === value ? SIDE_ACTIVE[value] : "text-muted hover:text-text"
                }`}
              >
                <input
                  type="radio"
                  name={`${ids}-side`}
                  value={value}
                  checked={side === value}
                  onChange={() => setSide(value)}
                  className="sr-only"
                />
                {SIDE_LABEL[value]}
              </label>
            ))}
          </fieldset>
        </div>

        {!editing && portfolios.length > 1 && (
          <label className="grid gap-1.5">
            <span className={LABEL}>Portfolio</span>
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className={`${FIELD} h-9 pr-8`}
            >
              {portfolios.map((portfolio) => (
                <option key={portfolio.id} value={portfolio.id}>
                  {portfolio.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="grid w-28 gap-1.5">
          <span className={LABEL}>Ticker</span>
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            list={`${ids}-symbols`}
            placeholder="AAPL"
            autoComplete="off"
            spellCheck={false}
            required
            className={`${INPUT} font-medium`}
          />
          <datalist id={`${ids}-symbols`}>
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </label>

        <label className="grid w-28 gap-1.5">
          <span className={LABEL}>Shares</span>
          <input
            value={shares}
            onChange={(event) => setShares(event.target.value)}
            inputMode="decimal"
            placeholder="10"
            required
            className={INPUT}
          />
        </label>

        <label className="grid w-36 gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className={LABEL}>Price (USD)</span>
            {last !== null && (
              <button
                type="button"
                onClick={() => setPrice(String(last))}
                className="rounded-md text-xs font-medium text-accent tabular-nums transition-colors duration-150 hover:text-accent/80"
                title="Use the last trade price"
              >
                {formatPrice(last)}
              </button>
            )}
          </span>
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="187.50"
            required
            className={INPUT}
          />
        </label>

        <label className="grid w-24 gap-1.5">
          <span className={LABEL}>Fee (USD)</span>
          <input
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={INPUT}
          />
        </label>

        <label className="grid gap-1.5">
          <span className={LABEL}>Date</span>
          <input
            type="date"
            value={tradedOn}
            onChange={(event) => setTradedOn(event.target.value)}
            max={nyDay(Date.now())}
            required
            className={INPUT}
          />
        </label>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save" : `Add ${SIDE_LABEL[side].toLowerCase()}`}
          </Button>
          {editing && (
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {message && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
          {message}
        </p>
      )}
      {warning && (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-lg bg-accent/8 px-3 py-2 text-xs text-text ring-1 ring-inset ring-accent/20"
        >
          <WarningCircleIcon aria-hidden size={14} className="shrink-0 text-accent" />
          {warning}
        </p>
      )}
    </form>
  );
}
