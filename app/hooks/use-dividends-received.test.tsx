import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Trade } from "~/lib/portfolio";

import { useDividendsReceived } from "./use-dividends-received";

const A = "0190f0aa-0000-7000-8000-000000000001";

const trades: Trade[] = [
  {
    id: "t1",
    portfolioId: A,
    symbol: "KO",
    side: "buy",
    shares: 10,
    price: 60,
    fee: 0,
    tradedOn: "2026-01-05",
    createdAt: "2026-01-05T15:00:00Z",
  },
];

/** Fake /api/dividends-received: one paid KO payout; POSTs answer with `postResult`. */
function stubApi(postResult: () => Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return postResult();
    return Response.json({
      ok: true,
      today: "2026-10-15",
      payouts: {
        KO: [{ exDate: "2026-06-01", payDate: "2026-06-15", amount: 0.5, special: false }],
      },
      overrides: [],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const key = { portfolioId: A, symbol: "KO", exDate: "2026-06-01" };

describe("useDividendsReceived", () => {
  it("asks for history since the first trade and works out the cash, after withholding", async () => {
    const fetchMock = stubApi(() => Response.json({ ok: true }));
    const { result } = renderHook(() => useDividendsReceived({ portfolioIds: [A], trades }));
    await waitFor(() => expect(result.current.received).toBeDefined());

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      symbols: "KO",
      portfolios: A,
      from: "2026-01-05",
    });
    expect(result.current.received?.map((row) => row.cash)).toEqual([5]);

    act(() => result.current.setWithholding(15));
    expect(result.current.withholding).toBe(15);
    expect(result.current.received?.map((row) => row.cash)).toEqual([4.25]);
  });

  it("shows an edited amount at once and keeps it when saved", async () => {
    const fetchMock = stubApi(() => Response.json({ ok: true }));
    const { result } = renderHook(() => useDividendsReceived({ portfolioIds: [A], trades }));
    await waitFor(() => expect(result.current.received).toBeDefined());

    act(() => result.current.setOverride(key, 4.1));
    expect(result.current.received?.[0]).toMatchObject({ cash: 4.1, overridden: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      intent: "set",
      ...key,
      amount: 4.1,
    });
    expect(result.current.error).toBeNull();
    expect(result.current.received?.[0]).toMatchObject({ cash: 4.1, overridden: true });
  });

  it("undoes an edit the server refused and says why", async () => {
    stubApi(() =>
      Response.json(
        { ok: false, error: { code: "not_found", message: "That portfolio no longer exists." } },
        { status: 404 },
      ),
    );
    const { result } = renderHook(() => useDividendsReceived({ portfolioIds: [A], trades }));
    await waitFor(() => expect(result.current.received).toBeDefined());

    act(() => result.current.setOverride(key, 4.1));
    await waitFor(() => expect(result.current.error).toBe("That portfolio no longer exists."));
    expect(result.current.received?.[0]).toMatchObject({ cash: 5, overridden: false });
  });

  it("has nothing to load without trades", () => {
    const fetchMock = stubApi(() => Response.json({ ok: true }));
    const { result } = renderHook(() => useDividendsReceived({ portfolioIds: [A], trades: [] }));
    expect(result.current.received).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts an older first trade at the history floor so its payouts still load", async () => {
    const fetchMock = stubApi(() => Response.json({ ok: true }));
    const old = trades.map((trade) => ({ ...trade, tradedOn: "1985-03-04" }));
    const { result } = renderHook(() => useDividendsReceived({ portfolioIds: [A], trades: old }));
    await waitFor(() => expect(result.current.received).toBeDefined());
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://x");
    expect(url.searchParams.get("from")).toBe("1990-01-01");
  });

  it("asks nothing while disabled and loads once across enabling, disabling and enabling", async () => {
    const fetchMock = stubApi(() => Response.json({ ok: true }));
    const { result, rerender } = renderHook(
      ({ enabled }) => useDividendsReceived({ portfolioIds: [A], trades, enabled }),
      { initialProps: { enabled: false } },
    );
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.received?.map((row) => row.cash)).toEqual([5]));
    rerender({ enabled: false });
    rerender({ enabled: true });
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.received?.map((row) => row.cash)).toEqual([5]);
  });
});
