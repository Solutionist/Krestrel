import { describe, expect, it } from "vitest";

import {
  DIVIDEND_LOOKAHEAD_DAYS,
  DIVIDEND_LOOKBACK_DAYS,
  type DividendPayment,
  dividendInfo,
  dividendTally,
  sharesHeldBefore,
  upcomingDividend,
} from "./dividends";

const pay = (
  exDate: string,
  amount = 0.5,
  extra: Partial<DividendPayment> = {},
): DividendPayment => ({
  exDate,
  payDate: new Date(Date.parse(`${exDate}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10),
  amount,
  special: false,
  ...extra,
});

const quarterly = [
  pay("2025-11-14"),
  pay("2026-02-13"),
  pay("2026-05-15"),
  pay("2026-08-14", 0.53),
];

describe("dividendInfo", () => {
  it.each([
    ["monthly", ["2026-06-30", "2026-07-31", "2026-08-29", "2026-09-30"]],
    ["quarterly", ["2025-11-14", "2026-02-13", "2026-05-15", "2026-08-14"]],
    ["semiannual", ["2025-03-01", "2025-09-01", "2026-03-02", "2026-09-01"]],
    ["annual", ["2024-06-03", "2025-06-02", "2026-06-01"]],
  ])("tells a %s payer from the gaps between ex-dates", (frequency, days) => {
    expect(
      dividendInfo(
        days.map((day) => pay(day)),
        "2026-10-15",
      )?.frequency,
    ).toBe(frequency);
  });

  it("recognises a yearly payer on every day of the year from what the provider returns", () => {
    // Ex-date every June 1, paid a month later; the provider window is by pay date.
    const all = [2023, 2024, 2025, 2026, 2027].map((year) => ({
      exDate: `${year}-06-01`,
      payDate: `${year}-07-01`,
      amount: 1.1,
      special: false,
    }));
    const shift = (day: string, days: number) =>
      new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    for (let offset = 0; offset < 366; offset++) {
      const today = shift("2026-01-01", offset);
      const from = shift(today, -DIVIDEND_LOOKBACK_DAYS);
      const until = shift(today, DIVIDEND_LOOKAHEAD_DAYS);
      const returned = all.filter((payment) => payment.payDate >= from && payment.payDate <= until);
      const info = dividendInfo(returned, today);
      expect({ today, frequency: info?.frequency }).toEqual({ today, frequency: "annual" });
      expect(info?.next).not.toBeNull();
    }
  });

  it("takes the next payment the company announced", () => {
    const info = dividendInfo([...quarterly, pay("2026-11-13", 0.53)], "2026-10-15");
    expect(info?.next).toEqual({
      exDate: "2026-11-13",
      payDate: "2026-11-27",
      amount: 0.53,
      expected: false,
    });
    expect(info?.last.exDate).toBe("2026-08-14");
  });

  it("expects the next payment one usual gap after the last, at the latest amount", () => {
    const info = dividendInfo(quarterly, "2026-10-15");
    expect(info?.next).toMatchObject({ amount: 0.53, expected: true });
    // Median gap 91 days after Aug 14.
    expect(info?.next?.exDate).toBe("2026-11-13");
  });

  it("moves an overdue estimate forward until it is after today", () => {
    const info = dividendInfo(quarterly, "2026-12-01");
    expect(info?.next?.expected).toBe(true);
    expect(info?.next?.exDate && info.next.exDate > "2026-12-01").toBe(true);
  });

  it("ignores special one-off dividends for the schedule and the amounts", () => {
    const info = dividendInfo(
      [...quarterly, pay("2026-09-20", 5, { special: true })],
      "2026-10-15",
    );
    expect(info?.frequency).toBe("quarterly");
    expect(info?.last).toMatchObject({ exDate: "2026-08-14", amount: 0.53 });
  });

  it("reports no dividend when there is none, or the last one is over 15 months old", () => {
    expect(dividendInfo([], "2026-10-15")).toBeNull();
    expect(dividendInfo([pay("2025-06-02"), pay("2025-03-03")], "2026-10-15")).toBeNull();
  });

  it("calls a single payment irregular and does not guess a next date", () => {
    const info = dividendInfo([pay("2026-06-01")], "2026-10-15");
    expect(info).toMatchObject({ frequency: "irregular", next: null });
  });
});

describe("upcomingDividend", () => {
  it("is the payout still to come when the ex-date has passed but the pay date hasn't", () => {
    const info = dividendInfo([...quarterly.slice(0, 3), pay("2026-10-10", 0.53)], "2026-10-15");
    expect(info && upcomingDividend(info, "2026-10-15")).toMatchObject({
      exDate: "2026-10-10",
      payDate: "2026-10-24",
      pending: true,
      expected: false,
    });
  });

  it("is the next payment once the last one is paid", () => {
    const info = dividendInfo(quarterly, "2026-10-15");
    expect(info && upcomingDividend(info, "2026-10-15")).toMatchObject({
      exDate: "2026-11-13",
      pending: false,
    });
  });
});

describe("dividendTally", () => {
  const today = "2026-10-15";
  // Ex-date Oct 10 passed, paid Oct 24: pending. Next expected around Jan 9.
  const ko = dividendInfo([...quarterly.slice(0, 3), pay("2026-10-10", 0.53)], today);
  // Monthly, last ex Sep 30 paid Oct 14 (done); next expected about Oct 30.
  const o = dividendInfo(
    ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"].map((day) => pay(day, 0.27)),
    today,
  );
  const buy = (symbol: string, shares: number, tradedOn: string) =>
    ({ symbol, side: "buy", shares, tradedOn }) as const;
  const sell = (symbol: string, shares: number, tradedOn: string) =>
    ({ symbol, side: "sell", shares, tradedOn }) as const;

  it("pays a passed ex-date only on shares held before it; later buys wait for the next one", () => {
    const tally = dividendTally({
      positions: [{ symbol: "KO", shares: 15, marketValue: 900 }],
      trades: [buy("KO", 10, "2026-09-01"), buy("KO", 5, "2026-10-12")],
      dividends: { KO: ko },
      today,
      horizonDays: 90,
    });
    expect(tally.payments[0]).toMatchObject({ symbol: "KO", payDate: "2026-10-24", shares: 10 });
    expect(tally.payments[0]?.cash).toBeCloseTo(5.3);
    expect(tally.nextBySymbol.KO).toMatchObject({ pending: true, shares: 10 });
    // The yearly rate is on the shares held now.
    expect(tally.yearly).toBeCloseTo(15 * 0.53 * 4);
  });

  it("skips a pending payout bought after its ex-date and shows the next payment instead", () => {
    const tally = dividendTally({
      positions: [{ symbol: "KO", shares: 10, marketValue: 600 }],
      trades: [buy("KO", 10, "2026-10-12")],
      dividends: { KO: ko },
      today,
      horizonDays: 90,
    });
    expect(tally.payments.every((payment) => !payment.pending)).toBe(true);
    expect(tally.nextBySymbol.KO).toMatchObject({ pending: false, expected: true, shares: 10 });
  });

  it("still collects a pending payout after selling, but adds nothing to the yearly rate", () => {
    const tally = dividendTally({
      positions: [{ symbol: "KO", shares: 0, marketValue: 0 }],
      trades: [buy("KO", 10, "2026-09-01"), sell("KO", 10, "2026-10-12")],
      dividends: { KO: ko },
      today,
      horizonDays: 90,
    });
    expect(tally.payments).toHaveLength(1);
    expect(tally.payments[0]).toMatchObject({ pending: true, shares: 10 });
    expect(tally.yearly).toBe(0);
  });

  it("lists every payment in the horizon by pay date across stocks, projecting monthly payers", () => {
    const tally = dividendTally({
      positions: [
        { symbol: "KO", shares: 10, marketValue: 600 },
        { symbol: "O", shares: 100, marketValue: 5_500 },
      ],
      trades: [buy("KO", 10, "2026-09-01"), buy("O", 100, "2026-01-02")],
      dividends: { KO: ko, O: o, NVDA: null },
      today,
      // Until Jan 18: O pays about Nov 14, Dec 14 and Jan 14; KO's next (Jan 23) falls outside.
      horizonDays: 95,
    });
    expect(tally.payments.map((payment) => payment.symbol)).toEqual(["KO", "O", "O", "O"]);
    const dates = tally.payments.map((payment) => payment.payDate ?? payment.exDate);
    expect([...dates].sort()).toEqual(dates);
    expect(tally.yearly).toBeCloseTo(10 * 0.53 * 4 + 100 * 0.27 * 12);
  });

  it("counts only priced holdings toward the income yields are based on", () => {
    // O has no live price, so the value and cost totals leave it out: its income must not
    // inflate the yield (it did: $340 on KO's $600 value read as 56.7%).
    const tally = dividendTally({
      positions: [
        { symbol: "KO", shares: 10, marketValue: 600 },
        { symbol: "O", shares: 100, marketValue: null },
      ],
      trades: [],
      dividends: { KO: ko, O: o },
      today,
      horizonDays: 90,
    });
    expect(tally.yearly).toBeCloseTo(10 * 0.53 * 4 + 100 * 0.27 * 12);
    expect(tally.pricedYearly).toBeCloseTo(10 * 0.53 * 4);
  });

  it("reports held stocks without dividend data as unknown, not as paying nothing", () => {
    // The provider failed for AAPL (missing), NVDA pays no dividend (null), MSFT is closed.
    const tally = dividendTally({
      positions: [
        { symbol: "AAPL", shares: 10, marketValue: 2_000 },
        { symbol: "NVDA", shares: 5, marketValue: 1_000 },
        { symbol: "MSFT", shares: 0, marketValue: 0 },
      ],
      trades: [],
      dividends: { NVDA: null },
      today,
      horizonDays: 90,
    });
    expect(tally.unknown).toEqual(["AAPL"]);
    expect(tally.yearly).toBe(0);
  });
});

describe("sharesHeldBefore", () => {
  it("counts buys and sells dated before the ex-date only", () => {
    const trades = [
      { symbol: "KO", side: "buy", shares: 10, tradedOn: "2026-09-01" },
      { symbol: "KO", side: "sell", shares: 4, tradedOn: "2026-09-20" },
      { symbol: "KO", side: "buy", shares: 7, tradedOn: "2026-10-10" },
      { symbol: "O", side: "buy", shares: 99, tradedOn: "2026-01-01" },
    ] as const;
    expect(sharesHeldBefore(trades, "KO", "2026-10-10")).toBe(6);
    expect(sharesHeldBefore(trades, "KO", "2026-10-11")).toBe(13);
  });
});
