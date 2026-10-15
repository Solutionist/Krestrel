import {
  generateIdeas,
  holdingWeights,
  type IdeasBasis,
  ideasQueries,
  openPositions,
} from "~/.server/analysis/ideas";
import { aiFailureResponse, getAi, getWebSearch } from "~/.server/llm/instance";
import { gatherResearch } from "~/.server/llm/research";
import { logger } from "~/.server/logger";
import { db } from "~/.server/market/db/instance";
import { listTrades } from "~/.server/market/db/queries/portfolios";
import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { type Idea, IdeasRequestSchema, type IdeasResponse, type Sector } from "~/lib/ideas";

import type { Route } from "./+types/api.ideas";

/** Fewer verified ideas than this is not worth showing. */
const MIN_VERIFIED_IDEAS = 3;

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies IdeasResponse, {
    status,
  });
}

/**
 * The mix that steers the ideas: open holdings across all portfolios by value; else the
 * watchlist, equally weighted; else nothing.
 */
async function startingMix(
  watchlist: readonly string[],
): Promise<{ basis: IdeasBasis; holdings: Array<{ symbol: string; weight: number }> }> {
  const positions = openPositions(await listTrades(db));
  if (positions.length > 0) {
    const quotes = await getMarketHub().getQuotes(positions.map((position) => position.symbol));
    return { basis: "portfolio", holdings: holdingWeights(positions, quotes) };
  }
  if (watchlist.length > 0) {
    return {
      basis: "watchlist",
      holdings: watchlist.map((symbol) => ({ symbol, weight: 1 / watchlist.length })),
    };
  }
  return { basis: "none", holdings: [] };
}

/**
 * POST /api/ideas { focus?, ai? } → 5–10 stock ideas (growth / dividend / risky) from the chosen
 * AI, steered by the owner's mix. Claude researches with web search; a local model gets Tavily
 * results (TAVILY_API_KEY) or only its own knowledge. Only symbols and percent weights leave the
 * server. Every ticker is checked against the provider's listing. Only called on an explicit click.
 */
export async function action({ request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  const body = IdeasRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "invalid", "Invalid ideas request.");
  const { focus, ai } = body.data;

  try {
    const llm = getAi(ai);
    const hub = getMarketHub();
    await hub.start(); // The watchlist is loaded on start.
    const watchlist = hub.snapshot().watchlist;
    const now = Date.now();
    const [{ basis, holdings }, research] = await Promise.all([
      startingMix(watchlist),
      // Tavily settings matter only to a model that can't browse; Claude never reads them.
      gatherResearch(
        llm,
        llm.capabilities.webSearch ? null : getWebSearch(),
        ideasQueries(focus, now),
        logger,
      ),
    ]);
    // Load the ticker listing while the model works, so checking its picks is instant afterwards.
    hub.warmAssets();
    const { ideas: answer, model: usedModel } = await generateIdeas(llm, {
      focus,
      basis,
      holdings: holdings.map((holding) => ({
        symbol: holding.symbol,
        weightPct: holding.weight * 100,
      })),
      now,
      research,
    });

    // Drop tickers the provider says aren't listed; keep ones it couldn't check right now
    // (network blip) rather than discard the whole run.
    const checked = await hub.verifyListed(answer.ideas.map((idea) => idea.symbol));
    const listed = answer.ideas.flatMap((idea) => {
      const asset = checked.get(idea.symbol);
      if (asset === null) return [];
      if (asset === undefined) return [{ idea, exchange: "", name: idea.name }];
      return [{ idea, exchange: asset.exchange, name: asset.name.trim() || idea.name }];
    });
    if (listed.length < MIN_VERIFIED_IDEAS) {
      return fail(
        502,
        "invalid_output",
        "The AI suggested too few stocks that are listed on NYSE or Nasdaq. Try again.",
      );
    }

    const quotes = await hub.getQuotes(listed.map(({ idea }) => idea.symbol));
    const watched = new Set(watchlist);
    const ideas: Idea[] = listed.map(({ idea, exchange, name }) => {
      const quote = quotes.get(idea.symbol);
      return {
        ...idea,
        name,
        exchange,
        lastPrice: quote?.lastPrice ?? null,
        previousClose: quote?.previousClose ?? null,
        watched: watched.has(idea.symbol),
      };
    });

    const sectorOf = new Map(answer.holdingSectors.map((entry) => [entry.symbol, entry.sector]));
    const bySector = new Map<Sector, number>();
    const withSectors = holdings.map((holding) => {
      const sector = sectorOf.get(holding.symbol) ?? null;
      if (sector) bySector.set(sector, (bySector.get(sector) ?? 0) + holding.weight);
      return { ...holding, sector };
    });

    return Response.json({
      ok: true,
      provider: llm.displayName,
      model: usedModel,
      focus,
      basis,
      holdings: withSectors,
      sectorWeights: [...bySector]
        .map(([sector, weight]) => ({ sector, weight }))
        .sort((a, b) => b.weight - a.weight),
      summary: answer.summary,
      suggestedSectors: answer.suggestedSectors,
      ideas,
      generatedAt: new Date().toISOString(),
      research: research.mode,
      researchNote: research.note,
    } satisfies IdeasResponse);
  } catch (err) {
    const failure = aiFailureResponse(err);
    if (failure) return failure;
    logger.error({ err, focus }, "ideas failed");
    return fail(500, "failed", "The ideas failed unexpectedly. Check the server log.");
  }
}
