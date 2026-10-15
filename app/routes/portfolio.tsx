import { PencilSimpleIcon, TrashIcon, WalletIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useCallback, useMemo, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { db } from "~/.server/market/db/instance";
import { listPortfolios, listTrades } from "~/.server/market/db/queries/portfolios";
import { getMarketHub } from "~/.server/market/instance";
import { AppShell } from "~/components/app-shell";
import { AverageCalculator } from "~/components/portfolio/average-calculator";
import { ChangePill, HoldingsTable } from "~/components/portfolio/holdings-table";
import { type PortfolioEntry, PortfolioList } from "~/components/portfolio/portfolio-list";
import { TradeForm } from "~/components/portfolio/trade-form";
import { TradeHistory } from "~/components/portfolio/trade-history";
import { TopBar } from "~/components/top-bar";
import { Button, IconButton } from "~/components/ui/button";
import { CARD, FIELD, HEADING, LABEL, toneOf } from "~/components/ui/styles";
import { type DisplayCurrency, useCurrency } from "~/hooks/use-currency";
import { useMarketStream } from "~/hooks/use-market-stream";
import { useNow } from "~/hooks/use-now";
import { rsiLevels } from "~/hooks/use-rsi-levels";
import { useRsiSignals } from "~/hooks/use-rsi-signals";
import { useTimeZone } from "~/hooks/use-time-zone";
import { BASE_CURRENCY, formatMoney } from "~/lib/currency";
import {
  computePositions,
  mergePositions,
  type PortfolioActionResult,
  type PortfolioTotals,
  type Position,
  portfolioTotals,
  type Trade,
  valuePosition,
} from "~/lib/portfolio";
import { describeConnection, describeMarket } from "~/lib/status-text";

import type { Route } from "./+types/portfolio";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Portfolio · Krestrel" }];
}

export async function loader() {
  const [portfolios, trades] = await Promise.all([listPortfolios(db), listTrades(db)]);
  return { snapshot: getMarketHub().snapshot(), portfolios, trades };
}

