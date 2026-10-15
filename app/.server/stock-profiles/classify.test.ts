import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { buildClassifyPrompt, classifyStocks } from "./classify";

const logger = pino({ level: "silent" });

function answer(content: unknown): typeof fetch {
  return vi.fn<typeof fetch>(async () =>
    Response.json({ message: { role: "assistant", content: JSON.stringify(content) } }),
  );
}

describe("classifyStocks", () => {
  it("keeps one answer per asked ticker and drops ones it wasn't asked about", async () => {
    const fetch = answer({
      profiles: [
        { symbol: "ko", sector: "Consumer Staples", style: "dividend" },
        { symbol: "KO", sector: "Energy", style: "risky" },
        { symbol: "VOO", sector: null, style: "growth" },
        { symbol: "TSLA", sector: "Consumer Discretionary", style: "growth" },
      ],
    });
    const stocks = [
      { symbol: "KO", name: "The Coca-Cola Company" },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF" },
      { symbol: "RKLB", name: null },
    ];
    await expect(classifyStocks(stocks, { env: {}, logger, fetch })).resolves.toEqual([
      { symbol: "KO", sector: "Consumer Staples", style: "dividend" },
      { symbol: "VOO", sector: null, style: "growth" },
    ]);
    // The prompt carries the listing names, which helps with lesser-known tickers.
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.messages.at(-1).content).toContain("- KO (The Coca-Cola Company)");
    expect(body.messages.at(-1).images).toBeUndefined();
  });

  it("doesn't call the model when there is nothing to classify", async () => {
    const fetch = answer({ profiles: [] });
    await expect(classifyStocks([], { env: {}, logger, fetch })).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("buildClassifyPrompt", () => {
  it("offers only the GICS sectors and the three types, with null for funds", () => {
    const prompt = buildClassifyPrompt([{ symbol: "AAPL", name: null }]);
    expect(prompt).toContain("Information Technology, Communication Services");
    expect(prompt).toMatch(/null for ETFs/);
    expect(prompt).toMatch(/growth \(Growth\).*\n.*dividend \(Dividend\).*\n.*risky \(Risky\)/);
  });
});
