import { PlusIcon, ScalesIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import type { DisplayCurrency } from "~/hooks/use-currency";
import { usePortfolioTargets } from "~/hooks/use-portfolio-targets";
import { BASE_CURRENCY } from "~/lib/currency";
import { formatShares } from "~/lib/format";
import type { QuoteSnapshot } from "~/lib/market";
import type { ValuedPosition } from "~/lib/portfolio";
import {
  currentWeights,
  MAX_TARGET_TOTAL,
  planRebalance,
  type RebalanceMode,
  type RebalancePlan,
  TargetsSchema,
  type TargetWeight,
} from "~/lib/rebalance";

import { Button, IconButton } from "../ui/button";
import { Segmented, type SegmentedOption } from "../ui/segmented";
import { FIELD, HEADING, LABEL } from "../ui/styles";

const INPUT = `${FIELD} h-8 w-full tabular-nums`;

const PERCENT = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const LIST = new Intl.ListFormat("en-US");

const MODES: readonly SegmentedOption<RebalanceMode>[] = [
  {
    value: "buy-only",
    label: "Buy only",
    title: "Spend new cash on what's under target; never sell",
  },
  { value: "buy-and-sell", label: "Buy and sell", title: "Also sell what's over target" },
];

/** Drift under this many percentage points reads as on target. */
const ON_TARGET = 0.05;

interface DraftRow {
  id: number;
  symbol: string;
  weight: string;
}

type Props = {
  portfolioId: string | null;
  positions: readonly ValuedPosition[];
  /** Live quotes by symbol: prices targets not held yet. */
  quotes: Readonly<Record<string, QuoteSnapshot | undefined>>;
  display: DisplayCurrency;
};

/**
 * Target allocation and rebalance helper (ADR 0026): the owner sets a target percentage per
 * stock for one portfolio, then sees what to buy (and optionally sell) to get there with new
 * cash. Calculation only; nothing is ever ordered.
 */
export function RebalancePanel({ portfolioId, positions, quotes, display }: Props) {
  if (portfolioId === null) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <ScalesIcon aria-hidden size={16} className="text-accent" />
        Pick a portfolio in the sidebar to set its target mix. Each portfolio keeps its own targets.
      </p>
    );
  }
  return (
    <Rebalancer
      key={portfolioId}
      portfolioId={portfolioId}
      positions={positions}
      quotes={quotes}
      display={display}
    />
  );
}

function Rebalancer({ portfolioId, positions, quotes, display }: Props & { portfolioId: string }) {
  const { targets, loadError, save, saving, saveError } = usePortfolioTargets(portfolioId);
  if (loadError) {
    return (
      <p role="alert" className="flex items-center gap-1.5 text-sm text-fall">
        <WarningCircleIcon aria-hidden size={16} className="shrink-0" />
        {loadError}
      </p>
    );
  }
  if (!targets) return <p className="text-sm text-muted">Loading your targets…</p>;
  return (
    <Editor
      saved={targets}
      positions={positions}
      quotes={quotes}
      display={display}
      save={save}
      saving={saving}
      saveError={saveError}
    />
  );
}

