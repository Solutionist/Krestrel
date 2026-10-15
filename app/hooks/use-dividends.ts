import { useEffect, useState } from "react";

import { nyDay } from "~/lib/candles";
import { type DividendInfo, DividendsResponseSchema, MAX_DIVIDEND_SYMBOLS } from "~/lib/dividends";

export interface Dividends {
  /** New York date the schedules were worked out for (`YYYY-MM-DD`). */
  today: string;
  /** null: pays no regular dividend. Missing: not known (still loading, or the provider failed). */
  bySymbol: Readonly<Record<string, DividendInfo | null>>;
}

/** One request's worth of symbols; failures leave its symbols unknown. */
async function loadChunk(symbols: readonly string[], signal: AbortSignal) {
  const response = await fetch(`/api/dividends?symbols=${encodeURIComponent(symbols.join(","))}`, {
    signal,
  });
  const parsed = DividendsResponseSchema.safeParse(await response.json());
  return parsed.success && parsed.data.ok ? parsed.data : null;
}

/**
 * Dividend schedules for `symbols` from GET /api/dividends (ADR 0022), any number of symbols:
 * asked in chunks the API accepts and merged. Undefined until loaded; symbols whose chunk failed
 * are simply missing (unknown), never reported as paying nothing.
 */
export function useDividends(symbols: readonly string[]): Dividends | undefined {
  const key = [...new Set(symbols)].sort().join(",");
  const [loaded, setLoaded] = useState<{ key: string; dividends: Dividends } | null>(null);

  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    const all = key.split(",");
    const chunks: string[][] = [];
    for (let index = 0; index < all.length; index += MAX_DIVIDEND_SYMBOLS) {
      chunks.push(all.slice(index, index + MAX_DIVIDEND_SYMBOLS));
    }
    void Promise.all(chunks.map((chunk) => loadChunk(chunk, abort.signal).catch(() => null))).then(
      (responses) => {
        if (abort.signal.aborted) return;
        const answered = responses.filter((response) => response !== null);
        setLoaded({
          key,
          dividends: {
            today: answered[0]?.today ?? nyDay(Date.now()),
            bySymbol: Object.assign({}, ...answered.map((response) => response.dividends)),
          },
        });
      },
    );
    return () => abort.abort();
  }, [key]);

  // Only for the symbols asked about: a portfolio switch never shows the previous one's data.
  return loaded?.key === key ? loaded.dividends : undefined;
}
