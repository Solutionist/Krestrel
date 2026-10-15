// How an AI run gets current facts (ADR 0020): Claude searches the web itself; a local model gets
// Tavily results gathered by Krestrel (when the owner set TAVILY_API_KEY), or nothing beyond the
// prompt's own data. Links a local model returns are kept only if they came from that material.

import type { Logger } from "pino";

import type { ResearchMode } from "~/lib/ai";

import type { LlmClient } from "./types";
import type { WebResult, WebSearch, WebSearchQuery } from "./web-search";

export interface Research {
  mode: ResearchMode;
  /** Tavily results, when mode is "tavily". */
  results: WebResult[];
  /** Why there is no web research although it was wanted (e.g. Tavily failed). */
  note: string | null;
}

/**
 * Research for `llm`: none needed when it searches itself; otherwise runs `queries` on the
 * owner's Tavily (de-duplicated by URL), degrading to no research if Tavily is missing or fails.
 */
export async function gatherResearch(
  llm: LlmClient,
  webSearch: WebSearch | null,
  queries: readonly WebSearchQuery[],
  logger: Logger,
): Promise<Research> {
  if (llm.capabilities.webSearch) return { mode: "web", results: [], note: null };
  // AI turned off (LLM_PROVIDER=none): the run will fail, so don't spend the owner's searches.
  if (!webSearch || llm.id === "none") return { mode: "none", results: [], note: null };
  const settled = await Promise.allSettled(queries.map((query) => webSearch.search(query)));
  const seen = new Set<string>();
  const results: WebResult[] = [];
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue;
    for (const result of outcome.value) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      results.push(result);
    }
  }
  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (results.length === 0 && failure?.status === "rejected") {
    const message = failure.reason instanceof Error ? failure.reason.message : "Tavily failed.";
    logger.warn({ message }, "web research unavailable; answering without it");
    return { mode: "none", results: [], note: message };
  }
  return { mode: "tavily", results, note: null };
}

/** Prompt lines for Tavily results: date · title · url, then the excerpt. */
export function describeResults(results: readonly WebResult[]): string[] {
  return results.length
    ? results.flatMap((result) => [
        `- ${result.published ?? "undated"} · ${result.title} · ${result.url}`,
        `  ${result.excerpt}`,
      ])
    : ["(no results)"];
}

/** A plain http(s) link in canonical form (trimmed, normalised by `URL`), or null for anything else. */
export function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Whether an answer may cite `url` (any form; it is normalised before comparing). */
export type CitationCheck = (url: string) => boolean;

/**
 * Links an answer may cite: anything for a model that searched the web itself, else only the
 * given URLs (feed headlines) and Tavily results, compared in canonical form.
 */
export function citationCheck(research: Research, extra: readonly string[]): CitationCheck {
  if (research.mode === "web") return () => true;
  const allowed = new Set(
    [...extra, ...research.results.map((result) => result.url)].flatMap(
      (url) => httpUrl(url) ?? [],
    ),
  );
  return (url) => {
    const canonical = httpUrl(url);
    return canonical !== null && allowed.has(canonical);
  };
}
