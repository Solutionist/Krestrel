import { fxHistory, fxRates } from "~/.server/fx/instance";
import { BASE_CURRENCY } from "~/lib/currency";
import { FxHistoryQuerySchema, type FxHistoryResponse } from "~/lib/fx-history";

import type { Route } from "./+types/api.fx.history";

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies FxHistoryResponse, {
    status,
  });
}

/**
 * GET /api/fx/history?quote=THB&from=2024-03-01 → `quote` per 1 USD for every ECB business day
 * from a little before `from` (so a weekend start has the previous rate) up to the latest
 * (ADR 0027). Only the currency code and start date go upstream. 400 on bad input or a currency
 * the ECB doesn't publish; 502 when the rates can't be loaded.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const query = FxHistoryQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    const message = query.error.issues[0]?.message ?? "Check the currency and start date.";
    return fail(400, "invalid", message);
  }
  const { quote, from } = query.data;
  const latest = await fxRates.get();
  if (latest.ok && (quote === BASE_CURRENCY || latest.fx.rates[quote] === undefined)) {
    const message = `The European Central Bank doesn't publish a USD rate for ${quote}.`;
    return fail(400, "unsupported", message);
  }
  const result = await fxHistory.get(quote, from);
  return result.ok
    ? Response.json({ ok: true, quote, rates: result.rates } satisfies FxHistoryResponse)
    : fail(502, "unavailable", result.message);
}
