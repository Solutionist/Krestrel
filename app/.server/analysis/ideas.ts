// Stock ideas (ADR 0017, 0020): the owner's mix by value (symbols and weights only) steers the
// chosen AI, which returns growth / dividend / risky ideas. Claude researches with web search; a
// local model gets Tavily results or only its own knowledge. Ideas, not advice.
import {
  type Focus,
  IDEA_CATEGORIES,
  IDEA_CATEGORY_LABELS,
  IDEA_LINE_MAX,
  IDEA_SUMMARY_MAX,
  type IdeaCategory,
  type IdeasModelOutput,
  IdeasModelSchema,
  type IdeasResponse,
  MAX_IDEAS,
  type Sector,
} from "~/lib/ideas";
import { type QuoteSnapshot, SymbolSchema } from "~/lib/market";
import {
  computePositions,
  mergePositions,
  type Position,
  type Trade,
  valuePosition,
} from "~/lib/portfolio";

import {
  type CitationCheck,
  citationCheck,
  describeResults,
  httpUrl,
  type Research,
} from "../llm/research";
import type { LlmClient } from "../llm/types";
import type { WebSearchQuery } from "../llm/web-search";
import { clamp } from "./outlook";

/** Researching several stocks takes minutes, like the outlook. */
export const IDEAS_TIMEOUT_MS = 300_000;
const NAME_MAX = 80;
const METRIC_MAX = 24;
const SOURCE_TITLE_MAX = 60;
const MAX_METRICS = 3;
const MAX_SOURCES = 2;
const MAX_SUGGESTED = 4;

export type IdeasBasis = Extract<IdeasResponse, { ok: true }>["basis"];

const CATEGORY_BRIEFS: Record<IdeaCategory, string> = {
  growth: "fast revenue or earnings growth",
  dividend: "steady businesses with a reliable, growing dividend",
  risky: "speculative small or mid caps, turnarounds, high-beta names",
};

const BASIS_LINES: Record<IdeasBasis, string> = {
  portfolio: "Starting mix: the investor's open holdings, weighted by market value.",
  watchlist: "Starting mix: no holdings yet, so the investor's watchlist, equally weighted.",
  none: "Starting mix: none (no holdings and an empty watchlist).",
};

const SYSTEM_PROMPT = `You are a terse equity researcher suggesting stocks worth a closer look for one private investor. These are ideas, not financial advice: no hype, no promises, no filler.
Use only the data given and the research available in this session. Never invent figures, tickers, or URLs; leave a metric out rather than guess.
Reply with JSON only, through the structured output.`;

/** What Krestrel searches on Tavily for a local model (Claude searches on its own). */
export function ideasQueries(focus: Focus, now: number): WebSearchQuery[] {
  const year = new Date(now).getUTCFullYear();
  const scope = focus === "diversify" ? "" : ` ${focus} sector`;
  return [
    {
      query: `best growth stocks to buy${scope} ${year}`,
      topic: "finance",
      timeRange: "month",
      maxResults: 5,
    },
    {
      query: `best dividend stocks${scope} ${year} yield`,
      topic: "finance",
      timeRange: "month",
      maxResults: 5,
    },
    {
      query: `speculative high risk high reward stocks${scope} ${year}`,
      topic: "finance",
      timeRange: "month",
      maxResults: 4,
    },
  ];
}

/** Open positions across every portfolio (each replayed on its own, then merged by symbol). */
export function openPositions(trades: readonly Trade[]): Position[] {
  const byPortfolio = new Map<string, Trade[]>();
  for (const trade of trades) {
    const list = byPortfolio.get(trade.portfolioId);
    if (list) list.push(trade);
    else byPortfolio.set(trade.portfolioId, [trade]);
  }
  // Writes are oversell-checked, so a failed replay can't happen; skip it rather than guess.
  const lists = [...byPortfolio.values()].map((list) => {
    const result = computePositions(list);
    return result.ok ? result.positions : [];
  });
  return mergePositions(lists).filter((position) => position.shares > 0);
}

