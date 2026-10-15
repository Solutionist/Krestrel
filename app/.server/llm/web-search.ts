// Web search for local models (ADR 0020): Tavily, with the owner's own API key (TAVILY_API_KEY).
// Only search queries (tickers, sectors, plain words) are sent; never holdings, amounts or keys
// in logs. Claude doesn't need it: it searches the web itself.

import type { Logger } from "pino";
import * as z from "zod";

import { parseConfig } from "../env-schema";

const TavilyConfigSchema = z.object({
  TAVILY_API_KEY: z.string().min(1).optional(),
  TAVILY_URL: z.url({ protocol: /^https$/ }).default("https://api.tavily.com"),
});

const SEARCH_TIMEOUT_MS = 20_000;
/** Excerpts are clipped so a handful of results fits a local model's context. */
const EXCERPT_MAX = 600;

const SearchResponseSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      title: z.string(),
      url: z.string(),
      content: z.string().default(""),
      published_date: z.string().nullish(),
    }),
  ),
});

export interface WebResult {
  title: string;
  url: string;
  excerpt: string;
  /** YYYY-MM-DD when the source says so. */
  published: string | null;
}

export interface WebSearchQuery {
  query: string;
  topic: "news" | "general" | "finance";
  timeRange?: "week" | "month" | "year";
  maxResults: number;
}

export interface WebSearch {
  search(query: WebSearchQuery): Promise<WebResult[]>;
}

/** The owner's Tavily search, or null when no TAVILY_API_KEY is set. */
export function createWebSearch(context: {
  env: Readonly<Record<string, string | undefined>>;
  logger: Logger;
  fetch?: typeof fetch;
}): WebSearch | null {
  const config = parseConfig(TavilyConfigSchema, context.env, "Tavily web search");
  const key = config.TAVILY_API_KEY;
  if (!key) return null;
  const send = context.fetch ?? fetch;
  const log = context.logger.child({ mod: "tavily" });

  return {
    async search({ query, topic, timeRange, maxResults }) {
      const response = await send(new URL("/search", config.TAVILY_URL), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query,
          topic,
          max_results: maxResults,
          search_depth: "basic",
          ...(timeRange ? { time_range: timeRange } : {}),
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        // Tavily's message names the problem (bad key, rate limit) without echoing the key.
        const detail = await response.text().catch(() => "");
        log.warn({ status: response.status, query }, "tavily search failed");
        throw new Error(
          response.status === 401
            ? "Tavily rejected the API key. Check TAVILY_API_KEY."
            : `Tavily search failed (HTTP ${response.status}): ${detail.slice(0, 120)}`,
        );
      }
      const body = SearchResponseSchema.parse(await response.json());
      return body.results.map((result) => {
        const published = result.published_date ? Date.parse(result.published_date) : Number.NaN;
        return {
          title: result.title.trim(),
          url: result.url,
          excerpt: result.content.replace(/\s+/g, " ").trim().slice(0, EXCERPT_MAX),
          published: Number.isFinite(published)
            ? new Date(published).toISOString().slice(0, 10)
            : null,
        };
      });
    },
  };
}
