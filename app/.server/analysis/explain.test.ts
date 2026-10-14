import { describe, expect, it } from "vitest";

import type { Analysis } from "~/lib/analysis";

import { buildExplainPrompt, sanitizeExplanation } from "./explain";

const analysis: Analysis = {
  swingThreshold: 0.05,
  pivots: [
    { index: 0, time: 1_760_000_000, price: 100, kind: "low", confirmed: true },
    { index: 5, time: 1_760_432_000, price: 130, kind: "high", confirmed: false },
  ],
  trades: [
    {
      id: "T1",
      buy: { time: 1_760_000_000, price: 100 },
      sell: { time: 1_760_432_000, price: 130 },
      returnFraction: 0.3,
    },
  ],
  levels: [{ id: "S1", kind: "support", price: 100, touches: 2, lastTouchTime: 1_760_000_000 }],
  trendSupport: null,
};

describe("sanitizeExplanation", () => {
  it("drops comments about ids the analysis doesn't contain and orders trades by rank", () => {
    const cleaned = sanitizeExplanation(
      {
        summary: "s",
        trades: [
          { id: "T9", rank: 1, note: "invented" },
          { id: "T1", rank: 2, note: "real" },
          { id: "T1", rank: 3, note: "duplicate" },
        ],
        levels: [
          { id: "R7", note: "invented" },
          { id: "S1", note: "real" },
        ],
        trend: "there is no trend line, so this must be dropped",
      },
      analysis,
    );
    expect(cleaned.trades).toEqual([{ id: "T1", rank: 2, note: "real" }]);
    expect(cleaned.levels).toEqual([{ id: "S1", note: "real" }]);
    expect(cleaned.trend).toBeNull();
  });

  it("holds verbose notes to the one-line budget, cutting at a word boundary", () => {
    const wordy =
      "Price bounced strongly off a well-established support zone after an extended decline with notably elevated volume and momentum";
    const cleaned = sanitizeExplanation(
      { summary: "s", trades: [{ id: "T1", rank: 1, note: wordy }], levels: [], trend: null },
      analysis,
    );
    const note = cleaned.trades[0]?.note ?? "";
    expect(note.length).toBeLessThanOrEqual(90);
    expect(note.endsWith("…")).toBe(true);
    expect(wordy.startsWith(note.slice(0, -1))).toBe(true);
  });
});

describe("buildExplainPrompt", () => {
  it("lists every candidate by id with dates and returns, and caps the candle table", () => {
    const candles = Array.from({ length: 400 }, (_, i) => ({
      time: 1_760_000_000 + i * 86_400,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1000,
    }));
    const prompt = buildExplainPrompt("AAPL", "1D", candles, analysis);
    expect(prompt).toContain("T1: buy 2025-10-09 @ 100.00, sell 2025-10-14 @ 130.00, return 30.0%");
    expect(prompt).toContain("S1: support 100.00 (2 touches)");
    expect(prompt).toContain("held 5 bars");
    expect(prompt).toContain("  entry facts: ");
    expect(prompt).toContain("  exit facts: ");
    expect(prompt).toContain("most recent 300:");
    expect(prompt.split("\n").filter((line) => /^\d{4}-\d{2}-\d{2},/.test(line))).toHaveLength(300);
  });
});
