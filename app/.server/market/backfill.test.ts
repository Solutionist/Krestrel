import pino from "pino";
import { describe, expect, it } from "vitest";

import type { DailyBar } from "~/lib/market";

import { setupTestDatabase } from "../../../tests/db/test-db";
import { createBackfiller } from "./backfill";
import { upsertDailyBars } from "./db/queries/bars";
import type { MarketDataProvider } from "./provider";

const db = setupTestDatabase();
// Wednesday 14:00 New York: daily history runs through Tuesday Oct 13.
const NOW = Date.parse("2026-10-14T18:00:00Z");
const MINUTE = 60_000;
// One year back from NOW in New York (dailyYears: 1 → 365 days).
const FLOOR_DAY = "2025-10-14";
const END_DAY = "2026-10-14";

function daily(symbol: string, day: string, close: number): DailyBar {
  return {
    symbol,
    source: "fake_hist",
    day,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
}

/** Records each daily request; `pages` decides what each request yields. */
function fakeProvider(
  pages: (symbols: readonly string[], start: string) => AsyncIterable<DailyBar[]>,
) {
  const requests: Array<{ symbols: string[]; start: string; end: string }> = [];
  const unused = () => {
    throw new Error("not used by the daily backfill");
  };
  const provider: MarketDataProvider = {
    id: "fake",
    displayName: "Fake",
    liveDataLabel: "Fake data",
    maxSymbols: 30,
    liveSource: "fake_live",
    historySource: "fake_hist",
    historyDelayMs: 15 * MINUTE,
    maxSymbolsPerHistoryRequest: 30,
    connect: unused,
    disconnect: unused,
    subscribe: unused,
    unsubscribe: unused,
    getBars: unused,
    getClock: unused,
    getAsset: unused,
    listAssets: unused,
    getNews: unused,
    getDividends: unused,
    getSnapshots: unused,
    getDailyBars(symbols: readonly string[], start: string, end: string) {
      requests.push({ symbols: [...symbols], start, end });
      return pages(symbols, start);
    },
  };
  return { provider, requests };
}

function create(provider: MarketDataProvider) {
  return createBackfiller({
    provider,
    db,
    logger: pino({ level: "silent" }),
    days: 0,
    dailyYears: 1,
    now: () => NOW,
  });
}

describe("createBackfiller daily history", () => {
  it("fills the head before a lone recent row once, with no tail request", async () => {
    // What the daily-closes service leaves behind: only yesterday's bar.
    await upsertDailyBars(db, [daily("KO", "2026-10-13", 60)]);
    const { provider, requests } = fakeProvider(async function* (symbols, start) {
      yield symbols.map((symbol) => daily(symbol, start, 50));
    });
    const backfill = create(provider);

    await backfill.enqueue(["KO"]);
    expect(requests).toEqual([{ symbols: ["KO"], start: FLOOR_DAY, end: "2026-10-13" }]);

    await backfill.enqueue(["KO"]);
    expect(requests).toHaveLength(1);
    await backfill.close();
  });

  it("stops after the current page when closed", async () => {
    const pulled: number[] = [];
    const { promise: secondPending, resolve: releaseSecond } = Promise.withResolvers<void>();
    const { promise: secondPulled, resolve: markSecondPulled } = Promise.withResolvers<void>();
    const { provider, requests } = fakeProvider(async function* (symbols) {
      pulled.push(1);
      yield symbols.map((symbol) => daily(symbol, "2025-10-14", 1));
      pulled.push(2);
      markSecondPulled();
      await secondPending;
      yield symbols.map((symbol) => daily(symbol, "2025-10-15", 2));
      pulled.push(3);
      yield symbols.map((symbol) => daily(symbol, "2025-10-16", 3));
    });
    const backfill = create(provider);

    const job = backfill.enqueue(["KO"]);
    await secondPulled;
    const closing = backfill.close();
    releaseSecond();
    await job;
    await closing;

    expect(requests).toEqual([{ symbols: ["KO"], start: FLOOR_DAY, end: END_DAY }]);
    expect(pulled).toEqual([1, 2]);
  });
});
