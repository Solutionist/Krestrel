import {
  CalculatorIcon,
  ChartLineUpIcon,
  ChartPieSliceIcon,
  CircleNotchIcon,
  CoinsIcon,
  ImageSquareIcon,
  ListBulletsIcon,
  PencilSimpleIcon,
  ReceiptIcon,
  ScalesIcon,
  TrashIcon,
  WalletIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type ShouldRevalidateFunctionArgs, useFetcher, useSearchParams } from "react-router";

import { db } from "~/.server/market/db/instance";
import { listPortfolios, listTrades } from "~/.server/market/db/queries/portfolios";
import { listStockProfiles } from "~/.server/market/db/queries/stock-profiles";
import { getMarketHub } from "~/.server/market/instance";
import { AppShell } from "~/components/app-shell";
import { AverageCalculator } from "~/components/portfolio/average-calculator";
import { DIVIDEND_HORIZON_DAYS, DividendIncome } from "~/components/portfolio/dividend-income";
import { DividendsPanel } from "~/components/portfolio/dividends-panel";
import {
  ChangePill,
  GroupingControl,
  HoldingsTable,
  holdingsGrouping,
} from "~/components/portfolio/holdings-table";
import { ImportHoldings } from "~/components/portfolio/import-holdings";
import { PerformancePanel } from "~/components/portfolio/performance-panel";
import { type PortfolioEntry, PortfolioList } from "~/components/portfolio/portfolio-list";
import { RebalancePanel } from "~/components/portfolio/rebalance-panel";
import { TaxReportPanel } from "~/components/portfolio/tax-report-panel";
import { TradeForm } from "~/components/portfolio/trade-form";
import { TradeHistory } from "~/components/portfolio/trade-history";
import { TopBar } from "~/components/top-bar";
import { Button, IconButton } from "~/components/ui/button";
import { Direction } from "~/components/ui/direction";
import { CARD, FIELD, LABEL, toneOf } from "~/components/ui/styles";
import { TabBar } from "~/components/ui/tab-bar";
import { type DisplayCurrency, useCurrency } from "~/hooks/use-currency";
import { useDividends } from "~/hooks/use-dividends";
import { useDividendsReceived } from "~/hooks/use-dividends-received";
import { useMarketStream } from "~/hooks/use-market-stream";
import { useNow } from "~/hooks/use-now";
import { rsiLevels } from "~/hooks/use-rsi-levels";
import { useRsiSignals } from "~/hooks/use-rsi-signals";
import { useStockProfiles } from "~/hooks/use-stock-profiles";
import { useTimeZone } from "~/hooks/use-time-zone";
import { BASE_CURRENCY, formatMoney } from "~/lib/currency";
import { dividendTally } from "~/lib/dividends";
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
import { onlyViewChanged } from "~/lib/portfolio-view";
import { describeConnection, describeMarket } from "~/lib/status-text";

import type { Route } from "./+types/portfolio";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Portfolio · Krestrel" }];
}