export default function PortfolioPage({ loaderData }: Route.ComponentProps) {
  const { portfolios, trades } = loaderData;
  const { state } = useMarketStream(loaderData.snapshot);
  const display = useCurrency();
  const [levels] = rsiLevels.use();
  const historyStamp = Object.values(state.historyVersion).reduce(
    (sum, version) => sum + version,
    0,
  );
  const signals = useRsiSignals(state.watchlist, state.quotes, levels, historyStamp);
  const now = useNow();
  const timeZone = useTimeZone();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Trade | null>(null);

  const requested = params.get("p");
  // With one portfolio, "All" would just repeat it.
  const selectedId =
    requested && portfolios.some((portfolio) => portfolio.id === requested)
      ? requested
      : portfolios.length === 1
        ? (portfolios[0]?.id ?? null)
        : null;
  const selected = portfolios.find((portfolio) => portfolio.id === selectedId) ?? null;

  // Positions per portfolio from the trade ledger (cheap: hundreds of trades at most).
  const positionsById = useMemo(() => {
    const byId = new Map<string, Position[]>();
    for (const portfolio of portfolios) {
      const result = computePositions(trades.filter((trade) => trade.portfolioId === portfolio.id));
      // The server refuses trades that oversell, so a stored ledger always replays.
      byId.set(portfolio.id, result.ok ? result.positions : []);
    }
    return byId;
  }, [portfolios, trades]);

  const valued = (positions: readonly Position[]) =>
    positions.map((position) => valuePosition(position, state.quotes[position.symbol]));

  const entries: PortfolioEntry[] = [
    ...(portfolios.length > 1
      ? [
          {
            id: null,
            name: "All portfolios",
            totals: portfolioTotals(valued(mergePositions([...positionsById.values()]))),
          },
        ]
      : []),
    ...portfolios.map((portfolio) => ({
      id: portfolio.id,
      name: portfolio.name,
      totals: portfolioTotals(valued(positionsById.get(portfolio.id) ?? [])),
    })),
  ];

  const positions = valued(
    selectedId
      ? (positionsById.get(selectedId) ?? [])
      : mergePositions([...positionsById.values()]),
  );
  const totals = portfolioTotals(positions);
  const visibleTrades = selectedId
    ? trades.filter((trade) => trade.portfolioId === selectedId)
    : trades;
  const suggestions = [
    ...new Set([...state.watchlist, ...positions.map((position) => position.symbol)]),
  ].sort();

  const select = useCallback(
    (id: string | null) => {
      setEditing(null);
      setParams(
        (current) => {
          if (id) current.set("p", id);
          else current.delete("p");
          return current;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );
  const stopEditing = useCallback(() => setEditing(null), []);

  const market = describeMarket(state.clock, timeZone, now);
  const connection = describeConnection(state.link, state.status, now);

  return (
    <AppShell
      header={
        <TopBar market={market} connection={connection} dataLabel={state.provider.liveDataLabel} />
      }
      sidebar={
        <PortfolioList
          entries={entries}
          selected={selectedId}
          display={display}
          onSelect={select}
        />
      }
    >
      <main id="main" className={`${CARD} min-h-0 overflow-y-auto`}>
        {portfolios.length === 0 ? (
          <div className="grid min-h-full place-items-center p-8">
            <EmptyState
              title={<h1>Track what you own</h1>}
              hint="Name a portfolio under New portfolio on the left, then record your buys and sells."
            />
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1180px] gap-8 px-6 py-6">
            <div className="grid gap-5">
              <PortfolioHeader portfolio={selected} />
              <Summary totals={totals} display={display} />
            </div>

            <section aria-labelledby="holdings-heading" className="grid gap-3">
              <h2 id="holdings-heading" className={HEADING}>
                Holdings
              </h2>
              {positions.length === 0 ? (
                <EmptyState
                  title={<h3>Nothing held yet</h3>}
                  hint="Record a buy below and it shows up here, priced live."
                  inline
                />
              ) : (
                <HoldingsTable
                  positions={positions}
                  display={display}
                  signals={signals}
                  levels={levels}
                />
              )}
            </section>

            <AverageCalculator positions={positions} quotes={state.quotes} display={display} />

            <section aria-labelledby="trades-heading" className="grid gap-3">
              <h2 id="trades-heading" className={HEADING}>
                Trades <span className="font-normal text-muted">· USD, as recorded</span>
              </h2>
              <TradeForm
                key={editing?.id ?? `new-${selectedId ?? "all"}`}
                portfolios={portfolios}
                portfolioId={selectedId}
                editing={editing}
                suggestions={suggestions}
                quotes={state.quotes}
                onDone={stopEditing}
              />
              <TradeHistory
                trades={visibleTrades}
                portfolioNames={
                  selectedId
                    ? null
                    : Object.fromEntries(
                        portfolios.map((portfolio) => [portfolio.id, portfolio.name]),
                      )
                }
                editingId={editing?.id ?? null}
                onEdit={setEditing}
              />
            </section>

            <FxNote display={display} />
          </div>
        )}
      </main>
    </AppShell>
  );
}

/** Icon tile, title and a one-line hint; `inline` sits left-aligned inside a section. */
function EmptyState({
  title,
  hint,
  inline = false,
}: {
  title: ReactNode;
  hint: string;
  inline?: boolean;
}) {
  return (
    <div
      className={
        inline
          ? "flex items-center gap-3 rounded-xl bg-subtle/60 p-4"
          : "grid max-w-sm justify-items-center gap-3 text-center"
      }
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-subtle text-accent ring-1 ring-inset ring-rule/60">
        <WalletIcon aria-hidden size={20} />
      </span>
      <div className="grid gap-0.5">
        <div
          className={
            inline
              ? "text-sm font-medium text-text"
              : "text-lg font-semibold tracking-tight text-text"
          }
        >
          {title}
        </div>
        <p className="text-sm text-muted">{hint}</p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone = "text-text",
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="grid content-start gap-1 bg-subtle px-4 py-3">
      <dt className={LABEL}>{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span className={`text-lg font-semibold tracking-tight tabular-nums ${tone}`}>{value}</span>
        {detail}
      </dd>
    </div>
  );
}

function Summary({ totals, display }: { totals: PortfolioTotals; display: DisplayCurrency }) {
  const total = totals.unrealized + totals.realized;
  return (
    <div className="grid gap-4">
      <dl className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="grid gap-1">
          <dt className={LABEL}>Value</dt>
          <dd className="text-3xl font-semibold tracking-tight text-text tabular-nums">
            {display.money(totals.marketValue)}
          </dd>
        </div>
        <div className="mb-1 flex items-center gap-2 rounded-lg bg-subtle py-1 pr-1 pl-2.5">
          <dt className={LABEL}>Today</dt>
          <dd className="flex items-center gap-2">
            <span className={`text-sm font-medium tabular-nums ${toneOf(totals.dayChange)}`}>
              {display.money(totals.dayChange, true)}
            </span>
            {totals.dayChangeFraction !== null && (
              <ChangePill value={totals.dayChange} fraction={totals.dayChangeFraction} />
            )}
          </dd>
        </div>
      </dl>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-rule/60 ring-1 ring-rule/60 lg:grid-cols-4">
        <Stat
          label="Unrealized P/L"
          value={display.money(totals.unrealized, true)}
          detail={
            totals.unrealizedFraction !== null && (
              <ChangePill value={totals.unrealized} fraction={totals.unrealizedFraction} />
            )
          }
          tone={toneOf(totals.unrealized)}
        />
        <Stat
          label="Realized P/L"
          value={display.money(totals.realized, true)}
          tone={toneOf(totals.realized)}
        />
        <Stat label="Total P/L" value={display.money(total, true)} tone={toneOf(total)} />
        <Stat label="Cost of holdings" value={display.money(totals.costBasis)} />
      </dl>
      <p className="text-xs text-muted">
        Average-cost method, fees included
        {totals.unpriced.length > 0 &&
          ` · not in totals yet (no live price): ${totals.unpriced.join(", ")}`}
      </p>
    </div>
  );
}
function FxNote({ display }: { display: DisplayCurrency }) {
  const { fx, selected, currency } = display;
  if (fx.status === "error") {
    return <p className="text-xs text-fall">{fx.message}</p>;
  }
  if (fx.status !== "ready" || currency === BASE_CURRENCY) {
    return selected !== BASE_CURRENCY && fx.status === "ready" ? (
      <p className="text-xs text-muted">No {selected} rate today; amounts are in USD.</p>
    ) : null;
  }
  return (
    <p className="text-xs text-muted">
      Converted at today's rate: 1 USD = {formatMoney(display.convert(1), currency)} ({fx.fx.source}
      , {fx.fx.date}). Profit and loss is worked out in USD, then converted.
    </p>
  );
}

/** Portfolio name with rename and delete. "All portfolios" has neither. */
function PortfolioHeader({ portfolio }: { portfolio: { id: string; name: string } | null }) {
  const mutate = useFetcher<PortfolioActionResult>();
  const [renaming, setRenaming] = useState(false);
  const error = mutate.data && !mutate.data.ok ? mutate.data.error.message : null;

  if (!portfolio) {
    return <h1 className="text-lg font-semibold tracking-tight text-text">All portfolios</h1>;
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!portfolio) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    mutate.submit(
      { intent: "rename", id: portfolio.id, name },
      { method: "post", action: "/api/portfolios", encType: "application/json" },
    );
    setRenaming(false);
  }

  function remove() {
    if (!portfolio) return;
    if (!window.confirm(`Delete “${portfolio.name}” and all its trades? This can't be undone.`)) {
      return;
    }
    mutate.submit(
      { intent: "delete", id: portfolio.id },
      { method: "post", action: "/api/portfolios", encType: "application/json" },
    );
  }

  return (
    <div className="grid gap-1.5">
      {renaming ? (
        <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
          <input
            name="name"
            defaultValue={portfolio.name}
            maxLength={40}
            required
            aria-label="Portfolio name"
            // biome-ignore lint/a11y/noAutofocus: the owner just asked to rename; focus the field.
            autoFocus
            className={`${FIELD} h-9 w-64 font-medium`}
          />
          <Button type="submit" variant="primary">
            Save
          </Button>
          <Button variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-text">{portfolio.name}</h1>
          <div className="flex items-center gap-0.5">
            <IconButton label="Rename portfolio" onClick={() => setRenaming(true)}>
              <PencilSimpleIcon aria-hidden size={15} />
            </IconButton>
            <IconButton label="Delete portfolio" variant="danger" onClick={remove}>
              <TrashIcon aria-hidden size={15} />
            </IconButton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
