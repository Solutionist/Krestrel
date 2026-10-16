// AI outlook (ADR 0016, 0020): the local analysis and trade plan supply the levels; the chosen AI
// (Claude or a local model) adds news, analyst consensus and a forward plan. Claude researches
// with web search; a local model gets Tavily results or only the feed. A plan, not advice.
import type { Analysis } from "~/lib/analysis";
import { INTERVAL_RANGE, PERIOD_NAMES } from "~/lib/chart-ranges";
import { ema, rsi } from "~/lib/indicators";
import type { Candle, NewsItem, Timeframe } from "~/lib/market";
import {
  HEADLINE_MAX,
  LINE_MAX,
  type Outlook,
  OutlookSchema,
  STANCES,
  type Stance,
  SUMMARY_MAX,
} from "~/lib/outlook";
import type { TradePlan } from "~/lib/trade-plan";

import {
  type CitationCheck,
  citationCheck,
  describeResults,
  httpUrl,
  type Research,
} from "../llm/research";
import type { LlmClient } from "../llm/types";
import type { WebSearchQuery } from "../llm/web-search";

/** Web research takes minutes, well past the default CLI timeout for a plain JSON call. */
export const OUTLOOK_TIMEOUT_MS = 300_000;
/** How far back Claude should look for news (matches the feed's window). */
const NEWS_DAYS = 30;
const MAX_NEWS = 6;
const MAX_PROMPT_HEADLINES = 20;
const SOURCE_MAX = 40;
const DAY_MS = 86_400_000;

const STANCE_MEANINGS: Record<Stance, string> = {
  buy: "price is in or near the buy zone now and the setup holds",
  wait: "worth owning, but better bought lower: wait for a pullback into the buy zone",
  hold: "owners keep; no new entry at this price",
  trim: "near the targets or stretched; consider taking some profit",
  avoid: "downtrend, broken setup or bad news; stay out",
};

const SYSTEM_PROMPT = `You are a terse equity analyst writing a forward-looking trade plan for one private investor's own decision. It is a plan, not financial advice: no hype, no promises, no filler.
Use only the data given and the research available in this session. Never invent ratings, price targets, dates, or URLs; prefer null or "unknown" over a guess.
Reply with JSON only, through the structured output.`;

/** What Krestrel searches on Tavily for a local model (Claude searches on its own). */
export function outlookQueries(symbol: string): WebSearchQuery[] {
  return [
    { query: `${symbol} stock news`, topic: "news", timeRange: "month", maxResults: 6 },
    {
      query: `${symbol} analyst consensus rating price target`,
      topic: "finance",
      timeRange: "month",
      maxResults: 5,
    },
  ];
}

const price = (value: number) => (value < 1 ? value.toFixed(4) : value.toFixed(2));
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function signedPercent(fraction: number): string {
  const value = (fraction * 100).toFixed(1);
  return fraction > 0 ? `+${value}%` : `${value}%`;
}

function describePlan(plan: TradePlan | null): string[] {
  if (!plan) return ["Local plan: none (too few candles)."];
  const targets = plan.targets.map((t) => `${price(t.price)} (${t.basis})`).join(", ");
  return [
    `Local plan (rule-based, from the levels below): bias ${plan.bias}.`,
    plan.buyZone
      ? `  Buy zone ${price(plan.buyZone.low)}–${price(plan.buyZone.high)} (${plan.buyZone.basis}).`
      : "  Buy zone: none (no support below price, or downtrend).",
    plan.stop ? `  Stop ${price(plan.stop.price)} (${plan.stop.basis}).` : "  Stop: none.",
    `  Targets: ${targets || "none above price"}.`,
    `  Reward:risk to the first target: ${plan.riskReward === null ? "n/a" : plan.riskReward.toFixed(1)}.`,
  ];
}

/** Newest first, one line per story (same URL or same headline = same story). */
function describeHeadlines(news: readonly NewsItem[]): string[] {
  const seen = new Set<string>();
  const lines = [...news]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter((item) => {
      const keys = [item.headline.trim().toLowerCase(), ...(item.url ? [item.url] : [])];
      if (keys.some((key) => seen.has(key))) return false;
      for (const key of keys) seen.add(key);
      return true;
    })
    .slice(0, MAX_PROMPT_HEADLINES)
    .map(
      (item) =>
        `- ${item.createdAt.slice(0, 10)} · ${item.source} · ${item.headline.trim()} · ${item.url ?? "no link"}`,
    );
  return lines.length ? lines : ["(none from the feed)"];
}

export interface OutlookInput {
  symbol: string;
  timeframe: Timeframe;
  /** The analysed window (same candles as the chart's Insights), oldest first. */
  candles: readonly Candle[];
  analysis: Analysis;
  plan: TradePlan | null;
  /** The market-data provider's recent headlines. */
  news: readonly NewsItem[];
  /** Epoch ms of "today" for the news window. */
  now: number;
  /** How this run gets current facts (see `gatherResearch`). */
  research: Research;
}

