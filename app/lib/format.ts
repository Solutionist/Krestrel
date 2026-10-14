// Isomorphic price formatting. Display only; never feed formatted strings back into calculations.

// U+2212 MINUS SIGN: same advance width as digits in tabular fonts, unlike the hyphen-minus.
const MINUS = "\u2212";

const twoDecimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fourDecimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

// US equities under $1 may be quoted in $0.0001 increments (SEC Rule 612), so they get 4 decimals.
function precisionFor(referencePrice: number): Intl.NumberFormat {
  return Math.abs(referencePrice) < 1 ? fourDecimals : twoDecimals;
}

// Prefixes a sign unless the value rounds to zero at the displayed precision ("0.00", never "+0.00").
function withSign(value: number, formatted: string): string {
  if (!/[1-9]/.test(formatted)) return formatted;
  return `${value > 0 ? "+" : MINUS}${formatted}`;
}

/** Formats a price, e.g. `1,234.50` or `0.5123`. */
export function formatPrice(price: number): string {
  return precisionFor(price).format(price);
}

/**
 * Formats an absolute change with an explicit sign, e.g. `+1.25` or `−0.0042`.
 * Precision follows the reference price so a sub-dollar stock's change keeps 4 decimals.
 */
export function formatChange(change: number, referencePrice: number): string {
  return withSign(change, precisionFor(referencePrice).format(Math.abs(change)));
}

/** Formats a fractional change as a signed percentage, e.g. `0.0123` → `+1.23%`. */
export function formatPercentChange(fraction: number): string {
  return `${withSign(fraction, twoDecimals.format(Math.abs(fraction * 100)))}%`;
}

const shareCount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/** Formats a share quantity: whole shares plainly, fractional shares up to 6 decimals. */
export function formatShares(shares: number): string {
  return shareCount.format(shares);
}
