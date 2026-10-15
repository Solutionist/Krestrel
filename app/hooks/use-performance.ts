import { useEffect, useState } from "react";

import { HISTORY_START } from "~/lib/history-start";
import {
  type DayClose,
  MAX_PERFORMANCE_SYMBOLS,
  PerformanceResponseSchema,
} from "~/lib/performance";

export type DailyClosesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      today: string;
      closes: Readonly<Record<string, DayClose[]>>;
      /** Symbols whose history the server couldn't download. */
      incomplete: readonly string[];
    };

async function loadChunk(symbols: readonly string[], from: string, signal: AbortSignal) {
  const params = new URLSearchParams({ symbols: symbols.join(","), from });
  const response = await fetch(`/api/performance?${params}`, { signal });
  const parsed = PerformanceResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new Error(
      response.ok
        ? "Price history came back in an unexpected format."
        : "The Krestrel server couldn't load price history. Check its log.",
    );
  }
  if (!parsed.data.ok) throw new Error(parsed.data.error.message);
  return parsed.data;
}

/**
 * Daily closes for `symbols` since `from` (no earlier than HISTORY_START, which the API enforces)
 * from GET /api/performance (ADR 0024), any number of symbols: asked in chunks the API accepts and
 * merged. Loading again only when the symbols or the start date change; any failed chunk is an
 * error, since a missing stock would misstate the value.
 */
export function useDailyCloses(symbols: readonly string[], from: string): DailyClosesState {
  const key = `${from < HISTORY_START ? HISTORY_START : from}:${[...new Set(symbols)].sort().join(",")}`;
  const [loaded, setLoaded] = useState<{ key: string; state: DailyClosesState } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const [start = "", list = ""] = key.split(":");
    const all = list.split(",").filter(Boolean);
    const chunks: string[][] = [];
    for (let index = 0; index < all.length; index += MAX_PERFORMANCE_SYMBOLS) {
      chunks.push(all.slice(index, index + MAX_PERFORMANCE_SYMBOLS));
    }
    Promise.all(chunks.map((chunk) => loadChunk(chunk, start, abort.signal))).then(
      (responses) => {
        if (abort.signal.aborted) return;
        setLoaded({
          key,
          state: {
            status: "ready",
            today: responses[0]?.today ?? start,
            closes: Object.assign({}, ...responses.map((response) => response.closes)),
            incomplete: responses.flatMap((response) => response.incomplete),
          },
        });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        setLoaded({
          key,
          state: {
            status: "error",
            message:
              error instanceof TypeError
                ? "Couldn't reach the Krestrel server for price history."
                : error instanceof Error
                  ? error.message
                  : "Couldn't load price history.",
          },
        });
      },
    );
    return () => abort.abort();
  }, [key]);

  return loaded?.key === key ? loaded.state : { status: "loading" };
}