/** Compact, deterministic prompt: numbers, levels, the local plan and feed headlines. */
export function buildOutlookPrompt(input: OutlookInput): string {
  const { symbol, timeframe, candles, analysis, plan } = input;
  const closes = candles.map((candle) => candle.close);
  const first = candles[0];
  const lastCandle = candles.at(-1);
  const last = lastCandle?.close ?? 0;
  const rsiNow = rsi(closes).at(-1);
  const atr = plan?.atr;
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const since = isoDay(input.now - NEWS_DAYS * DAY_MS);
  const levels = [...analysis.levels].sort((a, b) => b.price - a.price);

  return [
    `Symbol: ${symbol}. Today: ${isoDay(input.now)}.`,
    `Chart: ${timeframe} candles covering ${PERIOD_NAMES[INTERVAL_RANGE[timeframe]]} (${candles.length} candles, ${first ? isoDay(first.time * 1000) : "?"} to ${lastCandle ? isoDay(lastCandle.time * 1000) : "?"}).`,
    `Last price: ${price(last)}. Period range ${price(low)}–${price(high)}; net move ${first ? signedPercent(last / first.open - 1) : "n/a"}.`,
    `ATR(14): ${atr ? `${price(atr)} (${((atr / last) * 100).toFixed(1)}% of price)` : "n/a"}. RSI(14): ${rsiNow == null ? "n/a" : rsiNow.toFixed(0)}.`,
    `Distance to ${[20, 50]
      .map((period) => {
        const line = ema(closes, period).at(-1);
        return `EMA${period}: ${line ? `${signedPercent(last / line - 1)} (at ${price(line)})` : "n/a"}`;
      })
      .join("; ")}.`,
    "",
    ...describePlan(plan),
    "",
    "Support/resistance levels (from swing points; highest first):",
    ...(levels.length
      ? levels.map(
          (level) =>
            `- ${level.id}: ${level.kind} ${price(level.price)} (${level.touches} touches, last ${isoDay(level.lastTouchTime * 1000)})`,
        )
      : ["(none)"]),
    analysis.trendSupport
      ? `Rising trend support at ${price(analysis.trendSupport.to.price)} now${analysis.trendSupport.broken ? " (price has closed below it)" : ""}.`
      : "Trend support: none.",
    "",
    `Feed headlines for ${symbol} (date · source · headline · url), newest first:`,
    ...describeHeadlines(input.news),
    ...(input.research.mode === "tavily"
      ? [
          "",
          "Web search results (date · title · url, then an excerpt):",
          ...describeResults(input.research.results),
        ]
      : []),
    "",
    "Task:",
    ...researchTasks(symbol, since, input.research),
    "3. Sentiment: overall mood from the news and analysts together, and what drives it.",
    "4. Plan: build it around the levels and local plan above (buy zone, stop, targets); depart from them only when the news justifies it, and say so in the rationale. Buy zone low below high; stop below the buy zone; targets above the price, nearest first, at most 3. Use null where a price doesn't apply. Pick one stance:",
    ...STANCES.map((stance) => `   - ${stance}: ${STANCE_MEANINGS[stance]}`),
    "5. Risks: up to 3 things that would invalidate the plan.",
  ].join("\n");
}

/** Steps 1–2 (news, analysts), worded for how this run gets current facts. */
function researchTasks(symbol: string, since: string, research: Research): string[] {
  const cite = `Return up to ${MAX_NEWS} items that matter most, most important first, each with its publication date (YYYY-MM-DD), the source name, its tone for the stock (positive, neutral or negative), and why it matters.`;
  if (research.mode === "web") {
    return [
      `1. News: use web search for ${symbol} news since ${since} (earnings, guidance, products, deals, legal or regulatory, management, sector moves) and weigh it with the feed headlines. ${cite} Cite each item's real article URL as you found it (never build or guess a URL).`,
      `2. Analysts: use web search for the current Wall Street consensus rating and 12-month price targets (low, mean, high), the number of analysts and the as-of date (e.g. MarketBeat, TipRanks, Nasdaq, Yahoo Finance). Mention notable recent upgrades or downgrades in the note. If not found, use consensus "unknown" and nulls.`,
    ];
  }
  const material =
    research.mode === "tavily"
      ? "the feed headlines and the web search results above"
      : "the feed headlines above";
  return [
    `1. News: from ${material} only (you cannot browse). ${cite} Use only URLs listed above, exactly as written.`,
    research.mode === "tavily"
      ? `2. Analysts: the consensus rating, 12-month price targets (low, mean, high), analyst count and as-of date, only as stated in the results above. If they don't say, use consensus "unknown" and nulls.`
      : `2. Analysts: you have no current analyst data, so use consensus "unknown" and nulls, and say so in the note.`,
  ];
}

