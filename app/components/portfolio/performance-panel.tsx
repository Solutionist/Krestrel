import { WarningCircleIcon } from "@phosphor-icons/react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { DisplayCurrency } from "~/hooks/use-currency";
import { useDailyCloses } from "~/hooks/use-performance";
import { useThemeVersion } from "~/hooks/use-theme";
import { formatMoney } from "~/lib/currency";
import { formatPercentChange } from "~/lib/format";
import {
  BENCHMARK_SYMBOL,
  type PerformancePoint,
  type PerformanceRange,
  performanceSeries,
  type RangeSummary,
  summarizeRange,
} from "~/lib/performance";
import type { Trade } from "~/lib/portfolio";

import { readChartTheme } from "../chart/chart-theme";
import { formatDay } from "../dividend-text";
import { Segmented, type SegmentedOption } from "../ui/segmented";
import { HEADING, LABEL, toneOf } from "../ui/styles";

const RANGE_OPTIONS: readonly SegmentedOption<PerformanceRange>[] = [
  { value: "1M", label: "1M", ariaLabel: "Last month" },
  { value: "3M", label: "3M", ariaLabel: "Last 3 months" },
  { value: "YTD", label: "YTD", ariaLabel: "Year to date" },
  { value: "1Y", label: "1Y", ariaLabel: "Last year" },
  { value: "ALL", label: "All", ariaLabel: "Since the first trade" },
];

const BENCHMARK_LABEL = `${BENCHMARK_SYMBOL}, same buys and sells`;

/**
 * Portfolio value over time against SPY (ADR 0024): the trades in view valued at daily closes,
 * next to the same cash flows bought and sold in SPY, with time-weighted returns per range.
 */
export function PerformancePanel({
  portfolioId,
  trades,
  display,
}: {
  portfolioId: string | null;
  trades: readonly Trade[];
  display: DisplayCurrency;
}) {
  const [range, setRange] = useState<PerformanceRange>("1Y");
  return (
    <section aria-labelledby="performance-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 id="performance-heading" className={HEADING}>
            Performance
          </h2>
          <p className="text-xs text-muted">
            Value of the trades in view against the same buys and sells in {BENCHMARK_SYMBOL}.
          </p>
        </div>
        {trades.length > 0 && (
          <Segmented label="Period" options={RANGE_OPTIONS} value={range} onChange={setRange} />
        )}
      </div>
      {trades.length === 0 ? (
        <p className="rounded-xl bg-subtle p-4 text-sm text-muted">
          No trades yet. Record a buy to see how the portfolio does against {BENCHMARK_SYMBOL}.
        </p>
      ) : (
        <PerformanceBody
          key={portfolioId ?? "all"}
          trades={trades}
          range={range}
          display={display}
        />
      )}
    </section>
  );
}

