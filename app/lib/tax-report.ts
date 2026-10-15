// Yearly realized P/L and dividend income for the owner's records (ADR 0027). Trades are replayed
// with the same average-cost method as the holdings (ADR 0013), once in USD and once in the
// display currency with each amount converted at its own date's rate. Not tax advice.

import { BASE_CURRENCY } from "./currency";
import type { ReceivedDividend } from "./dividends-received";
import { replayOrder, SHARE_EPSILON, type Trade } from "./portfolio";

/**
 * One sell, in USD and in the report currency (converted at the sell date's rate). The
 * report-currency fields are null when there is no rate for the sell date or for one of the buys
 * it sells from (a gap in the ECB's publication): never a stale rate.
 */
export interface TaxSell {
  /** The sell trade's id. */
  id: string;
  portfolioId: string;
  symbol: string;
  tradedOn: string;
  shares: number;
  /** Shares × price − fee, USD. */
  proceedsUsd: number;
  /** Shares × the USD average cost when sold (buy fees included), USD. */
  costUsd: number;
  gainUsd: number;
  /** Report-currency units per 1 USD on the sell date (1 for USD); null when there is none. */
  rate: number | null;
  /** Proceeds at the sell date's rate. */
  proceeds: number | null;
  /** Shares × the average cost in the report currency, each buy at its own date's rate. */
  cost: number | null;
  gain: number | null;
  /**
   * The part of `gain` that comes from the exchange rate moving between buying and selling:
   * `gain − gainUsd × rate`. Positive when the dollar strengthened against the report currency.
   */
  currencyEffect: number | null;
}

/** One calendar year (New York dates): sells by trade date, dividends by pay date. */
export interface TaxYear {
  year: string;
  sells: number;
  /** Report currency; sells and dividends without a rate are left out (see `unconverted`). */
  proceeds: number;
  cost: number;
  realized: number;
  realizedUsd: number;
  currencyEffect: number;
  /** Report currency at each pay date's rate; null while the received dividends are loading. */
  dividends: number | null;
  dividendsUsd: number | null;
  /** Realized + dividends, report currency; null while the dividends are loading. */
  total: number | null;
  /** Sells and dividends with no report-currency rate, left out of the report-currency sums. */
  unconverted: number;
}

export interface TaxReport {
  /** Newest year first; every year with a sell or a dividend. */
  years: TaxYear[];
  /** Every sell, oldest first. */
  sells: TaxSell[];
}

interface Holding {
  shares: number;
  costUsd: number;
  /** null once a buy had no rate: the report-currency cost is unknown until the next full sell. */
  cost: number | null;
}

/**
 * Builds the yearly report. `rateOn(day)` gives report-currency units per 1 USD for a day, or null
 * when there is none; pass `() => 1` for USD. `received` undefined (still loading) leaves the
 * dividend columns null. Positions are kept per portfolio and stock, like `computePositions`, so
 * the USD realized total equals the holdings' realized P/L.
 */
