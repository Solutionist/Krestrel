import { describe, expect, it } from "vitest";

import {
  type DayClose,
  performanceSeries,
  rangeBaseDay,
  summarizeRange,
  timeWeightedReturn,
} from "./performance";
import type { Trade } from "./portfolio";

let sequence = 0;
function trade(
  symbol: string,
  side: Trade["side"],
  shares: number,
  price: number,
  tradedOn: string,
  fee = 0,
): Trade {
  sequence += 1;
  return {
    id: `t${sequence}`,
    portfolioId: "p1",
    symbol,
    side,
    shares,
    price,
    fee,
    tradedOn,
    createdAt: `2026-01-01T00:00:${String(sequence).padStart(2, "0")}Z`,
  };
}

const TODAY = "2026-10-15";

describe("performanceSeries", () => {
  it("is empty without trades, or with only trades after today", () => {
    expect(performanceSeries([], {}, TODAY)).toEqual({ points: [], unpriced: [] });
    expect(
      performanceSeries([trade("AAPL", "buy", 1, 10, "2026-10-16")], {}, TODAY).points,
    ).toEqual([]);
  });

  it("counts a first-day buy as cash in and earns from the trade price to that day's close", () => {
    const { points } = performanceSeries(
      [trade("AAPL", "buy", 10, 100, "2026-10-12", 5)],
      {
        AAPL: [
          ["2026-10-12", 102],
          ["2026-10-13", 104],
        ],
        SPY: [
          ["2026-10-12", 500],
          ["2026-10-13", 510],
        ],
      },
      TODAY,
    );
    expect(points.map((point) => point.day)).toEqual(["2026-10-12", "2026-10-13"]);
    expect(points[0]?.portfolio).toEqual({ value: 1020, inflow: 1005, outflow: 0 });
    expect(points[1]?.portfolio).toEqual({ value: 1040, inflow: 0, outflow: 0 });
    // SPY buys 1005 / 500 = 2.01 shares at the close.
    expect(points[0]?.benchmark?.value).toBeCloseTo(1005);
    expect(points[1]?.benchmark?.value).toBeCloseTo(2.01 * 510);
  });

  it("carries the last close over gaps and uses the trade price before any close", () => {
    const { points, unpriced } = performanceSeries(
      [trade("AAPL", "buy", 2, 50, "2026-10-09"), trade("MSFT", "buy", 1, 300, "2026-10-12")],
      {
        // AAPL has no close on Oct 13.
        AAPL: [
          ["2026-10-09", 51],
          ["2026-10-12", 52],
        ],
        MSFT: [],
        SPY: [
          ["2026-10-09", 100],
          ["2026-10-12", 100],
          ["2026-10-13", 100],
        ],
      },
      TODAY,
    );
    expect(points.map((point) => [point.day, point.portfolio.value])).toEqual([
      ["2026-10-09", 102],
      ["2026-10-12", 104 + 300],
      ["2026-10-13", 104 + 300],
    ]);
    expect(unpriced).toEqual(["MSFT"]);
  });

  it("records sells as cash out after fees and sells the same amount of SPY", () => {
    const { points } = performanceSeries(
      [trade("AAPL", "buy", 10, 100, "2026-10-12"), trade("AAPL", "sell", 4, 110, "2026-10-13", 2)],
      {
        AAPL: [
          ["2026-10-12", 100],
          ["2026-10-13", 110],
        ],
        SPY: [
          ["2026-10-12", 100],
          ["2026-10-13", 100],
        ],
      },
      TODAY,
    );
    expect(points[1]?.portfolio).toEqual({ value: 660, inflow: 0, outflow: 438 });
    expect(points[1]?.benchmark).toEqual({ value: 562, inflow: 0, outflow: 438 });
  });

  it("never sells more SPY than the benchmark holds", () => {
    const { points } = performanceSeries(
      [trade("AAPL", "buy", 10, 100, "2026-10-12"), trade("AAPL", "sell", 10, 300, "2026-10-13")],
      {
        AAPL: [
          ["2026-10-12", 100],
          ["2026-10-13", 300],
        ],
        SPY: [
          ["2026-10-12", 100],
          ["2026-10-13", 100],
        ],
      },
      TODAY,
    );
    expect(points[1]?.portfolio).toEqual({ value: 0, inflow: 0, outflow: 3000 });
    expect(points[1]?.benchmark).toEqual({ value: 0, inflow: 0, outflow: 1000 });
  });

  it("has no benchmark without SPY prices", () => {
    const { points } = performanceSeries(
      [trade("AAPL", "buy", 1, 10, "2026-10-12")],
      { AAPL: [["2026-10-12", 11]] },
      TODAY,
    );
    expect(points[0]?.benchmark).toBeNull();
  });
});

