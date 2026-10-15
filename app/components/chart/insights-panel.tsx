import { ChartLineUpIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";

import type { Analysis, Trade } from "~/lib/analysis";
import { formatExchangeShort } from "~/lib/candles";
import {
  HORIZON_INTERVAL,
  HORIZON_LABELS,
  HORIZONS,
  type Horizon,
  INTERVAL_RANGE,
  PERIOD_NAMES,
} from "~/lib/chart-ranges";
import { formatPrice } from "~/lib/format";
import { isCalendarTimeframe, type Timeframe } from "~/lib/market";
import { describePoint, type TradeContext } from "~/lib/trade-context";
import type { TradePlan, TrendBias } from "~/lib/trade-plan";

import { Button, IconButton, ToggleChip } from "../ui/button";
import { Segmented, type SegmentedOption } from "../ui/segmented";
import { HEADING, LABEL } from "../ui/styles";
import { CANDLE_NAMES } from "./chart-toolbar";
import { PlanLevels } from "./plan-levels";

const HORIZON_OPTIONS: readonly SegmentedOption<Horizon>[] = HORIZONS.map((h) => ({
  value: h,
  label: HORIZON_LABELS[h],
  title: `${HORIZON_LABELS[h]}: ${CANDLE_NAMES[HORIZON_INTERVAL[h]]} candles over ${PERIOD_NAMES[INTERVAL_RANGE[HORIZON_INTERVAL[h]]]}`,
}));

/** Rise/fall tint only with its ▲/▼ glyph. */
const BIAS_CHIPS: Record<TrendBias, { label: string; tint: string }> = {
  uptrend: { label: "▲ Uptrend", tint: "bg-rise/10 text-rise" },
  sideways: { label: "Sideways", tint: "bg-subtle text-text" },
  downtrend: { label: "▼ Downtrend", tint: "bg-fall/10 text-fall" },
};

function when(seconds: number, timeframe: Timeframe): string {
  return formatExchangeShort(seconds * 1000, !isCalendarTimeframe(timeframe));
}

/**
 * Locally computed facts beside the chart (never on top of it): a forward plan from this chart's
 * levels, then past swings in hindsight. Claude's outlook lives in its own panel (`OutlookPanel`).
 */
export function InsightsPanel({
  analysis,
  contexts,
  plan,
  timeframe,
  planShown,
  onTogglePlan,
  onOpenOutlook,
  onInterval,
  onFocusTrade,
  onClose,
}: {
  analysis: Analysis | null;
  contexts: readonly TradeContext[];
  plan: TradePlan | null;
  timeframe: Timeframe;
  /** Whether the plan overlay is drawn on the chart. */
  planShown: boolean;
  onTogglePlan: () => void;
  /** Switches the side column to the AI outlook. */
  onOpenOutlook: () => void;
  /** Picks a trading style's chart interval (insights follow the interval's period). */
  onInterval: (timeframe: Timeframe) => void;
  onFocusTrade: (trade: Trade) => void;
  onClose: () => void;
}) {
  const horizon = HORIZONS.find((h) => HORIZON_INTERVAL[h] === timeframe) ?? null;
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

      <div className="space-y-1.5 px-4 pb-3">
        <Segmented
          label="Trading style"
          options={HORIZON_OPTIONS}
          value={horizon}
          onChange={(h) => onInterval(HORIZON_INTERVAL[h])}
          className="w-full [&>span]:flex-1 [&>span>button]:w-full [&>span>button]:whitespace-nowrap"
        />
        <p className="text-xs text-muted">
          {horizon ? "" : "Custom: "}
          {CANDLE_NAMES[timeframe]} candles over {PERIOD_NAMES[INTERVAL_RANGE[timeframe]]}.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-1 pt-1 pb-4 text-sm">
        {plan && (
          <section aria-labelledby="insights-plan" className="px-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 id="insights-plan" className={HEADING}>
                Plan
              </h3>
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${BIAS_CHIPS[plan.bias].tint}`}
              >
                {BIAS_CHIPS[plan.bias].label}
              </span>
            </div>
            <PlanLevels
              lastPrice={plan.lastPrice}
              buyZone={plan.buyZone}
              stop={plan.stop}
              targets={plan.targets}
              noZone={
                plan.bias === "downtrend"
                  ? "No buy zone while it's falling; wait for a higher low."
                  : "No support below the price in this range."
              }
            />
            {plan.riskReward !== null && (
              <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 border-t border-rule/60 py-1.5">
                <span className="text-xs text-muted">Reward : risk</span>
                <span className="text-text tabular-nums">{plan.riskReward.toFixed(1)} : 1</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted">From this chart's levels. A plan, not advice.</p>
              <ToggleChip pressed={planShown} onClick={onTogglePlan} className="shrink-0">
                <ChartLineUpIcon aria-hidden size={14} />
                Show on chart
              </ToggleChip>
            </div>
          </section>
        )}
        {!analysis || analysis.pivots.length < 2 ? (
          <div className="flex items-start gap-3 px-3 pt-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-muted">
              <ChartLineUpIcon aria-hidden size={16} />
            </span>
            <p className="text-muted">
              <span className="block text-text">
                Not enough history on this interval to find swings.
              </span>
              Try a longer trading style.
            </p>
          </div>
        ) : (
          <>
            <section aria-labelledby="insights-trades">
              <h3 id="insights-trades" className={`${LABEL} mb-1 px-3`}>
                Past swings{" "}
                <span className="font-normal tabular-nums">
                  · moves ≥ {(analysis.swingThreshold * 100).toFixed(1)}%
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
        <Button variant="secondary" size="md" className="w-full" onClick={onOpenOutlook}>
          <SparkleIcon aria-hidden size={16} className="text-accent" />
          Get AI outlook
        </Button>
        <p className="text-xs text-muted">Computed locally from this chart. Not advice.</p>
      </footer>
    </aside>
  );
}
