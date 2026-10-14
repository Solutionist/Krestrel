import {
  describeRsiSignal,
  RSI_PERIOD,
  type RsiLevels,
  type RsiSignal,
  type RsiSignalKind,
  SIGNAL_GLYPH,
  SIGNAL_LABEL,
} from "~/lib/rsi-signal";

const TONE: Record<RsiSignalKind, string> = {
  buy: "bg-rise/12 text-rise",
  sell: "bg-fall/12 text-fall",
  oversold: "text-rise",
  overbought: "text-fall",
  neutral: "text-muted",
};

/** Plain words for lists; the RSI number stays in the tooltip. */
const PLAIN_LABEL: Record<RsiSignalKind, string> = {
  buy: "Turning up",
  sell: "Turning down",
  oversold: "Oversold",
  overbought: "Overbought",
  neutral: "Steady",
};

/**
 * Daily RSI signal (ADR 0014). `compact` for lists, in plain words ("▲ Oversold", "▼ Turning down"); otherwise a sentence-length
 * chip for the chart header. The tooltip explains the rule and that it isn't advice.
 */
export function RsiSignalBadge({
  signal,
  levels,
  compact = false,
}: {
  signal: RsiSignal | null;
  levels: RsiLevels;
  compact?: boolean;
}) {
  if (!signal) {
    return (
      <span
        className={`whitespace-nowrap text-muted/60 ${compact ? "text-[11px]" : "inline-flex h-6 items-center text-xs"}`}
        title="Not enough daily history for an RSI yet."
      >
        {compact ? "No signal yet" : "RSI —"}
      </span>
    );
  }
  const value = signal.rsi.toFixed(0);
  const title = `Daily RSI(${RSI_PERIOD}): ${describeRsiSignal(signal, levels)} Levels ${levels.oversold}/${levels.overbought} (change under Indicators → RSI). A momentum rule of thumb, not financial advice.`;
  const glyph = signal.kind === "neutral" ? "" : `${SIGNAL_GLYPH[signal.kind]} `;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap tabular-nums ${compact ? "px-1.5 py-px text-[11px]" : "h-6 px-2 text-xs"} ${TONE[signal.kind]}`}
    >
      {compact
        ? `${glyph}${PLAIN_LABEL[signal.kind]}`
        : `${glyph}${SIGNAL_LABEL[signal.kind]} · daily RSI ${value}`}
      <span className="sr-only">. {describeRsiSignal(signal, levels)}</span>
    </span>
  );
}
