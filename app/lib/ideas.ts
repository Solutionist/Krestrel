// Stock ideas contract (ADR 0017): 5–10 ideas grouped as growth / dividend / risky, steered by
// the owner's portfolio (diversify into under-represented sectors) or a chosen focus sector.
// Produced by Claude with web search on an explicit click. Shared by server and page.

import * as z from "zod";

import { CLAUDE_MODELS } from "./outlook";

/** GICS sectors (the 11 the market uses), so the owner's mix and the ideas line up. */
export const SECTORS = [
  "Information Technology",
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Industrials",
  "Energy",
  "Utilities",
  "Real Estate",
  "Materials",
] as const;
export type Sector = (typeof SECTORS)[number];

/** Short labels for chips and tables. */
export const SECTOR_SHORT: Record<Sector, string> = {
  "Information Technology": "Tech",
  "Communication Services": "Communication",
  "Consumer Discretionary": "Consumer disc.",
  "Consumer Staples": "Staples",
  "Health Care": "Health care",
  Financials: "Financials",
  Industrials: "Industrials",
  Energy: "Energy",
  Utilities: "Utilities",
  "Real Estate": "Real estate",
  Materials: "Materials",
};

/** `diversify` = let the portfolio's gaps choose; otherwise every idea comes from that sector. */
export const FOCUSES = ["diversify", ...SECTORS] as const;
export type Focus = (typeof FOCUSES)[number];

export const IDEA_CATEGORIES = ["growth", "dividend", "risky"] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

export const IDEA_CATEGORY_LABELS: Record<IdeaCategory, { name: string; hint: string }> = {
  growth: {
    name: "Growth",
    hint: "Fast-growing revenue or earnings; price swings with the market",
  },
  dividend: { name: "Dividend", hint: "Steady businesses paying a reliable, growing dividend" },
  risky: {
    name: "Risky",
    hint: "Speculative: big upside if it works, real chance of large losses",
  },
};

/** Text budgets, enforced server-side after the model answers. */
export const IDEA_LINE_MAX = 110;
export const IDEA_SUMMARY_MAX = 240;
export const MIN_IDEAS = 5;
export const MAX_IDEAS = 10;

/** What the model must produce (sent as JSON Schema; validated, then sanitised server-side). */
export const IdeasModelSchema = z.object({
  holdingSectors: z
    .array(z.object({ symbol: z.string(), sector: z.enum(SECTORS) }))
    .describe("GICS sector of every holding provided, one entry each."),
  summary: z
    .string()
    .describe(
      `How the portfolio is spread and what it lacks, at most ${IDEA_SUMMARY_MAX} characters.`,
    ),
  suggestedSectors: z
    .array(z.enum(SECTORS))
    .max(4)
    .describe("Under-represented sectors worth adding, most useful first."),
  ideas: z
    .array(
      z.object({
        symbol: z.string().describe("US-listed ticker (NYSE or Nasdaq), e.g. JNJ or BRK.B"),
        name: z.string(),
        category: z.enum(IDEA_CATEGORIES),
        sector: z.enum(SECTORS),
        thesis: z.string().describe(`Why it is worth a look, at most ${IDEA_LINE_MAX} characters.`),
        fit: z
          .string()
          .describe(
            `How it fits or diversifies this portfolio, at most ${IDEA_LINE_MAX} characters.`,
          ),
        risk: z.string().describe(`The main risk, at most ${IDEA_LINE_MAX} characters.`),
        metrics: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .max(3)
          .describe('Key numbers with units, e.g. {label:"Dividend yield", value:"3.1%"}'),
        sources: z.array(z.object({ title: z.string(), url: z.string() })).max(2),
      }),
    )
    .min(MIN_IDEAS)
    .max(MAX_IDEAS),
});
export type IdeasModelOutput = z.infer<typeof IdeasModelSchema>;

/** POST /api/ideas body. */
export const IdeasRequestSchema = z.object({
  focus: z.enum(FOCUSES).default("diversify"),
  model: z.enum(CLAUDE_MODELS).default("default"),
});
export type IdeasRequest = z.input<typeof IdeasRequestSchema>;

const IdeaSchema = IdeasModelSchema.shape.ideas.element.extend({
  /** Exchange from the provider's listing (the ticker is checked there). */
  exchange: z.string(),
  lastPrice: z.number().nullable(),
  previousClose: z.number().nullable(),
  /** Already on the watchlist (so the chart can open directly). */
  watched: z.boolean(),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const IdeasResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    provider: z.string(),
    model: z.string().nullable(),
    focus: z.enum(FOCUSES),
    /** What steered the ideas: the owner's holdings, else the watchlist, else nothing. */
    basis: z.enum(["portfolio", "watchlist", "none"]),
    /** Starting mix by value (weights sum to 1), with Claude's sector per symbol. */
    holdings: z.array(
      z.object({ symbol: z.string(), weight: z.number(), sector: z.enum(SECTORS).nullable() }),
    ),
    sectorWeights: z.array(z.object({ sector: z.enum(SECTORS), weight: z.number() })),
    summary: z.string(),
    suggestedSectors: z.array(z.enum(SECTORS)),
    ideas: z.array(IdeaSchema),
    generatedAt: z.string(),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type IdeasResponse = z.infer<typeof IdeasResponseSchema>;
