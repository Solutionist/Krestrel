import { describe, expect, it } from "vitest";

import {
  computePositions,
  mergePositions,
  type Position,
  portfolioTotals,
  sharesToReachAverage,
  type Trade,
  TradeInputSchema,
  type TradeSide,
  valuePosition,
} from "./portfolio";

let sequence = 0;
function trade(
  side: TradeSide,
  shares: number,
  price: number,
  tradedOn: string,
  extra: Partial<Trade> = {},
): Trade {
  sequence += 1;
  return {
    id: `t${sequence}`,
    portfolioId: "p1",
    symbol: "AAPL",
    side,
    shares,
    price,
    fee: 0,
    tradedOn,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    ...extra,
  };
}

function positionsOf(trades: Trade[]): Position[] {
  const result = computePositions(trades);
  if (!result.ok) throw new Error(`unexpected oversell of ${result.oversell.symbol}`);
  return result.positions;
}

describe("computePositions (average cost)", () => {
  it("averages buys with fees and realizes sells against the average", () => {
    const [position] = positionsOf([
      trade("buy", 10, 100, "2026-01-02", { fee: 5 }),
      trade("buy", 10, 120, "2026-01-05", { fee: 5 }),
      // Average cost (1000 + 5 + 1200 + 5) / 20 = 110.5
      trade("sell", 5, 130, "2026-02-01", { fee: 2 }),
    ]);
    expect(position?.shares).toBe(15);
    expect(position?.averageCost).toBeCloseTo(110.5);
    expect(position?.costBasis).toBeCloseTo(15 * 110.5);
    expect(position?.realized).toBeCloseTo(5 * (130 - 110.5) - 2);
  });

  it("replays by trade date, not entry order", () => {
    const [position] = positionsOf([
      trade("sell", 5, 150, "2026-03-01"),
      trade("buy", 10, 100, "2026-01-02"),
    ]);
    expect(position?.shares).toBe(5);
    expect(position?.realized).toBeCloseTo(250);
  });

  it("applies a day's buys before its sells", () => {
    const [position] = positionsOf([
      trade("sell", 4, 110, "2026-01-02"),
      trade("buy", 4, 100, "2026-01-02"),
    ]);
    expect(position?.shares).toBe(0);
    expect(position?.realized).toBeCloseTo(40);
  });

  it("resets cost after a full sell, so a later buy starts a fresh average", () => {
    const [position] = positionsOf([
      trade("buy", 3, 100, "2026-01-02"),
      trade("sell", 3, 90, "2026-01-03"),
      trade("buy", 2, 50, "2026-01-04"),
    ]);
    expect(position?.shares).toBe(2);
    expect(position?.averageCost).toBeCloseTo(50);
    expect(position?.realized).toBeCloseTo(-30);
  });

  it("handles fractional shares without leaving dust", () => {
    const [position] = positionsOf([
      trade("buy", 0.1, 100, "2026-01-02"),
      trade("buy", 0.2, 100, "2026-01-02"),
      trade("sell", 0.3, 100, "2026-01-03"),
    ]);
    expect(position?.shares).toBe(0);
    expect(position?.costBasis).toBe(0);
    expect(position?.averageCost).toBeNull();
  });

  it("rejects a sell of more shares than held on that date", () => {
    const result = computePositions([
      trade("buy", 5, 100, "2026-01-02"),
      trade("sell", 5, 100, "2026-01-03"),
      trade("buy", 5, 100, "2026-01-10"),
      trade("sell", 1, 100, "2026-01-05"),
    ]);
    expect(result).toEqual({
      ok: false,
      oversell: { symbol: "AAPL", tradedOn: "2026-01-05", held: 0, selling: 1 },
    });
  });
});

