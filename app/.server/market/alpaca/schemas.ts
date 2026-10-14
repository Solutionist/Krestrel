// Upstream payload shapes from docs.alpaca.markets (see ai/market-data.md). Shapes come from the
// docs, not live captures, so only the fields Krestrel uses are required; the rest are optional.
import type { Logger } from "pino";
import * as z from "zod";

/** RFC 3339 with variable fraction digits: bars use whole seconds, trades use ms or ns. */
const Timestamp = z.iso.datetime({ offset: true });

// ---- Stream (wss://stream.data.alpaca.markets/v2/{feed}) ----

const TradeMessageSchema = z.object({
  T: z.literal("t"),
  S: z.string(),
  p: z.number(),
  s: z.number(),
  t: Timestamp,
  i: z.number().optional(),
  x: z.string().optional(),
  c: z.array(z.string()).optional(),
  z: z.string().optional(),
});

const streamBarFields = {
  S: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  n: z.number().optional(),
  vw: z.number().optional(),
  t: Timestamp,
};

const BarMessageSchema = z.object({ T: z.literal("b"), ...streamBarFields });
/** Late-trade correction of an earlier minute; same shape as `b`. */
const UpdatedBarMessageSchema = z.object({ T: z.literal("u"), ...streamBarFields });

const CorrectionMessageSchema = z.looseObject({
  T: z.literal("c"),
  S: z.string(),
  t: Timestamp,
  oi: z.number().optional(),
  op: z.number().optional(),
  ci: z.number().optional(),
  cp: z.number().optional(),
});

const CancelErrorMessageSchema = z.looseObject({
  T: z.literal("x"),
  S: z.string(),
  t: Timestamp,
  i: z.number().optional(),
  p: z.number().optional(),
  a: z.string().optional(),
});

const SuccessMessageSchema = z.object({ T: z.literal("success"), msg: z.string() });

/** Always the full current set; the test stream omits channels, so every key is optional. */
const SubscriptionMessageSchema = z.looseObject({
  T: z.literal("subscription"),
  trades: z.array(z.string()).optional(),
  bars: z.array(z.string()).optional(),
  updatedBars: z.array(z.string()).optional(),
});

const ErrorMessageSchema = z.object({
  T: z.literal("error"),
  code: z.number().int(),
  msg: z.string(),
});

const StreamMessageSchema = z.discriminatedUnion("T", [
  TradeMessageSchema,
  BarMessageSchema,
  UpdatedBarMessageSchema,
  CorrectionMessageSchema,
  CancelErrorMessageSchema,
  SuccessMessageSchema,
  SubscriptionMessageSchema,
  ErrorMessageSchema,
]);

export type StreamMessage = z.infer<typeof StreamMessageSchema>;
export type TradeMessage = z.infer<typeof TradeMessageSchema>;

const KNOWN_TYPES: ReadonlySet<string> = new Set(
  StreamMessageSchema.options.map((option) => option.shape.T.value),
);

// Checked before the union: Zod 4 reports an unknown discriminator as `invalid_union`, which
// would be indistinguishable from a malformed known message.
const EnvelopeSchema = z.looseObject({ T: z.string() });

/**
 * Decodes one stream frame (always a JSON array, possibly batched). Never throws: unknown
 * message types are skipped at debug, malformed known ones are skipped with a warning.
 */
export function parseStreamFrame(raw: string, log: Logger): StreamMessage[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    log.warn({ bytes: raw.length }, "alpaca frame is not JSON; skipped");
    return [];
  }
  if (!Array.isArray(decoded)) {
    log.warn("alpaca frame is not a JSON array; skipped");
    return [];
  }

  const messages: StreamMessage[] = [];
  for (const item of decoded) {
    const envelope = EnvelopeSchema.safeParse(item);
    if (!envelope.success) {
      log.warn("alpaca message without a T field; skipped");
      continue;
    }
    const type = envelope.data.T;
    if (!KNOWN_TYPES.has(type)) {
      log.debug({ type }, "alpaca message type not handled; skipped");
      continue;
    }
    const parsed = StreamMessageSchema.safeParse(item);
    if (!parsed.success) {
      log.warn(
        { type, issues: z.treeifyError(parsed.error) },
        "alpaca message failed validation; skipped",
      );
      continue;
    }
    messages.push(parsed.data);
  }
  return messages;
}

// ---- REST (data.alpaca.markets and the Trading API) ----

const RestBarSchema = z.object({
  t: Timestamp,
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  n: z.number().optional(),
  vw: z.number().optional(),
});
export type RestBar = z.infer<typeof RestBarSchema>;

/** GET /v2/stocks/bars. Sorted by symbol then time, so every page must be followed. */
export const BarsPageSchema = z.object({
  bars: z.record(z.string(), z.array(RestBarSchema)).nullish(),
  next_page_token: z.string().nullish(),
});

const RestTradeSchema = z.object({
  t: Timestamp,
  p: z.number(),
  s: z.number().optional(),
});

const SnapshotSchema = z.object({
  latestTrade: RestTradeSchema.nullish(),
  minuteBar: RestBarSchema.nullish(),
  dailyBar: RestBarSchema.nullish(),
  prevDailyBar: RestBarSchema.nullish(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** GET /v2/stocks/snapshots: a top-level map keyed by symbol (no wrapper key). */
export const SnapshotsResponseSchema = z.record(z.string(), SnapshotSchema.nullable());

const ClockSchema = z.object({
  market: z.looseObject({ acronym: z.string().optional() }).optional(),
  timestamp: Timestamp.optional(),
  is_market_day: z.boolean().optional(),
  phase: z.enum(["pre", "core", "lunch", "post", "closed"]),
  phase_until: Timestamp.nullish(),
  next_market_open: Timestamp.nullish(),
  next_market_close: Timestamp.nullish(),
});
export type Clock = z.infer<typeof ClockSchema>;

/** GET /v3/clock?markets=NYSE */
export const ClockResponseSchema = z.object({ clocks: z.array(ClockSchema) });

/** GET /v2/assets/{symbol} */
export const AssetResponseSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  exchange: z.string(),
  status: z.string(),
  class: z.string(),
  tradable: z.boolean(),
});
export type AlpacaAsset = z.infer<typeof AssetResponseSchema>;

/**
 * GET /v2/assets?status=active&asset_class=us_equity — validated per item by the caller so one
 * odd entry in ~11k cannot fail the whole listing.
 */
export const AssetListResponseSchema = z.array(z.unknown());
