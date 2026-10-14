// Portfolio maths (isomorphic). Amounts are USD; display conversion happens at the edge (ADR 0013).

import * as z from "zod";

import { type QuoteSnapshot, SymbolSchema } from "./market";

export const TRADE_SIDES = ["buy", "sell"] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

/** Share quantities are stored with 6 decimals; anything smaller is rounding noise. */
const SHARE_EPSILON = 1e-6;

export interface Trade {
  id: string;
  portfolioId: string;
  symbol: string;
  side: TradeSide;
  shares: number;
  /** Per share, USD. */
  price: number;
  /** Total commission/fees for the trade, USD. */
  fee: number;
  /** Trade date, YYYY-MM-DD (New York). */
  tradedOn: string;
  /** ISO timestamp; orders trades entered for the same day and side. */
  createdAt: string;
}

/** Input for a new or edited trade (validated by the API and the trade form). */
export const TradeInputSchema = z.object({
  symbol: SymbolSchema,
  side: z.enum(TRADE_SIDES),
  shares: z.coerce.number().positive({ error: "Shares must be more than 0" }).max(1e9),
  price: z.coerce.number().nonnegative({ error: "Price can't be negative" }).max(1e9),
  fee: z.coerce.number().nonnegative({ error: "Fee can't be negative" }).max(1e9).default(0),
  tradedOn: z.iso.date({ error: "Pick the trade date" }),
});
export type TradeInput = z.infer<typeof TradeInputSchema>;

export const PortfolioNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Name the portfolio" })
  .max(40, { error: "Keep the name under 40 characters" });

/** POST /api/portfolios result. `warning`: saved, but something needs the owner's attention. */
export type PortfolioActionResult =
  | { ok: true; portfolioId?: string; warning?: string }
  | { ok: false; error: { code: string; message: string } };

export interface Position {
  symbol: string;
  /** Shares held now (0 once fully sold). */
  shares: number;
  /** Remaining cost of the shares held, fees included, USD. */
  costBasis: number;
  /** Cost per held share, USD; null when nothing is held. */
  averageCost: number | null;
  /** Profit/loss locked in by sells (average-cost method, fees included), USD. */
  realized: number;
}

/** A sell of more shares than were held at that point in time. */
export interface Oversell {
  symbol: string;
  tradedOn: string;
  held: number;
  selling: number;
}

export type PositionsResult =
  | { ok: true; positions: Position[] }
  | { ok: false; oversell: Oversell };

/**
 * Replay order: trade date, then buys before sells on the same day (so entering a day's trades in
 * any order works), then entry order.
 */
function replayOrder(a: Trade, b: Trade): number {
  if (a.tradedOn !== b.tradedOn) return a.tradedOn < b.tradedOn ? -1 : 1;
  if (a.side !== b.side) return a.side === "buy" ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Derives positions from one portfolio's trades with the average-cost method: buys add shares and
 * cost (price × shares + fee); a sell realizes proceeds − fee − shares × average cost and removes
 * that much cost. Fails on the first sell exceeding the shares held at that date.
 */
export function computePositions(trades: readonly Trade[]): PositionsResult {
  const bySymbol = new Map<string, Position>();
  for (const trade of [...trades].sort(replayOrder)) {
    const position = bySymbol.get(trade.symbol) ?? {
      symbol: trade.symbol,
      shares: 0,
      costBasis: 0,
      averageCost: null,
      realized: 0,
    };
    if (trade.side === "buy") {
      position.shares += trade.shares;
      position.costBasis += trade.shares * trade.price + trade.fee;
    } else {
      if (trade.shares > position.shares + SHARE_EPSILON) {
        return {
          ok: false,
          oversell: {
            symbol: trade.symbol,
            tradedOn: trade.tradedOn,
            held: position.shares,
            selling: trade.shares,
          },
        };
      }
      const averageCost = position.shares > 0 ? position.costBasis / position.shares : 0;
      position.realized += trade.shares * (trade.price - averageCost) - trade.fee;
      position.shares -= trade.shares;
      position.costBasis -= trade.shares * averageCost;
      if (position.shares < SHARE_EPSILON) {
        position.shares = 0;
        position.costBasis = 0;
      }
    }
    position.averageCost = position.shares > 0 ? position.costBasis / position.shares : null;
    bySymbol.set(trade.symbol, position);
  }
  return { ok: true, positions: [...bySymbol.values()] };
}

/** Combines positions from several portfolios (each computed on its own) by symbol. */
export function mergePositions(lists: readonly (readonly Position[])[]): Position[] {
  const bySymbol = new Map<string, Position>();
  for (const position of lists.flat()) {
    const merged = bySymbol.get(position.symbol);
    if (!merged) {
      bySymbol.set(position.symbol, { ...position });
      continue;
    }
    merged.shares += position.shares;
    merged.costBasis += position.costBasis;
    merged.realized += position.realized;
    merged.averageCost = merged.shares > 0 ? merged.costBasis / merged.shares : null;
  }
  return [...bySymbol.values()];
}

export interface ValuedPosition extends Position {
  lastPrice: number | null;
  /** Shares × last price, USD; null without a price. */
  marketValue: number | null;
  /** Market value − cost basis, USD. */
  unrealized: number | null;
  /** Unrealized as a fraction of cost basis. */
  unrealizedFraction: number | null;
  /** Shares × (last − previous close), USD: today's move on the shares held now. */
  dayChange: number | null;
}

export function valuePosition(
  position: Position,
  quote: QuoteSnapshot | undefined,
): ValuedPosition {
  const last = quote?.lastPrice ?? null;
  const previousClose = quote?.previousClose ?? null;
  const held = position.shares > 0;
  const marketValue = held && last !== null ? position.shares * last : held ? null : 0;
  const unrealized = marketValue === null ? null : marketValue - position.costBasis;
  return {
    ...position,
    lastPrice: last,
    marketValue,
    unrealized,
    unrealizedFraction:
      unrealized !== null && position.costBasis > 0 ? unrealized / position.costBasis : null,
    dayChange: !held
      ? 0
      : last !== null && previousClose !== null
        ? position.shares * (last - previousClose)
        : null,
  };
}

export interface PortfolioTotals {
  marketValue: number;
  costBasis: number;
  unrealized: number;
  unrealizedFraction: number | null;
  realized: number;
  dayChange: number;
  /** Day change as a fraction of the value at the previous close. */
  dayChangeFraction: number | null;
  /** Open positions left out of the value/P&L totals because they have no price yet. */
  unpriced: string[];
}

export function portfolioTotals(positions: readonly ValuedPosition[]): PortfolioTotals {
  let marketValue = 0;
  let costBasis = 0;
  let realized = 0;
  let dayChange = 0;
  const unpriced: string[] = [];
  for (const position of positions) {
    realized += position.realized;
    if (position.marketValue === null) {
      unpriced.push(position.symbol);
      continue;
    }
    marketValue += position.marketValue;
    costBasis += position.costBasis;
    dayChange += position.dayChange ?? 0;
  }
  const unrealized = marketValue - costBasis;
  const previousValue = marketValue - dayChange;
  return {
    marketValue,
    costBasis,
    unrealized,
    unrealizedFraction: costBasis > 0 ? unrealized / costBasis : null,
    realized,
    dayChange,
    dayChangeFraction: previousValue > 0 ? dayChange / previousValue : null,
    unpriced,
  };
}