function PerformanceBody({
  trades,
  range,
  display,
}: {
  trades: readonly Trade[];
  range: PerformanceRange;
  display: DisplayCurrency;
}) {
  const symbols = useMemo(
    () => [...new Set(trades.map((trade) => trade.symbol)), BENCHMARK_SYMBOL],
    [trades],
  );
  const from = useMemo(() => trades.map((trade) => trade.tradedOn).sort()[0] ?? "", [trades]);
  const data = useDailyCloses(symbols, from);
  const themeVersion = useThemeVersion();

  // Without SPY's history the benchmark would sit at today's price (a flat 0%): leave it out.
  const benchmarkMissing = data.status === "ready" && data.incomplete.includes(BENCHMARK_SYMBOL);
  const performance = useMemo(() => {
    if (data.status !== "ready") return null;
    if (!benchmarkMissing) return performanceSeries(trades, data.closes, data.today);
    const { [BENCHMARK_SYMBOL]: _benchmark, ...closes } = data.closes;
    return performanceSeries(trades, closes, data.today);
  }, [data, trades, benchmarkMissing]);
  // Memoized so re-renders from live ticks keep `summary.points`, and the chart isn't redrawn.
  const summary = useMemo(
    () =>
      performance && data.status === "ready"
        ? summarizeRange(performance, range, data.today)
        : null,
    [performance, range, data],
  );

  if (data.status === "error") {
    return (
      <p role="alert" className="flex items-center gap-1.5 text-sm text-fall">
        <WarningCircleIcon aria-hidden size={16} className="shrink-0" />
        {data.message}
      </p>
    );
  }
  if (data.status === "loading" || !performance) {
    return (
      <div className="grid gap-3" aria-busy>
        <div className="h-20 animate-pulse rounded-xl bg-subtle" />
        <div className="grid h-72 place-items-center rounded-xl bg-subtle/60 text-xs text-muted">
          Loading price history…
        </div>
      </div>
    );
  }
  if (!summary) {
    return (
      <p className="rounded-xl bg-subtle p-4 text-sm text-muted">
        No trades up to today yet. Performance starts on the first trade date.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <Summary
        summary={summary}
        today={data.today}
        display={display}
        benchmarkMissing={benchmarkMissing}
      />
      <PerformanceChart
        key={`${themeVersion}:${display.currency}`}
        points={summary.points}
        today={data.today}
        display={display}
      />
      <p className="text-xs text-muted">
        Time-weighted return: buys and sells don't count as gains or losses. {BENCHMARK_LABEL}: the
        same amounts bought and sold in {BENCHMARK_SYMBOL} on the same days, at its close. Daily
        closes, split-adjusted; dividends not included.
        {performance.unpriced.length > 0 &&
          ` No price history for ${performance.unpriced.join(", ")}: valued at the last trade price.`}
        {data.incomplete.length > 0 &&
          ` Couldn't download all price history for ${data.incomplete.join(", ")}, so some days use an older price; reload to try again.`}
      </p>
    </div>
  );
}

/** ▲/▼ with screen-reader text, so the direction never relies on colour. */
function Direction({ value }: { value: number }) {
  if (Math.abs(value) < 1e-9) return null;
  return (
    <>
      <span aria-hidden>{value > 0 ? "▲ " : "▼ "}</span>
      <span className="sr-only">{value > 0 ? "up " : "down "}</span>
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  tone = "text-text",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="grid content-start gap-1 bg-subtle px-4 py-3">
      <dt className={LABEL}>{label}</dt>
      <dd className="grid gap-0.5">
        <span className={`text-lg font-semibold tracking-tight tabular-nums ${tone}`}>{value}</span>
        {detail && <span className="text-xs text-muted tabular-nums">{detail}</span>}
      </dd>
    </div>
  );
}

function Summary({
  summary,
  today,
  display,
  benchmarkMissing,
}: {
  summary: RangeSummary;
  today: string;
  display: DisplayCurrency;
  /** SPY's history couldn't be downloaded. */
  benchmarkMissing: boolean;
}) {
  const { portfolio, benchmark } = summary;
  const difference =
    portfolio.twr !== null && benchmark?.twr != null ? portfolio.twr - benchmark.twr : null;
  const firstDay = summary.points[0]?.day ?? summary.endDay;
  const start =
    summary.startDay === null
      ? `from the first trade on ${formatDay(firstDay, today)}`
      : `${display.money(portfolio.start)} on ${formatDay(summary.startDay, today)}`;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-rule/60 ring-1 ring-rule/60 lg:grid-cols-5">
      <Stat label="Value" value={display.money(portfolio.end)} detail={start} />
      <Stat
        label="Gain"
        value={
          <>
            <Direction value={portfolio.gain} />
            {display.money(portfolio.gain, true)}
          </>
        }
        tone={toneOf(portfolio.gain)}
        detail={
          portfolio.netFlow >= 0
            ? `${display.money(portfolio.netFlow)} put in`
            : `${display.money(-portfolio.netFlow)} taken out`
        }
      />
      <Stat
        label="Return"
        value={
          portfolio.twr === null ? (
            "—"
          ) : (
            <>
              <Direction value={portfolio.twr} />
              {formatPercentChange(portfolio.twr)}
            </>
          )
        }
        tone={toneOf(portfolio.twr)}
        detail="time-weighted"
      />
      <Stat
        label={BENCHMARK_SYMBOL}
        value={
          benchmark?.twr == null ? (
            "—"
          ) : (
            <>
              <Direction value={benchmark.twr} />
              {formatPercentChange(benchmark.twr)}
            </>
          )
        }
        tone={toneOf(benchmark?.twr)}
        detail={
          benchmark
            ? `${display.money(benchmark.end)} if in ${BENCHMARK_SYMBOL}`
            : benchmarkMissing
              ? `${BENCHMARK_SYMBOL} data unavailable`
              : "no prices"
        }
      />
      <Stat
        label={`vs ${BENCHMARK_SYMBOL}`}
        value={
          difference === null ? (
            "—"
          ) : (
            <>
              <Direction value={difference} />
              {formatPercentChange(difference).replace("%", " pts")}
            </>
          )
        }
        tone={toneOf(difference)}
        detail={
          difference === null
            ? undefined
            : difference > 0
              ? `ahead of ${BENCHMARK_SYMBOL}`
              : difference < 0
                ? `behind ${BENCHMARK_SYMBOL}`
                : `level with ${BENCHMARK_SYMBOL}`
        }
      />
    </dl>
  );
}

