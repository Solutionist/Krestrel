import * as z from "zod";
import { loadChartCandles } from "~/.server/market/chart-data";
import { db } from "~/.server/market/db/instance";
import { getMarketHub } from "~/.server/market/instance";
import { SymbolSchema, TIMEFRAMES } from "~/lib/market";

import type { Route } from "./+types/api.bars.$symbol";

const QuerySchema = z.object({
  tf: z.enum(TIMEFRAMES).default("1m"),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

/** GET /api/bars/:symbol?tf=1W[&from=ISO&to=ISO] → candles (time in epoch seconds, UTC). */
export async function loader({ params, request }: Route.LoaderArgs) {
  const symbol = SymbolSchema.safeParse(params.symbol);
  const url = new URL(request.url);
  const query = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!symbol.success || !query.success) {
    const issue = (symbol.error ?? query.error)?.issues[0];
    return Response.json(
      { error: { code: "invalid", message: issue?.message ?? "Invalid request" } },
      { status: 400 },
    );
  }

  const candles = await loadChartCandles(db, {
    symbol: symbol.data,
    timeframe: query.data.tf,
    from: query.data.from ? new Date(query.data.from) : undefined,
    to: query.data.to ? new Date(query.data.to) : undefined,
    sources: getMarketHub().sources,
  });
  return Response.json({ symbol: symbol.data, timeframe: query.data.tf, candles });
}
