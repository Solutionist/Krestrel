import { generateOutlook } from "~/.server/analysis/outlook";
import { getLlm } from "~/.server/llm/instance";
import { LlmError } from "~/.server/llm/types";
import { logger } from "~/.server/logger";
import { getMarketHub } from "~/.server/market/instance";
import { analyzeChart } from "~/lib/analysis";
import { analysisWindow } from "~/lib/chart-ranges";
import { SymbolSchema } from "~/lib/market";
import { OutlookRequestSchema, type OutlookResponse } from "~/lib/outlook";
import { buildTradePlan } from "~/lib/trade-plan";

import type { Route } from "./+types/api.outlook.$symbol";

const STATUS: Record<LlmError["code"], number> = {
  disabled: 503,
  not_installed: 503,
  not_signed_in: 503,
  busy: 429,
  rate_limited: 429,
  timeout: 504,
  invalid_output: 502,
  failed: 502,
};

function fail(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies OutlookResponse, {
    status,
  });
}

/**
 * POST /api/outlook/:symbol { timeframe, candles, model? } → local trade plan + Claude's outlook
 * (news, analyst consensus, plan), researched with web search. Only called on an explicit click.
 */
export async function action({ params, request }: Route.ActionArgs) {
  const symbol = SymbolSchema.safeParse(params.symbol);
  const body = OutlookRequestSchema.safeParse(await request.json().catch(() => null));
  if (!symbol.success || !body.success) return fail(400, "invalid", "Invalid outlook request.");

  const { timeframe, model } = body.data;
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
    const llm = getLlm();
    const news = await getMarketHub().getNews(symbol.data);
    const { outlook, model: usedModel } = await generateOutlook(llm, {
      symbol: symbol.data,
      timeframe,
      candles,
      analysis,
      plan,
      news,
      model,
      now: Date.now(),
    });
    return Response.json({
      ok: true,
      provider: llm.displayName,
      model: usedModel,
      localPlan: plan,
      outlook,
      feedHeadlines: news.length,
      generatedAt: new Date().toISOString(),
    } satisfies OutlookResponse);
  } catch (err) {
    if (err instanceof LlmError) return fail(STATUS[err.code], err.code, err.message);
    logger.error({ err, symbol: symbol.data }, "outlook failed");
    return fail(500, "failed", "The outlook failed unexpectedly. Check the server log.");
  }
}
