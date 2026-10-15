import { describe, expect, it } from "vitest";
import type * as z from "zod";

import type { Analysis } from "~/lib/analysis";
import type { Candle, NewsItem } from "~/lib/market";
import type { Outlook } from "~/lib/outlook";
import { redactPii } from "~/lib/pii";
import type { TradePlan } from "~/lib/trade-plan";

import { citationCheck } from "../llm/research";
import type { LlmClient, StructuredRequest } from "../llm/types";
import {
  buildOutlookPrompt,
  generateOutlook,
  OUTLOOK_TIMEOUT_MS,
  type OutlookInput,
  sanitizeOutlook,
} from "./outlook";

const NOW = Date.parse("2026-10-14T18:00:00Z");
/** A model that browsed the web itself may cite any real link. */
const anyLink = () => true;
/** A model that couldn't browse may cite only the links it was given. */
const onlyGiven = (urls: string[]) =>
  citationCheck({ mode: "none", results: [], note: null }, urls);

const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
  const close = 80 + i / 2;
  return {
    time: 1_780_000_000 + i * 86_400,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  };
});

const analysis: Analysis = {
  swingThreshold: 0.03,
  pivots: [],
  trades: [],
  levels: [
    { id: "S1", kind: "support", price: 112.5, touches: 3, lastTouchTime: 1_780_500_000 },
    { id: "R1", kind: "resistance", price: 131.25, touches: 2, lastTouchTime: 1_780_600_000 },
  ],
  trendSupport: null,
};

const plan: TradePlan = {
  lastPrice: 119.5,
  bias: "uptrend",
  buyZone: { low: 112, high: 113.5, basis: "S1 support" },
  stop: { price: 108.4, basis: "1 ATR below the zone" },
  targets: [{ price: 131.25, basis: "R1 resistance" }],
  riskReward: 3.4,
  atr: 2,
};

const news: NewsItem[] = [
  {
    id: "1",
    headline: "Older story",
    summary: "",
    source: "benzinga",
    url: "https://example.com/older",
    createdAt: "2026-10-01T10:00:00Z",
  },
  {
    id: "2",
    headline: "Supplier raises guidance",
    summary: "",
    source: "benzinga",
    url: "https://example.com/newer",
    createdAt: "2026-10-13T10:00:00Z",
  },
  {
    id: "3",
    headline: "Supplier raises guidance",
    summary: "",
    source: "benzinga",
    url: null,
    createdAt: "2026-10-13T09:00:00Z",
  },
];

const input: OutlookInput = {
  symbol: "AAPL",
  timeframe: "1D",
  candles,
  analysis,
  plan,
  news,
  now: NOW,
  research: { mode: "web", results: [], note: null },
};

function outlook(overrides: Partial<Outlook> = {}): Outlook {
  return {
    sentiment: { overall: "somewhat_bullish", summary: "Guidance raised." },
    analysts: {
      consensus: "buy",
      targetLow: 100,
      targetMean: 140,
      targetHigh: 180,
      analystCount: 40,
      asOf: "2026-10-12",
      note: "Two upgrades this month.",
    },
    news: [],
    plan: { stance: "wait", buyLow: 112, buyHigh: 114, stop: 108, targets: [131], rationale: "r" },
    risks: [],
    ...overrides,
  };
}

const article = (url: string, date = "2026-10-10") => ({
  headline: "h",
  source: "Reuters",
  url,
  date,
  tone: "neutral" as const,
  why: "w",
});

