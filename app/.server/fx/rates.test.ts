import pino from "pino";
import { describe, expect, it } from "vitest";

import { FxRateCache } from "./rates";

const HOUR = 60 * 60 * 1000;

function upstream(thb: number, date = "2026-10-13") {
  return [
    { date, base: "USD", quote: "EUR", rate: 0.89 },
    { date, base: "USD", quote: "THB", rate: thb },
  ];
}

/** A fake fetch serving queued responses ("fail" = network error) and counting calls. */
function fakeFetch(responses: (unknown[] | "fail")[]) {
  const calls = { count: 0 };
  const fetchImpl = async (): Promise<Response> => {
    const next = responses[calls.count] ?? "fail";
    calls.count += 1;
    if (next === "fail") throw new Error("offline");
    return Response.json(next);
  };
  return { fetchImpl, calls };
}

describe("FxRateCache", () => {
  it("serves cached rates until they are 6 hours old, with USD included", async () => {
    let now = 0;
    const { fetchImpl, calls } = fakeFetch([upstream(33.5), upstream(34)]);
    const cache = new FxRateCache({
      logger: pino({ level: "silent" }),
      fetch: fetchImpl,
      now: () => now,
    });

    expect(await cache.get()).toEqual({
      ok: true,
      fx: {
        rates: { USD: 1, EUR: 0.89, THB: 33.5 },
        date: "2026-10-13",
        source: "European Central Bank",
      },
    });
    now = 5 * HOUR;
    await cache.get();
    expect(calls.count).toBe(1);

    now = 7 * HOUR;
    expect(await cache.get()).toMatchObject({ ok: true, fx: { rates: { THB: 34 } } });
    expect(calls.count).toBe(2);
  });

  it("keeps serving the last good rates when a refresh fails, and backs off", async () => {
    let now = 0;
    const { fetchImpl, calls } = fakeFetch([upstream(33.5), "fail"]);
    const cache = new FxRateCache({
      logger: pino({ level: "silent" }),
      fetch: fetchImpl,
      now: () => now,
    });
    await cache.get();

    now = 7 * HOUR;
    expect(await cache.get()).toMatchObject({ ok: true, fx: { rates: { THB: 33.5 } } });
    now += 60_000;
    await cache.get();
    expect(calls.count).toBe(2);
  });

  it("reports an error when rates were never loaded, without retrying on every request", async () => {
    let now = 0;
    const { fetchImpl, calls } = fakeFetch(["fail", upstream(33.5)]);
    const cache = new FxRateCache({
      logger: pino({ level: "silent" }),
      fetch: fetchImpl,
      now: () => now,
    });

    expect(await cache.get()).toMatchObject({ ok: false });
    expect(await cache.get()).toMatchObject({ ok: false });
    expect(calls.count).toBe(1);

    now = 6 * 60_000;
    expect(await cache.get()).toMatchObject({ ok: true });
  });

  it("shares one upstream request between concurrent callers", async () => {
    const { fetchImpl, calls } = fakeFetch([upstream(33.5)]);
    const cache = new FxRateCache({ logger: pino({ level: "silent" }), fetch: fetchImpl });

    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(calls.count).toBe(1);
  });
});
