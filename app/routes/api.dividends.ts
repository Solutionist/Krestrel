import * as z from "zod";

import { getMarketHub } from "~/.server/market/instance";
import { nyDay } from "~/lib/candles";
import { type DividendsResponse, dividendInfo, MAX_DIVIDEND_SYMBOLS } from "~/lib/dividends";
import { SymbolSchema } from "~/lib/market";

import type { Route } from "./+types/api.dividends";

const QuerySchema = z.object({
  symbols: z
    .string()
    .transform((raw) => [...new Set(raw.split(",").filter(Boolean))])
    .pipe(z.array(SymbolSchema).min(1).max(MAX_DIVIDEND_SYMBOLS)),
});

/**
 * GET /api/dividends?symbols=KO,O,AAPL → each symbol's dividend schedule (ADR 0022): frequency,
 * the last regular payment and the next one (announced, or expected from the schedule). null
 * for a symbol that pays no regular dividend; a symbol is missing when the provider couldn't be
 * asked. Read-only, from the market data provider's corporate actions.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    return Response.json(
      {
        ok: false,
        error: { code: "invalid", message: `Give 1–${MAX_DIVIDEND_SYMBOLS} valid symbols.` },
      } satisfies DividendsResponse,
      { status: 400 },
    );
  }
  const today = nyDay(Date.now());
  const payments = await getMarketHub().getDividends(query.data.symbols);
  return Response.json({
    ok: true,
    today,
    dividends: Object.fromEntries(
      [...payments].map(([symbol, list]) => [symbol, dividendInfo(list, today)]),
    ),
  } satisfies DividendsResponse);
}
