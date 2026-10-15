import { describe, expect, it } from "vitest";
import type * as z from "zod";

import type { IdeasModelOutput } from "~/lib/ideas";
import type { Trade } from "~/lib/portfolio";

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

const NOW = Date.parse("2026-10-14T18:00:00Z");

const input: IdeasInput = {
  focus: "diversify",
  basis: "portfolio",
  holdings: [
    { symbol: "NVDA", weightPct: 62.345 },
    { symbol: "AAPL", weightPct: 37.655 },
  ],
  now: NOW,
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
      { held: ["NVDA", "AAPL"], focus: "Utilities" },
    );
    expect(cleaned.ideas.map((entry) => entry.symbol)).toEqual(["NEE", "DUK"]);
    expect(
      sanitizeIdeas(output({ ideas: [idea("brk.b", { sector: "Financials" })] }), {
        held: [],
        focus: "diversify",
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
      { held: [], focus: "diversify" },
    ).ideas;
    expect(cleaned?.sources).toEqual([
      { title: "example.com", url: "https://example.com/a" },
      { title: "b", url: "http://example.com/b" },
    ]);
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
      { held: [], focus: "diversify" },
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
      { held: ["NVDA", "AAPL"], focus: "diversify" },
    );
    expect(cleaned.holdingSectors).toEqual([{ symbol: "NVDA", sector: "Information Technology" }]);
  });
});

describe("generateIdeas", () => {
  it("runs Claude with web tools, the chosen model and the long timeout, then sanitises", async () => {
    const requests: StructuredRequest<z.ZodType>[] = [];
    const llm: LlmClient = {
      id: "fake",
      displayName: "Fake",
      async generateStructured<T extends z.ZodType>(request: StructuredRequest<T>) {
        requests.push(request);
        return {
          data: request.schema.parse(output({ ideas: [idea("NVDA"), ...output().ideas] })),
          model: "claude-sonnet",
        };
      },
    };

    const result = await generateIdeas(llm, { ...input, model: "sonnet" });
    expect(requests[0]).toMatchObject({
      model: "sonnet",
      tools: ["WebSearch", "WebFetch"],
      timeoutMs: IDEAS_TIMEOUT_MS,
    });
    expect(result.model).toBe("claude-sonnet");
    expect(result.ideas.ideas.map((entry) => entry.symbol)).not.toContain("NVDA");

    await generateIdeas(llm, { ...input, model: "default" });
    expect(requests[1]?.model).toBeUndefined();
  });
});
