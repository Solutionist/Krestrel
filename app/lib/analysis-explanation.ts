// What "Ask Claude" returns (ADR 0012). Shared by the server route and the chart panel.
import * as z from "zod";

/** Character budgets: the insights panel shows one line per item. */
export const NOTE_MAX = 90;
export const SUMMARY_MAX = 160;

/** What the model must produce (sent as JSON Schema; validated, then trimmed to the budgets). */
export const ExplanationSchema = z.object({
  summary: z
    .string()
    .describe(
      `One sentence, at most ${SUMMARY_MAX} characters, citing the period's net move or range.`,
    ),
  trades: z
    .array(
      z.object({
        id: z.string().describe("A trade id from the input, e.g. T1."),
        rank: z.number().int().min(1).describe("1 = the clearest setup."),
        note: z
          .string()
          .describe(
            `At most ${NOTE_MAX} characters, about 12 words. Cite the given facts (RSI, volume ×, level id, EMA50). No adjectives, no advice.`,
          ),
      }),
    )
    .describe("One entry per input trade."),
  levels: z
    .array(
      z.object({
        id: z.string().describe("A level id from the input, e.g. S1 or R2."),
        note: z
          .string()
          .describe(
            `At most ${NOTE_MAX} characters: how price reacted there (e.g. "3 rejections, last Oct 13").`,
          ),
      }),
    )
    .describe("Only levels worth a note."),
  trend: z
    .string()
    .nullable()
    .describe(
      `At most ${NOTE_MAX} characters on the trend-support line, or null if none was given.`,
    ),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

/** Points/levels the explanation refers to (from the server's own analysis). */
export const ExplainedPointSchema = z.object({
  trades: z.array(
    z.object({
      id: z.string(),
      buy: z.object({ time: z.number(), price: z.number() }),
      sell: z.object({ time: z.number(), price: z.number() }),
      returnFraction: z.number(),
    }),
  ),
  levels: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["support", "resistance"]),
      price: z.number(),
      touches: z.number(),
    }),
  ),
});

/**
 * Claude Code model aliases the owner can pick per analysis; `default` leaves the choice to
 * CLAUDE_MODEL / the CLI. Aliases always resolve to the latest model of that tier.
 */
export const CLAUDE_MODELS = ["default", "haiku", "sonnet", "opus", "fable"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const CLAUDE_MODEL_LABELS: Record<ClaudeModel, { name: string; hint: string }> = {
  default: { name: "Default", hint: "Your Claude Code default" },
  haiku: { name: "Haiku", hint: "Fastest, lightest" },
  sonnet: { name: "Sonnet", hint: "Fast and capable" },
  opus: { name: "Opus", hint: "Deeper reasoning, slower" },
  fable: { name: "Fable", hint: "Most capable, slowest" },
};

export const ExplainResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    model: z.string().nullable(),
    provider: z.string(),
    analysis: ExplainedPointSchema,
    explanation: ExplanationSchema,
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;
