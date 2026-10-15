// Sector and type (growth / dividend / risky) per ticker, for grouping holdings (ADR 0019). The
// owner's local Ollama model fills them in; the owner can correct any of them. Shared by server
// and page.

import * as z from "zod";

import { IDEA_CATEGORIES, IDEA_CATEGORY_LABELS, type IdeaCategory, SECTOR_SHORT, SECTORS, type Sector } from "./ideas";
import { SymbolSchema } from "./market";
import type { ValuedPosition } from "./portfolio";

export interface StockProfile {
  symbol: string;
  /** GICS sector; null for funds/ETFs or when unknown. */
  sector: Sector | null;
  style: IdeaCategory | null;
  /** `owner`: corrected by hand; the model never overwrites it. */
  source: "model" | "owner";
}

export const HOLDINGS_GROUPINGS = ["none", "sector", "style"] as const;
export type HoldingsGrouping = (typeof HOLDINGS_GROUPINGS)[number];

export const GROUPING_LABELS: Record<HoldingsGrouping, string> = {
  none: "None",
  sector: "Sector",
  style: "Type",
};

/** Most tickers one classification request may cover. */
export const MAX_CLASSIFY_SYMBOLS = 100;

/** POST /api/stock-profiles body. */
export const StockProfileActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("classify"),
    symbols: z.array(SymbolSchema).min(1).max(MAX_CLASSIFY_SYMBOLS),
  }),
  z.object({
    intent: z.literal("set"),
    symbol: SymbolSchema,
    sector: z.enum(SECTORS).nullable(),
    style: z.enum(IDEA_CATEGORIES).nullable(),
  }),
]);

export type StockProfileResult =
  | { ok: true; profiles: StockProfile[] }
  | { ok: false; error: { code: string; message: string } };

export interface HoldingGroup {
  /** Sector or style; null: not classified (or a fund, for sectors). */
  key: string | null;
  label: string;
  positions: ValuedPosition[];
  /** Market value of the priced positions, USD. */
  marketValue: number;
  /** Share of all priced open positions' value, 0–1. */
  weight: number;
}

/** Display name of a group key. */
export function groupLabel(grouping: Exclude<HoldingsGrouping, "none">, key: string | null): string {
  if (key === null) return grouping === "sector" ? "Funds & unclassified" : "Unclassified";
  return grouping === "sector" ? SECTOR_SHORT[key as Sector] : IDEA_CATEGORY_LABELS[key as IdeaCategory].name;
}

/**
 * Open positions grouped by sector or style, largest group (by value) first, the unclassified
 * group last. Positions keep their given order within a group.
 */
export function groupHoldings(
  positions: readonly ValuedPosition[],
  profiles: Readonly<Record<string, StockProfile>>,
  grouping: Exclude<HoldingsGrouping, "none">,
): HoldingGroup[] {
  const byKey = new Map<string | null, ValuedPosition[]>();
  for (const position of positions) {
    const key = profiles[position.symbol]?.[grouping] ?? null;
    byKey.set(key, [...(byKey.get(key) ?? []), position]);
  }
  const total = positions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  return [...byKey]
    .map(([key, members]) => {
      const marketValue = members.reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
      return {
        key,
        label: groupLabel(grouping, key),
        positions: members,
        marketValue,
        weight: total > 0 ? marketValue / total : 0,
      };
    })
    .sort((a, b) =>
      a.key === null ? 1 : b.key === null ? -1 : b.marketValue - a.marketValue,
    );
}
