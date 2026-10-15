// Reads holdings from a broker screenshot with the owner's local vision model (ADR 0018). The
// answer is validated here and reviewed by the owner before anything is saved; the image goes
// only to Ollama on this machine.

import * as z from "zod";

import type { ImportedHolding } from "~/lib/holdings-import";
import { SymbolSchema } from "~/lib/market";

import { type OllamaContext, ollamaStructured } from "../ollama";

/** First use loads the model into memory; CPU-only machines can take minutes per screenshot. */
const TIMEOUT_MS = 300_000;

/** What the model must return (Ollama turns this into a grammar the output has to follow). */
const ReadingSchema = z.object({
  /** Currency mark printed next to the costs, as shown ($, ฿, THB, …); null when none. */
  currency: z.string().nullable(),
  holdings: z
    .array(
      z.object({
        symbol: z.string(),
        shares: z.number().nullable(),
        averageCost: z.number().nullable(),
      }),
    )
    .max(200),
});

const SYSTEM = `You read screenshots of brokerage apps (for example Dime, Robinhood, Webull, Interactive Brokers, Schwab) and extract the stock positions shown. Report only what is visible; never guess.`;

const PROMPT = `List every stock position in this screenshot.
For each one give:
- symbol: its US ticker exactly as shown (e.g. AAPL, BRK.B). If only a company name is shown and you are certain of the ticker, use it; otherwise skip the position.
- shares: the number of shares held (fractions allowed, e.g. 0.5231).
- averageCost: the average cost per share. If only a total cost or cost basis is shown, divide it by the shares. Use null when no cost is shown.
The large amount next to a position is usually its market value, not its cost. Ignore cash, account totals, watchlists, prices, daily changes and profit/loss.
currency: the currency symbol or code printed next to the costs, copied exactly as shown (for example $, ฿, US$, USD, THB), or null if none is shown.`;

/** Printed currency marks → ISO codes. The model copies the mark; mapping it here is reliable. */
const CURRENCY_MARKS: Record<string, string> = {
  $: "USD",
  US$: "USD",
  "฿": "THB",
  บาท: "THB",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  S$: "SGD",
  HK$: "HKD",
};

export interface ScreenshotReading {
  holdings: ImportedHolding[];
  /** ISO code of the currency the costs were shown in; null when the screenshot didn't say. */
  currency: string | null;
}

/**
 * Valid, de-duplicated holdings from the model's answer. Tickers are normalised (BRK/B, BRK-B →
 * BRK.B); unparseable ones and rows with neither shares nor cost are dropped. Amounts that aren't
 * positive become null, for the owner to fill. A ticker listed twice keeps the row with more fields.
 */
export function cleanHoldings(raw: z.output<typeof ReadingSchema>["holdings"]): ImportedHolding[] {
  const bySymbol = new Map<string, { holding: ImportedHolding; filled: number }>();
  for (const row of raw) {
    const symbol = SymbolSchema.safeParse(
      row.symbol.replace(/^\$/, "").replace(/[/-](?=[A-Za-z]{1,2}$)/, "."),
    );
    if (!symbol.success) continue;
    // A misread amount is better left blank than saved.
    const [shares = null, averageCost = null] = [row.shares, row.averageCost].map((value) =>
      value !== null && Number.isFinite(value) && value > 0 ? value : null,
    );
    const holding = { symbol: symbol.data, shares, averageCost };
    const filled = Number(holding.shares !== null) + Number(holding.averageCost !== null);
    if (filled === 0) continue;
    const seen = bySymbol.get(holding.symbol);
    if (!seen || filled > seen.filled) bySymbol.set(holding.symbol, { holding, filled });
  }
  return [...bySymbol.values()].map((entry) => entry.holding);
}

/** Sends the screenshot to the local model and returns what it read. Throws OllamaError. */
export async function readHoldingsFromImage(
  image: Uint8Array,
  context: OllamaContext,
): Promise<ScreenshotReading> {
  const reading = await ollamaStructured(
    {
      feature: "Screenshot import",
      system: SYSTEM,
      prompt: PROMPT,
      images: [image],
      schema: ReadingSchema,
      timeoutMs: TIMEOUT_MS,
    },
    context,
  );
  const mark = reading.currency?.trim() ?? "";
  return {
    holdings: cleanHoldings(reading.holdings),
    currency: CURRENCY_MARKS[mark] ?? (/^[A-Za-z]{3}$/.test(mark) ? mark.toUpperCase() : null),
  };
}
