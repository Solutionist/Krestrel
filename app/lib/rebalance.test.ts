import { describe, expect, it } from "vitest";

import { currentWeights, planRebalance, type RebalancePlan, TargetsSchema } from "./rebalance";

function row(plan: RebalancePlan, symbol: string) {
  const found = plan.rows.find((candidate) => candidate.symbol === symbol);
  if (!found) throw new Error(`no row for ${symbol}`);
  return found;
}

describe("planRebalance, buy and sell", () => {
  it("sells what's over target to buy what's under, rounding whole shares so sells cover buys", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 10, lastPrice: 60 }, // $600, 60%
        { symbol: "B", shares: 4, lastPrice: 100 }, // $400, 40%
      ],
      targets: [
        { symbol: "A", weight: 50 },
        { symbol: "B", weight: 50 },
      ],
      cash: 0,
      mode: "buy-and-sell",
    });
    const a = row(plan, "A");
    const b = row(plan, "B");
    expect(a.currentPercent).toBeCloseTo(60);
    expect(a.drift).toBeCloseTo(10);
    expect(a.trade).toBeCloseTo(-100);
    expect(a.tradeShares).toBeCloseTo(-1.666667, 6);
    expect(a.wholeShares).toBe(-2);
    expect(b.trade).toBeCloseTo(100);
    expect(b.tradeShares).toBe(1);
    expect(b.wholeShares).toBe(1);
    expect(a.resultPercent).toBeCloseTo(50);
    expect(b.resultPercent).toBeCloseTo(50);
    expect(plan.bought).toBeCloseTo(100);
    expect(plan.sold).toBeCloseTo(100);
    expect(plan.cash.left).toBeCloseTo(0);
  });

  it("sells untargeted holdings entirely and keeps the unclaimed share as cash", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 10, lastPrice: 60 }, // $600
        { symbol: "C", shares: 2.5, lastPrice: 40 }, // $100, no target
      ],
      targets: [{ symbol: "A", weight: 80 }],
      cash: 0,
      mode: "buy-and-sell",
    });
    // Total $700: A should be $560, C $0, cash $140 (20%).
    expect(row(plan, "A").trade).toBeCloseTo(-40);
    expect(row(plan, "A").wholeShares).toBe(-1);
    const c = row(plan, "C");
    expect(c.targeted).toBe(false);
    expect(c.trade).toBeCloseTo(-100);
    // Selling everything sells exactly the (fractional) shares held, never more.
    expect(c.tradeShares).toBe(-2.5);
    expect(c.wholeShares).toBe(-2.5);
    expect(c.resultPercent).toBeCloseTo(0);
    expect(plan.cash.targetPercent).toBeCloseTo(20);
    expect(plan.cash.left).toBeCloseTo(140);
    expect(plan.cash.resultPercent).toBeCloseTo(20);
  });

  it("buys a target not held yet and leaves out held stocks without a price", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 10, lastPrice: 100 }, // $1,000
        { symbol: "X", shares: 3, lastPrice: null },
      ],
      targets: [
        { symbol: "A", weight: 50 },
        { symbol: "X", weight: 20 },
        { symbol: "NEW", weight: 30 },
      ],
      cash: 0,
      mode: "buy-and-sell",
    });
    expect(plan.unpriced).toEqual(["X"]);
    expect(plan.rows.map((candidate) => candidate.symbol)).toEqual(["A", "NEW"]);
    expect(plan.total).toBeCloseTo(1000);
    expect(row(plan, "A").trade).toBeCloseTo(-500);
    expect(row(plan, "A").wholeShares).toBe(-5);
    const fresh = row(plan, "NEW");
    expect(fresh.trade).toBeCloseTo(300);
    expect(fresh.tradeShares).toBeNull();
    expect(fresh.wholeShares).toBeNull();
    expect(plan.cash.targetPercent).toBeCloseTo(20);
    expect(plan.cash.left).toBeCloseTo(200);
  });

  it("prices a target not held yet from its quote and counts its whole shares", () => {
    const plan = planRebalance({
      positions: [{ symbol: "A", shares: 10, lastPrice: 100 }], // $1,000
      targets: [
        { symbol: "A", weight: 50 },
        { symbol: "NEW", weight: 50 },
      ],
      cash: 0,
      mode: "buy-and-sell",
      priceOf: (symbol) => (symbol === "NEW" ? 30 : null),
    });
    expect(row(plan, "NEW")).toMatchObject({ price: 30, trade: 500, wholeShares: 16 });
  });

  it("never buys more than it sells plus the new cash when targets add up to over 100%", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 5000, lastPrice: 100 }, // $500,000
        { symbol: "B", shares: 5000, lastPrice: 100 }, // $500,000
      ],
      targets: [
        { symbol: "A", weight: 50.01 },
        { symbol: "B", weight: 50 },
      ],
      cash: 0,
      mode: "buy-and-sell",
    });
    expect(plan.bought).toBeLessThanOrEqual(plan.sold + plan.cash.added + 1e-9);
  });

  it("holds when the difference is under half a cent", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 1, lastPrice: 100.004 },
        { symbol: "B", shares: 1, lastPrice: 100 },
      ],
      targets: [
        { symbol: "A", weight: 50 },
        { symbol: "B", weight: 50 },
      ],
      cash: 0,
      mode: "buy-and-sell",
    });
    for (const candidate of plan.rows) {
      expect(candidate.trade).toBe(0);
      expect(candidate.tradeShares).toBe(0);
      expect(candidate.wholeShares).toBe(0);
    }
    expect(plan.bought).toBe(0);
    expect(plan.sold).toBe(0);
  });
});

