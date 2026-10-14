// "Ask Claude": the local analysis finds the points; the LLM ranks and annotates them in terse,
// fact-based one-liners (ADR 0012).
import type { Analysis } from "~/lib/analysis";
import {
  type Explanation,
  ExplanationSchema,
  NOTE_MAX,
  SUMMARY_MAX,
} from "~/lib/analysis-explanation";
import { type Candle, isCalendarTimeframe, type Timeframe } from "~/lib/market";
import { describePoint, tradeContexts } from "~/lib/trade-context";

import type { LlmClient } from "../llm/types";

/** Most recent candles included verbatim; older ones are summarised by the pivots. */
const MAX_PROMPT_CANDLES = 300;

const SYSTEM_PROMPT = `You annotate a stock chart for one person's private, hindsight study.
Software already computed swing points, the most profitable past buy/sell round trips, support/resistance levels, a trend-support line, and the facts at each entry and exit (RSI, volume vs 20-bar average, distance from EMA50, nearby level).
Write like a terse trading log:
- Each note: at most ${NOTE_MAX} characters (about 12 words), citing the given facts and ids. Example: "RSI 27 + 2.1× volume at S1; reclaimed EMA50 two bars later".
- Summary: one sentence, at most ${SUMMARY_MAX} characters.
- No adjectives like "great" or "strong", no hedging, no advice, no predictions.
- Use only the given ids, prices, and dates. Reply only through the structured output.`;

function day(time: number, timeframe: Timeframe): string {
  const iso = new Date(time * 1000).toISOString();
  // Daily+ as dates; intraday in UTC with minutes.
  return isCalendarTimeframe(timeframe) ? iso.slice(0, 10) : `${iso.slice(0, 16)}Z`;
}

const price = (value: number) => (value < 1 ? value.toFixed(4) : value.toFixed(2));

/** Compact, deterministic prompt; numeric data only (no account or app details). */
export function buildExplainPrompt(
  symbol: string,
  timeframe: Timeframe,
  candles: readonly Candle[],
  analysis: Analysis,
): string {
  const recent = candles.slice(-MAX_PROMPT_CANDLES);
  const first = candles[0];
  const last = candles.at(-1);
  const contexts = new Map(
    tradeContexts(candles, analysis).map((context) => [context.tradeId, context]),
  );
  const net = first && last ? `${((last.close / first.open - 1) * 100).toFixed(1)}%` : "n/a";

  const lines = [
    `Symbol: ${symbol}. Interval: ${timeframe}. ${candles.length} candles from ${first ? day(first.time, timeframe) : "?"} to ${last ? day(last.time, timeframe) : "?"}. Net move: ${net}.`,
    `Swing threshold: ${(analysis.swingThreshold * 100).toFixed(1)}%.`,
    "",
    "Trades (buy at a swing low, sell at a later swing high; the most profitable non-overlapping set):",
    ...(analysis.trades.length
      ? analysis.trades.flatMap((t) => {
          const facts = contexts.get(t.id);
          return [
            `${t.id}: buy ${day(t.buy.time, timeframe)} @ ${price(t.buy.price)}, sell ${day(t.sell.time, timeframe)} @ ${price(t.sell.price)}, return ${(t.returnFraction * 100).toFixed(1)}%, held ${facts?.bars ?? "?"} bars`,
            `  entry facts: ${(facts && describePoint(facts.buy)) || "n/a"}`,
            `  exit facts: ${(facts && describePoint(facts.sell)) || "n/a"}`,
          ];
        })
      : ["(none)"]),
    "",
    "Levels:",
    ...(analysis.levels.length
      ? analysis.levels.map((l) => `${l.id}: ${l.kind} ${price(l.price)} (${l.touches} touches)`)
      : ["(none)"]),
    "",
    analysis.trendSupport
      ? `Trend support: from ${day(analysis.trendSupport.from.time, timeframe)} @ ${price(analysis.trendSupport.from.price)} rising to ${price(analysis.trendSupport.to.price)} at the last candle${analysis.trendSupport.broken ? " (price has since closed below it)" : ""}.`
      : "Trend support: none (the last two swing lows are not rising).",
    "",
    "Swing points (time, kind, price):",
    ...analysis.pivots.map(
      (p) =>
        `${day(p.time, timeframe)} ${p.kind} ${price(p.price)}${p.confirmed ? "" : " (forming)"}`,
    ),
    "",
    `Candles (time,open,high,low,close,volume), most recent ${recent.length}:`,
    ...recent.map(
      (c) =>
        `${day(c.time, timeframe)},${price(c.open)},${price(c.high)},${price(c.low)},${price(c.close)},${Math.round(c.volume)}`,
    ),
  ];
  return lines.join("\n");
}

/** Trims to `max` characters at a word boundary, with an ellipsis (backstop for verbose output). */
function clamp(text: string, max: number): string {
  const tidy = text.trim().replace(/\s+/g, " ");
  if (tidy.length <= max) return tidy;
  const cut = tidy.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * Keeps only comments about items the analysis actually contains (ranked, de-duplicated) and
 * holds every line to its character budget.
 */
export function sanitizeExplanation(explanation: Explanation, analysis: Analysis): Explanation {
  const tradeIds = new Set(analysis.trades.map((t) => t.id));
  const levelIds = new Set(analysis.levels.map((l) => l.id));
  const seen = new Set<string>();
  const firstTime = (id: string, known: Set<string>) => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  return {
    summary: clamp(explanation.summary, SUMMARY_MAX),
    trades: explanation.trades
      .filter((t) => firstTime(t.id, tradeIds))
      .sort((a, b) => a.rank - b.rank)
      .map((t) => ({ ...t, note: clamp(t.note, NOTE_MAX) })),
    levels: explanation.levels
      .filter((l) => firstTime(l.id, levelIds))
      .map((l) => ({ ...l, note: clamp(l.note, NOTE_MAX) })),
    trend: analysis.trendSupport && explanation.trend ? clamp(explanation.trend, NOTE_MAX) : null,
  };
}

export async function explainAnalysis(
  llm: LlmClient,
  input: {
    symbol: string;
    timeframe: Timeframe;
    candles: readonly Candle[];
    analysis: Analysis;
    /** Model alias for this call; the backend default when omitted. */
    model?: string;
  },
): Promise<{ explanation: Explanation; model: string | null }> {
  const result = await llm.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: buildExplainPrompt(input.symbol, input.timeframe, input.candles, input.analysis),
    schema: ExplanationSchema,
    model: input.model,
  });
  return { explanation: sanitizeExplanation(result.data, input.analysis), model: result.model };
}