/** Trims to `max` characters at a word boundary, with an ellipsis (backstop for verbose output). */
export function clamp(text: string, max: number): string {
  const tidy = text.trim().replace(/\s+/g, " ");
  if (tidy.length <= max) return tidy;
  const cut = tidy.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** `value` when it is a finite number strictly inside (low, high), else null. */
function within(value: number | null, low: number, high: number): number | null {
  return value !== null && Number.isFinite(value) && value > low && value < high ? value : null;
}

/** Real, dated news the answer may cite (`isCitable`), once per link, at most `MAX_NEWS`. */
function newsItems(news: Outlook["news"], isCitable: CitationCheck): Outlook["news"] {
  const seen = new Set<string>();
  const kept: Outlook["news"] = [];
  for (const item of news) {
    const url = httpUrl(item.url);
    const published = Date.parse(item.date);
    if (!url || !Number.isFinite(published) || seen.has(url) || !isCitable(url)) continue;
    seen.add(url);
    kept.push({
      headline: clamp(item.headline, HEADLINE_MAX),
      source: clamp(item.source, SOURCE_MAX),
      url,
      date: isoDay(published),
      tone: item.tone,
      why: clamp(item.why, LINE_MAX),
    });
    if (kept.length === MAX_NEWS) break;
  }
  return kept;
}

function sanePlan(plan: Outlook["plan"], last: number): Outlook["plan"] {
  const low = within(plan.buyLow, 0.5 * last, 1.5 * last);
  const high = within(plan.buyHigh, 0.5 * last, 1.5 * last);
  const zone = low !== null && high !== null ? [Math.min(low, high), Math.max(low, high)] : null;
  const stop = within(plan.stop, 0.3 * last, zone?.[0] ?? last);
  const floor = Math.max(zone?.[1] ?? last, last);
  const targets = [
    ...new Set(plan.targets.flatMap((target) => within(target, floor, 3 * last) ?? [])),
  ]
    .sort((a, b) => a - b)
    .slice(0, 3);
  return {
    stance: plan.stance,
    buyLow: zone?.[0] ?? null,
    buyHigh: zone?.[1] ?? null,
    stop,
    targets,
    rationale: clamp(plan.rationale, SUMMARY_MAX),
  };
}

/**
 * Holds texts to their budgets and drops what the panel and chart must not show: news without a
 * real http(s) link or date (or, for a model that couldn't browse, a link it wasn't given), and
 * prices outside sane bands of the last price (stops at or above the entry, targets at or below
 * it, analyst targets off by an order of magnitude).
 */
export function sanitizeOutlook(
  outlook: Outlook,
  lastPrice: number,
  isCitable: CitationCheck,
): Outlook {
  const { analysts } = outlook;
  const target = (value: number | null) => within(value, 0.2 * lastPrice, 5 * lastPrice);
  const asOf = analysts.asOf?.trim() ?? "";
  return {
    sentiment: {
      overall: outlook.sentiment.overall,
      summary: clamp(outlook.sentiment.summary, SUMMARY_MAX),
    },
    analysts: {
      consensus: analysts.consensus,
      targetLow: target(analysts.targetLow),
      targetMean: target(analysts.targetMean),
      targetHigh: target(analysts.targetHigh),
      analystCount:
        analysts.analystCount !== null && analysts.analystCount >= 0 ? analysts.analystCount : null,
      asOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) && Number.isFinite(Date.parse(asOf)) ? asOf : null,
      note: clamp(analysts.note, LINE_MAX),
    },
    news: newsItems(outlook.news, isCitable),
    plan: sanePlan(outlook.plan, lastPrice),
    risks: outlook.risks
      .map((risk) => clamp(risk, LINE_MAX))
      .filter(Boolean)
      .slice(0, 3),
  };
}

/**
 * One run with the chosen AI; the result is schema-validated, then sanitised. A model that can't
 * browse may only cite the feed's and the research's links.
 */
export async function generateOutlook(
  llm: LlmClient,
  input: OutlookInput,
  signal?: AbortSignal,
): Promise<{ outlook: Outlook; model: string | null }> {
  const lastPrice = input.plan?.lastPrice ?? input.candles.at(-1)?.close ?? 0;
  const result = await llm.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: buildOutlookPrompt(input),
    schema: OutlookSchema,
    webSearch: input.research.mode === "web",
    timeoutMs: OUTLOOK_TIMEOUT_MS,
    signal,
  });
  const isCitable = citationCheck(
    input.research,
    input.news.flatMap((item) => (item.url ? [item.url] : [])),
  );
  return { outlook: sanitizeOutlook(result.data, lastPrice, isCitable), model: result.model };
}
