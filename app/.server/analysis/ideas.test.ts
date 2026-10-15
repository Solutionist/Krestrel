import { describe, expect, it } from "vitest";
import type * as z from "zod";

import type { IdeasModelOutput } from "~/lib/ideas";
import type { Trade } from "~/lib/portfolio";

import { citationCheck } from "../llm/research";
import type { LlmClient, StructuredRequest } from "../llm/types";
import {
  buildIdeasPrompt,
  generateIdeas,
  holdingWeights,
  IDEAS_TIMEOUT_MS,
  type IdeasInput,
  openPositions,
  sanitizeIdeas,
} from "./ideas";

/** A model that browsed the web itself may cite any real link. */
const anyLink = () => true;
/** A model that couldn't browse may cite only the links it was given. */
const onlyGiven = (urls: string[]) =>
  citationCheck({ mode: "none", results: [], note: null }, urls);

const NOW = Date.parse("2026-10-14T18:00:00Z");

const input: IdeasInput = {
  focus: "diversify",
  basis: "portfolio",
  holdings: [
    { symbol: "NVDA", weightPct: 62.345 },
    { symbol: "AAPL", weightPct: 37.655 },
  ],
  now: NOW,
  research: { mode: "web", results: [], note: null },
};

type ModelIdea = IdeasModelOutput["ideas"][number];

function idea(symbol: string, overrides: Partial<ModelIdea> = {}): ModelIdea {
  return {
    symbol,
    name: `${symbol} Corp`,
    category: "dividend",
    sector: "Utilities",
    thesis: "Regulated utility with rising rate base.",
    fit: "Adds a defensive sector.",
    risk: "Rate cases go badly.",
    metrics: [{ label: "Dividend yield", value: "3.1%" }],
    sources: [{ title: "Q2 results", url: "https://example.com/q2" }],
    ...overrides,
  };
}

function output(overrides: Partial<IdeasModelOutput> = {}): IdeasModelOutput {
  return {
    holdingSectors: [
      { symbol: "NVDA", sector: "Information Technology" },
      { symbol: "AAPL", sector: "Information Technology" },
    ],
    summary: "All tech.",
    suggestedSectors: ["Utilities", "Health Care"],
    ideas: ["NEE", "DUK", "SO", "AEP", "XEL"].map((symbol) => idea(symbol)),
    ...overrides,
  };
}

const trade = (overrides: Partial<Trade>): Trade => ({
  id: "t",
  portfolioId: "p1",
  symbol: "AAPL",
  side: "buy",
  shares: 10,
  price: 100,
  fee: 0,
  tradedOn: "2026-01-02",
  createdAt: "2026-01-02T00:00:00Z",
  ...overrides,
});

describe("starting mix", () => {
  it("weights open positions across portfolios by value, at cost when unpriced", () => {
    const positions = openPositions([
      trade({ portfolioId: "p1", symbol: "AAPL", shares: 10, price: 100 }),
      trade({ portfolioId: "p2", symbol: "AAPL", shares: 10, price: 100 }),
      trade({ portfolioId: "p1", symbol: "XOM", shares: 5, price: 100 }),
      trade({ portfolioId: "p2", symbol: "KO", shares: 2, price: 50 }),
      trade({ portfolioId: "p2", symbol: "KO", side: "sell", shares: 2, tradedOn: "2026-02-01" }),
    ]);
    const quotes = new Map([
      ["AAPL", { symbol: "AAPL", lastPrice: 150, lastTs: NOW, previousClose: 149 }],
    ]);
    // AAPL 20 × 150 = 3000 (priced), XOM 500 at cost, KO sold out.
    expect(holdingWeights(positions, quotes)).toEqual([
      { symbol: "AAPL", weight: 3000 / 3500 },
      { symbol: "XOM", weight: 500 / 3500 },
    ]);
  });
});

