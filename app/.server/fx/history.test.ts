import pino from "pino";
import { describe, expect, it } from "vitest";

import { FxHistoryCache } from "./history";

const HOUR = 60 * 60 * 1000;

function rows(rates: Record<string, number>, quote = "THB") {
  return Object.entries(rates).map(([date, rate]) => ({ date, base: "USD", quote, rate }));
}

/** A fake fetch serving queued responses ("fail" = network error), recording requested URLs. */
function fakeFetch(responses: (unknown[] | "fail")[]) {
  const urls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input));
    const next = responses[urls.length - 1] ?? "fail";
    if (next === "fail") throw new Error("offline");
    return Response.json(next);
  };
  return { fetchImpl, urls };
}

function cache(fetchImpl: typeof fetch, now: () => number) {
  return new FxHistoryCache({ logger: pino({ level: "silent" }), fetch: fetchImpl, now });
}

const SERIES = { "2024-02-23": 35.8, "2024-02-29": 35.9, "2024-03-01": 36, "2024-03-04": 36.2 };

describe("FxHistoryCache", () => {
  it("sends only the currency and a start 10 days early, so a weekend start has a rate", async () => {
    const { fetchImpl, urls } = fakeFetch([rows(SERIES)]);
    const result = await cache(fetchImpl, () => 0).get("THB", "2024-03-03");

    expect(urls).toEqual([
      "https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=THB&from=2024-02-22",
    ]);
    expect(result).toEqual({ ok: true, rates: SERIES });
  });

  it("serves a later start from the cache until 6 hours old, trimmed to that start", async () => {
    let now = 0;
    const { fetchImpl, urls } = fakeFetch([rows(SERIES), rows({ ...SERIES, "2024-03-05": 36.4 })]);
    const rates = cache(fetchImpl, () => now);
    await rates.get("THB", "2024-03-03");

    now = 5 * HOUR;
    expect(await rates.get("THB", "2024-03-10")).toEqual({
      ok: true,
      rates: { "2024-02-29": 35.9, "2024-03-01": 36, "2024-03-04": 36.2 },
    });
    expect(urls).toHaveLength(1);

    now = 7 * HOUR;
    expect(await rates.get("THB", "2024-03-10")).toMatchObject({
      ok: true,
      rates: { "2024-03-05": 36.4 },
    });
    // The refresh keeps the cached series' earlier start.
    expect(urls[1]).toContain("from=2024-02-22");
  });

  it("fetches again from an earlier start than the cache covers", async () => {
    const { fetchImpl, urls } = fakeFetch([rows(SERIES), rows({ "2023-12-29": 34, ...SERIES })]);
    const rates = cache(fetchImpl, () => 0);
    await rates.get("THB", "2024-03-03");
    expect(await rates.get("THB", "2024-01-02")).toMatchObject({
      ok: true,
      rates: { "2023-12-29": 34 },
    });
    expect(urls[1]).toContain("from=2023-12-23");
  });

  it("keeps serving the cached series when a refresh fails, and backs off", async () => {
    let now = 0;
    const { fetchImpl, urls } = fakeFetch([rows(SERIES), "fail"]);
    const rates = cache(fetchImpl, () => now);
    await rates.get("THB", "2024-03-03");

    now = 7 * HOUR;
    expect(await rates.get("THB", "2024-03-03")).toEqual({ ok: true, rates: SERIES });
    now += 60_000;
    await rates.get("THB", "2024-03-03");
    expect(urls).toHaveLength(2);
  });

  it("reports rates unavailable when nothing cached covers the start", async () => {
    const { fetchImpl } = fakeFetch(["fail"]);
    expect(await cache(fetchImpl, () => 0).get("THB", "2024-03-03")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Amounts are shown in USD"),
    });
  });

  it("treats an upstream error status or no rows as unavailable", async () => {
    const empty = fakeFetch([[]]);
    expect(await cache(empty.fetchImpl, () => 0).get("THB", "2026-10-15")).toMatchObject({
      ok: false,
    });
    const refused = new FxHistoryCache({
      logger: pino({ level: "silent" }),
      fetch: async () =>
        Response.json({ status: 422, message: "invalid currency" }, { status: 422 }),
    });
    expect(await refused.get("XYZ", "2024-01-02")).toMatchObject({ ok: false });
  });

  it("shares one upstream request between simultaneous callers", async () => {
    const { fetchImpl, urls } = fakeFetch([rows(SERIES)]);
    const rates = cache(fetchImpl, () => 0);
    const [a, b] = await Promise.all([
      rates.get("THB", "2024-03-03"),
      rates.get("THB", "2024-03-03"),
    ]);
    expect(a).toEqual(b);
    expect(urls).toHaveLength(1);
  });
});
