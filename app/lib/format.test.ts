import { describe, expect, it } from "vitest";

import { formatChange, formatPercentChange, formatPrice } from "./format";

describe("formatPrice", () => {
  it("uses two decimals and thousands grouping at or above $1", () => {
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(1)).toBe("1.00");
  });

  it("uses four decimals below $1", () => {
    expect(formatPrice(0.51234)).toBe("0.5123");
    expect(formatPrice(0.99999)).toBe("1.0000");
  });
});

describe("formatChange", () => {
  it("prefixes + for gains and a true minus sign for losses", () => {
    expect(formatChange(1.25, 180)).toBe("+1.25");
    expect(formatChange(-1.25, 180)).toBe("\u22121.25");
  });

  it("follows the reference price precision, not the change magnitude", () => {
    expect(formatChange(-0.0042, 0.5)).toBe("\u22120.0042");
    expect(formatChange(0.0042, 180)).toBe("0.00");
  });

  it("drops the sign when the change rounds to zero", () => {
    expect(formatChange(0, 180)).toBe("0.00");
    expect(formatChange(-0.004, 180)).toBe("0.00");
  });
});

describe("formatPercentChange", () => {
  it("converts a fraction to a signed percentage", () => {
    expect(formatPercentChange(0.0123)).toBe("+1.23%");
    expect(formatPercentChange(-0.004)).toBe("\u22120.40%");
  });

  it("groups large moves and drops the sign at zero", () => {
    expect(formatPercentChange(12.5)).toBe("+1,250.00%");
    expect(formatPercentChange(-0.00001)).toBe("0.00%");
  });
});
