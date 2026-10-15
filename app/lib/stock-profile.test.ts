import { describe, expect, it } from "vitest";

import { type ValuedPosition, valuePosition } from "./portfolio";
import { groupHoldings, type StockProfile } from "./stock-profile";

function held(symbol: string, value: number | null): ValuedPosition {
  const position = { symbol, shares: 1, costBasis: 1, averageCost: 1, realized: 0 };
  const quote = {
    symbol,
    lastPrice: value,
    lastTs: null,
    previousClose: null,
  };
  return valuePosition(position, quote);
}

const profiles: Record<string, StockProfile> = {
  AAPL: { symbol: "AAPL", sector: "Information Technology", style: "growth", source: "model" },
  NVDA: { symbol: "NVDA", sector: "Information Technology", style: "growth", source: "model" },
  KO: { symbol: "KO", sector: "Consumer Staples", style: "dividend", source: "owner" },
  VOO: { symbol: "VOO", sector: null, style: "growth", source: "model" },
};

describe("groupHoldings", () => {
  const positions = [
    held("KO", 250),
    held("AAPL", 200),
    held("VOO", 450),
    held("NVDA", 100),
    held("RKLB", 1000),
  ];

  it("orders groups by value with the unclassified group last, and gives each one's share", () => {
    const groups = groupHoldings(positions, profiles, "sector");
    expect(groups.map((group) => [group.label, group.marketValue, group.weight])).toEqual([
      ["Tech", 300, 0.15],
      ["Staples", 250, 0.125],
      // Funds have no sector; RKLB isn't classified yet. Both land here, even though largest.
      ["Funds & unclassified", 1450, 0.725],
    ]);
    // Members keep the table's order.
    expect(groups[0]?.positions.map((position) => position.symbol)).toEqual(["AAPL", "NVDA"]);
  });

  it("groups by type, and counts unpriced holdings in a group without adding value", () => {
    const groups = groupHoldings(
      [...positions, held("MSFT", null)],
      {
        ...profiles,
        MSFT: {
          symbol: "MSFT",
          sector: "Information Technology",
          style: "growth",
          source: "model",
        },
      },
      "style",
    );
    expect(groups.map((group) => [group.label, group.positions.length, group.marketValue])).toEqual(
      [
        ["Growth", 4, 750],
        ["Dividend", 1, 250],
        ["Unclassified", 1, 1000],
      ],
    );
  });
});
