import { describe, expect, it } from "vitest";

import { dividendCalendar } from "./dividend-calendar";
import type { DividendInfo, TradeLike } from "./dividends";

const TODAY = "2026-10-15";

const quarterly: DividendInfo = {
  frequency: "quarterly",
  // Ex-date passed, pay date still to come: pending.
  last: { exDate: "2026-10-01", payDate: "2026-10-20", amount: 0.5 },
  next: { exDate: "2026-12-31", payDate: "2027-01-15", amount: 0.5, expected: true },
};

const buy = (shares: number, tradedOn: string): TradeLike => ({
  symbol: "KO",
  side: "buy",
  shares,
  tradedOn,
});

describe("dividendCalendar", () => {
  it("lists every month of the window, empty ones included, with monthly totals", () => {
    const { months } = dividendCalendar({
      positions: [{ symbol: "KO", shares: 10, marketValue: 600 }],
      trades: [buy(10, "2026-01-05")],
      dividends: { KO: quarterly },
      today: TODAY,
      months: 12,
      withholding: 0,
    });
    expect(months.map((month) => month.month)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07",
      "2027-08",
      "2027-09",
    ]);
    const paying = months.filter((month) => month.payments.length > 0);
    expect(paying.map((month) => [month.month, month.cash])).toEqual([
      ["2026-10", 5],
      ["2027-01", 5],
      ["2027-04", 5],
      ["2027-07", 5],
    ]);
  });

  it("pays a pending payout on the shares held before its ex-date, and applies withholding", () => {
    const { months } = dividendCalendar({
      positions: [{ symbol: "KO", shares: 30, marketValue: 1800 }],
      // 10 held before the Oct 1 ex-date, 20 bought after it.
      trades: [buy(10, "2026-01-05"), buy(20, "2026-10-05")],
      dividends: { KO: quarterly },
      today: TODAY,
      months: 4,
      withholding: 15,
    });
    expect(months[0]?.payments.map((payment) => [payment.shares, payment.cash])).toEqual([
      [10, 4.25],
    ]);
    expect(months[3]?.payments.map((payment) => [payment.shares, payment.cash])).toEqual([
      [30, 12.75],
    ]);
  });

  it("reports held stocks without dividend data instead of counting them as paying nothing", () => {
    const calendar = dividendCalendar({
      positions: [{ symbol: "KO", shares: 10, marketValue: 600 }],
      trades: [buy(10, "2026-01-05")],
      dividends: {},
      today: TODAY,
      months: 12,
      withholding: 0,
    });
    expect(calendar.unknown).toEqual(["KO"]);
    expect(calendar.months.every((month) => month.payments.length === 0)).toBe(true);
  });
});