export function taxReport(input: {
  trades: readonly Trade[];
  received: readonly ReceivedDividend[] | undefined;
  rateOn: (day: string) => number | null;
}): TaxReport {
  const { trades, received, rateOn } = input;
  const holdings = new Map<string, Holding>();
  const sells: TaxSell[] = [];
  for (const trade of [...trades].sort(replayOrder)) {
    const key = `${trade.portfolioId}:${trade.symbol}`;
    const holding = holdings.get(key) ?? { shares: 0, costUsd: 0, cost: 0 };
    holdings.set(key, holding);
    const rate = rateOn(trade.tradedOn);
    if (trade.side === "buy") {
      const costUsd = trade.shares * trade.price + trade.fee;
      holding.shares += trade.shares;
      holding.costUsd += costUsd;
      holding.cost = holding.cost === null || rate === null ? null : holding.cost + costUsd * rate;
      continue;
    }
    const fraction = holding.shares > 0 ? Math.min(trade.shares / holding.shares, 1) : 0;
    const proceedsUsd = trade.shares * trade.price - trade.fee;
    // Same as computePositions: shares × (costBasis / shares held).
    const costUsd = holding.shares > 0 ? trade.shares * (holding.costUsd / holding.shares) : 0;
    const cost = holding.cost === null ? null : holding.cost * fraction;
    const proceeds = rate === null ? null : proceedsUsd * rate;
    const gainUsd = proceedsUsd - costUsd;
    const gain = proceeds === null || cost === null ? null : proceeds - cost;
    sells.push({
      id: trade.id,
      portfolioId: trade.portfolioId,
      symbol: trade.symbol,
      tradedOn: trade.tradedOn,
      shares: trade.shares,
      proceedsUsd,
      costUsd,
      gainUsd,
      rate,
      proceeds: gain === null ? null : proceeds,
      cost: gain === null ? null : cost,
      gain,
      currencyEffect: gain === null || rate === null ? null : gain - gainUsd * rate,
    });
    holding.shares -= trade.shares;
    holding.costUsd -= costUsd;
    if (holding.cost !== null && cost !== null) holding.cost -= cost;
    if (holding.shares < SHARE_EPSILON) {
      holding.shares = 0;
      holding.costUsd = 0;
      holding.cost = 0;
    }
  }

  const years = new Map<string, TaxYear>();
  const yearOf = (day: string): TaxYear => {
    const year = day.slice(0, 4);
    let entry = years.get(year);
    if (!entry) {
      entry = {
        year,
        sells: 0,
        proceeds: 0,
        cost: 0,
        realized: 0,
        realizedUsd: 0,
        currencyEffect: 0,
        dividends: received ? 0 : null,
        dividendsUsd: received ? 0 : null,
        total: null,
        unconverted: 0,
      };
      years.set(year, entry);
    }
    return entry;
  };
  for (const sell of sells) {
    const year = yearOf(sell.tradedOn);
    year.sells += 1;
    year.realizedUsd += sell.gainUsd;
    if (sell.gain === null) {
      year.unconverted += 1;
      continue;
    }
    year.proceeds += sell.proceeds ?? 0;
    year.cost += sell.cost ?? 0;
    year.realized += sell.gain;
    year.currencyEffect += sell.currencyEffect ?? 0;
  }
  for (const payout of received ?? []) {
    const day = payout.payDate ?? payout.exDate;
    const year = yearOf(day);
    const rate = rateOn(day);
    if (rate === null) year.unconverted += 1;
    else year.dividends = (year.dividends ?? 0) + payout.cash * rate;
    year.dividendsUsd = (year.dividendsUsd ?? 0) + payout.cash;
  }
  for (const year of years.values()) {
    year.total = year.dividends === null ? null : year.realized + year.dividends;
  }
  return {
    years: [...years.values()].sort((a, b) => (a.year < b.year ? 1 : -1)),
    sells,
  };
}

/**
 * The sells as CSV for a spreadsheet: USD columns, plus the rate and report-currency columns
 * when the report currency isn't USD (empty when the sell has no rate). Plain numbers (no symbols
 * or separators), CRLF lines.
 */
export function taxSellsCsv(sells: readonly TaxSell[], currency: string): string {
  const local = currency !== BASE_CURRENCY;
  const header = [
    "Date",
    "Stock",
    "Shares",
    "Proceeds USD",
    "Cost USD",
    "Gain USD",
    ...(local
      ? [`Rate ${currency} per USD`, `Proceeds ${currency}`, `Cost ${currency}`, `Gain ${currency}`]
      : []),
  ];
  const rows = sells.map((sell) => [
    sell.tradedOn,
    sell.symbol,
    String(sell.shares),
    sell.proceedsUsd.toFixed(2),
    sell.costUsd.toFixed(2),
    sell.gainUsd.toFixed(2),
    ...(local
      ? [
          sell.rate === null ? "" : String(sell.rate),
          sell.proceeds?.toFixed(2) ?? "",
          sell.cost?.toFixed(2) ?? "",
          sell.gain?.toFixed(2) ?? "",
        ]
      : []),
  ]);
  return `${[header, ...rows].map((row) => row.join(",")).join("\r\n")}\r\n`;
}