function Editor({
  saved,
  positions,
  quotes,
  display,
  save,
  saving,
  saveError,
}: {
  saved: readonly TargetWeight[];
  positions: readonly ValuedPosition[];
  quotes: Props["quotes"];
  display: DisplayCurrency;
  save: (targets: readonly TargetWeight[]) => void;
  saving: boolean;
  saveError: string | null;
}) {
  const nextId = useRef(0);
  const toRows = (targets: readonly TargetWeight[]): DraftRow[] =>
    targets.map((target) => {
      nextId.current += 1;
      return { id: nextId.current, symbol: target.symbol, weight: String(target.weight) };
    });
  // With nothing saved yet, start from today's mix so the owner only adjusts it.
  const [rows, setRows] = useState<DraftRow[]>(() =>
    toRows(saved.length > 0 ? saved : currentWeights(positions)),
  );
  const [cash, setCash] = useState("");
  const [mode, setMode] = useState<RebalanceMode>("buy-only");

  const filled = rows.filter((row) => row.symbol.trim() !== "" || row.weight.trim() !== "");
  const parsed = TargetsSchema.safeParse(
    filled.map((row) => ({ symbol: row.symbol, weight: row.weight.trim() })),
  );
  let problem: string | null = null;
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = issue?.path[0];
    const row = typeof index === "number" ? filled[index] : undefined;
    const name = row?.symbol.trim().toUpperCase();
    problem = `${name ? `${name}: ` : ""}${issue?.message ?? "Check the targets"}`;
  }
  const total = filled.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  const [draftKey, savedKey] = [parsed.success ? parsed.data : [], saved].map((targets) =>
    targets
      .map((target) => `${target.symbol}:${target.weight}`)
      .sort()
      .join(","),
  );
  const dirty = !parsed.success || draftKey !== savedKey;

  const cashValue = cash.trim() === "" ? 0 : Number(cash);
  const cashValid = Number.isFinite(cashValue) && cashValue >= 0;
  const plan =
    parsed.success && cashValid
      ? planRebalance({
          positions,
          targets: parsed.data,
          cash: cashValue,
          mode,
          priceOf: (symbol) => quotes[symbol]?.lastPrice ?? null,
        })
      : null;

  let status: string;
  if (saving) status = "Saving…";
  else if (saved.length === 0 && dirty)
    status = "Not saved yet. Today's weights are filled in: adjust them and save.";
  else if (dirty) status = "Unsaved changes.";
  else status = saved.length > 0 ? "Saved." : "No targets set.";

  function update(id: number, change: Partial<Omit<DraftRow, "id">>) {
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }

  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <ScalesIcon aria-hidden size={14} className="text-accent" />
        Set the share of this portfolio you want in each stock, then see what to buy (or sell) to
        get there. Krestrel only suggests: it never places orders.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section
          aria-labelledby="targets-heading"
          className="grid content-start gap-3 rounded-xl bg-subtle p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 id="targets-heading" className={HEADING}>
              Target mix
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRows(toRows(currentWeights(positions)))}
            >
              Use current weights
            </Button>
          </div>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="pb-1 text-left font-normal">
                  Stock
                </th>
                <th scope="col" className="pb-1 text-left font-normal">
                  Target %
                </th>
                <th scope="col" className="pb-1">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-1 pr-2">
                    <input
                      value={row.symbol}
                      onChange={(e) => update(row.id, { symbol: e.target.value })}
                      aria-label="Ticker"
                      placeholder="AAPL"
                      autoCapitalize="characters"
                      spellCheck={false}
                      className={`${INPUT} uppercase`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      value={row.weight}
                      onChange={(e) => update(row.id, { weight: e.target.value })}
                      aria-label={`Target percent for ${row.symbol.trim().toUpperCase() || "this stock"}`}
                      inputMode="decimal"
                      placeholder="10"
                      className={INPUT}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <IconButton
                      variant="danger"
                      label={`Remove ${row.symbol.trim().toUpperCase() || "this row"}`}
                      onClick={() =>
                        setRows((previous) => previous.filter((other) => other.id !== row.id))
                      }
                    >
                      <TrashIcon size={14} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                nextId.current += 1;
                setRows((previous) => [
                  ...previous,
                  { id: nextId.current, symbol: "", weight: "" },
                ]);
              }}
            >
              <PlusIcon aria-hidden size={14} />
              Add a stock
            </Button>
            <p
              className={`text-xs tabular-nums ${total > MAX_TARGET_TOTAL ? "text-fall" : "text-muted"}`}
            >
              Total {total.toFixed(2)}%
              {total > MAX_TARGET_TOTAL
                ? " · over 100%"
                : total < 99.995
                  ? ` · ${(100 - total).toFixed(2)}% stays in cash`
                  : ""}
            </p>
          </div>
          <div aria-live="polite" className="grid gap-2">
            {problem && (
              <p className="flex items-start gap-1.5 text-xs text-fall">
                <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
                {problem}
              </p>
            )}
            {saveError && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-fall">
                <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
                {saveError}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted">{status}</p>
              <Button
                size="sm"
                variant="primary"
                disabled={!parsed.success || !dirty || saving}
                onClick={() => parsed.success && save(parsed.data)}
              >
                Save targets
              </Button>
            </div>
          </div>
        </section>

        <section aria-labelledby="suggestions-heading" className="grid content-start gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5">
              <span className={LABEL}>Cash to add (USD)</span>
              <input
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={`${INPUT} w-36`}
              />
            </label>
            <div className="grid gap-1.5">
              <span className={LABEL}>Mode</span>
              <Segmented label="Rebalance mode" options={MODES} value={mode} onChange={setMode} />
            </div>
          </div>
          {!cashValid && (
            <p className="flex items-start gap-1.5 text-xs text-fall">
              <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
              Enter the cash to add as an amount of 0 or more, in USD.
            </p>
          )}
          {cashValid && cashValue > 0 && display.currency !== BASE_CURRENCY && (
            <p className="text-xs tabular-nums text-muted">≈ {display.money(cashValue)}</p>
          )}
          <h3 id="suggestions-heading" className={HEADING}>
            Suggestions
          </h3>
          {plan ? (
            <Suggestions plan={plan} mode={mode} display={display} />
          ) : (
            <p className="text-sm text-muted">Fix the targets to see suggestions.</p>
          )}
          <p className="text-xs text-muted">
            Suggestions only: Krestrel never places orders. Prices move, and fees and taxes aren't
            included. Not financial advice.
          </p>
        </section>
      </div>
    </div>
  );
}

