import { ChartLineUpIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";

import { getMarketHub } from "~/.server/market/instance";
import { AppShell } from "~/components/app-shell";
import { PriceChart } from "~/components/chart/price-chart";
import { RsiSignalBadge } from "~/components/rsi-signal-badge";
import { TopBar } from "~/components/top-bar";
import { Button } from "~/components/ui/button";
import { CARD } from "~/components/ui/styles";
import { Watchlist } from "~/components/watchlist/watchlist";
import { DIRECTION_GLYPH } from "~/components/watchlist/watchlist-row";
import { useCurrency } from "~/hooks/use-currency";
import { useMarketStream } from "~/hooks/use-market-stream";
import { useNow } from "~/hooks/use-now";
import { rsiLevels } from "~/hooks/use-rsi-levels";
import { useRsiSignals } from "~/hooks/use-rsi-signals";
import { useThemeVersion } from "~/hooks/use-theme";
import { BASE_CURRENCY } from "~/lib/currency";
import { formatChange, formatPercentChange, formatPrice } from "~/lib/format";
import { type PriceChange, priceChange } from "~/lib/price-change";
import { describeConnection, describeMarket } from "~/lib/status-text";

import type { Route } from "./+types/_index";

const CHANGE_PILL: Record<PriceChange["direction"], string> = {
  up: "bg-rise/10 text-rise",
  down: "bg-fall/10 text-fall",
  flat: "bg-subtle text-muted",
};

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Krestrel" },
    { name: "description", content: "Personal real-time ticker for NYSE and Nasdaq stocks." },
  ];
}

/** Server-rendered starting state; the SSE `snapshot` replaces it once connected. */
export function loader() {
  return getMarketHub().snapshot();
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { state, onLive } = useMarketStream(loaderData);
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const display = useCurrency();
  const themeVersion = useThemeVersion();
  const [levels] = rsiLevels.use();
  const historyStamp = Object.values(state.historyVersion).reduce(
    (sum, version) => sum + version,
    0,
  );
  const signals = useRsiSignals(state.watchlist, state.quotes, levels, historyStamp);

  const requested = params.get("symbol");
  const selected =
    requested && state.watchlist.includes(requested) ? requested : (state.watchlist[0] ?? null);
  const quote = selected ? state.quotes[selected] : undefined;
  const change = quote ? priceChange(quote) : null;
  const market = describeMarket(state.clock);
  const connection = describeConnection(state.link, state.status, now);

  const select = (symbol: string) =>
    setParams(
      (current) => {
        current.set("symbol", symbol);
        return current;
      },
      { replace: true, preventScrollReset: true },
    );

  return (
    <AppShell
      header={
        <TopBar market={market} connection={connection} dataLabel={state.provider.liveDataLabel} />
      }
      banner={
        connection.message ? (
          <p
            role="alert"
            className={`mx-3 mb-3 flex items-center gap-2 rounded-xl px-4 py-2 text-sm ring-1 ring-inset ${
              connection.tone === "error"
                ? "bg-fall/10 text-fall ring-fall/20"
                : "bg-accent/10 text-accent ring-accent/20"
            }`}
          >
            <WarningCircleIcon aria-hidden size={16} className="shrink-0" />
            {connection.message}
          </p>
        ) : undefined
      }
      sidebar={
        <Watchlist
          symbols={state.watchlist}
          quotes={state.quotes}
          selected={selected}
          maxSymbols={state.provider.maxSymbols}
          onSelect={select}
          signals={signals}
          levels={levels}
        />
      }
    >
      <main id="main" className={`${CARD} flex min-h-0 min-w-0 flex-col overflow-hidden`}>
        {selected ? (
          <>
            <div className="px-5 pt-4 pb-3">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="text-lg font-semibold tracking-tight text-text">{selected}</h1>
                <RsiSignalBadge signal={signals[selected] ?? null} levels={levels} />
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                <span className="text-3xl font-semibold tracking-tight tabular-nums text-text">
                  {quote?.lastPrice == null ? "—" : formatPrice(quote.lastPrice)}
                </span>
                {display.currency !== BASE_CURRENCY && quote?.lastPrice != null && (
                  <span
                    className="text-sm tabular-nums text-muted"
                    title={`Converted at today's reference rate (${display.fx.status === "ready" ? `${display.fx.fx.source}, ${display.fx.fx.date}` : ""})`}
                  >
                    ≈ {display.money(quote.lastPrice)}
                  </span>
                )}
                {change && quote?.previousClose != null && (
                  <span className="inline-flex items-baseline gap-2 text-sm">
                    <span
                      className={`rounded-md px-2 py-0.5 font-medium tabular-nums ${CHANGE_PILL[change.direction]}`}
                    >
                      {DIRECTION_GLYPH[change.direction]}{" "}
                      {formatChange(change.absolute, quote.previousClose)} (
                      {formatPercentChange(change.fraction)})
                    </span>
                    <span className="text-muted">vs prev close</span>
                  </span>
                )}
              </div>
              {!market.isOpen && (
                <p className="mt-1.5 text-xs text-muted">
                  {market.label}. Prices show the latest trade
                  {market.detail ? `; ${market.detail}` : ""}.
                </p>
              )}
            </div>
            <PriceChart
              key={`${selected}:${themeVersion}`}
              symbol={selected}
              onLive={onLive}
              historyVersion={state.historyVersion[selected] ?? 0}
            />
          </>
        ) : (
          <div className="m-auto flex max-w-sm flex-col items-center p-8 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-subtle text-accent">
              <ChartLineUpIcon aria-hidden size={22} />
            </span>
            <h1 className="mt-4 text-lg font-semibold tracking-tight text-text">
              Add a symbol to start streaming
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              Search for a ticker such as AAPL in the watchlist. Up to {state.provider.maxSymbols}{" "}
              symbols stream live; history downloads automatically.
            </p>
            <Button
              variant="primary"
              className="mt-5"
              onClick={() =>
                document.querySelector<HTMLInputElement>('aside [role="combobox"]')?.focus()
              }
            >
              <MagnifyingGlassIcon aria-hidden size={16} />
              Search symbols
            </Button>
          </div>
        )}
      </main>
    </AppShell>
  );
}
