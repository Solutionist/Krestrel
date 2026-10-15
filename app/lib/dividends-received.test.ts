import { describe, expect, it } from "vitest";

import type { DividendPayment } from "./dividends";
import {
  type DividendOverride,
  type PortfolioTradeLike,
  receivedByYear,
  receivedDividends,
  receivedSummary,
} from "./dividends-received";

const A = "0190f0aa-0000-7000-8000-000000000001";
const B = "0190f0aa-0000-7000-8000-000000000002";
const TODAY = "2026-10-15";

const payout = (exDate: string, payDate: string | null, amount = 0.5, special = false) =>
  ({ exDate, payDate, amount, special }) satisfies DividendPayment;

const trade = (
  portfolioId: string,
  side: "buy" | "sell",
  shares: number,
  tradedOn: string,
  symbol = "KO",
): PortfolioTradeLike => ({ portfolioId, symbol, side, shares, tradedOn });

function received(
  trades: PortfolioTradeLike[],
  payouts: DividendPayment[],
  extra: { withholding?: number; overrides?: DividendOverride[] } = {},
) {
  return receivedDividends({
    payouts: { KO: payouts },
    trades,
    overrides: extra.overrides ?? [],
    withholding: extra.withholding ?? 0,
    today: TODAY,
  });
}

describe("receivedDividends", () => {
  it("pays nothing on shares bought on or after the ex-date", () => {
    const rows = received(
      [trade(A, "buy", 10, "2026-03-01"), trade(A, "buy", 5, "2026-06-01")],
      [payout("2026-06-01", "2026-06-15")],
    );
    expect(rows).toEqual([
      expect.objectContaining({ exDate: "2026-06-01", shares: 10, cash: 5, overridden: false }),
    ]);
  });

  it("still pays shares sold after the ex-date, and skips payouts with no shares held", () => {
    const rows = received(
      [trade(A, "buy", 10, "2026-01-05"), trade(A, "sell", 10, "2026-03-02")],
      [payout("2026-03-01", "2026-03-20"), payout("2026-06-01", "2026-06-15")],
    );
    expect(rows.map((row) => [row.exDate, row.shares])).toEqual([["2026-03-01", 10]]);
  });

  it("lists only payouts already paid, by pay date (else ex-date)", () => {
    const rows = received(
      [trade(A, "buy", 10, "2026-01-05")],
      [
        payout("2026-09-30", TODAY),
        payout("2026-10-01", "2026-10-16"),
        payout("2026-10-10", null),
        payout("2026-10-16", null),
      ],
    );
    expect(rows.map((row) => row.exDate)).toEqual(["2026-10-10", "2026-09-30"]);
  });

  it("applies withholding, but an override is the exact cash and ignores it", () => {
    const rows = received(
      [trade(A, "buy", 100, "2026-01-05")],
      [payout("2026-03-01", "2026-03-20"), payout("2026-06-01", "2026-06-15")],
      {
        withholding: 15,
        overrides: [{ portfolioId: A, symbol: "KO", exDate: "2026-06-01", amount: 41.37 }],
      },
    );
    expect(rows.map((row) => [row.cash, row.overridden])).toEqual([
      [42.5, false],
      [41.37, true],
    ]);
  });

  it("counts special payouts and joins payouts sharing an ex-date into one payment", () => {
    const rows = received(
      [trade(A, "buy", 10, "2026-01-05")],
      [payout("2026-03-01", "2026-03-20", 0.5), payout("2026-03-01", "2026-03-20", 1, true)],
    );
    expect(rows).toEqual([expect.objectContaining({ perShare: 1.5, cash: 15 })]);
  });

  it("works out each portfolio from its own trades, with its own overrides", () => {
    const rows = received(
      [
        trade(A, "buy", 10, "2026-01-05"),
        trade(B, "buy", 4, "2026-01-05"),
        // B buys more after the ex-date: no effect on B, and none on A.
        trade(B, "buy", 6, "2026-03-05"),
      ],
      [payout("2026-03-01", "2026-03-20")],
      { overrides: [{ portfolioId: B, symbol: "KO", exDate: "2026-03-01", amount: 1.7 }] },
    );
    expect(rows.map((row) => [row.portfolioId, row.shares, row.cash, row.overridden])).toEqual([
      [A, 10, 5, false],
      [B, 4, 1.7, true],
    ]);
  });
});

describe("receivedSummary", () => {
  it("splits the cash into this year, last year and all time by pay date", () => {
    const rows = received(
      [trade(A, "buy", 10, "2024-12-01")],
      [
        payout("2024-12-20", "2025-01-10"),
        payout("2025-06-01", "2025-06-15"),
        payout("2026-06-01", "2026-06-15"),
      ],
    );
    expect(receivedByYear(rows)).toEqual([
      { year: 2025, cash: 10 },
      { year: 2026, cash: 5 },
    ]);
    expect(receivedSummary(rows, TODAY)).toEqual({ thisYear: 5, lastYear: 10, allTime: 15 });
  });
});