interface ChartHandles {
  chart: IChartApi;
  portfolio: ISeriesApi<"Line">;
  benchmark: ISeriesApi<"Line">;
}

/**
 * Two lines on a static chart (the period picker sets the range): portfolio value (accent,
 * solid) and the SPY equivalent (muted, dashed), in the display currency. Created in an effect
 * and remounted on theme or currency change, like the price chart.
 */
function PerformanceChart({
  points,
  today,
  display,
}: {
  points: readonly PerformancePoint[];
  today: string;
  display: DisplayCurrency;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartHandles | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const { currency } = display;
  const rate = display.convert(1);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const theme = readChartTheme();
    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.muted,
        fontFamily: theme.font,
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: theme.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.labelBackground,
        },
        horzLine: {
          color: theme.crosshair,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.labelBackground,
        },
      },
      handleScroll: false,
      handleScale: false,
      localization: {
        locale: "en-US",
        dateFormat: "MMM dd, yyyy",
        priceFormatter: (value: number) => formatMoney(value, currency),
      },
    });
    const line = { lineWidth: 2, priceLineVisible: false } as const;
    const benchmark = chart.addSeries(LineSeries, {
      ...line,
      color: theme.muted,
      lineStyle: LineStyle.Dashed,
      title: BENCHMARK_SYMBOL,
    });
    const portfolio = chart.addSeries(LineSeries, {
      ...line,
      color: theme.line("--color-accent", 1),
      title: "Portfolio",
    });
    const onCrosshair = (param: MouseEventParams<Time>) => {
      setHovered(
        param.logical === undefined || param.time === undefined ? null : Math.round(param.logical),
      );
    };
    chart.subscribeCrosshairMove(onCrosshair);
    chartRef.current = { chart, portfolio, benchmark };
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chartRef.current = null;
      chart.remove();
    };
  }, [currency]);

  useEffect(() => {
    const handles = chartRef.current;
    if (!handles) return;
    handles.portfolio.setData(
      points.map((point) => ({ time: point.day, value: point.portfolio.value * rate })),
    );
    handles.benchmark.setData(
      points.flatMap((point) =>
        point.benchmark ? [{ time: point.day, value: point.benchmark.value * rate }] : [],
      ),
    );
    handles.chart.timeScale().fitContent();
  }, [points, rate]);

  const first = points[0];
  const last = points.at(-1);
  const shown = (hovered === null ? undefined : points[hovered]) ?? last;
  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
        {shown && <span className="text-text">{formatDay(shown.day, today)}</span>}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
          Portfolio {shown && display.money(shown.portfolio.value)}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t-2 border-dashed border-muted" />
          {BENCHMARK_LABEL} {shown?.benchmark ? display.money(shown.benchmark.value) : "—"}
        </span>
      </figcaption>
      <div
        ref={container}
        role="img"
        aria-label={
          first && last
            ? `Portfolio value and ${BENCHMARK_LABEL}, ${formatDay(first.day, today)} to ${formatDay(last.day, today)}`
            : "Portfolio value"
        }
        className="h-72 w-full overflow-hidden rounded-xl"
      />
    </figure>
  );
}