function Suggestions({
  plan,
  mode,
  display,
}: {
  plan: RebalancePlan;
  mode: RebalanceMode;
  display: DisplayCurrency;
}) {
  if (plan.total <= 0) {
    return (
      <p className="text-sm text-muted">
        Nothing to work with yet: no priced holdings and no cash to add. Enter an amount to invest.
      </p>
    );
  }
  const noPrice = plan.rows.filter((row) => row.price === null && row.trade !== 0);
  const stillOver = plan.rows.filter((row) => row.resultPercent - row.targetPercent > 0.5);
  const showCash = plan.cash.targetPercent > ON_TARGET || plan.cash.added > 0 || plan.cash.left > 0;
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-lg bg-panel ring-1 ring-rule/70">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-rule/70 text-xs text-muted">
              <th scope="col" className="px-3 py-2 text-left font-normal">
                Stock
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Now
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Target
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Off target
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Suggestion
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Shares (whole)
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                After
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule/60">
            {plan.rows.map((row) => (
              <tr key={row.symbol}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium text-text">
                  {row.symbol}
                  {!row.targeted && (
                    <span className="ml-1 text-xs font-normal text-muted">no target</span>
                  )}
                </th>
                <td className="px-3 py-1.5 text-right text-text" title={display.money(row.value)}>
                  {PERCENT.format(row.currentPercent / 100)}
                </td>
                <td className="px-3 py-1.5 text-right text-text">
                  {PERCENT.format(row.targetPercent / 100)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {Math.abs(row.drift) < ON_TARGET
                    ? "On target"
                    : `${Math.abs(row.drift).toFixed(1)} pts ${row.drift > 0 ? "over" : "under"}`}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {row.trade > 0 ? (
                    <span className="text-rise">▲ Buy {display.money(row.trade)}</span>
                  ) : row.trade < 0 ? (
                    <span className="text-fall">▼ Sell {display.money(-row.trade)}</span>
                  ) : (
                    <span className="text-muted">Hold</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-text">
                  {row.tradeShares === null || row.wholeShares === null ? (
                    <span className="text-muted" title="No live price">
                      —
                    </span>
                  ) : row.tradeShares === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <>
                      {formatShares(Math.abs(row.tradeShares))}
                      <span className="text-muted">
                        {" "}
                        ({formatShares(Math.abs(row.wholeShares))})
                      </span>
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right text-text">
                  {PERCENT.format(row.resultPercent / 100)}
                </td>
              </tr>
            ))}
            {showCash && (
              <tr>
                <th scope="row" className="px-3 py-1.5 text-left font-medium text-text">
                  Cash
                </th>
                <td className="px-3 py-1.5 text-right text-muted">—</td>
                <td className="px-3 py-1.5 text-right text-text">
                  {PERCENT.format(plan.cash.targetPercent / 100)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted">—</td>
                <td className="px-3 py-1.5 text-right text-muted">
                  {plan.cash.left > 0 ? `Keep ${display.money(plan.cash.left)}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-right text-muted">—</td>
                <td className="px-3 py-1.5 text-right text-text">
                  {PERCENT.format(plan.cash.resultPercent / 100)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs tabular-nums text-muted">
        Buy <span className="text-text">{display.money(plan.bought)}</span> · Sell{" "}
        <span className="text-text">{display.money(plan.sold)}</span> · Cash left{" "}
        <span className="text-text">{display.money(plan.cash.left)}</span>. Percentages are of your
        priced holdings plus the cash you add ({display.money(plan.total)}). Whole shares round buys
        down and sells up.
      </p>
      {mode === "buy-only" && plan.cash.added === 0 && (
        <p className="text-xs text-muted">
          Buy only spends new cash. Enter an amount to invest, or switch to Buy and sell.
        </p>
      )}
      {mode === "buy-only" && plan.cash.added > 0 && stillOver.length > 0 && (
        <p className="text-xs text-muted">
          Buy only never sells, so {LIST.format(stillOver.map((row) => row.symbol))}{" "}
          {stillOver.length === 1 ? "stays" : "stay"} over target.
        </p>
      )}
      {noPrice.length > 0 && (
        <p className="text-xs text-muted">
          No live price for {LIST.format(noPrice.map((row) => row.symbol))}, so shares aren't shown.
          Add {noPrice.length === 1 ? "it" : "them"} to the watchlist to get a price.
        </p>
      )}
      {plan.unpriced.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
          {LIST.format(plan.unpriced)} {plan.unpriced.length === 1 ? "has" : "have"} no live price
          yet, so {plan.unpriced.length === 1 ? "it's" : "they're"} left out of these suggestions,
          target included.
        </p>
      )}
    </div>
  );
}
