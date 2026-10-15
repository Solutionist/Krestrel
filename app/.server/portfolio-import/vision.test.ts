import { describe, expect, it } from "vitest";
import type * as z from "zod";

import type { LlmClient, StructuredRequest } from "../llm/types";
import { cleanHoldings, readHoldingsFromImage } from "./vision";

const image = new Uint8Array([137, 80, 78, 71]);

/** A model that reads `answer` off the screenshot; records what it was asked. */
function reader(answer: unknown) {
  const requests: StructuredRequest<z.ZodType>[] = [];
  const llm: LlmClient = {
    id: "ollama",
    displayName: "Fake",
    capabilities: { webSearch: false },
    async generateStructured(request) {
      requests.push(request);
      return { data: request.schema.parse(answer), model: "fake-vl" };
    },
  };
  return { llm, requests };
}

describe("readHoldingsFromImage", () => {
  it("sends the screenshot to the model and returns the cleaned holdings", async () => {
    const { llm, requests } = reader({
      currency: "usd",
      holdings: [
        { symbol: "AAPL", shares: 25, averageCost: 150.25 },
        { symbol: "brk-b", shares: 3, averageCost: 0 },
      ],
    });
    await expect(readHoldingsFromImage(llm, image)).resolves.toEqual({
      holdings: [
        { symbol: "AAPL", shares: 25, averageCost: 150.25 },
        { symbol: "BRK.B", shares: 3, averageCost: null },
      ],
      currency: "USD",
    });
    expect(requests[0]?.images).toEqual([image]);
  });

  it("maps the printed currency mark to a code, so non-USD costs can be flagged", async () => {
    const baht = reader({
      currency: " ฿ ",
      holdings: [{ symbol: "KO", shares: 20, averageCost: 2198.3 }],
    });
    expect((await readHoldingsFromImage(baht.llm, image)).currency).toBe("THB");
  });

  it("leaves the currency unknown when the mark is missing or unrecognised", async () => {
    const holdings = [{ symbol: "KO", shares: 20, averageCost: 60 }];
    expect(
      (await readHoldingsFromImage(reader({ currency: null, holdings }).llm, image)).currency,
    ).toBeNull();
    expect(
      (await readHoldingsFromImage(reader({ currency: "dollars", holdings }).llm, image)).currency,
    ).toBeNull();
  });
});

describe("cleanHoldings", () => {
  it("normalises tickers, blanks impossible amounts, and drops unusable rows", () => {
    expect(
      cleanHoldings([
        { symbol: "brk/b", shares: 2, averageCost: 410 },
        { symbol: "$TSLA", shares: 0.5231, averageCost: -3 },
        { symbol: "Apple Inc.", shares: 4, averageCost: 150 },
        { symbol: "MSFT", shares: null, averageCost: null },
      ]),
    ).toEqual([
      { symbol: "BRK.B", shares: 2, averageCost: 410 },
      { symbol: "TSLA", shares: 0.5231, averageCost: null },
    ]);
  });

  it("keeps the fuller reading when a ticker appears twice", () => {
    expect(
      cleanHoldings([
        { symbol: "NVDA", shares: null, averageCost: 98.42 },
        { symbol: "NVDA", shares: 120, averageCost: 98.42 },
      ]),
    ).toEqual([{ symbol: "NVDA", shares: 120, averageCost: 98.42 }]);
  });
});
