import { ChartLineUpIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";

import type { Analysis, Trade } from "~/lib/analysis";
import { formatExchangeShort } from "~/lib/candles";
import { formatPrice } from "~/lib/format";
import { isCalendarTimeframe, type Timeframe } from "~/lib/market";
import { describePoint, type TradeContext } from "~/lib/trade-context";

import { Button, IconButton } from "../ui/button";
import { HEADING, LABEL } from "../ui/styles";

function when(seconds: number, timeframe: Timeframe): string {
  return formatExchangeShort(seconds * 1000, !isCalendarTimeframe(timeframe));
}

/**
 * Locally computed hindsight facts beside the chart (never on top of it). Claude's take lives in
 * its own panel (`ClaudePanel`, ADR 0012).
 */
export function InsightsPanel({
  analysis,
  contexts,
  timeframe,
  onOpenClaude,
  onFocusTrade,
  onClose,
}: {
  analysis: Analysis | null;
  contexts: readonly TradeContext[];
  timeframe: Timeframe;
  /** Switches the side column to Claude's panel. */
  onOpenClaude: () => void;
  onFocusTrade: (trade: Trade) => void;
  onClose: () => void;
}) {
  const contextFor = (id: string) => contexts.find((c) => c.tradeId === id);

  return (
    <aside
      id="chart-insights"
      aria-label="Chart insights"
      className="flex min-h-0 w-80 shrink-0 flex-col border-l border-rule/70"
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className={`${HEADING} flex items-center gap-1.5`}>
          <ChartLineUpIcon aria-hidden size={16} className="text-accent" />
          Insights
        </h2>
        <IconButton label="Close insights" onClick={onClose} className="-mr-1.5">
          <XIcon aria-hidden size={14} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pt-1 pb-4 text-sm">
        {!analysis || analysis.pivots.length < 2 ? (
          <div className="flex items-start gap-3 px-3 pt-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted">
              <ChartLineUpIcon aria-hidden size={16} />
            </span>
            <p className="text-muted">
              <span className="block text-text">
                Not enough history on this interval to find swings.
              </span>
              Pick a longer range.
            </p>
          </div>
        ) : (
          <>
            <section aria-labelledby="insights-trades">
              <h3 id="insights-trades" className={`${LABEL} mb-1 px-3`}>
                Best past round trips{" "}
                <span className="font-normal tabular-nums">
                  · swing {(analysis.swingThreshold * 100).toFixed(1)}%
                </span>
              </h3>
              {analysis.trades.length === 0 ? (
                <p className="px-3 text-muted">No profitable swing in this range.</p>
              ) : (
                <ol className="space-y-0.5">
                  {analysis.trades.map((trade) => {
                    const context = contextFor(trade.id);
                    return (
                      <li key={trade.id}>
                        <button
                          type="button"
                          onClick={() => onFocusTrade(trade)}
                          title="Zoom the chart to this trade"
                          className="group w-full rounded-lg p-3 text-left transition-colors duration-150 hover:bg-subtle active:translate-y-px"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs">
                              <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent tabular-nums">
                                {trade.id}
                              </span>
                            </span>
                            <span className="rounded-md bg-rise/10 px-1.5 py-0.5 text-xs font-medium text-rise tabular-nums">
                              ▲ +{(trade.returnFraction * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-2 grid gap-0.5 text-xs tabular-nums">
                            <span>
                              <span className="text-rise">▲</span>{" "}
                              <span className="text-muted">{when(trade.buy.time, timeframe)}</span>{" "}
                              <span className="text-text">{formatPrice(trade.buy.price)}</span>
                            </span>
                            <span>
                              <span className="text-fall">▼</span>{" "}
                              <span className="text-muted">{when(trade.sell.time, timeframe)}</span>{" "}
                              <span className="text-text">{formatPrice(trade.sell.price)}</span>
                              {context && (
                                <span className="text-muted"> · {context.bars} bars</span>
                              )}
                            </span>
                          </div>
                          {context && (
                            <p className="mt-1 text-xs text-muted">
                              in: {describePoint(context.buy) || "—"}
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {analysis.levels.length > 0 && (
              <section aria-labelledby="insights-levels" className="px-3">
                <h3 id="insights-levels" className={`${LABEL} mb-1.5`}>
                  Support / resistance
                </h3>
                <ul className="space-y-1.5">
                  {analysis.levels.map((level) => {
                    return (
                      <li key={level.id} className="text-xs">
                        <div className="flex items-center gap-2 tabular-nums">
                          <span
                            aria-hidden
                            className={`size-1.5 shrink-0 rounded-full ${level.kind === "support" ? "bg-rise" : "bg-fall"}`}
                          />
                          <span className="font-medium text-text">{level.id}</span>
                          <span className="text-text">{formatPrice(level.price)}</span>
                          <span className="ml-auto text-muted">{level.touches} touches</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {analysis.trendSupport && (
              <section aria-labelledby="insights-trend" className="px-3 text-xs">
                <h3 id="insights-trend" className="sr-only">
                  Trend support
                </h3>
                <div className="flex items-center gap-2 tabular-nums">
                  <span
                    aria-hidden
                    className={`size-1.5 shrink-0 rounded-full ${analysis.trendSupport.broken ? "bg-muted" : "bg-rise"}`}
                  />
                  <span className={analysis.trendSupport.broken ? "text-muted" : "text-text"}>
                    Trend support {analysis.trendSupport.broken ? "broken" : "intact"}
                  </span>
                  <span className="ml-auto text-muted">
                    {formatPrice(analysis.trendSupport.from.price)} →{" "}
                    {formatPrice(analysis.trendSupport.to.price)}
                  </span>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="space-y-2 border-t border-rule/60 p-4">
        <Button variant="secondary" size="md" className="w-full" onClick={onOpenClaude}>
          <SparkleIcon aria-hidden size={16} className="text-accent" />
          Explain with AI
        </Button>
        <p className="text-xs text-muted">Points computed locally. Hindsight, not advice.</p>
      </footer>
    </aside>
  );
}