describe("buildOutlookPrompt", () => {
  const prompt = buildOutlookPrompt(input);

  it("passes the Claude client's personal-data guard untouched", () => {
    expect(redactPii(prompt)).toEqual({ text: prompt, found: {} });
  });
  it("gives the levels, the local plan and the technical context", () => {
    expect(prompt).toContain("Last price: 119.50");
    expect(prompt).toContain("S1: support 112.50");
    expect(prompt).toContain("R1: resistance 131.25");
    expect(prompt).toContain("Buy zone 112.00–113.50 (S1 support)");
    expect(prompt).toContain("Stop 108.40");
    expect(prompt).toContain("131.25 (R1 resistance)");
    expect(prompt).toMatch(/RSI\(14\): \d+/);
    expect(prompt).toMatch(/EMA20: [+−-]?\d/);
    expect(prompt).toContain("ATR(14): 2.00");
  });

  it("lists feed headlines newest first, once per story, with their links", () => {
    const newer = prompt.indexOf(
      "2026-10-13 · benzinga · Supplier raises guidance · https://example.com/newer",
    );
    const older = prompt.indexOf("2026-10-01 · benzinga · Older story · https://example.com/older");
    expect(newer).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(newer);
    expect(prompt.split("Supplier raises guidance")).toHaveLength(2);
  });

  it("asks for web research on the last 30 days of news and the analyst consensus", () => {
    expect(prompt).toMatch(/web search for AAPL news since 2026-09-14/);
    expect(prompt).toMatch(
      /web search for the current Wall Street consensus rating and 12-month price targets/,
    );
    expect(prompt).toMatch(/never build or guess a URL/);
  });

  it("hands a local model the Tavily results and tells it to cite only listed links", () => {
    const local = buildOutlookPrompt({
      ...input,
      research: {
        mode: "tavily",
        results: [
          {
            title: "Apple target raised",
            url: "https://news.example/apple",
            excerpt: "Analysts lift targets.",
            published: "2026-10-12",
          },
        ],
        note: null,
      },
    });
    expect(local).toContain("- 2026-10-12 · Apple target raised · https://news.example/apple");
    expect(local).toContain("Analysts lift targets.");
    expect(local).toMatch(/you cannot browse/);
    expect(local).toMatch(/only as stated in the results above/);
    expect(local).not.toMatch(/use web search/);
  });

  it("tells a model with no research that it has no analyst data", () => {
    const bare = buildOutlookPrompt({
      ...input,
      research: { mode: "none", results: [], note: null },
    });
    expect(bare).not.toContain("Web search results");
    expect(bare).not.toMatch(/use web search/);
    expect(bare).toMatch(/no current analyst data, so use consensus "unknown"/);
  });
});