describe("valuation", () => {
  const quote = { symbol: "AAPL", lastPrice: 120, lastTs: null, previousClose: 100 };

  it("values held shares at the last price and today's move against the previous close", () => {
    const [position] = positionsOf([trade("buy", 10, 110, "2026-01-02")]);
    if (!position) throw new Error("no position");
    const valued = valuePosition(position, quote);
    expect(valued.marketValue).toBe(1200);
    expect(valued.unrealized).toBeCloseTo(100);
    expect(valued.unrealizedFraction).toBeCloseTo(100 / 1100);
    expect(valued.dayChange).toBe(200);
  });

  it("leaves unpriced open positions out of value totals but keeps their realized P/L", () => {
    const priced = valuePosition(
      { symbol: "AAPL", shares: 10, costBasis: 1000, averageCost: 100, realized: 50 },
      quote,
    );
    const unpriced = valuePosition(
      { symbol: "MSFT", shares: 2, costBasis: 600, averageCost: 300, realized: -20 },
      undefined,
    );
    const closed = valuePosition(
      { symbol: "NVDA", shares: 0, costBasis: 0, averageCost: null, realized: 75 },
      undefined,
    );
    const totals = portfolioTotals([priced, unpriced, closed]);
    expect(totals.marketValue).toBe(1200);
    expect(totals.costBasis).toBe(1000);
    expect(totals.unrealized).toBe(200);
    expect(totals.realized).toBe(105);
    expect(totals.dayChange).toBe(200);
    expect(totals.dayChangeFraction).toBeCloseTo(200 / 1000);
    expect(totals.unpriced).toEqual(["MSFT"]);
  });

  it("measures the day change only against positions that have one", () => {
    const base = { shares: 10, costBasis: 900, averageCost: 90, realized: 0 };
    const aapl = valuePosition(
      { symbol: "AAPL", ...base },
      { symbol: "AAPL", lastPrice: 100, lastTs: null, previousClose: 99 },
    );
    const newco = valuePosition(
      { symbol: "NEWCO", ...base },
      { symbol: "NEWCO", lastPrice: 100, lastTs: null, previousClose: null },
    );
    const totals = portfolioTotals([aapl, newco]);
    expect(totals.marketValue).toBe(2000);
    expect(totals.dayChange).toBeCloseTo(10);
    expect(totals.dayChangeFraction).toBeCloseTo(10 / 990);
  });

  it("merges the same symbol across portfolios into one average", () => {
    const [merged] = mergePositions([
      [{ symbol: "AAPL", shares: 10, costBasis: 1000, averageCost: 100, realized: 5 }],
      [{ symbol: "AAPL", shares: 30, costBasis: 6000, averageCost: 200, realized: -1 }],
    ]);
    expect(merged).toEqual({
      symbol: "AAPL",
      shares: 40,
      costBasis: 7000,
      averageCost: 175,
      realized: 4,
    });
  });
});

describe("TradeInputSchema", () => {
  const valid = {
    symbol: "AAPL",
    side: "buy",
    shares: "10",
    price: "187.5",
    tradedOn: "2025-01-02",
  };
  const errorOf = (input: Record<string, unknown>) =>
    TradeInputSchema.safeParse({ ...valid, ...input }).error?.issues[0]?.message;

  it("rounds shares to 6 decimals and prices to 4, the stored scale", () => {
    const parsed = TradeInputSchema.parse({ ...valid, shares: "1.0000025", price: "187.123456" });
    expect(String(parsed.shares)).toMatch(/^\d+(\.\d{1,6})?$/);
    expect(parsed.price).toBe(187.1235);
  });

  it("refuses shares that round to 0", () => {
    expect(errorOf({ shares: "0.0000004" })).toBe("Shares must be more than 0");
  });

  it("explains a value that isn't a number", () => {
    expect(errorOf({ shares: "1,000" })).toBe("Enter shares as a number, like 10 or 2.5");
  });

  it("refuses a future trade date", () => {
    expect(errorOf({ tradedOn: "2999-01-01" })).toBe("The trade date can't be in the future");
  });
});

describe("sharesToReachAverage", () => {
  it("solves the owner's example: 50 @ 150, buy at 80 to average 120", () => {
    const plan = sharesToReachAverage({ held: 50, average: 150, price: 80, target: 120 });
    expect(plan).toMatchObject({
      ok: true,
      shares: 37.5,
      wholeShares: 38,
      cost: 3000,
      wholeCost: 3040,
    });
    if (plan.ok) expect(plan.wholeAverage).toBeLessThanOrEqual(120);
  });

  it("includes the fee and works for averaging up", () => {
    const withFee = sharesToReachAverage({
      held: 50,
      average: 150,
      price: 80,
      target: 120,
      fee: 4,
    });
    expect(withFee.ok && withFee.shares).toBeCloseTo(37.6);
    const up = sharesToReachAverage({ held: 10, average: 100, price: 200, target: 150 });
    expect(up).toMatchObject({ ok: true, shares: 10, wholeShares: 10 });
  });

  it("explains when the target can't be reached at that price", () => {
    expect(sharesToReachAverage({ held: 50, average: 150, price: 130, target: 120 })).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(sharesToReachAverage({ held: 50, average: 150, price: 80, target: 150 })).toEqual({
      ok: false,
      reason: "already",
    });
    expect(sharesToReachAverage({ held: 0, average: 150, price: 80, target: 120 })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
