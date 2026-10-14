import { describe, expect, it } from "vitest";

import { priceChange } from "./price-change";

const quote = (lastPrice: number | null, previousClose: number | null) => ({
  symbol: "AAPL",
  lastPrice,
  lastTs: null,
  previousClose,
});

describe("priceChange", () => {
  it("is flat when unchanged and null without a previous close", () => {
    expect(priceChange(quote(10, 10))).toEqual({ direction: "flat", absolute: 0, fraction: 0 });
    expect(priceChange(quote(10, null))).toBeNull();
    expect(priceChange(quote(10, 0))).toBeNull();
  });
});
