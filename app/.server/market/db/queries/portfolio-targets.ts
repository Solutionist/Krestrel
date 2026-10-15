import { asc, desc, eq } from "drizzle-orm";

import type { TargetWeight } from "~/lib/rebalance";

import type { Database } from "../client";
import { portfolios, portfolioTargets } from "../schema";

/** A portfolio's target weights (percent), largest first; empty when none are set. */
export function listTargets(db: Database, portfolioId: string): Promise<TargetWeight[]> {
  return db
    .select({ symbol: portfolioTargets.symbol, weight: portfolioTargets.weight })
    .from(portfolioTargets)
    .where(eq(portfolioTargets.portfolioId, portfolioId))
    .orderBy(desc(portfolioTargets.weight), asc(portfolioTargets.symbol));
}

/**
 * Replaces all of a portfolio's targets in one transaction (an empty list clears them). The
 * portfolio row is locked, so concurrent saves apply one after the other. Returns false when
 * the portfolio doesn't exist.
 */
export function replaceTargets(
  db: Database,
  portfolioId: string,
  targets: readonly TargetWeight[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.id, portfolioId))
      .for("update");
    if (found.length === 0) return false;
    await tx.delete(portfolioTargets).where(eq(portfolioTargets.portfolioId, portfolioId));
    if (targets.length > 0) {
      await tx
        .insert(portfolioTargets)
        .values(targets.map(({ symbol, weight }) => ({ portfolioId, symbol, weight })));
    }
    return true;
  });
}