/**
 * Weight of each position in the total value, largest first. Unpriced positions count at cost
 * basis so a missing quote does not drop a holding from the mix.
 */
export function holdingWeights(
  positions: readonly Position[],
  quotes: ReadonlyMap<string, QuoteSnapshot>,
): Array<{ symbol: string; weight: number }> {
  const values = positions
    .map((position) => ({
      symbol: position.symbol,
      value: valuePosition(position, quotes.get(position.symbol)).marketValue ?? position.costBasis,
    }))
    .filter((entry) => entry.value > 0);
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  return values
    .map((entry) => ({ symbol: entry.symbol, weight: entry.value / total }))
    .sort((a, b) => b.weight - a.weight || a.symbol.localeCompare(b.symbol));
}

export interface IdeasInput {
  focus: Focus;
  basis: IdeasBasis;
  /** Only symbols and percent weights: never share counts, amounts or portfolio names. */
  holdings: ReadonlyArray<{ symbol: string; weightPct: number }>;
  /** Epoch ms of "today", so the research is current. */
  now: number;
  /** How this run gets current facts (see `gatherResearch`). */
  research: Research;
}

export function buildIdeasPrompt(input: IdeasInput): string {
  const { focus, holdings } = input;
  const held = holdings.map((holding) => holding.symbol);
  const focusLine =
    focus === "diversify"
      ? "Focus: diversify. Choose mainly from sectors the mix lacks or under-weights (your suggested sectors), at most two ideas per sector."
      : `Focus: ${focus}. Every idea must be in the ${focus} sector.`;
  return [
    `Today: ${new Date(input.now).toISOString().slice(0, 10)}.`,
    BASIS_LINES[input.basis],
    ...(holdings.length
      ? holdings.map((holding) => `- ${holding.symbol} ${holding.weightPct.toFixed(1)}%`)
      : []),
    focusLine,
    ...(input.research.mode === "tavily"
      ? [
          "",
          "Web search results (date · title · url, then an excerpt):",
          ...describeResults(input.research.results),
        ]
      : []),
    "",
    "Task:",
    holdings.length
      ? "1. Sectors: give the GICS sector of every symbol listed above, one entry each."
      : "1. Sectors: there are no holdings, so leave holdingSectors empty.",
    `2. Summary: how the mix is spread across sectors and what it lacks (at most ${IDEA_SUMMARY_MAX} characters). Then up to ${MAX_SUGGESTED} under-represented sectors worth adding, most useful first.`,
    `3. Ideas: ${RESEARCH_STEPS[input.research.mode]} Pick 6 to 9 US-listed common stocks (NYSE or Nasdaq; no ETFs, funds, preferreds, warrants or OTC). About a third in each category:`,
    ...IDEA_CATEGORIES.map(
      (category) =>
        `   - ${category} (${IDEA_CATEGORY_LABELS[category].name}): ${CATEGORY_BRIEFS[category]}`,
    ),
    held.length
      ? `   Exclude stocks already held: ${held.join(", ")}.`
      : "   Spread the ideas across sectors.",
    `   For each idea: why it is worth a look (thesis), how it fits or diversifies this mix (fit) and its main risk, each at most ${IDEA_LINE_MAX} characters.`,
    `4. Evidence: up to ${MAX_METRICS} concrete metrics per idea with units (e.g. "Dividend yield": "3.1%", "Revenue growth": "+24% YoY", "Forward P/E": "18x"), labels and values at most ${METRIC_MAX} characters, and ${SOURCE_STEPS[input.research.mode]}`,
  ].join("\n");
}

const RESEARCH_STEPS: Record<Research["mode"], string> = {
  web: "use web search for current facts (dividend yield, revenue and earnings growth, valuation, recent news).",
  tavily:
    "use the web search results above for current facts (dividend yield, growth, valuation, news); you cannot browse further, so prefer stocks those results discuss.",
  none: "you have no web access, so use what you know; your figures may be out of date, so give metrics only where you are confident.",
};

