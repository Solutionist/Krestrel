import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { createDividendHistory } from "./dividend-history";
import type { MarketDataProvider } from "./provider";

const NOW = Date.parse("2026-10-14T18:00:00Z");
const HOUR = 3_600_000;

const ko = (exDate: string, payDate: string) => ({
  symbol: "KO",
  exDate,
  payDate,
  amount: 0.5,
  special: false,
});

function setup(getDividends: MarketDataProvider["getDividends"]) {
  const clock = { now: NOW };
  const provider = { getDividends: vi.fn(getDividends) };
  const history = createDividendHistory({
    provider,
    logger: pino({ level: "silent" }),
    now: () => clock.now,
  });
  return { clock, provider, history };
}

describe("dividend history", () => {
  it("asks for the start day to today, then serves later starts from the cache", async () => {
    const { provider, history } = setup(async () => [
      ko("2023-06-01", "2023-06-15"),
      ko("2026-06-01", "2026-06-15"),
    ]);

    const all = await history.get(["KO", "NVDA"], "2023-01-01");
    expect(provider.getDividends).toHaveBeenCalledWith(["KO", "NVDA"], "2023-01-01", "2026-10-14");
    // NVDA paid nothing: known, with no payouts (not missing).
    expect(all.get("NVDA")).toEqual([]);
    expect(all.get("KO")).toHaveLength(2);

    const recent = await history.get(["KO"], "2025-01-01");
    expect(recent.get("KO")?.map((payout) => payout.exDate)).toEqual(["2026-06-01"]);
    expect(provider.getDividends).toHaveBeenCalledTimes(1);
  });

  it("asks again for an earlier start, and after 6 hours", async () => {
    const { clock, provider, history } = setup(async () => []);
    await history.get(["KO"], "2025-01-01");
    await history.get(["KO"], "2024-01-01");
    expect(provider.getDividends).toHaveBeenLastCalledWith(["KO"], "2024-01-01", "2026-10-14");

    clock.now = NOW + 6 * HOUR + 1;
    await history.get(["KO"], "2024-01-01");
    expect(provider.getDividends).toHaveBeenCalledTimes(3);
  });

  it("leaves a symbol out (unknown) when the provider fails, rather than undercounting", async () => {
    let fail = false;
    const { history } = setup(async () => {
      if (fail) throw new Error("HTTP 500");
      return [ko("2026-06-01", "2026-06-15")];
    });
    await history.get(["KO"], "2026-01-01");
    fail = true;

    // Cached from 2026 only: a longer history can't be given.
    expect((await history.get(["KO"], "2024-01-01")).has("KO")).toBe(false);
    // What the cache covers is still served.
    expect((await history.get(["KO"], "2026-01-01")).get("KO")).toHaveLength(1);
    expect((await history.get(["AAPL"], "2026-01-01")).has("AAPL")).toBe(false);
  });
});
