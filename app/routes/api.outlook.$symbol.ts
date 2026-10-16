import { generateOutlook, outlookQueries } from "~/.server/analysis/outlook";
import { aiFailureResponse, getAi, getWebSearch } from "~/.server/llm/instance";
import { gatherResearch } from "~/.server/llm/research";
import { logger } from "~/.server/logger";
import { getMarketHub } from "~/.server/market/instance";
import { crossSiteRejection } from "~/.server/same-origin";
import { analyzeChart } from "~/lib/analysis";
import { analysisWindow } from "~/lib/chart-ranges";
import { SymbolSchema } from "~/lib/market";
import { OutlookRequestSchema, type OutlookResponse } from "~/lib/outlook";
import { buildTradePlan } from "~/lib/trade-plan";

import type { Route } from "./+types/api.outlook.$symbol";

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies OutlookResponse, {
    status,
  });
}

/**
 * POST /api/outlook/:symbol { timeframe, candles, ai? } → local trade plan + the chosen AI's
 * outlook (news, analyst consensus, plan). Claude researches with web search; a local model gets
 * Tavily results (TAVILY_API_KEY) or only the feed. Only called on an explicit click.
 */
export async function action({ params, request }: Route.ActionArgs) {
  const refused = crossSiteRejection(request);
  if (refused) return refused;
  const symbol = SymbolSchema.safeParse(params.symbol);
  const body = OutlookRequestSchema.safeParse(await request.json().catch(() => null));
  if (!symbol.success || !body.success) return fail(400, "invalid", "Invalid outlook request.");

  const { timeframe, ai } = body.data;
  // Same window Insights analyses, even if the client sent more.
  const candles = analysisWindow(body.data.candles, timeframe);
  const analysis = analyzeChart(candles);
  if (analysis.pivots.length < 2) {
    return fail(
      422,
      "not_enough_data",
      "Not enough price history on this interval for an outlook. Try a longer interval.",
    );
  }
  const plan = buildTradePlan(candles, analysis);

  try {
    const llm = getAi(ai);
    const [news, research] = await Promise.all([
      getMarketHub().getNews(symbol.data),
      // Tavily settings matter only to a model that can't browse; Claude never reads them.
      gatherResearch(
        llm,
        llm.capabilities.webSearch ? null : getWebSearch(),
        outlookQueries(symbol.data),
        logger,
      ),
    ]);
    const { outlook, model: usedModel } = await generateOutlook(
      llm,
      {
        symbol: symbol.data,
        timeframe,
        candles,
        analysis,
        plan,
        news,
        now: Date.now(),
        research,
      },
      request.signal,
    );
    return Response.json({
      ok: true,
      provider: llm.displayName,
      model: usedModel,
      localPlan: plan,
      outlook,
      feedHeadlines: news.length,
      research: research.mode,
      researchNote: research.note,
      generatedAt: new Date().toISOString(),
    } satisfies OutlookResponse);
  } catch (err) {
    const failure = aiFailureResponse(err);
    if (failure) return failure;
    logger.error({ err, symbol: symbol.data }, "outlook failed");
    return fail(500, "failed", "The outlook failed unexpectedly. Check the server log.");
  }
}
