import pino from "pino";
import { describe, expect, it } from "vitest";

import type { DailyBar, QuoteSnapshot } from "~/lib/market";

import { setupTestDatabase } from "../../../tests/db/test-db";
import { createDailyCloses } from "./daily-closes";
import { upsertDailyBars } from "./db/queries/bars";
import type { MarketDataProvider } from "./provider";

const db = setupTestDatabase();
// Wednesday 14:00 New York: daily history runs through Tuesday Oct 13, today comes from quotes.
const NOW = Date.parse("2026-10-14T18:00:00Z");
const MINUTE = 60_000;
const DAY = 86_400_000;

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

/** Weekday bars with close = day of month; records each request. */
function fakeProvider(options: { failDaily?: boolean } = {}) {
  const requests: Array<{ symbols: string[]; start: string; end: string }> = [];
  const unused = () => {
    throw new Error("not used by daily closes");
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
    async *getDailyBars(symbols: readonly string[], start: string, end: string) {
      requests.push({ symbols: [...symbols], start, end });
      if (options.failDaily) throw new Error("upstream down");
      const page: DailyBar[] = [];
      for (
        let ms = Date.parse(`${start}T00:00:00Z`);
        ms < Date.parse(`${end}T00:00:00Z`);
        ms += DAY
      ) {
        const weekday = new Date(ms).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        const day = new Date(ms).toISOString().slice(0, 10);
        for (const symbol of symbols) page.push(daily(symbol, day, new Date(ms).getUTCDate()));
      }
      yield page;
    },
    getSnapshots: async (symbols: readonly string[]): Promise<QuoteSnapshot[]> =>
      symbols.map((symbol) => ({ symbol, lastPrice: 99, lastTs: NOW - MINUTE, previousClose: 13 })),
  };
  return { provider, requests };
}

function create(provider: MarketDataProvider) {
  return createDailyCloses({ provider, db, logger: pino({ level: "silent" }), now: () => NOW });
}

describe("createDailyCloses", () => {
  it("downloads an unstored symbol once, stores it and appends today's latest price", async () => {
    const { provider, requests } = fakeProvider();
    const closes = create(provider);

    const first = await closes.get(["NVDA", "NVDA"], "2026-10-08");
    expect(requests).toEqual([{ symbols: ["NVDA"], start: "2026-10-08", end: "2026-10-14" }]);
    expect(first.closes.get("NVDA")).toEqual([
      ["2026-10-08", 8],
      ["2026-10-09", 9],
      ["2026-10-12", 12],
      ["2026-10-13", 13],
      ["2026-10-14", 99],
    ]);
    expect(first.incomplete).toEqual([]);

    // Stored and remembered: a fresh instance reads the DB, this one doesn't even ask.
    const again = await closes.get(["NVDA"], "2026-10-08");
    expect(again).toEqual(first);
    expect(requests).toHaveLength(1);
    const fresh = fakeProvider();
    const later = await create(fresh.provider).get(["NVDA"], "2026-10-09");
    expect(later.closes.get("NVDA")?.[0]).toEqual(["2026-10-09", 9]);
    expect(fresh.requests).toEqual([]);
  });

  it("downloads only the missing head and tail around stored history", async () => {
    await upsertDailyBars(db, [daily("AAPL", "2026-10-06", 106), daily("AAPL", "2026-10-07", 107)]);
    const { provider, requests } = fakeProvider();

    const result = await create(provider).get(["AAPL"], "2026-10-01");
    expect(requests).toEqual([
      { symbols: ["AAPL"], start: "2026-10-01", end: "2026-10-06" },
      { symbols: ["AAPL"], start: "2026-10-08", end: "2026-10-14" },
    ]);
    expect(result.closes.get("AAPL")?.map(([day, close]) => `${day}=${close}`)).toEqual([
      "2026-10-01=1",
      "2026-10-02=2",
      "2026-10-05=5",
      "2026-10-06=106",
      "2026-10-07=107",
      "2026-10-08=8",
      "2026-10-09=9",
      "2026-10-12=12",
      "2026-10-13=13",
      "2026-10-14=99",
    ]);
  });

  it("serves what is stored when the download fails, names the symbol and tries again", async () => {
    await upsertDailyBars(db, [daily("KO", "2026-10-13", 70)]);
    const { provider, requests } = fakeProvider({ failDaily: true });
    const closes = create(provider);

    const result = await closes.get(["KO", "PEP"], "2026-10-13");
    expect(result.closes.get("KO")).toEqual([
      ["2026-10-13", 70],
      ["2026-10-14", 99],
    ]);
    // PEP's only close is today's price: its history is missing, so it is reported.
    expect(result.closes.get("PEP")).toEqual([["2026-10-14", 99]]);
    expect(result.incomplete).toEqual(["PEP"]);
    expect((await closes.get(["KO", "PEP"], "2026-10-13")).incomplete).toEqual(["PEP"]);
    expect(requests.map((request) => request.symbols)).toEqual([["PEP"], ["PEP"]]);
  });

  it("leaves no gap when a head download fails part-way and is retried", async () => {
    await upsertDailyBars(db, [daily("MSFT", "2026-10-08", 108)]);
    const { provider } = fakeProvider();
    const full = provider.getDailyBars.bind(provider);
    let calls = 0;
    provider.getDailyBars = async function* (symbols, start, end) {
      calls += 1;
      // One page per day; the first request breaks after its first page.
      for await (const page of full(symbols, start, end)) {
        for (const [index, bar] of page.entries()) {
          if (calls === 1 && index === 1) throw new Error("connection reset");
          yield [bar];
        }
      }
    };
    const closes = create(provider);

    const failed = await closes.get(["MSFT"], "2026-10-01");
    expect(failed.incomplete).toEqual(["MSFT"]);
    expect(failed.closes.get("MSFT")?.[0]).toEqual(["2026-10-08", 108]);
    const retried = await closes.get(["MSFT"], "2026-10-01");
    expect(retried.closes.get("MSFT")?.map(([day]) => day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(retried.incomplete).toEqual([]);
  });
});
