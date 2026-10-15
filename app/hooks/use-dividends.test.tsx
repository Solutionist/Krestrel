import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDividends } from "./use-dividends";

const quarterly = {
  frequency: "quarterly",
  last: { exDate: "2026-09-15", payDate: "2026-10-01", amount: 0.5 },
  next: null,
};

/** Fake GET /api/dividends: answers per requested symbol, failing the request when told to. */
function stubApi(failWhen: (symbols: string[]) => boolean = () => false) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const symbols = (new URL(String(input), "http://x").searchParams.get("symbols") ?? "").split(
      ",",
    );
    if (symbols.length > 100)
      return Response.json(
        { ok: false, error: { code: "invalid", message: "too many" } },
        { status: 400 },
      );
    if (failWhen(symbols)) return new Response("boom", { status: 500 });
    return Response.json({
      ok: true,
      today: "2026-10-15",
      dividends: Object.fromEntries(symbols.map((symbol) => [symbol, quarterly])),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

/** `count` distinct valid tickers: A, B, …, Z, BA, BB, … (base-26 letters). */
const symbols = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    let ticker = "";
    let n = index;
    do {
      ticker = String.fromCharCode(65 + (n % 26)) + ticker;
      n = Math.floor(n / 26);
    } while (n > 0);
    return ticker;
  });

describe("useDividends", () => {
  it("loads more than one request's worth of symbols, in chunks the API accepts", async () => {
    const fetchMock = stubApi();
    const all = symbols(150);
    const { result } = renderHook(() => useDividends(all));
    await waitFor(() => expect(result.current).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.current?.bySymbol ?? {})).toHaveLength(150);
  });

  it("leaves a failed chunk's symbols unknown instead of loading forever", async () => {
    const all = symbols(150);
    // Fail whichever request carries this symbol; the other request's symbols still arrive.
    const lost = all[120] ?? "";
    stubApi((chunk) => chunk.includes(lost));
    const { result } = renderHook(() => useDividends(all));
    await waitFor(() => expect(result.current).toBeDefined());
    const known = Object.keys(result.current?.bySymbol ?? {});
    expect(known).not.toContain(lost);
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBeLessThan(150);
    expect(result.current?.today).toBe("2026-10-15");
  });
});
