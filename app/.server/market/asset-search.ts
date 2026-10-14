import type { Asset } from "~/lib/market";

/** Ranking tiers, best first. */
const EXACT_SYMBOL = 0;
const SYMBOL_PREFIX = 1;
const NAME_WORD_PREFIX = 2;

export interface AssetIndex {
  readonly size: number;
  /** Best matches for `query`: exact symbol, then symbol prefix (shortest first), then name words. */
  search(query: string, limit: number): Asset[];
}

interface Entry {
  asset: Asset;
  symbol: string;
  /** Lower-cased words of the company name, e.g. ["apple", "inc"]. */
  words: string[];
}

/**
 * In-memory search over a provider's listing. Linear scan: ~11k Alpaca equities take well under a
 * millisecond per query, so no prefix tree is needed.
 */
export function createAssetIndex(assets: readonly Asset[]): AssetIndex {
  const entries: Entry[] = assets.map((asset) => ({
    asset,
    symbol: asset.symbol.toUpperCase(),
    words: asset.name
      .toLowerCase()
      .split(/[^a-z0-9&]+/)
      .filter(Boolean),
  }));

  return {
    size: entries.length,
    search(query, limit) {
      const trimmed = query.trim();
      if (trimmed === "" || limit <= 0) return [];
      const upper = trimmed.toUpperCase();
      const lower = trimmed.toLowerCase();

      const ranked: Array<{ rank: number; entry: Entry }> = [];
      for (const entry of entries) {
        let rank: number | null = null;
        if (entry.symbol === upper) rank = EXACT_SYMBOL;
        else if (entry.symbol.startsWith(upper)) rank = SYMBOL_PREFIX;
        else if (lower.length >= 2 && entry.words.some((word) => word.startsWith(lower))) {
          rank = NAME_WORD_PREFIX;
        }
        if (rank !== null) ranked.push({ rank, entry });
      }

      ranked.sort(
        (a, b) =>
          a.rank - b.rank ||
          a.entry.symbol.length - b.entry.symbol.length ||
          a.entry.symbol.localeCompare(b.entry.symbol),
      );
      return ranked.slice(0, limit).map(({ entry }) => entry.asset);
    },
  };
}