describe("planRebalance, buy only", () => {
  it("brings the most underweight holdings up first when the cash doesn't cover every gap", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 7, lastPrice: 100 }, // $700, target 40%
        { symbol: "B", shares: 4, lastPrice: 50 }, // $200, target 30%
        { symbol: "C", shares: 1, lastPrice: 100 }, // $100, target 30%
      ],
      targets: [
        { symbol: "A", weight: 40 },
        { symbol: "B", weight: 30 },
        { symbol: "C", weight: 30 },
      ],
      cash: 200,
      mode: "buy-only",
    });
    // Total $1,200: goals A $480, B $360, C $360. $200 can't fill B and C ($420 short), so both
    // end at the same $250 (69.4% of their goal): C gets $150, B $50, A nothing (and isn't sold).
    expect(row(plan, "A").trade).toBe(0);
    expect(row(plan, "C").trade).toBeCloseTo(150);
    expect(row(plan, "C").tradeShares).toBe(1.5);
    expect(row(plan, "C").wholeShares).toBe(1);
    expect(row(plan, "B").trade).toBeCloseTo(50);
    expect(row(plan, "B").wholeShares).toBe(1);
    expect(row(plan, "A").resultPercent).toBeCloseTo(58.333, 3);
    expect(row(plan, "B").resultPercent).toBeCloseTo(20.833, 3);
    expect(row(plan, "C").resultPercent).toBeCloseTo(20.833, 3);
    expect(plan.sold).toBe(0);
    expect(plan.bought).toBeCloseTo(200);
    expect(plan.cash.left).toBeCloseTo(0);
  });

  it("fills every gap when the cash is enough and keeps the rest", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 6, lastPrice: 100 }, // $600
        { symbol: "B", shares: 4, lastPrice: 100 }, // $400
        { symbol: "U", shares: 1, lastPrice: 100 }, // $100, no target: left alone
      ],
      targets: [
        { symbol: "A", weight: 40 },
        { symbol: "B", weight: 40 },
      ],
      cash: 1000,
      mode: "buy-only",
    });
    // Total $2,100: goals A $840, B $840.
    expect(row(plan, "A").trade).toBeCloseTo(240);
    expect(row(plan, "B").trade).toBeCloseTo(440);
    expect(row(plan, "U").trade).toBe(0);
    expect(row(plan, "A").resultPercent).toBeCloseTo(40);
    expect(plan.cash.left).toBeCloseTo(320);
    expect(plan.cash.resultPercent).toBeCloseTo((320 / 2100) * 100);
  });

  it("suggests nothing without new cash", () => {
    const plan = planRebalance({
      positions: [
        { symbol: "A", shares: 10, lastPrice: 60 },
        { symbol: "B", shares: 4, lastPrice: 100 },
      ],
      targets: [
        { symbol: "A", weight: 20 },
        { symbol: "B", weight: 80 },
      ],
      cash: 0,
      mode: "buy-only",
    });
    expect(plan.rows.every((candidate) => candidate.trade === 0)).toBe(true);
    expect(row(plan, "A").resultPercent).toBeCloseTo(60);
    expect(row(plan, "B").drift).toBeCloseTo(-40);
    expect(plan.cash.left).toBe(0);
  });

  it("returns an empty total when there is nothing priced and no cash", () => {
    const plan = planRebalance({
      positions: [],
      targets: [{ symbol: "A", weight: 100 }],
      cash: 0,
      mode: "buy-only",
    });
    expect(plan.total).toBe(0);
    expect(row(plan, "A").trade).toBe(0);
    expect(row(plan, "A").resultPercent).toBe(0);
  });
});

describe("currentWeights", () => {
  it("rounds to hundredths that add up to exactly 100% and skips unpriced or closed holdings", () => {
    const weights = currentWeights([
      { symbol: "A", shares: 1, marketValue: 100 },
      { symbol: "B", shares: 1, marketValue: 100 },
      { symbol: "C", shares: 1, marketValue: 100 },
      { symbol: "X", shares: 1, marketValue: null },
      { symbol: "Z", shares: 0, marketValue: 0 },
    ]);
    expect(weights).toEqual([
      { symbol: "A", weight: 33.34 },
      { symbol: "B", weight: 33.33 },
      { symbol: "C", weight: 33.33 },
    ]);
    expect(weights.reduce((sum, weight) => sum + weight.weight * 100, 0)).toBe(10_000);
  });
});

describe("TargetsSchema", () => {
  it("allows a total up to 100.01% and refuses more", () => {
    expect(
      TargetsSchema.safeParse([
        { symbol: "A", weight: 33.34 },
        { symbol: "B", weight: 33.34 },
        { symbol: "C", weight: 33.33 },
      ]).success,
    ).toBe(true);
    const over = TargetsSchema.safeParse([
      { symbol: "A", weight: 60 },
      { symbol: "B", weight: 40.5 },
    ]);
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toContain("100.50%");
  });

  it("refuses a symbol listed twice, ignoring case, and weights outside 0.01–100", () => {
    expect(
      TargetsSchema.safeParse([
        { symbol: "aapl", weight: 10 },
        { symbol: "AAPL", weight: 10 },
      ]).error?.issues[0]?.message,
    ).toBe("AAPL is listed twice");
    expect(TargetsSchema.safeParse([{ symbol: "A", weight: 0 }]).success).toBe(false);
    expect(TargetsSchema.safeParse([{ symbol: "A", weight: 100.5 }]).success).toBe(false);
  });

  it("keeps weights to the database's 4 decimals", () => {
    expect(TargetsSchema.parse([{ symbol: "A", weight: "12.345678" }])).toEqual([
      { symbol: "A", weight: 12.3457 },
    ]);
  });
});