/**
 * Switching tabs only changes `?view=`, which nothing the loader returns depends on: keep the
 * loaded data instead of a server round trip. Saves, imports, `?p=` changes and a navigation to
 * the same URL still reload.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod) return defaultShouldRevalidate;
  return onlyViewChanged(currentUrl, nextUrl) ? false : defaultShouldRevalidate;
}

const VIEWS = [
  "holdings",
  "trades",
  "performance",
  "dividends",
  "rebalance",
  "calculator",
  "tax",
] as const;
type View = (typeof VIEWS)[number];

export async function loader() {
  const [portfolios, trades] = await Promise.all([listPortfolios(db), listTrades(db)]);
  // Sector and type of everything ever traded, for grouping holdings (ADR 0019).
  const profiles = await listStockProfiles(db, [...new Set(trades.map((trade) => trade.symbol))]);
  return { snapshot: getMarketHub().snapshot(), portfolios, trades, profiles };
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
  // Open import panel; a fresh object per paste so the same image can be read again.
  const [importing, setImporting] = useState<{ image: Blob | null } | null>(null);
  // The tab lives in the URL (?view=), so reloads and portfolio switches keep it.
  const view: View = VIEWS.find((candidate) => candidate === params.get("view")) ?? "holdings";
  const setView = useCallback(
    (next: View) =>
      setParams(
        (current) => {
          if (next === "holdings") current.delete("view");
          else current.set("view", next);
          return current;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  );

  // A screenshot pasted anywhere on the page goes straight to the import panel.
  const hasPortfolios = portfolios.length > 0;
  useEffect(() => {
    if (!hasPortfolios) return;
    function onPaste(event: ClipboardEvent) {
      const item = [...(event.clipboardData?.items ?? [])].find(
        (entry) => entry.kind === "file" && entry.type.startsWith("image/"),
      );
      const image = item?.getAsFile();
      if (!image) return;
      event.preventDefault();
      setImporting({ image });
      setView("holdings");
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [hasPortfolios, setView]);

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
  const visibleTrades = useMemo(
    () => (selectedId ? trades.filter((trade) => trade.portfolioId === selectedId) : trades),
    [selectedId, trades],
  );
  const suggestions = [
    ...new Set([...state.watchlist, ...positions.map((position) => position.symbol)]),
  ].sort();
  const [grouping, setGrouping] = holdingsGrouping.use();
  const heldSymbols = positions
    .filter((position) => position.shares > 0)
    .map((position) => position.symbol);
  const stockProfiles = useStockProfiles(loaderData.profiles, heldSymbols, grouping);
  // Closed positions too: a payout whose ex-date has passed is paid even after selling.
  const dividends = useDividends(positions.map((position) => position.symbol));
  const tally = dividends
    ? dividendTally({
        positions,
        trades: visibleTrades,
        dividends: dividends.bySymbol,
        today: dividends.today,
        horizonDays: DIVIDEND_HORIZON_DAYS,
      })
    : null;
  // Only the Dividends and Tax report tabs read it: don't ask the provider on the others.
  const received = useDividendsReceived({
    portfolioIds: selectedId ? [selectedId] : portfolios.map((portfolio) => portfolio.id),
    trades: visibleTrades,
    enabled: view === "dividends" || view === "tax",
  });

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
          <div className="mx-auto grid max-w-[1180px] gap-6 px-6 py-6">
            <div className="grid gap-5">
              <PortfolioHeader key={selected?.id ?? "all"} portfolio={selected} />
              <Summary totals={totals} display={display} />
              {dividends && tally && (
                <DividendIncome
                  tally={tally}
                  today={dividends.today}
                  totals={totals}
                  display={display}
                />
              )}
            </div>

            <div className="grid gap-4">
              <TabBar
                id="portfolio"
                label="Portfolio sections"
                value={view}
                onChange={setView}
                options={[
                  {
                    value: "holdings",
                    label: "Holdings",
                    Icon: ChartPieSliceIcon,
                    count: positions.filter((position) => position.shares > 0).length,
                  },
                  {
                    value: "trades",
                    label: "Trades",
                    Icon: ListBulletsIcon,
                    count: visibleTrades.length,
                  },
                  { value: "performance", label: "Performance", Icon: ChartLineUpIcon },
                  { value: "dividends", label: "Dividends", Icon: CoinsIcon },
                  { value: "rebalance", label: "Rebalance", Icon: ScalesIcon },
                  { value: "calculator", label: "Average down", Icon: CalculatorIcon },
                  { value: "tax", label: "Tax report", Icon: ReceiptIcon },
                ]}
              />

              <div
                role="tabpanel"
                id="portfolio-panel"
                aria-labelledby={`portfolio-tab-${view}`}
                className="grid gap-3"
              >
                {/* Mounted outside the tab switch (only hidden), so moving between tabs keeps the
                    rows under review and never sends the screenshot to the AI again. */}
                {importing && (
                  <div hidden={view !== "holdings"}>
                    <ImportHoldings
                      portfolios={portfolios}
                      portfolioId={selectedId}
                      image={importing.image}
                      visible={view === "holdings"}
                      onClose={() => setImporting(null)}
                    />
                  </div>
                )}
                {view === "holdings" && (
                  <>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {positions.some((position) => position.shares > 0) && (
                        <GroupingControl value={grouping} onChange={setGrouping} />
                      )}
                      {!importing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setImporting({ image: null })}
                        >
                          <ImageSquareIcon aria-hidden size={14} />
                          Import screenshot
                        </Button>
                      )}
                    </div>
                    {grouping !== "none" && stockProfiles.classifying > 0 && (
                      <p role="status" className="flex items-center gap-2 text-xs text-muted">
                        <CircleNotchIcon
                          aria-hidden
                          size={14}
                          className="animate-spin text-accent"
                        />
                        Classifying {stockProfiles.classifying}{" "}
                        {stockProfiles.classifying === 1 ? "holding" : "holdings"} with AI…
                      </p>
                    )}
                    {grouping !== "none" && stockProfiles.error && (
                      <p
                        role="alert"
                        className="flex flex-wrap items-center gap-1.5 text-xs text-fall"
                      >
                        <WarningCircleIcon aria-hidden size={14} className="shrink-0" />
                        {stockProfiles.error}
                        <Button variant="ghost" size="sm" onClick={stockProfiles.retry}>
                          Try again
                        </Button>
                      </p>
                    )}
                    {positions.length === 0 ? (
                      !importing && (
                        <EmptyState
                          title={<h2>Nothing held yet</h2>}
                          hint="Record a buy on the Trades tab, or paste a screenshot of your broker's holdings (Ctrl+V)."
                          inline
                        />
                      )
                    ) : (
                      <HoldingsTable
                        positions={positions}
                        display={display}
                        signals={signals}
                        levels={levels}
                        grouping={grouping}
                        profiles={stockProfiles.profiles}
                        onReclassify={stockProfiles.reclassify}
                        dividends={
                          dividends && tally
                            ? { ...dividends, next: tally.nextBySymbol }
                            : undefined
                        }
                      />
                    )}
                  </>
                )}

                {view === "trades" && (
                  <>
                    <p className="text-xs text-muted">
                      Every buy and sell, in USD as recorded. Holdings and P/L are worked out from
                      these.
                    </p>
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
                  </>
                )}

                {view === "calculator" && (
                  <AverageCalculator
                    positions={positions}
                    quotes={state.quotes}
                    display={display}
                  />
                )}

                {view === "performance" && (
                  <PerformancePanel
                    portfolioId={selectedId}
                    trades={visibleTrades}
                    display={display}
                  />
                )}
                {view === "dividends" && (
                  <DividendsPanel
                    portfolioId={selectedId}
                    portfolios={portfolios}
                    positions={positions}
                    trades={visibleTrades}
                    dividends={dividends}
                    received={received}
                    display={display}
                  />
                )}

                {view === "rebalance" && (
                  <RebalancePanel
                    portfolioId={selectedId}
                    positions={positions}
                    display={display}
                    quotes={state.quotes}
                  />
                )}

                {view === "tax" && (
                  <TaxReportPanel
                    trades={visibleTrades}
                    received={received.received}
                    receivedError={received.error}
                    display={display}
                  />
                )}
              </div>
            </div>

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
  direction,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: string;
  /** Signed amount whose ▲/▼ goes before `value`, so the sign never relies on colour. */
  direction?: number;
}) {
  return (
    <div className="grid content-start gap-1 bg-subtle px-4 py-3">
      <dt className={LABEL}>{label}</dt>
      <dd className="flex flex-wrap items-center gap-2">
        <span className={`text-lg font-semibold tracking-tight tabular-nums ${tone}`}>
          {direction !== undefined && <Direction value={direction} />}
          {value}
        </span>
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
              {totals.dayChangeFraction === null && <Direction value={totals.dayChange} />}
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
          direction={totals.unrealizedFraction === null ? totals.unrealized : undefined}
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
          direction={totals.realized}
          tone={toneOf(totals.realized)}
        />
        <Stat
          label="Total P/L"
          value={display.money(total, true)}
          direction={total}
          tone={toneOf(total)}
        />
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