describe("buildIdeasPrompt", () => {
  const prompt = buildIdeasPrompt(input);

  it("sends only symbols and percent weights", () => {
    expect(prompt).toContain("- NVDA 62.3%");
    expect(prompt).toContain("- AAPL 37.7%");
    expect(prompt).not.toMatch(/shares|\$/i);
  });

  it("asks for web research, the three categories and excludes what is held", () => {
    expect(prompt).toMatch(/use web search for current facts/);
    expect(prompt).toMatch(/growth.*\n.*dividend.*\n.*risky/);
    expect(prompt).toContain("Exclude stocks already held: NVDA, AAPL.");
    expect(prompt).toMatch(/never build or guess a URL/);
  });

  it("steers to under-represented sectors, or keeps every idea in the focus sector", () => {
    expect(prompt).toMatch(/Focus: diversify\. Choose mainly from sectors the mix lacks/);
    expect(buildIdeasPrompt({ ...input, focus: "Energy" })).toContain(
      "Every idea must be in the Energy sector.",
    );
  });

  it("asks for no holding sectors when there is nothing to start from", () => {
    const empty = buildIdeasPrompt({ ...input, basis: "none", holdings: [] });
    expect(empty).toContain("leave holdingSectors empty");
    expect(empty).not.toContain("Exclude stocks already held");
  });

  it("gives a local model the Tavily results and limits its sources to them", () => {
    const local = buildIdeasPrompt({
      ...input,
      research: {
        mode: "tavily",
        results: [
          {
            title: "Utility yields",
            url: "https://r.example/u",
            excerpt: "NEE 3%",
            published: null,
          },
        ],
        note: null,
      },
    });
    expect(local).toContain("- undated · Utility yields · https://r.example/u");
    expect(local).toMatch(/you cannot browse further/);
    expect(local).toMatch(/only from the results above/);
    expect(local).not.toMatch(/use web search for current facts/);
  });

  it("asks a model without research for no sources", () => {
    const bare = buildIdeasPrompt({
      ...input,
      research: { mode: "none", results: [], note: null },
    });
    expect(bare).toMatch(/you have no web access/);
    expect(bare).toMatch(/leave sources empty/);
    expect(bare).not.toContain("Web search results");
  });
});

describe("sanitizeIdeas", () => {
  it("drops bad, held, duplicate and off-focus tickers and uppercases the rest", () => {
    const cleaned = sanitizeIdeas(
      output({
        ideas: [
          idea("nee"),
          idea("NEE"),
          idea("nvda"),
          idea("TOOLONGX"),
          idea("brk.b", { sector: "Financials" }),
          idea("DUK"),
        ],
      }),
      { held: ["NVDA", "AAPL"], focus: "Utilities", isCitable: anyLink },
    );
    expect(cleaned.ideas.map((entry) => entry.symbol)).toEqual(["NEE", "DUK"]);
    expect(
      sanitizeIdeas(output({ ideas: [idea("brk.b", { sector: "Financials" })] }), {
        held: [],
        focus: "diversify",
        isCitable: anyLink,
      }).ideas.map((entry) => entry.symbol),
    ).toEqual(["BRK.B"]);
  });

  it("keeps only http(s) sources, once each, at most two", () => {
    const [cleaned] = sanitizeIdeas(
      output({
        ideas: [
          idea("NEE", {
            sources: [
              { title: "x", url: "javascript:alert(1)" },
              { title: "", url: "https://example.com/a" },
              { title: "again", url: "https://example.com/a" },
              { title: "b", url: "http://example.com/b" },
              { title: "c", url: "https://example.com/c" },
            ],
          }),
        ],
      }),
      { held: [], focus: "diversify", isCitable: anyLink },
    ).ideas;
    expect(cleaned?.sources).toEqual([
      { title: "example.com", url: "https://example.com/a" },
      { title: "b", url: "http://example.com/b" },
    ]);
  });

  it("drops sources a model that couldn't browse wasn't given", () => {
    const [cleaned] = sanitizeIdeas(
      output({
        ideas: [
          idea("NEE", {
            sources: [
              { title: "made up", url: "https://invented.example/nee" },
              { title: "given", url: "HTTPS://R.example/u" },
            ],
          }),
        ],
      }),
      { held: [], focus: "diversify", isCitable: onlyGiven(["https://r.example/u"]) },
    ).ideas;
    expect(cleaned?.sources).toEqual([{ title: "given", url: "https://r.example/u" }]);
    const [bare] = sanitizeIdeas(output({ ideas: [idea("NEE")] }), {
      held: [],
      focus: "diversify",
      isCitable: onlyGiven([]),
    }).ideas;
    expect(bare?.sources).toEqual([]);
  });

  it("clamps texts and metrics at word boundaries and caps the list at 10", () => {
    const long = "word ".repeat(60);
    const cleaned = sanitizeIdeas(
      output({
        summary: long,
        ideas: Array.from({ length: 12 }, (_, i) =>
          idea(`A${String.fromCharCode(65 + i)}`, {
            thesis: long,
            metrics: [
              { label: "Revenue growth over the last twelve months", value: "+24%" },
              { label: " ", value: "1" },
            ],
          }),
        ),
      }),
      { held: [], focus: "diversify", isCitable: anyLink },
    );
    expect(cleaned.ideas).toHaveLength(10);
    expect(cleaned.summary.length).toBeLessThanOrEqual(240);
    const [first] = cleaned.ideas;
    expect(first?.thesis.length).toBeLessThanOrEqual(110);
    expect(first?.thesis).toMatch(/word…$/);
    expect(first?.metrics).toEqual([{ label: "Revenue growth over…", value: "+24%" }]);
  });

  it("keeps holding sectors only for the symbols that were sent, once each", () => {
    const cleaned = sanitizeIdeas(
      output({
        holdingSectors: [
          { symbol: "nvda", sector: "Information Technology" },
          { symbol: "NVDA", sector: "Energy" },
          { symbol: "TSLA", sector: "Consumer Discretionary" },
        ],
      }),
      { held: ["NVDA", "AAPL"], focus: "diversify", isCitable: anyLink },
    );
    expect(cleaned.holdingSectors).toEqual([{ symbol: "NVDA", sector: "Information Technology" }]);
  });
});

