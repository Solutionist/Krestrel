// Server-Sent Events contract (ADR 0002, ai/architecture.md). Shared by the SSE route and the
// browser hook so both sides agree on event names and payload shapes.
import * as z from "zod";

import {
  BarSchema,
  ConnectionStatusSchema,
  MarketClockSchema,
  ProviderInfoSchema,
  QuoteSnapshotSchema,
  TickSchema,
} from "./market";

export const WatchlistPayloadSchema = z.object({ symbols: z.array(z.string()) });

/** Sent once on every (re)connect so the client never depends on missed history. */
export const SnapshotPayloadSchema = z.object({
  provider: ProviderInfoSchema,
  status: ConnectionStatusSchema,
  clock: MarketClockSchema.nullable(),
  watchlist: z.array(z.string()),
  quotes: z.array(QuoteSnapshotSchema),
});
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;

export const STREAM_EVENT_SCHEMAS = {
  snapshot: SnapshotPayloadSchema,
  tick: TickSchema,
  bar: BarSchema,
  status: ConnectionStatusSchema,
  market: MarketClockSchema,
  quote: QuoteSnapshotSchema,
  watchlist: WatchlistPayloadSchema,
  /** History download finished for these symbols; charts showing them should reload. */
  history: z.object({ symbols: z.array(z.string()) }),
} as const;

export type StreamEventName = keyof typeof STREAM_EVENT_SCHEMAS;
export type StreamEventPayload<E extends StreamEventName> = z.infer<
  (typeof STREAM_EVENT_SCHEMAS)[E]
>;

export type StreamEvent = {
  [E in StreamEventName]: { event: E; data: StreamEventPayload<E> };
}[StreamEventName];

/** Seconds between `: ping` comments that keep idle connections open. */
export const HEARTBEAT_MS = 15_000;
/** Milliseconds between `: ping` comments that keep idle connections open. */
