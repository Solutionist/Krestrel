import * as z from "zod";

import { explainAnalysis } from "~/.server/analysis/explain";
import { getLlm } from "~/.server/llm/instance";
import { LlmError } from "~/.server/llm/types";
import { logger } from "~/.server/logger";
import { analyzeChart } from "~/lib/analysis";
import { CLAUDE_MODELS, type ExplainResponse } from "~/lib/analysis-explanation";
import { CandleSchema, SymbolSchema, TIMEFRAMES } from "~/lib/market";

import type { Route } from "./+types/api.analysis.$symbol";

const BodySchema = z.object({
  timeframe: z.enum(TIMEFRAMES),
  /**
   * The exact candles the chart is showing, so the server's analysis (and Claude's ids) match
   * what is drawn. Shape-validated and capped; only used to build the prompt.
   */
  candles: z.array(CandleSchema).min(20).max(6000),
  maxTrades: z.number().int().min(1).max(5).default(3),
  model: z.enum(CLAUDE_MODELS).default("default"),
});

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
  return Response.json({ ok: false, error: { code, message } } satisfies ExplainResponse, {
    status,
  });
}

/**
 * POST /api/analysis/:symbol { timeframe, candles, maxTrades?, model? } → analysis + Claude's explanation.
 * Sends this symbol's candles to the configured LLM; only called on an explicit user click.
 */
export async function action({ params, request }: Route.ActionArgs) {
  const symbol = SymbolSchema.safeParse(params.symbol);
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!symbol.success || !body.success) return fail(400, "invalid", "Invalid analysis request.");

  const { candles } = body.data;
  const analysis = analyzeChart(candles, body.data.maxTrades);
  if (analysis.pivots.length < 2) {
    return fail(
      422,
      "not_enough_data",
      "Not enough price history on this interval to analyse. Try a longer range.",
    );
  }

  try {
    const llm = getLlm();
    const { explanation, model } = await explainAnalysis(llm, {
      symbol: symbol.data,
      timeframe: body.data.timeframe,
      candles,
      analysis,
      model: body.data.model === "default" ? undefined : body.data.model,
    });
    return Response.json({
      ok: true,
      model,
      provider: llm.displayName,
      analysis: { trades: analysis.trades, levels: analysis.levels },
      explanation,
    } satisfies ExplainResponse);
  } catch (err) {
    if (err instanceof LlmError) return fail(STATUS[err.code], err.code, err.message);
    logger.error({ err, symbol: symbol.data }, "analysis explanation failed");
    return fail(500, "failed", "Analysis failed unexpectedly. Check the server log.");
  }
}
