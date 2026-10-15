// Price alerts contract (ADR 0023): shared by the alert engine, `/api/alerts`, the SSE `alert`
// event and the Markets page.
import * as z from "zod";

import { formatExchangeTime } from "./candles";
import { formatPrice } from "./format";
import { SymbolSchema } from "./market";

export const ALERT_DIRECTIONS = ["above", "below"] as const;
export const AlertDirectionSchema = z.enum(ALERT_DIRECTIONS);
export type AlertDirection = z.infer<typeof AlertDirectionSchema>;

/** Whether a trade at `price` reaches the target: touching it counts. */
export const ALERT_MET: Record<AlertDirection, (price: number, target: number) => boolean> = {
  above: (price, target) => price >= target,
  below: (price, target) => price <= target,
};

/** Smallest and largest targets the database's numeric(14,4) price column holds. */
export const MIN_ALERT_PRICE = 0.0001;
export const MAX_ALERT_PRICE = 9_999_999_999;

/** Fired alerts stay listed (and on the history chips) for this many days. */
export const RECENT_ALERT_DAYS = 7;

/** An alert as the page sees it. Times are epoch milliseconds, UTC. */
export const PriceAlertSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  direction: AlertDirectionSchema,
  price: z.number(),
  active: z.boolean(),
  createdAt: z.number(),
  triggeredAt: z.number().nullable(),
  triggerPrice: z.number().nullable(),
});
export type PriceAlert = z.infer<typeof PriceAlertSchema>;

/** SSE `alert` payload: sent once, when a trade reaches the target. */
export const AlertFiredSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  direction: AlertDirectionSchema,
  /** The target the owner set. */
  price: z.number(),
  /** The trade that reached it. */
  triggerPrice: z.number(),
  /** That trade's time, epoch milliseconds. */
  triggeredAt: z.number(),
});
export type AlertFired = z.infer<typeof AlertFiredSchema>;

export const AlertActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    symbol: SymbolSchema,
    direction: AlertDirectionSchema,
    // Rounded to the column's 4 decimals so the in-memory target matches the stored one.
    price: z
      .number({ error: "Enter a price" })
      .min(MIN_ALERT_PRICE, { error: "Enter a price of at least 0.0001" })
      .max(MAX_ALERT_PRICE, { error: "That price is too large" })
      .transform((price) => Math.round(price * 10_000) / 10_000),
  }),
  z.object({ intent: z.literal("delete"), id: z.uuid({ error: "Unknown alert" }) }),
]);
export type AlertAction = z.infer<typeof AlertActionSchema>;

/** GET and POST `/api/alerts`: active alerts plus those fired in the last `RECENT_ALERT_DAYS`. */
export const AlertsResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), alerts: z.array(PriceAlertSchema) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type AlertsResponse = z.infer<typeof AlertsResponseSchema>;

/** Toast and browser-notification wording for a fired alert. */
export function describeFiredAlert(fired: AlertFired): { title: string; body: string } {
  return {
    title: `${fired.symbol} ${fired.direction === "above" ? "▲ rose to" : "▼ fell to"} ${formatPrice(fired.price)}`,
    body: `Traded at ${formatPrice(fired.triggerPrice)} at ${formatExchangeTime(fired.triggeredAt)} ET. The alert is now off.`,
  };
}
