// Target allocation and rebalance suggestions (ADR 0026). Isomorphic and pure; amounts in USD.
// Suggestions only: Krestrel never places orders.

import * as z from "zod";

import { SymbolSchema } from "./market";
import type { ValuedPosition } from "./portfolio";

/** More targets than a portfolio could sensibly hold; keeps requests small. */
export const MAX_TARGETS = 100;

/** Targets may add up to a hair over 100% (rounded percentages); the 1e-9 absorbs float noise. */
export const MAX_TARGET_TOTAL = 100.01 + 1e-9;

export const TargetWeightSchema = z.object({
  symbol: SymbolSchema,
  /** Percent of the portfolio, 0.01–100, kept to 4 decimals like the database. */
  weight: z.coerce
    .number({ error: "Enter a target percentage" })
    .min(0.01, { error: "Targets must be at least 0.01%" })
    .max(100, { error: "A target can't be more than 100%" })
    .transform((weight) => Math.round(weight * 10_000) / 10_000),
});
export type TargetWeight = z.infer<typeof TargetWeightSchema>;

/** A portfolio's whole set of targets: one per symbol, adding up to 100% or less. */
export const TargetsSchema = z
  .array(TargetWeightSchema)
  .max(MAX_TARGETS, { error: `Keep it to ${MAX_TARGETS} targets or fewer` })
  .superRefine((targets, ctx) => {
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target.symbol)) {
        ctx.addIssue({ code: "custom", message: `${target.symbol} is listed twice` });
        return;
      }
      seen.add(target.symbol);
    }
    const total = targets.reduce((sum, target) => sum + target.weight, 0);
    if (total > MAX_TARGET_TOTAL) {
      ctx.addIssue({
        code: "custom",
        message: `Targets add up to ${total.toFixed(2)}%. Keep the total at 100% or less.`,
      });
    }
  });

/** POST /api/portfolio-targets body: replaces all of a portfolio's targets. */
export const SaveTargetsSchema = z.object({ portfolioId: z.uuid(), targets: TargetsSchema });

/** GET and POST /api/portfolio-targets result. */
export const PortfolioTargetsResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    portfolioId: z.string(),
    targets: z.array(z.object({ symbol: z.string(), weight: z.number() })),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type PortfolioTargetsResponse = z.infer<typeof PortfolioTargetsResponseSchema>;

export const REBALANCE_MODES = ["buy-only", "buy-and-sell"] as const;
/** `buy-only` spends new cash on what's under target and never sells; `buy-and-sell` sells too. */
export type RebalanceMode = (typeof REBALANCE_MODES)[number];

export interface RebalanceRow {
  symbol: string;
  /** Last price, USD; null when unknown (a target not held and not priced). */
  price: number | null;
  /** Shares held now. */
  shares: number;
  /** Market value now, USD. */
  value: number;
  /** Share of the priced holdings now, percent (new cash not included). */
  currentPercent: number;
  /** 0 for a holding without a target. */
  targetPercent: number;
  /** current − target, percentage points: positive = over target. */
  drift: number;
  /** USD to trade: positive buys, negative sells, 0 holds. */
  trade: number;
  /** Exact shares to trade (sign as `trade`); null without a price. */
  tradeShares: number | null;
  /**
   * Whole shares to trade: buys round down, sells round up but never past the shares held, so
   * the whole-share sells always cover the whole-share buys. null without a price.
   */
  wholeShares: number | null;
  /** Share of the total (holdings + new cash) after the trade, percent. */
  resultPercent: number;
  targeted: boolean;
}

export interface RebalancePlan {
  rows: RebalanceRow[];
  /** Priced holdings + new cash, USD. */
  total: number;
  cash: {
    /** New cash added, USD. */
    added: number;
    /** The part of the total no target claims, percent. */
    targetPercent: number;
    /** USD left uninvested after the trades. */
    left: number;
    resultPercent: number;
  };
  /** Total to buy and to sell, USD (both ≥ 0). */
  bought: number;
  sold: number;
  /** Held stocks without a live price: left out, and so are their targets. */
  unpriced: string[];
}

export interface RebalanceInput {
  positions: readonly Pick<ValuedPosition, "symbol" | "shares" | "lastPrice">[];
  targets: readonly TargetWeight[];
  /** New cash to invest, USD (≥ 0). */
  cash: number;
  mode: RebalanceMode;
  /** Last price of a target not among `positions` (not held yet); null when unknown. */
  priceOf?: (symbol: string) => number | null;
}

/** Trades under a cent are noise from floating-point maths: hold. */
const MIN_TRADE = 0.005;
/** Shares are stored with 6 decimals. */
const SHARE_DECIMALS = 1e6;
const EPSILON = 1e-9;

interface Holding {
  symbol: string;
  price: number | null;
  shares: number;
  value: number;
  /** Target value after the trades, USD. */
  goal: number;
  targetPercent: number;
  targeted: boolean;
}

/**
 * Buy-only: brings the most underweight holdings up first. Each one below target ends at the
 * same fraction `level` of its target value, chosen so the buys spend exactly `cash`
 * (water-filling); a holding already above that level gets nothing.
 */
function spreadCash(holdings: readonly Holding[], cash: number): Map<string, number> {
  const buys = new Map<string, number>();
  const short = holdings.filter((holding) => holding.goal - holding.value > EPSILON);
  const needed = short.reduce((sum, holding) => sum + holding.goal - holding.value, 0);
  if (needed <= cash) {
    for (const holding of short) buys.set(holding.symbol, holding.goal - holding.value);
    return buys;
  }
  const sorted = short.sort((a, b) => a.value / a.goal - b.value / b.goal);
  let value = 0;
  let goal = 0;
  let level = 0;
  let count = 0;
  for (const holding of sorted) {
    value += holding.value;
    goal += holding.goal;
    count += 1;
    level = (cash + value) / goal;
    const next = sorted[count];
    if (!next || level <= next.value / next.goal) break;
  }
  for (const holding of sorted.slice(0, count)) {
    buys.set(holding.symbol, Math.max(0, level * holding.goal - holding.value));
  }
  return buys;
}