describe("sanitizeOutlook", () => {
  it("keeps only news with a real http(s) link and date, once per link, at most 6", () => {
    const cleaned = sanitizeOutlook(
      outlook({
        news: [
          article("javascript:alert(1)"),
          article("not a url"),
          article("ftp://example.com/file"),
          article("https://example.com/a", "sometime last week"),
          article("https://example.com/b"),
          article("https://example.com/b"),
          ...["c", "d", "e", "f", "g", "h"].map((id) => article(`https://example.com/${id}`)),
        ],
      }),
      120,
      anyLink,
    );
    expect(cleaned.news.map((item) => item.url)).toEqual([
      "https://example.com/b",
      "https://example.com/c",
      "https://example.com/d",
      "https://example.com/e",
      "https://example.com/f",
      "https://example.com/g",
    ]);
  });

  it("drops links a model that couldn't browse wasn't given, in any spelling of the URL", () => {
    const cleaned = sanitizeOutlook(
      outlook({
        news: [
          article("https://example.com/invented"),
          article("HTTPS://Example.com/given"),
          article("https://example.com/feed"),
        ],
      }),
      120,
      onlyGiven(["https://example.com/given", " https://EXAMPLE.com/feed "]),
    );
    expect(cleaned.news.map((item) => item.url)).toEqual([
      "https://example.com/given",
      "https://example.com/feed",
    ]);
    const nothingGiven = sanitizeOutlook(
      outlook({ news: [article("https://example.com/a")] }),
      120,
      onlyGiven([]),
    );
    expect(nothingGiven.news).toEqual([]);
  });

  it("swaps a reversed buy zone and drops prices outside sane bands of the last price", () => {
    const cleaned = sanitizeOutlook(
      outlook({
        plan: {
          stance: "buy",
          buyLow: 114,
          buyHigh: 110,
          stop: 112,
          targets: [400, 131, 105, 131, 125, Number.NaN],
          rationale: "r",
        },
      }),
      120,
      anyLink,
    );
    expect(cleaned.plan).toMatchObject({
      buyLow: 110,
      buyHigh: 114,
      stop: null,
      targets: [125, 131],
    });
  });

  it("drops a buy zone with a missing or far-off end, then checks the stop against the price", () => {
    const halfZone = sanitizeOutlook(
      outlook({
        plan: { stance: "wait", buyLow: 50, buyHigh: 115, stop: 100, targets: [], rationale: "r" },
      }),
      120,
      anyLink,
    );
    expect(halfZone.plan).toMatchObject({ buyLow: null, buyHigh: null, stop: 100 });
    const stopAbovePrice = sanitizeOutlook(
      outlook({
        plan: {
          stance: "avoid",
          buyLow: null,
          buyHigh: null,
          stop: 125,
          targets: [],
          rationale: "r",
        },
      }),
      120,
      anyLink,
    );
    expect(stopAbovePrice.plan.stop).toBeNull();
    const stopTooDeep = sanitizeOutlook(
      outlook({
        plan: {
          stance: "avoid",
          buyLow: null,
          buyHigh: null,
          stop: 30,
          targets: [],
          rationale: "r",
        },
      }),
      120,
      anyLink,
    );
    expect(stopTooDeep.plan.stop).toBeNull();
  });

  it("keeps only targets above the top of the buy zone", () => {
    const cleaned = sanitizeOutlook(
      outlook({
        plan: {
          stance: "buy",
          buyLow: 118,
          buyHigh: 126,
          stop: 115,
          targets: [124, 130],
          rationale: "r",
        },
      }),
      120,
      anyLink,
    );
    expect(cleaned.plan.targets).toEqual([130]);
  });

  it("nulls analyst targets an order of magnitude off and invalid counts or dates", () => {
    const cleaned = sanitizeOutlook(
      outlook({
        analysts: {
          consensus: "hold",
          targetLow: 5,
          targetMean: 130,
          targetHigh: 1300,
          analystCount: -1,
          asOf: "last week",
          note: "n",
        },
      }),
      120,
      anyLink,
    );
    expect(cleaned.analysts).toMatchObject({
      targetLow: null,
      targetMean: 130,
      targetHigh: null,
      analystCount: null,
      asOf: null,
    });
  });

  it("holds texts to their budgets, cutting at a word boundary", () => {
    const wordy = "Shares rose after the company raised guidance ".repeat(10);
    const cleaned = sanitizeOutlook(
      outlook({ sentiment: { overall: "neutral", summary: wordy }, risks: [wordy, "  "] }),
      120,
      anyLink,
    );
    expect(cleaned.sentiment.summary.length).toBeLessThanOrEqual(200);
    expect(cleaned.sentiment.summary.endsWith("…")).toBe(true);
    expect(wordy.startsWith(cleaned.sentiment.summary.slice(0, -1))).toBe(true);
    expect(cleaned.risks).toHaveLength(1);
    expect(cleaned.risks[0]?.length).toBeLessThanOrEqual(90);
  });
});

describe("generateOutlook", () => {
  function fakeLlm(data: Outlook, webSearch = true) {
    const requests: StructuredRequest<z.ZodType>[] = [];
    const llm: LlmClient = {
      id: webSearch ? "claude-cli" : "ollama",
      displayName: "Fake",
      capabilities: { webSearch },
      async generateStructured(request) {
        requests.push(request);
        return { data: request.schema.parse(data), model: "claude-test" };
      },
    };
    return { llm, requests };
  }

  it("lets Claude search the web for longer than a plain call, keeping any real link", async () => {
    const { llm, requests } = fakeLlm(
      outlook({ news: [article("javascript:alert(1)"), article("https://found.example/ok")] }),
    );
    const result = await generateOutlook(llm, input);
    expect(result.model).toBe("claude-test");
    const [request] = requests;
    expect(request?.webSearch).toBe(true);
    expect(request?.timeoutMs).toBe(OUTLOOK_TIMEOUT_MS);
    expect(result.outlook.news.map((item) => item.url)).toEqual(["https://found.example/ok"]);
  });

  it("keeps only feed and Tavily links from a model that couldn't browse", async () => {
    const { llm, requests } = fakeLlm(
      outlook({
        news: [
          article("https://invented.example/story"),
          article("https://example.com/newer"),
          article("https://news.example/apple"),
        ],
      }),
      false,
    );
    const result = await generateOutlook(llm, {
      ...input,
      research: {
        mode: "tavily",
        results: [{ title: "t", url: "https://news.example/apple", excerpt: "e", published: null }],
        note: null,
      },
    });
    expect(requests[0]?.webSearch).toBe(false);
    expect(result.outlook.news.map((item) => item.url)).toEqual([
      "https://example.com/newer",
      "https://news.example/apple",
    ]);
  });
});
