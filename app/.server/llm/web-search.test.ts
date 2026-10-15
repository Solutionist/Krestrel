import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { ConfigError } from "../env-schema";
import { createWebSearch, type WebSearch } from "./web-search";

const logger = pino({ level: "silent" });
const query = {
  query: "AAPL stock news",
  topic: "news",
  timeRange: "month",
  maxResults: 6,
} as const;

function search(send: typeof fetch, env: Record<string, string> = {}): WebSearch {
  const webSearch = createWebSearch({
    env: { TAVILY_API_KEY: "tvly-test", ...env },
    logger,
    fetch: send,
  });
  if (!webSearch) throw new Error("expected a web search client");
  return webSearch;
}

describe("createWebSearch", () => {
  it("is off without a TAVILY_API_KEY", () => {
    expect(createWebSearch({ env: {}, logger })).toBeNull();
    expect(createWebSearch({ env: { TAVILY_API_KEY: "" }, logger })).toBeNull();
  });

  it("refuses a non-HTTPS Tavily URL, so the key never travels in clear text", () => {
    expect(() =>
      createWebSearch({
        env: { TAVILY_API_KEY: "tvly-test", TAVILY_URL: "http://api.tavily.com" },
        logger,
      }),
    ).toThrow(ConfigError);
  });

  it("POSTs the query to /search with the key as a Bearer token", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ results: [] }));
    await search(send).search(query);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tvly-test");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: "AAPL stock news",
      topic: "news",
      time_range: "month",
      max_results: 6,
      include_raw_content: false,
    });
  });

  it("omits the time range when the query has none", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ results: [] }));
    await search(send).search({ query: "Utilities sector", topic: "general", maxResults: 3 });
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).not.toHaveProperty("time_range");
  });

  it("returns tidy results: trimmed title, collapsed and clipped excerpt, ISO day or null", async () => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            title: "  Apple beats  ",
            url: "https://example.com/a",
            content: `Line one\n\n  line two ${"x".repeat(2000)}`,
            published_date: "Tue, 13 Oct 2026 14:00:00 GMT",
            score: 0.9,
          },
          { title: "Undated", url: "https://example.com/b", published_date: "not a date" },
        ],
      }),
    );
    const [first, second] = await search(send).search(query);
    expect(first).toMatchObject({
      title: "Apple beats",
      url: "https://example.com/a",
      published: "2026-10-13",
    });
    expect(first?.excerpt.startsWith("Line one line two x")).toBe(true);
    expect(first?.excerpt.length).toBe(600);
    expect(second).toEqual({
      title: "Undated",
      url: "https://example.com/b",
      excerpt: "",
      published: null,
    });
  });

  it("explains a rejected key without echoing it, and reports other HTTP failures", async () => {
    const unauthorized = vi.fn<typeof fetch>(
      async () => new Response("Unauthorized: invalid key tvly-test", { status: 401 }),
    );
    const rejected = await search(unauthorized)
      .search(query)
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(Error);
    expect(String(rejected)).toMatch(/TAVILY_API_KEY/);
    expect(String(rejected)).not.toContain("tvly-test");

    const limited = vi.fn<typeof fetch>(async () => new Response("rate limited", { status: 429 }));
    await expect(search(limited).search(query)).rejects.toThrow(/HTTP 429.*rate limited/);
  });

  it("throws on a malformed response instead of returning junk results", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ answer: "no results key" }));
    await expect(search(send).search(query)).rejects.toThrow();
  });
});
