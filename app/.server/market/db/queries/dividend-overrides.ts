import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DividendOverride, DividendOverrideKey } from "~/lib/dividends-received";

import type { Database } from "../client";
import { dividendOverrides, portfolios } from "../schema";

/** The owner's corrections of dividends received (ADR 0025) in these portfolios. */
export async function listDividendOverrides(
  db: Database,
  portfolioIds: readonly string[],
): Promise<DividendOverride[]> {
  if (portfolioIds.length === 0) return [];
  return db
    .select({
      portfolioId: dividendOverrides.portfolioId,
      symbol: dividendOverrides.symbol,
      exDate: dividendOverrides.exDate,
      amount: dividendOverrides.amount,
    })
    .from(dividendOverrides)
    .where(inArray(dividendOverrides.portfolioId, [...portfolioIds]))
    .orderBy(asc(dividendOverrides.exDate), asc(dividendOverrides.symbol));
}

/**
 * Saves the cash the owner actually received for one payout, replacing an earlier entry. Returns
 * false when the portfolio doesn't exist.
 */
export function setDividendOverride(db: Database, override: DividendOverride): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Locks the portfolio row so a concurrent delete can't slip in before the insert.
    const [portfolio] = await tx
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.id, override.portfolioId))
      .for("share");
    if (!portfolio) return false;
    await tx
      .insert(dividendOverrides)
      .values({
        portfolioId: override.portfolioId,
        symbol: override.symbol,
        exDate: override.exDate,
        amount: override.amount,
      })
      .onConflictDoUpdate({
        target: [dividendOverrides.portfolioId, dividendOverrides.symbol, dividendOverrides.exDate],
        set: { amount: override.amount, updatedAt: sql`now()` },
      });
    return true;
  });
}

/** Removes the owner's entry, so the payout is worked out again. False when there was none. */
export async function clearDividendOverride(
  db: Database,
  key: DividendOverrideKey,
): Promise<boolean> {
  const removed = await db
    .delete(dividendOverrides)
    .where(
      and(
        eq(dividendOverrides.portfolioId, key.portfolioId),
        eq(dividendOverrides.symbol, key.symbol),
        eq(dividendOverrides.exDate, key.exDate),
      ),
    )
    .returning({ symbol: dividendOverrides.symbol });
  return removed.length > 0;
}
