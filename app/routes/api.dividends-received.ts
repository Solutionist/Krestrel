import * as z from "zod";

import { db } from "~/.server/market/db/instance";
import {
  clearDividendOverride,
  listDividendOverrides,
  setDividendOverride,
} from "~/.server/market/db/queries/dividend-overrides";
import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { nyDay } from "~/lib/candles";
import {
  DividendOverrideActionSchema,
  type DividendOverrideResult,
  type DividendsReceivedResponse,
  MAX_RECEIVED_PORTFOLIOS,
  MAX_RECEIVED_SYMBOLS,
} from "~/lib/dividends-received";
import { HISTORY_START } from "~/lib/history-start";
import { SymbolSchema } from "~/lib/market";

import type { Route } from "./+types/api.dividends-received";

const commaList = z.string().transform((raw) => [...new Set(raw.split(",").filter(Boolean))]);

const QuerySchema = z.object({
  symbols: commaList.pipe(z.array(SymbolSchema).min(1).max(MAX_RECEIVED_SYMBOLS)),
  portfolios: commaList.pipe(z.array(z.uuid()).min(1).max(MAX_RECEIVED_PORTFOLIOS)),
  from: z.iso.date().refine((day) => day >= HISTORY_START),
});

/**
 * GET /api/dividends-received?symbols=KO,O&portfolios=<id>,<id>&from=2024-03-01 (ADR 0025) →
 * `{ ok, today, payouts: { SYMBOL: payout[] }, overrides }`: each symbol's cash payouts paid from
 * `from` to today (missing when the provider couldn't be asked) and the owner's corrections in
 * those portfolios. The page works out what each portfolio received.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const today = nyDay(Date.now());
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success || query.data.from > today) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "invalid",
          message: `Give 1–${MAX_RECEIVED_SYMBOLS} valid symbols, 1–${MAX_RECEIVED_PORTFOLIOS} portfolio ids and a start date from ${HISTORY_START} to today.`,
        },
      } satisfies DividendsReceivedResponse,
      { status: 400 },
    );
  }
  const { symbols, portfolios, from } = query.data;
  const [payouts, overrides] = await Promise.all([
    getMarketHub().getDividendHistory(symbols, from),
    listDividendOverrides(db, portfolios),
  ]);
  return Response.json({
    ok: true,
    today,
    payouts: Object.fromEntries(payouts),
    overrides,
  } satisfies DividendsReceivedResponse);
}

/**
 * POST /api/dividends-received (JSON), ADR 0025:
 *   { intent: "set", portfolioId, symbol, exDate, amount } → the cash actually received, USD
 *   { intent: "clear", portfolioId, symbol, exDate } → back to the worked-out amount
 * Returns `{ ok: true }`; 404 when the portfolio doesn't exist. Requests from other websites are
 * refused (403) before anything is read.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  const parsed = DividendOverrideActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: { code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      } satisfies DividendOverrideResult,
      { status: 400 },
    );
  }
  const input = parsed.data;
  const key = { portfolioId: input.portfolioId, symbol: input.symbol, exDate: input.exDate };
  if (input.intent === "clear") {
    await clearDividendOverride(db, key);
    return Response.json({ ok: true } satisfies DividendOverrideResult);
  }
  if (!(await setDividendOverride(db, { ...key, amount: input.amount }))) {
    return Response.json(
      {
        ok: false,
        error: { code: "not_found", message: "That portfolio no longer exists." },
      } satisfies DividendOverrideResult,
      { status: 404 },
    );
  }
  return Response.json({ ok: true } satisfies DividendOverrideResult);
}
