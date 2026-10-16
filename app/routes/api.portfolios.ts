import * as z from "zod";

import { db } from "~/.server/market/db/instance";
import {
  addTrades,
  createPortfolio,
  deletePortfolio,
  deleteTrade,
  renamePortfolio,
  type TradeWriteResult,
  updateTrade,
} from "~/.server/market/db/queries/portfolios";
import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { MAX_IMPORT_ROWS } from "~/lib/holdings-import";
import { type PortfolioActionResult, PortfolioNameSchema, TradeInputSchema } from "~/lib/portfolio";

import type { Route } from "./+types/api.portfolios";

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("create"), name: PortfolioNameSchema }),
  z.object({ intent: z.literal("rename"), id: z.uuid(), name: PortfolioNameSchema }),
  z.object({ intent: z.literal("delete"), id: z.uuid() }),
  TradeInputSchema.extend({ intent: z.literal("addTrade"), portfolioId: z.uuid() }),
  TradeInputSchema.extend({ intent: z.literal("updateTrade"), id: z.uuid() }),
  z.object({ intent: z.literal("deleteTrade"), id: z.uuid() }),
  z.object({
    intent: z.literal("importTrades"),
    portfolioId: z.uuid(),
    trades: z.array(TradeInputSchema).min(1).max(MAX_IMPORT_ROWS),
  }),
]);

/**
 * POST /api/portfolios (JSON):
 *   { intent: "create", name } | { intent: "rename", id, name } | { intent: "delete", id }
 *   { intent: "addTrade", portfolioId, …trade } | { intent: "updateTrade", id, …trade }
 *   { intent: "deleteTrade", id } | { intent: "importTrades", portfolioId, trades: trade[] }
 * Expected failures (duplicate name, overselling, …) return `{ ok: false, error }` with 4xx.
 * Requests from other websites are refused (403) before anything is read.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
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
      const listed = await getMarketHub().verifyListed([symbol]);
      if (listed.get(symbol) === null) {
        return fail(422, "unknown_symbol", `${symbol} isn't an active NYSE or Nasdaq listing.`);
      }
      const result: TradeWriteResult =
        input.intent === "addTrade"
          ? await addTrades(db, input.portfolioId, [trade])
          : await updateTrade(db, input.id, trade);
      // A refused write (oversell, missing portfolio) must not take a watchlist slot.
      if (!result.ok) return tradeWriteResponse(result);
      const unpriced = await ensureWatched(symbol);
      const warning = unpriced
        ? `Saved, but ${symbol} has no live price yet: ${unpriced}`
        : undefined;
      return tradeWriteResponse(result, warning);
    }
    case "importTrades": {
      // Check every ticker before saving or watching anything, and name all misreads at once.
      const symbols = [...new Set(input.trades.map((trade) => trade.symbol))];
      const listed = await getMarketHub().verifyListed(symbols);
      const unknown = symbols.filter((symbol) => listed.get(symbol) === null);
      if (unknown.length > 0) {
        return fail(
          422,
          "unknown_symbol",
          `${unknown.join(", ")} ${unknown.length === 1 ? "isn't an active NYSE or Nasdaq listing" : "aren't active NYSE or Nasdaq listings"}. Fix or remove ${unknown.length === 1 ? "that row" : "those rows"}.`,
        );
      }
      const result = await addTrades(db, input.portfolioId, input.trades);
      if (!result.ok) return tradeWriteResponse(result);
      const unpriced: string[] = [];
      let reason = "";
      for (const symbol of symbols) {
        const why = await ensureWatched(symbol);
        if (why) {
          unpriced.push(symbol);
          reason = why;
        }
      }
      const warning =
        unpriced.length > 0
          ? `Saved, but ${unpriced.join(", ")} ${unpriced.length === 1 ? "has" : "have"} no live price yet: ${reason}`
          : undefined;
      return tradeWriteResponse(result, warning);
    }
    case "deleteTrade": {
      const result = await deleteTrade(db, input.id);
      return tradeWriteResponse(result);
    }
  }
}

/**
 * Holdings are priced from the live stream, which covers watchlist symbols only, so a traded
 * symbol joins the watchlist once its trade is saved. Returns why the holding has no live price
 * (full watchlist, unreachable provider, …), or undefined when the symbol is watched.
 */
async function ensureWatched(symbol: string): Promise<string | undefined> {
  const hub = getMarketHub();
  if (hub.snapshot().watchlist.includes(symbol)) return undefined;
  const added = await hub.addSymbol(symbol);
  if (added.ok || added.code === "duplicate") return undefined;
  return added.message;
}

function respond(result: PortfolioActionResult): Response {
  return Response.json(result);
}

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies PortfolioActionResult, {
    status,
  });
}

/** A trade write's outcome: oversell is a 409 conflict, a missing trade or portfolio a 404. */
function tradeWriteResponse(result: TradeWriteResult, warning?: string): Response {
  return result.ok
    ? respond({ ok: true, warning })
    : fail(result.code === "oversell" ? 409 : 404, result.code, result.message);
}
