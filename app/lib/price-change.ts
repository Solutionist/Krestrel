import type { QuoteSnapshot } from "./market";

export interface PriceChange {
  direction: "up" | "down" | "flat";
  absolute: number;
  fraction: number;
}

/** Change vs. previous close, or null when either price is unknown. */
export function priceChange(quote: QuoteSnapshot): PriceChange | null {
  if (quote.lastPrice === null || quote.previousClose === null || quote.previousClose === 0) {
    return null;
  }
  const absolute = quote.lastPrice - quote.previousClose;
  return {
    direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat",
    absolute,
    fraction: absolute / quote.previousClose,
  };
}
