import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { citationCheck, describeResults, gatherResearch, httpUrl } from "./research";
import type { LlmClient } from "./types";
import type { WebResult, WebSearch, WebSearchQuery } from "./web-search";

const logger = pino({ level: "silent" });

function llm(webSearch: boolean): LlmClient {
  return {
    id: webSearch ? "claude-cli" : "ollama",
    displayName: "Fake",
    capabilities: { webSearch },
    generateStructured: async () => {
      throw new Error("not called");
    },
  };
}

const result = (url: string, title = url): WebResult => ({
  title,
  url,
  excerpt: `about ${title}`,
  published: "2026-10-12",
});

const queries: WebSearchQuery[] = [
  { query: "AAPL stock news", topic: "news", maxResults: 5 },
  { query: "AAPL analyst consensus", topic: "finance", maxResults: 5 },
];

describe("gatherResearch", () => {
  it("leaves research to a model that searches the web itself, without spending Tavily", async () => {
    const search = vi.fn<WebSearch["search"]>(async () => []);
    await expect(gatherResearch(llm(true), { search }, queries, logger)).resolves.toEqual({
      mode: "web",
      results: [],
      note: null,
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("has no research for a local model when Tavily isn't configured", async () => {
    await expect(gatherResearch(llm(false), null, queries, logger)).resolves.toEqual({
      mode: "none",
      results: [],
      note: null,
    });
  });

  it("spends no Tavily searches when AI is turned off (the run can't happen)", async () => {
    const search = vi.fn<WebSearch["search"]>(async () => []);
    const disabled: LlmClient = { ...llm(false), id: "none" };
    await expect(gatherResearch(disabled, { search }, queries, logger)).resolves.toMatchObject({
      mode: "none",
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("runs every query on Tavily for a local model and de-duplicates results by URL", async () => {
    const search = vi.fn<WebSearch["search"]>(async ({ topic }) =>
      topic === "news"
        ? [result("https://a.example/1"), result("https://a.example/2")]
        : [result("https://a.example/2", "dupe"), result("https://b.example/3")],
    );
    const research = await gatherResearch(llm(false), { search }, queries, logger);
    expect(search).toHaveBeenCalledTimes(2);
    expect(research.mode).toBe("tavily");
    expect(research.note).toBeNull();
    expect(research.results.map((r) => r.url)).toEqual([
      "https://a.example/1",
      "https://a.example/2",
      "https://b.example/3",
    ]);
  });

  it("keeps the results of the queries that worked when another one fails", async () => {
    const search = vi.fn<WebSearch["search"]>(async ({ topic }) => {
      if (topic === "finance") throw new Error("Tavily search failed (HTTP 500)");
      return [result("https://a.example/1")];
    });
    const research = await gatherResearch(llm(false), { search }, queries, logger);
    expect(research).toMatchObject({ mode: "tavily", note: null });
    expect(research.results).toHaveLength(1);
  });

  it("degrades to no research with the reason when every Tavily query fails", async () => {
    const search = vi.fn<WebSearch["search"]>(async () => {
      throw new Error("Tavily rejected the API key. Check TAVILY_API_KEY.");
    });
    await expect(gatherResearch(llm(false), { search }, queries, logger)).resolves.toEqual({
      mode: "none",
      results: [],
      note: "Tavily rejected the API key. Check TAVILY_API_KEY.",
    });
  });

  it("stays in Tavily mode when the searches succeed but find nothing", async () => {
    const search = vi.fn<WebSearch["search"]>(async () => []);
    await expect(gatherResearch(llm(false), { search }, queries, logger)).resolves.toEqual({
      mode: "tavily",
      results: [],
      note: null,
    });
  });
});

describe("describeResults", () => {
  it("lists date, title and URL then the excerpt, and says when there were none", () => {
    expect(
      describeResults([{ ...result("https://a.example/1", "Beat"), published: null }]),
    ).toEqual(["- undated · Beat · https://a.example/1", "  about Beat"]);
    expect(describeResults([])).toEqual(["(no results)"]);
  });
});

describe("httpUrl", () => {
  it("keeps only http(s) links, in one canonical spelling", () => {
    expect(httpUrl(" HTTPS://Example.com/a ")).toBe("https://example.com/a");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("mailto:a@b.c")).toBeNull();
    expect(httpUrl("not a url")).toBeNull();
  });
});

describe("citationCheck", () => {
  it("puts no restriction on a model that browsed the web itself", () => {
    const isCitable = citationCheck({ mode: "web", results: [], note: null }, []);
    expect(isCitable("https://anything.example/x")).toBe(true);
  });

  it("allows only the given links plus Tavily results, in any spelling, for a model that couldn't browse", () => {
    const isCitable = citationCheck(
      { mode: "tavily", results: [result("https://a.example/1")], note: null },
      [" https://FEED.example/x "],
    );
    expect(isCitable("https://a.example/1")).toBe(true);
    expect(isCitable("HTTPS://feed.example/x")).toBe(true);
    expect(isCitable("https://invented.example/2")).toBe(false);
    expect(isCitable("javascript:alert(1)")).toBe(false);
    const nothing = citationCheck({ mode: "none", results: [], note: null }, []);
    expect(nothing("https://a.example/1")).toBe(false);
  });
});
