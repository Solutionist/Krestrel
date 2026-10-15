// AI outlook contract (ADR 0016, 0020): news + analyst sentiment and a forward plan, produced by
// the owner's chosen AI on an explicit click. Shared by the server (prompt schema, validation)
// and the panel.

import * as z from "zod";

import { AiChoiceSchema, DEFAULT_AI_CHOICE, RESEARCH_MODES } from "./ai";
import { CandleSchema, TIMEFRAMES } from "./market";
import { TradePlanSchema } from "./trade-plan";

export const SENTIMENTS = [
  "bearish",
  "somewhat_bearish",
  "neutral",
  "somewhat_bullish",
  "bullish",
] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const CONSENSUS = ["strong_buy", "buy", "hold", "sell", "strong_sell", "unknown"] as const;
export type Consensus = (typeof CONSENSUS)[number];

/**
 * - `buy`: price is in or near the buy zone now.
 * - `wait`: worth buying lower; wait for a pullback into the zone.
 * - `hold`: owners keep; no new entry here.
 * - `trim`: near targets or stretched; consider taking some profit.
 * - `avoid`: downtrend or poor setup; stay out.
 */
export const STANCES = ["buy", "wait", "hold", "trim", "avoid"] as const;
export type Stance = (typeof STANCES)[number];

export const NEWS_TONES = ["positive", "neutral", "negative"] as const;
export type NewsTone = (typeof NEWS_TONES)[number];

/** Text budgets: short, precise lines (enforced server-side after the model answers). */
export const LINE_MAX = 90;
export const SUMMARY_MAX = 200;
export const HEADLINE_MAX = 140;

/** What the model must produce (sent as JSON Schema; validated, then sanitised server-side). */
export const OutlookSchema = z.object({
  sentiment: z.object({
    overall: z.enum(SENTIMENTS),
    summary: z
      .string()
      .describe(
        `One or two sentences, at most ${SUMMARY_MAX} characters: what drives the mood now.`,
      ),
  }),
  analysts: z.object({
    consensus: z.enum(CONSENSUS).describe("Wall Street consensus rating; unknown if not found."),
    targetLow: z.number().nullable(),
    targetMean: z.number().nullable(),
    targetHigh: z.number().nullable(),
    analystCount: z.number().int().nullable(),
    asOf: z.string().nullable().describe("YYYY-MM-DD of the data, if known."),
    note: z.string().describe(`At most ${LINE_MAX} characters, e.g. recent up/downgrades.`),
  }),
  news: z
    .array(
      z.object({
        headline: z.string(),
        source: z.string(),
        url: z.string(),
        date: z.string().describe("YYYY-MM-DD"),
        tone: z.enum(NEWS_TONES),
        why: z.string().describe(`Why it matters for the stock, at most ${LINE_MAX} characters.`),
      }),
    )
    .max(8),
  plan: z.object({
    stance: z.enum(STANCES),
    buyLow: z.number().nullable(),
    buyHigh: z.number().nullable(),
    stop: z.number().nullable(),
    targets: z.array(z.number()).max(3),
    rationale: z.string().describe(`At most ${SUMMARY_MAX} characters, citing levels and news.`),
  }),
  risks: z.array(z.string().describe(`At most ${LINE_MAX} characters.`)).max(3),
});
export type Outlook = z.infer<typeof OutlookSchema>;

/** POST /api/outlook/:symbol body: the candles the chart analyses (its interval's period). */
export const OutlookRequestSchema = z.object({
  timeframe: z.enum(TIMEFRAMES),
  candles: z.array(CandleSchema).min(20).max(6000),
  ai: AiChoiceSchema.default(DEFAULT_AI_CHOICE),
});
export type OutlookRequest = z.input<typeof OutlookRequestSchema>;

export const OutlookResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    provider: z.string(),
    model: z.string().nullable(),
    /** The local plan the outlook builds on (same candles as the chart). */
    localPlan: TradePlanSchema.nullable(),
    outlook: OutlookSchema,
    /** Headlines from the market-data provider's news feed included in the prompt. */
    feedHeadlines: z.number().int(),
    /** How the run got current facts; `researchNote` says why web research was skipped. */
    research: z.enum(RESEARCH_MODES),
    researchNote: z.string().nullable(),
    generatedAt: z.string(),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type OutlookResponse = z.infer<typeof OutlookResponseSchema>;