const SOURCE_STEPS: Record<Research["mode"], string> = {
  web: `up to ${MAX_SOURCES} real source URLs you found (never build or guess a URL).`,
  tavily: `up to ${MAX_SOURCES} source URLs, only from the results above, exactly as written.`,
  none: "no sources (leave sources empty): you have none to cite.",
};

/** Real sources the answer may cite (`isCitable`), once per link, at most `MAX_SOURCES`. */
function sources(list: IdeasModelOutput["ideas"][number]["sources"], isCitable: CitationCheck) {
  const seen = new Set<string>();
  const kept: IdeasModelOutput["ideas"][number]["sources"] = [];
  for (const source of list) {
    const url = httpUrl(source.url);
    if (!url || seen.has(url) || !isCitable(url)) continue;
    seen.add(url);
    kept.push({ title: clamp(source.title, SOURCE_TITLE_MAX) || new URL(url).hostname, url });
    if (kept.length === MAX_SOURCES) break;
  }
  return kept;
}

/**
 * Holds the answer to the contract the page relies on: valid, unique tickers not already held
 * (and in the focus sector, when one is set), texts within budget, only http(s) sources (only
 * ones it was given, for a model that couldn't browse), at most 10 ideas, and sectors only for
 * the symbols that were sent.
 */
export function sanitizeIdeas(
  output: IdeasModelOutput,
  options: { held: readonly string[]; focus: Focus; isCitable: CitationCheck },
): IdeasModelOutput {
  const held = new Set(options.held.map((symbol) => symbol.toUpperCase()));
  const seen = new Set<string>();
  const ideas: IdeasModelOutput["ideas"] = [];
  for (const idea of output.ideas) {
    const parsed = SymbolSchema.safeParse(idea.symbol);
    if (!parsed.success) continue;
    const symbol = parsed.data;
    if (held.has(symbol) || seen.has(symbol)) continue;
    if (options.focus !== "diversify" && idea.sector !== options.focus) continue;
    seen.add(symbol);
    ideas.push({
      symbol,
      name: clamp(idea.name, NAME_MAX) || symbol,
      category: idea.category,
      sector: idea.sector,
      thesis: clamp(idea.thesis, IDEA_LINE_MAX),
      fit: clamp(idea.fit, IDEA_LINE_MAX),
      risk: clamp(idea.risk, IDEA_LINE_MAX),
      metrics: idea.metrics
        .map((metric) => ({
          label: clamp(metric.label, METRIC_MAX),
          value: clamp(metric.value, METRIC_MAX),
        }))
        .filter((metric) => metric.label && metric.value)
        .slice(0, MAX_METRICS),
      sources: sources(idea.sources, options.isCitable),
    });
    if (ideas.length === MAX_IDEAS) break;
  }

  const sectorOf = new Map<string, Sector>();
  for (const entry of output.holdingSectors) {
    const symbol = entry.symbol.trim().toUpperCase();
    if (held.has(symbol) && !sectorOf.has(symbol)) sectorOf.set(symbol, entry.sector);
  }

  return {
    holdingSectors: [...sectorOf].map(([symbol, sector]) => ({ symbol, sector })),
    summary: clamp(output.summary, IDEA_SUMMARY_MAX),
    suggestedSectors: [...new Set(output.suggestedSectors)].slice(0, MAX_SUGGESTED),
    ideas,
  };
}

/**
 * One run with the chosen AI; the result is schema-validated, then sanitised. A model that can't
 * browse may only cite the research's links.
 */
export async function generateIdeas(
  llm: LlmClient,
  input: IdeasInput,
  signal?: AbortSignal,
): Promise<{ ideas: IdeasModelOutput; model: string | null }> {
  const result = await llm.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: buildIdeasPrompt(input),
    schema: IdeasModelSchema,
    webSearch: input.research.mode === "web",
    timeoutMs: IDEAS_TIMEOUT_MS,
    signal,
  });
  return {
    ideas: sanitizeIdeas(result.data, {
      held: input.holdings.map((holding) => holding.symbol),
      focus: input.focus,
      isCitable: citationCheck(input.research, []),
    }),
    model: result.model,
  };
}
