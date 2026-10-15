import { describe, expect, it } from "vitest";
import type * as z from "zod";

import type { LlmClient, StructuredRequest } from "../llm/types";
import { classifyStocks } from "./classify";

function classifier(answer: unknown) {
  const requests: StructuredRequest<z.ZodType>[] = [];
  const llm: LlmClient = {
    id: "ollama",
    displayName: "Fake",
    capabilities: { webSearch: false },
    async generateStructured(request) {
      requests.push(request);
      return { data: request.schema.parse(answer), model: "fake" };
    },
  };
  return { llm, requests };
}

describe("classifyStocks", () => {
  it("keeps one answer per asked ticker and drops ones it wasn't asked about", async () => {
    const { llm, requests } = classifier({
      profiles: [
        { symbol: "ko", sector: "Consumer Staples", style: "dividend" },
        { symbol: "KO", sector: "Energy", style: "risky" },
        { symbol: "VOO", sector: null, style: "growth" },
        { symbol: "TSLA", sector: "Consumer Discretionary", style: "growth" },
      ],
    });
    const stocks = [
      { symbol: "KO", name: "The Coca-Cola Company" },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF" },
      { symbol: "RKLB", name: null },
    ];
    await expect(classifyStocks(llm, stocks)).resolves.toEqual([
      { symbol: "KO", sector: "Consumer Staples", style: "dividend" },
      { symbol: "VOO", sector: null, style: "growth" },
    ]);
    // The prompt carries the listing names, which helps with lesser-known tickers.
    expect(requests[0]?.prompt).toContain("- KO (The Coca-Cola Company)");
    expect(requests[0]?.images).toBeUndefined();
  });

  it("doesn't call the model when there is nothing to classify", async () => {
    const { llm, requests } = classifier({ profiles: [] });
    await expect(classifyStocks(llm, [])).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
