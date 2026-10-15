// Sector and type per ticker from the owner's local model (ADR 0019). Only tickers and company
// names go to Ollama on this machine. The owner can correct any answer in the holdings table.

import * as z from "zod";

import { IDEA_CATEGORIES, IDEA_CATEGORY_LABELS, SECTORS } from "~/lib/ideas";
import type { StockProfile } from "~/lib/stock-profile";

import { type OllamaContext, ollamaStructured } from "../ollama";

/** A text-only batch is quick once the model is loaded; loading it can take a minute or two. */
const TIMEOUT_MS = 180_000;

const ClassificationSchema = z.object({
  profiles: z
    .array(
      z.object({
        symbol: z.string(),
        sector: z.enum(SECTORS).nullable(),
        style: z.enum(IDEA_CATEGORIES),
      }),
    )
    .max(200),
});

const SYSTEM =
  "You classify US-listed stocks and funds for a personal portfolio. Use what you know about each company; when unsure, pick the closest fit.";

export interface StockToClassify {
  symbol: string;
  /** Company name from the market data listing; helps with lesser-known tickers. */
  name: string | null;
}

export function buildClassifyPrompt(stocks: readonly StockToClassify[]): string {
  return [
    "Classify each of these:",
    ...stocks.map((stock) => `- ${stock.symbol}${stock.name ? ` (${stock.name})` : ""}`),
    "",
    "For each, return:",
    `- sector: its GICS sector, one of: ${SECTORS.join(", ")}. Use null for ETFs, index or mutual funds, and anything you can't place.`,
    "- style, the single best fit:",
    ...IDEA_CATEGORIES.map(
      (style) => `  - ${style} (${IDEA_CATEGORY_LABELS[style].name}): ${IDEA_CATEGORY_LABELS[style].hint}`,
    ),
    "  A broad index fund is growth; a dividend or income fund is dividend.",
    "Return one entry per symbol above, with the symbol exactly as given.",
  ].join("\n");
}

/**
 * The model's sector and style for each stock asked about, once each. Answers for symbols that
 * weren't asked are dropped; symbols it skipped are simply missing (classified next time).
 */
export async function classifyStocks(
  stocks: readonly StockToClassify[],
  context: OllamaContext,
): Promise<Array<Omit<StockProfile, "source">>> {
  if (stocks.length === 0) return [];
  const answer = await ollamaStructured(
    {
      feature: "Grouping holdings",
      system: SYSTEM,
      prompt: buildClassifyPrompt(stocks),
      schema: ClassificationSchema,
      timeoutMs: TIMEOUT_MS,
    },
    context,
  );
  const asked = new Set(stocks.map((stock) => stock.symbol));
  const bySymbol = new Map<string, Omit<StockProfile, "source">>();
  for (const profile of answer.profiles) {
    const symbol = profile.symbol.trim().toUpperCase();
    if (asked.has(symbol) && !bySymbol.has(symbol)) {
      bySymbol.set(symbol, { symbol, sector: profile.sector, style: profile.style });
    }
  }
  return [...bySymbol.values()];
}
