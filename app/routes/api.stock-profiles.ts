import { aiFailureResponse, getAi } from "~/.server/llm/instance";
import { db } from "~/.server/market/db/instance";
import {
  listStockProfiles,
  saveModelProfiles,
  saveOwnerProfile,
} from "~/.server/market/db/queries/stock-profiles";
import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { classifyStocks } from "~/.server/stock-profiles/classify";
import {
  needsClassifying,
  StockProfileActionSchema,
  type StockProfileResult,
} from "~/lib/stock-profile";

import type { Route } from "./+types/api.stock-profiles";

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies StockProfileResult, {
    status,
  });
}

/**
 * POST /api/stock-profiles (JSON), ADR 0019, 0020:
 *   { intent: "classify", symbols, ai? } → the chosen AI classifies tickers that still need it;
 *   returns all of their profiles.
 *   { intent: "set", symbol, sector, style } → the owner's correction, never overwritten.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  const parsed = StockProfileActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid request");
  }
  const input = parsed.data;

  if (input.intent === "set") {
    const { symbol, sector, style } = input;
    await saveOwnerProfile(db, { symbol, sector, style });
    return Response.json({
      ok: true,
      profiles: await listStockProfiles(db, [symbol]),
    } satisfies StockProfileResult);
  }

  const symbols = [...new Set(input.symbols)];
  const saved = new Map(
    (await listStockProfiles(db, symbols)).map((profile) => [profile.symbol, profile]),
  );
  const missing = symbols.filter((symbol) => needsClassifying(saved.get(symbol)));
  if (missing.length > 0) {
    // Company names from the cached listing help the model with lesser-known tickers.
    const listing = await getMarketHub().verifyListed(missing);
    try {
      const profiles = await classifyStocks(
        getAi(input.ai),
        missing.map((symbol) => ({ symbol, name: listing.get(symbol)?.name ?? null })),
      );
      await saveModelProfiles(db, profiles);
    } catch (err) {
      const failure = aiFailureResponse(err);
      if (failure) return failure;
      throw err;
    }
  }
  return Response.json({
    ok: true,
    profiles: await listStockProfiles(db, symbols),
  } satisfies StockProfileResult);
}