/**
 * What to buy (and, in buy-and-sell mode, sell) to move a portfolio toward its targets.
 * Percentages are of the priced holdings plus the new cash; targets adding up to less than 100%
 * leave the rest as cash. Holdings without a target count as target 0: sold in buy-and-sell
 * mode, left alone in buy-only mode. Held stocks without a live price are left out.
 */
export function planRebalance({
  positions,
  targets,
  cash,
  mode,
  priceOf,
}: RebalanceInput): RebalancePlan {
  const added = Math.max(0, cash);
  const weights = new Map(targets.map((target) => [target.symbol, target.weight]));
  const unpriced: string[] = [];
  const holdings: Holding[] = [];
  const seen = new Set<string>();
  for (const position of positions) {
    seen.add(position.symbol);
    const held = position.shares > EPSILON;
    if (held && position.lastPrice === null) {
      unpriced.push(position.symbol);
      continue;
    }
    const targetPercent = weights.get(position.symbol) ?? 0;
    if (!held && targetPercent === 0) continue;
    holdings.push({
      symbol: position.symbol,
      price: position.lastPrice,
      shares: held ? position.shares : 0,
      value: held && position.lastPrice !== null ? position.shares * position.lastPrice : 0,
      goal: 0,
      targetPercent,
      targeted: targetPercent > 0,
    });
  }
  for (const target of targets) {
    if (seen.has(target.symbol)) continue;
    holdings.push({
      symbol: target.symbol,
      price: priceOf?.(target.symbol) ?? null,
      shares: 0,
      value: 0,
      goal: 0,
      targetPercent: target.weight,
      targeted: true,
    });
  }

  const invested = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const total = invested + added;
  const claimed = holdings.reduce((sum, holding) => sum + holding.targetPercent, 0);
  // Targets may add up to a hair over 100%: scale them down so the plan never spends money
  // that isn't there.
  const scale = claimed > 100 ? 100 / claimed : 1;
  for (const holding of holdings) holding.goal = (holding.targetPercent / 100) * scale * total;

  const trades =
    mode === "buy-only"
      ? spreadCash(holdings, added)
      : new Map(holdings.map((holding) => [holding.symbol, holding.goal - holding.value]));

  let bought = 0;
  let sold = 0;
  const rows = holdings.map((holding): RebalanceRow => {
    const raw = trades.get(holding.symbol) ?? 0;
    const trade = Math.abs(raw) < MIN_TRADE ? 0 : raw;
    if (trade > 0) bought += trade;
    else sold -= trade;
    const { price } = holding;
    let tradeShares: number | null = null;
    let wholeShares: number | null = null;
    if (price !== null && price > 0) {
      // Selling everything (target 0) sells exactly the shares held, never a rounding more.
      const exact = Math.max(-holding.shares, trade / price);
      tradeShares = Math.round(exact * SHARE_DECIMALS) / SHARE_DECIMALS;
      wholeShares =
        exact >= 0
          ? Math.floor(exact + EPSILON)
          : -Math.min(holding.shares, Math.ceil(-exact - EPSILON));
    } else if (trade === 0) {
      tradeShares = 0;
      wholeShares = 0;
    }
    const currentPercent = invested > 0 ? (holding.value / invested) * 100 : 0;
    return {
      symbol: holding.symbol,
      price,
      shares: holding.shares,
      value: holding.value,
      currentPercent,
      targetPercent: holding.targetPercent,
      drift: currentPercent - holding.targetPercent,
      trade,
      tradeShares,
      wholeShares,
      resultPercent: total > 0 ? ((holding.value + trade) / total) * 100 : 0,
      targeted: holding.targeted,
    };
  });
  rows.sort(
    (a, b) =>
      b.targetPercent - a.targetPercent || b.value - a.value || a.symbol.localeCompare(b.symbol),
  );

  const left = Math.max(0, added + sold - bought);
  return {
    rows,
    total,
    cash: {
      added,
      targetPercent: Math.max(0, 100 - claimed),
      left,
      resultPercent: total > 0 ? (left / total) * 100 : 0,
    },
    bought,
    sold,
    unpriced,
  };
}

/**
 * Today's weights of the priced holdings as targets, in hundredths of a percent adding up to
 * exactly 100% (largest remainder). Holdings too small to reach 0.01% are left out.
 */
export function currentWeights(
  positions: readonly Pick<ValuedPosition, "symbol" | "shares" | "marketValue">[],
): TargetWeight[] {
  const priced = positions.filter(
    (position) =>
      position.shares > EPSILON && position.marketValue !== null && position.marketValue > 0,
  );
  const total = priced.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  if (total <= 0) return [];
  const units = priced.map((position) => {
    const exact = ((position.marketValue ?? 0) / total) * 10_000;
    return {
      symbol: position.symbol,
      units: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let spare = 10_000 - units.reduce((sum, unit) => sum + unit.units, 0);
  for (const unit of units.sort((a, b) => b.remainder - a.remainder)) {
    if (spare <= 0) break;
    unit.units += 1;
    spare -= 1;
  }
  return units
    .filter((unit) => unit.units > 0)
    .map((unit) => ({ symbol: unit.symbol, weight: unit.units / 100 }))
    .sort((a, b) => b.weight - a.weight || a.symbol.localeCompare(b.symbol));
}
