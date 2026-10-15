import {
  ChartLineUpIcon,
  CheckIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { rsiLevels } from "~/hooks/use-rsi-levels";
import { INDICATOR_LABELS, INDICATOR_NAMES, INDICATORS, type IndicatorId } from "~/lib/indicators";
import { TIMEFRAMES, type Timeframe } from "~/lib/market";
import { DEFAULT_RSI_LEVELS, type RsiLevels, RsiLevelsSchema } from "~/lib/rsi-signal";

import { Button, ToggleChip } from "../ui/button";
import { Segmented, type SegmentedOption } from "../ui/segmented";
import { FIELD, POPOVER } from "../ui/styles";

/** Full names for the interval buttons (screen readers, tooltips). */
export const TIMEFRAME_NAMES: Record<Timeframe, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1D": "1 day",
  "1W": "1 week",
  "2W": "2 weeks",
  "1M": "1 month",
  "1Y": "1 year",
};

/** Adjective form for sentences: "5-minute candles", "1-week candles". */
export const CANDLE_NAMES = Object.fromEntries(
  TIMEFRAMES.map((tf) => [tf, TIMEFRAME_NAMES[tf].replace(/^(\d+) (\w+?)s?$/, "$1-$2")]),
) as Record<Timeframe, string>;

const INTERVAL_OPTIONS: readonly SegmentedOption<Timeframe>[] = TIMEFRAMES.map((tf) => ({
  value: tf,
  label: tf,
  ariaLabel: `${TIMEFRAME_NAMES[tf]} candles`,
}));
/** Splits intraday intervals from calendar ones. */
const INTERVAL_DIVIDERS: readonly Timeframe[] = ["1D"];

export const BAR_STYLES = ["candles", "heikin-ashi"] as const;
export type BarStyle = (typeof BAR_STYLES)[number];
const BAR_STYLE_OPTIONS: readonly SegmentedOption<BarStyle>[] = [
  { value: "candles", label: "Candles", title: "Candlesticks from the real prices" },
  {
    value: "heikin-ashi",
    label: "Heikin Ashi",
    title:
      "Heikin Ashi: averaged bars that smooth out noise so trends stand out. Prices shown stay real.",
  },
];

export const OVERLAYS = ["trades", "levels", "plan"] as const;
export type Overlay = (typeof OVERLAYS)[number];
const OVERLAY_LABELS: Record<Overlay, string> = { trades: "Buy/Sell", levels: "S/R", plan: "Plan" };
const OVERLAY_NAMES: Record<Overlay, string> = {
  trades: "Best past buy and sell points (hindsight)",
  levels: "Support and resistance levels, and trend support",
  plan: "Buy zone, stop and targets",
};