describe("generateIdeas", () => {
  function fakeLlm(data: IdeasModelOutput, webSearch: boolean) {
    const requests: StructuredRequest<z.ZodType>[] = [];
    const llm: LlmClient = {
      id: webSearch ? "claude-cli" : "ollama",
      displayName: "Fake",
      capabilities: { webSearch },
      async generateStructured<T extends z.ZodType>(request: StructuredRequest<T>) {
        requests.push(request);
        return { data: request.schema.parse(data), model: "claude-sonnet" };
      },
    };
    return { llm, requests };
  }

  it("lets Claude search the web with the long timeout, then sanitises", async () => {
    const { llm, requests } = fakeLlm(output({ ideas: [idea("NVDA"), ...output().ideas] }), true);
    const result = await generateIdeas(llm, input);
    expect(requests[0]).toMatchObject({ webSearch: true, timeoutMs: IDEAS_TIMEOUT_MS });
    expect(result.model).toBe("claude-sonnet");
    expect(result.ideas.ideas.map((entry) => entry.symbol)).not.toContain("NVDA");
    // A browsing model may cite what it found.
    expect(result.ideas.ideas[0]?.sources).toEqual([
      { title: "Q2 results", url: "https://example.com/q2" },
    ]);
  });

  it("keeps only Tavily links from a model that couldn't browse", async () => {
    const { llm, requests } = fakeLlm(
      output({
        ideas: [
          idea("NEE", {
            sources: [
              { title: "invented", url: "https://example.com/q2" },
              { title: "found", url: "https://r.example/u" },
            ],
          }),
          ...output().ideas.slice(1),
        ],
      }),
      false,
    );
    const result = await generateIdeas(llm, {
      ...input,
      research: {
        mode: "tavily",
        results: [{ title: "t", url: "https://r.example/u", excerpt: "e", published: null }],
        note: null,
      },
    });
    expect(requests[0]?.webSearch).toBe(false);
    expect(result.ideas.ideas[0]?.sources).toEqual([
      { title: "found", url: "https://r.example/u" },
    ]);
  });
});
