import { inArray, sql } from "drizzle-orm";

import type { StockProfile } from "~/lib/stock-profile";

import type { Database } from "../client";
import { stockProfiles } from "../schema";

/** Saved profiles for `symbols` (those never classified are absent). */
export async function listStockProfiles(
  db: Database,
  symbols: readonly string[],
): Promise<StockProfile[]> {
  if (symbols.length === 0) return [];
  return db
    .select({
      symbol: stockProfiles.symbol,
      sector: stockProfiles.sector,
      style: stockProfiles.style,
      source: stockProfiles.source,
    })
    .from(stockProfiles)
    .where(inArray(stockProfiles.symbol, [...symbols]));
}

/** Stores the model's classifications; the owner's corrections are left untouched. */
export async function saveModelProfiles(
  db: Database,
  profiles: ReadonlyArray<Omit<StockProfile, "source">>,
): Promise<void> {
  if (profiles.length === 0) return;
  await db
    .insert(stockProfiles)
    .values(profiles.map((profile) => ({ ...profile, source: "model" as const })))
    .onConflictDoUpdate({
      target: stockProfiles.symbol,
      set: {
        sector: sql`excluded.sector`,
        style: sql`excluded.style`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${stockProfiles.source} = 'model'`,
    });
}

/** The owner's correction; it wins over the model from now on. */
export async function saveOwnerProfile(
  db: Database,
  profile: Omit<StockProfile, "source">,
): Promise<void> {
  const row = { ...profile, source: "owner" as const };
  await db
    .insert(stockProfiles)
    .values(row)
    .onConflictDoUpdate({
      target: stockProfiles.symbol,
      set: { sector: row.sector, style: row.style, source: "owner", updatedAt: sql`now()` },
    });
}
