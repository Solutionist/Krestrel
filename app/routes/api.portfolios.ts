import * as z from "zod";

import { db } from "~/.server/market/db/instance";
import {
  addTrade,
  createPortfolio,
  deletePortfolio,
  deleteTrade,
  renamePortfolio,
  type TradeWriteResult,
  updateTrade,
} from "~/.server/market/db/queries/portfolios";
import { getMarketHub } from "~/.server/market/instance";
import { type PortfolioActionResult, PortfolioNameSchema, TradeInputSchema } from "~/lib/portfolio";

import type { Route } from "./+types/api.portfolios";

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create"), name: PortfolioNameSchema }),
  z.object({ intent: z.literal("rename"), id: z.uuid(), name: PortfolioNameSchema }),
  z.object({ intent: z.literal("delete"), id: z.uuid() }),
  TradeInputSchema.extend({ intent: z.literal("addTrade"), portfolioId: z.uuid() }),
  TradeInputSchema.extend({ intent: z.literal("updateTrade"), id: z.uuid() }),
  z.object({ intent: z.literal("deleteTrade"), id: z.uuid() }),
]);

/**
 * POST /api/portfolios (JSON):
 *   { intent: "create", name } | { intent: "rename", id, name } | { intent: "delete", id }
 *   { intent: "addTrade", portfolioId, …trade } | { intent: "updateTrade", id, …trade }
 *   { intent: "deleteTrade", id }
 * Expected failures (duplicate name, overselling, …) return `{ ok: false, error }` with 4xx.
 */
export async function action({ request }: Route.ActionArgs) {
  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid request");
  }
  const input = parsed.data;
  switch (input.intent) {
    case "create":
    case "rename": {
      const result =
        input.intent === "create"
          ? await createPortfolio(db, input.name)
          : await renamePortfolio(db, input.id, input.name);
      return result.ok
        ? respond({ ok: true, portfolioId: result.portfolio.id })
        : fail(result.code === "duplicate" ? 409 : 404, result.code, result.message);
    }
    case "delete":
      return (await deletePortfolio(db, input.id))
        ? respond({ ok: true })
        : fail(404, "not_found", "That portfolio no longer exists.");
    case "addTrade":
    case "updateTrade": {
      const { symbol, side, shares, price, fee, tradedOn } = input;
      const trade = { symbol, side, shares, price, fee, tradedOn };
      const watch = await ensureWatched(trade.symbol);
      if (!watch.ok) return fail(422, "unknown_symbol", watch.message);
      const result: TradeWriteResult =
        input.intent === "addTrade"
          ? await addTrade(db, input.portfolioId, trade)
          : await updateTrade(db, input.id, trade);
      return result.ok
        ? respond({ ok: true, warning: watch.warning })
        : fail(result.code === "oversell" ? 409 : 404, result.code, result.message);
    }
    case "deleteTrade": {
      const result = await deleteTrade(db, input.id);
      return result.ok
        ? respond({ ok: true })
        : fail(result.code === "oversell" ? 409 : 404, result.code, result.message);
    }
  }
}

/**
 * Holdings are priced from the live stream, which covers watchlist symbols only, so a traded
 * symbol joins the watchlist. Unknown tickers are refused; a full watchlist or an unreachable
 * provider still saves the trade, with a warning that the holding has no live price.
 */
async function ensureWatched(
  symbol: string,
): Promise<{ ok: true; warning?: string } | { ok: false; message: string }> {
  const hub = getMarketHub();
  if (hub.snapshot().watchlist.includes(symbol)) return { ok: true };
  const added = await hub.addSymbol(symbol);
  if (added.ok || added.code === "duplicate") return { ok: true };
  if (added.code === "invalid" || added.code === "unknown") {
    return { ok: false, message: added.message };
  }
  return { ok: true, warning: `Saved, but ${symbol} has no live price yet: ${added.message}` };
}

function respond(result: PortfolioActionResult): Response {
  return Response.json(result);
}

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies PortfolioActionResult, {
    status,
  });
}
