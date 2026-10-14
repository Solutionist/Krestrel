import { describe, expect, it } from "vitest";

import { createAssetIndex } from "./asset-search";

const index = createAssetIndex([
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
  { symbol: "A", name: "Agilent Technologies Inc.", exchange: "NYSE" },
  { symbol: "AA", name: "Alcoa Corporation", exchange: "NYSE" },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc.", exchange: "NASDAQ" },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ" },
  { symbol: "BRK.B", name: "Berkshire Hathaway Inc. Class B", exchange: "NYSE" },
  { symbol: "T", name: "AT&T Inc.", exchange: "NYSE" },
]);

const symbols = (query: string, limit = 10) =>
  index.search(query, limit).map((asset) => asset.symbol);

describe("asset search", () => {
  it("typing a letter lists tickers starting with it, exact match first then shortest", () => {
    expect(symbols("a")).toEqual(["A", "AA", "AMD", "AAPL"]);
  });

  it("matches company name words, after ticker matches", () => {
    expect(symbols("micro")).toEqual(["AMD", "MSFT"]);
    expect(symbols("apple")).toEqual(["AAPL"]);
    expect(symbols("at&t")).toEqual(["T"]);
  });

  it("does not match names on a single letter, to keep one-letter results to tickers", () => {
    expect(symbols("m")).toEqual(["MSFT"]);
  });

  it("handles class-share tickers and respects the limit", () => {
    expect(symbols("brk")).toEqual(["BRK.B"]);
    expect(symbols("a", 2)).toEqual(["A", "AA"]);
    expect(symbols("   ")).toEqual([]);
  });
});