export function ChartToolbar({
  timeframe,
  onInterval,
  indicators,
  indicatorColors,
  onToggleIndicator,
  overlays,
  onToggleOverlay,
  sidePanel,
  onTogglePanel,
  loading,
  barStyle,
  onBarStyle,
}: {
  timeframe: Timeframe;
  onInterval: (timeframe: Timeframe) => void;
  indicators: ReadonlySet<IndicatorId>;
  indicatorColors: Record<IndicatorId, string>;
  onToggleIndicator: (id: IndicatorId) => void;
  overlays: ReadonlySet<Overlay>;
  onToggleOverlay: (id: Overlay) => void;
  /** The column beside the chart. */
  sidePanel: "outlook" | "insights" | "none";
  onTogglePanel: (panel: "outlook" | "insights") => void;
  loading: boolean;
  barStyle: BarStyle;
  onBarStyle: (style: BarStyle) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
      <Segmented
        label="Interval"
        options={INTERVAL_OPTIONS}
        value={timeframe}
        onChange={onInterval}
        dividers={INTERVAL_DIVIDERS}
      />

      <Segmented
        label="Bar style"
        options={BAR_STYLE_OPTIONS}
        value={barStyle}
        onChange={onBarStyle}
      />

      <IndicatorMenu
        indicators={indicators}
        colors={indicatorColors}
        onToggle={onToggleIndicator}
      />

      <div className="flex items-center gap-1">
        {OVERLAYS.map((id) => (
          <ToggleChip
            key={id}
            pressed={overlays.has(id)}
            aria-label={OVERLAY_NAMES[id]}
            title={OVERLAY_NAMES[id]}
            onClick={() => onToggleOverlay(id)}
          >
            {OVERLAY_LABELS[id]}
          </ToggleChip>
        ))}
      </div>

      {loading && (
        <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
          Loading…
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <ToggleChip
          pressed={sidePanel === "insights"}
          aria-controls="chart-insights"
          onClick={() => onTogglePanel("insights")}
        >
          <ChartLineUpIcon aria-hidden size={14} />
          Insights
        </ToggleChip>
        <ToggleChip
          pressed={sidePanel === "outlook"}
          aria-controls="chart-outlook"
          onClick={() => onTogglePanel("outlook")}
          title="Claude's outlook from news, analyst ratings and this chart, in a panel beside it"
        >
          <SparkleIcon aria-hidden size={14} weight="fill" className="text-accent" />
          AI outlook
        </ToggleChip>
      </div>
    </div>
  );
}

function IndicatorMenu({
  indicators,
  colors,
  onToggle,
}: {
  indicators: ReadonlySet<IndicatorId>;
  colors: Record<IndicatorId, string>;
  onToggle: (id: IndicatorId) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        className={open ? "bg-subtle text-text" : ""}
      >
        <SlidersHorizontalIcon aria-hidden size={14} />
        Indicators
        {indicators.size > 0 && (
          <span className="rounded-md bg-accent/12 px-1.5 text-accent tabular-nums">
            <span className="sr-only">, </span>
            {indicators.size}
            <span className="sr-only"> on</span>
          </span>
        )}
      </Button>
      {open && (
        <fieldset className={`${POPOVER} absolute top-full left-0 z-30 mt-1.5 w-80`}>
          <legend className="sr-only">Indicators</legend>
          {INDICATORS.map((id) => (
            <label
              key={id}
              className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150 hover:bg-subtle"
            >
              <input
                type="checkbox"
                checked={indicators.has(id)}
                onChange={() => onToggle(id)}
                className="peer sr-only"
              />
              {/* Drawn checkbox; the visually hidden input keeps native semantics and keys. */}
              <span
                aria-hidden
                className="flex size-4 shrink-0 items-center justify-center rounded-md bg-panel ring-1 ring-rule ring-inset transition-colors duration-150 group-has-checked:bg-accent group-has-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2"
              >
                <CheckIcon
                  size={12}
                  className="text-white opacity-0 group-has-checked:opacity-100"
                />
              </span>
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: colors[id] }}
              />
              <span className="grid min-w-0">
                <span className="text-sm text-text">{INDICATOR_LABELS[id]}</span>
                <span className="truncate text-xs text-muted">{INDICATOR_NAMES[id]}</span>
              </span>
            </label>
          ))}
          <RsiLevelsEditor />
        </fieldset>
      )}
    </div>
  );
}

/**
 * Overbought/oversold levels: one setting for every stock, used by the RSI pane and the daily
 * signals in the watchlist, chart header and portfolio (ADR 0014).
 */
function RsiLevelsEditor() {
  const [levels, setLevels] = rsiLevels.use();
  const [draft, setDraft] = useState({
    overbought: String(levels.overbought),
    oversold: String(levels.oversold),
  });
  const parsed = RsiLevelsSchema.safeParse({
    overbought: Number(draft.overbought),
    oversold: Number(draft.oversold),
  });

  function change(field: keyof RsiLevels, value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    const valid = RsiLevelsSchema.safeParse({
      overbought: Number(next.overbought),
      oversold: Number(next.oversold),
    });
    if (valid.success) setLevels(valid.data);
  }

  const field = `${FIELD} h-7 w-14 text-right tabular-nums`;
  return (
    <div className="mt-1 grid gap-2.5 rounded-lg bg-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text">
          RSI levels <span className="font-normal text-muted">· all stocks</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          title="Reset to 70/30"
          className="-my-1 -mr-1.5 tabular-nums"
          onClick={() => {
            setLevels(DEFAULT_RSI_LEVELS);
            setDraft({
              overbought: String(DEFAULT_RSI_LEVELS.overbought),
              oversold: String(DEFAULT_RSI_LEVELS.oversold),
            });
          }}
        >
          70/30
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <label className="flex items-center gap-2 whitespace-nowrap text-fall">
          Overbought ≥
          <input
            type="number"
            min={55}
            max={95}
            value={draft.overbought}
            onChange={(event) => change("overbought", event.target.value)}
            className={field}
          />
        </label>
        <label className="flex items-center gap-2 whitespace-nowrap text-rise">
          Oversold ≤
          <input
            type="number"
            min={5}
            max={45}
            value={draft.oversold}
            onChange={(event) => change("oversold", event.target.value)}
            className={field}
          />
        </label>
      </div>
      {!parsed.success && (
        <p className="flex items-start gap-1.5 text-xs text-fall">
          <WarningCircleIcon aria-hidden size={14} className="mt-px shrink-0" />
          Overbought 55–95, oversold 5–45 (whole numbers).
        </p>
      )}
    </div>
  );
}
