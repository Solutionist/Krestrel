import * as z from "zod";

import { getMarketHub } from "~/.server/market/instance";
import { nyDay } from "~/lib/candles";
import { HISTORY_START } from "~/lib/history-start";
import { SymbolSchema } from "~/lib/market";
import { MAX_PERFORMANCE_SYMBOLS, type PerformanceResponse } from "~/lib/performance";

import type { Route } from "./+types/api.performance";

const QuerySchema = z.object({
  symbols: z
    .string()
    .transform((raw) => [...new Set(raw.split(",").filter(Boolean))])
    .pipe(z.array(SymbolSchema).min(1).max(MAX_PERFORMANCE_SYMBOLS)),
  // A floor bounds the history one GET can make the server download.
  from: z.iso.date().refine((day) => day >= HISTORY_START),
});

/**
 * GET /api/performance?symbols=AAPL,SPY&from=2025-03-04 → daily closes per symbol from `from` to
 * today (ADR 0024): `{ ok, today, closes: { SYMBOL: [[day, close], …] }, incomplete }`, oldest
 * first, the last entry possibly today's latest price. Split-adjusted stored history, downloaded
 * when missing; `incomplete` names the symbols whose download failed.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  const today = nyDay(Date.now());
  if (!query.success || query.data.from > today) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid",
          message: `Give 1–${MAX_PERFORMANCE_SYMBOLS} valid symbols and a start date from ${HISTORY_START} to today.`,
        },
      } satisfies PerformanceResponse,
      { status: 400 },
    );
  }
  const { closes, incomplete } = await getMarketHub().getDailyCloses(
    query.data.symbols,
    query.data.from,
  );
  return Response.json({
    ok: true,
    today,
    closes: Object.fromEntries(closes),
    incomplete,
  } satisfies PerformanceResponse);
}
