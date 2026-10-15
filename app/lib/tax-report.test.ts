import { describe, expect, it } from "vitest";

import type { ReceivedDividend } from "./dividends-received";
import { rateOnDay } from "./fx-history";
import { computePositions, mergePositions, type Trade } from "./portfolio";
import { taxReport, taxSellsCsv } from "./tax-report";

let sequence = 0;
function trade(
  side: Trade["side"],
  symbol: string,
  shares: number,
  price: number,
  tradedOn: string,
  fee = 0,
  portfolioId = "p1",
): Trade {
  sequence += 1;
  return {
    id: `t${sequence}`,
    portfolioId,
    symbol,
    side,
    shares,
    price,
    fee,
    tradedOn,
    createdAt: `2026-01-01T00:00:${String(sequence).padStart(2, "0")}Z`,
  };
}

function payout(
  symbol: string,
  exDate: string,
  payDate: string | null,
  cash: number,
): ReceivedDividend {
  return {
    portfolioId: "p1",
    symbol,
    exDate,
    payDate,
    shares: 10,
    perShare: cash / 10,
    cash,
    overridden: false,
  };
}

const usd = () => 1;

describe("taxReport", () => {
  it("realizes a sell against the average of several buys, fees included, in USD and THB", () => {
    // THB per USD: each amount converts at its own date's rate.
    const rateOn = rateOnDay({ "2024-01-02": 35, "2024-02-01": 36, "2024-03-01": 34 });
    if (!rateOn) throw new Error("rates expected");
    const report = taxReport({
      trades: [
        trade("buy", "AAPL", 10, 100, "2024-01-02", 1),
        trade("buy", "AAPL", 10, 120, "2024-02-01", 1),
        trade("sell", "AAPL", 5, 150, "2024-03-01", 2),
      ],
      received: [],
      rateOn,
    });

    const [sell] = report.sells;
    // USD: cost 2202 for 20 shares → 110.1 each; proceeds 750 − 2.
    expect(sell?.proceedsUsd).toBeCloseTo(748, 9);
    expect(sell?.costUsd).toBeCloseTo(550.5, 9);
    expect(sell?.gainUsd).toBeCloseTo(197.5, 9);
    // THB: buys 1001 × 35 + 1201 × 36 = 78,271 for 20 shares; a quarter sold at 34.
    expect(sell?.rate).toBe(34);
    expect(sell?.proceeds).toBeCloseTo(748 * 34, 9);
    expect(sell?.cost).toBeCloseTo(78_271 / 4, 9);
    expect(sell?.gain).toBeCloseTo(25_432 - 19_567.75, 9);
    // The baht strengthened (36 → 34), so part of the USD gain is lost in THB.
    expect(sell?.currencyEffect).toBeCloseTo(5_864.25 - 197.5 * 34, 9);
    expect(report.years).toEqual([
      expect.objectContaining({
        year: "2024",
        sells: 1,
        realizedUsd: expect.closeTo(197.5, 9),
        realized: expect.closeTo(5_864.25, 9),
        dividends: 0,
        total: expect.closeTo(5_864.25, 9),
      }),
    ]);
  });

  it("uses the previous business day's rate for a sell on a weekend", () => {
    const rateOn = rateOnDay({ "2024-03-01": 34, "2024-03-04": 40 });
    if (!rateOn) throw new Error("rates expected");
    const report = taxReport({
      trades: [
        trade("buy", "KO", 1, 50, "2024-03-01"),
        trade("sell", "KO", 1, 60, "2024-03-02"), // Saturday
      ],
      received: undefined,
      rateOn,
    });
    expect(report.sells[0]?.rate).toBe(34);
    expect(report.sells[0]?.gain).toBeCloseTo(10 * 34, 9);
  });

  it("matches computePositions' realized USD across partial sells, full sells, rebuys and portfolios", () => {
    const trades = [
      trade("buy", "AAPL", 10, 100, "2023-01-03", 1.5),
      trade("sell", "AAPL", 3, 110, "2023-06-01", 1),
      trade("buy", "AAPL", 5, 90, "2023-07-03", 0.5),
      trade("sell", "AAPL", 12, 95, "2024-02-01", 2), // closes the position
      trade("buy", "AAPL", 2, 200, "2024-03-01", 1), // fresh average
      trade("sell", "AAPL", 1, 180, "2025-01-02", 1),
      trade("buy", "MSFT", 4.5, 300, "2023-02-01", 3),
      trade("sell", "MSFT", 1.25, 350, "2023-12-29", 1),
      trade("buy", "AAPL", 7, 50, "2023-03-01", 2, "p2"),
      trade("sell", "AAPL", 7, 40, "2024-05-01", 2, "p2"),
    ];
    const byPortfolio = ["p1", "p2"].map((id) => {
      const result = computePositions(trades.filter((entry) => entry.portfolioId === id));
      if (!result.ok) throw new Error("ledger must replay");
      return result.positions;
    });
    const expected = mergePositions(byPortfolio).reduce(
      (sum, position) => sum + position.realized,
      0,
    );

    const report = taxReport({ trades, received: [], rateOn: usd });
    const total = report.years.reduce((sum, year) => sum + year.realizedUsd, 0);
    expect(total).toBeCloseTo(expected, 9);
    expect(report.sells).toHaveLength(5);
    expect(report.years.map((year) => [year.year, year.sells])).toEqual([
      ["2025", 1],
      ["2024", 2],
      ["2023", 2],
    ]);
  });

  it("shows USD unchanged when the report currency is USD", () => {
    const report = taxReport({
      trades: [
        trade("buy", "AAPL", 2, 100, "2024-01-02", 1),
        trade("sell", "AAPL", 2, 110, "2024-02-01", 1),
      ],
      received: [],
      rateOn: usd,
    });
    const [year] = report.years;
    expect(year?.realized).toBeCloseTo(18, 9);
    expect(year?.realizedUsd).toBeCloseTo(18, 9);
    expect(year?.proceeds).toBeCloseTo(219, 9);
    expect(year?.cost).toBeCloseTo(201, 9);
    expect(year?.currencyEffect).toBeCloseTo(0, 9);
  });

  it("counts dividends by pay date (ex-date when unknown) at that day's rate", () => {
    const rateOn = rateOnDay({ "2024-12-31": 30, "2025-01-02": 32 });
    if (!rateOn) throw new Error("rates expected");
    const report = taxReport({
      trades: [trade("buy", "KO", 10, 60, "2024-06-03")],
      received: [payout("KO", "2024-12-13", "2025-01-02", 5), payout("KO", "2024-12-31", null, 4)],
      rateOn,
    });
    expect(report.years).toEqual([
      expect.objectContaining({
        year: "2025",
        dividendsUsd: 5,
        dividends: 160,
        total: 160,
        sells: 0,
      }),
      expect.objectContaining({ year: "2024", dividendsUsd: 4, dividends: 120, total: 120 }),
    ]);
  });

  it("leaves sells and dividends without a rate out of the local totals and counts them", () => {
    const rateOn = rateOnDay({
      "2008-01-02": 60,
      "2008-11-28": 110,
      "2008-12-02": 120,
      "2018-02-02": 102,
    });
    if (!rateOn) throw new Error("rates expected");
    const report = taxReport({
      trades: [
        trade("buy", "KO", 2, 50, "2008-01-02"),
        trade("sell", "KO", 1, 60, "2008-12-01"),
        trade("sell", "KO", 1, 70, "2010-06-15"), // no rate that day
      ],
      received: [
        payout("KO", "2010-03-01", "2010-03-15", 5),
        payout("KO", "2008-11-20", "2008-12-05", 1),
      ],
      rateOn,
    });
    expect(report.sells[1]).toMatchObject({ rate: null, proceeds: null, gain: null, gainUsd: 20 });
    expect(report.years).toEqual([
      expect.objectContaining({
        year: "2010",
        sells: 1,
        unconverted: 2,
        realized: 0,
        realizedUsd: 20,
        dividends: 0,
        dividendsUsd: 5,
      }),
      expect.objectContaining({ year: "2008", unconverted: 0, dividends: 120 }),
    ]);
  });

  it("leaves dividends and the total unknown while the received dividends load", () => {
    const report = taxReport({
      trades: [trade("buy", "KO", 1, 50, "2024-03-01"), trade("sell", "KO", 1, 60, "2024-04-01")],
      received: undefined,
      rateOn: usd,
    });
    expect(report.years[0]).toMatchObject({ dividends: null, dividendsUsd: null, total: null });
  });
});

describe("taxSellsCsv", () => {
  const rateOn = rateOnDay({ "2024-01-02": 35, "2024-03-01": 34 });
  if (!rateOn) throw new Error("rates expected");
  const { sells } = taxReport({
    trades: [
      trade("buy", "BRK.B", 2, 100, "2024-01-02", 1),
      trade("sell", "BRK.B", 1, 150, "2024-03-01", 1),
    ],
    received: [],
    rateOn,
  });

  it("lists each sell in USD, plus the rate and local amounts for another currency", () => {
    expect(taxSellsCsv(sells, "THB")).toBe(
      "Date,Stock,Shares,Proceeds USD,Cost USD,Gain USD,Rate THB per USD,Proceeds THB,Cost THB,Gain THB\r\n" +
        "2024-03-01,BRK.B,1,149.00,100.50,48.50,34,5066.00,3517.50,1548.50\r\n",
    );
  });

  it("has only the USD columns for USD", () => {
    expect(taxSellsCsv(sells, "USD").split("\r\n")[0]).toBe(
      "Date,Stock,Shares,Proceeds USD,Cost USD,Gain USD",
    );
  });
});
