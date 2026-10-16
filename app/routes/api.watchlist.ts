import * as z from "zod";

import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { SymbolSchema } from "~/lib/market";

import type { Route } from "./+types/api.watchlist";

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("add"), symbol: z.string() }),
  z.object({ intent: z.literal("remove"), symbol: SymbolSchema }),
  z.object({ intent: z.literal("reorder"), symbols: z.array(SymbolSchema).max(100) }),
]);

export type WatchlistActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

/** GET /api/watchlist → current symbols and provider limits. */
export function loader() {
  const hub = getMarketHub();
  return Response.json({ symbols: hub.snapshot().watchlist, provider: hub.provider });
}

/**
 * POST /api/watchlist (JSON):
 *   { intent: "add", symbol } | { intent: "remove", symbol } | { intent: "reorder", symbols }
 * Expected failures (limit, unknown symbol, …) return `{ ok: false, error }` with 4xx.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;

  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid request");
  }

  const hub = getMarketHub();
  const input = parsed.data;
  switch (input.intent) {
    case "add": {
      const result = await hub.addSymbol(input.symbol);
      if (result.ok) return ok();
      const status = result.code === "upstream" ? 502 : result.code === "limit" ? 409 : 422;
      return fail(status, result.code, result.message);
    }
    case "remove":
      return (await hub.removeSymbol(input.symbol))
        ? ok()
        : fail(404, "not_found", `${input.symbol} isn't on your watchlist.`);
    case "reorder":
      return (await hub.reorder(input.symbols))
        ? ok()
        : fail(409, "stale", "The watchlist changed. Reload and try again.");
  }
}

function ok(): Response {
  return Response.json({ ok: true } satisfies WatchlistActionResult);
}

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies WatchlistActionResult, {
    status,
  });
}