describe("timeWeightedReturn", () => {
  it("ignores money added: +10% then +10% is +21% whatever was bought in between", () => {
    const twr = timeWeightedReturn(
      [
        { value: 1100, inflow: 1000, outflow: 0 },
        // Doubles the stake at the start of the day, then +10%.
        { value: (1100 + 1100) * 1.1, inflow: 1100, outflow: 0 },
      ],
      0,
    );
    expect(twr).toBeCloseTo(0.21);
  });

  it("ignores money taken out, and survives selling everything", () => {
    const twr = timeWeightedReturn(
      [
        { value: 1100, inflow: 1000, outflow: 0 },
        { value: 0, inflow: 0, outflow: 1210 },
        // Nothing invested: skipped.
        { value: 0, inflow: 0, outflow: 0 },
      ],
      0,
    );
    expect(twr).toBeCloseTo(0.21);
  });

  it("is null when nothing was ever invested", () => {
    expect(timeWeightedReturn([], 0)).toBeNull();
    expect(timeWeightedReturn([{ value: 0, inflow: 0, outflow: 0 }], 0)).toBeNull();
  });
});

describe("rangeBaseDay", () => {
  it("steps back calendar months, clamped to the month's end", () => {
    expect(rangeBaseDay("1M", "2026-10-15")).toBe("2026-09-15");
    expect(rangeBaseDay("1M", "2026-03-31")).toBe("2026-02-28");
    expect(rangeBaseDay("3M", "2026-01-15")).toBe("2025-10-15");
    expect(rangeBaseDay("1Y", "2024-02-29")).toBe("2023-02-28");
    expect(rangeBaseDay("YTD", "2026-10-15")).toBe("2025-12-31");
    expect(rangeBaseDay("ALL", "2026-10-15")).toBeNull();
  });
});

describe("summarizeRange", () => {
  const closes: Record<string, DayClose[]> = {
    AAPL: [
      ["2026-08-14", 100],
      ["2026-09-15", 110],
      ["2026-10-01", 121],
      ["2026-10-15", 121],
    ],
    SPY: [
      ["2026-08-14", 100],
      ["2026-09-15", 100],
      ["2026-10-01", 105],
      ["2026-10-15", 105],
    ],
  };
  const performance = performanceSeries(
    // The second buy lands on a day without a price move, so no daily convention can blur it.
    [trade("AAPL", "buy", 10, 100, "2026-08-14"), trade("AAPL", "buy", 10, 121, "2026-10-15")],
    closes,
    TODAY,
  );

  it("starts at the base day's close and leaves new money out of the gain", () => {
    const summary = summarizeRange(performance, "1M", TODAY);
    expect(summary?.startDay).toBe("2026-09-15");
    expect(summary?.points.map((point) => point.day)).toEqual([
      "2026-09-15",
      "2026-10-01",
      "2026-10-15",
    ]);
    expect(summary?.portfolio.start).toBe(1100);
    expect(summary?.portfolio.end).toBe(2420);
    expect(summary?.portfolio.netFlow).toBe(1210);
    expect(summary?.portfolio.gain).toBeCloseTo(110);
    expect(summary?.portfolio.twr).toBeCloseTo(0.1);
    expect(summary?.benchmark?.twr).toBeCloseTo(0.05);
  });

  it("starts from zero before the first trade for ranges reaching back further", () => {
    const summary = summarizeRange(performance, "1Y", TODAY);
    expect(summary?.startDay).toBeNull();
    expect(summary?.points).toHaveLength(4);
    expect(summary?.portfolio.start).toBe(0);
    expect(summary?.portfolio.gain).toBeCloseTo(2420 - 2210);
    expect(summary?.portfolio.twr).toBeCloseTo(0.21);
  });

  it("is null without points", () => {
    expect(summarizeRange({ points: [], unpriced: [] }, "ALL", TODAY)).toBeNull();
  });
});
