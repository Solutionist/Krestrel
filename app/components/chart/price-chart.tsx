import {
  ArrowCounterClockwiseIcon,
  ArrowsHorizontalIcon,
  ArrowUUpLeftIcon,
  ChartLineUpIcon,
  MinusIcon,
  PlusIcon,
  QuestionIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  LineStyle,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as z from "zod";
import { createStoredValue } from "~/hooks/stored-value";
import type { LiveListener } from "~/hooks/use-market-stream";
import { rsiLevels } from "~/hooks/use-rsi-levels";
import { type Analysis, analyzeChart, type Trade } from "~/lib/analysis";
import { ExplainResponseSchema } from "~/lib/analysis-explanation";
import {
  formatExchangeDate,
  formatExchangeDateTime,
  formatExchangeDay,
  formatExchangeMonth,
  formatExchangeShort,
  formatExchangeTime,
  formatExchangeYear,
  mergeBar,
  mergeTick,
} from "~/lib/candles";
import { INTERVAL_RANGE, rangeStart } from "~/lib/chart-ranges";
import { formatChange, formatPercentChange, formatPrice } from "~/lib/format";
import {
  bollinger,
  ema,
  INDICATOR_LABELS,
  INDICATORS,
  type IndicatorId,
  type IndicatorValue,
  rsi,
} from "~/lib/indicators";
import { type Candle, CandleSchema, isCalendarTimeframe, type Timeframe } from "~/lib/market";
import { type RangeStats, rangeStats } from "~/lib/range-stats";
import { rsiSignal, SIGNAL_GLYPH, SIGNAL_LABEL } from "~/lib/rsi-signal";
import { type TradeContext, tradeContexts } from "~/lib/trade-context";
import { IconButton, ToggleChip } from "../ui/button";
import { ChartLegend, createLegendStore, type LegendIndicator } from "./chart-legend";
import { type ChartTheme, readChartTheme } from "./chart-theme";
import { ChartToolbar, OVERLAYS, type Overlay } from "./chart-toolbar";
import { ClaudePanel, type ClaudeState, claudeModel } from "./claude-panel";
import { InsightsPanel } from "./insights-panel";
import { createRsiPane, type RsiPane } from "./rsi-pane";
import { usePersistedSet } from "./use-persisted-set";

const BarsResponseSchema = z.object({ candles: z.array(CandleSchema) });

/** Bar heights (% of the area) for the first-load placeholder: a calm, chart-like silhouette. */
const SKELETON_BARS = [
  38, 44, 41, 52, 48, 57, 54, 63, 58, 66, 61, 55, 60, 68, 72, 65, 70, 78, 74, 69, 76, 82, 79, 86,
];

const timeToMs = (time: Time) =>
  typeof time === "number" ? time * 1000 : Date.parse(String(time));

/** Prices use the app's formatter (2 dp, 4 dp under $1); set per series so RSI can differ. */
const PRICE_FORMAT = { type: "custom", formatter: formatPrice, minMove: 0.0001 } as const;

const RSI_PANE = 1;
/** Empty bars after the live candle, so it isn't pinned against the price axis. */
const RIGHT_OFFSET_BARS = 6;
/** Zoom-in limit for the buttons/keys. */
const MIN_VISIBLE_BARS = 10;
/** "Previous view" steps kept. */
const MAX_VIEW_HISTORY = 20;
/** Load older history when the view gets within this many bars of the first loaded candle. */
const LOAD_OLDER_WITHIN_BARS = 20;
const MAX_ANALYSIS_CANDLES = 6000;

const INDICATOR_STORAGE_KEY = "krestrel.indicators";
const OVERLAY_STORAGE_KEY = "krestrel.overlays";
const CLAUDE_CONSENT_KEY = "krestrel.claudeConsent";

/** Colour token per indicator (app.css). */
const INDICATOR_TOKEN: Record<IndicatorId, string> = {
  ema20: "--color-ind-1",
  ema50: "--color-ind-2",
  ema100: "--color-ind-3",
  bb: "--color-muted",
  rsi: "--color-ind-2",
};

/** Line values per series of an indicator (Bollinger has three). */
function indicatorLines(id: IndicatorId, closes: readonly number[]): IndicatorValue[][] {
  switch (id) {
    case "ema20":
      return [ema(closes, 20)];
    case "ema50":
      return [ema(closes, 50)];
    case "ema100":
      return [ema(closes, 100)];
    case "bb": {
      const { upper, middle, lower } = bollinger(closes, 20, 2);
      return [upper, middle, lower];
    }
    case "rsi":
      return [rsi(closes, 14)];
  }
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; empty: boolean }
  | { kind: "error"; message: string };

interface ChartParts {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  theme: ChartTheme;
}

/**
 * Candlestick + volume chart (TradingView Lightweight Charts, ADR 0010) with indicators, hindsight
 * overlays, and the insights section. The chart is created once; switching symbol/interval reloads
 * data with `setData`; live ticks/bars update the last candle once per animation frame; older
 * history is fetched as the view approaches the first loaded candle.
 */
export function PriceChart({
  symbol,
  onLive,
  historyVersion,
}: {
  symbol: string;
  onLive: (listener: LiveListener) => () => void;
  /** Changes when the server has downloaded new history for `symbol`; triggers a reload. */
  historyVersion: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartParts | null>(null);
  /** Candles currently drawn (history + live), oldest first. */
  const dataRef = useRef<Candle[]>([]);

  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  /** Region being dragged (px from the chart's left edge) and what it spans. */
  const [selection, setSelection] = useState<{
    from: number;
    to: number;
    stats: RangeStats | null;
  } | null>(null);
  // TradingView-style "zoom to region" tool: while on, a plain drag selects instead of panning.
  const [selectMode, setSelectMode] = useState(false);
  const cancelDragRef = useRef<(() => void) | null>(null);
  /** Views to return to with "Previous view" (logical ranges; reset when the data reloads). */
  const viewHistory = useRef<{ from: number; to: number }[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);

  const [indicators, toggleIndicator] = usePersistedSet<IndicatorId>(
    INDICATOR_STORAGE_KEY,
    INDICATORS,
  );
  const [overlays, toggleOverlay, addOverlays] = usePersistedSet<Overlay>(
    OVERLAY_STORAGE_KEY,
    OVERLAYS,
  );
  const [sidePanel, setSidePanel] = sidePanelSetting.use();
  const [model] = claudeModel.use();
  const togglePanel = (panel: Exclude<SidePanel, "none">) =>
    setSidePanel(sidePanel === panel ? "none" : panel);
  const [analysis, setAnalysis] = useState<{ analysis: Analysis; contexts: TradeContext[] } | null>(
    null,
  );
  const [claude, setClaude] = useState<ClaudeState>({ kind: "idle" });

  const legend = useMemo(createLegendStore, []);
  const indicatorSeries = useRef(new Map<IndicatorId, ISeriesApi<"Line">[]>());
  /** Latest computed indicator values per series, for the legend. */
  const indicatorValues = useRef(new Map<IndicatorId, IndicatorValue[][]>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const overlaysRef = useRef(overlays);
  const indicatorsRef = useRef(indicators);
  const rsiPaneRef = useRef<RsiPane | null>(null);
  const [levels] = rsiLevels.use();
  const levelsRef = useRef(levels);

  const indicatorColors = useMemo(() => {
    if (typeof document === "undefined") {
      return Object.fromEntries(INDICATORS.map((id) => [id, "currentColor"])) as Record<
        IndicatorId,
        string
      >;
    }
    const theme = readChartTheme();
    return Object.fromEntries(
      INDICATORS.map((id) => [id, theme.line(INDICATOR_TOKEN[id])]),
    ) as Record<IndicatorId, string>;
  }, []);

  /** Shows the candle at `index` (default: latest) in the legend, with indicator values. */
  const updateLegend = useCallback(
    (index?: number) => {
      const data = dataRef.current;
      const i = index ?? data.length - 1;
      const candle = data[i];
      if (!candle) {
        legend.set(null);
        return;
      }
      const previous = data[i - 1];
      const rows: LegendIndicator[] = [];
      for (const id of INDICATORS) {
        const lines = indicatorValues.current.get(id);
        if (!lines) continue;
        const rsiValues = id === "rsi" ? lines[0] : undefined;
        const signal = rsiValues ? rsiSignal(rsiValues.slice(0, i + 1), levelsRef.current) : null;
        rows.push({
          label: INDICATOR_LABELS[id],
          color: indicatorColors[id],
          values: lines.map((values) => values[i] ?? null),
          integer: id === "rsi",
          note:
            signal && signal.kind !== "neutral"
              ? {
                  text: `${SIGNAL_GLYPH[signal.kind]} ${SIGNAL_LABEL[signal.kind]}`,
                  rising: signal.kind === "buy" || signal.kind === "oversold",
                }
              : undefined,
        });
      }
      legend.set({
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        change: previous ? candle.close / previous.close - 1 : null,
        indicators: rows,
      });
    },
    [legend, indicatorColors],
  );

  // ── Chart creation (once) ────────────────────────────────────────────────────────────────
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
        panes: { separatorColor: theme.grid, separatorHoverColor: theme.crosshair },
      },
      // Horizontal grid only, faint: price levels stay readable without a mesh.
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        // Space after the live candle so it isn't pinned against the price axis.
        rightOffset: RIGHT_OFFSET_BARS,
        // Allow zooming far out (thousands of candles).
        minBarSpacing: 0.05,
        // Like TradingView: never scroll into empty space before the first bar. Reaching it loads
        // the previous chunk of history (see loadOlder), which then extends the left edge.
        fixLeftEdge: true,
        // Lightweight Charts has no time-zone option: format labels in exchange time.
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const ms = timeToMs(time);
          switch (type) {
            case TickMarkType.Year:
              return formatExchangeYear(ms);
            case TickMarkType.Month:
              return formatExchangeMonth(ms);
            case TickMarkType.DayOfMonth:
              return formatExchangeDay(ms);
            default:
              return formatExchangeTime(ms);
          }
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
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
      kineticScroll: { mouse: true, touch: true },
      localization: {
        timeFormatter: (time: Time) =>
          isCalendarTimeframe(timeframeRef.current)
            ? formatExchangeDate(timeToMs(time))
            : `${formatExchangeDateTime(timeToMs(time))} ET`,
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: theme.rise,
      downColor: theme.fall,
      wickUpColor: theme.rise,
      wickDownColor: theme.fall,
      borderVisible: false,
      priceLineColor: theme.crosshair,
      priceLineStyle: LineStyle.Dotted,
      priceFormat: PRICE_FORMAT,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const onCrosshair = (param: MouseEventParams<Time>) => {
      if (param.logical === undefined || param.time === undefined) updateLegend();
      else updateLegend(Math.round(param.logical));
    };
    chart.subscribeCrosshairMove(onCrosshair);
    chartRef.current = { chart, candles, volume, theme };
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chartRef.current = null;
      markersRef.current = null;
      levelLinesRef.current = [];
      trendSeriesRef.current = null;
      indicatorSeries.current.clear();
      rsiPaneRef.current = null;
      chart.remove();
    };
  }, [updateLegend]);

  // Read by the chart's label formatter, which is created once.
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;

  // ── Indicators ───────────────────────────────────────────────────────────────────────────
  /**
   * Recomputes indicators from the drawn candles (a few thousand points: well under a ms).
   * `full` replaces all points (after a load or toggle); otherwise only the last point updates.
   */
  const renderIndicators = useCallback((full: boolean) => {
    const data = dataRef.current;
    if (data.length === 0) return;
    const closes = data.map((candle) => candle.close);
    indicatorValues.current.clear();
    for (const [id, seriesList] of indicatorSeries.current) {
      const lines = indicatorLines(id, closes);
      indicatorValues.current.set(id, lines);
      seriesList.forEach((series, line) => {
        const values = lines[line] ?? [];
        if (full) {
          series.setData(
            data.flatMap((candle, i) => {
              const value = values[i];
              return value == null ? [] : [{ time: candle.time as UTCTimestamp, value }];
            }),
          );
        } else {
          const last = values.at(-1);
          const candle = data.at(-1);
          if (last != null && candle)
            series.update({ time: candle.time as UTCTimestamp, value: last });
        }
      });
    }
    const rsiValues = indicatorValues.current.get("rsi")?.[0];
    if (rsiPaneRef.current && rsiValues) {
      rsiPaneRef.current.render(
        data.map((candle) => candle.time),
        rsiValues,
        levelsRef.current,
        full,
      );
    }
  }, []);

  useEffect(() => {
    indicatorsRef.current = indicators;
    const parts = chartRef.current;
    if (!parts) return;
    const { chart, theme } = parts;
    const created = indicatorSeries.current;
    for (const [id, seriesList] of created) {
      if (indicators.has(id)) continue;
      for (const series of seriesList) chart.removeSeries(series);
      created.delete(id);
      if (id === "rsi") {
        rsiPaneRef.current?.remove();
        rsiPaneRef.current = null;
        if (chart.panes().length > RSI_PANE) chart.removePane(RSI_PANE);
      }
    }
    for (const id of indicators) {
      if (created.has(id)) continue;
      // Values live in the legend, so lines carry no axis labels (keeps the price axis clean).
      const line = {
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: PRICE_FORMAT,
      } as const;
      if (id === "bb") {
        const color = theme.line(INDICATOR_TOKEN.bb, 0.5);
        created.set(id, [
          chart.addSeries(LineSeries, { ...line, color }),
          chart.addSeries(LineSeries, { ...line, color, lineStyle: LineStyle.Dashed }),
          chart.addSeries(LineSeries, { ...line, color }),
        ]);
      } else if (id === "rsi") {
        rsiPaneRef.current = createRsiPane(chart, theme, RSI_PANE);
        // Main pane : RSI pane = 3 : 1.
        chart.panes()[0]?.setStretchFactor(0.75);
        chart.panes()[RSI_PANE]?.setStretchFactor(0.25);
        // Its series live in the RSI pane object; the map just records that RSI is on.
        created.set(id, []);
      } else {
        created.set(id, [
          chart.addSeries(LineSeries, { ...line, color: theme.line(INDICATOR_TOKEN[id]) }),
        ]);
      }
    }
    renderIndicators(true);
    updateLegend();
  }, [indicators, renderIndicators, updateLegend]);

  // Overbought/oversold levels are one setting for every stock (ADR 0014); redraw on change.
  useEffect(() => {
    levelsRef.current = levels;
    renderIndicators(true);
    updateLegend();
  }, [levels, renderIndicators, updateLegend]);

  // ── Hindsight analysis overlays (ADR 0012) ─────────────────────────────────────────────────
  /**
   * Analyses the drawn candles (on load, each new candle, toggles, before asking Claude), feeds
   * the insights panel, and draws markers/levels/trend line when those overlays are on.
   */
  const renderAnalysis = useCallback(() => {
    const parts = chartRef.current;
    if (!parts) return;
    const { chart, candles, theme } = parts;
    for (const line of levelLinesRef.current) candles.removePriceLine(line);
    levelLinesRef.current = [];
    if (trendSeriesRef.current) chart.removeSeries(trendSeriesRef.current);
    trendSeriesRef.current = null;
    markersRef.current ??= createSeriesMarkers(candles, []);

    const data = dataRef.current.slice(-MAX_ANALYSIS_CANDLES);
    if (data.length === 0) {
      markersRef.current.setMarkers([]);
      setAnalysis(null);
      return;
    }
    const result = analyzeChart(data);
    setAnalysis({ analysis: result, contexts: tradeContexts(data, result) });

    const active = overlaysRef.current;
    markersRef.current.setMarkers(
      active.has("trades")
        ? result.trades
            .flatMap((trade): SeriesMarker<Time>[] => [
              {
                time: trade.buy.time as UTCTimestamp,
                position: "belowBar",
                shape: "arrowUp",
                color: theme.rise,
                text: trade.id,
              },
              {
                time: trade.sell.time as UTCTimestamp,
                position: "aboveBar",
                shape: "arrowDown",
                color: theme.fall,
                text: `${trade.id} +${(trade.returnFraction * 100).toFixed(0)}%`,
              },
            ])
            .sort((a, b) => Number(a.time) - Number(b.time))
        : [],
    );
    if (!active.has("levels")) return;
    for (const level of result.levels) {
      levelLinesRef.current.push(
        candles.createPriceLine({
          price: level.price,
          color:
            level.kind === "support"
              ? theme.line("--color-rise", 0.7)
              : theme.line("--color-fall", 0.7),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: level.id,
        }),
      );
    }
    const trend = result.trendSupport;
    if (trend) {
      const series = chart.addSeries(LineSeries, {
        color: trend.broken ? theme.crosshair : theme.rise,
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: PRICE_FORMAT,
      });
      series.setData([
        { time: trend.from.time as UTCTimestamp, value: trend.from.price },
        { time: trend.to.time as UTCTimestamp, value: trend.to.price },
      ]);
      trendSeriesRef.current = series;
    }
  }, []);

  useEffect(() => {
    overlaysRef.current = overlays;
    renderAnalysis();
  }, [overlays, renderAnalysis]);

  // ── View: presets, zoom, focus ───────────────────────────────────────────────────────────
  /** Zooms to the interval's default period (INTERVAL_RANGE), or all candles if shorter. */
  const applyView = useCallback(() => {
    const chart = chartRef.current?.chart;
    const last = dataRef.current.at(-1);
    if (!chart || !last) return;
    const from = rangeStart(INTERVAL_RANGE[timeframeRef.current], dataRef.current);
    if (from === null) chart.timeScale().fitContent();
    else
      chart
        .timeScale()
        .setVisibleRange({ from: from as UTCTimestamp, to: last.time as UTCTimestamp });
  }, []);

  /** Picks the interval; its default period is applied when the data lands (or now, if same). */
  function selectInterval(tf: Timeframe) {
    if (tf === timeframe) applyView();
    else setTimeframe(tf);
  }

  /**
   * Zoom by `factor` (< 1 in, > 1 out), anchored on real data like TradingView: on the latest bar
   * when it is on screen, otherwise on the centre of the view. Never wider than all loaded data
   * (plus the right margin); zooming out past that shows everything and reaching the first bar
   * loads older history.
   */
  function zoom(factor: number) {
    const timeScale = chartRef.current?.chart.timeScale();
    const visible = timeScale?.getVisibleLogicalRange();
    const count = dataRef.current.length;
    if (!timeScale || !visible || count === 0) return;
    const lastIndex = count - 1;
    const maxSpan = count + RIGHT_OFFSET_BARS;
    const span = Math.min(
      maxSpan,
      Math.max(MIN_VISIBLE_BARS, (visible.to - visible.from) * factor),
    );
    if (span >= maxSpan) {
      timeScale.fitContent();
      return;
    }
    const latestOnScreen = visible.to >= lastIndex;
    const to = latestOnScreen
      ? lastIndex + RIGHT_OFFSET_BARS
      : (visible.from + visible.to) / 2 + span / 2;
    timeScale.setVisibleLogicalRange({ from: to - span, to });
  }

  /** Pans by a fraction of the visible width (negative = back in time), never past the latest bar. */
  function pan(fraction: number) {
    const timeScale = chartRef.current?.chart.timeScale();
    const visible = timeScale?.getVisibleLogicalRange();
    const count = dataRef.current.length;
    if (!timeScale || !visible || count === 0) return;
    const width = visible.to - visible.from;
    const maxTo = count - 1 + RIGHT_OFFSET_BARS;
    const to = Math.min(maxTo, visible.to + width * fraction);
    timeScale.setVisibleLogicalRange({ from: to - width, to });
  }

  function onChartKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const actions: Record<string, () => void> = {
      "+": () => zoom(0.7),
      "=": () => zoom(0.7),
      "-": () => zoom(1.4),
      _: () => zoom(1.4),
      "0": applyView,
      Backspace: previousView,
      ArrowLeft: () => pan(-0.15),
      ArrowRight: () => pan(0.15),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  /** Saves the current view so "Previous view" can return to it. */
  function rememberView() {
    const visible = chartRef.current?.chart.timeScale().getVisibleLogicalRange();
    if (!visible) return;
    viewHistory.current = [...viewHistory.current.slice(-(MAX_VIEW_HISTORY - 1)), visible];
    setCanGoBack(true);
  }

  function previousView() {
    const timeScale = chartRef.current?.chart.timeScale();
    const previous = viewHistory.current.pop();
    setCanGoBack(viewHistory.current.length > 0);
    if (!timeScale || !previous) return;
    timeScale.setVisibleLogicalRange(previous);
  }

  /** Zooms the chart to a trade, with some context either side. */
  function focusTrade(trade: Trade) {
    const timeScale = chartRef.current?.chart.timeScale();
    const data = dataRef.current;
    const buy = data.findIndex((candle) => candle.time === trade.buy.time);
    const sell = data.findIndex((candle) => candle.time === trade.sell.time);
    if (!timeScale || buy < 0 || sell < 0) return;
    const padding = Math.max(10, (sell - buy) * 0.4);
    rememberView();
    timeScale.setVisibleLogicalRange({ from: buy - padding, to: sell + padding });
  }

  /**
   * Region zoom: with the select tool on (or Shift held), drag from the start of a period to its
   * end; the band shows what it spans (change, bars, high/low) and releasing zooms into it.
   * Otherwise a plain drag pans as usual.
   */
  function startSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if ((!selectMode && !event.shiftKey) || event.button !== 0) return;
    // Keep the chart from treating this as a pan.
    event.preventDefault();
    event.stopPropagation();
    const timeScale = chartRef.current?.chart.timeScale();
    if (!timeScale) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const clamp = (clientX: number) => Math.min(Math.max(clientX - bounds.left, 0), bounds.width);
    const origin = clamp(event.clientX);
    const span = (x: number) => {
      const from = timeScale.coordinateToLogical(Math.min(origin, x));
      const to = timeScale.coordinateToLogical(Math.max(origin, x));
      return from === null || to === null ? null : { from, to };
    };
    const select = (x: number) => {
      const logical = span(x);
      setSelection({
        from: origin,
        to: x,
        stats: logical ? rangeStats(dataRef.current, logical.from, logical.to) : null,
      });
    };
    select(origin);

    const move = (e: PointerEvent) => select(clamp(e.clientX));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      cancelDragRef.current = null;
      setSelection(null);
    };
    const end = (e: PointerEvent) => {
      stop();
      const x = clamp(e.clientX);
      const logical = span(x);
      // A click without a drag keeps the tool on, like TradingView.
      if (Math.abs(x - origin) < 8 || !logical) return;
      rememberView();
      timeScale.setVisibleLogicalRange(logical);
      setSelectMode(false);
    };
    cancelDragRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  // Escape cancels a drag in progress, then leaves the select tool.
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelDragRef.current?.();
      setSelectMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  // ── Data: history, older history on demand, live updates ──────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyVersion is a reload trigger (server finished downloading history), intentionally not read inside.
  useEffect(() => {
    const parts = chartRef.current;
    if (!parts) return;
    const { chart, candles, volume, theme } = parts;
    // Daily+ candles have no meaningful clock time on the axis.
    chart.applyOptions({ timeScale: { timeVisible: !isCalendarTimeframe(timeframe) } });
    const volumeColor = (candle: Candle) =>
      candle.close >= candle.open ? theme.riseVolume : theme.fallVolume;
    const toBar = (c: Candle) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
    const toVolume = (c: Candle) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: volumeColor(c),
    });

    let latest: Candle | null = null;
    let pending: Candle | null = null;
    let frame = 0;
    let ready = false;
    let loadingOlder = false;
    let olderExhausted = false;
    const queued: Parameters<LiveListener>[0][] = [];
    const abort = new AbortController();

    const drawAll = () => {
      candles.setData(dataRef.current.map(toBar));
      volume.setData(dataRef.current.map(toVolume));
      renderIndicators(true);
      renderAnalysis();
      updateLegend();
    };
    const apply = (candle: Candle) => {
      candles.update(toBar(candle));
      volume.update(toVolume(candle));
      renderIndicators(false);
      updateLegend();
    };
    const flush = () => {
      frame = 0;
      if (pending) apply(pending);
      pending = null;
    };
    const fold = (event: Parameters<LiveListener>[0]) => {
      if (event.data.symbol !== symbol) return;
      const next =
        event.event === "tick"
          ? mergeTick(latest, event.data, timeframe)
          : mergeBar(latest, event.data, timeframe);
      if (!next) return;
      // A new bucket: draw the finished candle now so it is never skipped by frame batching.
      if (pending && next.time > pending.time) apply(pending);
      const drawn = dataRef.current;
      if (drawn.at(-1)?.time === next.time) drawn[drawn.length - 1] = next;
      else {
        drawn.push(next);
        // A new candle can confirm a swing or move the last close across a level.
        renderAnalysis();
      }
      latest = next;
      pending = next;
      frame ||= requestAnimationFrame(flush);
    };
    // Live events that arrive while history is loading are replayed once it lands.
    const unsubscribe = onLive((event) => (ready ? fold(event) : queued.push(event)));

    const fetchCandles = async (query: string) => {
      const response = await fetch(
        `/api/bars/${encodeURIComponent(symbol)}?tf=${timeframe}${query}`,
        {
          signal: abort.signal,
        },
      );
      if (!response.ok)
        throw new Error("Couldn't load chart history. Try another interval or reload.");
      const parsed = BarsResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Chart history came back in an unexpected format.");
      return parsed.data.candles;
    };

    /** TradingView-style: fetch the previous chunk when the view nears the first candle. */
    const loadOlder = async () => {
      const first = dataRef.current[0];
      if (!first || loadingOlder || olderExhausted) return;
      loadingOlder = true;
      try {
        const older = await fetchCandles(
          `&to=${encodeURIComponent(new Date(first.time * 1000).toISOString())}`,
        );
        if (abort.signal.aborted) return;
        if (older.length === 0) {
          olderExhausted = true;
          return;
        }
        const visible = chart.timeScale().getVisibleLogicalRange();
        dataRef.current = [...older, ...dataRef.current];
        // Saved views refer to logical indices, which the prepended bars shift.
        viewHistory.current = viewHistory.current.map((view) => ({
          from: view.from + older.length,
          to: view.to + older.length,
        }));
        drawAll();
        // Keep the user's view where it was (logical indices shifted by the prepended bars).
        if (visible) {
          chart.timeScale().setVisibleLogicalRange({
            from: visible.from + older.length,
            to: visible.to + older.length,
          });
        }
      } catch {
        // Scrolling back is best-effort; the visible chart stays as it was.
      } finally {
        loadingOlder = false;
      }
    };
    const onVisibleRange = (visible: LogicalRange | null) => {
      if (ready && visible && visible.from < LOAD_OLDER_WITHIN_BARS) void loadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRange);

    viewHistory.current = [];
    setCanGoBack(false);
    setLoad({ kind: "loading" });
    fetchCandles("")
      .then((data) => {
        dataRef.current = [...data];
        latest = data.at(-1) ?? null;
        drawAll();
        ready = true;
        for (const event of queued.splice(0)) fold(event);
        applyView();
        setLoad({ kind: "ready", empty: data.length === 0 });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setLoad({
          kind: "error",
          message: error instanceof Error ? error.message : "Chart failed to load.",
        });
      });

    return () => {
      abort.abort();
      unsubscribe();
      cancelAnimationFrame(frame);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRange);
    };
  }, [
    symbol,
    timeframe,
    onLive,
    historyVersion,
    applyView,
    renderIndicators,
    renderAnalysis,
    updateLegend,
  ]);

  // Claude's notes belong to one symbol + interval.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset trigger only.
  useEffect(() => {
    setClaude({ kind: "idle" });
  }, [symbol, timeframe]);

  // ── AI analysis by Claude (ADR 0012) ──────────────────────────────────────────────────────────────────
  async function askClaude() {
    if (localStorage.getItem(CLAUDE_CONSENT_KEY) !== "yes") {
      const ok = window.confirm(
        `AI analysis sends ${symbol}'s ${timeframe} price candles (no keys or account data) to Anthropic through your own Claude Code CLI and Claude subscription. Continue?`,
      );
      if (!ok) return;
      localStorage.setItem(CLAUDE_CONSENT_KEY, "yes");
    }
    // Analyse and draw one snapshot, so Claude's ids and prices match the chart exactly.
    const snapshot = dataRef.current.slice(-MAX_ANALYSIS_CANDLES);
    renderAnalysis();
    addOverlays(["trades", "levels"]);
    setSidePanel("claude");
    setClaude({ kind: "loading" });
    try {
      const response = await fetch(`/api/analysis/${encodeURIComponent(symbol)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeframe, candles: snapshot, model }),
      });
      const parsed = ExplainResponseSchema.safeParse(await response.json());
      if (!parsed.success)
        setClaude({ kind: "error", message: "The analysis came back in an unexpected format." });
      else if (!parsed.data.ok) setClaude({ kind: "error", message: parsed.data.error.message });
      else setClaude({ kind: "done", result: parsed.data });
    } catch {
      setClaude({ kind: "error", message: "Couldn't reach the Krestrel server." });
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────────────────────────
  return (
    // Toolbar spans the card; the chart and the side column (Claude or Insights) share the row beneath.
    <div className="flex min-h-0 flex-1 flex-col">
      <ChartToolbar
        timeframe={timeframe}
        onInterval={selectInterval}
        indicators={indicators}
        indicatorColors={indicatorColors}
        onToggleIndicator={toggleIndicator}
        overlays={overlays}
        onToggleOverlay={toggleOverlay}
        sidePanel={sidePanel}
        onTogglePanel={togglePanel}
        loading={load.kind === "loading"}
      />
      <div className="flex min-h-0 flex-1">
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={`${symbol} price chart`}
        >
          <div
            className="relative min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
            onPointerDownCapture={startSelection}
            onKeyDown={onChartKey}
            // A focusable widget with its own keys: + − zoom, ← → pan, 0 resets.
            role="application"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: role="application" is interactive per WAI-ARIA; the chart needs focus for its keyboard zoom/pan.
            tabIndex={0}
            aria-label="Price chart. Plus and minus zoom, arrow keys pan, 0 resets, Backspace returns to the previous view."
          >
            <div ref={container} className="absolute inset-0" />
            <ChartLegend store={legend} />
            {/* First load only (nothing drawn yet); reloads keep the old candles until data lands. */}
            {load.kind === "loading" && dataRef.current.length === 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-6 top-14 bottom-10 flex animate-pulse items-end gap-1.5"
              >
                {SKELETON_BARS.map((height, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder bars
                    key={index}
                    className="flex-1 rounded-md bg-subtle"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            )}
            {selectMode && (
              <>
                {/* Above the chart canvas so a drag selects rather than pans; crosshair cursor. */}
                <div aria-hidden className="absolute inset-0 z-10 cursor-crosshair" />
                {!selection && (
                  <p className={`${FLOATING_NOTE} z-20 text-muted`}>
                    Drag from the start of a period to its end to zoom in · Esc cancels
                  </p>
                )}
              </>
            )}
            {selection && (
              <>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 z-20 border-x border-accent/60 bg-accent/10"
                  style={{
                    left: Math.min(selection.from, selection.to),
                    width: Math.abs(selection.to - selection.from),
                  }}
                />
                {selection.stats && (
                  <RangeReadout
                    stats={selection.stats}
                    intraday={!isCalendarTimeframe(timeframe)}
                  />
                )}
              </>
            )}
            {load.kind === "error" && (
              <ChartMessage icon={<WarningCircleIcon aria-hidden size={18} />} tone="text-fall">
                {load.message}
              </ChartMessage>
            )}
            {load.kind === "ready" && load.empty && (
              <ChartMessage icon={<ChartLineUpIcon aria-hidden size={18} />} tone="text-muted">
                <span className="block font-medium text-text">No history for {symbol} yet.</span>
                It is downloading; live candles appear as trades arrive.
              </ChartMessage>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-rule/60 px-4 py-2">
            <div className="ml-auto flex items-center gap-0.5">
              <ToggleChip
                pressed={selectMode}
                onClick={() => setSelectMode((on) => !on)}
                title="Zoom to a region: drag across the chart from the start of a period to its end (Shift+drag works any time)"
                className="mr-1.5"
              >
                <ArrowsHorizontalIcon aria-hidden size={14} />
                Select range
              </ToggleChip>
              <IconButton
                label="Previous view (Backspace)"
                onClick={previousView}
                disabled={!canGoBack}
              >
                <ArrowUUpLeftIcon aria-hidden size={15} />
              </IconButton>
              <IconButton label="Zoom out (−)" onClick={() => zoom(1.4)}>
                <MinusIcon aria-hidden size={15} />
              </IconButton>
              <IconButton label="Zoom in (+)" onClick={() => zoom(0.7)}>
                <PlusIcon aria-hidden size={15} />
              </IconButton>
              <IconButton label="Reset view (0)" onClick={applyView}>
                <ArrowCounterClockwiseIcon aria-hidden size={15} />
              </IconButton>
              <IconButton
                label="Scroll or pinch to zoom · drag to pan (older history loads automatically) · Select range (or Shift+drag) to zoom into a period · Previous view returns to the last view · double-click the time axis to reset · with the chart focused: + − zoom, ← → pan, 0 reset, Backspace previous view"
                className="ml-1 cursor-help"
              >
                <QuestionIcon aria-hidden size={15} />
              </IconButton>
            </div>
          </div>
        </section>

        {sidePanel === "insights" && (
          <InsightsPanel
            analysis={analysis?.analysis ?? null}
            contexts={analysis?.contexts ?? []}
            timeframe={timeframe}
            onOpenClaude={() => setSidePanel("claude")}
            onFocusTrade={focusTrade}
            onClose={() => setSidePanel("none")}
          />
        )}
        {sidePanel === "claude" && (
          <ClaudePanel
            analysis={analysis?.analysis ?? null}
            symbol={symbol}
            claude={claude}
            onAsk={() => void askClaude()}
            onFocusTrade={focusTrade}
            onClose={() => setSidePanel("none")}
          />
        )}
      </div>
    </div>
  );
}

const SIDE_PANELS = ["claude", "insights", "none"] as const;
type SidePanel = (typeof SIDE_PANELS)[number];

/** Which column sits beside the chart: one at a time, so the chart keeps its width. */
const sidePanelSetting = createStoredValue<SidePanel>(
  "krestrel.sidePanel",
  "claude",
  (raw) => SIDE_PANELS.find((panel) => panel === raw) ?? null,
  (panel) => panel,
);

/** Floating readout pinned bottom-centre over the chart (select hint, range readout). */
const FLOATING_NOTE =
  "pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-raised px-3 py-1.5 text-xs shadow-pop ring-1 ring-rule";

/** Centred status over the chart area (error, no history): icon tile plus a line of text. */
function ChartMessage({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="flex max-w-md items-center gap-3 text-sm">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle ${tone}`}
        >
          {icon}
        </span>
        <p className={tone}>{children}</p>
      </div>
    </div>
  );
}

/** Date-range readout for the region being selected. */
function RangeReadout({ stats, intraday }: { stats: RangeStats; intraday: boolean }) {
  const tone = stats.change > 0 ? "text-rise" : stats.change < 0 ? "text-fall" : "text-muted";
  return (
    <div aria-live="polite" className={`${FLOATING_NOTE} z-30 tabular-nums`}>
      <span className={tone}>
        {stats.change > 0 ? "▲" : stats.change < 0 ? "▼" : "■"}{" "}
        {formatChange(stats.change, stats.high)}
        {stats.changeFraction !== null && ` (${formatPercentChange(stats.changeFraction)})`}
      </span>
      <span className="text-muted">
        {" · "}
        {stats.bars} {stats.bars === 1 ? "bar" : "bars"} ·{" "}
        {formatExchangeShort(stats.from * 1000, intraday)} →{" "}
        {formatExchangeShort(stats.to * 1000, intraday)} · H{" "}
      </span>
      <span className="text-text">{formatPrice(stats.high)}</span>
      <span className="text-muted"> L </span>
      <span className="text-text">{formatPrice(stats.low)}</span>
    </div>
  );
}
