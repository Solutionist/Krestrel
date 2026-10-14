import { describe, expect, it } from "vitest";

import type { QuoteSnapshot } from "~/lib/market";
import { sortSymbols } from "~/lib/watchlist-sort";

function quote(symbol: string, lastPrice: number | null, previousClose: number | null) {
  return { symbol, lastPrice, lastTs: null, previousClose } satisfies QuoteSnapshot;
}

// AAA: 10 → +1 (+11.1%); BBB: 200 → +2 (+1%); CCC: 50 → -5 (-9.1%)
const quotes: Record<string, QuoteSnapshot> = {
  AAA: quote("AAA", 10, 9),
  BBB: quote("BBB", 200, 198),
  CCC: quote("CCC", 50, 55),
  NOP: quote("NOP", null, 12),
  NOC: quote("NOC", 30, null),
};
const symbols = ["CCC", "NOP", "AAA", "NOC", "BBB"];

describe("sortSymbols", () => {
  it("keeps the saved order for manual in either direction", () => {
    expect(sortSymbols(symbols, quotes, { key: "manual", direction: "asc" })).toEqual(symbols);
    expect(sortSymbols(symbols, quotes, { key: "manual", direction: "desc" })).toEqual(symbols);
  });

  it("sorts by symbol both ways", () => {
    expect(sortSymbols(symbols, quotes, { key: "symbol", direction: "asc" })).toEqual([
      "AAA",
      "BBB",
      "CCC",
      "NOC",
      "NOP",
    ]);
    expect(sortSymbols(symbols, quotes, { key: "symbol", direction: "desc" })).toEqual([
      "NOP",
      "NOC",
      "CCC",
      "BBB",
      "AAA",
    ]);
  });

  it("sorts by price with unknown prices last in both directions", () => {
    expect(sortSymbols(symbols, quotes, { key: "price", direction: "asc" })).toEqual([
      "AAA",
      "NOC",
      "CCC",
      "BBB",
      "NOP",
    ]);
    expect(sortSymbols(symbols, quotes, { key: "price", direction: "desc" })).toEqual([
      "BBB",
      "CCC",
      "NOC",
      "AAA",
      "NOP",
    ]);
  });

  it("sorts by percent change differently from absolute change", () => {
    expect(sortSymbols(symbols, quotes, { key: "changePercent", direction: "desc" })).toEqual([
      "AAA",
      "BBB",
      "CCC",
      "NOC",
      "NOP",
    ]);
    expect(sortSymbols(symbols, quotes, { key: "change", direction: "desc" })).toEqual([
      "BBB",
      "AAA",
      "CCC",
      "NOC",
      "NOP",
    ]);
    expect(sortSymbols(symbols, quotes, { key: "change", direction: "asc" })).toEqual([
      "CCC",
      "AAA",
      "BBB",
      "NOC",
      "NOP",
    ]);
  });

  it("puts symbols without any quote last", () => {
    expect(sortSymbols(["ZZZ", "AAA"], quotes, { key: "price", direction: "asc" })).toEqual([
      "AAA",
      "ZZZ",
    ]);
  });

  it("breaks ties by symbol A–Z regardless of direction", () => {
    const tied = { XB: quote("XB", 5, 4), XA: quote("XA", 5, 4), XC: quote("XC", 6, 4) };
    expect(sortSymbols(["XB", "XC", "XA"], tied, { key: "price", direction: "desc" })).toEqual([
      "XC",
      "XA",
      "XB",
    ]);
    expect(sortSymbols(["XB", "XC", "XA"], tied, { key: "price", direction: "asc" })).toEqual([
      "XA",
      "XB",
      "XC",
    ]);
  });

  it("sorts by daily RSI, symbols without an RSI last", () => {
    const signals = {
      AAA: { kind: "neutral" as const, rsi: 55, barsAgo: null },
      BBB: { kind: "oversold" as const, rsi: 22, barsAgo: null },
      CCC: null,
    };
    expect(
      sortSymbols(["AAA", "CCC", "BBB"], quotes, { key: "rsi", direction: "asc" }, signals),
    ).toEqual(["BBB", "AAA", "CCC"]);
  });

  it("does not mutate the input", () => {
    const input = [...symbols];
    sortSymbols(input, quotes, { key: "price", direction: "desc" });
    expect(input).toEqual(symbols);
  });
});
