import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "../client";
import { watchlist } from "../schema";

export type WatchlistEntry = typeof watchlist.$inferSelect;

export type AddSymbolResult =
  | { ok: true; entry: WatchlistEntry }
  | { ok: false; code: "duplicate" | "limit"; message: string };

export function listWatchlist(db: Database): Promise<WatchlistEntry[]> {
  return db.select().from(watchlist).orderBy(asc(watchlist.position), asc(watchlist.symbol));
}

/**
 * Appends `symbol`, enforcing `maxSymbols` (the active provider's stream limit). Serialized with a
 * transaction-scoped advisory lock so concurrent adds cannot both pass the limit check.
 */
export function addToWatchlist(
  db: Database,
  symbol: string,
  maxSymbols: number,
): Promise<AddSymbolResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('krestrel.watchlist'))`);
    const rows = await tx
      .select({ symbol: watchlist.symbol, position: watchlist.position })
      .from(watchlist);
    if (rows.some((row) => row.symbol === symbol)) {
      return { ok: false, code: "duplicate", message: `${symbol} is already on your watchlist.` };
    }
    if (rows.length >= maxSymbols) {
      return {
        ok: false,
        code: "limit",
        message: `Your watchlist is full (${maxSymbols} symbols, the data plan's streaming limit). Remove one to add ${symbol}.`,
      };
    }
    const position = rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const [entry] = await tx.insert(watchlist).values({ symbol, position }).returning();
    if (!entry) throw new Error(`Insert of ${symbol} returned no row`);
    return { ok: true, entry };
  });
}

/** Removes `symbol` (its alerts cascade). Returns false when it was not on the list. */
export async function removeFromWatchlist(db: Database, symbol: string): Promise<boolean> {
  const removed = await db
    .delete(watchlist)
    .where(eq(watchlist.symbol, symbol))
    .returning({ symbol: watchlist.symbol });
  return removed.length > 0;
}

/**
 * Rewrites positions to match `orderedSymbols`. Rejects (returns false) unless it is exactly a
 * permutation of the current watchlist, so a stale client cannot drop or invent entries.
 */
export function reorderWatchlist(
  db: Database,
  orderedSymbols: readonly string[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('krestrel.watchlist'))`);
    const current = await tx.select({ symbol: watchlist.symbol }).from(watchlist);
    const currentSet = new Set(current.map((row) => row.symbol));
    const isPermutation =
      orderedSymbols.length === currentSet.size &&
      new Set(orderedSymbols).size === orderedSymbols.length &&
      orderedSymbols.every((symbol) => currentSet.has(symbol));
    if (!isPermutation) return false;
    for (const [position, symbol] of orderedSymbols.entries()) {
      await tx.update(watchlist).set({ position }).where(eq(watchlist.symbol, symbol));
    }
    return true;
  });
}
